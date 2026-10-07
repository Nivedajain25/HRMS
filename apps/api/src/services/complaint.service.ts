import { Types, type FilterQuery } from 'mongoose';
import type { ComplaintCategory, ComplaintStatus } from '@stencil/shared';
import { ComplaintModel, RoleModel, UserModel, type Complaint } from '../models';
import { can, type RequestContext } from '../types/context';
import { forbidden, notFound } from '../utils/errors';
import { buildPagination } from '../utils/pagination';
import { notify } from './notification.service';

/** HR and admins (employee:update) handle complaints. */
export const canHandleComplaints = (ctx: RequestContext) => can(ctx, 'employee:update');

const STATUS_LABEL: Record<ComplaintStatus, string> = { OPEN: 'Open', IN_REVIEW: 'In review', RESOLVED: 'Resolved', CLOSED: 'Closed' };

/** Everyone who handles complaints: active users with an HR or super admin role. */
const handlerUserIds = async (organizationId: Types.ObjectId) => {
  const roles = await RoleModel.find({ organizationId, key: { $in: ['super_admin', 'admin', 'hr_admin', 'hr_manager'] } }).select('_id').lean();
  if (!roles.length) return [];
  const users = await UserModel.find({ organizationId, status: 'ACTIVE', roles: { $in: roles.map((r) => r._id) } }).select('_id').lean();
  return users.map((u) => u._id);
};

const notifyHandlers = async (ctx: RequestContext, title: string, message: string, id: Types.ObjectId) =>
  notify({ organizationId: ctx.organizationId, userIds: await handlerUserIds(ctx.organizationId), excludeUserId: ctx.userId, type: 'GENERAL', title, message, link: `/complaints/${id}`, entityType: 'Complaint', entityId: id, force: true }).catch(
    () => undefined,
  );

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const listComplaints = async (ctx: RequestContext, q: { scope?: 'me' | 'all'; status?: ComplaintStatus; search?: string; page: number; limit: number }) => {
  const filter: FilterQuery<Complaint> = { organizationId: ctx.organizationId, deletedAt: null };
  if (q.scope === 'all') {
    if (!canHandleComplaints(ctx)) throw forbidden();
  } else filter.raisedBy = ctx.userId;
  if (q.search) {
    const rx = { $regex: escapeRegex(q.search), $options: 'i' };
    filter.$or = [{ subject: rx }, { number: rx }, { raisedByName: rx }];
  }
  // Counts per status (for the tabs) ignore the status filter itself.
  const countFilter = { ...filter };
  if (q.status) filter.status = q.status;
  const [items, total, counts] = await Promise.all([
    ComplaintModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .select('-replies')
      .populate({ path: 'employeeId', select: 'employeeId firstName lastName profilePhoto departmentId', populate: { path: 'departmentId', select: 'name' } })
      .lean(),
    ComplaintModel.countDocuments(filter),
    ComplaintModel.aggregate<{ _id: ComplaintStatus; n: number }>([{ $match: countFilter }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  return { items, pagination: buildPagination(q.page, q.limit, total), counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) };
};

const findVisible = async (ctx: RequestContext, id: string) => {
  if (!Types.ObjectId.isValid(id)) throw notFound('Complaint');
  const doc = await ComplaintModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null });
  if (!doc) throw notFound('Complaint');
  if (String(doc.raisedBy) !== String(ctx.userId) && !canHandleComplaints(ctx)) throw notFound('Complaint');
  return doc;
};

export const getComplaint = async (ctx: RequestContext, id: string) => {
  const doc = await findVisible(ctx, id);
  await doc.populate({ path: 'employeeId', select: 'employeeId firstName lastName profilePhoto departmentId', populate: { path: 'departmentId', select: 'name' } });
  return { ...doc.toObject(), canHandle: canHandleComplaints(ctx), mine: String(doc.raisedBy) === String(ctx.userId) };
};

export const createComplaint = async (ctx: RequestContext, input: { category: ComplaintCategory; subject: string; description: string }) => {
  const count = await ComplaintModel.countDocuments({ organizationId: ctx.organizationId });
  const doc = await ComplaintModel.create({
    organizationId: ctx.organizationId,
    number: `CMP-${String(count + 1).padStart(4, '0')}`,
    raisedBy: ctx.userId,
    employeeId: ctx.employeeId,
    raisedByName: ctx.userName,
    ...input,
  });
  void notifyHandlers(ctx, `New complaint ${doc.number}`, `${ctx.userName}: ${input.subject}`, doc._id);
  return doc.toObject();
};

/** A reply on the thread — from the person who raised it, or from HR / admin. */
export const replyToComplaint = async (ctx: RequestContext, id: string, input: { message: string }) => {
  const doc = await findVisible(ctx, id);
  const mine = String(doc.raisedBy) === String(ctx.userId);
  const staff = !mine && canHandleComplaints(ctx);
  doc.replies.push({ userId: ctx.userId, name: ctx.userName, staff, message: input.message, status: null });
  // A follow-up from the employee re-opens a resolved / closed complaint.
  if (mine && (doc.status === 'RESOLVED' || doc.status === 'CLOSED')) {
    doc.status = 'OPEN';
    doc.resolvedAt = null;
  }
  await doc.save();
  if (staff)
    void notify({ organizationId: ctx.organizationId, userIds: [doc.raisedBy], type: 'GENERAL', title: `Reply on your complaint ${doc.number}`, message: input.message.slice(0, 140), link: `/complaints/${doc._id}`, entityType: 'Complaint', entityId: doc._id, force: true }).catch(() => undefined);
  else void notifyHandlers(ctx, `Follow-up on ${doc.number}`, `${ctx.userName}: ${input.message.slice(0, 140)}`, doc._id);
  return getComplaint(ctx, id);
};

/** HR / admin move a complaint along (with an optional message to the employee). */
export const setComplaintStatus = async (ctx: RequestContext, id: string, input: { status: ComplaintStatus; message?: string }) => {
  if (!canHandleComplaints(ctx)) throw forbidden();
  const doc = await findVisible(ctx, id);
  doc.status = input.status;
  doc.resolvedAt = input.status === 'RESOLVED' || input.status === 'CLOSED' ? new Date() : null;
  doc.replies.push({ userId: ctx.userId, name: ctx.userName, staff: true, message: input.message || `Marked as ${STATUS_LABEL[input.status].toLowerCase()}`, status: input.status });
  await doc.save();
  void notify({
    organizationId: ctx.organizationId,
    userIds: [doc.raisedBy],
    type: 'GENERAL',
    title: `Complaint ${doc.number}: ${STATUS_LABEL[input.status]}`,
    message: input.message?.slice(0, 140) || `Your complaint "${doc.subject}" is now ${STATUS_LABEL[input.status].toLowerCase()}.`,
    link: `/complaints/${doc._id}`,
    entityType: 'Complaint',
    entityId: doc._id,
    force: true,
  }).catch(() => undefined);
  return getComplaint(ctx, id);
};
