import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { CalendarDays, ChevronDown, CircleDashed, Clock3, Download, Timer, Umbrella, UserCheck, Users, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { Card, Skeleton } from '@/components/ui/display';
import { downloadFile, toApiError } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import { useAttendanceBoard, useAttendanceDashboard, useAttendanceList } from '../api';
import { dateKeyIn, useOrgTimezone } from '../lib';

const shiftDay = (key: string, by: number) => new Date(Date.parse(`${key}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);

/** Super admin Attendance header controls: a date picker, a quick day choice and Export Report. */
export const AdminAttendanceControls = ({ date, onDate }: { date: string | undefined; onDate: (d: string | undefined) => void }) => {
  const timeZone = useOrgTimezone();
  const today = dateKeyIn(timeZone);
  const day = date ?? today;
  const input = useRef<HTMLInputElement>(null);
  const quick = day === today ? 'today' : day === shiftDay(today, -1) ? 'yesterday' : 'custom';

  const exportReport = async () => {
    try {
      await downloadFile('/reports/attendance_log', { format: 'xlsx', from: day, to: day }, `attendance-${day}.xlsx`);
    } catch (err) {
      toast.error('Could not export the report', { description: toApiError(err).message });
    }
  };

  const control = 'inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-fg shadow-sm hover:bg-surface-2';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <button type="button" onClick={() => input.current?.showPicker?.()} className={control}>
          <CalendarDays className="h-4 w-4 text-muted" aria-hidden />
          {formatDate(`${day}T00:00:00Z`, 'EEE, dd MMM yyyy')}
          <ChevronDown className="h-4 w-4 text-muted" aria-hidden />
        </button>
        <input
          ref={input}
          type="date"
          max={today}
          value={day}
          onChange={(e) => onDate(e.target.value && e.target.value !== today ? e.target.value : undefined)}
          aria-label="Choose a day"
          tabIndex={-1}
          className="pointer-events-none absolute right-0 bottom-0 h-0 w-0 opacity-0"
        />
      </div>
      <label className="relative">
        <span className="sr-only">Quick day</span>
        <select
          value={quick}
          onChange={(e) => onDate(e.target.value === 'yesterday' ? shiftDay(today, -1) : e.target.value === 'today' ? undefined : day)}
          className={cn(control, 'appearance-none pr-9')}
        >
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          {quick === 'custom' && <option value="custom">Custom day</option>}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
      </label>
      <button type="button" onClick={() => void exportReport()} className={control}>
        <Download className="h-4 w-4 text-muted" aria-hidden />
        Export Report
      </button>
    </div>
  );
};

const Kpi = ({ icon, tone, label, value, sub, underline }: { icon: ReactNode; tone: string; label: string; value: ReactNode; sub: string; underline?: boolean }) => (
  <Card className="flex items-center gap-3.5 p-4">
    <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full', tone)} aria-hidden>
      {icon}
    </span>
    <span className="min-w-0">
      <span className="block truncate text-sm font-medium text-fg-2">{label}</span>
      <span className="block text-2xl leading-tight font-bold text-fg tabular-nums">{value}</span>
      <span className={cn('block truncate text-xs text-muted', underline && 'underline decoration-dotted underline-offset-2')}>{sub}</span>
    </span>
  </Card>
);

/** Super admin: the day's headline numbers for the whole organization. */
export const AdminAttendanceKpis = ({ date }: { date: string | undefined }) => {
  const timeZone = useOrgTimezone();
  const day = date ?? dateKeyIn(timeZone);
  const dash = useAttendanceDashboard({ date });
  const half = useAttendanceList({ scope: 'all', from: day, to: day, status: 'HALF_DAY', page: 1, limit: 1 });
  const d = dash.data;

  if (dash.isLoading || !d) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  const total = d.totalEmployees;
  const pct = (n: number) => `${total ? Math.round((n / total) * 1000) / 10 : 0}%`;
  const halfDays = half.data?.pagination.total ?? 0;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      <Kpi icon={<Users className="h-6 w-6" />} tone="bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300" label="Total Employees" value={total} sub="Active employees" />
      <Kpi icon={<UserCheck className="h-6 w-6" />} tone="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" label="Present" value={d.presentToday} sub={pct(d.presentToday)} underline />
      <Kpi icon={<UserX className="h-6 w-6" />} tone="bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300" label="Absent" value={d.absentToday} sub={pct(d.absentToday)} />
      <Kpi icon={<Clock3 className="h-6 w-6" />} tone="bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300" label="Late" value={d.lateToday} sub={pct(d.lateToday)} />
      <Kpi icon={<Umbrella className="h-6 w-6" />} tone="bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300" label="On Leave" value={d.onLeave} sub={pct(d.onLeave)} />
      <Kpi icon={<CircleDashed className="h-6 w-6" />} tone="bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300" label="Half Day" value={halfDays} sub={pct(halfDays)} />
      <Kpi icon={<Timer className="h-6 w-6" />} tone="bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300" label="Overtime" value={`${d.overtimeHours}h`} sub="Total hours" />
    </div>
  );
};

/* ------------------------- Overview + departments ------------------------- */

const BoxTitle = ({ title, right }: { title: string; right?: ReactNode }) => (
  <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-5 py-3">
    <h3 className="text-lg font-semibold text-fg">{title}</h3>
    {right}
  </div>
);

/** Donut of the day: present / late / absent / on leave / half day, with total employees in the middle. */
const OverviewCard = ({ date }: { date: string | undefined }) => {
  const timeZone = useOrgTimezone();
  const day = date ?? dateKeyIn(timeZone);
  const dash = useAttendanceDashboard({ date });
  const half = useAttendanceList({ scope: 'all', from: day, to: day, status: 'HALF_DAY', page: 1, limit: 1 });
  const d = dash.data;
  const total = d?.totalEmployees ?? 0;
  const halfDays = half.data?.pagination.total ?? 0;
  const rows = d
    ? [
        { label: 'Present', value: Math.max(0, d.presentToday - d.lateToday), color: '#10b981' },
        { label: 'Late', value: d.lateToday, color: '#f59e0b' },
        { label: 'Absent', value: d.absentToday, color: '#f43f5e' },
        { label: 'On Leave', value: d.onLeave, color: '#3b82f6' },
        { label: 'Half Day', value: halfDays, color: '#8b5cf6' },
      ]
    : [];
  const filled = rows.reduce((n, r) => n + r.value, 0);
  const pie = filled ? rows.filter((r) => r.value > 0) : [{ label: 'None', value: 1, color: 'var(--color-surface-3)' }];
  const pct = (n: number) => `${total ? Math.round((n / total) * 1000) / 10 : 0}%`;
  return (
    <Card className="overflow-hidden">
      <BoxTitle title={`${date ? formatDate(`${day}T00:00:00Z`, 'dd MMM') : "Today's"} Attendance Overview`} />
      {!d ? (
        <div className="p-5">
          <Skeleton className="h-44" />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-6 p-5 sm:flex-row">
          <div className="relative h-44 w-44 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pie} dataKey="value" nameKey="label" innerRadius="68%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
                  {pie.map((r) => (
                    <Cell key={r.label} fill={r.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold text-fg tabular-nums">{total}</span>
              <span className="text-xs text-muted">Total Employees</span>
            </div>
          </div>
          <ul className="w-full flex-1 space-y-3">
            {rows.map((r) => (
              <li key={r.label} className="flex items-center gap-3 text-sm">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
                <span className="flex-1 text-fg-2">{r.label}</span>
                <span className="w-10 text-right font-semibold text-fg tabular-nums">{r.value}</span>
                <span className="w-14 text-right text-muted tabular-nums">{pct(r.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
};

const DOT_COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f97316', '#0ea5e9', '#ec4899', '#14b8a6', '#eab308', '#ef4444', '#6366f1'];

/** Per department: total, present, absent, late and the attendance rate (present ÷ total). */
const DepartmentsCard = ({ date }: { date: string | undefined }) => {
  const board = useAttendanceBoard({ date });
  const [dept, setDept] = useState('');
  const rows = useMemo(() => {
    const map = new Map<string, { total: number; present: number; absent: number; late: number }>();
    for (const c of board.data?.cards ?? []) {
      const name = c.employee.department ?? 'No department';
      const r = map.get(name) ?? { total: 0, present: 0, absent: 0, late: 0 };
      r.total += 1;
      if (c.column === 'WORKING' || c.column === 'ON_BREAK' || c.column === 'DONE') r.present += 1;
      if (c.absent) r.absent += 1;
      if (c.isLate) r.late += 1;
      map.set(name, r);
    }
    return [...map.entries()].map(([name, r]) => ({ name, ...r, rate: r.total ? Math.round((r.present / r.total) * 100) : 0 })).sort((a, b) => a.name.localeCompare(b.name));
  }, [board.data]);
  const shown = dept ? rows.filter((r) => r.name === dept) : rows;
  const rateTone = (rate: number) =>
    rate >= 90
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
      : rate >= 75
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
        : 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300';
  return (
    <Card className="overflow-hidden">
      <BoxTitle
        title="Department-wise Attendance"
        right={
          <label className="relative">
            <span className="sr-only">Department</span>
            <select value={dept} onChange={(e) => setDept(e.target.value)} className="h-9 appearance-none rounded-lg border border-line bg-surface pr-8 pl-3 text-sm text-fg hover:bg-surface-2">
              <option value="">All Departments</option>
              {rows.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          </label>
        }
      />
      {!board.data ? (
        <div className="p-5">
          <Skeleton className="h-44" />
        </div>
      ) : (
        <div className="scrollbar-thin max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
              <tr>
                <th scope="col" className="px-5 py-2.5 text-left font-semibold">Department</th>
                <th scope="col" className="px-3 py-2.5 text-center font-semibold">Total</th>
                <th scope="col" className="px-3 py-2.5 text-center font-semibold text-emerald-700 dark:text-emerald-300">Present</th>
                <th scope="col" className="px-3 py-2.5 text-center font-semibold text-rose-700 dark:text-rose-300">Absent</th>
                <th scope="col" className="px-3 py-2.5 text-center font-semibold text-amber-700 dark:text-amber-300">Late</th>
                <th scope="col" className="px-5 py-2.5 text-center font-semibold">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((r, i) => (
                <tr key={r.name} className="hover:bg-surface-2">
                  <td className="px-5 py-2.5">
                    <span className="flex items-center gap-2.5 font-medium text-fg">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DOT_COLORS[i % DOT_COLORS.length] }} aria-hidden />
                      {r.name}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center text-fg tabular-nums">{r.total}</td>
                  <td className="px-3 py-2.5 text-center text-fg tabular-nums">{r.present}</td>
                  <td className={cn('px-3 py-2.5 text-center tabular-nums', r.absent ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-fg')}>{r.absent}</td>
                  <td className={cn('px-3 py-2.5 text-center tabular-nums', r.late ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-fg')}>{r.late}</td>
                  <td className="px-5 py-2.5 text-center">
                    <span className={cn('inline-flex min-w-12 justify-center rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums', rateTone(r.rate))}>{`${r.rate}%`}</span>
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted">
                    No employees to show.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};

/** Super admin: overview donut + department-wise table for the chosen day. */
export const AdminAttendanceBreakdown = ({ date }: { date: string | undefined }) => (
  <div className="grid gap-4 lg:grid-cols-2">
    <OverviewCard date={date} />
    <DepartmentsCard date={date} />
  </div>
);
