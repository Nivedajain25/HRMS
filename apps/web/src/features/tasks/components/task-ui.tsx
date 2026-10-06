import { CalendarClock } from 'lucide-react';
import { Badge } from '@/components/ui/display';
import { cn, formatDate } from '@/lib/utils';
import { isOverdue, PRIORITY_META, STATUS_META, type Task, type WorkTaskPriority, type WorkTaskStatus } from '../api';

/** Instants in 12-hour time, e.g. "30 Sep 2026, 4:05 PM". */
export const DATE_TIME_12 = 'dd MMM yyyy, h:mm a';

export const PriorityBadge = ({ priority }: { priority: WorkTaskPriority }) => (
  <Badge tone={PRIORITY_META[priority].tone} dot>
    {PRIORITY_META[priority].label} priority
  </Badge>
);

export const StatusBadge = ({ status }: { status: WorkTaskStatus }) => <Badge tone={STATUS_META[status].tone}>{STATUS_META[status].label}</Badge>;

/** "Due 02 Oct 2026", red when overdue. Nothing when the task has no due date. */
export const DueLabel = ({ task, className }: { task: Task; className?: string }) => {
  if (!task.dueDate) return null;
  const overdue = isOverdue(task);
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted', className)}>
      <CalendarClock className="h-3.5 w-3.5" aria-hidden />
      {overdue ? 'Overdue · was due' : 'Due'} {formatDate(task.dueDate)}
    </span>
  );
};
