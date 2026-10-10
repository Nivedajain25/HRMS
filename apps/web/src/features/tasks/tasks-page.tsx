import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, ClipboardCheck, ClipboardList, MessageSquareText, Play, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Pagination } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Avatar, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/display';
import { Textarea } from '@/components/ui/input';
import { Modal, Tabs, useConfirm } from '@/components/ui/overlay';
import { cn, formatDateTime, fullName, timeAgo } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import {
  assignerName,
  useAssignable,
  useDeleteTask,
  useMarkTasksSeen,
  useTask,
  useTasks,
  useUpdateTaskStatus,
  type Task,
  type TaskListQuery,
  type WorkTaskStatus,
} from './api';
import { AssignTaskDialog } from './components/assign-task-dialog';
import { DATE_TIME_12, DueLabel, PriorityBadge, StatusBadge } from './components/task-ui';

type TabKey = 'mine' | 'done' | 'assigned';
const LIMIT = 20;

/* ------------------------------ Task card ----------------------------- */

const LatestNote = ({ task }: { task: Task }) => {
  const note = task.notes.at(-1);
  if (!note) return null;
  return (
    <p className="mt-2 flex gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-2">
      <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 break-words whitespace-pre-line">
        {note.text}
        <span className="mt-0.5 block text-xs text-muted">
          {note.byName ? `${note.byName} · ` : ''}
          {timeAgo(note.at)}
        </span>
      </span>
    </p>
  );
};

const TaskCard = ({
  task,
  view,
  highlighted,
  busy,
  onStatus,
  onComplete,
  onDelete,
}: {
  task: Task;
  view: TabKey;
  highlighted: boolean;
  busy: boolean;
  onStatus: (task: Task, status: WorkTaskStatus) => void;
  onComplete: (task: Task) => void;
  onDelete: (task: Task) => void;
}) => {
  const assignee = task.assigneeId;
  const assigneeName = fullName(assignee) || 'Employee';
  const done = task.status === 'DONE';

  return (
    <Card id={`task-${task._id}`} className={cn('scroll-mt-24 p-4 transition-shadow', highlighted && 'shadow-pop ring-2 ring-brand-500')}>
      {view === 'assigned' && (
        <div className="mb-3 flex items-center gap-2.5">
          <Avatar name={assigneeName} src={assignee?.profilePhoto} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-fg">{assigneeName}</span>
            <span className="block truncate text-xs text-muted">
              {[assignee?.designationId?.name, assignee?.departmentId?.name].filter(Boolean).join(' · ') || assignee?.employeeId}
            </span>
          </span>
          <StatusBadge status={task.status} />
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className={cn('min-w-0 font-semibold break-words text-fg', done && view !== 'assigned' && 'text-fg-2')}>{task.title}</h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {view === 'mine' && task.status === 'IN_PROGRESS' && <StatusBadge status={task.status} />}
          {!done && <PriorityBadge priority={task.priority} />}
        </div>
      </div>
      {task.description && <p className="mt-1 text-sm break-words whitespace-pre-line text-fg-2">{task.description}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
        {view !== 'assigned' && (
          <span className="flex items-center gap-1.5" title={formatDateTime(task.createdAt, DATE_TIME_12)}>
            <Avatar name={assignerName(task)} src={task.assignedBy?.avatar} size="xs" />
            Assigned by <span className="font-medium text-fg-2">{assignerName(task)}</span> · {timeAgo(task.createdAt)}
          </span>
        )}
        {view === 'assigned' && <span title={formatDateTime(task.createdAt, DATE_TIME_12)}>Assigned {timeAgo(task.createdAt)}</span>}
        {done ? (
          task.completedAt && (
            <span className="flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Completed {formatDateTime(task.completedAt, DATE_TIME_12)}
            </span>
          )
        ) : (
          <>
            <DueLabel task={task} />
            {task.status === 'IN_PROGRESS' && task.startedAt && <span title={formatDateTime(task.startedAt, DATE_TIME_12)}>Started {timeAgo(task.startedAt)}</span>}
            {view === 'assigned' && task.status === 'TODO' && <span>{task.seenAt ? `Seen ${timeAgo(task.seenAt)}` : 'Not seen yet'}</span>}
          </>
        )}
      </div>

      <LatestNote task={task} />

      {view === 'mine' && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {task.status === 'TODO' && (
            <Button variant="outline" size="sm" icon={<Play className="h-4 w-4" />} disabled={busy} onClick={() => onStatus(task, 'IN_PROGRESS')}>
              Start
            </Button>
          )}
          <Button variant="success" size="sm" icon={<CheckCircle2 className="h-4 w-4" />} disabled={busy} onClick={() => onComplete(task)}>
            Mark as done
          </Button>
        </div>
      )}
      {view === 'done' && (
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="xs" icon={<RotateCcw className="h-3.5 w-3.5" />} disabled={busy} onClick={() => onStatus(task, 'TODO')}>
            Reopen
          </Button>
        </div>
      )}
      {view === 'assigned' && (
        <div className="mt-3 flex justify-end gap-1">
          {done && (
            <Button variant="ghost" size="xs" icon={<RotateCcw className="h-3.5 w-3.5" />} disabled={busy} onClick={() => onStatus(task, 'TODO')}>
              Reopen
            </Button>
          )}
          <Button
            variant="ghost"
            size="xs"
            className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            disabled={busy}
            onClick={() => onDelete(task)}
          >
            Delete
          </Button>
        </div>
      )}
    </Card>
  );
};

/* -------------------------------- Page -------------------------------- */

/**
 * Tasks anyone can give anyone. Everyone works through "My tasks" (Start → Mark as done), finished ones move to
 * "Finished", and "Assigned by me" lists the tasks they gave out. `/tasks?assign=1` opens the Assign dialog.
 */
export const TasksPage = () => {
  const { user, hasEmployee } = usePermissions();
  const [params, setParams] = useSearchParams();
  const focusId = params.get('id');
  const assignable = useAssignable();
  const people = assignable.data ?? [];
  const canAssign = people.length > 0;
  const [assignState, setAssignOpen] = useState(false);
  // Dashboard "Assign task" quick action.
  const assignOpen = assignState || params.get('assign') === '1';
  const closeAssign = () => {
    setAssignOpen(false);
    if (params.has('assign')) {
      params.delete('assign');
      setParams(params, { replace: true });
    }
  };
  const [page, setPage] = useState(1);
  const [completing, setCompleting] = useState<Task | null>(null);
  const [note, setNote] = useState('');
  const confirm = useConfirm();
  const update = useUpdateTaskStatus();
  const remove = useDeleteTask();
  const markSeen = useMarkTasksSeen();
  const focus = useTask(focusId);

  const isMine = (t: Task) => !!user?.employeeId && t.assigneeId?._id === user.employeeId;
  const tabFor = (t: Task): TabKey => (isMine(t) ? (t.status === 'DONE' ? 'done' : 'mine') : 'assigned');

  const openCount = useTasks({ scope: 'mine', state: 'open', page: 1, limit: LIMIT }, hasEmployee);
  const tabs = [
    { key: 'mine', label: 'My tasks', count: openCount.data?.pagination.total, hidden: !hasEmployee },
    { key: 'done', label: 'Finished', hidden: !hasEmployee },
    { key: 'assigned', label: 'Assigned by me', hidden: !canAssign },
  ];
  const visible = tabs.filter((t) => !t.hidden);
  const requested = params.get('tab');
  const active = (visible.find((t) => t.key === requested)?.key ?? (focus.data ? tabFor(focus.data) : undefined) ?? visible[0]?.key ?? 'mine') as TabKey;

  const query: TaskListQuery =
    active === 'assigned' ? { scope: 'assigned', page, limit: LIMIT } : { scope: 'mine', state: active === 'done' ? 'done' : 'open', page, limit: LIMIT };
  const list = useTasks(query, active === 'assigned' ? canAssign : hasEmployee);
  const rows = list.data?.data;
  // A task opened from a notification may sit on a later page: keep it on top of its tab.
  const focusTab = focus.data ? tabFor(focus.data) : null;
  const items = useMemo(() => {
    const base = rows ?? [];
    return focus.data && focusTab === active && !base.some((r) => r._id === focus.data._id) ? [focus.data, ...base] : base;
  }, [rows, focus.data, focusTab, active]);

  // Scroll to (and mark seen) the task opened via `?id=` once it is on screen.
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || scrolledFor.current === focusId || !items.some((t) => t._id === focusId)) return;
    scrolledFor.current = focusId;
    requestAnimationFrame(() => document.getElementById(`task-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [focusId, items]);
  const seenFor = useRef<string | null>(null);
  const focusTask = focus.data;
  useEffect(() => {
    if (!focusTask || seenFor.current === focusTask._id || focusTask.seenAt || !user?.employeeId || focusTask.assigneeId?._id !== user.employeeId) return;
    seenFor.current = focusTask._id;
    markSeen.mutate(focusTask._id);
  }, [focusTask, user?.employeeId, markSeen]);

  const changeTab = (key: string) => {
    setPage(1);
    setParams({ tab: key }, { replace: true });
  };

  const setStatus = async (task: Task, status: WorkTaskStatus, withNote?: string) => {
    await update.mutateAsync({ id: task._id, status, note: withNote });
    toast.success(status === 'IN_PROGRESS' ? 'Task started' : status === 'DONE' ? 'Nice work! Task moved to finished' : 'Task reopened');
  };
  const onStatus = (task: Task, status: WorkTaskStatus) => void setStatus(task, status).catch(() => undefined);

  const openComplete = (task: Task) => {
    setNote('');
    update.reset();
    setCompleting(task);
  };
  const complete = async () => {
    if (!completing) return;
    await setStatus(completing, 'DONE', note.trim() || undefined);
    setCompleting(null);
  };

  const onDelete = async (task: Task) => {
    const { confirmed } = await confirm({
      title: 'Delete this task?',
      message: (
        <>
          “{task.title}” will be removed for <strong>{fullName(task.assigneeId) || 'the assignee'}</strong>. This can’t be undone.
        </>
      ),
      confirmLabel: 'Delete task',
    });
    if (!confirmed) return;
    await remove.mutateAsync(task._id);
    toast.success('Task deleted');
  };

  const busyId = update.isPending ? update.variables?.id : remove.isPending ? remove.variables : undefined;
  const pagination = list.data?.pagination;

  const empty =
    active === 'mine' ? (
      <EmptyState
        className="card"
        icon={<CheckCircle2 className="h-5 w-5" />}
        title="No open tasks — you're all caught up"
        description="New tasks from your manager, department head or HR will show up here."
      />
    ) : active === 'done' ? (
      <EmptyState className="card" icon={<ClipboardCheck className="h-5 w-5" />} title="Nothing finished yet" description="Tasks you mark as done move here." />
    ) : (
      <EmptyState
        className="card"
        icon={<Send className="h-5 w-5" />}
        title="You haven't assigned any tasks yet"
        description="Assign a task and the person gets a pop-up and a notification."
        action={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAssignOpen(true)}>
            Assign task
          </Button>
        }
      />
    );

  return (
    <div>
      <PageHeader
        title="Tasks"
        description={canAssign ? 'Tasks assigned to you, and the ones you have given to others.' : 'Tasks assigned to you by your colleagues.'}
        actions={
          canAssign && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAssignOpen(true)}>
              Assign task
            </Button>
          )
        }
      />

      {!visible.length ? (
        assignable.isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <EmptyState className="card" icon={<ClipboardList className="h-5 w-5" />} title="No tasks here" description="Anyone can assign a task to a colleague from here." />
        )
      ) : (
        <>
          {visible.length > 1 && (
            <div className="mb-4">
              <Tabs tabs={visible} active={active} onChange={changeTab} />
            </div>
          )}
          <div role={visible.length > 1 ? 'tabpanel' : undefined} aria-labelledby={visible.length > 1 ? `tab-${active}` : undefined}>
            {list.isLoading ? (
              <div className="space-y-3" role="status" aria-label="Loading tasks">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-32" />
                ))}
              </div>
            ) : list.error ? (
              <ErrorState className="card" message={list.error.message} onRetry={() => list.refetch()} />
            ) : !items.length ? (
              empty
            ) : (
              <>
                <ul className="space-y-3">
                  {items.map((t) => (
                    <li key={t._id}>
                      <TaskCard task={t} view={active} highlighted={t._id === focusId} busy={busyId === t._id} onStatus={onStatus} onComplete={openComplete} onDelete={(x) => void onDelete(x).catch(() => undefined)} />
                    </li>
                  ))}
                </ul>
                {pagination && pagination.totalPages > 1 && (
                  <Card className="mt-3">
                    <Pagination pagination={pagination} onPageChange={setPage} loading={list.isFetching} />
                  </Card>
                )}
              </>
            )}
          </div>
        </>
      )}

      <Modal
        open={!!completing}
        onClose={() => setCompleting(null)}
        title="Mark as done"
        description={completing?.title}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCompleting(null)}>
              Cancel
            </Button>
            <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} loading={update.isPending} onClick={() => void complete().catch(() => undefined)}>
              Mark as done
            </Button>
          </>
        }
      >
        {update.error && (
          <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">
            {update.error.message}
          </p>
        )}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-fg">Note (optional)</span>
          <Textarea data-autofocus rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Report shared on the team drive" />
        </label>
      </Modal>

      {canAssign && <AssignTaskDialog open={assignOpen} onClose={closeAssign} people={people} />}
    </div>
  );
};
