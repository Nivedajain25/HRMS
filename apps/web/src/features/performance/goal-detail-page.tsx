import { Link, useNavigate, useParams } from 'react-router-dom';
import { MoreHorizontal, Pencil, Target, TrendingUp } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DescriptionList, EmptyState, ErrorState, PageHeader, PageSkeleton, PersonCell, ProgressBar } from '@/components/ui/display';
import { Dropdown } from '@/components/ui/overlay';
import { ApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { cn, formatDate, formatDateTime, fullName } from '@/lib/utils';
import { useGoal } from './api';
import { isOverdue, useGoalActions } from './components/goal-card';
import { GoalHistory } from './components/goal-progress';
import { CategoryBadge, progressTone } from './components/perf-ui';

export const GoalDetailPage = () => {
  const { id } = useParams();
  const goal = useGoal(id);
  const navigate = useNavigate();
  const { menu, dialogs, abilities, openProgress, openEdit } = useGoalActions(goal.data, { onDeleted: () => navigate('/performance/goals') });

  if (goal.isLoading) return <PageSkeleton />;
  if (goal.error instanceof ApiError && (goal.error.status === 404 || goal.error.status === 403)) {
    return (
      <EmptyState
        className="card"
        icon={<Target className="h-6 w-6" />}
        title={goal.error.status === 404 ? 'Goal not found' : 'You cannot view this goal'}
        description={goal.error.message}
        action={<Button onClick={() => navigate('/performance/goals')}>Back to goals</Button>}
      />
    );
  }
  if (goal.error || !goal.data) return <ErrorState className="card" message={goal.error?.message} onRetry={() => goal.refetch()} />;
  const g = goal.data;
  const overdue = isOverdue(g);
  const extraMenu = menu.filter((m) => m.label !== 'Update progress' && m.label !== 'Edit goal');

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Goals', to: '/performance/goals' }, { label: g.title }]}
        title={g.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <CategoryBadge category={g.category} />
            <StatusBadge status={g.status} />
            {abilities.locked && <span className="text-xs">Cycle completed — read only</span>}
          </span>
        }
        actions={
          <>
            {abilities.canEdit && (
              <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={openEdit}>
                Edit
              </Button>
            )}
            {abilities.canProgress && (
              <Button icon={<TrendingUp className="h-4 w-4" />} onClick={openProgress}>
                {abilities.terminal ? 'Reopen' : 'Update progress'}
              </Button>
            )}
            <Dropdown
              label="More goal actions"
              items={extraMenu}
              trigger={
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong bg-surface text-fg-2 hover:bg-surface-2">
                  <MoreHorizontal className="h-4 w-4" />
                </span>
              }
            />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Progress" description={`Last updated ${formatDateTime(g.updatedAt)}`} />
            <CardBody className="space-y-5">
              <div>
                <div className="mb-2 flex items-end justify-between">
                  <span className="text-3xl font-semibold tracking-tight text-fg tabular-nums">{g.progress}%</span>
                  {g.targetValue !== undefined && g.targetValue !== null && (
                    <span className="text-sm text-muted">
                      Target {g.targetValue}
                      {g.metricUnit ? ` ${g.metricUnit}` : ''}
                    </span>
                  )}
                </div>
                <ProgressBar value={g.progress} tone={progressTone(g)} className="h-3" />
              </div>
              {g.keyResults.length > 0 && (
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-fg">Key results</h3>
                  <ul className="space-y-3">
                    {g.keyResults.map((k, i) => (
                      <li key={i}>
                        <div className="mb-1 flex items-start justify-between gap-3 text-sm">
                          <span className="text-fg-2">
                            {i + 1}. {k.title}
                          </span>
                          <span className="shrink-0 font-medium text-fg tabular-nums">{k.progress ?? 0}%</span>
                        </div>
                        <ProgressBar value={k.progress ?? 0} tone={(k.progress ?? 0) >= 100 ? 'green' : 'brand'} className="h-1.5" />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardBody>
          </Card>
          {g.description && (
            <Card>
              <CardHeader title="Description" />
              <CardBody>
                <p className="text-sm whitespace-pre-line text-fg-2">{g.description}</p>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="History" description="Every progress and status update." />
            <CardBody>
              <GoalHistory updates={g.updates ?? []} />
            </CardBody>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                {
                  label: 'Owner',
                  value: g.employeeId ? <PersonCell name={fullName(g.employeeId)} subtitle={g.employeeId.employeeId} photo={g.employeeId.profilePhoto} to={`/employees/${g.employeeId._id}?tab=performance`} /> : null,
                },
                { label: 'Manager', value: g.managerId ? fullName(g.managerId) : null },
                { label: 'Cycle', value: g.cycleId ? `${g.cycleId.name} (${label(g.cycleId.status)})` : 'No cycle' },
                { label: 'Weight', value: `${g.weight}%` },
                { label: 'Target', value: g.target },
                {
                  label: 'Due date',
                  value: g.dueDate ? <span className={cn(overdue && 'font-medium text-red-600 dark:text-red-400')}>{formatDate(g.dueDate)}{overdue ? ' · overdue' : ''}</span> : null,
                },
                { label: 'Created', value: formatDate(g.createdAt) },
              ]}
            />
            <p className="mt-5 text-xs text-muted">
              <Link to="/performance/goals" className="hover:text-fg">
                ← All goals
              </Link>
            </p>
          </CardBody>
        </Card>
      </div>
      {dialogs}
    </>
  );
};
