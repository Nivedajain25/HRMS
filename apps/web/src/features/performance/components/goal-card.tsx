import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Ban, CalendarClock, MoreHorizontal, Pencil, Trash2, TrendingUp } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Avatar, ProgressBar } from '@/components/ui/display';
import { Dropdown, useConfirm } from '@/components/ui/overlay';
import { cn, formatDate, fullName, toDateKey } from '@/lib/utils';
import { useDeleteGoal, useGoalStatusChange, type Goal } from '../api';
import { GoalFormDrawer } from './goal-form';
import { GoalProgressDialog } from './goal-progress';
import { CategoryBadge, progressTone, useGoalAbilities } from './perf-ui';

export const isOverdue = (goal: Pick<Goal, 'dueDate' | 'status'>) =>
  !!goal.dueDate && goal.status !== 'COMPLETED' && goal.status !== 'CANCELLED' && goal.dueDate.slice(0, 10) < toDateKey(new Date());

/** Edit / progress / cancel / delete actions for a goal, with dialogs. */
export const useGoalActions = (goal: Goal | undefined, opts: { onDeleted?: () => void } = {}) => {
  const abilities = useGoalAbilities(goal);
  const confirm = useConfirm();
  const statusChange = useGoalStatusChange();
  const remove = useDeleteGoal();
  const [editing, setEditing] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);

  const cancelGoal = async () => {
    if (!goal) return;
    const { confirmed, reason } = await confirm({
      title: 'Cancel this goal?',
      message: `"${goal.title}" will be marked as cancelled and excluded from the goal score. It can be reopened later.`,
      confirmLabel: 'Cancel goal',
      requireReason: true,
      reasonLabel: 'Reason (recorded in the progress history)',
    });
    if (!confirmed) return;
    // Errors are toasted by the global mutation handler.
    const ok = await statusChange
      .mutateAsync({ id: goal._id, progress: goal.progress, status: 'CANCELLED', note: reason })
      .then(() => true)
      .catch(() => false);
    if (ok) toast.success('Goal cancelled');
  };

  const deleteGoal = async () => {
    if (!goal) return;
    const { confirmed } = await confirm({
      title: 'Delete this goal?',
      message: `"${goal.title}" and its progress history will be removed. This cannot be undone.`,
      confirmLabel: 'Delete goal',
    });
    if (!confirmed) return;
    const ok = await remove
      .mutateAsync(goal._id)
      .then(() => true)
      .catch(() => false);
    if (!ok) return;
    toast.success('Goal deleted');
    opts.onDeleted?.();
  };

  const menu = [
    { label: 'Update progress', icon: <TrendingUp className="h-4 w-4" />, onSelect: () => setProgressOpen(true), hidden: !abilities.canProgress },
    { label: 'Edit goal', icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(true), hidden: !abilities.canEdit },
    { label: 'Cancel goal', icon: <Ban className="h-4 w-4" />, onSelect: () => void cancelGoal(), hidden: !abilities.canCancel, danger: true },
    { label: 'Delete goal', icon: <Trash2 className="h-4 w-4" />, onSelect: () => void deleteGoal(), hidden: !abilities.canDelete, danger: true },
  ];

  const dialogs = goal ? (
    <>
      <GoalFormDrawer open={editing} goal={goal} onClose={() => setEditing(false)} />
      <GoalProgressDialog goal={goal} open={progressOpen} canManage={abilities.canManage} onClose={() => setProgressOpen(false)} />
    </>
  ) : null;

  return { abilities, menu, dialogs, openProgress: () => setProgressOpen(true), openEdit: () => setEditing(true), busy: statusChange.isPending || remove.isPending };
};

export const GoalCard = ({ goal, showOwner }: { goal: Goal; showOwner?: boolean }) => {
  const navigate = useNavigate();
  const { menu, dialogs, abilities, openProgress } = useGoalActions(goal);
  const overdue = isOverdue(goal);
  const krDone = goal.keyResults.filter((k) => (k.progress ?? 0) >= 100).length;

  return (
    <article className="card flex h-full flex-col p-4 transition-shadow hover:shadow-pop" aria-labelledby={`goal-${goal._id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryBadge category={goal.category} />
          <StatusBadge status={goal.status} />
          {goal.weight > 0 && (
            <span className="rounded-md bg-surface-3 px-2 py-0.5 text-xs font-medium text-fg-2 tabular-nums" title="Weight in the goal score">
              {goal.weight}% weight
            </span>
          )}
        </div>
        <Dropdown
          label={`Actions for ${goal.title}`}
          items={menu}
          trigger={
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-fg">
              <MoreHorizontal className="h-4 w-4" />
            </span>
          }
        />
      </div>

      <h3 id={`goal-${goal._id}`} className="mt-3 text-sm leading-snug font-semibold text-fg">
        <Link to={`/performance/goals/${goal._id}`} className="hover:text-brand-700 hover:underline dark:hover:text-brand-300">
          {goal.title}
        </Link>
      </h3>
      {goal.target && <p className="mt-1 line-clamp-2 text-sm text-muted">{goal.target}</p>}

      <div className="mt-auto pt-4">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-muted">
            Progress
            {goal.keyResults.length > 0 && (
              <>
                {' '}
                · {krDone}/{goal.keyResults.length} key results
              </>
            )}
          </span>
          <span className="font-semibold text-fg tabular-nums">{goal.progress}%</span>
        </div>
        <ProgressBar value={goal.progress} tone={progressTone(goal)} />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {showOwner && goal.employeeId && (
              <button type="button" className="flex min-w-0 items-center gap-1.5 hover:text-fg" onClick={() => navigate(`/employees/${goal.employeeId._id}?tab=performance`)}>
                <Avatar name={fullName(goal.employeeId)} src={goal.employeeId.profilePhoto} size="xs" />
                <span className="truncate">{fullName(goal.employeeId)}</span>
              </button>
            )}
            {goal.cycleId && <span className="truncate">{goal.cycleId.name}</span>}
            {goal.dueDate && (
              <span className={cn('flex items-center gap-1', overdue && 'font-medium text-red-600 dark:text-red-400')}>
                <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                {overdue ? 'Overdue · ' : 'Due '}
                {formatDate(goal.dueDate)}
              </span>
            )}
          </div>
          {abilities.canProgress && (
            <Button variant="outline" size="xs" onClick={openProgress} icon={<TrendingUp className="h-3.5 w-3.5" />}>
              Update
            </Button>
          )}
        </div>
      </div>
      {dialogs}
    </article>
  );
};
