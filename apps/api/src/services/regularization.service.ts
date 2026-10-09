import { Types, type FilterQuery } from 'mongoose';
import type { ApprovalStatus, PaginationQuery, RegularizationInput } from '@stencil/shared';
import { REGULARIZATION_WORKFLOW } from '@stencil/shared';
import { AttendanceCorrectionModel, AttendanceModel, EmployeeModel, type AttendanceCorrection } from '../models';
import type { RequestContext } from '../types/context';
import { addDaysKey, dateOnly, todayKey, toDateKey, zonedInstant } from '../utils/dates';
import { badRequest, conflict, forbidden, invalidTransition, notFound } from '../utils/errors';
import { buildPagination, buildSort, paginate } from '../utils/pagination';
import { withTransaction } from '../utils/transaction';
import {
  applyDecision,
  approvalQueueFilter,
  canActOnStep,
  closeApproval,
  initApproval,
  nextApproverLabel,
  type Approvable,
  type ApprovalPolicy,
} from './approval.service';
import { applyMetrics } from './attendance.service';
import { audit } from './audit.service';
import { managerUserId, notify, notifyHr, userIdsWithPermission } from './notification.service';
import { assertRefsInOrg } from './refs.service';
import { applyScope, assertEmployeeAccess, resolveEmployeeScope } from './scope.service';
import { loadOrgAttendanceConfig, resolveShift } from './shift.service';

export const REGULARIZATION_POLICY: ApprovalPolicy = { approvePermission: 'attendance:approve', hrPermission: 'attendance:read' };

const PENDING: ApprovalStatus[] = ['SUBMITTED', 'PENDING_APPROVAL'];
const ENTITY = 'Regularization request';
const LINK = '/attendance/regularizations';

const POPULATE = [
  { path: 'employeeId', select: 'employeeId firstName lastName profilePhoto departmentId managerId', populate: { path: 'departmentId', select: 'name' } },
  { path: 'attachmentId', select: 'name originalName mimeType size' },
];

interface EmployeeRef {
  _id: Types.ObjectId;
  managerId?: Types.ObjectId | null;
  userId?: Types.ObjectId | null;
  firstName: string;
  lastName: string;
}

const loadEmployee = async (organizationId: Types.ObjectId, id: Types.ObjectId): Promise<EmployeeRef> => {
  const emp = await EmployeeModel.findOne({ _id: id, organizationId }).select('_id managerId userId firstName lastName').lean();
  if (!emp) throw notFound('Employee');
  return emp;
};

type CorrectionDoc = InstanceType<typeof AttendanceCorrectionModel>;
const approvable = (doc: CorrectionDoc) => doc as unknown as Approvable;

/** Users who can act on the current step (manager, or HR approvers holding org-wide attendance access). */
const currentApproverUserIds = async (organizationId: Types.ObjectId, doc: CorrectionDoc, employee: EmployeeRef) => {
  let ids: Types.ObjectId[] = [];
  if (doc.currentApproverType === 'MANAGER') {
    const mgr = await managerUserId(organizationId, employee.managerId);
    ids = mgr ? [mgr] : [];
  } else if (doc.currentApproverType === 'HR') {
    const [approvers, hr] = await Promise.all([
      userIdsWithPermission(organizationId, 'attendance:approve'),
      userIdsWithPermission(organizationId, 'attendance:read'),
    ]);
    const hrSet = new Set(hr.map(String));
    ids = approvers.filter((u) => hrSet.has(String(u)));
  }
  return ids.filter((u) => !employee.userId || !u.equals(employee.userId));
};

const notifyApprovers = async (ctx: RequestContext, doc: CorrectionDoc, employee: EmployeeRef) => {
  const userIds = await currentApproverUserIds(ctx.organizationId, doc, employee);
  await notify({
    organizationId: ctx.organizationId,
    userIds,
    type: 'ATTENDANCE_CORRECTION',
    title: 'Attendance correction awaiting approval',
    message: `${employee.firstName} ${employee.lastName} requested an attendance correction for ${toDateKey(doc.date)} (${doc.requestedCheckIn}–${doc.requestedCheckOut}).`,
    link: `${LINK}/${String(doc._id)}`,
    entityType: 'AttendanceCorrection',
    entityId: doc._id,
    excludeUserId: ctx.userId,
  });
  return userIds;
};

/* ------------------------------- Submit ------------------------------- */

export const submitRegularization = async (ctx: RequestContext, input: RegularizationInput) => {
  if (!ctx.employeeId) throw badRequest('No employee profile is linked to your account', 'NO_EMPLOYEE_PROFILE');
  const cfg = await loadOrgAttendanceConfig(ctx.organizationId);
  const today = todayKey(cfg.timezone);
  if (input.date > today) throw badRequest('You cannot regularize a future date', 'FUTURE_DATE', [{ path: 'date', message: 'Date cannot be in the future' }]);
  const checkOutDay = input.requestedCheckOut < input.requestedCheckIn ? addDaysKey(input.date, 1) : input.date;
  if (zonedInstant(checkOutDay, input.requestedCheckOut, cfg.timezone).getTime() > Date.now()) {
    throw badRequest('Requested check-out is in the future', 'FUTURE_TIME', [{ path: 'requestedCheckOut', message: 'Cannot be in the future' }]);
  }
  await assertRefsInOrg(ctx.organizationId, { attachmentId: input.attachmentId }, ['attachmentId']);
  const employee = await loadEmployee(ctx.organizationId, ctx.employeeId);
  const date = dateOnly(input.date);
  if (await AttendanceCorrectionModel.exists({ organizationId: ctx.organizationId, employeeId: employee._id, date, status: { $in: PENDING } })) {
    throw conflict('A pending correction already exists for this date', 'DUPLICATE_REQUEST');
  }
  const existing = await AttendanceModel.findOne({ organizationId: ctx.organizationId, employeeId: employee._id, date }).select('checkIn checkOut').lean();

  const doc = new AttendanceCorrectionModel({
    organizationId: ctx.organizationId,
    employeeId: employee._id,
    date,
    requestedCheckIn: input.requestedCheckIn,
    requestedCheckOut: input.requestedCheckOut,
    originalCheckIn: existing?.checkIn ?? null,
    originalCheckOut: existing?.checkOut ?? null,
    reason: input.reason,
    attachmentId: input.attachmentId ?? null,
    status: 'SUBMITTED',
    requestedBy: ctx.userId,
    submittedAt: new Date(),
  });
  initApproval(approvable(doc), cfg.regularizationChain, employee);
  await doc.save();
  const approvers = await notifyApprovers(ctx, doc, employee);
  // HR hears about every new request too (in-app), beyond whoever approves it.
  await notifyHr({
    organizationId: ctx.organizationId,
    alreadyNotified: [...approvers, employee.userId],
    type: 'ATTENDANCE_CORRECTION',
    title: `New regularization request · ${employee.firstName} ${employee.lastName}`.trim(),
    message: `For ${toDateKey(doc.date)} (${doc.requestedCheckIn}–${doc.requestedCheckOut}): ${doc.reason}`,
    link: `${LINK}/${String(doc._id)}`,
    entityType: 'AttendanceCorrection',
    entityId: doc._id,
    excludeUserId: ctx.userId,
  });
  return getRegularization(ctx, String(doc._id));
};

/* ------------------------------- Queries ------------------------------ */

type ListQuery = PaginationQuery & { status?: string; employeeId?: string; scope?: string };

export const listRegularizations = async (ctx: RequestContext, q: ListQuery) => {
  let filter: FilterQuery<AttendanceCorrection> = { organizationId: ctx.organizationId };
  if (q.scope === 'approvals') {
    const queue = await approvalQueueFilter(ctx, REGULARIZATION_POLICY);
    if (!queue) return { items: [], pagination: buildPagination(q.page, q.limit, 0) };
    filter = { ...filter, ...queue, status: q.status ?? { $in: PENDING } };
    if (q.employeeId) filter.employeeId = new Types.ObjectId(q.employeeId);
  } else if (q.scope === 'reviewed') {
    // The approver's record: every request they approved or rejected at their step, whatever happened next.
    filter = { ...filter, approvalSteps: { $elemMatch: { actedBy: ctx.userId, status: { $in: ['APPROVED', 'REJECTED'] } } } };
    if (q.status) filter.status = q.status;
    if (q.employeeId) filter.employeeId = new Types.ObjectId(q.employeeId);
  } else {
    const scope = await resolveEmployeeScope(ctx, 'attendance:read', q.scope);
    if (q.status) filter.status = q.status;
    if (q.employeeId) {
      await assertEmployeeAccess(ctx, q.employeeId, 'attendance:read');
      filter.employeeId = new Types.ObjectId(q.employeeId);
    } else {
      filter = applyScope(filter, scope);
    }
  }
  return paginate(AttendanceCorrectionModel, {
    filter,
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['date', 'createdAt', 'status'], { createdAt: -1 }),
    populate: POPULATE,
  });
};

export const getRegularization = async (ctx: RequestContext, id: string) => {
  const doc = await AttendanceCorrectionModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!doc) throw notFound(ENTITY);
  const employee = await loadEmployee(ctx.organizationId, doc.employeeId);
  const step = approvable(doc).approvalSteps[doc.currentStep];
  const canAct =
    PENDING.includes(doc.status as ApprovalStatus) && step?.status === 'PENDING'
      ? await canActOnStep(ctx, step, employee, REGULARIZATION_POLICY, 'APPROVE')
      : false;
  if (!canAct) await assertEmployeeAccess(ctx, doc.employeeId, 'attendance:read');
  const populated = await AttendanceCorrectionModel.findById(doc._id).populate(POPULATE).lean();
  return { ...populated, canAct, canCancel: !!ctx.employeeId?.equals(doc.employeeId) && PENDING.includes(doc.status as ApprovalStatus) };
};

/* ------------------------------ Decisions ----------------------------- */

const loadForDecision = async (ctx: RequestContext, id: string, target: ApprovalStatus) => {
  const doc = await AttendanceCorrectionModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!doc) throw notFound(ENTITY);
  const status = doc.status as ApprovalStatus;
  if (!PENDING.includes(status) || !REGULARIZATION_WORKFLOW.can(status, target)) throw invalidTransition(ENTITY, status, target);
  const employee = await loadEmployee(ctx.organizationId, doc.employeeId);
  return { doc, employee };
};

export const approveRegularization = async (ctx: RequestContext, id: string, input: { comment?: string }) => {
  const { doc, employee } = await loadForDecision(ctx, id, 'APPROVED');
  const outcome = await applyDecision(ctx, approvable(doc), employee, REGULARIZATION_POLICY, 'APPROVE', input.comment);

  if (outcome === 'PENDING') {
    if (doc.status !== 'PENDING_APPROVAL') {
      if (!REGULARIZATION_WORKFLOW.can(doc.status as ApprovalStatus, 'PENDING_APPROVAL')) throw invalidTransition(ENTITY, doc.status, 'PENDING_APPROVAL');
      doc.status = 'PENDING_APPROVAL';
    }
    await doc.save();
    await notifyApprovers(ctx, doc, employee);
    // The employee hears about each approval, not only the last one.
    await notify({
      organizationId: ctx.organizationId,
      userIds: [employee.userId],
      type: 'ATTENDANCE_CORRECTION',
      title: `Attendance correction approved by ${ctx.userName}`,
      message: `Your attendance correction for ${toDateKey(doc.date)} was approved by ${ctx.userName} and is now waiting for approval from ${nextApproverLabel(doc.currentApproverType)}.`,
      link: `${LINK}/${id}`,
      entityType: 'AttendanceCorrection',
      entityId: doc._id,
      excludeUserId: ctx.userId,
    });
    return getRegularization(ctx, id);
  }

  const cfg = await loadOrgAttendanceConfig(ctx.organizationId);
  const dateKey = toDateKey(doc.date);
  const checkIn = zonedInstant(dateKey, doc.requestedCheckIn, cfg.timezone);
  // Overnight corrections end on the following calendar day.
  const checkOutDay = doc.requestedCheckOut < doc.requestedCheckIn ? addDaysKey(dateKey, 1) : dateKey;
  const checkOut = zonedInstant(checkOutDay, doc.requestedCheckOut, cfg.timezone);
  const attendanceId = await withTransaction(async (session) => {
    const empShift = await EmployeeModel.findOne({ _id: employee._id, organizationId: ctx.organizationId }).select('_id shiftId').session(session ?? null).lean();
    const shift = await resolveShift(ctx.organizationId, empShift ?? { _id: employee._id }, dateKey, cfg.attendance, session);
    const att =
      (await AttendanceModel.findOne({ organizationId: ctx.organizationId, employeeId: employee._id, date: doc.date }).session(session ?? null)) ??
      new AttendanceModel({ organizationId: ctx.organizationId, employeeId: employee._id, date: doc.date, workMode: 'OFFICE' });
    doc.originalCheckIn = att.checkIn ?? null;
    doc.originalCheckOut = att.checkOut ?? null;
    const keptBreaks = att.breaks
      .filter((b) => b.start >= checkIn && b.end && b.end <= checkOut)
      .map((b) => ({ start: b.start, end: b.end ?? null }));
    att.set({
      checkIn,
      checkOut,
      breaks: keptBreaks,
      regularized: true,
      source: 'REGULARIZATION',
      note: `Regularized: ${doc.reason}`.slice(0, 1000),
    });
    applyMetrics(att, shift, cfg);
    await att.save({ session });
    doc.status = 'APPROVED';
    doc.decidedAt = new Date();
    await doc.save({ session });
    return att._id;
  });

  await audit(ctx, {
    action: 'ATTENDANCE_REGULARIZED',
    module: 'attendance',
    recordId: attendanceId,
    recordLabel: `${employee.firstName} ${employee.lastName} — ${dateKey}`,
    oldValues: { checkIn: doc.originalCheckIn, checkOut: doc.originalCheckOut },
    newValues: { checkIn, checkOut, regularizationId: doc._id },
  });
  await notify({
    organizationId: ctx.organizationId,
    userIds: [employee.userId],
    type: 'ATTENDANCE_CORRECTION',
    title: 'Attendance correction approved',
    message: `Your attendance correction for ${dateKey} was approved by ${ctx.userName}.`,
    link: `${LINK}/${id}`,
    entityType: 'AttendanceCorrection',
    entityId: doc._id,
    excludeUserId: ctx.userId,
  });
  return getRegularization(ctx, id);
};

export const rejectRegularization = async (ctx: RequestContext, id: string, input: { reason: string }) => {
  const { doc, employee } = await loadForDecision(ctx, id, 'REJECTED');
  await applyDecision(ctx, approvable(doc), employee, REGULARIZATION_POLICY, 'REJECT', input.reason);
  doc.status = 'REJECTED';
  doc.rejectionReason = input.reason;
  doc.decidedAt = new Date();
  await doc.save();
  await notify({
    organizationId: ctx.organizationId,
    userIds: [employee.userId],
    type: 'ATTENDANCE_CORRECTION',
    title: 'Attendance correction rejected',
    message: `Your attendance correction for ${toDateKey(doc.date)} was rejected by ${ctx.userName}: ${input.reason}`,
    link: `${LINK}/${id}`,
    entityType: 'AttendanceCorrection',
    entityId: doc._id,
    excludeUserId: ctx.userId,
  });
  return getRegularization(ctx, id);
};

export const cancelRegularization = async (ctx: RequestContext, id: string) => {
  const doc = await AttendanceCorrectionModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!doc) throw notFound(ENTITY);
  if (!ctx.employeeId?.equals(doc.employeeId)) throw forbidden('Only the requester can cancel this request');
  const status = doc.status as ApprovalStatus;
  if (!PENDING.includes(status) || !REGULARIZATION_WORKFLOW.can(status, 'CANCELLED')) throw invalidTransition(ENTITY, status, 'CANCELLED');
  closeApproval(approvable(doc));
  doc.status = 'CANCELLED';
  doc.decidedAt = new Date();
  await doc.save();
  return getRegularization(ctx, id);
};
