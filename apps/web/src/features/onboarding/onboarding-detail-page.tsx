import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, CalendarClock, CheckCircle2, Circle, CircleDashed, ClipboardCheck, Lock, MessageSquareText, UserRound } from 'lucide-react';
import { ONBOARDING_TASK_CATEGORIES, TASK_ASSIGNEE, TASK_STATUS } from '@stencil/shared';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, PageSkeleton, ProgressBar } from '@/components/ui/display';
import { Select, Switch, Textarea } from '@/components/ui/input';
import { label } from '@/lib/i18n';
import { cn, formatDate, formatDateTime, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useOnboarding, useUpdateTask, type Onboarding, type OnboardingTask, type TaskStatus } from './api';
import { AssigneeBadge, daysUntil, isPastDue } from './components/lifecycle-ui';

type GroupBy = 'category' | 'assignee';

const STATUS_ICON: Record<TaskStatus, typeof Circle> = { PENDING: Circle, IN_PROGRESS: CircleDashed, COMPLETED: CheckCircle2 };

const dueText = (task: OnboardingTask) => {
  if (!task.dueDate) return null;
  if (task.status === 'COMPLETED') return `Due ${formatDate(task.dueDate)}`;
  const days = daysUntil(task.dueDate);
  if (days === null) return null;
  if (days < 0) return `Overdue by ${Math.abs(days)} day${days === -1 ? '' : 's'} · ${formatDate(task.dueDate)}`;
  if (days === 0) return `Due today`;
  if (days === 1) return `Due tomorrow`;
  return `Due ${formatDate(task.dueDate)}`;
};

const TaskRow = ({ task, onboardingId, editable, wasComplete }: { task: OnboardingTask; onboardingId: string; editable: boolean; wasComplete: boolean }) => {
  const update = useUpdateTask(onboardingId);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(task.note ?? '');
  const overdue = task.status !== 'COMPLETED' && isPastDue(task.dueDate);
  const Icon = STATUS_ICON[task.status];
  const due = dueText(task);

  const save = async (status: TaskStatus, withNote?: string) => {
    const res = await update.mutateAsync({ taskId: task._id, status, note: withNote });
    if (res.data.status === 'COMPLETED' && !wasComplete) toast.success('All required tasks are done — onboarding complete');
    else toast.success(res.message ?? 'Task updated');
  };

  return (
    <li className={cn('px-5 py-4', overdue && 'bg-red-50/60 dark:bg-red-500/5')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Icon
          aria-hidden
          className={cn(
            'mt-0.5 hidden h-5 w-5 shrink-0 sm:block',
            task.status === 'COMPLETED' ? 'text-emerald-600 dark:text-emerald-400' : task.status === 'IN_PROGRESS' ? 'text-sky-600 dark:text-sky-400' : 'text-subtle',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={cn('text-sm font-medium text-fg', task.status === 'COMPLETED' && 'text-muted line-through decoration-line-strong')}>{task.title}</p>
            {task.required ? <Badge tone="gray">Required</Badge> : <Badge tone="gray" className="opacity-70">Optional</Badge>}
          </div>
          {task.description && <p className="mt-1 text-sm whitespace-pre-line text-muted">{task.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
            <AssigneeBadge assignee={task.assignee} />
            {due && (
              <span className={cn('flex items-center gap-1', overdue && 'font-medium text-red-600 dark:text-red-400')}>
                {overdue ? <AlertCircle className="h-3.5 w-3.5" aria-hidden /> : <CalendarClock className="h-3.5 w-3.5" aria-hidden />}
                {due}
              </span>
            )}
            {task.status === 'COMPLETED' && task.completedAt && (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                Completed {formatDateTime(task.completedAt)}
                {task.completedBy ? ` by ${fullName(task.completedBy)}` : ''}
              </span>
            )}
          </div>
          {task.note && !noteOpen && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-2">
              <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
              <span className="whitespace-pre-line">{task.note}</span>
            </p>
          )}
          {noteOpen && (
            <div className="mt-3 space-y-2">
              <label htmlFor={`note-${task._id}`} className="block text-xs font-medium text-fg">
                Note
              </label>
              <Textarea id={`note-${task._id}`} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus />
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setNote(task.note ?? '');
                    setNoteOpen(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  loading={update.isPending}
                  onClick={async () => {
                    await save(task.status, note.trim());
                    setNoteOpen(false);
                  }}
                >
                  Save note
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:w-52 sm:justify-end">
          {editable ? (
            <>
              <Select
                aria-label={`Status of ${task.title}`}
                className="h-8 flex-1 sm:w-36 sm:flex-none"
                value={task.status}
                disabled={update.isPending}
                onChange={(e) => void save(e.target.value as TaskStatus, note.trim() || undefined)}
                options={TASK_STATUS.map((s) => ({ value: s, label: label(s) }))}
              />
              <Button variant="ghost" size="icon-sm" aria-label={task.note ? `Edit note for ${task.title}` : `Add note to ${task.title}`} onClick={() => setNoteOpen((v) => !v)}>
                <MessageSquareText className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <span className="flex items-center gap-2">
              <StatusBadge status={task.status} />
              <span className="text-subtle" title="You can't update this task">
                <Lock className="h-3.5 w-3.5" aria-label="Read only" />
              </span>
            </span>
          )}
        </div>
      </div>
    </li>
  );
};

const Header = ({ o }: { o: Onboarding }) => {
  const e = o.employeeId;
  const total = o.tasks.length;
  const done = o.tasks.filter((t) => t.status === 'COMPLETED').length;
  const requiredOpen = o.tasks.filter((t) => t.required && t.status !== 'COMPLETED').length;
  const overdue = o.tasks.filter((t) => t.status !== 'COMPLETED' && isPastDue(t.dueDate)).length;
  return (
    <div className="card mb-6 p-5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Avatar name={e ? fullName(e) : '?'} src={e?.profilePhoto} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold text-fg">{e ? fullName(e) : 'Removed employee'}</h1>
              <StatusBadge status={o.status} />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {e && (
                <span className="flex items-center gap-1.5">
                  <UserRound className="h-4 w-4" aria-hidden />
                  {e.employeeId}
                </span>
              )}
              {o.templateId && (
                <span className="flex items-center gap-1.5">
                  <ClipboardCheck className="h-4 w-4" aria-hidden />
                  {o.templateId.name}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <CalendarClock className="h-4 w-4" aria-hidden />
                Started {formatDate(o.startDate)}
              </span>
            </div>
          </div>
        </div>
        <div className="w-full lg:w-80">
          <div className="mb-1.5 flex items-baseline justify-between text-sm">
            <span className="font-medium text-fg">{o.progress}% complete</span>
            <span className="text-muted tabular-nums">
              {done} of {total} tasks
            </span>
          </div>
          <ProgressBar value={o.progress} tone={o.status === 'COMPLETED' ? 'green' : 'brand'} />
          <p className="mt-1.5 text-xs text-muted">
            {o.status === 'COMPLETED'
              ? `Completed ${o.completedAt ? formatDateTime(o.completedAt) : ''}`
              : `${requiredOpen} required task${requiredOpen === 1 ? '' : 's'} remaining${overdue ? ` · ${overdue} overdue` : ''}`}
          </p>
        </div>
      </div>
    </div>
  );
};

export const OnboardingDetailPage = () => {
  const { id } = useParams();
  const onboarding = useOnboarding(id);
  const { can, user } = usePermissions();
  const [params, setParams] = useSearchParams();
  const groupBy: GroupBy = params.get('group') === 'assignee' ? 'assignee' : 'category';
  const mineOnly = params.get('mine') === '1';

  const o = onboarding.data;
  const canEdit = useMemo(() => {
    const isHr = can('onboarding:manage');
    const isSelf = !!user?.employeeId && user.employeeId === o?.employeeId?._id;
    const isManager = !!user?.employeeId && !!o?.employeeId?.managerId && String(o.employeeId.managerId) === user.employeeId;
    return (task: OnboardingTask) => isHr || (isSelf && task.assignee === 'EMPLOYEE') || (isManager && task.assignee === 'MANAGER');
  }, [can, user, o]);

  if (onboarding.isLoading) return <PageSkeleton />;
  if (onboarding.error || !o) return <ErrorState className="card" message={onboarding.error?.message} onRetry={() => onboarding.refetch()} />;

  const visible = mineOnly ? o.tasks.filter(canEdit) : o.tasks;
  const order: readonly string[] = groupBy === 'category' ? ONBOARDING_TASK_CATEGORIES : TASK_ASSIGNEE;
  const groups = order
    .map((key) => ({ key, tasks: visible.filter((t) => (groupBy === 'category' ? t.category : t.assignee) === key) }))
    .filter((g) => g.tasks.length > 0);
  const editableCount = o.tasks.filter(canEdit).length;

  const setParam = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  return (
    <>
      <PageHeader title="Onboarding checklist" breadcrumb={[{ label: 'Onboarding', to: '/onboarding' }, { label: o.employeeId ? fullName(o.employeeId) : 'Checklist' }]} />
      <Header o={o} />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="radiogroup" aria-label="Group tasks by" className="inline-flex w-full rounded-lg border border-line-strong bg-surface p-0.5 sm:w-auto">
          {(['category', 'assignee'] as const).map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={groupBy === g}
              onClick={() => setParam('group', g === 'category' ? null : g)}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none',
                groupBy === g ? 'bg-brand-600 text-white shadow-sm' : 'text-muted hover:text-fg',
              )}
            >
              By {g}
            </button>
          ))}
        </div>
        {editableCount > 0 && editableCount < o.tasks.length && (
          <label className="flex items-center gap-2 text-sm text-fg-2">
            <Switch checked={mineOnly} onChange={(v) => setParam('mine', v ? '1' : null)} label="Only tasks I can update" />
            Only tasks I can update ({editableCount})
          </label>
        )}
      </div>

      {groups.length === 0 ? (
        <EmptyState className="card" icon={<ClipboardCheck className="h-6 w-6" />} title="No tasks to show" description={mineOnly ? 'No tasks are assigned to you on this checklist.' : 'This checklist has no tasks.'} />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const done = g.tasks.filter((t) => t.status === 'COMPLETED').length;
            return (
              <Card key={g.key}>
                <CardHeader
                  title={label(g.key)}
                  actions={
                    <span className="text-xs text-muted tabular-nums">
                      {done}/{g.tasks.length} done
                    </span>
                  }
                />
                <ul className="divide-y divide-line">
                  {g.tasks.map((t) => (
                    <TaskRow key={t._id} task={t} onboardingId={o._id} editable={canEdit(t)} wasComplete={o.status === 'COMPLETED'} />
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
};
