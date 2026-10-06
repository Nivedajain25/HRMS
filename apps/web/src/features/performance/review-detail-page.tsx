import { Link, useNavigate, useParams } from 'react-router-dom';
import { Award, ClipboardCheck, Info, Lock } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader, PageSkeleton, PersonCell, Skeleton } from '@/components/ui/display';
import { ApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { formatDate, formatDateTime, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { scaleOf, useCycle, useReview, type RatingScale, type ReviewDetail, type ReviewStage } from './api';
import { GoalMeta, ReviewForm, ReviewSectionView } from './components/review-form';
import { RatingValue, Stepper } from './components/perf-ui';

const REVIEW_OPEN_STAGES = ['SELF_REVIEW', 'MANAGER_REVIEW', 'HR_REVIEW'];
const STATUS_INDEX: Record<string, number> = { PENDING_SELF: 0, PENDING_MANAGER: 1, PENDING_HR: 2, COMPLETED: 4 };

const FinalResult = ({ review, scale, goalWeightage }: { review: ReviewDetail; scale: RatingScale; goalWeightage: number }) => {
  if (review.finalRating === null || review.finalRating === undefined) return null;
  const overall = review.hrReview?.overallRating ?? review.managerReview?.overallRating;
  const pct = scale.max > scale.min ? ((review.finalRating - scale.min) / (scale.max - scale.min)) * 100 : 0;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
          <Award className="h-8 w-8" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Final rating</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-3xl font-semibold tracking-tight text-fg tabular-nums">
            {review.finalRating.toFixed(2)}
            <span className="text-base font-normal text-muted">/ {scale.max}</span>
            {review.finalRatingLabel && <span className="text-lg font-medium text-brand-700 dark:text-brand-300">{review.finalRatingLabel}</span>}
          </p>
          <div className="mt-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`${review.finalRating} on a scale of ${scale.min} to ${scale.max}`}>
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
          </div>
        </div>
        <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2 text-sm sm:text-right">
          <dt className="text-muted">Goal score</dt>
          <dd className="font-medium text-fg tabular-nums">{review.goalScore ?? '—'}</dd>
          <dt className="text-muted">Overall rating</dt>
          <dd className="font-medium text-fg tabular-nums">{overall ?? '—'}</dd>
          <dt className="text-muted">Goal weightage</dt>
          <dd className="font-medium text-fg tabular-nums">{review.goalScore !== null && review.goalScore !== undefined ? `${goalWeightage}%` : '0% (no goals)'}</dd>
        </dl>
      </div>
      {review.completedAt && <p className="border-t border-line bg-surface-2 px-5 py-2.5 text-xs text-muted">Completed {formatDateTime(review.completedAt)}</p>}
    </Card>
  );
};

export const ReviewDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const review = useReview(id);
  const cycle = useCycle(review.data?.cycleId?._id);
  const { user, can, isManager } = usePermissions();

  if (review.isLoading) return <PageSkeleton />;
  if (review.error instanceof ApiError && (review.error.status === 403 || review.error.status === 404)) {
    return (
      <EmptyState
        className="card"
        icon={<Lock className="h-6 w-6" />}
        title={review.error.status === 404 ? 'Review not found' : 'You cannot view this review'}
        description={review.error.message}
        action={<Button onClick={() => navigate('/performance/reviews')}>Back to reviews</Button>}
      />
    );
  }
  if (review.error || !review.data) return <ErrorState className="card" message={review.error?.message} onRetry={() => review.refetch()} />;

  const r = review.data;
  const scale = scaleOf(cycle.data?.ratingScale ?? r.cycleId?.ratingScale);
  const goalWeightage = cycle.data?.goalWeightage ?? r.cycleId?.goalWeightage ?? 70;
  const competencies = cycle.data?.competencies ?? [];
  const cycleStatus = cycle.data?.status ?? r.cycleId?.status;
  const windowOpen = !!cycleStatus && REVIEW_OPEN_STAGES.includes(cycleStatus);
  const isSelf = !!user?.employeeId && r.employeeId?._id === user.employeeId;
  const isAssignedManager = !!user?.employeeId && r.managerId?._id === user.employeeId;

  let stage: ReviewStage | null = null;
  if (r.status === 'PENDING_SELF' && isSelf) stage = 'self';
  else if (r.status === 'PENDING_MANAGER' && !isSelf && (isAssignedManager || can('performance:review') || isManager)) stage = 'manager';
  else if (r.status === 'PENDING_HR' && !isSelf && can('performance:review')) stage = 'hr';

  const waitingOn: Record<string, string> = {
    PENDING_SELF: isSelf ? 'you' : `${fullName(r.employeeId)} (self review)`,
    PENDING_MANAGER: r.managerId ? `${fullName(r.managerId)} (manager review)` : 'the manager review',
    PENDING_HR: 'HR finalization',
  };

  const steps = [
    { key: 'self', label: 'Self review', hint: r.selfReview?.submittedAt ? formatDate(r.selfReview.submittedAt) : cycle.data?.selfReviewDue ? `Due ${formatDate(cycle.data.selfReviewDue)}` : undefined },
    {
      key: 'manager',
      label: 'Manager review',
      hint: r.managerReview?.submittedAt ? formatDate(r.managerReview.submittedAt) : cycle.data?.managerReviewDue ? `Due ${formatDate(cycle.data.managerReviewDue)}` : undefined,
    },
    { key: 'hr', label: 'HR review', hint: r.hrReview?.submittedAt ? formatDate(r.hrReview.submittedAt) : undefined },
    { key: 'done', label: 'Completed', hint: r.completedAt ? formatDate(r.completedAt) : undefined },
  ];

  const hiddenForSelf = isSelf && r.status !== 'COMPLETED' && r.status !== 'PENDING_SELF';

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Reviews', to: '/performance/reviews' }, { label: fullName(r.employeeId) || 'Review' }]}
        title={isSelf ? 'My performance review' : `${fullName(r.employeeId)}'s review`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {r.cycleId?.name ?? 'Cycle'}
            {r.cycleId && (
              <span className="text-muted">
                · {formatDate(r.cycleId.startDate)} – {formatDate(r.cycleId.endDate)}
              </span>
            )}
            <StatusBadge status={r.status} />
          </span>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardBody>
            <Stepper steps={steps} current={STATUS_INDEX[r.status] ?? 0} label="Review progress" />
          </CardBody>
        </Card>

        {r.status === 'COMPLETED' && <FinalResult review={r} scale={scale} goalWeightage={goalWeightage} />}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {stage && windowOpen && cycle.isLoading && <Skeleton className="h-96" />}
            {stage && windowOpen && !cycle.isLoading && (
              <ReviewForm key={`${r._id}-${stage}-${competencies.join('|')}`} review={r} stage={stage} scale={scale} competencies={competencies} goalWeightage={goalWeightage} />
            )}
            {stage && !windowOpen && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                The review window of this cycle is not open{cycleStatus ? ` (cycle is in ${label(cycleStatus).toLowerCase()})` : ''}. Submissions are accepted during the review stages.
              </p>
            )}
            {!stage && r.status !== 'COMPLETED' && (
              <p className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-fg-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                Waiting on {waitingOn[r.status]}.
              </p>
            )}
            {hiddenForSelf && (
              <p className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-fg-2">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                Your manager&apos;s and HR&apos;s assessments become visible once the review is completed.
              </p>
            )}

            {r.hrReview && <ReviewSectionView title="HR review" section={r.hrReview} goals={r.goals} scale={scale} />}
            {r.managerReview && <ReviewSectionView title="Manager review" section={r.managerReview} goals={r.goals} scale={scale} submittedByLabel={r.managerId ? fullName(r.managerId) : undefined} />}
            {r.selfReview && <ReviewSectionView title="Self review" section={r.selfReview} goals={r.goals} scale={scale} submittedByLabel={fullName(r.employeeId)} />}
            {!r.selfReview && !r.managerReview && !r.hrReview && !stage && (
              <EmptyState className="card" icon={<ClipboardCheck className="h-6 w-6" />} title="Nothing submitted yet" description="Submitted sections will appear here." />
            )}
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader title="People" />
              <CardBody className="space-y-4">
                {r.employeeId && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted">Employee</p>
                    <PersonCell name={fullName(r.employeeId)} subtitle={r.employeeId.employeeId} photo={r.employeeId.profilePhoto} to={`/employees/${r.employeeId._id}?tab=performance`} />
                  </div>
                )}
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted">Reviewing manager</p>
                  {r.managerId ? <PersonCell name={fullName(r.managerId)} subtitle={r.managerId.employeeId} /> : <p className="text-sm text-muted">None assigned — HR reviews directly.</p>}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Goals in this cycle" description={r.goals.length ? `${goalWeightage}% of the final rating` : undefined} />
              <CardBody>
                {r.goals.length ? (
                  <ul className="space-y-3">
                    {r.goals.map((g) => (
                      <li key={g._id} className={g.status === 'CANCELLED' ? 'opacity-60' : undefined}>
                        <Link to={`/performance/goals/${g._id}`} className="text-sm font-medium text-fg hover:underline">
                          {g.title}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                          <GoalMeta goal={g} />
                          {g.status === 'CANCELLED' && <StatusBadge status={g.status} />}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No goals were set for this cycle.</p>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Rating scale" />
              <CardBody>
                <ul className="space-y-1.5 text-sm">
                  {Array.from({ length: scale.max - scale.min + 1 }, (_, i) => scale.min + i).map((v) => (
                    <li key={v} className="flex items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-3 text-xs font-semibold text-fg tabular-nums">{v}</span>
                      <span className="text-fg-2">{scale.labels.find((l) => l.value === v)?.label ?? '—'}</span>
                    </li>
                  ))}
                </ul>
                {r.status === 'COMPLETED' && (
                  <p className="mt-4 text-xs text-muted">
                    Final: <RatingValue value={r.finalRating} scale={scale} />
                  </p>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
};
