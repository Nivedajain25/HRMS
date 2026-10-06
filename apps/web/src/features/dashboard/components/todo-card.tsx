import { useEffect, useRef, useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, GripVertical, ListTodo, Plus, Trash2, X } from 'lucide-react';
import { Card } from '@/components/ui/display';
import { dateKeyIn, formatKey, useOrgTimezone } from '@/features/attendance/lib';
import { del, get, patch, post } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Todo {
  _id: string;
  title: string;
  date: string;
  done: boolean;
  color: string;
  order: number;
}

/** Soft row colours (the API picks the next one for each new item). */
const ROW: Record<string, string> = {
  gray: 'border-line bg-surface',
  orange: 'border-orange-100 bg-orange-50 dark:border-orange-500/20 dark:bg-orange-500/10',
  red: 'border-rose-200 bg-rose-100/70 dark:border-rose-500/20 dark:bg-rose-500/10',
  purple: 'border-purple-100 bg-purple-50 dark:border-purple-500/20 dark:bg-purple-500/10',
  blue: 'border-sky-100 bg-sky-50 dark:border-sky-500/20 dark:bg-sky-500/10',
  yellow: 'border-amber-100 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10',
  green: 'border-emerald-100 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10',
};
const GRIP: Record<string, string> = {
  gray: 'text-emerald-500',
  orange: 'text-orange-400',
  red: 'text-rose-500',
  purple: 'text-purple-400',
  blue: 'text-sky-500',
  yellow: 'text-amber-400',
  green: 'text-emerald-500',
};

const keys = { day: (date: string) => ['todos', date] as const };

/** My own to-do list for a day: tick, add (+), drag to reorder, delete. Saved to my account. */
/**
 * `compact`: shorter card (one-line empty state, list scrolls after ~4 items).
 * `fill`: takes the height of its row (set by the card beside it) and scrolls inside, never growing the row.
 */
export const TodoCard = ({ className, compact, fill }: { className?: string; compact?: boolean; fill?: boolean }) => {
  const qc = useQueryClient();
  const timeZone = useOrgTimezone();
  const today = dateKeyIn(timeZone);
  const [date, setDate] = useState(today);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [order, setOrder] = useState<Todo[] | null>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  const addInput = useRef<HTMLInputElement>(null);

  const list = useQuery({ queryKey: keys.day(date), queryFn: () => get<Todo[]>('/todos', { date }), placeholderData: keepPreviousData });
  const items = order ?? list.data ?? [];
  useEffect(() => setOrder(null), [list.data]);
  useEffect(() => {
    if (adding) addInput.current?.focus();
  }, [adding]);

  const refresh = () => qc.invalidateQueries({ queryKey: keys.day(date) });
  const add = useMutation({ mutationFn: (t: string) => post<Todo>('/todos', { title: t, date }), onSuccess: refresh });
  const update = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => patch<Todo>(`/todos/${v.id}`, { done: v.done }),
    onMutate: (v) => qc.setQueryData<Todo[]>(keys.day(date), (old) => old?.map((t) => (t._id === v.id ? { ...t, done: v.done } : t))),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/todos/${id}`), onSuccess: refresh });
  const reorder = useMutation({ mutationFn: (ids: string[]) => post('/todos/reorder', { ids }), onSettled: refresh });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    add.mutate(t, { onSuccess: () => setTitle('') });
  };

  // Drag to reorder (native drag and drop); saved when dropped.
  const onDragEnter = (overId: string) => {
    if (!dragId || dragId === overId) return;
    const current = [...items];
    const from = current.findIndex((t) => t._id === dragId);
    const to = current.findIndex((t) => t._id === overId);
    if (from < 0 || to < 0) return;
    const [moved] = current.splice(from, 1);
    current.splice(to, 0, moved!);
    setOrder(current);
  };
  const onDrop = () => {
    if (order) reorder.mutate(order.map((t) => t._id));
    setDragId(null);
  };

  return (
    // Title in a coloured pill with a violet card border, like the other admin dashboard cards.
    <Card className={cn('flex flex-col overflow-hidden border-violet-200 motion-safe:animate-fade-up dark:border-violet-500/20', className)}>
      <div className="flex items-center justify-between gap-2 min-h-16 border-b border-line px-5 py-3.5">
        <h3 className="rounded-lg bg-purple-300 px-2.5 py-0.5 text-base font-semibold text-black shadow-sm">
          <span aria-hidden className="mr-1.5">📝</span>
          Todo
        </h3>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => dateInput.current?.showPicker?.()}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-fg shadow-sm hover:bg-surface-2"
            >
              <CalendarDays className="h-4 w-4" aria-hidden />
              {date === today ? 'Today' : formatKey(date, 'dd MMM')}
            </button>
            <input
              ref={dateInput}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || today)}
              aria-label="Choose a day"
              className="pointer-events-none absolute right-0 bottom-0 h-0 w-0 opacity-0"
              tabIndex={-1}
            />
          </div>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            aria-label={adding ? 'Close' : 'Add a to-do'}
            aria-expanded={adding}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-white shadow-sm transition-transform hover:scale-105 hover:bg-brand-700"
          >
            {adding ? <X className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      </div>

      <div className={cn(fill ? 'relative min-h-48 flex-1' : cn('flex-1 space-y-2 px-5', compact ? 'py-3' : 'py-4'))}>
        <div className={cn(fill && 'scrollbar-thin absolute inset-0 space-y-2 overflow-y-auto px-5 py-4')}>
        {adding ? (
          <form onSubmit={submit} className="flex gap-2">
            <input
              ref={addInput}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="e.g. Add payroll for October"
              aria-label="New to-do"
              className="h-10 flex-1 rounded-lg border border-line-strong bg-surface px-3 text-sm text-fg placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            />
            <button type="submit" disabled={!title.trim() || add.isPending} className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              Add
            </button>
          </form>
        ) : null}

        {list.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-surface-2" />)
        ) : !items.length ? (
          compact ? (
            <p className="flex items-center gap-2 py-1 text-sm text-muted">
              <ListTodo className="h-5 w-5 shrink-0" aria-hidden />
              Nothing on your list — tap + to add a to-do.
            </p>
          ) : (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <ListTodo className="h-8 w-8 text-muted" aria-hidden />
              <p className="text-sm font-medium text-fg">Nothing on your list</p>
              <p className="text-xs text-muted">Tap + to add a to-do for {date === today ? 'today' : formatKey(date, 'dd MMM')}.</p>
            </div>
          )
        ) : (
          <ul className={cn('space-y-2', compact && 'scrollbar-thin max-h-[208px] overflow-y-auto pr-1')} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            {items.map((t) => (
              <li
                key={t._id}
                draggable
                onDragStart={() => setDragId(t._id)}
                onDragEnter={() => onDragEnter(t._id)}
                onDragEnd={onDrop}
                className={cn(
                  'group flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-shadow',
                  ROW[t.color] ?? ROW.gray,
                  dragId === t._id && 'opacity-60 shadow-md',
                )}
              >
                <GripVertical className={cn('h-4 w-4 shrink-0 cursor-grab', GRIP[t.color] ?? GRIP.gray)} aria-hidden />
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={(e) => update.mutate({ id: t._id, done: e.target.checked })}
                  aria-label={`Done: ${t.title}`}
                  className="h-4 w-4 shrink-0 cursor-pointer rounded border-line-strong accent-emerald-600"
                />
                <span className={cn('min-w-0 flex-1 truncate text-sm font-semibold text-fg', t.done && 'text-muted line-through')}>{t.title}</span>
                <button
                  type="button"
                  onClick={() => remove.mutate(t._id)}
                  aria-label={`Delete ${t.title}`}
                  className="shrink-0 rounded p-1 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-rose-600 focus-visible:opacity-100"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        </div>
      </div>
    </Card>
  );
};
