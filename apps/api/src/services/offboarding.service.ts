import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import type { z } from 'zod';
import {
  OFFBOARDING_STEPS,
  OFFBOARDING_WORKFLOW,
  type OffboardingStatus,
  type PaginationQuery,
  type offboardingAdvanceSchema,
  type offboardingCreateSchema,
} from '@stencil/shared';
import {
  EmployeeHistoryModel,
  EmployeeModel,
  OffboardingModel,
  PayrollModel,
  PayslipModel,
  UserModel,
  type Offboarding,
} from '../models';
import { can, type RequestContext } from '../types/context';
import { dateOnly, toDateKey } from '../utils/dates';
import { badRequest, conflict, forbidden, invalidTransition, notFound, unprocessable } from '../utils/errors';
import { buildSort, escapeRegex, paginate } from '../utils/pagination';
import { withTransaction } from '../utils/transaction';
import { activeAssignmentsFor } from './asset.service';
import { audit } from './audit.service';
import { revokeAllSessions } from './auth.service';
import { managerUserId, notify, userIdsForEmployees, userIdsWithPermission } from './notification.service';
import { applyScope, assertEmployeeAccess, resolveEmployeeScope } from './scope.service';

type CreateInput = z.output<typeof offboardingCreateSchema>;
type AdvanceInput = z.output<typeof offboardingAdvanceSchema>;
type ListQuery = PaginationQuery & { scope?: 'me' | 'team' | 'all'; status?: string; exitType?: string; employeeId?: string };

const ACTIVE_STATUSES: OffboardingStatus[] = OFFBOARDING_STEPS.filter((s) => s !== 'COMPLETED');
const DEFAULT_CLEARANCE = ['IT', 'Finance', 'Admin', 'HR', 'Manager'];
const EMPLOYEE_POPULATE = {
  path: 'employeeId',
  select: 'employeeId firstName lastName profilePhoto workEmail departmentId designationId managerId employmentStatus joiningDate exitDate',
  populate: [
    { path: 'departmentId', select: 'name' },
    { path: 'designationId', select: 'name' },
  ],
};

const statusHistory = (
  ctx: RequestContext,
  employeeId: Types.ObjectId,
  from: string,
  to: string,
  effectiveDate: Date,
  reason: string,
  session?: ClientSession,
) =>
  EmployeeHistoryModel.create(
    [
      {
        organizationId: ctx.organizationId,
        employeeId,
        field: 'status',
        oldValue: from,
        newValue: to,
        oldLabel: from,
        newLabel: to,
        effectiveDate,
        reason,
        changedBy: ctx.userId,
      },
    ],
    { session },
  );

const hrUserIds = (ctx: RequestContext) => userIdsWithPermission(ctx.organizationId, 'offboarding:manage');

const employeeName = (e: { firstName: string; lastName: string; employeeId: string }) => `${e.firstName} ${e.lastName} (${e.employeeId})`;

/* ------------------------------- Queries ------------------------------ */

export const listOffboardings = async (ctx: RequestContext, q: ListQuery) => {
  const scope = await resolveEmployeeScope(ctx, 'offboarding:manage', q.scope);
  const filter: FilterQuery<Offboarding> = { organizationId: ctx.organizationId };
  if (q.status) filter.status = q.status === 'ACTIVE' ? { $in: ACTIVE_STATUSES } : q.status;
  if (q.exitType) filter.exitType = q.exitType;
  if (q.search) {
    const re = new RegExp(escapeRegex(q.search), 'i');
    const matches = await EmployeeModel.find({ organizationId: ctx.organizationId, $or: [{ firstName: re }, { lastName: re }, { employeeId: re }] })
      .select('_id')
      .lean();
    filter.$and = [{ employeeId: { $in: matches.map((m) => m._id) } }];
  }
  const scoped = applyScope(filter, scope);
  if (q.employeeId) {
    const id = new Types.ObjectId(q.employeeId);
    if (scope.employeeIds !== null && !scope.employeeIds.some((e) => e.equals(id))) throw forbidden('You do not have access to this record');
    scoped.employeeId = id;
  }
  return paginate(OffboardingModel, {
    filter: scoped,
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['lastWorkingDate', 'requestDate', 'createdAt', 'status'], { createdAt: -1 }),
    populate: [EMPLOYEE_POPULATE],
  });
};

export const getOffboarding = async (ctx: RequestContext, id: string) => {
  const doc = await OffboardingModel.findOne({ _id: id, organizationId: ctx.organizationId }).lean();
  if (!doc) throw notFound('Offboarding');
  await assertEmployeeAccess(ctx, doc.employeeId, 'offboarding:manage');
  const [full, assets] = await Promise.all([
    OffboardingModel.findById(doc._id)
      .populate([EMPLOYEE_POPULATE, { path: 'finalPayrollId', select: 'month year status periodStart periodEnd isOffCycle' }])
      .lean(),
    activeAssignmentsFor(ctx.organizationId, doc.employeeId),
  ]);
  const idx = OFFBOARDING_STEPS.indexOf(doc.status as OffboardingStatus);
  // Resolve actor names for the timeline and clearance entries.
  const actorIds = [...(doc.timeline ?? []).map((t) => t.by), ...(doc.clearance ?? []).map((c) => c.by)].filter(Boolean).map(String);
  const actors = actorIds.length
    ? await UserModel.find({ _id: { $in: [...new Set(actorIds)] }, organizationId: ctx.organizationId }).select('firstName lastName').lean()
    : [];
  const nameOf = new Map(actors.map((u) => [String(u._id), `${u.firstName} ${u.lastName}`]));
  return {
    ...full,
    timeline: (full?.timeline ?? []).map((t) => ({ ...t, byName: t.by ? (nameOf.get(String(t.by)) ?? null) : null })),
    clearance: (full?.clearance ?? []).map((c) => ({ ...c, byName: c.by ? (nameOf.get(String(c.by)) ?? null) : null })),
    assets,
    steps: OFFBOARDING_STEPS,
    nextStatus: idx >= 0 && idx < OFFBOARDING_STEPS.length - 1 ? OFFBOARDING_STEPS[idx + 1] : null,
    canCancel: OFFBOARDING_WORKFLOW.can(doc.status as OffboardingStatus, 'CANCELLED'),
  };
};

/* ------------------------------ Mutations ----------------------------- */

export const createOffboarding = async (ctx: RequestContext, input: CreateInput) => {
  const self = !!ctx.employeeId?.equals(input.employeeId);
  if (!can(ctx, 'offboarding:manage') && !(self && input.exitType === 'RESIGNATION')) {
    throw forbidden(self ? 'You can only submit a resignation' : 'You are not allowed to start offboarding');
  }
  if (input.lastWorkingDate < input.requestDate) {
    throw badRequest('Last working date cannot be before the request date', 'VALIDATION_ERROR', [
      { path: 'lastWorkingDate', message: 'Must be on or after the request date' },
    ]);
  }
  const employee = await EmployeeModel.findOne({ _id: input.employeeId, organizationId: ctx.organizationId, deletedAt: null });
  if (!employee) throw notFound('Employee');
  if (employee.employmentStatus === 'EXITED' || employee.employmentStatus === 'ARCHIVED') {
    throw unprocessable('This employee has already exited', 'EMPLOYEE_EXITED');
  }

  const doc = await withTransaction(async (session) => {
    const active = await OffboardingModel.exists({
      organizationId: ctx.organizationId,
      employeeId: employee._id,
      status: { $in: ACTIVE_STATUSES },
    }).session(session ?? null);
    if (active) throw conflict('This employee already has an offboarding in progress', 'OFFBOARDING_EXISTS');
    const previous = employee.employmentStatus;
    const now = new Date();
    const [doc] = await OffboardingModel.create(
      [
        {
          organizationId: ctx.organizationId,
          employeeId: employee._id,
          exitType: input.exitType,
          reason: input.reason,
          requestDate: dateOnly(input.requestDate),
          lastWorkingDate: dateOnly(input.lastWorkingDate),
          status: 'EXIT_REQUEST',
          previousEmploymentStatus: previous,
          clearance: DEFAULT_CLEARANCE.map((department) => ({ department, cleared: false })),
          timeline: [{ status: 'EXIT_REQUEST', note: input.reason, by: ctx.userId, at: now }],
          createdBy: ctx.userId,
        },
      ],
      { session },
    );
    if (previous !== 'NOTICE_PERIOD') {
      employee.employmentStatus = 'NOTICE_PERIOD';
      await employee.save({ session });
      await statusHistory(ctx, employee._id, previous, 'NOTICE_PERIOD', dateOnly(input.requestDate), `${input.exitType}: offboarding started`, session);
    }
    return doc!;
  });

  await audit(ctx, {
    action: 'OFFBOARDING_UPDATED',
    module: 'offboarding',
    recordId: doc._id,
    recordLabel: employeeName(employee),
    newValues: { status: 'EXIT_REQUEST', exitType: input.exitType, lastWorkingDate: input.lastWorkingDate },
  });
  await notify({
    organizationId: ctx.organizationId,
    userIds: [...(await hrUserIds(ctx)), await managerUserId(ctx.organizationId, employee.managerId), ...(self ? [] : [employee.userId])],
    type: 'OFFBOARDING',
    title: input.exitType === 'RESIGNATION' ? 'Resignation submitted' : 'Offboarding started',
    message: `${employeeName(employee)} — last working day ${input.lastWorkingDate}`,
    link: `/offboarding/${String(doc._id)}`,
    entityType: 'Offboarding',
    entityId: doc._id,
    excludeUserId: ctx.userId,
  });
  return getOffboarding(ctx, String(doc._id));
};

/** Resolves the final settlement payroll (explicit id, or an approved/paid run with a payslip for the employee). */
const resolveFinalPayroll = async (ctx: RequestContext, employeeId: Types.ObjectId, finalPayrollId?: string) => {
  if (finalPayrollId) {
    const run = await PayrollModel.findOne({ _id: finalPayrollId, organizationId: ctx.organizationId }).select('_id status').lean();
    if (!run) throw badRequest('Payroll run not found', 'INVALID_REFERENCE', [{ path: 'finalPayrollId', message: 'Payroll run not found' }]);
    if (run.status !== 'APPROVED' && run.status !== 'PAID') {
      throw unprocessable('The final payroll run must be approved or paid', 'FINAL_PAYROLL_NOT_APPROVED');
    }
    const included = await PayslipModel.exists({ organizationId: ctx.organizationId, payrollId: run._id, employeeId, status: { $ne: 'CANCELLED' } });
    if (!included) throw unprocessable('The selected payroll run has no payslip for this employee', 'FINAL_PAYROLL_MISSING_EMPLOYEE');
    return run._id;
  }
  const slips = await PayslipModel.find({ organizationId: ctx.organizationId, employeeId, status: { $ne: 'CANCELLED' } })
    .select('payrollId')
    .sort({ year: -1, month: -1 })
    .lean();
  if (!slips.length) return null;
  const run = await PayrollModel.findOne({
    organizationId: ctx.organizationId,
    _id: { $in: slips.map((s) => s.payrollId) },
    status: { $in: ['APPROVED', 'PAID'] },
  })
    .sort({ periodEnd: -1 })
    .select('_id')
    .lean();
  return run?._id ?? null;
};

export const advanceOffboarding = async (ctx: RequestContext, id: string, input: AdvanceInput) => {
  const doc = await OffboardingModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!doc) throw notFound('Offboarding');
  if (ctx.employeeId?.equals(doc.employeeId)) throw forbidden('You cannot process your own offboarding');
  const employee = await EmployeeModel.findOne({ _id: doc.employeeId, organizationId: ctx.organizationId });
  if (!employee) throw notFound('Employee');

  const from = doc.status as OffboardingStatus;
  const idx = OFFBOARDING_STEPS.indexOf(from);
  const to = idx >= 0 ? OFFBOARDING_STEPS[idx + 1] : undefined;
  if (!to || !OFFBOARDING_WORKFLOW.can(from, to)) throw invalidTransition('Offboarding', from, to ?? 'COMPLETED');

  const now = new Date();
  // Clearance updates may be recorded at any step (merged by department).
  if (input.clearance?.length) {
    for (const item of input.clearance) {
      const existing = doc.clearance.find((c) => c.department?.toLowerCase() === item.department.toLowerCase());
      if (existing) {
        if (existing.cleared !== item.cleared) {
          existing.by = ctx.userId;
          existing.at = now;
        }
        existing.cleared = item.cleared;
        if (item.note !== undefined) existing.note = item.note;
      } else {
        doc.clearance.push({ department: item.department, cleared: item.cleared, note: item.note, by: ctx.userId, at: now });
      }
    }
  }
  if (input.exitInterview) {
    doc.exitInterview = { ...input.exitInterview, conductedAt: now };
  }

  // Gate checks for leaving the current step.
  if (from === 'ASSET_RETURN') {
    const open = await activeAssignmentsFor(ctx.organizationId, doc.employeeId);
    if (open.length) {
      const names = open
        .map((a) => a.assetId as unknown as { assetTag?: string; name?: string } | null)
        .map((a) => (a ? `${a.assetTag} ${a.name}` : 'unknown asset'))
        .join(', ');
      throw unprocessable(`All assigned assets must be returned first: ${names}`, 'ASSETS_NOT_RETURNED');
    }
    doc.assetsReturned = true;
  }
  if (from === 'CLEARANCE') {
    const pending = doc.clearance.filter((c) => !c.cleared).map((c) => c.department);
    if (pending.length) {
      // Keep partial clearance progress even though the step cannot be completed yet.
      if (input.clearance?.length || input.exitInterview) await doc.save();
      throw unprocessable(`Clearance pending from: ${pending.join(', ')}`, 'CLEARANCE_PENDING');
    }
  }
  if (from === 'FINAL_PAYROLL') {
    const runId = await resolveFinalPayroll(ctx, doc.employeeId, input.finalPayrollId);
    if (!runId) throw unprocessable('Process the final payroll (approved or paid) before continuing', 'FINAL_PAYROLL_PENDING');
    doc.finalPayrollId = runId;
  } else if (input.finalPayrollId) {
    const runId = await resolveFinalPayroll(ctx, doc.employeeId, input.finalPayrollId);
    if (runId) doc.finalPayrollId = runId;
  }
  if (to === 'COMPLETED') {
    const reports = await EmployeeModel.countDocuments({
      organizationId: ctx.organizationId,
      managerId: employee._id,
      deletedAt: null,
      employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] },
    });
    if (reports) throw unprocessable(`Reassign ${reports} direct report(s) before completing the exit`, 'HAS_REPORTS');
  }

  doc.status = to;
  doc.timeline.push({ status: to, note: input.note, by: ctx.userId, at: now });
  const previousEmployment = employee.employmentStatus;
  await withTransaction(async (session) => {
    if (to === 'COMPLETED') {
      doc.completedAt = now;
      employee.employmentStatus = 'EXITED';
      employee.exitDate = doc.lastWorkingDate;
      await employee.save({ session });
      await statusHistory(ctx, employee._id, previousEmployment, 'EXITED', doc.lastWorkingDate, `Offboarding completed (${doc.exitType})`, session);
      if (employee.userId) await UserModel.updateOne({ _id: employee.userId, organizationId: ctx.organizationId }, { status: 'INACTIVE' }, { session });
    }
    await doc.save({ session });
  });

  if (to === 'COMPLETED' && employee.userId) await revokeAllSessions(employee.userId);

  await audit(ctx, {
    action: 'OFFBOARDING_UPDATED',
    module: 'offboarding',
    recordId: doc._id,
    recordLabel: employeeName(employee),
    oldValues: { status: from },
    newValues: { status: to, note: input.note },
  });
  if (to === 'COMPLETED') {
    await audit(ctx, {
      action: 'EMPLOYEE_UPDATED',
      module: 'employees',
      recordId: employee._id,
      recordLabel: employeeName(employee),
      oldValues: { employmentStatus: previousEmployment, exitDate: null },
      newValues: { employmentStatus: 'EXITED', exitDate: toDateKey(doc.lastWorkingDate), userStatus: 'INACTIVE' },
    });
  }
  await notify({
    organizationId: ctx.organizationId,
    userIds: to === 'COMPLETED' ? await hrUserIds(ctx) : [...(await hrUserIds(ctx)), employee.userId],
    type: 'OFFBOARDING',
    title: to === 'COMPLETED' ? 'Offboarding completed' : 'Offboarding updated',
    message: `${employeeName(employee)} moved to ${to.replace(/_/g, ' ').toLowerCase()}${input.note ? `: ${input.note}` : ''}`,
    link: `/offboarding/${String(doc._id)}`,
    entityType: 'Offboarding',
    entityId: doc._id,
    excludeUserId: ctx.userId,
  });
  return getOffboarding(ctx, id);
};

export const cancelOffboarding = async (ctx: RequestContext, id: string, note?: string) => {
  const doc = await OffboardingModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!doc) throw notFound('Offboarding');
  const ownResignation = !!ctx.employeeId?.equals(doc.employeeId) && doc.exitType === 'RESIGNATION';
  if (!can(ctx, 'offboarding:manage') && !ownResignation) throw forbidden();
  const from = doc.status as OffboardingStatus;
  if (!OFFBOARDING_WORKFLOW.can(from, 'CANCELLED')) throw invalidTransition('Offboarding', from, 'CANCELLED');
  const employee = await EmployeeModel.findOne({ _id: doc.employeeId, organizationId: ctx.organizationId });
  if (!employee) throw notFound('Employee');

  const restore = (doc.previousEmploymentStatus as typeof employee.employmentStatus | undefined) ?? 'ACTIVE';
  const now = new Date();
  doc.status = 'CANCELLED';
  doc.timeline.push({ status: 'CANCELLED', note, by: ctx.userId, at: now });
  await withTransaction(async (session) => {
    await doc.save({ session });
    if (employee.employmentStatus === 'NOTICE_PERIOD' && restore !== 'NOTICE_PERIOD') {
      employee.employmentStatus = restore;
      await employee.save({ session });
      await statusHistory(ctx, employee._id, 'NOTICE_PERIOD', restore, now, 'Offboarding cancelled', session);
    }
  });
  await audit(ctx, {
    action: 'OFFBOARDING_UPDATED',
    module: 'offboarding',
    recordId: doc._id,
    recordLabel: employeeName(employee),
    oldValues: { status: from },
    newValues: { status: 'CANCELLED', note },
  });
  await notify({
    organizationId: ctx.organizationId,
    userIds: [...(await hrUserIds(ctx)), await managerUserId(ctx.organizationId, employee.managerId), ...(await userIdsForEmployees(ctx.organizationId, [employee._id]))],
    type: 'OFFBOARDING',
    title: 'Offboarding cancelled',
    message: `Offboarding of ${employeeName(employee)} was cancelled${note ? `: ${note}` : ''}`,
    link: `/offboarding/${String(doc._id)}`,
    entityType: 'Offboarding',
    entityId: doc._id,
    excludeUserId: ctx.userId,
  });
  return getOffboarding(ctx, id);
};
