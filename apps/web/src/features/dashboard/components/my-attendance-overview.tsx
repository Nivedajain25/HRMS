import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BicepsFlexed, CalendarCheck, Clock3, Hourglass, Plane, TrendingUp, UserCheck, Users } from 'lucide-react';
import { Skeleton } from '@/components/ui/display';
import { formatNumber, minutesToHours } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useAttendanceSummary, type SummaryRow } from '@/features/attendance/api';
import { useAdminDashboard } from '../api';
import { formatKey } from '../lib';
import { ListSkeleton, ViewAllLink, Widget, WidgetEmpty } from './widget';

/** Segments of the month ring, in drawing order. */
const SEGMENTS = [
  // In the employee dashboard's blues: on time = the sidebar's dark navy, late = a lighter blue.
  { key: 'onTime', label: 'On time', color: '#1e3a8a', dot: 'bg-[#1e3a8a]' },
  { key: 'late', label: 'Late', color: '#60a5fa', dot: 'bg-blue-400' },
  { key: 'wfh', label: 'WFH', color: '#22d3ee', dot: 'bg-cyan-400' },
  { key: 'leave', label: 'Leave', color: '#8b5cf6', dot: 'bg-violet-500' },
  { key: 'absent', label: 'Absent', color: '#ef4444', dot: 'bg-red-500' },
] as const;
type SegmentKey = (typeof SEGMENTS)[number]['key'];

/** Donut of the month's days; segments sweep in after mount. */
const MonthRing = ({ counts, centre, caption }: { counts: Record<SegmentKey, number>; centre: string; caption: string }) => {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setDrawn(true), 80);
    return () => window.clearTimeout(id);
  }, []);
  const total = SEGMENTS.reduce((a, s) => a + counts[s.key], 0);
  let offset = 0;
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="21" cy="21" r="15.9" fill="none" strokeWidth="5" className="stroke-surface-3" />
        {total > 0 &&
          SEGMENTS.map((s) => {
            const pct = (counts[s.key] / total) * 100;
            if (!pct) return null;
            const el = (
              <circle
                key={s.key}
                cx="21"
                cy="21"
                r="15.9"
                fill="none"
                pathLength={100}
                strokeWidth="5"
                stroke={s.color}
                strokeDasharray={`${drawn ? Math.max(0, pct - 0.8) : 0} 100`}
                strokeDashoffset={-offset}
                className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-1000 motion-safe:ease-out"
              />
            );
            offset += pct;
            return el;
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xl font-bold text-fg tabular-nums">{centre}</span>
        <span className="text-[10px] font-medium text-muted uppercase">{caption}</span>
      </div>
    </div>
  );
};

const MiniStat = ({ icon, label, value, delay }: { icon: ReactNode; label: string; value: string; delay: number }) => (
  <li
    // Same light blue box as the Today card's In / Out / Break facts.
    className="rounded-xl border border-[#dbeafe] bg-[#eff6ff] px-2.5 py-2 motion-safe:animate-pop-in dark:border-[#1d4ed8]/30 dark:bg-[#1d4ed8]/15"
    style={{ animationDelay: `${delay}ms` } as CSSProperties}
  >
    <p className="flex items-center gap-1 text-[11px] font-medium whitespace-nowrap text-black dark:text-fg">
      {icon}
      {label}
    </p>
    <p className="mt-0.5 text-[13px] font-semibold whitespace-nowrap text-black tabular-nums dark:text-fg">{value}</p>
  </li>
);

const OrgTile = ({
  icon,
  label,
  value,
  to,
  tone,
  delay,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  to: string;
  tone: string;
  delay: number;
}) => (
  <li className="motion-safe:animate-pop-in" style={{ animationDelay: `${delay}ms` } as CSSProperties}>
    <Link
      to={to}
      className="block rounded-xl border border-line bg-surface px-2.5 py-2 motion-safe:transition-[transform,box-shadow] motion-safe:duration-200 hover:shadow-pop motion-safe:hover:-translate-y-0.5"
    >
      <p className="flex items-center gap-1 text-[11px] font-medium whitespace-nowrap text-muted">
        <span className={tone}>{icon}</span>
        {label}
      </p>
      <p className="mt-0.5 text-base font-bold text-fg tabular-nums">{value}</p>
    </Link>
  </li>
);

/** Headcount strip for people who can see the organization dashboard (shares its cache). */
const CompanyToday = () => {
  const { canAny } = usePermissions();
  const allowed = canAny('report:read', 'employee:read');
  const org = useAdminDashboard(allowed);
  if (!allowed) return null;
  const c = org.data?.cards;
  return (
    <div className="border-t border-line pt-4">
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Company today</p>
      {org.isLoading ? (
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : org.error || !c ? (
        <p className="text-xs text-muted">Couldn’t load company numbers.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          <OrgTile
            icon={<Users className="h-3 w-3" aria-hidden />}
            label="Total"
            value={formatNumber(c.totalEmployees)}
            to="/employees"
            tone="text-brand-600 dark:text-brand-400"
            delay={440}
          />
          <OrgTile
            icon={<UserCheck className="h-3 w-3" aria-hidden />}
            label="Active"
            value={formatNumber(c.activeEmployees)}
            to="/employees"
            tone="text-emerald-600 dark:text-emerald-400"
            delay={510}
          />
          <OrgTile
            icon={<Plane className="h-3 w-3" aria-hidden />}
            label="On leave"
            value={formatNumber(c.onLeaveToday)}
            to="/leave/calendar"
            tone="text-violet-600 dark:text-violet-400"
            delay={580}
          />
        </ul>
      )}
    </div>
  );
};

/** "My day" quick summary of this month's attendance: day mix ring, on-time rate and hours (+ company headcount for HR). */
export const MyAttendanceOverview = ({ date }: { date: string }) => {
  const from = `${date.slice(0, 7)}-01`;
  const summary = useAttendanceSummary({ from, to: date, scope: 'me' });
  const row = summary.data?.employees[0];

  const onTime = row ? Math.max(0, row.present - row.late) : 0;
  const counts: Record<SegmentKey, number> = {
    onTime,
    late: row?.late ?? 0,
    wfh: row?.workFromHome ?? 0,
    leave: row?.leave ?? 0,
    absent: row?.absent ?? 0,
  };
  const attended = (row?.present ?? 0) + (row?.workFromHome ?? 0) + (row?.halfDay ?? 0);
  const onTimeRate = row && row.present ? Math.round((onTime / row.present) * 100) : null;
  const empty = !!row && attended + counts.leave + counts.absent === 0;

  return (
    // Styled like the Today card beside it: blue title box, a line under the header, blue border.
    <Widget
      title="Attendance"
      className="bg-[#f8fbff] dark:bg-surface [&>header]:border-b [&>header]:border-line"
      icon={<CalendarCheck className="h-4 w-4" />}
      accent="warm"
      description={`This month · ${formatKey(from, 'd')}–${formatKey(date, 'd MMM')}`}
      action={<ViewAllLink to="/attendance" />}
      loading={summary.isLoading}
      skeleton={<ListSkeleton rows={3} />}
      error={summary.error}
      onRetry={() => summary.refetch()}
    >
      <div className="space-y-4 px-5 pb-5">
        {!row || empty ? (
          <WidgetEmpty
            icon={<CalendarCheck className="h-4 w-4" />}
            title="No attendance yet this month"
            description="Check in and your summary appears here."
          />
        ) : (
          <MyMonth counts={counts} onTimeRate={onTimeRate} row={row} />
        )}
        {/* Shown even without personal attendance (e.g. admins who don't clock in). */}
        <CompanyToday />
      </div>
    </Widget>
  );
};

/** The personal part: day-mix ring with legend, then days / average / total hours. */
const MyMonth = ({ counts, onTimeRate, row }: { counts: Record<SegmentKey, number>; onTimeRate: number | null; row: SummaryRow }) => (
  <>
    <div className="flex items-center gap-4">
      <MonthRing counts={counts} centre={onTimeRate !== null ? `${onTimeRate}%` : '—'} caption="on time" />
      <ul className="min-w-0 flex-1 space-y-1.5">
        {SEGMENTS.filter((s) => counts[s.key] > 0 || s.key === 'onTime' || s.key === 'late').map((s, i) => (
          <li
            key={s.key}
            className="flex items-center justify-between gap-2 text-sm motion-safe:animate-fade-up"
            style={{ animationDelay: `${120 + i * 70}ms` }}
          >
            <span className="flex min-w-0 items-center gap-2 text-fg-2">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} aria-hidden />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="shrink-0 font-semibold whitespace-nowrap text-fg tabular-nums">
              {counts[s.key]} <span className="text-xs font-normal text-muted">{counts[s.key] === 1 ? 'day' : 'days'}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
    <ul className="grid grid-cols-3 gap-2">
      <MiniStat icon={<TrendingUp className="h-3 w-3" aria-hidden />} label="Worked" value={`${row.workedDays} days`} delay={260} />
      <MiniStat
        icon={<Clock3 className="h-3 w-3" aria-hidden />}
        label="Avg / day"
        value={minutesToHours(Math.round(row.averageHours * 60))}
        delay={330}
      />
      <MiniStat
        icon={<Hourglass className="h-3 w-3" aria-hidden />}
        label="Total"
        value={minutesToHours(Math.round(row.totalWorkingHours * 60))}
        delay={400}
      />
    </ul>
    {row.overtimeHours > 0 && (
      <p className="text-xs text-muted">
        Including <span className="font-medium text-fg-2">{minutesToHours(Math.round(row.overtimeHours * 60))}</span> overtime{' '}
        <BicepsFlexed className="inline-block h-3.5 w-3.5 align-[-0.125em] text-emerald-600 dark:text-emerald-400" aria-hidden />
      </p>
    )}
  </>
);
