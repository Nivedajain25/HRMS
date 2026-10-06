import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CycleStatus, ReviewStatus } from '@stencil/shared';
import { del, get, getPaged, patch, post } from '@/lib/api';

/* ------------------------------- Types ------------------------------- */

export type GoalCategory = 'KPI' | 'OKR' | 'DEVELOPMENT' | 'PROJECT' | 'OTHER';
export type GoalStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type FeedbackType = 'PRAISE' | 'CONSTRUCTIVE' | 'GENERAL';
export type FeedbackVisibility = 'PRIVATE' | 'MANAGER' | 'PUBLIC';

export interface PersonRef {
  _id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  profilePhoto?: string | null;
}

export interface RatingScale {
  min: number;
  max: number;
  labels: { value: number; label: string }[];
}

export interface Cycle {
  _id: string;
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  selfReviewDue?: string | null;
  managerReviewDue?: string | null;
  status: CycleStatus;
  ratingScale: RatingScale;
  goalWeightage: number;
  competencies: string[];
  departmentIds: ({ _id: string; name: string; code?: string } | string)[];
  reviewCounts?: Partial<Record<ReviewStatus, number>>;
  createdAt: string;
}

export interface KeyResult {
  title: string;
  progress: number;
}

export interface GoalUpdate {
  progress: number;
  status: GoalStatus;
  note?: string;
  by?: string;
  at: string;
}

export interface Goal {
  _id: string;
  title: string;
  description?: string;
  category: GoalCategory;
  weight: number;
  target?: string;
  metricUnit?: string;
  targetValue?: number | null;
  progress: number;
  dueDate?: string | null;
  status: GoalStatus;
  employeeId: PersonRef;
  managerId?: PersonRef | null;
  cycleId?: { _id: string; name: string; status: CycleStatus } | null;
  parentGoalId?: string | null;
  keyResults: KeyResult[];
  updates: GoalUpdate[];
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RatingEntry {
  goalId?: string | null;
  competency?: string | null;
  rating: number;
  comment?: string | null;
}

export interface ReviewSection {
  ratings: RatingEntry[];
  overallRating?: number | null;
  strengths?: string | null;
  improvements?: string | null;
  comments?: string | null;
  submittedAt?: string | null;
  submittedBy?: string | null;
}

export interface Review {
  _id: string;
  cycleId: { _id: string; name: string; status: CycleStatus; ratingScale?: Partial<RatingScale>; goalWeightage?: number; startDate: string; endDate: string } | null;
  employeeId: PersonRef | null;
  managerId?: PersonRef | null;
  status: ReviewStatus;
  selfReview?: ReviewSection | null;
  managerReview?: ReviewSection | null;
  hrReview?: ReviewSection | null;
  goalScore?: number | null;
  finalRating?: number | null;
  finalRatingLabel?: string | null;
  completedAt?: string | null;
  createdAt: string;
}

export interface ReviewGoal {
  _id: string;
  title: string;
  category: GoalCategory;
  weight: number;
  progress: number;
  status: GoalStatus;
  dueDate?: string | null;
}

export interface ReviewDetail extends Review {
  goals: ReviewGoal[];
}

export interface Feedback {
  _id: string;
  employeeId: PersonRef | null;
  fromUserId: string;
  fromName?: string;
  message: string;
  type: FeedbackType;
  visibility: FeedbackVisibility;
  createdAt: string;
}

export interface PerformanceSummary {
  cycle: { _id: string; name: string; status: CycleStatus; ratingScale: RatingScale; goalWeightage: number } | null;
  reviews: { total: number; byStatus: Partial<Record<ReviewStatus, number>> };
  ratingDistribution: { value: number; label: string | null; count: number }[];
  averageFinalRating: number | null;
  goals: { total: number; averageProgress: number; byStatus: Partial<Record<GoalStatus, number>> };
}

/* ----------------------------- Constants ----------------------------- */

export const DEFAULT_SCALE: RatingScale = { min: 1, max: 5, labels: [] };

/** Normalizes a (possibly partial) populated scale. */
export const scaleOf = (s?: Partial<RatingScale> | null): RatingScale => ({
  min: s?.min ?? 1,
  max: s?.max ?? 5,
  labels: (s?.labels ?? []).filter((l) => typeof l.value === 'number' && !!l.label),
});

/** Label of the nearest scale point (ties resolve to the lower point), mirroring the API. */
export const ratingLabel = (rating: number | null | undefined, scale: RatingScale): string | null => {
  if (rating === null || rating === undefined || !scale.labels.length) return null;
  let best = scale.labels[0]!;
  for (const l of scale.labels) {
    const d = Math.abs(l.value - rating);
    const bd = Math.abs(best.value - rating);
    if (d < bd || (d === bd && l.value < best.value)) best = l;
  }
  return best.label;
};

/* ----------------------------- Query keys ---------------------------- */

export const perfKeys = {
  all: ['performance'] as const,
  cycles: (q: object) => ['performance', 'cycles', q] as const,
  cycle: (id: string) => ['performance', 'cycle', id] as const,
  goals: (q: object) => ['performance', 'goals', q] as const,
  goal: (id: string) => ['performance', 'goal', id] as const,
  reviews: (q: object) => ['performance', 'reviews', q] as const,
  review: (id: string) => ['performance', 'review', id] as const,
  feedback: (q: object) => ['performance', 'feedback', q] as const,
  summary: (cycleId?: string) => ['performance', 'summary', cycleId ?? ''] as const,
};

/* ------------------------------- Cycles ------------------------------ */

export const useCycles = (query: object, enabled = true) =>
  useQuery({ queryKey: perfKeys.cycles(query), queryFn: () => getPaged<Cycle>('/performance/cycles', query), placeholderData: keepPreviousData, enabled });

/** Most recent 100 cycles, for pickers and filters. */
export const useCycleOptions = () =>
  useQuery({
    queryKey: perfKeys.cycles({ limit: 100, sortBy: 'startDate', sortOrder: 'desc' }),
    queryFn: () => getPaged<Cycle>('/performance/cycles', { limit: 100, sortBy: 'startDate', sortOrder: 'desc' }),
    staleTime: 60_000,
    select: (r) => r.data,
  });

export const useCycle = (id: string | undefined) =>
  useQuery({ queryKey: perfKeys.cycle(id ?? ''), queryFn: () => get<Cycle>(`/performance/cycles/${id}`), enabled: !!id });

const useInvalidatingMutation = <TVars, TRes>(fn: (v: TVars) => Promise<TRes>, silent = false) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    meta: silent ? { silent: true } : undefined,
    onSuccess: () => qc.invalidateQueries({ queryKey: perfKeys.all }),
  });
};

export const useSaveCycle = (id?: string) =>
  useInvalidatingMutation((input: Record<string, unknown>) => (id ? patch<Cycle>(`/performance/cycles/${id}`, input) : post<Cycle>('/performance/cycles', input)), true);

export const useDeleteCycle = () => useInvalidatingMutation((id: string) => del(`/performance/cycles/${id}`));

export const useAdvanceCycle = () =>
  useInvalidatingMutation((v: { id: string; status?: CycleStatus }) =>
    post<Cycle & { reviewsCreated?: number }>(`/performance/cycles/${v.id}/advance`, v.status ? { status: v.status } : {}),
  );

export const useGenerateReviews = () =>
  useInvalidatingMutation((id: string) => post<{ created: number; total: number }>(`/performance/cycles/${id}/generate-reviews`));

export const useSummary = (cycleId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: perfKeys.summary(cycleId),
    queryFn: () => get<PerformanceSummary>('/performance/summary', { cycleId: cycleId || undefined }),
    enabled,
    retry: false,
  });

/* -------------------------------- Goals ------------------------------ */

export const useGoals = (query: object, enabled = true) =>
  useQuery({ queryKey: perfKeys.goals(query), queryFn: () => getPaged<Goal>('/performance/goals', query), placeholderData: keepPreviousData, enabled, retry: false });

export const useGoal = (id: string | undefined) =>
  useQuery({ queryKey: perfKeys.goal(id ?? ''), queryFn: () => get<Goal>(`/performance/goals/${id}`), enabled: !!id, retry: false });

export const useSaveGoal = (id?: string) =>
  useInvalidatingMutation((input: Record<string, unknown>) => (id ? patch<Goal>(`/performance/goals/${id}`, input) : post<Goal>('/performance/goals', input)), true);

export const useGoalProgress = (id: string) =>
  useInvalidatingMutation(
    (input: { progress: number; status?: GoalStatus; note?: string; keyResults?: KeyResult[] }) => post<Goal>(`/performance/goals/${id}/progress`, input),
    true,
  );

/** Progress update used for one-click actions (cancel) where errors are toasted globally. */
export const useGoalStatusChange = () =>
  useInvalidatingMutation((v: { id: string; progress: number; status: GoalStatus; note?: string }) =>
    post<Goal>(`/performance/goals/${v.id}/progress`, { progress: v.progress, status: v.status, note: v.note }),
  );

export const useDeleteGoal = () => useInvalidatingMutation((id: string) => del(`/performance/goals/${id}`));

/* ------------------------------- Reviews ----------------------------- */

export const useReviews = (query: object, enabled = true) =>
  useQuery({ queryKey: perfKeys.reviews(query), queryFn: () => getPaged<Review>('/performance/reviews', query), placeholderData: keepPreviousData, enabled, retry: false });

export const useReview = (id: string | undefined) =>
  useQuery({ queryKey: perfKeys.review(id ?? ''), queryFn: () => get<ReviewDetail>(`/performance/reviews/${id}`), enabled: !!id, retry: false });

export type ReviewStage = 'self' | 'manager' | 'hr';

export const useSubmitReview = (id: string, stage: ReviewStage) =>
  useInvalidatingMutation((input: Record<string, unknown>) => post<Review>(`/performance/reviews/${id}/${stage}`, input), true);

/* ------------------------------ Feedback ----------------------------- */

export const useFeedback = (query: object, enabled = true) =>
  useQuery({ queryKey: perfKeys.feedback(query), queryFn: () => getPaged<Feedback>('/performance/feedback', query), placeholderData: keepPreviousData, enabled, retry: false });

export const useGiveFeedback = () => useInvalidatingMutation((input: Record<string, unknown>) => post<Feedback>('/performance/feedback', input), true);
