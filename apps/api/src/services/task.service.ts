import { Types, type FilterQuery } from 'mongoose';
import type { WorkTaskPriority, WorkTaskStatus } from '@stencil/shared';
import { EmployeeModel, TaskModel, type Task } from '../models';
import { can, type RequestContext } from '../types/context';
import { badRequest, forbidden, notFound } from '../utils/errors';
import { buildPagination } from '../utils/pagination';
import { audit } from './audit.service';
import { notify } from './notification.service';

const POPULATE = [
  {
    path: 'assigneeId',
    select: 'employeeId firstName lastName profilePhoto departmentId designationId userId',
    populate: [
      { path: 'departmentId', select: 'name' },
      { path: 'designationId', select: 'name' },
    ],
  },
  { path: 'assignedBy', select: 'firstName lastName avatar' },
];

const STATUS_LABEL: Record<WorkTaskStatus, string> = { TODO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done' };

/** People the caller can assign to (the "Assign task" picker): everyone active in the organization except themselves. */
export const listAssignable = async (ctx: RequestContext) => {
  const filter: FilterQuery<unknown> = { organizationId: ctx.organizationId, deletedAt: null, employmentStatus: { $nin: ['TERMINATED', 'RESIGNED', 'EXITED'] } };
  if (ctx.employeeId) filter._id = { $ne: ctx.employeeId };
  return EmployeeModel.find(filter)
    .select('employeeId firstName lastName profilePhoto departmentId designationId')
    .populate([
      { path: 'departmentId', select: 'name' },
      { path: 'designationId', select: 'name' },
    ])
    .sort({ firstName: 1, lastName: 1 })
    .lean();
};

export const createTasks = async (
  ctx: RequestContext,
  input: { title: string; description?: string; assigneeIds: string[]; priority?: WorkTaskPriority; dueDate?: string },
) => {
  // Anyone can assign to anyone in the organization; each assignee is notified (in-app, push and the pop-up).
  const wanted = [...new Set(input.assigneeIds)];
  const employees = await EmployeeModel.find({ _id: { $in: wanted }, organizationId: ctx.organizationId, deletedAt: null })
    .select('firstName lastName userId')
    .lean();
  if (employees.length !== wanted.length) throw badRequest('Some of the chosen people were not found', 'ASSIGNEE_NOT_FOUND');

  const dueDate = input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null;
  const docs = await TaskModel.insertMany(
    employees.map((e) => ({
      organizationId: ctx.organizationId,
      title: input.title,
      description: input.description || undefined,
      priority: input.priority ?? 'MEDIUM',
      dueDate,
      assigneeId: e._id,
      assignedBy: ctx.userId,
      assignedByName: ctx.userName,
    })),
  );

  const due = input.dueDate ? ` Due ${input.dueDate}.` : '';
  await Promise.all(
    docs.map((doc, i) =>
      notify({
        organizationId: ctx.organizationId,
        userIds: [employees[i]!.userId],
        excludeUserId: ctx.userId,
        type: 'TASK',
        title: `New task from ${ctx.userName}: ${input.title}`,
        message: `${input.description ? `${input.description.slice(0, 160)}.` : 'You have a new task.'}${due}`,
        link: `/tasks?id=${doc._id}`,
        entityType: 'Task',
        entityId: doc._id,
        force: input.priority === 'HIGH',
      }),
    ),
  );
  await audit(ctx, {
    action: 'TASK_ASSIGNED',
    module: 'tasks',
    recordId: docs[0]!._id,
    recordLabel: `${input.title} → ${employees.map((e) => `${e.firstName} ${e.lastName}`.trim()).join(', ')}`,
  });
  return TaskModel.find({ _id: { $in: docs.map((d) => d._id) } }).populate(POPULATE).lean();
};

const assertCanView = (ctx: RequestContext, t: { assigneeId: unknown; assignedBy: unknown }) => {
  const assignee = String((t.assigneeId as { _id?: unknown } | null)?._id ?? t.assigneeId);
  const assigner = String((t.assignedBy as { _id?: unknown } | null)?._id ?? t.assignedBy);
  if (can(ctx, 'employee:read') || assigner === String(ctx.userId) || (ctx.employeeId && assignee === String(ctx.employeeId))) return;
  throw forbidden();
};

export const getTask = async (ctx: RequestContext, id: string) => {
  if (!Types.ObjectId.isValid(id)) throw notFound('Task');
  const t = await TaskModel.findOne({ _id: id, organizationId: ctx.organizationId }).populate(POPULATE).lean();
  if (!t) throw notFound('Task');
  assertCanView(ctx, t);
  return t;
};

/** `mine`: tasks assigned to me; `assigned`: tasks I gave out. Open ones by due date, finished ones newest first. */
export const listTasks = async (ctx: RequestContext, q: { scope: 'mine' | 'assigned'; state?: 'open' | 'done'; page: number; limit: number }) => {
  const filter: FilterQuery<Task> = { organizationId: ctx.organizationId };
  if (q.scope === 'mine') filter.assigneeId = ctx.employeeId ?? new Types.ObjectId();
  else filter.assignedBy = ctx.userId;
  if (q.state === 'open') filter.status = { $ne: 'DONE' };
  if (q.state === 'done') filter.status = 'DONE';
  const sort: Record<string, 1 | -1> = q.state === 'done' ? { completedAt: -1 } : { status: 1, dueDate: 1, createdAt: -1 };
  const [items, total] = await Promise.all([
    TaskModel.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate(POPULATE)
      .lean(),
    TaskModel.countDocuments(filter),
  ]);
  return { items, pagination: buildPagination(q.page, q.limit, total) };
};

/** New tasks the caller hasn't opened yet (drives the pop-up on web and mobile). */
export const unseenTasks = async (ctx: RequestContext) => {
  if (!ctx.employeeId) return [];
  return TaskModel.find({ organizationId: ctx.organizationId, assigneeId: ctx.employeeId, seenAt: null, status: { $ne: 'DONE' } })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate(POPULATE)
    .lean();
};

/** Marks one task (or, without an id, all of the caller's new tasks) as seen. */
export const markSeen = async (ctx: RequestContext, id?: string) => {
  if (!ctx.employeeId) return { updated: 0 };
  const filter: FilterQuery<Task> = { organizationId: ctx.organizationId, assigneeId: ctx.employeeId, seenAt: null };
  if (id) {
    if (!Types.ObjectId.isValid(id)) throw notFound('Task');
    filter._id = id;
  }
  const res = await TaskModel.updateMany(filter, { seenAt: new Date() });
  return { updated: res.modifiedCount };
};

/**
 * The assignee moves a task to In progress / Done (the assigner is told when it's finished); the assigner (or HR)
 * can also change it, e.g. reopen a finished task (the assignee is told).
 */
export const updateTaskStatus = async (ctx: RequestContext, id: string, input: { status: WorkTaskStatus; note?: string }) => {
  if (!Types.ObjectId.isValid(id)) throw notFound('Task');
  const t = await TaskModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!t) throw notFound('Task');
  const isAssignee = !!ctx.employeeId && t.assigneeId.equals(ctx.employeeId);
  const isAssigner = t.assignedBy.equals(ctx.userId);
  if (!isAssignee && !isAssigner && !can(ctx, 'employee:read')) throw forbidden();

  const from = t.status;
  const now = new Date();
  if (from === input.status && !input.note) return getTask(ctx, id);
  t.status = input.status;
  if (input.status === 'IN_PROGRESS' && !t.startedAt) t.startedAt = now;
  if (input.status === 'DONE') t.completedAt = now;
  else t.completedAt = null;
  if (isAssignee && !t.seenAt) t.seenAt = now;
  if (input.note) t.notes.push({ by: ctx.userId, byName: ctx.userName, text: input.note, at: now });
  await t.save();

  if (from !== t.status) {
    const assignee = await EmployeeModel.findOne({ _id: t.assigneeId, organizationId: ctx.organizationId }).select('firstName lastName userId').lean();
    const assigneeName = assignee ? `${assignee.firstName} ${assignee.lastName}`.trim() : 'The assignee';
    if (isAssignee) {
      // Tell whoever assigned it (only when finished or picked up, not on every change).
      if (t.status === 'DONE' || t.status === 'IN_PROGRESS') {
        await notify({
          organizationId: ctx.organizationId,
          userIds: [t.assignedBy],
          excludeUserId: ctx.userId,
          type: 'TASK',
          title: t.status === 'DONE' ? `✅ ${assigneeName} finished: ${t.title}` : `${assigneeName} started: ${t.title}`,
          message: input.note || (t.status === 'DONE' ? 'The task is marked as done.' : 'The task is now in progress.'),
          link: `/tasks?id=${t._id}`,
          entityType: 'Task',
          entityId: t._id,
        });
      }
    } else {
      await notify({
        organizationId: ctx.organizationId,
        userIds: [assignee?.userId],
        excludeUserId: ctx.userId,
        type: 'TASK',
        title: from === 'DONE' ? `Task reopened: ${t.title}` : `Task moved to ${STATUS_LABEL[t.status]}: ${t.title}`,
        message: input.note || `${ctx.userName} changed the task status.`,
        link: `/tasks?id=${t._id}`,
        entityType: 'Task',
        entityId: t._id,
      });
    }
  }
  await audit(ctx, {
    action: t.status === 'DONE' && from !== 'DONE' ? 'TASK_COMPLETED' : 'TASK_UPDATED',
    module: 'tasks',
    recordId: t._id,
    recordLabel: t.title,
    oldValues: { status: from },
    newValues: { status: t.status, note: input.note },
  });
  return getTask(ctx, id);
};

/** The assigner (or HR) withdraws a task. */
export const deleteTask = async (ctx: RequestContext, id: string) => {
  if (!Types.ObjectId.isValid(id)) throw notFound('Task');
  const t = await TaskModel.findOne({ _id: id, organizationId: ctx.organizationId }).lean();
  if (!t) throw notFound('Task');
  if (!t.assignedBy.equals(ctx.userId) && !can(ctx, 'employee:read')) throw forbidden('Only the person who assigned this task can delete it');
  await TaskModel.deleteOne({ _id: t._id });
  await audit(ctx, { action: 'TASK_DELETED', module: 'tasks', recordId: t._id, recordLabel: t.title });
  return { deleted: true };
};
