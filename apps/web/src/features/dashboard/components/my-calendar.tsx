import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, CalendarDays, ChevronLeft, ChevronRight, Clock3, Plus, Trash2, X } from 'lucide-react';
import { Card } from '@/components/ui/display';
import { useAttendanceList, useHolidays } from '@/features/attendance/api';
import { dateKeyIn, formatKey, formatTimeIn, useOrgTimezone } from '@/features/attendance/lib';
import { useLeaves } from '@/features/leave/api';
import { del, get, post, toApiError } from '@/lib/api';
import { clock12, cn, minutesToHours } from '@/lib/utils';
import { usePermissions } from '@/store/auth';

type Kind = 'PRESENT' | 'LATE' | 'ABSENT' | 'HALF_DAY' | 'LEAVE' | 'HOLIDAY' | 'WEEK_OFF';

const KIND: Record<Kind, { label: string; cell: string; dot: string }> = {
  PRESENT: { label: 'Present', cell: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200', dot: 'bg-emerald-500' },
  LATE: { label: 'Late', cell: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200', dot: 'bg-amber-500' },
  ABSENT: { label: 'Absent', cell: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200', dot: 'bg-rose-500' },
  HALF_DAY: { label: 'Half day', cell: 'bg-orange-50 text-orange-800 dark:bg-orange-500/15 dark:text-orange-200', dot: 'bg-orange-500' },
  LEAVE: { label: 'On leave', cell: 'bg-purple-50 text-purple-800 dark:bg-purple-500/15 dark:text-purple-200', dot: 'bg-purple-500' },
  HOLIDAY: { label: 'Holiday', cell: 'bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200', dot: 'bg-sky-500' },
  WEEK_OFF: { label: 'Week off', cell: 'bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-400', dot: 'bg-slate-300' },
};
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Reminder chip colours. */
const RCOLOR = {
  blue: {
    chip: 'bg-blue-600 text-white',
    dot: 'bg-blue-600',
    cell: 'border-blue-500 bg-blue-50 text-blue-900 dark:bg-blue-500/20 dark:text-blue-100',
    bell: 'bg-blue-600',
  },
  red: {
    chip: 'bg-rose-600 text-white',
    dot: 'bg-rose-600',
    cell: 'border-rose-500 bg-rose-50 text-rose-900 dark:bg-rose-500/20 dark:text-rose-100',
    bell: 'bg-rose-600',
  },
  green: {
    chip: 'bg-emerald-600 text-white',
    dot: 'bg-emerald-600',
    cell: 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100',
    bell: 'bg-emerald-600',
  },
  amber: {
    chip: 'bg-amber-500 text-white',
    dot: 'bg-amber-500',
    cell: 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100',
    bell: 'bg-amber-500',
  },
  purple: {
    chip: 'bg-purple-600 text-white',
    dot: 'bg-purple-600',
    cell: 'border-purple-500 bg-purple-50 text-purple-900 dark:bg-purple-500/20 dark:text-purple-100',
    bell: 'bg-purple-600',
  },
} as const;
type RColor = keyof typeof RCOLOR;

interface Reminder {
  _id: string;
  title: string;
  note?: string;
  date: string;
  time: string | null;
  color: RColor;
  notifiedAt: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
};
const shift = (ym: string, d: number) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + d;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
};

/** Add-a-reminder form for the selected day. */
const ReminderForm = ({ date, onDone }: { date: string; onDone: () => void }) => {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [color, setColor] = useState<RColor>('blue');
  const save = useMutation({
    mutationFn: () => post<Reminder>('/reminders', { title: title.trim(), date, time: time || null, note: note.trim() || undefined, color }),
    meta: { silent: true },
    onSuccess: () => {
      toast.success('Reminder added', { description: `${formatKey(date, 'dd MMM')}${time ? ` at ${clock12(time)}` : ' (9:00 AM)'} — you'll get a notification.` });
      void qc.invalidateQueries({ queryKey: ['reminders'] });
      onDone();
    },
    onError: (err) => toast.error('Could not add the reminder', { description: toApiError(err).message }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim()) save.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-line bg-surface p-3">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={150}
        placeholder="e.g. Payroll review with accounts"
        aria-label="Reminder"
        className="h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-fg placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      />
      <div className="flex gap-2">
        <label className="flex flex-1 items-center gap-2 rounded-lg border border-line-strong px-2">
          <Clock3 className="h-4 w-4 text-muted" aria-hidden />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time (optional)" className="h-9 w-full bg-transparent text-sm text-fg focus:outline-none" />
        </label>
        <div role="radiogroup" aria-label="Colour" className="flex items-center gap-1.5">
          {(Object.keys(RCOLOR) as RColor[]).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={cn('h-5 w-5 rounded-full', RCOLOR[c].dot, color === c && 'ring-2 ring-fg/40 ring-offset-2 ring-offset-surface')}
            />
          ))}
        </div>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={1000}
        rows={2}
        placeholder="Note (optional)"
        aria-label="Note"
        className="w-full resize-none rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="h-8 rounded-lg px-3 text-xs font-medium text-muted hover:bg-surface-2">
          Cancel
        </button>
        <button type="submit" disabled={!title.trim() || save.isPending} className="h-8 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
          Save reminder
        </button>
      </div>
    </form>
  );
};

/**
 * My month: each day coloured by my attendance / leave, holidays marked, and (for the super admin) reminders —
 * pick a day, "Add reminder", and a notification arrives at that time.
 */
export const MyCalendar = ({ className }: { className?: string }) => {
  const qc = useQueryClient();
  const timeZone = useOrgTimezone();
  const { can } = usePermissions();
  const canRemind = can('settings:manage');
  const today = dateKeyIn(timeZone);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [adding, setAdding] = useState(false);
  const from = `${month}-01`;
  const to = monthEnd(month);

  const attendance = useAttendanceList({ scope: 'me', from, to, page: 1, limit: 31 });
  const holidays = useHolidays({ year: Number(month.slice(0, 4)) });
  const leaves = useLeaves({ scope: 'me', from, to, status: 'APPROVED', page: 1, limit: 50 });
  const reminders = useQuery({ queryKey: ['reminders', from, to], queryFn: () => get<Reminder[]>('/reminders', { from, to }) });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/reminders/${id}`),
    onSuccess: () => {
      toast.success('Reminder deleted');
      void qc.invalidateQueries({ queryKey: ['reminders'] });
    },
  });

  const byDay = useMemo(() => {
    const map = new Map<string, { kind?: Kind; holiday?: string; leave?: string; checkIn?: string | null; checkOut?: string | null; worked?: number; late?: number }>();
    const put = (k: string, v: object) => map.set(k, { ...map.get(k), ...v });
    for (const h of holidays.data ?? []) if (h.date.startsWith(month)) put(h.date, { holiday: h.name, kind: 'HOLIDAY' });
    for (const l of leaves.data?.data ?? []) {
      const s = l.startDate.slice(0, 10);
      const e = l.endDate.slice(0, 10);
      for (let d = s; d <= e && d <= to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
        if (d >= from) put(d, { kind: 'LEAVE', leave: typeof l.leaveTypeId === 'object' ? l.leaveTypeId?.name : 'Leave' });
      }
    }
    for (const r of attendance.data?.data ?? []) {
      const k = r.date.slice(0, 10);
      const kind = (['PRESENT', 'LATE', 'ABSENT', 'HALF_DAY', 'LEAVE', 'HOLIDAY', 'WEEK_OFF'] as Kind[]).includes(r.status as Kind) ? (r.status as Kind) : undefined;
      put(k, { ...(kind ? { kind: r.isLate && kind === 'PRESENT' ? 'LATE' : kind } : {}), checkIn: r.checkIn, checkOut: r.checkOut, worked: r.workingMinutes, late: r.lateMinutes });
    }
    return map;
  }, [attendance.data, holidays.data, leaves.data, month, from, to]);

  const remindersByDay = useMemo(() => {
    const map = new Map<string, Reminder[]>();
    for (const r of reminders.data ?? []) map.set(r.date, [...(map.get(r.date) ?? []), r]);
    return map;
  }, [reminders.data]);

  // Mon-first grid: blanks before the 1st, then the days.
  const lead = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7;
  const days = Number(to.slice(8));
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => `${month}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);

  const sel = byDay.get(selected);
  const selReminders = remindersByDay.get(selected) ?? [];
  const counts = [...byDay.values()].reduce<Record<string, number>>((a, v) => (v.kind ? { ...a, [v.kind]: (a[v.kind] ?? 0) + 1 } : a), {});

  return (
    <Card className={cn('flex flex-col overflow-hidden border-violet-200 motion-safe:animate-fade-up dark:border-violet-500/20', className)}>
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        {/* Admin dashboard heading style: purple title box, black text. */}
        <h3 className="rounded-lg bg-purple-300 px-2.5 py-0.5 text-base font-semibold text-black shadow-sm">
          <span aria-hidden className="mr-1.5">📅</span>
          My Calendar
        </h3>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setMonth((m) => shift(m, -1))} aria-label="Previous month" className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="min-w-[10rem] text-center text-base font-semibold text-fg" aria-live="polite">
            {formatKey(`${month}-01`, 'MMMM yyyy')}
          </span>
          <button type="button" onClick={() => setMonth((m) => shift(m, 1))} aria-label="Next month" className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg">
            <ChevronRight className="h-5 w-5" />
          </button>
          {month !== today.slice(0, 7) ? (
            <button
              type="button"
              onClick={() => {
                setMonth(today.slice(0, 7));
                setSelected(today);
              }}
              className="ml-1 inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-medium text-fg hover:bg-surface-2"
            >
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              Today
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 px-5 py-5 xl:grid-cols-[1fr_20rem]">
        <div>
          <div className="grid grid-cols-7 gap-2">
            {WEEKDAYS.map((w) => (
              <span key={w} className="pb-1 text-center text-xs font-semibold tracking-wide text-muted uppercase">
                {w}
              </span>
            ))}
            {cells.map((d, i) => {
              if (!d) return <span key={`b${i}`} />;
              const info = byDay.get(d);
              const k = info?.kind;
              const rs = remindersByDay.get(d) ?? [];
              const isToday = d === today;
              // A day with a reminder takes the (first) reminder's colour and gets a bell.
              const rc = rs.length ? (RCOLOR[rs[0]!.color] ?? RCOLOR.blue) : null;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setSelected(d);
                    setAdding(false);
                  }}
                  aria-pressed={selected === d}
                  aria-label={`${formatKey(d, 'EEEE, dd MMMM')}${k ? `: ${KIND[k].label}` : ''}${info?.holiday ? ` (${info.holiday})` : ''}${rs.length ? `, ${rs.length} reminder${rs.length === 1 ? '' : 's'}` : ''}`}
                  className={cn(
                    'relative flex h-20 flex-col items-stretch rounded-xl border p-1.5 text-left transition-colors sm:h-24',
                    rc ? cn(rc.cell, 'border-2') : k ? cn(KIND[k].cell, 'border-transparent') : 'border-line hover:bg-surface-2',
                    isToday && 'ring-2 ring-violet-500',
                    selected === d && 'outline outline-2 outline-offset-1 outline-fg/30',
                  )}
                >
                  {rc ? (
                    <span className={cn('absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full text-white shadow-sm', rc.bell)} aria-hidden>
                      <Bell className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                  <span className={cn('text-sm font-bold tabular-nums', !rc && !k && d > today && 'text-muted', !rc && !k && d <= today && 'text-fg')}>{Number(d.slice(8))}</span>
                  {info?.holiday ? <span className="mt-0.5 truncate text-[10px] font-medium text-sky-700 dark:text-sky-300">{info.holiday}</span> : null}
                  <span className="mt-auto flex flex-col gap-0.5">
                    {rs.slice(0, 2).map((r) => (
                      <span
                        key={r._id}
                        title={`${r.time ? clock12(r.time) : 'All day'} · ${r.title}`}
                        className={cn('truncate rounded px-1.5 py-0.5 text-[11px] font-semibold', RCOLOR[r.color]?.chip ?? RCOLOR.blue.chip)}
                      >
                        {r.title}
                      </span>
                    ))}
                    {rs.length > 2 ? <span className="text-[10px] font-semibold text-muted">{`+${rs.length - 2} more`}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
            {(['PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HOLIDAY'] as Kind[]).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className={cn('h-2.5 w-2.5 rounded-full', KIND[k].dot)} aria-hidden />
                {KIND[k].label}
                {counts[k] ? <b className="font-semibold text-fg">{counts[k]}</b> : null}
              </span>
            ))}
            {canRemind ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-white" aria-hidden>
                  <Bell className="h-2.5 w-2.5" />
                </span>
                Reminder
              </span>
            ) : null}
          </div>
        </div>

        {/* The selected day: status, times, and reminders */}
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-4">
          <div>
            <p className="text-xs font-medium text-muted">{selected === today ? 'Today' : formatKey(selected, 'EEEE')}</p>
            <p className="text-lg font-semibold text-fg">{formatKey(selected, 'dd MMMM yyyy')}</p>
          </div>
          <div className="space-y-2 text-sm">
            {sel?.holiday ? <p className="font-medium text-sky-700 dark:text-sky-300">{`🎉 ${sel.holiday}`}</p> : null}
            {sel?.leave ? <p className="font-medium text-purple-700 dark:text-purple-300">{`🌴 ${sel.leave}`}</p> : null}
            {sel?.kind && !sel.holiday && !sel.leave ? (
              <p className="flex items-center gap-2">
                <span className={cn('h-2.5 w-2.5 rounded-full', KIND[sel.kind].dot)} aria-hidden />
                <span className="font-medium text-fg">{KIND[sel.kind].label}</span>
                {sel.late ? <span className="text-xs text-amber-700 dark:text-amber-300">{`${minutesToHours(sel.late)} late`}</span> : null}
              </p>
            ) : null}
            {sel?.checkIn ? (
              <dl className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-muted">In</dt>
                  <dd className="font-semibold text-fg tabular-nums">{clock12(formatTimeIn(sel.checkIn, timeZone))}</dd>
                </div>
                <div>
                  <dt className="text-muted">Out</dt>
                  <dd className="font-semibold text-fg tabular-nums">{sel.checkOut ? clock12(formatTimeIn(sel.checkOut, timeZone)) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted">Worked</dt>
                  <dd className="font-semibold text-fg">{sel.worked ? minutesToHours(sel.worked) : '—'}</dd>
                </div>
              </dl>
            ) : null}
            {!sel && !selReminders.length ? <p className="text-xs text-muted">{selected > today ? 'Nothing planned for this day.' : 'No attendance recorded.'}</p> : null}
          </div>

          {/* Reminders */}
          {canRemind || selReminders.length ? (
            <div className="border-t border-line pt-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                  <Bell className="h-4 w-4 text-violet-600 dark:text-violet-300" aria-hidden />
                  Reminders
                </p>
                {canRemind && !adding ? (
                  <button type="button" onClick={() => setAdding(true)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-violet-600 px-2.5 text-xs font-semibold text-white hover:bg-violet-700">
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    Add reminder
                  </button>
                ) : null}
                {adding ? (
                  <button type="button" onClick={() => setAdding(false)} aria-label="Close" className="rounded p-1 text-muted hover:text-fg">
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              {adding ? <ReminderForm date={selected} onDone={() => setAdding(false)} /> : null}
              <ul className="mt-2 space-y-2">
                {selReminders.map((r) => (
                  <li key={r._id} className="group flex items-start gap-2 rounded-lg bg-surface px-3 py-2 ring-1 ring-line">
                    <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white', RCOLOR[r.color]?.bell ?? RCOLOR.blue.bell)} aria-hidden>
                      <Bell className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-fg">{r.title}</span>
                      <span className="block text-xs text-muted">
                        {r.time ? clock12(r.time) : 'All day · 9:00 AM'}
                        {r.notifiedAt ? ' · reminded' : ''}
                      </span>
                      {r.note ? <span className="mt-0.5 block text-xs text-fg-2">{r.note}</span> : null}
                    </span>
                    {canRemind ? (
                      <button type="button" onClick={() => remove.mutate(r._id)} aria-label={`Delete reminder ${r.title}`} className="shrink-0 rounded p-1 text-muted opacity-0 group-hover:opacity-100 hover:text-rose-600 focus-visible:opacity-100">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </li>
                ))}
                {!selReminders.length && !adding && canRemind ? <li className="text-xs text-muted">No reminders on this day.</li> : null}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
};
