import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, ArrowRight, Building2, Clock, Coffee, Home, Hourglass, LogIn, LogOut, PartyPopper } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/overlay';
import { label } from '@/lib/i18n';
import { clock12, cn, minutesToHours } from '@/lib/utils';
import { useToday } from '@/features/attendance/api';
import { formatTimeIn, useOrgTimezone } from '@/features/attendance/lib';
import { useClockFlow } from '@/features/attendance/use-clock-flow';
import type { DashboardAttendance, EmployeeDashboard } from '../api';
import { WeekGraph } from './week-graph';

/* -------------------------------- State -------------------------------- */

type DayState = 'NOT_CHECKED_IN' | 'WORKING' | 'ON_BREAK' | 'DONE' | 'NO_CLOCK';

const dayState = (r: DashboardAttendance | null): DayState => {
  if (!r?.checkIn) return r && ['LEAVE', 'HOLIDAY', 'WEEK_OFF', 'ABSENT'].includes(r.status) ? 'NO_CLOCK' : 'NOT_CHECKED_IN';
  if (r.checkOut) return 'DONE';
  const last = r.breaks[r.breaks.length - 1];
  return last && !last.end ? 'ON_BREAK' : 'WORKING';
};

const PILL: Record<Exclude<DayState, 'NO_CLOCK'>, { text: string; dot: string; ping: boolean }> = {
  NOT_CHECKED_IN: { text: 'Not clocked in', dot: 'bg-slate-400', ping: false },
  WORKING: { text: 'Working', dot: 'bg-emerald-500', ping: true },
  ON_BREAK: { text: 'On break', dot: 'bg-amber-500', ping: true },
  DONE: { text: 'Clocked out', dot: 'bg-sky-500', ping: false },
};

/** Friendly one-liner for the moment. */
const moodLine = (state: DayState, hour: number, status?: string) => {
  switch (state) {
    case 'NOT_CHECKED_IN':
      return hour < 12 ? 'Ready to start your day? ☕' : 'Don’t forget to clock in 👋';
    case 'WORKING':
      return hour < 12
        ? 'Great start — you’re on the clock! 🚀'
        : hour < 17
          ? 'You’re doing great, keep going! 💪'
          : 'Almost there — wrap up strong! ✨';
    case 'ON_BREAK':
      return 'Enjoy your break, you’ve earned it ☕';
    case 'DONE':
      return 'Great work today! See you tomorrow 👋';
    default:
      return status === 'HOLIDAY'
        ? 'Happy holiday! 🎉'
        : status === 'WEEK_OFF'
          ? 'It’s your day off — relax 🌴'
          : status === 'LEAVE'
            ? 'Enjoy your time off 🌴'
            : 'No attendance needed today';
  }
};

/** Soft background tint by time of day (organization timezone). */
const tintFor = (hour: number) => {
  if (hour >= 5 && hour < 12) return 'from-amber-50 via-transparent dark:from-amber-500/10';
  if (hour >= 12 && hour < 17) return 'from-sky-100/70 via-transparent dark:from-sky-500/10';
  if (hour >= 17 && hour < 20) return 'from-orange-100/70 via-transparent dark:from-orange-500/10';
  return 'from-indigo-100/70 via-transparent dark:from-indigo-500/15';
};

const hourIn = (timeZone: string, at: Date) => {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(at)) % 24;
  } catch {
    return at.getHours();
  }
};

/** 03:43:21 */
const clock = (totalSeconds: number) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};

/* --------------------------------- Card -------------------------------- */

/** "My day" hero: live timer + goal progress, this week's hours graph, milestone chips and the clock action. */
export const TodayCard = ({ data }: { data: EmployeeDashboard }) => {
  const timeZone = useOrgTimezone();
  const flow = useClockFlow();
  const confirm = useConfirm();
  const today = useToday();
  const r = data.today;
  const state = dayState(r);

  // Tick every second while the clock runs, otherwise every 30 s.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), state === 'WORKING' ? 1000 : 30_000);
    return () => window.clearInterval(id);
  }, [state]);

  const shift = today.data?.shift;
  const target = shift?.workingHours ? Math.round(shift.workingHours * 60) : 8 * 60;

  // Live worked seconds: server value + time elapsed since it was fetched (only while working).
  const workedSeconds = useMemo(() => {
    if (state === 'DONE') return (r?.workingMinutes ?? data.workedMinutes) * 60;
    if (state !== 'WORKING' && state !== 'ON_BREAK') return 0;
    const base = (today.data?.workedMinutesSoFar ?? data.workedMinutes) * 60;
    const since = today.dataUpdatedAt || now;
    return state === 'WORKING' ? base + Math.max(0, (now - since) / 1000) : base;
  }, [state, r?.workingMinutes, data.workedMinutes, today.data?.workedMinutesSoFar, today.dataUpdatedAt, now]);
  const workedMinutes = Math.floor(workedSeconds / 60);
  const remaining = Math.max(0, target - workedMinutes);
  const progress = Math.min(1, workedMinutes / target);

  // Progress bar grows in after mount.
  const [shownProgress, setShownProgress] = useState(0);
  useEffect(() => {
    const id = window.setTimeout(() => setShownProgress(progress), 80);
    return () => window.clearTimeout(id);
  }, [progress]);

  const hour = hourIn(timeZone, new Date(now));
  const pill = state === 'NO_CLOCK' ? null : PILL[state];
  const onBreakSince = state === 'ON_BREAK' ? r?.breaks[r.breaks.length - 1]?.start : null;

  const clockIn = () => flow.run('check-in', { workMode: 'OFFICE', success: 'Clocked in. Have a productive day!' });
  const clockOut = async () => {
    const { confirmed } = await confirm({
      title: 'Clock out for today?',
      message: `You have worked ${minutesToHours(workedMinutes)} so far. You won't be able to clock in again today; use regularization for corrections.`,
      confirmLabel: 'Clock out',
      tone: 'primary',
    });
    if (confirmed) await flow.run('check-out', { success: 'Clocked out. See you tomorrow!' });
  };

  // Three compact facts under the timer (replaces the chip boxes).
  const facts: { key: string; icon: ReactNode; text: ReactNode }[] = [];
  const shiftEndText = today.data?.shiftEnd ? formatTimeIn(today.data.shiftEnd, timeZone) : null;
  if (r?.checkIn) {
    facts.push({
      key: 'in',
      icon: <LogIn className="h-3.5 w-3.5" aria-hidden />,
      text: (
        <>
          In <b className="font-semibold text-fg tabular-nums">{formatTimeIn(r.checkIn, timeZone)}</b>
          <span
            className={cn('ml-1.5 font-medium', r.isLate ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}
          >
            {r.isLate ? `${minutesToHours(r.lateMinutes)} late` : 'on time'}
          </span>
        </>
      ),
    });
  } else if (state === 'NOT_CHECKED_IN' && today.data?.shiftStart) {
    facts.push({
      key: 'start',
      icon: <AlarmClock className="h-3.5 w-3.5" aria-hidden />,
      text: (
        <>
          Shift starts <b className="font-semibold text-fg tabular-nums">{formatTimeIn(today.data.shiftStart, timeZone)}</b>
        </>
      ),
    });
  }
  if (onBreakSince) {
    facts.push({
      key: 'break',
      icon: <Coffee className="h-3.5 w-3.5" aria-hidden />,
      text: (
        <>
          On break since <b className="font-semibold text-fg tabular-nums">{formatTimeIn(onBreakSince, timeZone)}</b>
        </>
      ),
    });
  }
  if (r?.checkOut) {
    facts.push({
      key: 'out',
      icon: <LogOut className="h-3.5 w-3.5" aria-hidden />,
      text: (
        <>
          Out <b className="font-semibold text-fg tabular-nums">{formatTimeIn(r.checkOut, timeZone)}</b>
          {r.overtimeMinutes > 0 && (
            <span className="ml-1.5 font-medium text-emerald-600 dark:text-emerald-400">+{minutesToHours(r.overtimeMinutes)} overtime</span>
          )}
        </>
      ),
    });
  } else if (state !== 'NO_CLOCK' && shiftEndText) {
    facts.push({
      key: 'end',
      icon: remaining > 0 ? <Hourglass className="h-3.5 w-3.5" aria-hidden /> : <PartyPopper className="h-3.5 w-3.5" aria-hidden />,
      text: (
        <>
          Ends <b className="font-semibold text-fg tabular-nums">{shiftEndText}</b>
          {(state === 'WORKING' || state === 'ON_BREAK') && (
            <span className="ml-1.5 font-medium text-violet-600 dark:text-violet-400">
              {remaining > 0 ? `${minutesToHours(remaining)} to go` : 'hours done 🎉'}
            </span>
          )}
        </>
      ),
    });
  }
  if (r?.checkIn) {
    const remote = r.workMode === 'REMOTE';
    facts.push({
      key: 'mode',
      icon: remote ? <Home className="h-3.5 w-3.5" aria-hidden /> : <Building2 className="h-3.5 w-3.5" aria-hidden />,
      text: <b className="font-semibold text-fg">{remote ? 'Remote' : 'Office'}</b>,
    });
  }

  return (
    <section aria-label="Today's attendance" className="card relative h-full overflow-hidden">
      <div
        className={cn(
          'pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent transition-colors duration-1000',
          tintFor(hour),
        )}
        aria-hidden
      />

      <div className="relative flex h-full flex-col gap-3 p-4">
        {/* Top row: title + shift, status pill (the date is already in the dashboard header above) */}
        <div className="flex flex-wrap items-start justify-between gap-3 motion-safe:animate-fade-up">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
              <Clock className="h-4 w-4 text-brand-600 dark:text-brand-400" aria-hidden />
              Today
            </p>
            <p className="mt-0.5 text-sm text-muted">
              {shift
                ? `${shift.name} · ${today.data?.shiftStart ? formatTimeIn(today.data.shiftStart, timeZone) : clock12(shift.startTime)} – ${today.data?.shiftEnd ? formatTimeIn(today.data.shiftEnd, timeZone) : clock12(shift.endTime)}`
                : 'Your day at a glance'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {pill ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-surface/80 px-3 py-1 text-sm font-medium text-fg shadow-sm ring-1 ring-line backdrop-blur-sm">
                <span className="relative flex h-2.5 w-2.5">
                  {pill.ping && (
                    <span className={cn('absolute inline-flex h-full w-full rounded-full motion-safe:animate-soft-ping', pill.dot)} />
                  )}
                  <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', pill.dot)} />
                </span>
                {pill.text}
              </span>
            ) : (
              r && <StatusBadge status={r.status} />
            )}
            {state === 'NOT_CHECKED_IN' && (
              <span className="relative inline-flex">
                <span className="absolute inset-0 rounded-lg bg-emerald-500 motion-safe:animate-soft-ping" aria-hidden />
                <Button
                  variant="success"
                  className="relative"
                  icon={<LogIn className="h-4 w-4" />}
                  loading={flow.active === 'check-in'}
                  disabled={flow.busy}
                  onClick={clockIn}
                >
                  Clock in
                </Button>
              </span>
            )}
            {state === 'WORKING' && (
              <Button
                variant="danger"
                icon={<LogOut className="h-4 w-4" />}
                loading={flow.active === 'check-out'}
                disabled={flow.busy}
                onClick={clockOut}
              >
                Clock out
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:items-center">
          {/* Live timer + goal progress */}
          <div className="motion-safe:animate-fade-up" style={{ animationDelay: '80ms' }}>
            <p className="text-[11px] font-semibold tracking-widest text-muted uppercase">
              {state === 'DONE' ? 'Worked today' : 'Working time'}
            </p>
            <p className="font-mono text-3xl font-bold tracking-tight text-fg tabular-nums" aria-hidden>
              {clock(workedSeconds)}
            </p>
            <p className="sr-only">Worked {minutesToHours(workedMinutes)} today</p>
            <div className="mt-2">
              <div
                className="h-2.5 w-full overflow-hidden rounded-full bg-surface-3"
                role="progressbar"
                aria-label="Progress towards today's hours"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
              >
                <div
                  className={cn(
                    'h-full rounded-full motion-safe:transition-[width] motion-safe:duration-1000 motion-safe:ease-out',
                    progress >= 1 ? 'bg-gradient-to-r from-emerald-400 to-emerald-600' : 'bg-gradient-to-r from-brand-500 to-violet-500',
                  )}
                  style={{ width: `${Math.max(shownProgress * 100, workedMinutes > 0 ? 3 : 0)}%` }}
                />
              </div>
              <p className="mt-1.5 flex justify-between text-xs text-muted">
                <span>{state === 'NO_CLOCK' && r ? label(r.status) : `${Math.round(progress * 100)}% of ${minutesToHours(target)}`}</span>
                {progress >= 1 && <span className="font-medium text-emerald-600 dark:text-emerald-400">Goal reached 🎯</span>}
              </p>
            </div>
          </div>

          {/* This week */}
          <div className="motion-safe:animate-fade-up" style={{ animationDelay: '160ms' }}>
            <WeekGraph
              date={data.date}
              todayMinutes={workedMinutes}
              todayLate={r?.isLate ? r.lateMinutes : 0}
              goalHours={Math.round((target / 60) * 10) / 10}
            />
          </div>
        </div>

        {/* Facts in one horizontal row across the card: In · Ends · Place */}
        {facts.length > 0 && (
          <ul className="grid grid-cols-1 gap-2 text-sm text-fg-2 sm:grid-cols-3">
            {facts.map((x, i) => (
              <li
                key={x.key}
                className="flex min-w-0 items-center gap-2 rounded-xl bg-surface-2/70 px-3 py-2 ring-1 ring-line motion-safe:animate-pop-in motion-safe:transition-[transform,box-shadow] motion-safe:duration-200 hover:shadow-pop motion-safe:hover:-translate-y-0.5"
                style={{ animationDelay: `${200 + i * 70}ms` }}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface text-muted shadow-sm ring-1 ring-line">
                  {x.icon}
                </span>
                <span className="min-w-0 truncate">{x.text}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <p className="text-sm font-medium text-fg-2">{moodLine(state, hour, r?.status)}</p>
          {state === 'ON_BREAK' && (
            <p className="text-xs text-amber-700 dark:text-amber-300">End your break on the attendance page before clocking out.</p>
          )}
          <Link
            to="/attendance"
            className="group inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
          >
            Open attendance
            <ArrowRight className="h-4 w-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>
        {(flow.status || flow.notice) && (
          <p
            role="status"
            aria-live="polite"
            className={cn('-mt-2 text-xs', flow.status ? 'text-fg-2' : 'text-amber-700 dark:text-amber-300')}
          >
            {flow.status ?? flow.notice}
          </p>
        )}
      </div>
      {flow.selfieDialog}
    </section>
  );
};
