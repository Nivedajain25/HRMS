import type { FilterQuery, Types } from 'mongoose';
import type { CycleStatus, GOAL_STATUS, PaginationQuery, goalProgressSchema, goalSchema, goalUpdateSchema } from '@stencil/shared';
import type { z } from 'zod';
import { EmployeeModel, GoalModel, PerformanceCycleModel, UserModel, type Goal } from '../models';
import { can, type RequestContext } from '../types/context';
import { dateOnly } from '../utils/dates';
import { badRequest, forbidden, notFound, unprocessable } from '../utils/errors';
import { buildSort, paginate, searchFilter } from '../utils/pagination';
import { audit, diff } from './audit.service';
import { managerUserId, notify, userIdsForEmployees } from './notification.service';
import { assertEmployeeAccess, isManagerOf, resolveEmployeeScope, toObjectId } from './scope.service';

type GoalCreateInput = z.output<typeof goalSchema>;
type GoalUpdateInput = z.output<typeof goalUpdateSchema>;
type GoalProgressInput = z.output<typeof goalProgressSchema>;
type Id = Types.ObjectId;

/** Cycle stages in which employees may set their own goals. */
const SELF_GOAL_STAGES: CycleStatus[] = ['GOAL_SETTING', 'IN_PROGRESS'];
const TERMINAL = new Set(['COMPLETED', 'CANCELLED']);

/**
 * Who the caller is relative to a goal owner:
 *  - HR: `performance:create` + `performance:read` (org-wide authority)
 *  - manager: `team:view` and a direct/indirect manager of the owner
 *  - self: the owner themself
 */
const actorFor = async (ctx: RequestContext, employeeId: Id | string) => {
  const isSelf = !!ctx.employeeId?.equals(employeeId);
  const isHr = can(ctx, 'performance:create') && can(ctx, 'performance:read');
  const isManager = !isSelf && can(ctx, 'team:view') && (await isManagerOf(ctx, employeeId));
  return { isSelf, isHr, isManager, canManage: isHr || isManager };
};

const loadCycle = async (ctx: RequestContext, cycleId: string | Id | null | undefined) => {
  if (!cycleId) return null;
  const cycle = await PerformanceCycleModel.findOne({ _id: cycleId, organizationId: ctx.organizationId, deletedAt: null })
    .select('name status departmentIds')
    .lean();
  if (!cycle) throw badRequest('Performance cycle not found', 'INVALID_REFERENCE', [{ path: 'cycleId', message: 'Performance cycle not found' }]);
  return cycle;
};

const assertCycleOpen = (cycle: { status?: string | null } | null, selfOnly: boolean) => {
  if (!cycle) return;
  if (cycle.status === 'COMPLETED') throw unprocessable('Goals of a completed cycle cannot be changed', 'CYCLE_COMPLETED');
  if (selfOnly && !SELF_GOAL_STAGES.includes(cycle.status as CycleStatus)) {
    throw unprocessable('Self goals can only be set during goal setting or while the cycle is in progress', 'GOAL_SETTING_CLOSED');
  }
};

/** Total weight of an employee's active goals in one cycle (or without cycle) must stay ≤ 100%. */
const assertWeightWithinLimit = async (
  ctx: RequestContext,
  employeeId: Id | string,
  cycleId: Id | string | null | undefined,
  weight: number,
  excludeGoalId?: Id,
) => {
  if (!weight) return;
  const rows = await GoalModel.aggregate<{ total: number }>([
    {
      $match: {
        organizationId: ctx.organizationId,
        employeeId: toObjectId(String(employeeId)),
        cycleId: cycleId ? toObjectId(String(cycleId)) : null,
        deletedAt: null,
        status: { $ne: 'CANCELLED' },
        ...(excludeGoalId ? { _id: { $ne: excludeGoalId } } : {}),
      },
    },
    { $group: { _id: null, total: { $sum: '$weight' } } },
  ]);
  const total = (rows[0]?.total ?? 0) + weight;
  if (total > 100) {
    const message = `Total goal weight would be ${total}% (maximum 100%)`;
    throw badRequest(message, 'WEIGHT_EXCEEDED', [{ path: 'weight', message }]);
  }
};

const assertParentGoal = async (ctx: RequestContext, parentGoalId: string | null | undefined, selfId?: Id) => {
  if (!parentGoalId) return;
  if (selfId?.equals(parentGoalId)) throw badRequest('A goal cannot be its own parent', 'INVALID_REFERENCE');
  const exists = await GoalModel.exists({ _id: parentGoalId, organizationId: ctx.organizationId, deletedAt: null });
  if (!exists) throw badRequest('Parent goal not found', 'INVALID_REFERENCE', [{ path: 'parentGoalId', message: 'Parent goal not found' }]);
};

type GoalStatus = (typeof GOAL_STATUS)[number];

const deriveStatus = (progress: number, requested: GoalStatus | undefined, current: GoalStatus): GoalStatus => {
  if (requested === 'CANCELLED') return 'CANCELLED';
  if (progress >= 100 || requested === 'COMPLETED') return 'COMPLETED';
  if (progress > 0) return 'IN_PROGRESS';
  return requested ?? (current === 'COMPLETED' || current === 'CANCELLED' ? 'IN_PROGRESS' : current);
};

const findGoal = async (ctx: RequestContext, id: string) => {
  const goal = await GoalModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null });
  if (!goal) throw notFound('Goal');
  return goal;
};

const GOAL_POPULATE = [
  { path: 'employeeId', select: 'employeeId firstName lastName profilePhoto' },
  { path: 'managerId', select: 'employeeId firstName lastName' },
  { path: 'cycleId', select: 'name status' },
];

export const listGoals = async (
  ctx: RequestContext,
  q: PaginationQuery & { cycleId?: string; status?: string; category?: string; employeeId?: string; scope?: string },
) => {
  const scope = await resolveEmployeeScope(ctx, 'performance:read', q.scope);
  const filter: FilterQuery<Goal> = {
    organizationId: ctx.organizationId,
    deletedAt: null,
    ...searchFilter(q.search, ['title', 'description']),
  };
  if (q.cycleId) filter.cycleId = toObjectId(q.cycleId);
  if (q.status) filter.status = q.status;
  if (q.category) filter.category = q.category;
  if (q.employeeId) {
    const allowed = scope.employeeIds === null || scope.employeeIds.some((e) => e.equals(q.employeeId!));
    filter.employeeId = allowed ? toObjectId(q.employeeId) : { $in: [] };
  } else if (scope.employeeIds !== null) {
    filter.employeeId = { $in: scope.employeeIds };
  }
  const page = await paginate(GoalModel, {
    filter,
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['title', 'dueDate', 'progress', 'status', 'weight', 'createdAt'], { createdAt: -1 }),
    populate: GOAL_POPULATE,
  });
  return { ...page, items: await withUpdateNames(ctx, page.items as unknown as GoalWithUpdates[]) };
};

type GoalWithUpdates = { updates?: { by?: unknown }[] | null } & Record<string, unknown>;

/** Adds `byName` to every progress/status update (one tenant-scoped user lookup). */
const withUpdateNames = async <T extends GoalWithUpdates>(ctx: RequestContext, goals: T[]): Promise<T[]> => {
  const ids = [...new Set(goals.flatMap((g) => (g.updates ?? []).map((u) => (u.by ? String(u.by) : ''))).filter(Boolean))];
  if (!ids.length) return goals;
  const users = await UserModel.find({ _id: { $in: ids }, organizationId: ctx.organizationId }).select('firstName lastName').lean();
  const nameOf = new Map(users.map((u) => [String(u._id), `${u.firstName} ${u.lastName}`]));
  return goals.map((g) => ({
    ...g,
    updates: (g.updates ?? []).map((u) => ({ ...u, byName: u.by ? (nameOf.get(String(u.by)) ?? null) : null })),
  }));
};

export const getGoal = async (ctx: RequestContext, id: string) => {
  const goal = await GoalModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null }).lean();
  if (!goal) throw notFound('Goal');
  await assertEmployeeAccess(ctx, goal.employeeId, 'performance:read');
  const full = await GoalModel.findOne({ _id: goal._id, organizationId: ctx.organizationId }).populate(GOAL_POPULATE).lean();
  if (!full) throw notFound('Goal');
  const [named] = await withUpdateNames(ctx, [full as unknown as GoalWithUpdates]);
  return named;
};

export const createGoal = async (ctx: RequestContext, input: GoalCreateInput) => {
  const employee = await EmployeeModel.findOne({
    _id: input.employeeId,
    organizationId: ctx.organizationId,
    deletedAt: null,
    employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] },
  })
    .select('managerId userId departmentId firstName lastName')
    .lean();
  if (!employee) throw badRequest('Employee not found', 'INVALID_REFERENCE', [{ path: 'employeeId', message: 'Employee not found' }]);

  const actor = await actorFor(ctx, employee._id);
  if (!actor.canManage && !actor.isSelf) throw forbidden('You can only set goals for yourself or your team');

  const cycle = await loadCycle(ctx, input.cycleId);
  assertCycleOpen(cycle, !actor.canManage);
  if (cycle?.departmentIds?.length && !cycle.departmentIds.some((d) => employee.departmentId && d.equals(employee.departmentId))) {
    throw badRequest('This employee is not part of the selected cycle', 'NOT_IN_CYCLE', [{ path: 'cycleId', message: 'Employee is not in this cycle' }]);
  }
  await assertParentGoal(ctx, input.parentGoalId);
  await assertWeightWithinLimit(ctx, employee._id, input.cycleId, input.weight);

  const status = deriveStatus(input.progress, input.status === 'CANCELLED' ? undefined : input.status, 'NOT_STARTED');
  const goal = await GoalModel.create({
    ...input,
    organizationId: ctx.organizationId,
    employeeId: employee._id,
    managerId: employee.managerId ?? null,
    cycleId: input.cycleId ?? null,
    parentGoalId: input.parentGoalId ?? null,
    dueDate: input.dueDate ? dateOnly(input.dueDate) : undefined,
    status,
    createdBy: ctx.userId,
  });
  await audit(ctx, { action: 'RECORD_CREATED', module: 'performance', recordId: goal._id, recordLabel: `Goal: ${goal.title}`, newValues: input });
  if (!actor.isSelf) {
    await notify({
      organizationId: ctx.organizationId,
      userIds: [employee.userId],
      type: 'GOAL',
      title: 'New goal assigned',
      message: `${ctx.userName} assigned you the goal "${goal.title}".`,
      link: `/performance/goals/${goal._id}`,
      excludeUserId: ctx.userId,
    });
  }
  return goal.toJSON();
};

export const updateGoal = async (ctx: RequestContext, id: string, input: GoalUpdateInput) => {
  const goal = await findGoal(ctx, id);
  const actor = await actorFor(ctx, goal.employeeId);
  const isCreator = goal.createdBy?.equals(ctx.userId) ?? false;
  if (!actor.canManage && !isCreator) throw forbidden('Only the goal creator, the manager or HR can edit this goal');
  if (!actor.canManage) {
    if (TERMINAL.has(goal.status)) throw unprocessable('Completed or cancelled goals can only be reopened by your manager', 'GOAL_CLOSED');
    if (input.status !== undefined && input.status !== goal.status) throw forbidden('Only your manager or HR can change goal status');
  }
  // `cycleId: null` detaches the goal from its cycle.
  const cycleChanged = input.cycleId !== undefined && String(input.cycleId ?? '') !== String(goal.cycleId ?? '');
  assertCycleOpen(await loadCycle(ctx, goal.cycleId), !actor.canManage);
  if (cycleChanged) assertCycleOpen(await loadCycle(ctx, input.cycleId), !actor.canManage);
  await assertParentGoal(ctx, input.parentGoalId, goal._id);
  if (input.weight !== undefined || cycleChanged) {
    await assertWeightWithinLimit(ctx, goal.employeeId, cycleChanged ? input.cycleId : goal.cycleId, input.weight ?? goal.weight, goal._id);
  }

  const before = goal.toObject() as unknown as Record<string, unknown>;
  const { dueDate, status, ...rest } = input;
  goal.set(rest);
  if (dueDate !== undefined) goal.set('dueDate', dueDate ? dateOnly(dueDate) : null);
  if (status !== undefined && status !== goal.status) {
    goal.status = status;
    if (status === 'COMPLETED') goal.progress = 100;
    goal.updates.push({ progress: goal.progress, status, note: 'Status changed', by: ctx.userId, at: new Date() });
  }
  await goal.save();
  await audit(ctx, {
    action: 'RECORD_UPDATED',
    module: 'performance',
    recordId: goal._id,
    recordLabel: `Goal: ${goal.title}`,
    ...diff(before, input as Record<string, unknown>),
  });
  return goal.toJSON();
};

export const updateGoalProgress = async (ctx: RequestContext, id: string, input: GoalProgressInput) => {
  const goal = await findGoal(ctx, id);
  const actor = await actorFor(ctx, goal.employeeId);
  if (!actor.isSelf && !actor.canManage) throw forbidden('Only the goal owner, their manager or HR can update progress');
  assertCycleOpen(await loadCycle(ctx, goal.cycleId), false);
  if (input.status === 'CANCELLED' && !actor.canManage) throw forbidden('Only your manager or HR can cancel a goal');

  const wasTerminal = TERMINAL.has(goal.status);
  if (wasTerminal) {
    const reopening = input.status === 'IN_PROGRESS' || input.status === 'NOT_STARTED';
    if (!actor.canManage || !reopening) {
      throw unprocessable('This goal is closed; only a manager can reopen it', 'GOAL_CLOSED');
    }
  }

  const before = { progress: goal.progress, status: goal.status };
  const status = wasTerminal && input.progress < 100 ? input.status! : deriveStatus(input.progress, input.status, goal.status);
  goal.progress = status === 'COMPLETED' ? 100 : input.progress;
  goal.status = status;
  if (input.keyResults) goal.set('keyResults', input.keyResults);
  goal.updates.push({ progress: goal.progress, status, note: input.note, by: ctx.userId, at: new Date() });
  await goal.save();

  await audit(ctx, {
    action: 'RECORD_UPDATED',
    module: 'performance',
    recordId: goal._id,
    recordLabel: `Goal: ${goal.title}`,
    oldValues: before,
    newValues: { progress: goal.progress, status: goal.status },
  });
  if (status === 'COMPLETED' && before.status !== 'COMPLETED') {
    const recipients = actor.isSelf
      ? [await managerUserId(ctx.organizationId, goal.managerId)]
      : await userIdsForEmployees(ctx.organizationId, [goal.employeeId]);
    await notify({
      organizationId: ctx.organizationId,
      userIds: recipients,
      type: 'GOAL',
      title: 'Goal completed',
      message: `The goal "${goal.title}" was marked as completed.`,
      link: `/performance/goals/${goal._id}`,
      excludeUserId: ctx.userId,
    });
  }
  return goal.toJSON();
};

export const removeGoal = async (ctx: RequestContext, id: string) => {
  const goal = await findGoal(ctx, id);
  const actor = await actorFor(ctx, goal.employeeId);
  if (!actor.canManage) throw forbidden('Only the manager or HR can delete goals');
  goal.deletedAt = new Date();
  await goal.save();
  await audit(ctx, { action: 'RECORD_DELETED', module: 'performance', recordId: goal._id, recordLabel: `Goal: ${goal.title}` });
};
