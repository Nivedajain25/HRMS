import { Types, type FilterQuery } from 'mongoose';
import type { EmergencyCategory, EmergencyStatus } from '@stencil/shared';
import { AttendanceModel, EmergencyModel, EmployeeModel, OrganizationModel, type Emergency } from '../models';
import { dateKeyInTz, dateOnly } from '../utils/dates';
import { can, type RequestContext } from '../types/context';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors';
import { buildPagination } from '../utils/pagination';
import { audit } from './audit.service';
import { managerUserId, notify, userIdsWithPermission } from './notification.service';

const CATEGORY_LABEL: Record<EmergencyCategory, string> = {
  FAMILY: 'Family emergency',
  HEALTH: 'Feeling unwell',
  HOME: 'Emergency at home',
  CHILD: 'Child / school emergency',
  ACCIDENT: 'Accident',
  OTHER: 'Personal emergency',
};

const POPULATE = [
  {
    path: 'employeeId',
    select: 'employeeId firstName lastName profilePhoto phone workEmail departmentId designationId',
    populate: [
      { path: 'departmentId', select: 'name' },
      { path: 'designationId', select: 'name' },
    ],
  },
  { path: 'acknowledgedBy', select: 'firstName lastName' },
  { path: 'resolvedBy', select: 'firstName lastName' },
  { path: 'decidedBy', select: 'firstName lastName' },
];

/** Who responds: everyone with `emergency:manage` (HR), plus the employee's manager. */
const responders = async (organizationId: Types.ObjectId, managerEmployeeId: Types.ObjectId | null | undefined) => {
  const [hr, manager] = await Promise.all([userIdsWithPermission(organizationId, 'emergency:manage'), managerUserId(organizationId, managerEmployeeId)]);
  return [...hr, manager];
};

/** An employee raises an emergency: HR and their manager are notified at once (in-app, email and push, always). */
export const raiseEmergency = async (
  ctx: RequestContext,
  input: {
    category: EmergencyCategory;
    message?: string;
    needToLeave?: boolean;
    contactPhone?: string;
    latitude?: number;
    longitude?: number;
    accuracy?: number;
  },
) => {
  if (!ctx.employeeId) throw badRequest('Only employees can raise an emergency', 'NOT_AN_EMPLOYEE');
  const employee = await EmployeeModel.findOne({ _id: ctx.employeeId, organizationId: ctx.organizationId }).select('firstName lastName phone managerId').lean();
  if (!employee) throw notFound('Employee');

  // One open alert at a time: a second tap updates nobody twice, it just returns the live one.
  const open = await EmergencyModel.findOne({ organizationId: ctx.organizationId, employeeId: ctx.employeeId, status: { $ne: 'RESOLVED' } }).lean();
  if (open) throw conflict('You already have an active emergency alert. HR has been notified.', 'EMERGENCY_ALREADY_OPEN');

  const hasLocation = typeof input.latitude === 'number' && typeof input.longitude === 'number';
  const doc = await EmergencyModel.create({
    organizationId: ctx.organizationId,
    employeeId: ctx.employeeId,
    raisedBy: ctx.userId,
    category: input.category,
    message: input.message || undefined,
    needToLeave: input.needToLeave ?? true,
    contactPhone: input.contactPhone || employee.phone || undefined,
    location: hasLocation ? { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy } : null,
  });

  const name = `${employee.firstName} ${employee.lastName}`.trim();
  const phone = doc.contactPhone ? ` Contact: ${doc.contactPhone}.` : '';
  const leaving = doc.needToLeave ? ` ${employee.firstName} needs to leave work now.` : '';
  await notify({
    organizationId: ctx.organizationId,
    userIds: await responders(ctx.organizationId, employee.managerId),
    excludeUserId: ctx.userId,
    type: 'EMERGENCY',
    title: `🚨 ${CATEGORY_LABEL[input.category]}: ${name}`,
    message: `${input.message ? `“${input.message}”.` : `${name} has a personal emergency.`}${leaving}${phone}`,
    link: `/emergencies/${doc._id}`,
    entityType: 'Emergency',
    entityId: doc._id,
    force: true,
  });
  await audit(ctx, { action: 'EMERGENCY_RAISED', module: 'emergency', recordId: doc._id, recordLabel: `${CATEGORY_LABEL[input.category]} · ${name}` });
  return getEmergency(ctx, String(doc._id));
};

const assertCanView = (ctx: RequestContext, e: { employeeId: unknown }) => {
  const ownerId = String((e.employeeId as { _id?: unknown } | null)?._id ?? e.employeeId);
  if (can(ctx, 'emergency:manage') || (ctx.employeeId && ownerId === String(ctx.employeeId))) return;
  throw forbidden();
};

export const getEmergency = async (ctx: RequestContext, id: string) => {
  if (!Types.ObjectId.isValid(id)) throw notFound('Emergency');
  const e = await EmergencyModel.findOne({ _id: id, organizationId: ctx.organizationId }).populate(POPULATE).lean();
  if (!e) throw notFound('Emergency');
  assertCanView(ctx, e);
  return e;
};

/** HR sees every alert (`scope=all`); everyone else only their own. Open ones first, newest first. */
export const listEmergencies = async (ctx: RequestContext, q: { status?: EmergencyStatus; scope?: 'mine' | 'all'; page: number; limit: number }) => {
  const all = q.scope !== 'mine' && can(ctx, 'emergency:manage');
  if (q.scope === 'all' && !all) throw forbidden();
  const filter: FilterQuery<Emergency> = { organizationId: ctx.organizationId };
  if (!all) filter.employeeId = ctx.employeeId ?? new Types.ObjectId();
  if (q.status) filter.status = q.status;
  const [items, total] = await Promise.all([
    EmergencyModel.find(filter)
      // HR: open ones first. An employee's own list: newest first (their latest alert drives the status bar).
      .sort(all ? { resolvedAt: 1, createdAt: -1 } : { createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate(POPULATE)
      .lean(),
    EmergencyModel.countDocuments(filter),
  ]);
  return { items, pagination: buildPagination(q.page, q.limit, total) };
};

/** Unresolved alerts for HR's always-on banner (polled every few seconds). */
export const activeEmergencies = async (ctx: RequestContext) =>
  EmergencyModel.find({ organizationId: ctx.organizationId, status: { $ne: 'RESOLVED' } })
    .sort({ createdAt: -1 })
    .limit(20)
    .populate(POPULATE)
    .lean();

/** HR acknowledges (someone is on it) or resolves an alert; the employee is told either way. */
export const updateEmergency = async (ctx: RequestContext, id: string, input: { status: 'ACKNOWLEDGED' | 'RESOLVED'; note?: string }) => {
  const e = await EmergencyModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!e) throw notFound('Emergency');
  if (e.status === 'RESOLVED') throw badRequest('This emergency is already resolved', 'EMERGENCY_RESOLVED');
  if (input.status === 'ACKNOWLEDGED' && e.status === 'ACKNOWLEDGED' && !input.note) return getEmergency(ctx, id);

  const now = new Date();
  const from = e.status;
  if (input.status === 'ACKNOWLEDGED' && e.status === 'OPEN') {
    e.status = 'ACKNOWLEDGED';
    e.acknowledgedBy = ctx.userId;
    e.acknowledgedAt = now;
  }
  if (input.status === 'RESOLVED') {
    if (!e.acknowledgedAt) {
      e.acknowledgedBy = ctx.userId;
      e.acknowledgedAt = now;
    }
    e.status = 'RESOLVED';
    e.resolvedBy = ctx.userId;
    e.resolvedAt = now;
  }
  if (input.note) e.notes.push({ by: ctx.userId, byName: ctx.userName, text: input.note, at: now });
  await e.save();

  const owner = await EmployeeModel.findOne({ _id: e.employeeId, organizationId: ctx.organizationId }).select('userId').lean();
  if (from !== e.status) {
    await notify({
      organizationId: ctx.organizationId,
      userIds: [owner?.userId],
      type: 'EMERGENCY',
      title: e.status === 'RESOLVED' ? 'Your emergency was closed by HR' : `HR has seen your emergency`,
      message:
        input.note ||
        (e.status === 'RESOLVED'
          ? 'HR has closed your emergency alert. Take care.'
          : `${ctx.userName} from HR has seen your alert${e.needToLeave ? ' — you can go, take care' : ''}.`),
      link: `/emergencies/${e._id}`,
      entityType: 'Emergency',
      entityId: e._id,
      force: true,
    });
  }
  await audit(ctx, { action: 'EMERGENCY_UPDATED', module: 'emergency', recordId: e._id, oldValues: { status: from }, newValues: { status: e.status, note: input.note } });
  return getEmergency(ctx, id);
};

/**
 * HR / super admin answers the request: approve (they may leave) or decline. This closes the alert, tells the
 * employee straight away (push, in-app, email) and, when approved, notes it on today's attendance record.
 */
export const decideEmergency = async (ctx: RequestContext, id: string, input: { decision: 'APPROVED' | 'DECLINED'; note?: string }) => {
  const e = await EmergencyModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!e) throw notFound('Emergency');
  if (e.status === 'RESOLVED') throw badRequest('This emergency has already been closed', 'EMERGENCY_RESOLVED');

  const now = new Date();
  const from = e.status;
  if (!e.acknowledgedAt) {
    e.acknowledgedBy = ctx.userId;
    e.acknowledgedAt = now;
  }
  e.decision = input.decision;
  e.decidedBy = ctx.userId;
  e.decidedAt = now;
  e.status = 'RESOLVED';
  e.resolvedBy = ctx.userId;
  e.resolvedAt = now;
  const label = input.decision === 'APPROVED' ? 'Approved' : 'Declined';
  e.notes.push({ by: ctx.userId, byName: ctx.userName, text: input.note ? `${label}: ${input.note}` : label, at: now });
  await e.save();

  // Approved: leave a note on today's attendance so the early departure is explained.
  if (input.decision === 'APPROVED') {
    const org = await OrganizationModel.findById(ctx.organizationId).select('timezone').lean();
    const today = dateOnly(dateKeyInTz(now, org?.timezone ?? 'UTC'));
    const reason = `Left early: emergency approved by ${ctx.userName}${input.note ? ` (${input.note})` : ''}`;
    await AttendanceModel.updateOne({ organizationId: ctx.organizationId, employeeId: e.employeeId, date: today }, { $set: { note: reason } });
  }

  const owner = await EmployeeModel.findOne({ _id: e.employeeId, organizationId: ctx.organizationId }).select('userId').lean();
  await notify({
    organizationId: ctx.organizationId,
    userIds: [owner?.userId],
    type: 'EMERGENCY',
    title: input.decision === 'APPROVED' ? '✅ Approved — you can leave' : '❌ Your request to leave was declined',
    message:
      input.note ||
      (input.decision === 'APPROVED'
        ? `${ctx.userName} approved your emergency. You can go now — take care.`
        : `${ctx.userName} declined your request to leave. Please speak to HR or your manager.`),
    link: `/emergencies/${e._id}`,
    entityType: 'Emergency',
    entityId: e._id,
    force: true,
  });
  await audit(ctx, {
    action: 'EMERGENCY_UPDATED',
    module: 'emergency',
    recordId: e._id,
    oldValues: { status: from },
    newValues: { status: e.status, decision: input.decision, note: input.note },
  });
  return getEmergency(ctx, id);
};
