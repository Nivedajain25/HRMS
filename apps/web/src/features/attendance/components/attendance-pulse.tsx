import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { Clock3, Home, PartyPopper, Plane, Sunrise, Timer, TimerOff, UserCheck, UserX } from 'lucide-react';
import { Avatar } from '@/components/ui/display';
import { clock12, cn, formatNumber } from '@/lib/utils';
import type { AttendanceDashboard, BoardCard, TrendPoint } from '../api';
import { formatKey, formatTimeIn, hoursLabel } from '../lib';

/* ------------------------------- Helpers -------------------------------- */

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Counts up from 0 to `value` in ~0.9 s (instantly with reduced motion). */
const useCountUp = (value: number | undefined, duration = 900) => {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (value === undefined) return;
    if (reducedMotion()) {
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return shown;
};

/** The organization's wall clock, ticking every second. */
const useClock = (timeZone: string) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return new Intl.DateTimeFormat('en-IN', { timeZone, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(now).toUpperCase();
};

/** Minutes since local midnight (org timezone) for an instant. */
const minuteOfDay = (value: string | Date, timeZone: string) => {
  const [h, m] = formatTimeIn(value, timeZone).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const TONES = {
  green: { hex: '#10b981', text: 'text-emerald-600 dark:text-emerald-300', bubble: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300', bar: 'from-emerald-400 to-teal-500' },
  amber: { hex: '#f59e0b', text: 'text-amber-600 dark:text-amber-300', bubble: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300', bar: 'from-amber-300 to-orange-500' },
  red: { hex: '#f43f5e', text: 'text-rose-600 dark:text-rose-300', bubble: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300', bar: 'from-rose-400 to-red-500' },
  purple: { hex: '#a855f7', text: 'text-purple-600 dark:text-purple-300', bubble: 'bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300', bar: 'from-violet-400 to-fuchsia-500' },
  blue: { hex: '#0ea5e9', text: 'text-sky-600 dark:text-sky-300', bubble: 'bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300', bar: 'from-sky-400 to-blue-500' },
  indigo: { hex: '#6366f1', text: 'text-indigo-600 dark:text-indigo-300', bubble: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300', bar: 'from-indigo-400 to-violet-500' },
  teal: { hex: '#14b8a6', text: 'text-teal-600 dark:text-teal-300', bubble: 'bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300', bar: 'from-teal-400 to-cyan-500' },
  gray: { hex: '#94a3b8', text: 'text-slate-500 dark:text-slate-300', bubble: 'bg-slate-100 text-slate-500 dark:bg-slate-500/15 dark:text-slate-300', bar: 'from-slate-300 to-slate-400' },
} as const;
type Tone = keyof typeof TONES;

/* --------------------------------- Ring --------------------------------- */

/** Donut of the day: on time, late, not in yet, absent, on leave — segments sweep in on load. */
const DayRing = ({ d }: { d: AttendanceDashboard }) => {
  // 0 → 1 sweep (frame-driven, so it always completes even in a background tab).
  const sweep = useCountUp(1, 1100);
  const total = Math.max(1, d.totalEmployees);
  const onTime = Math.max(0, d.presentToday - d.lateToday);
  const segments: { value: number; tone: Tone; label: string }[] = [
    { value: onTime, tone: 'green', label: 'On time' },
    { value: d.lateToday, tone: 'amber', label: 'Late' },
    { value: d.onLeave, tone: 'purple', label: 'On leave' },
    { value: d.absentToday, tone: 'red', label: 'Absent' },
    { value: d.notClockedIn, tone: 'gray', label: 'Not in yet' },
  ];
  const r = 64;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const shown = useCountUp(d.presentToday);
  const pct = Math.round((d.presentToday / total) * 100);

  return (
    <div className="relative h-44 w-44 shrink-0" role="img" aria-label={`${d.presentToday} of ${d.totalEmployees} in, ${pct}%. ${segments.map((s) => `${s.label} ${s.value}`).join(', ')}`}>
      <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
        <circle cx="80" cy="80" r={r} fill="none" stroke="currentColor" strokeWidth="14" className="text-slate-200/70 dark:text-white/10" />
        {segments.map((s) => {
          const len = (s.value / total) * circ * sweep;
          const el =
            len > 0.5 ? (
              <circle
                key={s.label}
                cx="80"
                cy="80"
                r={r}
                fill="none"
                stroke={TONES[s.tone].hex}
                strokeWidth="14"
                strokeLinecap={len > 8 ? 'round' : 'butt'}
                strokeDasharray={`${Math.max(0, len - (len > 8 ? 4 : 0))} ${circ}`}
                strokeDashoffset={-offset}
              />
            ) : null;
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <p className="text-4xl leading-none font-extrabold tabular-nums text-fg">
          {Math.round(shown)}
          <span className="text-lg font-semibold text-muted">/{d.totalEmployees}</span>
        </p>
        <p className="mt-1 text-xs font-semibold tracking-wide text-muted uppercase">in today</p>
        <p className="mt-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">{`${pct}%`}</p>
      </div>
    </div>
  );
};

/* ----------------------------- Arrivals track --------------------------- */

const DAY_START = 7 * 60;
const DAY_END = 21 * 60;
const at = (minute: number) => Math.min(100, Math.max(0, ((minute - DAY_START) / (DAY_END - DAY_START)) * 100));

/** 7 AM → 9 PM ruler with everyone's avatar placed at their clock-in time (late arrivals ringed amber), plus "now". */
const ArrivalsTrack = ({ cards, timeZone }: { cards: BoardCard[]; timeZone: string }) => {
  const grow = useCountUp(1, 1200);
  const arrived = cards.filter((c) => c.checkIn && !c.restricted).sort((a, b) => new Date(a.checkIn!).getTime() - new Date(b.checkIn!).getTime());
  const nowPos = at(minuteOfDay(new Date(), timeZone));
  const hours = [7, 9, 11, 13, 15, 17, 19, 21];

  return (
    <div className="mt-4">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
        <Sunrise className="h-3.5 w-3.5" aria-hidden />
        Arrivals today
      </p>
      <div className="relative h-14" aria-label={`${arrived.length} arrivals: ${arrived.map((c) => `${c.employee.firstName} at ${clock12(formatTimeIn(c.checkIn, timeZone))}`).join(', ')}`} role="img">
        <div className="absolute inset-x-0 top-6 h-2 rounded-full bg-gradient-to-r from-sky-200 via-amber-200 to-indigo-200 dark:from-sky-500/20 dark:via-amber-500/20 dark:to-indigo-500/20" />
        <div
          className="absolute top-6 h-2 rounded-full bg-gradient-to-r from-sky-400 via-amber-400 to-orange-500"
          style={{ width: `${nowPos * grow}%` }}
        />
        {/* Now marker */}
        <div className="absolute top-3 flex -translate-x-1/2 flex-col items-center" style={{ left: `${nowPos}%` }}>
          <span className="h-8 w-0.5 rounded-full bg-indigo-500" />
          <span className="mt-0.5 rounded bg-indigo-500 px-1 text-[9px] font-bold text-white">NOW</span>
        </div>
        {arrived.map((c, i) => (
          <div
            key={c.employee._id}
            className="absolute top-0 -translate-x-1/2 motion-safe:animate-pop-in"
            style={{ left: `${at(minuteOfDay(c.checkIn!, timeZone))}%`, animationDelay: `${300 + i * 80}ms` } as CSSProperties}
            title={`${c.employee.firstName} ${c.employee.lastName} · ${clock12(formatTimeIn(c.checkIn, timeZone))}${c.isLate ? ` · late ${c.lateMinutes}m` : ''}`}
          >
            <div className={cn('rounded-full ring-2 ring-offset-1 ring-offset-surface', c.isLate ? 'ring-amber-400' : 'ring-emerald-400')}>
              <Avatar name={`${c.employee.firstName} ${c.employee.lastName}`} src={c.employee.profilePhoto} size="xs" />
            </div>
          </div>
        ))}
      </div>
      <div className="relative mt-1 h-4 text-[10px] text-muted">
        {hours.map((h) => (
          <span key={h} className="absolute -translate-x-1/2" style={{ left: `${at(h * 60)}%` }}>
            {h > 12 ? `${h - 12}p` : h === 12 ? '12p' : `${h}a`}
          </span>
        ))}
      </div>
    </div>
  );
};

/* -------------------------------- Header -------------------------------- */

const Legend = ({ tone, label, value }: { tone: Tone; label: string; value: number }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/70 px-2.5 py-1 text-xs font-medium text-fg-2 backdrop-blur">
    <span className="h-2 w-2 rounded-full" style={{ background: TONES[tone].hex }} aria-hidden />
    {label}
    <span className="font-bold tabular-nums text-fg">{value}</span>
  </span>
);

/**
 * The day at a glance: donut of who's in / late / away, a live ticking clock, the arrivals ruler and
 * who's still expected. `controls` holds the date / scope pickers.
 */
export const PulseHeader = ({
  d,
  cards,
  isToday,
  date,
  timeZone,
  controls,
}: {
  d: AttendanceDashboard | undefined;
  cards: BoardCard[];
  isToday: boolean;
  date: string;
  timeZone: string;
  controls: ReactNode;
}) => {
  const clock = useClock(timeZone);
  const firstIn = cards.filter((c) => c.checkIn && !c.restricted).sort((a, b) => new Date(a.checkIn!).getTime() - new Date(b.checkIn!).getTime())[0];
  const expected = cards.filter((c) => c.column === 'NOT_IN' && !c.absent);
  const working = d?.dayKind === 'WORKING';

  return (
    <section className="relative mt-4 overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-indigo-50 via-surface to-fuchsia-50 p-5 shadow-sm dark:from-indigo-500/10 dark:via-surface dark:to-fuchsia-500/10">
      {/* Soft coloured blobs drifting in the background */}
      <span className="pointer-events-none absolute -top-16 -right-10 h-56 w-56 rounded-full bg-fuchsia-300/30 blur-3xl motion-safe:animate-[float_9s_ease-in-out_infinite] dark:bg-fuchsia-500/15" aria-hidden />
      <span className="pointer-events-none absolute -bottom-20 left-1/3 h-56 w-56 rounded-full bg-sky-300/30 blur-3xl motion-safe:animate-[float_11s_ease-in-out_infinite] dark:bg-sky-500/10" style={{ animationDelay: '2s' }} aria-hidden />

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center">
        {d ? <DayRing d={d} /> : <div className="h-44 w-44 shrink-0 animate-pulse rounded-full bg-surface-2" aria-hidden />}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-bold text-fg">
                {d?.scope === 'team' ? 'Team pulse' : 'Organization pulse'}
                {isToday && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-700 uppercase dark:bg-emerald-500/15 dark:text-emerald-300">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 motion-safe:animate-soft-ping" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    Live
                  </span>
                )}
              </h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted">
                {formatKey(date, 'EEEE, dd MMM yyyy')}
                {isToday && <span className="font-mono text-sm font-semibold text-indigo-600 tabular-nums dark:text-indigo-300">{clock}</span>}
                {d && !working && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                    <PartyPopper className="h-3.5 w-3.5" aria-hidden />
                    {d.dayKind === 'HOLIDAY' ? (d.holiday ?? 'Holiday') : 'Week off'}
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">{controls}</div>
          </div>

          {d ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Legend tone="green" label="On time" value={Math.max(0, d.presentToday - d.lateToday)} />
              <Legend tone="amber" label="Late" value={d.lateToday} />
              <Legend tone="gray" label="Not in yet" value={d.notClockedIn} />
              <Legend tone="red" label="Absent" value={d.absentToday} />
              <Legend tone="purple" label="On leave" value={d.onLeave} />
            </div>
          ) : null}

          {isToday && working ? <ArrivalsTrack cards={cards} timeZone={timeZone} /> : null}

          {isToday && working && (firstIn || expected.length) ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              {firstIn ? (
                <p className="flex items-center gap-2 text-fg-2">
                  <span aria-hidden>🏆</span>
                  First in:
                  <span className="font-semibold text-fg">{firstIn.employee.firstName}</span>
                  <span className="text-muted">{clock12(formatTimeIn(firstIn.checkIn, timeZone))}</span>
                </p>
              ) : null}
              {expected.length ? (
                <div className="flex items-center gap-2 text-fg-2">
                  <span>Still expected</span>
                  <div className="flex -space-x-2">
                    {expected.slice(0, 6).map((c) => (
                      <div key={c.employee._id} className="rounded-full ring-2 ring-surface" title={`${c.employee.firstName} ${c.employee.lastName}`}>
                        <Avatar name={`${c.employee.firstName} ${c.employee.lastName}`} src={c.employee.profilePhoto} size="xs" />
                      </div>
                    ))}
                  </div>
                  {expected.length > 6 ? <span className="text-xs font-semibold text-muted">{`+${expected.length - 6}`}</span> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
};

/* ------------------------------ Stat cards ------------------------------ */

/** Tiny 14-day line with a soft fill, drawn in the stat's colour. */
const Sparkline = ({ values, tone }: { values: number[]; tone: Tone }) => {
  const id = useId().replace(/:/g, '');
  if (values.length < 2 || !values.some((v) => v > 0)) return <div className="h-8" aria-hidden />;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 30 - (v / max) * 26] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      <defs>
        <linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={TONES[tone].hex} stopOpacity="0.35" />
          <stop offset="100%" stopColor={TONES[tone].hex} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L100,32 L0,32 Z`} fill={`url(#sp-${id})`} />
      <path d={line} fill="none" stroke={TONES[tone].hex} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

const StatCard = ({
  label,
  value,
  format,
  hint,
  icon,
  tone,
  spark,
  loading,
  index,
}: {
  label: string;
  value: number | undefined;
  format: (n: number) => string;
  hint?: string;
  icon: ReactNode;
  tone: Tone;
  spark: number[];
  loading: boolean;
  index: number;
}) => {
  const n = useCountUp(value);
  return (
    <div
      className="group relative overflow-hidden rounded-2xl border border-line bg-surface p-4 shadow-sm motion-safe:animate-pop-in motion-safe:transition-[transform,box-shadow] motion-safe:duration-200 hover:shadow-pop motion-safe:hover:-translate-y-0.5"
      style={{ animationDelay: `${index * 60}ms` } as CSSProperties}
    >
      <div className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', TONES[tone].bar)} aria-hidden />
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold text-muted">{label}</p>
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl motion-safe:transition-transform motion-safe:group-hover:scale-110 motion-safe:group-hover:-rotate-6', TONES[tone].bubble)} aria-hidden>
          {icon}
        </span>
      </div>
      {loading ? (
        <span className="mt-2 block h-7 w-12 animate-pulse rounded bg-surface-2" aria-hidden />
      ) : (
        <p className={cn('mt-1 text-2xl leading-none font-extrabold tabular-nums', TONES[tone].text)}>{value === undefined ? '—' : format(n)}</p>
      )}
      <p className="mt-1 h-4 truncate text-[11px] text-muted">{hint ?? 'Last 14 days ↓'}</p>
      <div className="mt-1">
        <Sparkline values={spark} tone={tone} />
      </div>
    </div>
  );
};

/** Seven compact stat cards, each with a count-up number and its 14-day sparkline. */
export const PulseStats = ({ d, loading, dayLabel }: { d: AttendanceDashboard | undefined; loading: boolean; dayLabel: string }) => {
  const trend = d?.trend ?? [];
  const series = (k: keyof TrendPoint) => trend.map((p) => Number(p[k] ?? 0));
  const whole = (n: number) => formatNumber(Math.round(n));
  const share = (n: number | undefined) => (d?.totalEmployees && n !== undefined ? `${Math.round((n / d.totalEmployees) * 100)}% of ${d.totalEmployees}` : undefined);
  const cards = [
    { label: `Present ${dayLabel}`, value: d?.presentToday, format: whole, hint: share(d?.presentToday), icon: <UserCheck className="h-4 w-4" />, tone: 'green' as Tone, spark: series('present') },
    { label: `Absent ${dayLabel}`, value: d?.absentToday, format: whole, hint: d?.notClockedIn ? `${d.notClockedIn} not clocked in yet` : undefined, icon: <UserX className="h-4 w-4" />, tone: 'red' as Tone, spark: series('absent') },
    { label: `Late ${dayLabel}`, value: d?.lateToday, format: whole, hint: share(d?.lateToday), icon: <Clock3 className="h-4 w-4" />, tone: 'amber' as Tone, spark: series('late') },
    { label: 'On leave', value: d?.onLeave, format: whole, icon: <Plane className="h-4 w-4" />, tone: 'purple' as Tone, spark: series('onLeave') },
    { label: 'Work from home', value: d?.workFromHome, format: whole, icon: <Home className="h-4 w-4" />, tone: 'blue' as Tone, spark: series('workFromHome') },
    { label: 'Average hours', value: d?.averageHours, format: hoursLabel, hint: 'Completed days', icon: <Timer className="h-4 w-4" />, tone: 'indigo' as Tone, spark: series('averageHours') },
    { label: 'Overtime', value: d?.overtimeHours, format: hoursLabel, icon: <TimerOff className="h-4 w-4" />, tone: 'teal' as Tone, spark: series('overtimeHours') },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      {cards.map((c, i) => (
        <StatCard key={c.label} index={i} loading={loading} {...c} />
      ))}
    </div>
  );
};
