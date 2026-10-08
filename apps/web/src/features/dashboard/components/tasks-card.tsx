import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Plus, SquareCheckBig } from 'lucide-react';
import { Avatar, Card } from '@/components/ui/display';
import { useTasks, type Task } from '@/features/tasks/api';
import { DueLabel, StatusBadge } from '@/features/tasks/components/task-ui';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { TitleIcon } from './widget';

type Tab = 'assigned' | 'mine';

const PRIORITY_DOT: Record<Task['priority'], string> = { HIGH: 'bg-rose-500', MEDIUM: 'bg-amber-400', LOW: 'bg-slate-300' };

/** Dashboard: tasks I've given out (and tasks given to me), open ones first, with a quick "Assign task". */
export const TasksCard = ({ className }: { className?: string }) => {
  const { hasEmployee } = usePermissions();
  const [tab, setTab] = useState<Tab>('assigned');
  const q = useTasks({ scope: tab, state: 'open', page: 1, limit: 6 });
  const done = useTasks({ scope: tab, state: 'done', page: 1, limit: 1 });
  const items = q.data?.data ?? [];
  const openCount = q.data?.pagination.total ?? 0;
  const doneCount = done.data?.pagination.total ?? 0;

  return (
    <Card className={cn('flex flex-col overflow-hidden motion-safe:animate-fade-up', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 min-h-16 border-b border-line px-5 py-3.5">
        <h3 className="rounded-lg bg-violet-400 px-2.5 py-0.5 text-base font-semibold text-black shadow-sm">
          <TitleIcon icon={SquareCheckBig} />
          Tasks
        </h3>
        <div className="flex items-center gap-2">
          {hasEmployee ? (
            <div role="radiogroup" aria-label="Whose tasks" className="flex rounded-lg border border-line p-0.5">
              {(
                [
                  ['assigned', 'Assigned'],
                  ['mine', 'Mine'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={tab === key}
                  onClick={() => setTab(key)}
                  className={cn('rounded-md px-2.5 py-1 text-xs font-semibold', tab === key ? 'bg-brand-600 text-white' : 'text-muted hover:text-fg')}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          <Link to="/tasks" className="inline-flex h-8 items-center gap-1 rounded-lg bg-brand-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-brand-700">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Assign
          </Link>
        </div>
      </div>

      <div className="flex gap-2 px-5 pt-3">
        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">{`${openCount} open`}</span>
        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">{`${doneCount} finished`}</span>
      </div>

      {/* Takes the row's height (set by the card beside it) and scrolls inside. */}
      <div className="relative min-h-40 flex-1">
        <div className="scrollbar-thin absolute inset-0 overflow-y-auto px-5 py-3">
        {q.isLoading ? (
          <div className="space-y-2" aria-busy>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-2" />
            ))}
          </div>
        ) : !items.length ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <ClipboardList className="h-8 w-8 text-muted" aria-hidden />
            <p className="text-sm font-medium text-fg">{tab === 'assigned' ? 'No open tasks you’ve assigned' : 'No open tasks for you'}</p>
            <p className="text-xs text-muted">{tab === 'assigned' ? 'Assign a task and the person gets a pop-up and a notification.' : 'Tasks assigned to you will show here.'}</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((t) => {
              const who = t.assigneeId ? `${t.assigneeId.firstName} ${t.assigneeId.lastName}`.trim() : '—';
              return (
                <li key={t._id}>
                  <Link to={`/tasks?id=${t._id}`} className="flex items-center gap-3 py-2.5 hover:bg-surface-2">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', PRIORITY_DOT[t.priority])} title={`${t.priority.toLowerCase()} priority`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-fg">{t.title}</span>
                      <span className="flex items-center gap-2 text-xs text-muted">
                        {tab === 'assigned' ? <span className="truncate">{who}</span> : <span className="truncate">{`From ${t.assignedByName ?? 'your manager'}`}</span>}
                        <DueLabel task={t} />
                      </span>
                    </span>
                    {tab === 'assigned' && t.assigneeId ? <Avatar name={who} src={t.assigneeId.profilePhoto} size="xs" /> : null}
                    <StatusBadge status={t.status} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        </div>
      </div>
      <div className="px-5 pb-4">
        <Link to="/tasks" className="flex h-9 items-center justify-center rounded-lg border border-line bg-surface-2 text-sm font-medium text-fg hover:bg-surface-3">
          View all tasks
        </Link>
      </div>
    </Card>
  );
};
