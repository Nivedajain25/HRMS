import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, House, Plane, UserCheck, UserPlus, Users, UserX } from 'lucide-react';
import { Skeleton } from '@/components/ui/display';
import { useAttendanceDashboard } from '@/features/attendance/api';
import { cn, formatNumber } from '@/lib/utils';
import { useAdminDashboard } from '../api';

type Tone = 'violet' | 'emerald' | 'amber' | 'rose' | 'blue' | 'purple';

const TONE: Record<Tone, { card: string; icon: string; value: string }> = {
  violet: { card: 'from-violet-50 to-white ring-violet-100 dark:from-violet-500/10 dark:ring-violet-500/20', icon: 'bg-violet-500', value: 'text-violet-700 dark:text-violet-300' },
  emerald: { card: 'from-emerald-50 to-white ring-emerald-100 dark:from-emerald-500/10 dark:ring-emerald-500/20', icon: 'bg-emerald-500', value: 'text-emerald-700 dark:text-emerald-300' },
  amber: { card: 'from-amber-50 to-white ring-amber-100 dark:from-amber-500/10 dark:ring-amber-500/20', icon: 'bg-amber-500', value: 'text-amber-700 dark:text-amber-300' },
  rose: { card: 'from-rose-50 to-white ring-rose-100 dark:from-rose-500/10 dark:ring-rose-500/20', icon: 'bg-rose-500', value: 'text-rose-700 dark:text-rose-300' },
  blue: { card: 'from-blue-50 to-white ring-blue-100 dark:from-blue-500/10 dark:ring-blue-500/20', icon: 'bg-blue-500', value: 'text-blue-700 dark:text-blue-300' },
  purple: { card: 'from-purple-50 to-white ring-purple-100 dark:from-purple-500/10 dark:ring-purple-500/20', icon: 'bg-purple-500', value: 'text-purple-700 dark:text-purple-300' },
};

/** Change vs a previous value, as a signed % (null when there's nothing to compare against). */
const change = (now: number, before: number | undefined) => (before ? Math.round(((now - before) / before) * 1000) / 10 : null);

const Kpi = ({
  label,
  value,
  icon,
  tone,
  to,
  delta,
  share,
  note,
  delay,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone: Tone;
  to: string;
  /** Signed % change vs last month. */
  delta?: number | null;
  /** Share of all employees, %. */
  share?: number;
  note: string;
  delay: number;
}) => (
  <Link
    to={to}
    className={cn(
      'group flex flex-col rounded-2xl bg-gradient-to-br p-4 ring-1 transition-[transform,box-shadow] hover:shadow-pop motion-safe:animate-fade-up motion-safe:hover:-translate-y-0.5 dark:to-surface',
      TONE[tone].card,
    )}
    style={{ animationDelay: `${delay}ms` }}
  >
    <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg text-white shadow-sm', TONE[tone].icon)} aria-hidden>
      {icon}
    </span>
    <span className="mt-3 truncate text-sm font-medium text-black dark:text-fg">{label}</span>
    <span className="mt-1 text-2xl font-bold text-black tabular-nums dark:text-fg">{formatNumber(value)}</span>
    <span className="mt-2 flex items-center gap-1 text-xs font-semibold">
      {delta != null ? (
        <span className={cn('inline-flex items-center gap-0.5', delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
          {delta >= 0 ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />}
          {`${Math.abs(delta)}%`}
        </span>
      ) : share != null ? (
        <span className={TONE[tone].value}>{`${share}%`}</span>
      ) : (
        <span className="text-muted">—</span>
      )}
    </span>
    <span className="mt-0.5 text-[11px] text-black/60 dark:text-muted">{note}</span>
  </Link>
);

/** Admin dashboard: headline numbers for today — headcount, present, on leave, absent, remote and new joiners. */
export const KpiStrip = () => {
  const admin = useAdminDashboard(true);
  const att = useAttendanceDashboard({});
  const c = admin.data?.cards;
  const a = att.data;

  if (admin.isLoading || !c) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6" role="status" aria-label="Loading the headline numbers">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-2xl" />
        ))}
      </div>
    );
  }

  const total = c.totalEmployees;
  const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  const growth = admin.data?.charts.employeeGrowth ?? [];
  const thisMonth = growth[growth.length - 1];
  const lastMonth = growth[growth.length - 2];
  const joiners = admin.data?.insights.joinersThisMonth.length ?? thisMonth?.joined ?? 0;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
      {/* Meaning colours (lib/module-colors): people blue, in/present green, away/attention amber, absent red. */}
      <Kpi label="Total Employees" value={total} icon={<Users className="h-5 w-5" />} tone="blue" to="/employees" delta={change(thisMonth?.headcount ?? total, lastMonth?.headcount)} note="vs. last month" delay={0} />
      <Kpi label="Present Today" value={c.presentToday} icon={<UserCheck className="h-5 w-5" />} tone="emerald" to="/attendance?view=board" share={pct(c.presentToday)} note="of total employees" delay={60} />
      <Kpi label="On Leave Today" value={c.onLeaveToday} icon={<Plane className="h-5 w-5" />} tone="amber" to="/leave?tab=all" share={pct(c.onLeaveToday)} note="of total employees" delay={120} />
      <Kpi label="Absent Today" value={c.absentToday} icon={<UserX className="h-5 w-5" />} tone="rose" to="/attendance?view=board" share={pct(c.absentToday)} note="of total employees" delay={180} />
      <Kpi label="Working Remotely" value={a?.workFromHome ?? 0} icon={<House className="h-5 w-5" />} tone="emerald" to="/attendance" share={pct(a?.workFromHome ?? 0)} note="of total employees" delay={240} />
      <Kpi label="New Joiners" value={joiners} icon={<UserPlus className="h-5 w-5" />} tone="blue" to="/employees" delta={change(thisMonth?.joined ?? joiners, lastMonth?.joined)} note="this month vs. last" delay={300} />
    </div>
  );
};
