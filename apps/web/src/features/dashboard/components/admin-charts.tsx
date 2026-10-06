import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { BarChart3, Briefcase, Building2, CalendarRange, TrendingUp, UserCheck } from 'lucide-react';
import {
  CHART_COLORS,
  CHART_OTHER,
  ChartDataTable,
  ChartFrame,
  chartAxis,
  chartGrid,
  chartLegend,
  chartTooltip,
  paletteColor,
} from '@/components/charts/chart-kit';
import { label } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { AdminDashboard } from '../api';
import { formatCount, formatKey } from '../lib';
import { Widget, WidgetEmpty } from './widget';

type Charts = AdminDashboard['charts'];

/** Tooltip body with arbitrary rows (lets a single-series chart show related figures). */
const RowsTooltip = ({
  active,
  title,
  rows,
}: {
  active?: boolean;
  title: string;
  rows: { label: string; value: string | number; color?: string }[];
}) =>
  active ? (
    <div style={chartTooltip.contentStyle}>
      <p style={chartTooltip.labelStyle}>{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-4 text-xs text-fg-2">
          <span className="flex items-center gap-1.5">
            {r.color && <span className="h-2 w-2 rounded-full" style={{ background: r.color }} aria-hidden />}
            {r.label}
          </span>
          <span className="font-semibold text-fg tabular-nums">{r.value}</span>
        </p>
      ))}
    </div>
  ) : null;

const barEnds = [4, 4, 0, 0] as [number, number, number, number];

/* --------------------------- Employee growth --------------------------- */

export const EmployeeGrowthChart = ({ data, className }: { data: Charts['employeeGrowth']; className?: string }) => {
  const rows = data.map((d) => ({ ...d, label: formatKey(d.month, 'MMM yy') }));
  const first = rows[0]?.headcount ?? 0;
  const last = rows[rows.length - 1]?.headcount ?? 0;
  const joined = rows.reduce((a, r) => a + r.joined, 0);
  const exited = rows.reduce((a, r) => a + r.exited, 0);
  const aria = `Headcount over the last 12 months went from ${first} to ${last}; ${joined} joined and ${exited} left.`;
  return (
    <Widget
      title="Headcount growth"
      description={`Last 12 months · ${joined} joined · ${exited} left`}
      icon={<TrendingUp className="h-4 w-4" />}
      className={className}
      empty={!rows.length}
      emptyState={<WidgetEmpty icon={<BarChart3 className="h-4 w-4" />} title="No headcount history yet" />}
    >
      <div className="px-3 pb-4">
        <ChartFrame label={aria} height={250}>
          <AreaChart data={rows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="dash-headcount" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.brand} stopOpacity={0.28} />
                <stop offset="100%" stopColor={CHART_COLORS.brand} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid {...chartGrid} />
            <XAxis dataKey="label" {...chartAxis} interval="preserveStartEnd" minTickGap={16} />
            <YAxis {...chartAxis} allowDecimals={false} width={40} domain={['dataMin - 2', 'dataMax + 2']} />
            <Tooltip
              cursor={{ stroke: 'var(--line-strong)', strokeDasharray: '3 3' }}
              content={({ active, payload }: TooltipProps<number, string>) => {
                const p = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                return p ? (
                  <RowsTooltip
                    active={active}
                    title={formatKey(p.month, 'MMMM yyyy')}
                    rows={[
                      { label: 'Headcount', value: p.headcount, color: CHART_COLORS.brand },
                      { label: 'Joined', value: p.joined },
                      { label: 'Left', value: p.exited },
                    ]}
                  />
                ) : null;
              }}
            />
            <Area
              type="monotone"
              dataKey="headcount"
              name="Headcount"
              stroke={CHART_COLORS.brand}
              strokeWidth={2}
              fill="url(#dash-headcount)"
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
            />
          </AreaChart>
        </ChartFrame>
        <ChartDataTable
          caption="Headcount by month"
          columns={['Month', 'Headcount', 'Joined', 'Left']}
          rows={rows.map((r) => [r.label, r.headcount, r.joined, r.exited])}
        />
      </div>
    </Widget>
  );
};

/* --------------------------- Attendance trend -------------------------- */

const ATTENDANCE_SERIES = [
  { key: 'present', name: 'Present', color: CHART_COLORS.green },
  { key: 'onLeave', name: 'On leave', color: CHART_COLORS.purple },
  { key: 'absent', name: 'Absent', color: CHART_COLORS.red },
] as const;

export const AttendanceTrendChart = ({ data, className }: { data: Charts['attendanceTrend']; className?: string }) => {
  const rows = data.map((d) => ({ ...d, label: formatKey(d.date, 'dd MMM') }));
  const hasData = rows.some((r) => r.present + r.absent + r.onLeave > 0);
  const avgPresent = rows.length ? Math.round(rows.reduce((a, r) => a + r.present, 0) / rows.length) : 0;
  return (
    <Widget
      title="Attendance trend"
      description={`Last 14 days · avg ${avgPresent} present per day`}
      icon={<UserCheck className="h-4 w-4" />}
      accent="green"
      className={className}
      empty={!hasData}
      emptyState={<WidgetEmpty icon={<BarChart3 className="h-4 w-4" />} title="No attendance recorded in the last 14 days" />}
    >
      <div className="px-3 pb-4">
        <ChartFrame
          label={`Daily attendance for the last 14 days, stacked by present, on leave and absent. Average ${avgPresent} present per day.`}
          height={250}
        >
          <BarChart data={rows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid {...chartGrid} />
            <XAxis dataKey="label" {...chartAxis} interval="preserveStartEnd" minTickGap={12} />
            <YAxis {...chartAxis} allowDecimals={false} width={40} />
            <Tooltip
              {...chartTooltip}
              content={({ active, payload }: TooltipProps<number, string>) => {
                const p = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                return p ? (
                  <RowsTooltip
                    active={active}
                    title={formatKey(p.date, 'EEE, dd MMM')}
                    rows={[
                      ...ATTENDANCE_SERIES.map((s) => ({ label: s.name, value: p[s.key], color: s.color })),
                      { label: 'of which late', value: p.late },
                    ]}
                  />
                ) : null;
              }}
            />
            <Legend {...chartLegend} />
            {ATTENDANCE_SERIES.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stackId="a"
                fill={s.color}
                stroke="var(--surface)"
                strokeWidth={1}
                radius={i === ATTENDANCE_SERIES.length - 1 ? barEnds : undefined}
                maxBarSize={28}
              />
            ))}
          </BarChart>
        </ChartFrame>
        <ChartDataTable
          caption="Daily attendance"
          columns={['Date', 'Present', 'On leave', 'Absent', 'Late']}
          rows={rows.map((r) => [r.label, r.present, r.onLeave, r.absent, r.late])}
        />
      </div>
    </Widget>
  );
};

/* ------------------------------ Leave trend ---------------------------- */

export const LeaveTrendChart = ({ data, className }: { data: Charts['leaveTrend']; className?: string }) => {
  const types = data.types.map((t, i) => ({ ...t, fill: t.color || paletteColor(i) }));
  const rows = data.months.map((m) => ({ label: formatKey(m.month, 'MMM yy'), month: m.month, total: m.total, ...m.byType }));
  const total = data.months.reduce((a, m) => a + m.total, 0);
  return (
    <Widget
      title="Leave taken by type"
      description={`Approved days · last 6 months · ${formatCount(total)} total`}
      icon={<CalendarRange className="h-4 w-4" />}
      accent="purple"
      className={className}
      empty={!types.length || total === 0}
      emptyState={<WidgetEmpty icon={<CalendarRange className="h-4 w-4" />} title="No approved leave in the last 6 months" />}
    >
      <div className="px-3 pb-4">
        <ChartFrame
          label={`Approved leave days per month for the last 6 months, stacked by leave type (${types.map((t) => t.name).join(', ')}). ${formatCount(total)} days in total.`}
          height={250}
        >
          <BarChart data={rows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid {...chartGrid} />
            <XAxis dataKey="label" {...chartAxis} />
            <YAxis {...chartAxis} allowDecimals={false} width={40} />
            <Tooltip {...chartTooltip} formatter={(v: number, name: string) => [`${formatCount(v)} days`, name]} />
            <Legend {...chartLegend} />
            {types.map((t, i) => (
              <Bar
                key={t.code}
                dataKey={t.code}
                name={t.name}
                stackId="leave"
                fill={t.fill}
                stroke="var(--surface)"
                strokeWidth={1}
                radius={i === types.length - 1 ? barEnds : undefined}
                maxBarSize={40}
              />
            ))}
          </BarChart>
        </ChartFrame>
        <ChartDataTable
          caption="Approved leave days by month and type"
          columns={['Month', ...types.map((t) => t.name), 'Total']}
          rows={data.months.map((m) => [formatKey(m.month, 'MMM yyyy'), ...types.map((t) => m.byType[t.code] ?? 0), m.total])}
        />
      </div>
    </Widget>
  );
};

/* ------------------------ Department distribution ---------------------- */

const MAX_DEPARTMENTS = 8;

export const DepartmentChart = ({ data, className }: { data: Charts['departmentDistribution']; className?: string }) => {
  const top = data.slice(0, MAX_DEPARTMENTS);
  const rest = data.slice(MAX_DEPARTMENTS).reduce((a, d) => a + d.count, 0);
  const rows = [
    ...top.map((d) => ({ name: d.name, count: d.count, other: false })),
    ...(rest ? [{ name: 'Other', count: rest, other: true }] : []),
  ];
  const total = data.reduce((a, d) => a + d.count, 0);
  return (
    <Widget
      title="By department"
      description={`${total} active employees`}
      icon={<Building2 className="h-4 w-4" />}
      accent="blue"
      className={className}
      empty={!rows.length}
      emptyState={<WidgetEmpty icon={<Building2 className="h-4 w-4" />} title="No departments yet" />}
    >
      <ul className="space-y-2.5 px-5 pb-5" aria-label="Active employees by department">
        {rows.map((r) => {
          const pct = total ? (r.count / total) * 100 : 0;
          return (
            <li key={r.name}>
              <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-fg-2">{r.name}</span>
                <span className="shrink-0 font-semibold text-fg tabular-nums">
                  {r.count}
                  <span className="ml-1 text-xs font-normal text-muted">{Math.round(pct)}%</span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(pct, 2)}%`, background: r.other ? CHART_OTHER : CHART_COLORS.brand }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Widget>
  );
};

/* ------------------------ Employment type split ------------------------ */

export const EmploymentTypeChart = ({ data, className }: { data: Charts['employmentTypeDistribution']; className?: string }) => {
  const total = data.reduce((a, d) => a + d.count, 0);
  const rows = data.map((d, i) => ({ ...d, name: label(d.type), color: paletteColor(i), pct: total ? (d.count / total) * 100 : 0 }));
  return (
    <Widget
      title="Employment type"
      description={`${total} active employees`}
      icon={<Briefcase className="h-4 w-4" />}
      accent="teal"
      className={className}
      empty={!rows.length}
      emptyState={<WidgetEmpty icon={<Briefcase className="h-4 w-4" />} title="No employees yet" />}
    >
      <div className="space-y-4 px-5 pb-5">
        <div
          className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full"
          role="img"
          aria-label={`Employment types: ${rows.map((r) => `${r.name} ${r.count}`).join(', ')}`}
        >
          {rows.map((r) => (
            <div
              key={r.type}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ width: `${r.pct}%`, background: r.color }}
              title={`${r.name}: ${r.count}`}
            />
          ))}
        </div>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
          {rows.map((r) => (
            <li key={r.type} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2 text-fg-2">
                <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full')} style={{ background: r.color }} aria-hidden />
                <span className="truncate">{r.name}</span>
              </span>
              <span className="font-semibold text-fg tabular-nums">{r.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </Widget>
  );
};
