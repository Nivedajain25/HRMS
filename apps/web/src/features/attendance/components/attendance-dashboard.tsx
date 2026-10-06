import type { ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { Building2, CalendarRange, TrendingUp } from 'lucide-react';
import { CHART_COLORS, ChartFrame, chartAxis, chartGrid, chartLegend, chartTooltip } from '@/components/charts/chart-kit';
import { Card, CardBody, ErrorState } from '@/components/ui/display';
import { Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useAttendanceBoard, useAttendanceDashboard } from '../api';
import { PulseHeader, PulseStats } from './attendance-pulse';
import { dateKeyIn, formatKey, hoursLabel, useOrgTimezone } from '../lib';

/* ------------------------------ Chart cards ---------------------------- */

const HEADER_TONES = {
  green: { bar: 'from-emerald-400 to-teal-500', icon: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  indigo: { bar: 'from-indigo-400 to-violet-500', icon: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300' },
  pink: { bar: 'from-pink-400 via-fuchsia-500 to-violet-500', icon: 'bg-pink-100 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300' },
} as const;

/** Card with a colourful top strip and an icon bubble next to the title. */
const ColorCard = ({
  title,
  description,
  icon,
  tone,
  className,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  tone: keyof typeof HEADER_TONES;
  className?: string;
  children: ReactNode;
}) => (
  <Card className={cn('overflow-hidden motion-safe:animate-fade-up', className)}>
    <div className={cn('h-1.5 bg-gradient-to-r', HEADER_TONES[tone].bar)} aria-hidden />
    <div className="flex items-center gap-3 px-5 pt-4">
      <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', HEADER_TONES[tone].icon)} aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <p className="text-xs text-muted">{description}</p>
      </div>
    </div>
    <CardBody>{children}</CardBody>
  </Card>
);

/** Vertical gradient for areas and bars. */
const Fade = ({ id, color, from = 0.45, to = 0.02 }: { id: string; color: string; from?: number; to?: number }) => (
  <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stopColor={color} stopOpacity={from} />
    <stop offset="100%" stopColor={color} stopOpacity={to} />
  </linearGradient>
);

/* -------------------------------- View --------------------------------- */

export const AttendanceDashboardView = ({
  date,
  scope,
  onChange,
}: {
  date?: string;
  scope?: string;
  onChange: (patch: { date?: string; scope?: string }) => void;
}) => {
  const timeZone = useOrgTimezone();
  const today = dateKeyIn(timeZone);
  const { can, isManager } = usePermissions();
  const canChooseScope = can('attendance:read') && isManager;
  // A stale `scope=team` (e.g. an admin login without a team) is ignored rather than failing the request.
  if (scope === 'team' && !isManager) scope = undefined;
  const dash = useAttendanceDashboard({ date: date || undefined, scope: scope || undefined });
  // Today's live board feeds the arrivals ruler and "still expected" avatars.
  const board = useAttendanceBoard({ scope: scope || undefined }, !date || date === today);
  const d = dash.data;
  const loading = dash.isLoading;
  const isToday = !date || date === today;
  const dayLabel = isToday ? 'today' : formatKey(date!, 'dd MMM');

  if (dash.error && !d) return <ErrorState className="card" message={dash.error.message} onRetry={() => dash.refetch()} />;

  const trend = (d?.trend ?? []).map((p) => ({ ...p, label: formatKey(p.date, 'dd MMM') }));
  const monthly = (d?.monthly ?? []).map((p) => ({ ...p, label: formatKey(`${p.month}-01`, 'MMM yy') }));
  const departments = (d?.byDepartment ?? []).map((x) => ({ ...x, absentOrOther: Math.max(0, x.total - x.present - x.onLeave) }));

  return (
    <div className="space-y-6">
      {/* The day at a glance: donut, live clock, arrivals ruler; then stat cards with 14-day sparklines. */}
      <PulseHeader
        d={d}
        cards={isToday ? (board.data?.cards ?? []) : []}
        isToday={isToday}
        date={date ?? today}
        timeZone={timeZone}
        controls={
          <>
            {canChooseScope && (
              <Select
                aria-label="Scope"
                className="w-36"
                value={scope ?? ''}
                onChange={(e) => onChange({ scope: e.target.value || undefined })}
                options={[{ value: 'team', label: 'My team' }]}
                placeholder="Organization"
              />
            )}
            <Input
              type="date"
              aria-label="Dashboard date"
              className="w-[10rem]"
              max={today}
              value={date ?? today}
              onChange={(e) => onChange({ date: e.target.value && e.target.value !== today ? e.target.value : undefined })}
            />
          </>
        }
      />

      <PulseStats d={d} loading={loading} dayLabel={dayLabel} />

      <div className="grid gap-6 xl:grid-cols-3">
        <ColorCard title="Attendance trend" description="Last 14 days" icon={<TrendingUp className="h-4 w-4" />} tone="green" className="xl:col-span-2">
          <ChartFrame label="Area chart of present, late, absent and on-leave counts over the last 14 days" loading={loading} empty={!trend.some((p) => p.present || p.absent || p.late)} emptyTitle="No attendance recorded in this period">
            <AreaChart data={trend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <Fade id="att-present" color={CHART_COLORS.green} />
                <Fade id="att-late" color={CHART_COLORS.amber} from={0.35} />
                <Fade id="att-absent" color={CHART_COLORS.red} from={0.3} />
                <Fade id="att-leave" color={CHART_COLORS.purple} from={0.3} />
              </defs>
              <CartesianGrid {...chartGrid} />
              <XAxis dataKey="label" {...chartAxis} interval="preserveStartEnd" minTickGap={16} />
              <YAxis {...chartAxis} allowDecimals={false} width={40} />
              <Tooltip {...chartTooltip} cursor={{ stroke: 'var(--line-strong)' }} />
              <Legend {...chartLegend} />
              <Area type="monotone" dataKey="present" name="Present" stroke={CHART_COLORS.green} strokeWidth={2.5} fill="url(#att-present)" dot={false} activeDot={{ r: 5 }} />
              <Area type="monotone" dataKey="late" name="Late" stroke={CHART_COLORS.amber} strokeWidth={2.5} fill="url(#att-late)" dot={false} activeDot={{ r: 5 }} />
              <Area type="monotone" dataKey="absent" name="Absent" stroke={CHART_COLORS.red} strokeWidth={2.5} fill="url(#att-absent)" dot={false} activeDot={{ r: 5 }} />
              <Area type="monotone" dataKey="onLeave" name="On leave" stroke={CHART_COLORS.purple} strokeWidth={2.5} fill="url(#att-leave)" dot={false} activeDot={{ r: 5 }} />
            </AreaChart>
          </ChartFrame>
        </ColorCard>

        <ColorCard title="Monthly attendance" description="Present days and average hours, last 6 months" icon={<CalendarRange className="h-4 w-4" />} tone="indigo">
          <ChartFrame label="Bar chart of present days per month" loading={loading} empty={!monthly.some((m) => m.present)} emptyTitle="No monthly data yet">
            <BarChart data={monthly} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="att-month" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#06b6d4" />
                </linearGradient>
              </defs>
              <CartesianGrid {...chartGrid} />
              <XAxis dataKey="label" {...chartAxis} />
              <YAxis {...chartAxis} allowDecimals={false} width={40} />
              <Tooltip
                {...chartTooltip}
                cursor={{ fill: 'var(--surface-2)' }}
                formatter={(value: number, name: string, item) => {
                  const payload = (item as { payload?: { averageHours?: number } }).payload;
                  return name === 'Present days' ? [`${value} (avg ${hoursLabel(payload?.averageHours)}/day)`, name] : [value, name];
                }}
              />
              <Bar dataKey="present" name="Present days" fill="url(#att-month)" radius={[8, 8, 0, 0]} maxBarSize={30} />
            </BarChart>
          </ChartFrame>
        </ColorCard>
      </div>

      <ColorCard title="Department attendance" description={`Headcount by attendance ${dayLabel}`} icon={<Building2 className="h-4 w-4" />} tone="pink">
        <ChartFrame
          label="Stacked bar chart of present, on leave and other employees per department"
          height={Math.max(220, departments.length * 36 + 60)}
          loading={loading}
          empty={!departments.length}
          emptyTitle="No departments to show"
        >
          <BarChart data={departments} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }} barCategoryGap={8}>
            <defs>
              <linearGradient id="dep-present" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#0d9488" />
              </linearGradient>
              <linearGradient id="dep-leave" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#c084fc" />
                <stop offset="100%" stopColor="#7c3aed" />
              </linearGradient>
              <linearGradient id="dep-other" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#fda4af" />
                <stop offset="100%" stopColor="#f43f5e" />
              </linearGradient>
            </defs>
            <CartesianGrid {...chartGrid} horizontal={false} vertical />
            <XAxis type="number" {...chartAxis} allowDecimals={false} />
            <YAxis type="category" dataKey="name" {...chartAxis} width={110} />
            <Tooltip
              {...chartTooltip}
              cursor={{ fill: 'var(--surface-2)' }}
              formatter={(value: number, name: string, item) => {
                const payload = (item as { payload?: { attendanceRate?: number } }).payload;
                return name === 'Present' ? [`${value} (${payload?.attendanceRate ?? 0}%)`, name] : [value, name];
              }}
            />
            <Legend {...chartLegend} />
            <Bar dataKey="present" name="Present" stackId="a" fill="url(#dep-present)" stroke="var(--surface)" strokeWidth={1} maxBarSize={22} />
            <Bar dataKey="onLeave" name="On leave" stackId="a" fill="url(#dep-leave)" stroke="var(--surface)" strokeWidth={1} maxBarSize={22} />
            <Bar dataKey="absentOrOther" name="Not present" stackId="a" fill="url(#dep-other)" stroke="var(--surface)" strokeWidth={1} radius={[0, 6, 6, 0]} maxBarSize={22} />
          </BarChart>
        </ChartFrame>
      </ColorCard>
    </div>
  );
};
