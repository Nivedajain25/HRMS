import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardList } from 'lucide-react';
import { ListSkeleton, ViewAllLink, Widget, WidgetEmpty } from '@/features/dashboard/components/widget';
import { assignerName, isOverdue, useTasks } from '../api';
import { DueLabel, PriorityBadge } from './task-ui';

/**
 * Dashboard card: the viewer's open tasks (newest first), linking to the Tasks page.
 * `boxed`: the employee dashboard style — icon title in a blue box, a line under the header, blue border.
 */
export const MyTasksWidget = ({ boxed = false, box }: { boxed?: boolean; /** Admin style: title-box bg classes. */ box?: string }) => {
  const list = useTasks({ scope: 'mine', state: 'open', page: 1, limit: 4 });
  const total = list.data?.pagination.total ?? 0;
  const overdue = list.data?.data.filter(isOverdue).length ?? 0;

  return (
    <Widget
      title="My tasks"
      titleBox={box}
      titleIcon={box ? ClipboardList : undefined}
      className={boxed ? 'bg-[#f8fbff] dark:bg-surface [&>header]:border-b [&>header]:border-line' : box ? 'border-violet-200 dark:border-violet-500/20 [&>header]:border-b [&>header]:border-line' : undefined}
      description={total ? `${total} open${overdue ? ` · ${overdue} overdue` : ''}` : 'All caught up'}
      icon={box ? undefined : <ClipboardList className="h-4 w-4" />}
      accent={boxed ? 'warm' : 'purple'}
      action={<ViewAllLink to="/tasks" />}
      loading={list.isLoading}
      error={list.error}
      onRetry={() => list.refetch()}
      skeleton={<ListSkeleton rows={2} />}
      empty={!list.data?.data.length}
      emptyState={<WidgetEmpty icon={<CheckCircle2 className="h-4 w-4" />} title="No open tasks" description="Tasks assigned to you show up here." />}
    >
      <ul className="px-2 pb-2">
        {list.data?.data.map((t) => (
          <li key={t._id}>
            <Link to={`/tasks?id=${t._id}`} className="block rounded-lg px-3 py-2 hover:bg-surface-2">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-fg">{t.title}</span>
                <PriorityBadge priority={t.priority} />
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-muted">
                <span>From {assignerName(t)}</span>
                <DueLabel task={t} className="text-[11px]" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Widget>
  );
};
