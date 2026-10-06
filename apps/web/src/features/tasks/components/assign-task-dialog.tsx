import { useMemo, useState } from 'react';
import { Search, Send } from 'lucide-react';
import { toast } from 'sonner';
import { WORK_TASK_PRIORITY, type WorkTaskPriority } from '@stencil/shared';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/display';
import { DatePicker, Input, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/overlay';
import { cn, fullName, toDateKey } from '@/lib/utils';
import { PRIORITY_META, useCreateTask, type TaskPerson } from '../api';

const PRIORITY_ACTIVE: Record<WorkTaskPriority, string> = {
  HIGH: 'border-red-500 bg-red-50 text-red-700 ring-1 ring-red-500 dark:bg-red-500/15 dark:text-red-300',
  MEDIUM: 'border-amber-500 bg-amber-50 text-amber-800 ring-1 ring-amber-500 dark:bg-amber-500/15 dark:text-amber-300',
  LOW: 'border-line-strong bg-surface-3 text-fg ring-1 ring-line-strong',
};

const subtitle = (p: TaskPerson) => [p.designationId?.name, p.departmentId?.name].filter(Boolean).join(' · ') || p.employeeId;

/** Manager / department head / HR assigns a task to one or more people (each gets their own copy). */
export const AssignTaskDialog = ({ open, onClose, people }: { open: boolean; onClose: () => void; people: TaskPerson[] }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [priority, setPriority] = useState<WorkTaskPriority>('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  const [search, setSearch] = useState('');
  const [touched, setTouched] = useState(false);
  const create = useCreateTask();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => `${fullName(p)} ${p.employeeId} ${p.departmentId?.name ?? ''} ${p.designationId?.name ?? ''}`.toLowerCase().includes(q));
  }, [people, search]);

  const reset = () => {
    setTitle('');
    setDescription('');
    setAssigneeIds([]);
    setPriority('MEDIUM');
    setDueDate('');
    setSearch('');
    setTouched(false);
    create.reset();
  };
  const close = () => {
    reset();
    onClose();
  };

  const toggle = (id: string) => setAssigneeIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const allShownSelected = filtered.length > 0 && filtered.every((p) => assigneeIds.includes(p._id));
  const toggleAllShown = () =>
    setAssigneeIds((ids) =>
      allShownSelected ? ids.filter((id) => !filtered.some((p) => p._id === id)) : [...new Set([...ids, ...filtered.map((p) => p._id)])].slice(0, 50),
    );

  const titleError = touched && !title.trim() ? 'Enter a title' : undefined;
  const peopleError = touched && !assigneeIds.length ? 'Choose at least one person' : assigneeIds.length > 50 ? 'You can assign to at most 50 people at once' : undefined;

  const submit = async () => {
    setTouched(true);
    if (!title.trim() || !assigneeIds.length || assigneeIds.length > 50) return;
    const res = await create.mutateAsync({
      title: title.trim(),
      description: description.trim() || undefined,
      assigneeIds,
      priority,
      dueDate: dueDate || undefined,
    });
    const count = res.data.length || assigneeIds.length;
    toast.success(res.message ?? (count > 1 ? `Task assigned to ${count} people` : 'Task assigned'));
    close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Assign task"
      description="The people you choose are notified and see it as a pop-up."
      size="lg"
      footer={
        <>
          {assigneeIds.length > 0 && (
            <span className="mr-auto self-center text-xs text-muted">
              {assigneeIds.length} {assigneeIds.length === 1 ? 'person' : 'people'} selected
            </span>
          )}
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button icon={<Send className="h-4 w-4" />} loading={create.isPending} onClick={() => void submit().catch(() => undefined)}>
            Assign task
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {create.error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">
            {create.error.message}
          </p>
        )}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-fg">Title</span>
          <Input data-autofocus maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Prepare the monthly stock report" aria-invalid={!!titleError} />
          {titleError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{titleError}</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-fg">Description (optional)</span>
          <Textarea rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Any details, links or instructions" />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-fg">Priority</legend>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Priority">
              {WORK_TASK_PRIORITY.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={priority === p}
                  onClick={() => setPriority(p)}
                  className={cn(
                    'h-9 rounded-lg border px-2 text-sm font-medium transition-colors',
                    priority === p ? PRIORITY_ACTIVE[p] : 'border-line text-fg-2 hover:bg-surface-2',
                  )}
                >
                  {PRIORITY_META[p].label}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-fg">Due date (optional)</span>
            <DatePicker value={dueDate} min={toDateKey(new Date())} onChange={(e) => setDueDate(e.target.value)} />
          </label>
        </div>

        <fieldset>
          <div className="mb-1 flex items-center justify-between gap-2">
            <legend className="text-sm font-medium text-fg">Assign to</legend>
            {filtered.length > 1 && (
              <Button variant="link" size="xs" onClick={toggleAllShown}>
                {allShownSelected ? 'Clear shown' : 'Select all shown'}
              </Button>
            )}
          </div>
          {people.length > 6 && (
            <div className="mb-2">
              <Input leftIcon={<Search className="h-4 w-4" />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, ID or department" aria-label="Search people" />
            </div>
          )}
          <ul className={cn('scrollbar-thin max-h-64 divide-y divide-line overflow-y-auto rounded-lg border', peopleError ? 'border-red-500' : 'border-line')}>
            {!filtered.length && <li className="px-3 py-6 text-center text-sm text-muted">No one matches “{search}”.</li>}
            {filtered.map((p) => {
              const checked = assigneeIds.includes(p._id);
              return (
                <li key={p._id}>
                  <label className={cn('flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-2', checked && 'bg-brand-50/60 dark:bg-brand-500/10')}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(p._id)} className="h-4 w-4 shrink-0 rounded border-line-strong accent-brand-600" />
                    <Avatar name={fullName(p)} src={p.profilePhoto} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{fullName(p)}</span>
                      <span className="block truncate text-xs text-muted">{subtitle(p)}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {peopleError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{peopleError}</span>}
        </fieldset>
      </div>
    </Modal>
  );
};
