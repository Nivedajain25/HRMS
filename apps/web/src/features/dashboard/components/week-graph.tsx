import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { ChartDataTable, ChartFrame, chartAxis, chartGrid } from '@/components/charts/chart-kit';
import { label } from '@/lib/i18n';
import { cn, minutesToHours } from '@/lib/utils';
import { useAttendanceList, type AttendanceRow } from '@/features/attendance/api';
import { formatTimeIn, useOrgTimezone } from '@/features/attendance/lib';
import { formatKey } from '../lib';

/** Monday-first week (date keys) containing `dateKey`. */
const weekOf = (dateKey: string) => {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 86_400_000).toISOString().slice(0, 10));
};

/* ------------------------------ Week graph ----------------------------- */

const BAR = {
  today: 'url(#week-today)',
  onTime: 'url(#week-ontime)',
  late: 'url(#week-late)',
  off: 'var(--surface-3)',
};

const OFF_STATUSES = new Set(['LEAVE', 'HOLIDAY', 'WEEK_OFF']);

interface WeekRow {
  key: string;
  day: string;
  hours: number;
  isToday: boolean;
  future: boolean;
  status: string | null;
  lateMinutes: number;
  checkIn: string | null;
  checkOut: string | null;
  fill: string;
}

const WeekTooltip = ({ active, payload, timeZone, goalHours }: TooltipProps<number, string> & { timeZone: string; goalHours: number }) => {
  const row = active ? (payload?.[0]?.payload as WeekRow | undefined) : undefined;
  if (!row) return null;
  const off = row.status && OFF_STATUSES.has(row.status);
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="font-semibold text-fg">
        {formatKey(row.key, 'EEE, d MMM')}
        {row.isToday && (
          <span className="ml-1.5 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            Today
          </span>
        )}
      </p>
      {row.future ? (
        <p className="mt-1 text-muted">Coming up</p>
      ) : off ? (
        <p className="mt-1 text-muted">{label(row.status!)}</p>
      ) : (
        <>
          <p className="mt-1 text-fg-2">
            Worked <span className="font-semibold text-fg">{minutesToHours(Math.round(row.hours * 60))}</span>
            {row.hours >= goalHours && ' 🎯'}
          </p>
          {row.checkIn && (
            <p className="text-muted">
              In {formatTimeIn(row.checkIn, timeZone)} · Out {row.checkOut ? formatTimeIn(row.checkOut, timeZone) : '—'}
            </p>
          )}
          {row.lateMinutes > 0 && <p className="text-amber-700 dark:text-amber-300">Late by {minutesToHours(row.lateMinutes)}</p>}
          {!row.checkIn && !row.isToday && <p className="text-muted">No clock-in</p>}
        </>
      )}
    </div>
  );
};

/** This week's worked hours per day against the daily goal; today's bar grows live. */
export const WeekGraph = ({
  date,
  todayMinutes,
  todayLate,
  goalHours,
  height = 130,
  showTitle = true,
}: {
  date: string;
  todayMinutes: number;
  todayLate: number;
  goalHours: number;
  height?: number;
  /** Hide the "This week" label when the surrounding card already has a title. */
  showTitle?: boolean;
}) => {
  const timeZone = useOrgTimezone();
  const days = useMemo(() => weekOf(date), [date]);
  const records = useAttendanceList({ from: days[0], to: days[6], scope: 'me', limit: 7, sortBy: 'date', sortOrder: 'asc' });

  const rows: WeekRow[] = useMemo(() => {
    const byDay = new Map((records.data?.data ?? []).map((r: AttendanceRow) => [r.date.slice(0, 10), r]));
    return days.map((key) => {
      const rec = byDay.get(key);
      const isToday = key === date;
      const future = key > date;
      const status = rec?.status ?? null;
      const minutes = isToday ? todayMinutes : (rec?.workingMinutes ?? 0);
      const late = isToday ? todayLate : rec?.isLate ? (rec.lateMinutes ?? 0) : 0;
      const off = !!status && OFF_STATUSES.has(status);
      return {
        key,
        day: formatKey(key, 'EEE'),
        // Days off get a short grey stub so the week reads continuously.
        hours: off ? goalHours * 0.12 : Math.round((minutes / 60) * 100) / 100,
        isToday,
        future,
        status,
        lateMinutes: late,
        checkIn: rec?.checkIn ?? null,
        checkOut: rec?.checkOut ?? null,
        fill: off ? BAR.off : isToday ? BAR.today : late > 0 ? BAR.late : BAR.onTime,
      };
    });
  }, [records.data, days, date, todayMinutes, todayLate, goalHours]);

  const worked = rows.filter((r) => !r.status || !OFF_STATUSES.has(r.status)).reduce((a, r) => a + r.hours, 0);
  // Even 4-hour ticks (compact chart) up to just above the goal / longest day.
  const top = Math.ceil(Math.max(goalHours + 1, ...rows.map((r) => r.hours)) / 4) * 4;
  const ticks = Array.from({ length: top / 4 + 1 }, (_, i) => i * 4);

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        {showTitle ? <p className="text-xs font-semibold tracking-wide text-muted uppercase">This week</p> : <span />}
        <p className="text-xs text-muted">
          <span className="font-semibold text-fg tabular-nums">{minutesToHours(Math.round(worked * 60))}</span> worked
        </p>
      </div>
      <ChartFrame
        height={height}
        label={`Hours worked each day this week against a ${goalHours} hour goal`}
        loading={records.isLoading}
        error={records.error}
        onRetry={() => records.refetch()}
      >
        <BarChart data={rows} margin={{ top: 14, right: 6, left: 0, bottom: 0 }} barCategoryGap="22%">
          <defs>
            <linearGradient id="week-today" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" />
              <stop offset="100%" stopColor="var(--color-brand-500)" />
            </linearGradient>
            <linearGradient id="week-ontime" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#059669" />
            </linearGradient>
            <linearGradient id="week-late" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#d97706" />
            </linearGradient>
          </defs>
          <CartesianGrid {...chartGrid} />
          <XAxis
            dataKey="day"
            {...chartAxis}
            tick={({ x, y, payload, index }: { x: number; y: number; payload: { value: string }; index: number }) => {
              const row = rows[index];
              return (
                <text
                  x={x}
                  y={y + 12}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={row?.isToday ? 700 : 500}
                  fill={row?.isToday ? 'var(--color-brand-600)' : 'var(--muted)'}
                  opacity={row?.future ? 0.5 : 1}
                >
                  {row?.isToday ? 'Today' : payload.value}
                </text>
              );
            }}
          />
          <YAxis {...chartAxis} domain={[0, top]} ticks={ticks} tickFormatter={(v: number) => `${v}h`} width={30} />
          <ReferenceLine
            y={goalHours}
            stroke="#10b981"
            strokeDasharray="5 4"
            strokeWidth={1.5}
            label={{ value: `Goal ${goalHours}h`, position: 'insideTopRight', fill: '#059669', fontSize: 10, fontWeight: 600 }}
          />
          <Tooltip
            cursor={{ fill: 'var(--surface-3)', opacity: 0.5, radius: 8 } as never}
            content={<WeekTooltip timeZone={timeZone} goalHours={goalHours} />}
          />
          <Bar dataKey="hours" radius={[8, 8, 3, 3]} maxBarSize={30} animationDuration={1100} animationEasing="ease-out">
            {rows.map((r) => (
              <Cell key={r.key} fill={r.fill} className={cn(r.isToday && 'drop-shadow-[0_4px_10px_rgb(99_102_241/0.35)]')} />
            ))}
          </Bar>
        </BarChart>
      </ChartFrame>
      <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[11px] text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          On time
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          Late
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-violet-500" />
          Today
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-surface-3 ring-1 ring-line" />
          Off / leave
        </span>
      </div>
      <ChartDataTable
        caption="Hours worked this week"
        columns={['Day', 'Hours', 'Status']}
        rows={rows.map((r) => [
          formatKey(r.key, 'EEE d MMM'),
          r.status && OFF_STATUSES.has(r.status) ? 0 : r.hours,
          r.future ? 'Upcoming' : r.status ? label(r.status) : '—',
        ])}
      />
    </div>
  );
};
