import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, CalendarDays, PartyPopper } from 'lucide-react';
import { Avatar, Card } from '@/components/ui/display';
import { useAttendanceBoard, useAttendanceDashboard } from '@/features/attendance/api';
import { dateKeyIn, formatKey, useOrgTimezone } from '@/features/attendance/lib';
import { cn } from '@/lib/utils';
import { TitleIcon } from './widget';

const SEGMENTS = [
  // Shades of violet, darkest to lightest.
  { key: 'present', label: 'Present', color: '#6d28d9' },
  { key: 'late', label: 'Late', color: '#8b5cf6' },
  { key: 'leave', label: 'On leave', color: '#a78bfa' },
  { key: 'absent', label: 'Absent', color: '#2e1065' },
  { key: 'notIn', label: 'Not in yet', color: '#ddd6fe' },
] as const;
type SegKey = (typeof SEGMENTS)[number]['key'];

/** Point on a circle (angles in degrees, 180 = left, 0 = right, measured over the top). */
const polar = (cx: number, cy: number, r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const;
};

/** A thick arc from `from`° down to `to`° (left → right over the top). */
const arcPath = (from: number, to: number, r: number) => {
  const [x1, y1] = polar(120, 120, r, from);
  const [x2, y2] = polar(120, 120, r, to);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${from - to > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

/** Grows 0 → 1 on mount, frame-driven so it also finishes in a background tab. */
const useSweep = (key: string) => {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setT(1);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1000);
      setT(1 - Math.pow(1 - p, 3));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    setT(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [key]);
  return t;
};

/** Half-donut gauge of the day (present / late / on leave / absent / not in yet) with percentages and absentees. */
export const AttendanceOverview = ({ className }: { className?: string }) => {
  const timeZone = useOrgTimezone();
  const today = dateKeyIn(timeZone);
  const [date, setDate] = useState(today);
  const dateInput = useRef<HTMLInputElement>(null);
  const isToday = date === today;
  const dash = useAttendanceDashboard({ date: isToday ? undefined : date });
  const board = useAttendanceBoard({ date: isToday ? undefined : date });
  const d = dash.data;

  const counts: Record<SegKey, number> = {
    present: d ? Math.max(0, d.presentToday - d.lateToday) : 0,
    late: d?.lateToday ?? 0,
    leave: d?.onLeave ?? 0,
    absent: d?.absentToday ?? 0,
    notIn: d?.notClockedIn ?? 0,
  };
  const total = d?.totalEmployees ?? 0;
  const inToday = d?.presentToday ?? 0;
  const sweep = useSweep(`${date}-${total}-${inToday}`);

  // Segments laid over 180°, with a small gap between them.
  const GAP = 3;
  const shown = SEGMENTS.filter((s) => counts[s.key] > 0);
  const usable = 180 - GAP * Math.max(0, shown.length - 1);
  let cursor = 180;
  const arcs = shown.map((s) => {
    const span = total ? (counts[s.key] / total) * usable : 0;
    const from = cursor;
    const to = cursor - span * sweep;
    cursor -= span + GAP;
    return { ...s, from, to };
  });

  const absentees = (board.data?.cards ?? []).filter((c) => c.column === 'NOT_IN' && !c.restricted);
  const pct = (n: number) => (total ? `${Math.round((n / total) * 100)}%` : '0%');

  return (
    <Card
      className={cn(
        'flex flex-col overflow-hidden border-violet-100 bg-white motion-safe:animate-fade-up dark:border-violet-500/20 dark:bg-surface',
        className,
      )}
    >
      <div className="flex min-h-16 items-center justify-between gap-3 border-b border-line bg-white px-5 py-3.5 dark:bg-surface">
        {/* Title in a violet box with black text. */}
        <h3 className="truncate rounded-lg bg-violet-300 px-2.5 py-0.5 text-base font-semibold whitespace-nowrap text-black shadow-sm">
          <TitleIcon icon={BarChart3} />
          Attendance Overview
        </h3>
        <div className="relative">
          <button
            type="button"
            onClick={() => dateInput.current?.showPicker?.()}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-black dark:text-fg shadow-sm hover:bg-surface-2"
          >
            <CalendarDays className="h-4 w-4" aria-hidden />
            {isToday ? 'Today' : formatKey(date, 'dd MMM')}
          </button>
          <input
            ref={dateInput}
            type="date"
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value || today)}
            aria-label="Choose a day"
            className="pointer-events-none absolute right-0 bottom-0 h-0 w-0 opacity-0"
            tabIndex={-1}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col px-5 pt-6 pb-5">
        {/* Gauge */}
        <div className="relative mx-auto w-full max-w-[340px]">
          <svg viewBox="0 0 240 130" className="w-full" role="img" aria-label={`${inToday} of ${total} in. ${SEGMENTS.map((s) => `${s.label} ${counts[s.key]}`).join(', ')}`}>
            <path d={arcPath(180, 0, 92)} fill="none" stroke="currentColor" strokeWidth="40" className="text-violet-50 dark:text-violet-500/10" />
            {arcs.map((a) => (
              <path key={a.key} d={arcPath(a.from, Math.min(a.from - 0.01, a.to), 92)} fill="none" stroke={a.color} strokeWidth="40" />
            ))}
          </svg>
          <div className="absolute inset-x-0 bottom-1 text-center">
            <p className="text-sm text-black dark:text-fg">Total Attendance</p>
            <p className="mt-0.5 text-2xl font-bold text-black dark:text-fg tabular-nums">{dash.isLoading ? '—' : inToday}</p>
            <p className="text-[11px] text-black dark:text-fg">{`of ${total} employees`}</p>
          </div>
        </div>

        {/* Status */}
        <p className="mt-6 text-base font-semibold text-black dark:text-fg">Status</p>
        <ul className="mt-3 space-y-3.5">
          {SEGMENTS.map((s) => (
            <li key={s.key} className="flex items-center gap-2.5 text-[15px]">
              <span className="h-3.5 w-3.5 rounded-full" style={{ background: s.color }} aria-hidden />
              <span className="flex-1 text-black dark:text-fg">{s.label}</span>
              <span className="text-xs text-black dark:text-fg tabular-nums">{counts[s.key]}</span>
              <span className="w-12 text-right font-semibold text-black dark:text-fg tabular-nums">{pct(counts[s.key])}</span>
            </li>
          ))}
        </ul>

        {/* Absentees */}
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-violet-50 px-4 py-3.5 dark:bg-violet-500/10">
          <span className="text-[15px] whitespace-nowrap text-black dark:text-fg" title={isToday ? 'Not checked in yet or absent' : undefined}>
            Absentees
          </span>
          <div className="flex -space-x-2">
            {absentees.slice(0, 4).map((c) => (
              <div key={c.employee._id} className="rounded-full ring-2 ring-violet-50 dark:ring-violet-950" title={`${c.employee.firstName} ${c.employee.lastName}`}>
                <Avatar name={`${c.employee.firstName} ${c.employee.lastName}`} src={c.employee.profilePhoto} size="sm" />
              </div>
            ))}
            {absentees.length > 4 ? (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-700 text-xs font-bold text-white ring-2 ring-violet-50 dark:ring-violet-950">{`+${absentees.length - 4}`}</span>
            ) : null}
            {!absentees.length && !board.isLoading ? (
              <span className="inline-flex items-center gap-1 text-xs text-black dark:text-fg">
                None <PartyPopper className="h-3.5 w-3.5 text-violet-600 dark:text-violet-300" aria-hidden />
              </span>
            ) : null}
          </div>
          <Link to="/attendance?view=board" className="ml-auto text-sm font-medium whitespace-nowrap text-black underline decoration-violet-600 underline-offset-2 hover:decoration-2 dark:text-fg">
            View Details
          </Link>
        </div>
      </div>
    </Card>
  );
};
