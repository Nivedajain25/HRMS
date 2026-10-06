import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import type { z } from 'zod';
import {
  LEAVE_WORKFLOW,
  type ApprovalStatus,
  type ApproverType,
  type PaginationQuery,
  type leaveBalanceAdjustSchema,
  type leaveBalanceQuery,
  type leaveCalendarQuery,
  type leaveListQuery,
  type leavePreviewSchema,
  type leaveRequestSchema,
  type leaveRequestUpdateSchema,
} from '@stencil/shared';
import { logger } from '../config/logger';
import { defineScheduledJob } from '../jobs';
import {
  AttendanceModel,
  DocumentModel,
  EmployeeModel,
  LeaveRequestModel,
  LeaveTypeModel,
  LocationModel,
  OrganizationModel,
  remainingBalance,
  type LeaveRequest,
  type LeaveRequestDoc,
} from '../models';
import { can, type RequestContext } from '../types/context';
import { dateOnly, toDateKey, todayKey } from '../utils/dates';
import { AppError, badRequest, conflict, forbidden, invalidTransition, notFound, unprocessable } from '../utils/errors';
import { buildPagination, buildSort, paginate } from '../utils/pagination';
import { withTransaction } from '../utils/transaction';
import { applyDecision, approvalQueueFilter, closeApproval, initApproval, type Approvable, type ApprovalPolicy } from './approval.service';
import { audit } from './audit.service';
import { buildWorkCalendar, holidaysInRange } from './calendar.service';
import { countLeaveDays, daysBetween, leaveRangesOverlap, spansMultipleYears } from './leave-calc';
import {
  adjustBalance,
  applyBalanceOp,
  carryForward,
  getBalanceDoc,
  isApplicable,
  listBalances,
  refreshMonthlyAccruals,
} from './leave-balance.service';
import { managerUserId, notify, notifyHr, userIdsWithPermission } from './notification.service';
import { assertEmployeeAccess, resolveEmployeeScope } from './scope.service';

/* -------------------------------- Types -------------------------------- */

type LeaveCreateInput = z.output<typeof leaveRequestSchema>;
type LeavePreviewInput = z.output<typeof leavePreviewSchema>;
type LeaveUpdateInput = z.output<typeof leaveRequestUpdateSchema>;
type LeaveListQuery = PaginationQuery & z.output<typeof leaveListQuery>;
type LeaveCalendarQuery = z.output<typeof leaveCalendarQuery>;
type LeaveBalanceQuery = z.output<typeof leaveBalanceQuery>;
type LeaveBalanceAdjustInput = z.output<typeof leaveBalanceAdjustSchema>;
type HalfDaySession = 'FIRST_HALF' | 'SECOND_HALF';

export const LEAVE_APPROVAL_POLICY: ApprovalPolicy = {
  approvePermission: 'leave:approve',
  rejectPermission: 'leave:reject',
  hrPermission: 'leave:read',
};

/** Statuses that occupy dates (a new request may not overlap them). */
const OCCUPYING: ApprovalStatus[] = ['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'APPROVED'];
/** Statuses holding a balance reservation. */
const PENDING: ApprovalStatus[] = ['SUBMITTED', 'PENDING_APPROVAL'];
/** Validation codes a draft may be saved with (re-checked on submit). */
const DRAFT_TOLERATED = new Set(['INSUFFICIENT_BALANCE', 'DOCUMENT_REQUIRED']);

const POPULATE = [
  { path: 'employeeId', select: 'employeeId firstName lastName profilePhoto departmentId' },
  { path: 'leaveTypeId', select: 'name code color paid isWorkFromHome' },
];

const MAX_CALENDAR_DAYS = 62;

/* ------------------------------- Loaders ------------------------------- */

interface OrgLeaveSettings {
  timezone: string;
  allowNegativeBalance: boolean;
  allowBackdatedDays: number;
  chain: ApproverType[];
}

const loadOrg = async (ctx: RequestContext): Promise<OrgLeaveSettings> => {
  const org = await OrganizationModel.findById(ctx.organizationId).select('timezone settings').lean();
  if (!org) throw notFound('Organization');
  const settings = org.settings as unknown as
    | { leave?: { allowNegativeBalance?: boolean; allowBackdatedDays?: number }; approvals?: { leave?: ApproverType[] } }
    | undefined;
  return {
    timezone: org.timezone ?? ctx.timezone ?? 'UTC',
    allowNegativeBalance: settings?.leave?.allowNegativeBalance ?? false,
    allowBackdatedDays: settings?.leave?.allowBackdatedDays ?? 30,
    chain: settings?.approvals?.leave?.length ? settings.approvals.leave : ['MANAGER'],
  };
};

const loadEmployee = async (ctx: RequestContext, id: Types.ObjectId | string) => {
  const employee = await EmployeeModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null }).lean();
  if (!employee) throw notFound('Employee');
  return employee;
};
type EmployeeLean = Awaited<ReturnType<typeof loadEmployee>>;

const loadLeaveType = async (ctx: RequestContext, id: Types.ObjectId | string) => {
  const type = await LeaveTypeModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null, active: true }).lean();
  if (!type) throw notFound('Leave type');
  return type;
};
type LeaveTypeLean = Awaited<ReturnType<typeof loadLeaveType>>;

const loadLeaveDoc = async (ctx: RequestContext, id: string): Promise<LeaveRequestDoc> => {
  const leave = await LeaveRequestModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!leave) throw notFound('Leave request');
  return leave;
};

/** Resolves who the leave is for; applying on behalf requires `leave:create`. */
const resolveApplicant = async (ctx: RequestContext, employeeId?: string) => {
  const target = employeeId ? new Types.ObjectId(employeeId) : ctx.employeeId;
  if (!target) throw badRequest('Your account is not linked to an employee profile', 'NO_EMPLOYEE_PROFILE');
  const onBehalf = !ctx.employeeId?.equals(target);
  if (onBehalf && !can(ctx, 'leave:create')) throw forbidden('You cannot apply leave on behalf of another employee');
  const employee = await loadEmployee(ctx, target);
  if (['EXITED', 'ARCHIVED'].includes(employee.employmentStatus)) {
    throw unprocessable('Leave cannot be applied for an inactive employee', 'EMPLOYEE_INACTIVE');
  }
  return { employee, onBehalf };
};

const statusOf = (leave: { status?: string | null }) => (leave.status ?? 'SUBMITTED') as ApprovalStatus;
const asApprovable = (leave: LeaveRequestDoc) => leave as unknown as Approvable;
const isOwner = (ctx: RequestContext, leave: { employeeId: Types.ObjectId; requestedBy?: Types.ObjectId | null }) =>
  !!ctx.employeeId?.equals(leave.employeeId) || (!!leave.requestedBy && ctx.userId.equals(leave.requestedBy));
const employeeName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * For users who are neither owner nor authorized: 403 when they can see the
 * record (e.g. HR/manager), otherwise the access check itself throws.
 */
const denyUnlessVisible = async (ctx: RequestContext, leave: LeaveRequestDoc, message: string): Promise<never> => {
  await assertEmployeeAccess(ctx, leave.employeeId, 'leave:read');
  throw forbidden(message);
};

/* ------------------------------ Validation ----------------------------- */

interface LeaveDraft {
  startDate: string;
  endDate: string;
  halfDay: boolean;
  halfDaySession: HalfDaySession | null;
  attachmentId?: string | null;
}

export interface LeaveEvaluation {
  days: number;
  workingDates: string[];
  weekOffs: string[];
  holidays: { date: string; name: string }[];
  /** Remaining balance before this request (null when not computable). */
  balance: number | null;
  balanceAfter: number | null;
  /** Unpaid types are not limited by balance. */
  unlimited: boolean;
  problems: AppError[];
}

/**
 * Runs every business rule for a prospective request and collects problems
 * instead of throwing, so the same code powers validation and the preview.
 */
const evaluate = async (
  ctx: RequestContext,
  org: OrgLeaveSettings,
  employee: EmployeeLean,
  type: LeaveTypeLean,
  d: LeaveDraft,
  opts: { excludeId?: Types.ObjectId; onBehalf: boolean; credit?: number },
): Promise<LeaveEvaluation> => {
  const problems: AppError[] = [];
  const multiYear = spansMultipleYears(d.startDate, d.endDate);
  if (multiYear) {
    problems.push(badRequest('Leave cannot span two calendar years. Submit a separate request for each year.', 'LEAVE_SPANS_YEARS'));
  }
  const applicable = isApplicable(type, employee);
  if (!applicable) problems.push(unprocessable(`${type.name} is not applicable to this employee`, 'LEAVE_TYPE_NOT_APPLICABLE'));
  if (d.halfDay && !type.halfDayAllowed) problems.push(badRequest(`Half day is not allowed for ${type.name}`, 'HALF_DAY_NOT_ALLOWED'));

  const calendar = await buildWorkCalendar(ctx.organizationId, d.startDate, d.endDate, employee._id);
  const count = countLeaveDays(d.startDate, d.endDate, d.halfDay, calendar.kindOf);
  if (count.days === 0) problems.push(badRequest('The selected dates contain no working days', 'NO_WORKING_DAYS'));

  // HR recording leave on behalf of an employee is exempt from notice/backdating limits.
  if (!opts.onBehalf) {
    const today = todayKey(org.timezone);
    if (d.startDate > today && type.minNoticeDays > 0 && daysBetween(today, d.startDate) < type.minNoticeDays) {
      problems.push(unprocessable(`${type.name} must be applied at least ${type.minNoticeDays} day(s) in advance`, 'INSUFFICIENT_NOTICE'));
    }
    if (d.startDate < today && daysBetween(d.startDate, today) > org.allowBackdatedDays) {
      problems.push(unprocessable(`Leave cannot be backdated by more than ${org.allowBackdatedDays} day(s)`, 'BACKDATE_LIMIT'));
    }
  }
  if (type.maxConsecutiveDays > 0 && count.days > type.maxConsecutiveDays) {
    problems.push(unprocessable(`${type.name} cannot exceed ${type.maxConsecutiveDays} consecutive day(s)`, 'MAX_CONSECUTIVE_DAYS'));
  }
  if (type.documentRequired && count.days > type.documentRequiredAfterDays && !d.attachmentId) {
    problems.push(
      unprocessable(
        type.documentRequiredAfterDays > 0
          ? `A supporting document is required for ${type.name} longer than ${type.documentRequiredAfterDays} day(s)`
          : `A supporting document is required for ${type.name}`,
        'DOCUMENT_REQUIRED',
      ),
    );
  }
  if (d.attachmentId) {
    const doc = Types.ObjectId.isValid(d.attachmentId)
      ? await DocumentModel.findOne({ _id: d.attachmentId, organizationId: ctx.organizationId, deletedAt: null }).select('employeeId uploadedBy').lean()
      : null;
    const owned = !!doc && (!!doc.employeeId?.equals(employee._id) || !!doc.uploadedBy?.equals(ctx.userId));
    if (!owned) problems.push(badRequest('Attachment not found', 'INVALID_ATTACHMENT', [{ path: 'attachmentId', message: 'Attachment not found' }]));
  }

  const existing = await LeaveRequestModel.find({
    organizationId: ctx.organizationId,
    employeeId: employee._id,
    status: { $in: OCCUPYING },
    startDate: { $lte: dateOnly(d.endDate) },
    endDate: { $gte: dateOnly(d.startDate) },
    ...(opts.excludeId ? { _id: { $ne: opts.excludeId } } : {}),
  })
    .select('startDate endDate halfDay halfDaySession status')
    .lean();
  const clash = existing.find((o) =>
    leaveRangesOverlap(d, { startDate: toDateKey(o.startDate), endDate: toDateKey(o.endDate), halfDay: o.halfDay, halfDaySession: o.halfDaySession }),
  );
  if (clash) {
    problems.push(
      conflict(
        `These dates overlap an existing ${statusOf(clash).replace(/_/g, ' ').toLowerCase()} leave request (${toDateKey(clash.startDate)} to ${toDateKey(clash.endDate)})`,
        'LEAVE_OVERLAP',
      ),
    );
  }

  const unlimited = !type.paid;
  let balance: number | null = null;
  if (applicable && !multiYear) {
    const doc = await getBalanceDoc(ctx.organizationId, employee._id, type._id, Number(d.startDate.slice(0, 4)));
    balance = round2(remainingBalance(doc) + (opts.credit ?? 0));
    if (!unlimited && !org.allowNegativeBalance && balance < count.days) {
      problems.push(unprocessable(`Insufficient leave balance (available: ${balance} day(s), requested: ${count.days})`, 'INSUFFICIENT_BALANCE'));
    }
  }

  return {
    days: count.days,
    workingDates: count.workingDates,
    weekOffs: count.weekOffs,
    holidays: count.holidays.map((date) => ({ date, name: calendar.holidays.get(date) ?? 'Holiday' })),
    balance,
    balanceAfter: balance === null ? null : round2(balance - count.days),
    unlimited,
    problems,
  };
};

const throwFirstProblem = (ev: LeaveEvaluation, tolerated?: ReadonlySet<string>) => {
  const problem = ev.problems.find((p) => !tolerated?.has(p.code));
  if (problem) throw problem;
};

const toDraft = (input: {
  startDate: string;
  endDate: string;
  halfDay?: boolean | null;
  halfDaySession?: HalfDaySession | null;
  attachmentId?: string | null;
}): LeaveDraft => {
  const halfDay = !!input.halfDay;
  return {
    startDate: input.startDate,
    endDate: input.endDate,
    halfDay,
    halfDaySession: halfDay ? (input.halfDaySession ?? 'FIRST_HALF') : null,
    attachmentId: input.attachmentId ?? null,
  };
};

/* ------------------------------- Ledger -------------------------------- */

interface LedgerTarget {
  _id: Types.ObjectId;
  employeeId: Types.ObjectId;
  leaveTypeId: Types.ObjectId;
  startDate: Date;
  days: number;
}

const ledger = async (
  ctx: RequestContext,
  target: LedgerTarget,
  op: 'RESERVE' | 'RELEASE' | 'CONSUME' | 'RESTORE',
  session: ClientSession | undefined,
  opts: { allowNegative?: boolean; reason?: string; days?: number } = {},
) => {
  const balance = await getBalanceDoc(ctx.organizationId, target.employeeId, target.leaveTypeId, target.startDate.getUTCFullYear(), session);
  await applyBalanceOp(
    balance,
    op,
    opts.days ?? target.days,
    { leaveRequestId: target._id, by: ctx.userId, reason: opts.reason, allowNegative: opts.allowNegative ?? true },
    session,
  );
};

/**
 * Persists a status change guarded by the expected current status, so two
 * concurrent decisions cannot both succeed (and transaction retries re-apply
 * the full state rather than relying on in-memory change tracking).
 */
const persistTransition = async (
  leave: LeaveRequestDoc,
  from: ApprovalStatus,
  set: Record<string, unknown>,
  session: ClientSession | undefined,
) => {
  const snapshot = leave.toObject() as { approvalSteps: unknown; currentStep: number; currentApproverType?: string | null };
  const res = await LeaveRequestModel.updateOne(
    { _id: leave._id, organizationId: leave.organizationId, status: from },
    {
      $set: {
        approvalSteps: snapshot.approvalSteps,
        currentStep: snapshot.currentStep,
        currentApproverType: snapshot.currentApproverType ?? null,
        ...set,
      },
    },
    { session },
  );
  if (res.matchedCount !== 1) throw conflict('This leave request was changed by someone else. Refresh and try again.', 'STALE_LEAVE');
};

/* ---------------------------- Notifications ---------------------------- */

/** Users who can act on the request's current step. */
const currentApproverUserIds = async (ctx: RequestContext, approverType: string | null | undefined, employee: EmployeeLean) => {
  let ids: Types.ObjectId[] = [];
  if (approverType === 'MANAGER') {
    const u = await managerUserId(ctx.organizationId, employee.managerId);
    ids = u ? [u] : [];
  } else if (approverType === 'HR') {
    const [approvers, hr] = await Promise.all([
      userIdsWithPermission(ctx.organizationId, LEAVE_APPROVAL_POLICY.approvePermission),
      userIdsWithPermission(ctx.organizationId, LEAVE_APPROVAL_POLICY.hrPermission),
    ]);
    const hrSet = new Set(hr.map(String));
    ids = approvers.filter((id) => hrSet.has(String(id)));
  }
  return ids.filter((id) => !employee.userId || !id.equals(employee.userId));
};

const describe = (type: { name: string }, leave: { startDate: Date; endDate: Date; days: number }) => {
  const s = toDateKey(leave.startDate);
  const e = toDateKey(leave.endDate);
  return `${type.name}: ${s === e ? s : `${s} to ${e}`} (${leave.days} day${leave.days === 1 ? '' : 's'})`;
};

/** A new request: HR hears about it too (in-app), beyond whoever approves it. */
const informHr = (ctx: RequestContext, leave: LeaveRequestDoc, employee: EmployeeLean, typeName: string, alreadyNotified: Types.ObjectId[]) =>
  notifyHr({
    organizationId: ctx.organizationId,
    alreadyNotified: [...alreadyNotified, employee.userId],
    type: 'LEAVE_SUBMITTED',
    title: `New leave request · ${employeeName(employee)}`,
    message: `${employeeName(employee)} requested ${describe({ name: typeName }, leave)}`,
    link: `/leave/requests/${leave._id}`,
    entityType: 'LeaveRequest',
    entityId: leave._id,
    excludeUserId: ctx.userId,
  });

const notifyApprovers = async (ctx: RequestContext, leave: LeaveRequestDoc, employee: EmployeeLean, typeName: string) => {
  const userIds = await currentApproverUserIds(ctx, leave.currentApproverType, employee);
  await notify({
    organizationId: ctx.organizationId,
    userIds,
    type: 'LEAVE_SUBMITTED',
    title: 'Leave request awaiting your approval',
    message: `${employeeName(employee)} requested ${describe({ name: typeName }, leave)}`,
    link: `/leave/requests/${leave._id}`,
    entityType: 'LeaveRequest',
    entityId: leave._id,
    excludeUserId: ctx.userId,
  });
  return userIds;
};

const notifyEmployee = async (
  ctx: RequestContext,
  leave: LeaveRequestDoc,
  employee: EmployeeLean,
  type: 'LEAVE_APPROVED' | 'LEAVE_REJECTED' | 'GENERAL',
  title: string,
  message: string,
) => {
  await notify({
    organizationId: ctx.organizationId,
    userIds: [employee.userId],
    type,
    title,
    message,
    link: `/leave/requests/${leave._id}`,
    entityType: 'LeaveRequest',
    entityId: leave._id,
    excludeUserId: ctx.userId,
  });
};

const typeNameOf = async (ctx: RequestContext, leaveTypeId: Types.ObjectId) =>
  (await LeaveTypeModel.findOne({ _id: leaveTypeId, organizationId: ctx.organizationId }).select('name').lean())?.name ?? 'Leave';

const auditLeave = (
  ctx: RequestContext,
  action: 'LEAVE_SUBMITTED' | 'LEAVE_APPROVED' | 'LEAVE_REJECTED' | 'LEAVE_CANCELLED',
  leave: LeaveRequestDoc,
  employee: EmployeeLean,
  typeName: string,
  oldValues: Record<string, unknown> | null,
  newValues: Record<string, unknown>,
) =>
  audit(ctx, {
    action,
    module: 'leave',
    recordId: leave._id,
    recordLabel: `${employeeName(employee)} (${employee.employeeId}) - ${describe({ name: typeName }, leave)}`,
    oldValues,
    newValues,
  });

/* -------------------------------- Queries ------------------------------ */

export const listLeaves = async (ctx: RequestContext, q: LeaveListQuery) => {
  const and: Record<string, unknown>[] = [{ organizationId: ctx.organizationId }];
  if (q.scope === 'approvals') {
    const queue = await approvalQueueFilter(ctx, LEAVE_APPROVAL_POLICY);
    if (!queue) return { items: [], pagination: buildPagination(q.page, q.limit, 0) };
    and.push(queue, { status: { $in: PENDING } });
  } else {
    const scope = await resolveEmployeeScope(ctx, 'leave:read', q.scope);
    if (scope.employeeIds !== null) and.push({ employeeId: { $in: scope.employeeIds } });
    // Drafts are private to whoever created them.
    and.push({
      $or: [{ status: { $ne: 'DRAFT' } }, { requestedBy: ctx.userId }, ...(ctx.employeeId ? [{ employeeId: ctx.employeeId }] : [])],
    });
  }
  if (q.employeeId) and.push({ employeeId: new Types.ObjectId(q.employeeId) });
  if (q.status) and.push(q.status === 'PENDING' ? { status: { $in: PENDING } } : { status: q.status });
  if (q.leaveTypeId) and.push({ leaveTypeId: new Types.ObjectId(q.leaveTypeId) });
  if (q.from) and.push({ endDate: { $gte: dateOnly(q.from) } });
  if (q.to) and.push({ startDate: { $lte: dateOnly(q.to) } });

  return paginate(LeaveRequestModel, {
    filter: { $and: and } as FilterQuery<LeaveRequest>,
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['startDate', 'endDate', 'createdAt', 'days', 'status'], { startDate: -1, _id: -1 }),
    populate: POPULATE,
  });
};

/** Single request (IDOR-protected). Other people's drafts are invisible. */
export const getLeave = async (ctx: RequestContext, id: string) => {
  const raw = await LeaveRequestModel.findOne({ _id: id, organizationId: ctx.organizationId }).select('employeeId requestedBy status').lean();
  if (!raw) throw notFound('Leave request');
  if (raw.status === 'DRAFT' && !isOwner(ctx, raw)) throw notFound('Leave request');
  await assertEmployeeAccess(ctx, raw.employeeId, 'leave:read');
  return LeaveRequestModel.findOne({ _id: id, organizationId: ctx.organizationId })
    .populate([...POPULATE, { path: 'attachmentId', select: 'title originalName mimeType size' }])
    .lean();
};

/* ------------------------------- Mutations ----------------------------- */

export const createLeave = async (ctx: RequestContext, input: LeaveCreateInput) => {
  const { employee, onBehalf } = await resolveApplicant(ctx, input.employeeId);
  const type = await loadLeaveType(ctx, input.leaveTypeId);
  const org = await loadOrg(ctx);
  const draft = toDraft(input);
  const ev = await evaluate(ctx, org, employee, type, draft, { onBehalf });
  throwFirstProblem(ev, input.saveAsDraft ? DRAFT_TOLERATED : undefined);

  const leave = new LeaveRequestModel({
    organizationId: ctx.organizationId,
    employeeId: employee._id,
    leaveTypeId: type._id,
    startDate: dateOnly(draft.startDate),
    endDate: dateOnly(draft.endDate),
    halfDay: draft.halfDay,
    halfDaySession: draft.halfDaySession,
    days: ev.days,
    reason: input.reason,
    attachmentId: draft.attachmentId,
    status: input.saveAsDraft ? 'DRAFT' : 'SUBMITTED',
    submittedAt: input.saveAsDraft ? null : new Date(),
    requestedBy: ctx.userId,
  });

  if (input.saveAsDraft) {
    await leave.save();
    return getLeave(ctx, String(leave._id));
  }

  initApproval(asApprovable(leave), org.chain, employee);
  await withTransaction(async (session) => {
    await LeaveRequestModel.create([leave.toObject()], { session });
    await ledger(ctx, leave, 'RESERVE', session, { allowNegative: org.allowNegativeBalance || !type.paid });
  });

  await auditLeave(ctx, 'LEAVE_SUBMITTED', leave, employee, type.name, null, {
    status: 'SUBMITTED',
    leaveType: type.code,
    startDate: draft.startDate,
    endDate: draft.endDate,
    days: ev.days,
    onBehalf,
  });
  await informHr(ctx, leave, employee, type.name, await notifyApprovers(ctx, leave, employee, type.name));
  return getLeave(ctx, String(leave._id));
};

/**
 * Edits a request. Only the requester may edit, and only a DRAFT or a
 * SUBMITTED request on which no approver has acted yet; for the latter the
 * balance reservation is moved to the new values atomically.
 */
export const updateLeave = async (ctx: RequestContext, id: string, input: LeaveUpdateInput) => {
  const leave = await loadLeaveDoc(ctx, id);
  if (!isOwner(ctx, leave)) {
    if (statusOf(leave) === 'DRAFT') throw notFound('Leave request');
    return denyUnlessVisible(ctx, leave, 'Only the requester can edit this leave request');
  }
  const from = statusOf(leave);
  const untouched = from === 'SUBMITTED' && leave.approvalSteps.every((s) => !s.actedBy);
  if (from !== 'DRAFT' && !untouched) {
    throw unprocessable('Only drafts or submitted requests awaiting their first approval can be edited', 'LEAVE_NOT_EDITABLE');
  }

  const leaveTypeId = input.leaveTypeId ?? String(leave.leaveTypeId);
  const merged = toDraft({
    startDate: input.startDate ?? toDateKey(leave.startDate),
    endDate: input.endDate ?? toDateKey(leave.endDate),
    halfDay: input.halfDay ?? leave.halfDay,
    halfDaySession: input.halfDaySession === undefined ? (leave.halfDaySession as HalfDaySession | null) : input.halfDaySession,
    attachmentId: input.attachmentId === undefined ? (leave.attachmentId ? String(leave.attachmentId) : null) : input.attachmentId,
  });
  if (merged.endDate < merged.startDate) {
    throw badRequest('End date must be on or after start date', 'VALIDATION_ERROR', [{ path: 'endDate', message: 'End date must be on or after start date' }]);
  }
  if (merged.halfDay && merged.startDate !== merged.endDate) {
    throw badRequest('Half day leave must be a single day', 'VALIDATION_ERROR', [{ path: 'halfDay', message: 'Half day leave must be a single day' }]);
  }

  const [employee, type, org] = await Promise.all([loadEmployee(ctx, leave.employeeId), loadLeaveType(ctx, leaveTypeId), loadOrg(ctx)]);
  const onBehalf = !ctx.employeeId?.equals(leave.employeeId);
  const sameBalance =
    from === 'SUBMITTED' && leave.leaveTypeId.equals(type._id) && leave.startDate.getUTCFullYear() === Number(merged.startDate.slice(0, 4));
  const ev = await evaluate(ctx, org, employee, type, merged, { excludeId: leave._id, onBehalf, credit: sameBalance ? leave.days : 0 });
  throwFirstProblem(ev, from === 'DRAFT' ? DRAFT_TOLERATED : undefined);

  const previous: LedgerTarget = { _id: leave._id, employeeId: leave.employeeId, leaveTypeId: leave.leaveTypeId, startDate: leave.startDate, days: leave.days };
  const fields = {
    leaveTypeId: type._id,
    startDate: dateOnly(merged.startDate),
    endDate: dateOnly(merged.endDate),
    halfDay: merged.halfDay,
    halfDaySession: merged.halfDaySession,
    attachmentId: merged.attachmentId ? new Types.ObjectId(merged.attachmentId) : null,
    days: ev.days,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  };
  leave.set(fields);

  if (from === 'DRAFT') {
    await leave.save();
  } else {
    // Nobody has acted yet: rebuild the chain (the manager may have changed).
    initApproval(asApprovable(leave), org.chain, employee);
    const allowNegative = org.allowNegativeBalance || !type.paid;
    await withTransaction(async (session) => {
      await persistTransition(leave, 'SUBMITTED', fields, session);
      if (sameBalance) {
        const delta = round2(ev.days - previous.days);
        if (delta > 0) await ledger(ctx, previous, 'RESERVE', session, { days: delta, allowNegative });
        else if (delta < 0) await ledger(ctx, previous, 'RELEASE', session, { days: -delta });
      } else {
        await ledger(ctx, previous, 'RELEASE', session);
        await ledger(ctx, { ...previous, leaveTypeId: type._id, startDate: fields.startDate, days: ev.days }, 'RESERVE', session, { allowNegative });
      }
    });
  }
  return getLeave(ctx, id);
};

/** DRAFT → SUBMITTED: re-validates, starts the approval chain and reserves balance. */
export const submitLeave = async (ctx: RequestContext, id: string) => {
  const leave = await loadLeaveDoc(ctx, id);
  const from = statusOf(leave);
  if (!isOwner(ctx, leave)) {
    if (from === 'DRAFT') throw notFound('Leave request');
    return denyUnlessVisible(ctx, leave, 'Only the requester can submit this leave request');
  }
  if (!LEAVE_WORKFLOW.can(from, 'SUBMITTED')) throw invalidTransition('Leave request', from, 'SUBMITTED');

  const [employee, type, org] = await Promise.all([loadEmployee(ctx, leave.employeeId), loadLeaveType(ctx, leave.leaveTypeId), loadOrg(ctx)]);
  const onBehalf = !ctx.employeeId?.equals(leave.employeeId);
  const ev = await evaluate(
    ctx,
    org,
    employee,
    type,
    toDraft({
      startDate: toDateKey(leave.startDate),
      endDate: toDateKey(leave.endDate),
      halfDay: leave.halfDay,
      halfDaySession: leave.halfDaySession as HalfDaySession | null,
      attachmentId: leave.attachmentId ? String(leave.attachmentId) : null,
    }),
    { excludeId: leave._id, onBehalf },
  );
  throwFirstProblem(ev);

  initApproval(asApprovable(leave), org.chain, employee);
  leave.days = ev.days;
  const submittedAt = new Date();
  await withTransaction(async (session) => {
    await persistTransition(leave, 'DRAFT', { status: 'SUBMITTED', submittedAt, days: ev.days }, session);
    await ledger(ctx, leave, 'RESERVE', session, { allowNegative: org.allowNegativeBalance || !type.paid });
  });
  leave.status = 'SUBMITTED';

  await auditLeave(ctx, 'LEAVE_SUBMITTED', leave, employee, type.name, { status: 'DRAFT' }, { status: 'SUBMITTED', days: ev.days });
  await informHr(ctx, leave, employee, type.name, await notifyApprovers(ctx, leave, employee, type.name));
  return getLeave(ctx, id);
};

/**
 * Approves the current step. Intermediate approvals move the request to
 * PENDING_APPROVAL and notify the next approvers; the final approval marks it
 * APPROVED and converts the reservation into used days in one transaction.
 */
export const approveLeave = async (ctx: RequestContext, id: string, comment?: string) => {
  const leave = await loadLeaveDoc(ctx, id);
  const from = statusOf(leave);
  if (!LEAVE_WORKFLOW.can(from, 'APPROVED')) throw invalidTransition('Leave request', from, 'APPROVED');
  const employee = await loadEmployee(ctx, leave.employeeId);
  const typeName = await typeNameOf(ctx, leave.leaveTypeId);

  const outcome = await applyDecision(ctx, asApprovable(leave), employee, LEAVE_APPROVAL_POLICY, 'APPROVE', comment);
  if (outcome === 'PENDING') {
    if (from !== 'PENDING_APPROVAL' && !LEAVE_WORKFLOW.can(from, 'PENDING_APPROVAL')) {
      throw invalidTransition('Leave request', from, 'PENDING_APPROVAL');
    }
    await persistTransition(leave, from, { status: 'PENDING_APPROVAL' }, undefined);
    await auditLeave(ctx, 'LEAVE_APPROVED', leave, employee, typeName, { status: from }, {
      status: 'PENDING_APPROVAL',
      stage: 'INTERMEDIATE',
      nextApprover: leave.currentApproverType,
      comment,
    });
    await notifyApprovers(ctx, leave, employee, typeName);
    return getLeave(ctx, id);
  }

  const decidedAt = new Date();
  await withTransaction(async (session) => {
    await persistTransition(leave, from, { status: 'APPROVED', decidedAt }, session);
    await ledger(ctx, leave, 'CONSUME', session, { reason: 'Leave approved' });
  });
  await auditLeave(ctx, 'LEAVE_APPROVED', leave, employee, typeName, { status: from }, { status: 'APPROVED', comment });
  await notifyEmployee(ctx, leave, employee, 'LEAVE_APPROVED', 'Leave approved', `Your ${describe({ name: typeName }, leave)} was approved by ${ctx.userName}`);
  return getLeave(ctx, id);
};

/** Rejects at the current step: REJECTED and the reservation is released. */
export const rejectLeave = async (ctx: RequestContext, id: string, reason: string) => {
  const leave = await loadLeaveDoc(ctx, id);
  const from = statusOf(leave);
  if (!LEAVE_WORKFLOW.can(from, 'REJECTED')) throw invalidTransition('Leave request', from, 'REJECTED');
  const employee = await loadEmployee(ctx, leave.employeeId);
  const typeName = await typeNameOf(ctx, leave.leaveTypeId);

  await applyDecision(ctx, asApprovable(leave), employee, LEAVE_APPROVAL_POLICY, 'REJECT', reason);
  const decidedAt = new Date();
  await withTransaction(async (session) => {
    await persistTransition(leave, from, { status: 'REJECTED', rejectionReason: reason, decidedAt }, session);
    await ledger(ctx, leave, 'RELEASE', session);
  });
  await auditLeave(ctx, 'LEAVE_REJECTED', leave, employee, typeName, { status: from }, { status: 'REJECTED', reason });
  await notifyEmployee(ctx, leave, employee, 'LEAVE_REJECTED', 'Leave rejected', `Your ${describe({ name: typeName }, leave)} was rejected: ${reason}`);
  return getLeave(ctx, id);
};

/**
 * Cancellation rules:
 *  - The requester (employee or whoever applied on their behalf) may cancel a
 *    DRAFT, a pending request, or an APPROVED leave that has not started yet.
 *  - HR (`leave:update`) may cancel any non-final request, including approved
 *    leave that has started or passed.
 *  - Pending → reservation released; approved → used days restored and any
 *    system-generated LEAVE attendance rows in the range are removed so the
 *    attendance job recomputes those days.
 */
export const cancelLeave = async (ctx: RequestContext, id: string, reason?: string) => {
  const leave = await loadLeaveDoc(ctx, id);
  const from = statusOf(leave);
  const owner = isOwner(ctx, leave);
  const hr = can(ctx, 'leave:update');
  if (!owner && !hr) {
    if (from === 'DRAFT') throw notFound('Leave request');
    return denyUnlessVisible(ctx, leave, 'Only the requester or HR can cancel this leave request');
  }
  if (!owner && from === 'DRAFT') throw notFound('Leave request');
  if (!LEAVE_WORKFLOW.can(from, 'CANCELLED')) throw invalidTransition('Leave request', from, 'CANCELLED');

  const org = await loadOrg(ctx);
  if (from === 'APPROVED' && !hr && toDateKey(leave.startDate) <= todayKey(org.timezone)) {
    throw unprocessable('Approved leave that has already started can only be cancelled by HR', 'LEAVE_ALREADY_STARTED');
  }
  const employee = await loadEmployee(ctx, leave.employeeId);
  const typeName = await typeNameOf(ctx, leave.leaveTypeId);

  closeApproval(asApprovable(leave));
  const cancelledAt = new Date();
  await withTransaction(async (session) => {
    await persistTransition(leave, from, { status: 'CANCELLED', cancellationReason: reason ?? null, cancelledAt, cancelledBy: ctx.userId }, session);
    if (PENDING.includes(from)) await ledger(ctx, leave, 'RELEASE', session);
    if (from === 'APPROVED') {
      await ledger(ctx, leave, 'RESTORE', session, { reason: reason ? `Cancelled: ${reason}` : 'Leave cancelled' });
      await AttendanceModel.deleteMany(
        { organizationId: ctx.organizationId, employeeId: leave.employeeId, date: { $gte: leave.startDate, $lte: leave.endDate }, status: 'LEAVE', source: 'SYSTEM' },
        { session },
      );
    }
  });

  if (from !== 'DRAFT') {
    await auditLeave(ctx, 'LEAVE_CANCELLED', leave, employee, typeName, { status: from }, { status: 'CANCELLED', reason });
    if (!ctx.employeeId?.equals(employee._id)) {
      await notifyEmployee(ctx, leave, employee, 'GENERAL', 'Leave cancelled', `Your ${describe({ name: typeName }, leave)} was cancelled by ${ctx.userName}${reason ? `: ${reason}` : ''}`);
    } else if (from === 'APPROVED') {
      await notify({
        organizationId: ctx.organizationId,
        userIds: [await managerUserId(ctx.organizationId, employee.managerId)],
        type: 'GENERAL',
        title: 'Approved leave cancelled',
        message: `${employeeName(employee)} cancelled ${describe({ name: typeName }, leave)}`,
        link: `/leave/requests/${leave._id}`,
        entityType: 'LeaveRequest',
        entityId: leave._id,
        excludeUserId: ctx.userId,
      });
    }
  }
  return getLeave(ctx, id);
};

/** Computes days/balance impact for a prospective request without saving (UI preview). */
export const previewLeave = async (ctx: RequestContext, input: LeavePreviewInput) => {
  const { employee, onBehalf } = await resolveApplicant(ctx, input.employeeId);
  const type = await loadLeaveType(ctx, input.leaveTypeId);
  const org = await loadOrg(ctx);
  // When previewing an edit, the request itself is not an overlap and (if still
  // pending) its own days are credited back, mirroring `updateLeave`.
  let excludeId: Types.ObjectId | undefined;
  let credit = 0;
  if (input.excludeId) {
    const own = await LeaveRequestModel.findOne({ _id: input.excludeId, organizationId: ctx.organizationId, employeeId: employee._id })
      .select('status leaveTypeId startDate days')
      .lean();
    if (!own) throw notFound('Leave request');
    excludeId = own._id;
    const sameBalance =
      statusOf(own) === 'SUBMITTED' && own.leaveTypeId.equals(type._id) && own.startDate.getUTCFullYear() === Number(input.startDate.slice(0, 4));
    if (sameBalance) credit = own.days ?? 0;
  }
  const ev = await evaluate(ctx, org, employee, type, toDraft(input), { onBehalf, excludeId, credit });
  return {
    days: ev.days,
    workingDates: ev.workingDates,
    holidays: ev.holidays,
    weekOffs: ev.weekOffs,
    balance: ev.balance,
    balanceAfter: ev.balanceAfter,
    unlimited: ev.unlimited,
    warnings: ev.problems.map((p) => ({ code: p.code, message: p.message })),
  };
};

/* ------------------------------- Balances ------------------------------ */

/** Balances for self (default) or, with `leave:read` / as their manager (`team:view`), another employee. */
export const getBalances = async (ctx: RequestContext, q: LeaveBalanceQuery) => {
  const employeeId = q.employeeId ? new Types.ObjectId(q.employeeId) : ctx.employeeId;
  if (!employeeId) throw badRequest('Your account is not linked to an employee profile', 'NO_EMPLOYEE_PROFILE');
  if (!ctx.employeeId?.equals(employeeId)) {
    await loadEmployee(ctx, employeeId);
    await assertEmployeeAccess(ctx, employeeId, 'leave:read');
  }
  const org = await loadOrg(ctx);
  const year = q.year ?? Number(todayKey(org.timezone).slice(0, 4));
  return listBalances(ctx.organizationId, employeeId, year);
};

export const adjustLeaveBalance = (ctx: RequestContext, input: LeaveBalanceAdjustInput) => adjustBalance(ctx, input);

export const runCarryForward = async (ctx: RequestContext, fromYear: number) => {
  const org = await loadOrg(ctx);
  const currentYear = Number(todayKey(org.timezone).slice(0, 4));
  if (fromYear >= currentYear) throw unprocessable('Carry forward can only be run for a completed leave year', 'YEAR_NOT_CLOSED');
  const result = await carryForward(ctx.organizationId, fromYear, ctx.userId);
  await audit(ctx, {
    action: 'LEAVE_BALANCE_ADJUSTED',
    module: 'leave',
    recordLabel: `Carry forward ${fromYear} → ${fromYear + 1}`,
    newValues: { fromYear, processed: result.processed },
  });
  return { fromYear, toYear: fromYear + 1, ...result };
};

/* ------------------------------- Calendar ------------------------------ */

/**
 * Leave calendar for a date range (max 62 days) plus holidays.
 * Visibility:
 *  - `leave:read`            → everyone's approved + pending leave (full details)
 *  - `team:view` (managers)  → own + reports' leave (full details)
 *  - everyone else           → own leave (full) + department colleagues'
 *                              APPROVED leave with minimal fields only
 *                              (no leave type, reason or attachments).
 */
export const leaveCalendar = async (ctx: RequestContext, q: LeaveCalendarQuery) => {
  if (q.to < q.from) throw badRequest('End date must be on or after start date', 'VALIDATION_ERROR');
  if (daysBetween(q.from, q.to) + 1 > MAX_CALENDAR_DAYS) throw badRequest(`The calendar range cannot exceed ${MAX_CALENDAR_DAYS} days`, 'RANGE_TOO_LARGE');

  const base = {
    organizationId: ctx.organizationId,
    startDate: { $lte: dateOnly(q.to) },
    endDate: { $gte: dateOnly(q.from) },
  };
  const deptIds = q.departmentId
    ? (await EmployeeModel.find({ organizationId: ctx.organizationId, departmentId: q.departmentId, deletedAt: null }).select('_id').lean()).map((e) => e._id)
    : null;
  const scope = await resolveEmployeeScope(ctx, 'leave:read');
  let ids = scope.employeeIds;
  if (deptIds) {
    const inDept = new Set(deptIds.map(String));
    ids = ids === null ? deptIds : ids.filter((id) => inDept.has(String(id)));
  }

  const leaves = await LeaveRequestModel.find({
    ...base,
    status: { $in: ['APPROVED', 'SUBMITTED', 'PENDING_APPROVAL'] },
    ...(ids !== null ? { employeeId: { $in: ids } } : {}),
  })
    .select('employeeId leaveTypeId startDate endDate halfDay halfDaySession days status reason')
    .populate(POPULATE)
    .sort({ startDate: 1 })
    .limit(2000)
    .lean();

  const me = ctx.employeeId
    ? await EmployeeModel.findOne({ _id: ctx.employeeId, organizationId: ctx.organizationId }).select('departmentId locationId').lean()
    : null;

  let colleagues: Record<string, unknown>[] = [];
  if (scope.scope === 'self' && me?.departmentId && (!q.departmentId || me.departmentId.equals(q.departmentId))) {
    const peers = await EmployeeModel.find({ organizationId: ctx.organizationId, departmentId: me.departmentId, deletedAt: null, _id: { $ne: me._id } })
      .select('_id')
      .lean();
    if (peers.length) {
      const rows = await LeaveRequestModel.find({ ...base, status: 'APPROVED', employeeId: { $in: peers.map((p) => p._id) } })
        .select('employeeId startDate endDate halfDay halfDaySession status')
        .populate({ path: 'employeeId', select: 'employeeId firstName lastName profilePhoto' })
        .sort({ startDate: 1 })
        .limit(2000)
        .lean();
      colleagues = rows.map((r) => ({ ...r, restricted: true }));
    }
  }

  // Holidays: the viewer's own location for personal views; for team/org views,
  // every location of the employees shown, labelled with where they apply.
  type HolidayOut = { date: string; name: string; type: string; optional: boolean; locations: string[] };
  const orgWide = await holidaysInRange(ctx.organizationId, q.from, q.to, null);
  const out = new Map<string, HolidayOut>();
  for (const [date, h] of orgWide) out.set(`${date}|${h.name}`, { date, name: h.name, type: h.type, optional: h.optional, locations: [] });
  const locationIds =
    scope.scope === 'self'
      ? me?.locationId
        ? [me.locationId]
        : []
      : ((await EmployeeModel.distinct('locationId', {
          organizationId: ctx.organizationId,
          deletedAt: null,
          locationId: { $ne: null },
          ...(ids !== null ? { _id: { $in: ids } } : {}),
        })) as Types.ObjectId[]);
  if (locationIds.length) {
    const names = new Map(
      (await LocationModel.find({ organizationId: ctx.organizationId, _id: { $in: locationIds } }).select('name').lean()).map((l) => [String(l._id), l.name]),
    );
    for (const locationId of locationIds) {
      const atLocation = await holidaysInRange(ctx.organizationId, q.from, q.to, locationId);
      for (const [date, h] of atLocation) {
        const key = `${date}|${h.name}`;
        if (orgWide.has(date) && orgWide.get(date)!.name === h.name) continue;
        const entry = out.get(key) ?? { date, name: h.name, type: h.type, optional: h.optional, locations: [] };
        entry.locations.push(names.get(String(locationId)) ?? 'Location');
        out.set(key, entry);
      }
    }
  }
  return {
    from: q.from,
    to: q.to,
    leaves: [...leaves.map((l) => ({ ...l, restricted: false })), ...colleagues],
    // `locations` empty = applies everywhere.
    holidays: [...out.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)),
  };
};

/* --------------------------------- Jobs -------------------------------- */

/**
 * Scheduled leave jobs (the lead wires this into job registration):
 *  - `leave.monthly-accrual`: 1st of every month, refreshes MONTHLY accruals
 *    (and lazily creates the year's balances) for every active organization.
 *  - `leave.year-end-carry-forward`: Jan 1, carries unused days of the previous
 *    year into the new year's balances (creating them lazily).
 */
export const registerLeaveJobs = () => {
  const activeOrgs = () => OrganizationModel.find({ status: 'ACTIVE' }).select('_id').lean();
  defineScheduledJob({
    name: 'leave.monthly-accrual',
    schedule: '15 0 1 * *',
    handler: async () => {
      const year = new Date().getUTCFullYear();
      for (const org of await activeOrgs()) {
        try {
          await refreshMonthlyAccruals(org._id, year);
        } catch (err) {
          logger.error({ err, organizationId: org._id }, 'Monthly leave accrual failed');
        }
      }
    },
  });
  defineScheduledJob({
    name: 'leave.year-end-carry-forward',
    schedule: '30 0 1 1 *',
    handler: async () => {
      const fromYear = new Date().getUTCFullYear() - 1;
      for (const org of await activeOrgs()) {
        try {
          await carryForward(org._id, fromYear);
        } catch (err) {
          logger.error({ err, organizationId: org._id }, 'Leave carry forward failed');
        }
      }
    },
  });
};
