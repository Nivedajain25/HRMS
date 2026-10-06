import type { FilterQuery, Types } from 'mongoose';
import {
  PERFORMANCE_CYCLE_WORKFLOW,
  PERFORMANCE_REVIEW_WORKFLOW,
  hrReviewSubmitSchema,
  reviewSubmitSchema,
  type CycleStatus,
  type PaginationQuery,
  type ReviewStatus,
  type feedbackSchema,
  type performanceCycleSchema,
  type performanceCycleUpdateSchema,
} from '@stencil/shared';
import type { z } from 'zod';
import {
  DepartmentModel,
  EmployeeModel,
  FeedbackModel,
  GoalModel,
  PerformanceCycleModel,
  PerformanceReviewModel,
  type Feedback,
  type PerformanceCycle,
  type PerformanceReview,
} from '../models';
import { can, type RequestContext } from '../types/context';
import { dateOnly, round2, toDateKey } from '../utils/dates';
import { badRequest, conflict, forbidden, invalidTransition, notFound, unprocessable } from '../utils/errors';
import { buildSort, paginate, searchFilter } from '../utils/pagination';
import { audit, diff } from './audit.service';
import { managerUserId, notify, userIdsForEmployees, userIdsWithPermission } from './notification.service';
import { assertIdsInOrg } from './refs.service';
import { applyScope, isManagerOf, resolveEmployeeScope, toObjectId } from './scope.service';

/* =========================== Score calculation =========================== */

export interface RatingScale {
  min: number;
  max: number;
  labels: { value: number; label: string }[];
}

export interface GoalScoreInput {
  /** Goal weight in percent (0-100). */
  weight: number;
  /** Goal progress in percent (0-100). */
  progress: number;
  /** Explicit rating for the goal on the cycle scale (manager/HR); overrides progress. */
  rating?: number | null;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Maps goal progress (0-100%) linearly onto the rating scale. */
export const progressToRating = (progress: number, scale: Pick<RatingScale, 'min' | 'max'>) =>
  scale.min + (clamp(progress, 0, 100) / 100) * (scale.max - scale.min);

/**
 * Weighted goal score on the rating scale. Each goal contributes its explicit
 * rating when present, otherwise its progress mapped onto the scale. When no
 * goal carries a weight all goals count equally. `null` when there are no goals.
 */
export const computeGoalScore = (goals: GoalScoreInput[], scale: RatingScale): number | null => {
  if (!goals.length) return null;
  const weighted = goals.some((g) => g.weight > 0);
  let sumW = 0;
  let sum = 0;
  for (const g of goals) {
    const w = weighted ? Math.max(0, g.weight) : 1;
    const r = g.rating !== undefined && g.rating !== null ? clamp(g.rating, scale.min, scale.max) : progressToRating(g.progress, scale);
    sumW += w;
    sum += w * r;
  }
  return sumW > 0 ? round2(sum / sumW) : null;
};

/** Label of the scale point nearest to a rating (ties resolve to the lower point). */
export const ratingLabel = (rating: number, scale: RatingScale): string | null => {
  if (!scale.labels.length) return null;
  let best = scale.labels[0]!;
  for (const l of scale.labels) {
    const d = Math.abs(l.value - rating);
    const bd = Math.abs(best.value - rating);
    if (d < bd || (d === bd && l.value < best.value)) best = l;
  }
  return best.label;
};

/**
 * Final rating = goalWeightage% × goal score + (100 − goalWeightage)% × overall
 * rating (manager's, or HR's override). Without goals the overall rating
 * counts 100%. The result is clamped to the scale and rounded to 2 decimals.
 */
export const computeFinalRating = (input: {
  goals: GoalScoreInput[];
  overallRating: number;
  goalWeightage: number;
  scale: RatingScale;
}) => {
  const goalScore = computeGoalScore(input.goals, input.scale);
  const w = goalScore === null ? 0 : clamp(input.goalWeightage, 0, 100) / 100;
  const raw = w * (goalScore ?? 0) + (1 - w) * input.overallRating;
  const finalRating = round2(clamp(raw, input.scale.min, input.scale.max));
  return { goalScore, finalRating, finalRatingLabel: ratingLabel(finalRating, input.scale) };
};

/* ================================ Helpers ================================ */

type Id = Types.ObjectId;
type CycleInput = z.output<typeof performanceCycleSchema>;
type CycleUpdateInput = z.output<typeof performanceCycleUpdateSchema>;
type ReviewInput = z.output<typeof reviewSubmitSchema>;
type HrReviewInput = z.output<typeof hrReviewSubmitSchema>;
type FeedbackInput = z.output<typeof feedbackSchema>;

const ACTIVE_EMPLOYEE = { deletedAt: null, employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] } };
/** Cycle stages in which review sections may be submitted. */
const REVIEW_OPEN_STAGES: CycleStatus[] = ['SELF_REVIEW', 'MANAGER_REVIEW', 'HR_REVIEW'];
/** Stages in which scale/weightage are locked (reviews may already carry ratings). */
const SCALE_EDITABLE_STAGES: CycleStatus[] = ['DRAFT', 'GOAL_SETTING', 'IN_PROGRESS'];

interface ScaleSource {
  ratingScale?: {
    min?: number | null;
    max?: number | null;
    labels?: readonly { value?: number | null; label?: string | null }[] | null;
  } | null;
}

export const scaleOf = (cycle: ScaleSource): RatingScale => ({
  min: cycle.ratingScale?.min ?? 1,
  max: cycle.ratingScale?.max ?? 5,
  labels: (cycle.ratingScale?.labels ?? []).flatMap((l) =>
    typeof l.value === 'number' && typeof l.label === 'string' ? [{ value: l.value, label: l.label }] : [],
  ),
});

/** String id of a possibly-populated reference. */
const refId = (v: unknown): string => {
  if (v && typeof v === 'object' && '_id' in v) return String((v as { _id: unknown })._id);
  return v === null || v === undefined ? '' : String(v);
};

const sameId = (a: unknown, b: unknown) => {
  const x = refId(a);
  return x !== '' && x === refId(b);
};

const findCycle = async (ctx: RequestContext, id: string | Id) => {
  const cycle = await PerformanceCycleModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null });
  if (!cycle) throw notFound('Performance cycle');
  return cycle;
};

const assertScale = (scale: RatingScale | undefined) => {
  if (!scale) return;
  if (scale.max <= scale.min) throw badRequest('Rating scale maximum must be greater than minimum', 'INVALID_SCALE');
  if (scale.labels.some((l) => l.value < scale.min || l.value > scale.max)) {
    throw badRequest('Rating labels must lie within the scale', 'INVALID_SCALE');
  }
};

/* ================================= Cycles ================================ */

export const listCycles = async (ctx: RequestContext, q: PaginationQuery & { status?: string }) => {
  const filter: FilterQuery<PerformanceCycle> = {
    organizationId: ctx.organizationId,
    deletedAt: null,
    ...searchFilter(q.search, ['name']),
  };
  if (q.status) filter.status = q.status;
  return paginate(PerformanceCycleModel, {
    filter,
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['name', 'startDate', 'endDate', 'status', 'createdAt'], { startDate: -1 }),
    populate: [{ path: 'departmentIds', select: 'name code' }],
  });
};

const reviewCounts = async (ctx: RequestContext, cycleId: Id) => {
  const rows = await PerformanceReviewModel.aggregate<{ _id: string; count: number }>([
    { $match: { organizationId: ctx.organizationId, cycleId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, r.count])) as Partial<Record<ReviewStatus, number>>;
};

export const getCycle = async (ctx: RequestContext, id: string) => {
  const cycle = await PerformanceCycleModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null })
    .populate({ path: 'departmentIds', select: 'name code' })
    .lean();
  if (!cycle) throw notFound('Performance cycle');
  return { ...cycle, reviewCounts: await reviewCounts(ctx, cycle._id) };
};

export const createCycle = async (ctx: RequestContext, input: CycleInput) => {
  assertScale(input.ratingScale);
  await assertIdsInOrg(ctx.organizationId, DepartmentModel as never, input.departmentIds, 'departments');
  const cycle = await PerformanceCycleModel.create({
    ...input,
    organizationId: ctx.organizationId,
    startDate: dateOnly(input.startDate),
    endDate: dateOnly(input.endDate),
    selfReviewDue: input.selfReviewDue ? dateOnly(input.selfReviewDue) : undefined,
    managerReviewDue: input.managerReviewDue ? dateOnly(input.managerReviewDue) : undefined,
    status: 'DRAFT',
    createdBy: ctx.userId,
  });
  await audit(ctx, { action: 'RECORD_CREATED', module: 'performance', recordId: cycle._id, recordLabel: `Cycle: ${cycle.name}`, newValues: input });
  return cycle.toJSON();
};

export const updateCycle = async (ctx: RequestContext, id: string, input: CycleUpdateInput) => {
  const cycle = await findCycle(ctx, id);
  const status = cycle.status as CycleStatus;
  if (status === 'COMPLETED') throw unprocessable('A completed cycle cannot be edited', 'CYCLE_COMPLETED');
  if ((input.ratingScale || input.goalWeightage !== undefined) && !SCALE_EDITABLE_STAGES.includes(status)) {
    throw unprocessable('The rating scale and goal weightage are locked once reviews have started', 'SCALE_LOCKED');
  }
  assertScale(input.ratingScale);
  if (input.departmentIds) await assertIdsInOrg(ctx.organizationId, DepartmentModel as never, input.departmentIds, 'departments');

  const start = input.startDate ?? toDateKey(cycle.startDate);
  const end = input.endDate ?? toDateKey(cycle.endDate);
  if (end <= start) throw badRequest('End must be after start', 'VALIDATION_ERROR', [{ path: 'endDate', message: 'End must be after start' }]);

  const before = cycle.toObject() as unknown as Record<string, unknown>;
  const { startDate, endDate, selfReviewDue, managerReviewDue, ...rest } = input;
  cycle.set(rest);
  if (startDate) cycle.startDate = dateOnly(startDate);
  if (endDate) cycle.endDate = dateOnly(endDate);
  // `null` clears an optional due date; `undefined` leaves it unchanged.
  if (selfReviewDue !== undefined) cycle.set('selfReviewDue', selfReviewDue ? dateOnly(selfReviewDue) : null);
  if (managerReviewDue !== undefined) cycle.set('managerReviewDue', managerReviewDue ? dateOnly(managerReviewDue) : null);
  await cycle.save();
  await audit(ctx, {
    action: 'RECORD_UPDATED',
    module: 'performance',
    recordId: cycle._id,
    recordLabel: `Cycle: ${cycle.name}`,
    ...diff(before, input as Record<string, unknown>),
  });
  return cycle.toJSON();
};

export const removeCycle = async (ctx: RequestContext, id: string) => {
  const cycle = await findCycle(ctx, id);
  if (cycle.status !== 'DRAFT') throw unprocessable('Only draft cycles can be deleted', 'CYCLE_ACTIVE');
  cycle.deletedAt = new Date();
  await cycle.save();
  await audit(ctx, { action: 'RECORD_DELETED', module: 'performance', recordId: cycle._id, recordLabel: `Cycle: ${cycle.name}` });
};

/**
 * Creates a PENDING_SELF review for every active employee in the cycle's
 * scope (its departments, or everyone). Idempotent: existing reviews are kept.
 */
export const generateReviews = async (ctx: RequestContext, cycle: { _id: Id; name: string; departmentIds?: Id[] | null }) => {
  const employees = await EmployeeModel.find({
    organizationId: ctx.organizationId,
    ...ACTIVE_EMPLOYEE,
    ...(cycle.departmentIds?.length ? { departmentId: { $in: cycle.departmentIds } } : {}),
  })
    .select('_id managerId userId')
    .lean();
  if (!employees.length) return { created: 0, total: 0 };

  const result = await PerformanceReviewModel.bulkWrite(
    employees.map((e) => ({
      updateOne: {
        filter: { organizationId: ctx.organizationId, cycleId: cycle._id, employeeId: e._id },
        update: {
          $setOnInsert: {
            organizationId: ctx.organizationId,
            cycleId: cycle._id,
            employeeId: e._id,
            managerId: e.managerId ?? null,
            status: 'PENDING_SELF' as const,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  const createdIdx = Object.keys(result.upsertedIds ?? {}).map(Number);
  const newUsers = createdIdx.map((i) => employees[i]?.userId).filter((u): u is Id => !!u);
  await notify({
    organizationId: ctx.organizationId,
    userIds: newUsers,
    type: 'PERFORMANCE_REVIEW',
    title: 'Self review open',
    message: `Your self review for "${cycle.name}" is now open.`,
    link: '/performance/reviews',
    excludeUserId: ctx.userId,
  });
  return { created: createdIdx.length, total: employees.length };
};

export const advanceCycle = async (ctx: RequestContext, id: string, input: { status?: CycleStatus }) => {
  const cycle = await findCycle(ctx, id);
  const from = cycle.status as CycleStatus;
  const to = input.status ?? PERFORMANCE_CYCLE_WORKFLOW.next(from)[0];
  if (!to) throw unprocessable('This cycle is already completed', 'CYCLE_COMPLETED');
  if (!PERFORMANCE_CYCLE_WORKFLOW.can(from, to)) throw invalidTransition('Performance cycle', from, to);

  // Compare-and-set so concurrent advances cannot skip or repeat a stage.
  const updated = await PerformanceCycleModel.findOneAndUpdate(
    { _id: cycle._id, organizationId: ctx.organizationId, deletedAt: null, status: from },
    { status: to },
    { new: true },
  );
  if (!updated) throw conflict('The cycle was changed by someone else; reload and try again');

  let reviews: { created: number; total: number } | undefined;
  if (to === 'SELF_REVIEW') reviews = await generateReviews(ctx, updated);
  if (to === 'GOAL_SETTING') {
    const emps = await EmployeeModel.find({
      organizationId: ctx.organizationId,
      ...ACTIVE_EMPLOYEE,
      ...(updated.departmentIds?.length ? { departmentId: { $in: updated.departmentIds } } : {}),
    })
      .select('userId')
      .lean();
    await notify({
      organizationId: ctx.organizationId,
      userIds: emps.map((e) => e.userId),
      type: 'GOAL',
      title: 'Goal setting has started',
      message: `Goal setting for "${updated.name}" is open. Add or review your goals.`,
      link: '/performance/goals',
      excludeUserId: ctx.userId,
    });
  }
  await audit(ctx, {
    action: 'RECORD_UPDATED',
    module: 'performance',
    recordId: updated._id,
    recordLabel: `Cycle: ${updated.name}`,
    oldValues: { status: from },
    newValues: { status: to },
  });
  return { ...(updated.toJSON() as Record<string, unknown>), ...(reviews ? { reviewsCreated: reviews.created } : {}) };
};

export const regenerateReviews = async (ctx: RequestContext, id: string) => {
  const cycle = await findCycle(ctx, id);
  if (!REVIEW_OPEN_STAGES.includes(cycle.status as CycleStatus)) {
    throw unprocessable('Reviews can only be generated while the review stage is open', 'CYCLE_NOT_IN_REVIEW');
  }
  return generateReviews(ctx, cycle);
};

/* ================================= Reviews =============================== */

type ReviewLean = PerformanceReview & { _id: Id };

/**
 * The reviewed employee never sees the manager/HR sections (or scores) until
 * the review is completed.
 */
const redact = <T extends Record<string, unknown>>(ctx: RequestContext, review: T): T => {
  if (review.status === 'COMPLETED' || !ctx.employeeId || !sameId(review.employeeId, ctx.employeeId)) return review;
  return { ...review, managerReview: null, hrReview: null, goalScore: null, finalRating: null, finalRatingLabel: null };
};

const REVIEW_POPULATE = [
  { path: 'employeeId', select: 'employeeId firstName lastName profilePhoto departmentId designationId' },
  { path: 'managerId', select: 'employeeId firstName lastName' },
  {
    path: 'cycleId',
    select: 'name status ratingScale goalWeightage competencies startDate endDate selfReviewDue managerReviewDue',
  },
];

export const listReviews = async (
  ctx: RequestContext,
  q: PaginationQuery & { cycleId?: string; status?: string; employeeId?: string; scope?: string },
) => {
  const scope = await resolveEmployeeScope(ctx, 'performance:read', q.scope);
  let filter: FilterQuery<PerformanceReview> = { organizationId: ctx.organizationId };
  if (q.cycleId) filter.cycleId = toObjectId(q.cycleId);
  if (q.status) filter.status = q.status;
  if (scope.employeeIds !== null) {
    // Reviewers also see reviews assigned to them (even outside their reporting line).
    filter = q.scope === 'me' || !ctx.employeeId
      ? applyScope(filter, scope)
      : { ...filter, $or: [{ employeeId: { $in: scope.employeeIds } }, { managerId: ctx.employeeId }] };
  }
  if (q.employeeId) filter = { ...filter, $and: [{ employeeId: toObjectId(q.employeeId) }] };

  const page = await paginate(PerformanceReviewModel, {
    filter,
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['status', 'createdAt', 'finalRating', 'completedAt'], { createdAt: -1 }),
    populate: REVIEW_POPULATE,
  });
  return { ...page, items: page.items.map((r) => redact(ctx, r as unknown as Record<string, unknown>)) };
};

type ReviewRole = 'self' | 'manager' | 'hr';

const reviewRole = async (ctx: RequestContext, review: Pick<ReviewLean, 'employeeId' | 'managerId'>): Promise<ReviewRole> => {
  if (ctx.employeeId && sameId(review.employeeId, ctx.employeeId)) return 'self';
  if (can(ctx, 'performance:read') || can(ctx, 'performance:review')) return 'hr';
  if (ctx.employeeId && sameId(review.managerId, ctx.employeeId)) return 'manager';
  if (can(ctx, 'team:view') && (await isManagerOf(ctx, review.employeeId))) return 'manager';
  throw forbidden('You do not have access to this review');
};

export const getReview = async (ctx: RequestContext, id: string) => {
  const review = await PerformanceReviewModel.findOne({ _id: id, organizationId: ctx.organizationId }).lean();
  if (!review) throw notFound('Performance review');
  await reviewRole(ctx, review);
  const populated = await PerformanceReviewModel.findOne({ _id: review._id, organizationId: ctx.organizationId })
    .populate(REVIEW_POPULATE)
    .lean();
  const goals = await GoalModel.find({
    organizationId: ctx.organizationId,
    employeeId: review.employeeId,
    cycleId: review.cycleId,
    deletedAt: null,
  })
    .select('title category weight progress status dueDate')
    .sort({ createdAt: 1 })
    .lean();
  return { ...redact(ctx, populated as unknown as Record<string, unknown>), goals };
};

/** All ratings lie within the cycle scale; goal ratings reference the employee's cycle goals. */
const assertRatings = async (
  ctx: RequestContext,
  review: Pick<ReviewLean, 'employeeId' | 'cycleId'>,
  input: { ratings: { goalId?: string; rating: number }[]; overallRating?: number },
  scale: RatingScale,
) => {
  const errors: { path: string; message: string }[] = [];
  const msg = `Rating must be between ${scale.min} and ${scale.max}`;
  input.ratings.forEach((r, i) => {
    if (r.rating < scale.min || r.rating > scale.max) errors.push({ path: `ratings.${i}.rating`, message: msg });
  });
  if (input.overallRating !== undefined && (input.overallRating < scale.min || input.overallRating > scale.max)) {
    errors.push({ path: 'overallRating', message: msg });
  }
  if (errors.length) throw badRequest(msg, 'RATING_OUT_OF_SCALE', errors);

  const goalIds = [...new Set(input.ratings.map((r) => r.goalId).filter((g): g is string => !!g))];
  if (goalIds.length) {
    const count = await GoalModel.countDocuments({
      _id: { $in: goalIds },
      organizationId: ctx.organizationId,
      employeeId: review.employeeId,
      cycleId: review.cycleId,
      deletedAt: null,
    });
    if (count !== goalIds.length) throw badRequest('One or more rated goals do not belong to this review', 'INVALID_REFERENCE');
  }
};

const loadReviewForAction = async (ctx: RequestContext, id: string, expected: ReviewStatus) => {
  const review = await PerformanceReviewModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!review) throw notFound('Performance review');
  const role = await reviewRole(ctx, review);
  const cycle = await PerformanceCycleModel.findOne({ _id: review.cycleId, organizationId: ctx.organizationId }).lean();
  if (!cycle) throw notFound('Performance cycle');
  if (!REVIEW_OPEN_STAGES.includes(cycle.status as CycleStatus)) {
    throw unprocessable('The review window of this cycle is not open', 'CYCLE_NOT_IN_REVIEW');
  }
  const from = review.status as ReviewStatus;
  if (from !== expected) {
    const to = PERFORMANCE_REVIEW_WORKFLOW.next(expected)[0] ?? expected;
    throw invalidTransition('Performance review', from, to);
  }
  return { review, role, cycle };
};

const section = (ctx: RequestContext, input: ReviewInput | HrReviewInput) => ({
  ratings: input.ratings.map((r) => ({
    goalId: r.goalId ? toObjectId(r.goalId) : undefined,
    competency: r.competency,
    rating: r.rating,
    comment: r.comment,
  })),
  overallRating: input.overallRating,
  strengths: input.strengths,
  improvements: input.improvements,
  comments: input.comments,
  submittedAt: new Date(),
  submittedBy: ctx.userId,
});

const transition = async (
  ctx: RequestContext,
  review: InstanceType<typeof PerformanceReviewModel>,
  from: ReviewStatus,
  to: ReviewStatus,
  set: Record<string, unknown>,
) => {
  if (!PERFORMANCE_REVIEW_WORKFLOW.can(from, to)) throw invalidTransition('Performance review', from, to);
  const updated = await PerformanceReviewModel.findOneAndUpdate(
    { _id: review._id, organizationId: ctx.organizationId, status: from },
    { ...set, status: to },
    { new: true },
  );
  if (!updated) throw conflict('The review was changed by someone else; reload and try again');
  await audit(ctx, {
    action: 'RECORD_UPDATED',
    module: 'performance',
    recordId: updated._id,
    recordLabel: 'Performance review',
    oldValues: { status: from },
    newValues: { status: to },
  });
  return updated;
};

const employeeUser = async (ctx: RequestContext, employeeId: unknown) =>
  (await userIdsForEmployees(ctx.organizationId, [toObjectId(refId(employeeId))]))[0] ?? null;

export const submitSelfReview = async (ctx: RequestContext, id: string, raw: ReviewInput) => {
  const input = reviewSubmitSchema.parse(raw);
  const { review, role, cycle } = await loadReviewForAction(ctx, id, 'PENDING_SELF');
  if (role !== 'self') throw forbidden('Only the employee can submit their self review');
  await assertRatings(ctx, review, input, scaleOf(cycle));
  const updated = await transition(ctx, review, 'PENDING_SELF', 'PENDING_MANAGER', { selfReview: section(ctx, input) });

  const managerUser = await managerUserId(ctx.organizationId, review.managerId);
  await notify({
    organizationId: ctx.organizationId,
    userIds: managerUser ? [managerUser] : await userIdsWithPermission(ctx.organizationId, 'performance:review'),
    type: 'PERFORMANCE_REVIEW',
    title: 'Self review submitted',
    message: `${ctx.userName} submitted their self review for "${cycle.name}". Your review is due.`,
    link: `/performance/reviews/${review._id}`,
    excludeUserId: ctx.userId,
  });
  return redact(ctx, updated.toJSON() as Record<string, unknown>);
};

export const submitManagerReview = async (ctx: RequestContext, id: string, raw: ReviewInput) => {
  const input = reviewSubmitSchema.parse(raw);
  const { review, role, cycle } = await loadReviewForAction(ctx, id, 'PENDING_MANAGER');
  if (role === 'self') throw forbidden('You cannot write the manager review of your own appraisal');
  const isAssignedManager = !!ctx.employeeId && sameId(review.managerId, ctx.employeeId);
  const isHr = can(ctx, 'performance:review');
  if (!isAssignedManager && !isHr && role !== 'manager') throw forbidden('Only the employee’s manager or HR can submit this review');
  await assertRatings(ctx, review, input, scaleOf(cycle));
  const updated = await transition(ctx, review, 'PENDING_MANAGER', 'PENDING_HR', { managerReview: section(ctx, input) });

  await notify({
    organizationId: ctx.organizationId,
    userIds: await userIdsWithPermission(ctx.organizationId, 'performance:review'),
    type: 'PERFORMANCE_REVIEW',
    title: 'Review awaiting HR',
    message: `A manager review for "${cycle.name}" is ready for HR review.`,
    link: `/performance/reviews/${review._id}`,
    excludeUserId: ctx.userId,
  });
  return updated.toJSON();
};

export const submitHrReview = async (ctx: RequestContext, id: string, raw: HrReviewInput) => {
  const input = hrReviewSubmitSchema.parse(raw);
  const { review, role, cycle } = await loadReviewForAction(ctx, id, 'PENDING_HR');
  if (role === 'self') throw forbidden('You cannot finalize your own review');
  const scale = scaleOf(cycle);
  await assertRatings(ctx, review, input, scale);

  const goals = await GoalModel.find({
    organizationId: ctx.organizationId,
    employeeId: review.employeeId,
    cycleId: review.cycleId,
    deletedAt: null,
    status: { $ne: 'CANCELLED' },
  })
    .select('weight progress')
    .lean();
  const ratingFor = (goalId: Id) => {
    const pick = (ratings: { goalId?: unknown; rating?: number | null }[] | undefined) =>
      ratings?.find((r) => sameId(r.goalId, goalId) && typeof r.rating === 'number')?.rating;
    return pick(input.ratings) ?? pick(review.managerReview?.ratings) ?? null;
  };
  const overall = input.overallRating ?? review.managerReview?.overallRating;
  if (overall === undefined || overall === null) throw unprocessable('The manager review has no overall rating', 'MISSING_RATING');

  const score = computeFinalRating({
    goals: goals.map((g) => ({ weight: g.weight ?? 0, progress: g.progress ?? 0, rating: ratingFor(g._id) })),
    overallRating: overall,
    goalWeightage: cycle.goalWeightage ?? 70,
    scale,
  });
  const updated = await transition(ctx, review, 'PENDING_HR', 'COMPLETED', {
    hrReview: section(ctx, input),
    goalScore: score.goalScore,
    finalRating: score.finalRating,
    finalRatingLabel: score.finalRatingLabel,
    completedAt: new Date(),
  });

  await notify({
    organizationId: ctx.organizationId,
    userIds: [await employeeUser(ctx, review.employeeId), await managerUserId(ctx.organizationId, review.managerId)],
    type: 'PERFORMANCE_REVIEW',
    title: 'Performance review completed',
    message: `The performance review for "${cycle.name}" has been completed.`,
    link: `/performance/reviews/${review._id}`,
    excludeUserId: ctx.userId,
  });
  return updated.toJSON();
};

/* ================================ Feedback =============================== */

type Visibility = 'PRIVATE' | 'MANAGER' | 'PUBLIC';

export const giveFeedback = async (ctx: RequestContext, input: FeedbackInput) => {
  if (!ctx.employeeId) throw forbidden('Only employees can give feedback');
  if (ctx.employeeId.equals(input.employeeId)) throw badRequest('You cannot give feedback to yourself', 'SELF_FEEDBACK');
  const target = await EmployeeModel.findOne({ _id: input.employeeId, organizationId: ctx.organizationId, ...ACTIVE_EMPLOYEE })
    .select('userId firstName')
    .lean();
  if (!target) throw badRequest('Employee not found', 'INVALID_REFERENCE', [{ path: 'employeeId', message: 'Employee not found' }]);
  const doc = await FeedbackModel.create({
    ...input,
    organizationId: ctx.organizationId,
    fromUserId: ctx.userId,
    fromName: ctx.userName,
  });
  await notify({
    organizationId: ctx.organizationId,
    userIds: [target.userId],
    type: 'GENERAL',
    title: input.type === 'PRAISE' ? 'You received praise' : 'You received feedback',
    message: `${ctx.userName} shared feedback with you.`,
    link: '/performance/feedback',
    excludeUserId: ctx.userId,
  });
  return doc.toJSON();
};

/**
 * Feedback visibility: the recipient and HR (`performance:read`) see
 * everything, the recipient's manager sees MANAGER + PUBLIC, everyone else
 * PUBLIC only. Authors always see what they wrote. `given=true` lists the
 * caller's own authored feedback.
 */
export const listFeedback = async (ctx: RequestContext, q: PaginationQuery & { employeeId?: string; given?: boolean }) => {
  const base: FilterQuery<Feedback> = { organizationId: ctx.organizationId };
  let filter: FilterQuery<Feedback>;
  if (q.given) {
    filter = { ...base, fromUserId: ctx.userId };
  } else {
    const target = q.employeeId ?? (ctx.employeeId ? String(ctx.employeeId) : null);
    if (!target) return { items: [], pagination: { page: q.page, limit: q.limit, total: 0, totalPages: 1 } };
    const exists = await EmployeeModel.exists({ _id: target, organizationId: ctx.organizationId });
    if (!exists) throw notFound('Employee');
    let visible: Visibility[];
    if ((ctx.employeeId && ctx.employeeId.equals(target)) || can(ctx, 'performance:read')) visible = ['PRIVATE', 'MANAGER', 'PUBLIC'];
    else if (await isManagerOf(ctx, target)) visible = ['MANAGER', 'PUBLIC'];
    else visible = ['PUBLIC'];
    filter = { ...base, employeeId: toObjectId(target), $or: [{ visibility: { $in: visible } }, { fromUserId: ctx.userId }] };
  }
  return paginate(FeedbackModel, {
    filter,
    page: q.page,
    limit: q.limit,
    sort: { createdAt: -1 },
    populate: [{ path: 'employeeId', select: 'employeeId firstName lastName profilePhoto' }],
  });
};

/* ================================ Summary ================================ */

export const performanceSummary = async (ctx: RequestContext, q: { cycleId?: string }) => {
  // HR (read / review) and cycle administrators see the org-wide aggregate.
  // Managers also hold `performance:create` (to set team goals), so for
  // `team:view` holders without read/review the summary stays team-scoped.
  const hrWide = can(ctx, 'performance:read') || can(ctx, 'performance:review');
  const team = can(ctx, 'team:view');
  const orgWide = hrWide || (can(ctx, 'performance:create') && !team);
  if (!orgWide && !team) throw forbidden();
  const scope = orgWide
    ? { employeeIds: null }
    : await resolveEmployeeScope(ctx, 'performance:read', 'team');

  const cycle = q.cycleId
    ? await PerformanceCycleModel.findOne({ _id: q.cycleId, organizationId: ctx.organizationId, deletedAt: null }).lean()
    : ((await PerformanceCycleModel.findOne({ organizationId: ctx.organizationId, deletedAt: null, status: { $ne: 'DRAFT' } })
        .sort({ startDate: -1 })
        .lean()) ??
      (await PerformanceCycleModel.findOne({ organizationId: ctx.organizationId, deletedAt: null }).sort({ startDate: -1 }).lean()));
  if (q.cycleId && !cycle) throw notFound('Performance cycle');
  if (!cycle) {
    return {
      cycle: null,
      reviews: { total: 0, byStatus: {} },
      ratingDistribution: [],
      averageFinalRating: null,
      goals: { total: 0, averageProgress: 0, byStatus: {} },
    };
  }

  const empMatch = scope.employeeIds === null ? {} : { employeeId: { $in: scope.employeeIds } };
  const scale = scaleOf(cycle);
  const [byStatus, ratings, goalStats, goalByStatus] = await Promise.all([
    PerformanceReviewModel.aggregate<{ _id: string; count: number }>([
      { $match: { organizationId: ctx.organizationId, cycleId: cycle._id, ...empMatch } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    PerformanceReviewModel.aggregate<{ _id: number; count: number; sum: number }>([
      { $match: { organizationId: ctx.organizationId, cycleId: cycle._id, status: 'COMPLETED', finalRating: { $ne: null }, ...empMatch } },
      { $group: { _id: { $round: ['$finalRating', 0] }, count: { $sum: 1 }, sum: { $sum: '$finalRating' } } },
    ]),
    GoalModel.aggregate<{ _id: null; total: number; avg: number }>([
      { $match: { organizationId: ctx.organizationId, cycleId: cycle._id, deletedAt: null, status: { $ne: 'CANCELLED' }, ...empMatch } },
      { $group: { _id: null, total: { $sum: 1 }, avg: { $avg: '$progress' } } },
    ]),
    GoalModel.aggregate<{ _id: string; count: number }>([
      { $match: { organizationId: ctx.organizationId, cycleId: cycle._id, deletedAt: null, ...empMatch } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const ratedCount = ratings.reduce((s, r) => s + r.count, 0);
  const distribution: { value: number; label: string | null; count: number }[] = [];
  for (let v = scale.min; v <= scale.max; v++) {
    distribution.push({
      value: v,
      label: scale.labels.find((l) => l.value === v)?.label ?? null,
      count: ratings.find((r) => r._id === v)?.count ?? 0,
    });
  }
  return {
    cycle: { _id: cycle._id, name: cycle.name, status: cycle.status, ratingScale: scale, goalWeightage: cycle.goalWeightage },
    reviews: {
      total: byStatus.reduce((s, r) => s + r.count, 0),
      byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.count])),
    },
    ratingDistribution: distribution,
    averageFinalRating: ratedCount ? round2(ratings.reduce((s, r) => s + r.sum, 0) / ratedCount) : null,
    goals: {
      total: goalStats[0]?.total ?? 0,
      averageProgress: round2(goalStats[0]?.avg ?? 0),
      byStatus: Object.fromEntries(goalByStatus.map((r) => [r._id, r.count])),
    },
  };
};
