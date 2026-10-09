import { useContext, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { AlarmClock, Building2, Coffee, CupSoda, DoorClosed, DoorOpen, House, Loader2, LogIn, LogOut, MapPinOff, Play, Timer } from 'lucide-react';
import { Badge, Card, ErrorState, Skeleton, type Tone } from '@/components/ui/display';
import { useConfirm } from '@/components/ui/overlay';
import { useClockAction, useToday, type LiveState, type TodayState } from '@/features/attendance/api';
import { formatClock, formatTimeIn, useNow, useOrgTimezone } from '@/features/attendance/lib';
import { useClockFlow } from '@/features/attendance/use-clock-flow';
import { clock12, cn, minutesToHours } from '@/lib/utils';
import { employeeTile, TileTitle, TitleBoxContext, TitleIcon } from './widget';

const STATE_META: Record<LiveState, { label: string; tone: Tone }> = {
  NOT_CHECKED_IN: { label: 'Not checked in', tone: 'gray' },
  CHECKED_IN: { label: 'Working', tone: 'green' },
  ON_BREAK: { label: 'On break', tone: 'amber' },
  CHECKED_OUT: { label: 'Checked out', tone: 'blue' },
};

/** Live worked / break seconds from the record's instants. */
const liveSeconds = (today: TodayState, now: Date) => {
  const r = today.record;
  if (!r?.checkIn) return { worked: 0, onBreak: 0 };
  if (r.checkOut) return { worked: r.workingMinutes * 60, onBreak: r.breakMinutes * 60 };
  let breakMs = 0;
  for (const b of r.breaks) {
    const s = new Date(b.start).getTime();
    const e = b.end ? new Date(b.end).getTime() : now.getTime();
    if (e > s) breakMs += e - s;
  }
  return { worked: Math.max(0, (now.getTime() - new Date(r.checkIn).getTime() - breakMs) / 1000), onBreak: breakMs / 1000 };
};

const Fact = ({ label, value, icon, tile, accent, warm, violet }: { label: string; value: string; icon: ReactNode; tile: string; accent?: string; warm?: boolean; /** HR: soft violet boxes. */ violet?: boolean }) => (
  <div
    className={cn(
      'rounded-lg border px-2 py-1.5 text-center',
      violet
        ? 'border-violet-100 bg-violet-50/70 dark:border-violet-500/20 dark:bg-violet-500/10'
        : warm
          ? 'border-[#dbeafe] bg-[#eff6ff] dark:border-[#1d4ed8]/30 dark:bg-[#1d4ed8]/15'
          : 'border-sky-100 bg-sky-50/70 dark:border-sky-500/20 dark:bg-sky-500/10',
    )}
  >
    <p className="flex items-center justify-center gap-1.5 text-[10px] font-semibold tracking-wide text-black uppercase dark:text-fg">
      <span className={cn('flex h-5 w-5 items-center justify-center rounded-md', tile)} aria-hidden>
        {icon}
      </span>
      {label}
    </p>
    <p className={cn('text-sm font-semibold text-black tabular-nums dark:text-fg', accent)}>{value}</p>
  </div>
);

/**
 * Admin dashboard: big live clock with the date and shift, two big side-by-side buttons (light-blue Clock in,
 * blue Clock out — each turns blue once done) and In / Out / Worked / Break underneath.
 */
export const AdminClockCard = ({ className, tone = 'blue' }: { className?: string; /** Title box + border colour. */ tone?: 'blue' | 'pink' }) => {
  const today = useToday();
  const action = useClockAction();
  const confirm = useConfirm();
  const flow = useClockFlow();
  const timeZone = useOrgTimezone();
  const now = useNow(1000);
  const [pending, setPending] = useState<string | null>(null);
  // Where they work today, when the organization allows remote check-in.
  const [mode, setMode] = useState<'OFFICE' | 'REMOTE'>('OFFICE');
  // Employee dashboard titles (tiles map in the context) vs HR / admin pills. Read before the early returns below.
  const employeeTitles = typeof useContext(TitleBoxContext) === 'object';

  const clockFmt = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-IN', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    } catch {
      return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    }
  }, [timeZone]);

  if (today.isLoading) {
    return (
      <Card className={cn('space-y-4 p-5', className)} aria-busy>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mx-auto h-16 w-64" />
        <Skeleton className="h-14" />
        <Skeleton className="h-16" />
      </Card>
    );
  }
  if (today.error || !today.data) {
    return <ErrorState className={cn('card', className)} title="Could not load today's attendance" message={today.error?.message} onRetry={() => today.refetch()} />;
  }

  const t = today.data;
  const r = t.record;
  const { worked, onBreak } = liveSeconds(t, now);
  const meta = STATE_META[t.state];
  const working = t.state === 'CHECKED_IN' || t.state === 'ON_BREAK';
  const busy = action.isPending || flow.busy;
  // Breaks are a Super Admin setting; someone already on a break can always end it.
  const breakButton = (t.allowBreaks && t.state === 'CHECKED_IN') || t.state === 'ON_BREAK';
  const showBreakTime = t.allowBreaks || onBreak > 0;
  const graceEnd = new Date(t.shiftStart).getTime() + t.shift.gracePeriodMinutes * 60_000;
  const runningLate = t.state === 'NOT_CHECKED_IN' && t.dayKind === 'WORKING' && !t.shift.flexible && now.getTime() > graceEnd && now.getTime() < new Date(t.shiftEnd).getTime();
  const shiftStartMs = new Date(t.shiftStart).getTime();
  const shiftEndMs = new Date(t.shiftEnd).getTime();
  const nowMs = now.getTime();
  const countdown: { label: string; value: string; warn?: boolean } | null =
    t.state === 'CHECKED_OUT'
      ? null
      : working
        ? nowMs < shiftEndMs
          ? { label: 'Check-out in', value: formatClock((shiftEndMs - nowMs) / 1000) }
          : { label: 'Overtime', value: `+${formatClock((nowMs - shiftEndMs) / 1000)}`, warn: true }
        : t.dayKind === 'WORKING' && nowMs < shiftStartMs
          ? { label: 'Check-in in', value: formatClock((shiftStartMs - nowMs) / 1000) }
          : null;
  const [time, ampm] = clockFmt.format(now).toUpperCase().split(/\s+/);
  const t12 = (v: string | null | undefined) => (v ? clock12(formatTimeIn(v, timeZone)) : '—');

  const clockIn = () => flow.run('check-in', { workMode: t.allowRemoteClockIn ? mode : 'OFFICE', success: 'Checked in. Have a productive day!' });
  const clockOut = async () => {
    const { confirmed } = await confirm({
      title: 'Check out for today?',
      message: `You have worked ${minutesToHours(Math.floor(worked / 60))} today. You won't be able to check in again today; use regularization for corrections.`,
      confirmLabel: 'Check out',
      tone: 'primary',
    });
    if (confirmed) await flow.run('check-out', { success: 'Checked out. Have a good evening!' });
  };
  const breakToggle = async () => {
    const key = t.state === 'ON_BREAK' ? 'break/end' : 'break/start';
    setPending(key);
    try {
      await action.mutateAsync({ action: key });
      toast.success(key === 'break/end' ? 'Welcome back!' : 'Break started');
    } catch {
      /* errors are toasted globally */
    } finally {
      setPending(null);
    }
  };

  // Each button turns blue once it's been done (clocked in / clocked out).
  const bigBtn =
    'inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold shadow-sm transition-[transform,background-color,color,opacity] disabled:cursor-not-allowed motion-safe:enabled:hover:-translate-y-0.5';
  // Admin / HR: meaning colours (lib/module-colors) — Clock in green, Clock out red, Break amber.
  // Employee dashboard (tone="pink"): Clock in light grey, Clock out dark blue (matching its sidebar pill).
  // Once done, a button stays in its colour but soft, showing the time.
  const brown = tone === 'pink';
  const grey = 'border-slate-300 bg-slate-200 text-slate-900 hover:bg-slate-300 disabled:opacity-50 dark:border-slate-500/40 dark:bg-slate-500/25 dark:text-slate-100';
  const greyDone = 'border-slate-200 bg-slate-100 text-slate-800 disabled:opacity-100 dark:border-slate-500/30 dark:bg-slate-500/15 dark:text-slate-200';
  // Same dark navy as the employee sidebar's selected item (#1e3a8a), white text; stays full colour even before
  // clocking in (not faded).
  const navy = 'border-[#1e3a8a] bg-[#1e3a8a] text-white hover:bg-[#172f70] disabled:opacity-100';
  const navyDone = 'border-blue-200 bg-blue-50 text-blue-900 disabled:opacity-100 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-200';
  // HR dashboard (same card, admin-style titles): the super admin's violet theme — Clock in light purple with black
  // text, Clock out dark purple with white text.
  const violet = brown && !employeeTitles;
  const lilac = 'border-violet-300 bg-violet-200 text-black hover:bg-violet-300 disabled:opacity-50';
  const lilacDone = 'border-violet-200 bg-violet-50 text-violet-900 disabled:opacity-100 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-200';
  const plum = 'border-purple-700 bg-purple-700 text-white hover:bg-purple-800 disabled:opacity-100';
  const plumDone = 'border-purple-200 bg-purple-50 text-purple-900 disabled:opacity-100 dark:border-purple-500/30 dark:bg-purple-500/15 dark:text-purple-200';
  const inTone = violet ? lilac : brown ? grey : 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50';
  const outTone = violet ? plum : brown ? navy : 'border-rose-600 bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50';
  const inDone = violet ? lilacDone : brown ? greyDone : 'border-emerald-200 bg-emerald-50 text-emerald-800 disabled:opacity-100 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200';
  const outDone = violet ? plumDone : brown ? navyDone : 'border-rose-200 bg-rose-50 text-rose-800 disabled:opacity-100 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200';
  const clockedIn = !!r?.checkIn;
  const clockedOut = !!r?.checkOut;

  return (
    <Card
      className={cn(
        'flex flex-col overflow-hidden motion-safe:animate-fade-up dark:bg-surface',
        violet ? 'border-violet-200 bg-white dark:border-violet-500/20' : tone === 'pink' ? 'bg-[#f8fbff]' : 'border-blue-200 bg-white dark:border-blue-500/20',
        className,
      )}
    >
      <div className={cn('flex min-h-16 items-center justify-between gap-3 border-b border-line px-5 py-3.5 dark:bg-surface', tone === 'pink' && !violet ? 'bg-[#f8fbff]' : 'bg-white')}>
        {employeeTitles ? (
          // Employee dashboard: icon on a soft-blue tile, plain black title.
          <TileTitle title="Today" icon={AlarmClock} tile={employeeTile('Today')} />
        ) : (
          // HR (and the super admin's style): the alarm-clock "Today" blue pill.
          <h3 className="rounded-lg bg-blue-400 px-2.5 py-0.5 text-base font-semibold text-black shadow-sm">
            <TitleIcon icon={AlarmClock} />
            Today
          </h3>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {r?.isLate ? (
            <Badge tone="amber" className="px-2.5 py-1 text-sm">
              <AlarmClock className="h-3 w-3" aria-hidden />
              Late {minutesToHours(r.lateMinutes)}
            </Badge>
          ) : null}
          <Badge tone={meta.tone} dot className="px-2.5 py-1 text-sm">
            {meta.label}
          </Badge>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-5 pt-3 pb-4">
        {/* Current time on the left, hours worked today on the right. */}
        <div>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium tracking-wide text-black dark:text-fg uppercase">Time now</p>
              <p className="font-bold tracking-tight text-black dark:text-fg tabular-nums" aria-live="off">
                <time dateTime={now.toISOString()} className="text-2xl">
                  {time}
                </time>
                <span className="ml-1 text-xs font-semibold text-black dark:text-fg">{ampm}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="flex items-center justify-end gap-1 text-[11px] font-medium tracking-wide text-black dark:text-fg uppercase">
                <Timer className="h-3.5 w-3.5" aria-hidden />
                Worked
              </p>
              {/* Same font, size and colour as the time on the left. */}
              <p className="font-bold tracking-tight text-black dark:text-fg tabular-nums" aria-live="off">
                <span className="text-2xl">{t.state === 'NOT_CHECKED_IN' ? '00:00:00' : formatClock(worked)}</span>
              </p>
            </div>
          </div>
          {runningLate ? (
            <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
              <AlarmClock className="h-3.5 w-3.5" aria-hidden />
              Shift started {t12(t.shiftStart)} — checking in now counts as late
            </p>
          ) : null}
          {/* Live countdown (same as the mobile app): to the shift start before check-in, to check-out while working,
              overtime after the shift ends. */}
          {countdown ? (
            <p
              className={cn(
                'mt-1.5 ml-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums',
                countdown.warn ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200' : 'bg-surface-2 text-fg dark:bg-surface-3',
              )}
              aria-live="off"
            >
              <Timer className="h-3.5 w-3.5" aria-hidden />
              {countdown.label} <span className="font-bold">{countdown.value}</span>
            </p>
          ) : null}
          {t.dayKind !== 'WORKING' ? (
            <p className="mt-2 text-xs font-medium text-violet-700 dark:text-violet-300">{t.dayKind === 'HOLIDAY' ? `Holiday${t.holiday ? `: ${t.holiday}` : ''}` : 'Today is a week off'}</p>
          ) : null}
        </div>

        {/* Office / Remote, before checking in (only when remote check-in is allowed). */}
        {t.state === 'NOT_CHECKED_IN' && t.allowRemoteClockIn ? (
          <div role="radiogroup" aria-label="Where are you working today?" className="mx-auto grid w-full max-w-xs grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
            {(['OFFICE', 'REMOTE'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                disabled={busy}
                className={cn(
                  'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors',
                  mode === m ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg',
                )}
              >
                {m === 'OFFICE' ? <Building2 className="h-4 w-4" aria-hidden /> : <House className="h-4 w-4" aria-hidden />}
                {m === 'OFFICE' ? 'Office' : 'Remote'}
              </button>
            ))}
          </div>
        ) : null}

        {/* Two big buttons */}
        <div className="mx-auto flex w-full max-w-xs gap-2">
          <button
            type="button"
            onClick={clockIn}
            disabled={busy || t.state !== 'NOT_CHECKED_IN'}
            className={cn(bigBtn, clockedIn ? inDone : inTone)}
          >
            {flow.active === 'check-in' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LogIn className="h-4 w-4" aria-hidden />}
            {r?.checkIn ? `In · ${t12(r.checkIn)}` : 'Check in'}
          </button>
          <button type="button" onClick={() => void clockOut()} disabled={busy || !working} className={cn(bigBtn, clockedOut ? outDone : outTone)}>
            {flow.active === 'check-out' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LogOut className="h-4 w-4" aria-hidden />}
            {r?.checkOut ? `Out · ${t12(r.checkOut)}` : 'Check out'}
          </button>
        </div>

        {/* In / Out / Break (Break only while breaks are turned on, or if one was taken today) */}
        <div className={cn('grid gap-2', showBreakTime ? 'grid-cols-3' : 'grid-cols-2')}>
          <Fact
            label="In"
            icon={<DoorOpen className="h-3.5 w-3.5" />}
            warm={brown && !violet}
            violet={violet}
            tile="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300"
            value={t12(r?.checkIn)}
          />
          <Fact
            label="Out"
            icon={<DoorClosed className="h-3.5 w-3.5" />}
            warm={brown && !violet}
            violet={violet}
            tile="bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300"
            value={t12(r?.checkOut)}
          />
          {showBreakTime && (
            <Fact
              label="Break"
              icon={<CupSoda className="h-3.5 w-3.5" />}
              warm={brown && !violet}
              violet={violet}
              tile="bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300" value={onBreak ? formatClock(onBreak) : '0h'} accent={t.state === 'ON_BREAK' ? 'text-amber-600 dark:text-amber-400' : undefined} />
          )}
        </div>

        {working && breakButton ? (
          <button
            type="button"
            onClick={() => void breakToggle()}
            disabled={busy}
            className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200 dark:hover:bg-amber-500/20"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t.state === 'ON_BREAK' ? <Play className="h-4 w-4" aria-hidden /> : <Coffee className="h-4 w-4" aria-hidden />}
            {t.state === 'ON_BREAK' ? 'End break' : 'Start break'}
          </button>
        ) : null}

        <p role="status" aria-live="polite" className={cn('flex items-center justify-center gap-1.5 text-sm text-black dark:text-fg', !flow.status && 'sr-only')}>
          {flow.status && <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-hidden />}
          {flow.status}
        </p>
        {flow.notice ? (
          <p role="status" className="flex items-start justify-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
            <MapPinOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {flow.notice}
          </p>
        ) : null}
        {t.state === 'NOT_CHECKED_IN' && (t.requireSelfie || t.requireLocation) ? (
          <p className="text-center text-xs text-black dark:text-fg">{`Checking in needs ${[t.requireSelfie && 'a selfie', t.requireLocation && 'your location'].filter(Boolean).join(' and ')}.`}</p>
        ) : null}
      </div>
      {flow.selfieDialog}
    </Card>
  );
};
