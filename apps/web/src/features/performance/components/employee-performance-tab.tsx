import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, MessageSquarePlus, Plus, Target } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, ErrorState, ProgressBar, Skeleton, StatCard } from '@/components/ui/display';
import { ApiError } from '@/lib/api';
import { formatDate, fullName } from '@/lib/utils';
import { useEmployee } from '@/features/employees/api';
import { usePermissions } from '@/store/auth';
import { scaleOf, useFeedback, useGoals, useReviews } from '../api';
import { FeedbackList, GiveFeedbackModal } from './feedback';
import { GoalFormDrawer } from './goal-form';
import { CategoryBadge, progressTone, RatingValue } from './perf-ui';

const isForbidden = (e: unknown) => e instanceof ApiError && e.status === 403;

const Forbidden = ({ what }: { what: string }) => <EmptyState icon={<Lock className="h-6 w-6" />} title={`${what} are private`} description="You do not have access to this information." />;

const ListSkeleton = () => (
  <div className="space-y-3 p-5" role="status" aria-label="Loading">
    {Array.from({ length: 3 }).map((_, i) => (
      <Skeleton key={i} className="h-12" />
    ))}
  </div>
);

const EmployeePerformanceTab = ({ employeeId }: { employeeId: string }) => {
  const { user, can, isManager, hasEmployee } = usePermissions();
  const navigate = useNavigate();
  const isSelf = user?.employeeId === employeeId;
  const [creatingGoal, setCreatingGoal] = useState(false);
  const [giving, setGiving] = useState(false);
  // Already cached by the profile page that hosts this tab.
  const employee = useEmployee(employeeId);
  const name = fullName(employee.data);

  const goals = useGoals({ employeeId, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' });
  const reviews = useReviews({ employeeId, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' });
  const feedback = useFeedback({ employeeId, limit: 10 });

  const activeGoals = (goals.data?.data ?? []).filter((g) => g.status !== 'CANCELLED');
  const avgProgress = activeGoals.length ? Math.round(activeGoals.reduce((s, g) => s + g.progress, 0) / activeGoals.length) : null;
  const latestCompleted = (reviews.data?.data ?? []).find((r) => r.status === 'COMPLETED' && r.finalRating !== null && r.finalRating !== undefined);
  const canAddGoal = isSelf || isManager || (can('performance:create') && can('performance:read'));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Active goals" value={goals.data ? activeGoals.length : '—'} loading={goals.isLoading} icon={<Target className="h-5 w-5" />} />
        <StatCard label="Average progress" value={avgProgress === null ? '—' : `${avgProgress}%`} loading={goals.isLoading} tone="blue" />
        <StatCard
          label="Latest rating"
          value={latestCompleted ? <RatingValue value={latestCompleted.finalRating} scale={scaleOf(latestCompleted.cycleId?.ratingScale)} className="text-xl" /> : '—'}
          hint={latestCompleted?.cycleId?.name}
          loading={reviews.isLoading}
          tone="amber"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Goals"
            actions={
              canAddGoal ? (
                <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setCreatingGoal(true)}>
                  Add goal
                </Button>
              ) : undefined
            }
          />
          {goals.isLoading ? (
            <ListSkeleton />
          ) : isForbidden(goals.error) ? (
            <Forbidden what="Goals" />
          ) : goals.error ? (
            <ErrorState message={goals.error.message} onRetry={() => goals.refetch()} />
          ) : !goals.data?.data.length ? (
            <EmptyState icon={<Target className="h-6 w-6" />} title="No goals" description={isSelf ? 'You have no goals yet.' : 'No goals are visible for this employee.'} />
          ) : (
            <ul className="divide-y divide-line">
              {goals.data.data.map((g) => (
                <li key={g._id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link to={`/performance/goals/${g._id}`} className="min-w-0 truncate text-sm font-medium text-fg hover:underline">
                      {g.title}
                    </Link>
                    <span className="flex items-center gap-1.5">
                      <CategoryBadge category={g.category} />
                      <StatusBadge status={g.status} />
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <ProgressBar value={g.progress} tone={progressTone(g)} className="h-1.5" />
                    <span className="w-10 shrink-0 text-right text-xs font-medium text-fg tabular-nums">{g.progress}%</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {[g.cycleId?.name, g.weight ? `${g.weight}% weight` : null, g.dueDate ? `Due ${formatDate(g.dueDate)}` : null].filter(Boolean).join(' · ') || 'No cycle'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Reviews" />
          {reviews.isLoading ? (
            <ListSkeleton />
          ) : isForbidden(reviews.error) ? (
            <Forbidden what="Reviews" />
          ) : reviews.error ? (
            <ErrorState message={reviews.error.message} onRetry={() => reviews.refetch()} />
          ) : !reviews.data?.data.length ? (
            <EmptyState title="No reviews" description="Reviews appear when a performance cycle reaches the review stage." />
          ) : (
            <ul className="divide-y divide-line">
              {reviews.data.data.map((r) => (
                <li key={r._id}>
                  <button type="button" onClick={() => navigate(`/performance/reviews/${r._id}`)} className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3 text-left hover:bg-surface-2 focus:bg-surface-2 focus:outline-none">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">{r.cycleId?.name ?? 'Review'}</span>
                      <span className="block text-xs text-muted">{r.completedAt ? `Completed ${formatDate(r.completedAt)}` : `Opened ${formatDate(r.createdAt)}`}</span>
                    </span>
                    <span className="flex items-center gap-3 text-sm">
                      {r.status === 'COMPLETED' && <RatingValue value={r.finalRating} scale={scaleOf(r.cycleId?.ratingScale)} />}
                      <StatusBadge status={r.status} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Feedback"
          description={isSelf ? 'Feedback you received, including private notes.' : 'Feedback visible to you under each note’s visibility setting.'}
          actions={
            !isSelf && hasEmployee ? (
              <Button size="sm" variant="outline" icon={<MessageSquarePlus className="h-4 w-4" />} onClick={() => setGiving(true)}>
                Give feedback
              </Button>
            ) : undefined
          }
        />
        <FeedbackList query={feedback} mode="received" emptyTitle="No visible feedback" emptyDescription={isSelf ? 'Feedback from colleagues appears here.' : 'There is no feedback you are allowed to see.'} />
      </Card>

      <GoalFormDrawer open={creatingGoal} onClose={() => setCreatingGoal(false)} defaultEmployeeId={employeeId} defaultEmployeeLabel={name || undefined} />
      <GiveFeedbackModal open={giving} onClose={() => setGiving(false)} employeeId={employeeId} employeeName={name || undefined} />
    </div>
  );
};

export default EmployeePerformanceTab;
