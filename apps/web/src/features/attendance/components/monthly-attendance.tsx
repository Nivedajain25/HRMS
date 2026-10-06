import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, FilePenLine, List } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/display';
import { label } from '@/lib/i18n';
import { cn, minutesToHours, shiftRange } from '@/lib/utils';
import { useAttendanceList, useAttendanceSummary, useHolidays, type AttendanceRow, type HolidayOccurrence } from '../api';
import { CaptureDetails } from './attendance-capture';
import { dateKeyIn, formatKey, formatTimeIn, hoursLabel, monthBounds, shiftMonth, STATUS_CELL, STATUS_DOT, useOrgTimezone, WEEKDAYS_SUN_FIRST } from '../lib';

const Tile = ({ label: text, value, dot }: { label: string; value: string | number; dot?: string }) => (
  <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
    <p className="flex items-center gap-1.5 truncate text-[11px] font-medium tracking-wide text-muted uppercase">
      {dot && <span className={cn('h-2 w-2 rounded-full', dot)} aria-hidden />}
      {text}
    </p>
    <p className="mt-1 text-xl font-semibold text-fg tabular-nums">{value}</p>
  </div>
);

const DayDetail = ({ dateKey, record, holiday, timeZone, allowCorrections }: { dateKey: string; record?: AttendanceRow; holiday?: HolidayOccurrence; timeZone: string; allowCorrections?: boolean }) => (
  <div className="rounded-xl border border-line bg-surface-2 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-fg">{formatKey(dateKey, 'EEEE, dd MMM yyyy')}</h4>
        {record && <StatusBadge status={record.status} />}
        {record?.isLate && <Badge tone="amber">Late {minutesToHours(record.lateMinutes)}</Badge>}
        {record?.regularized && <Badge tone="purple">Regularized</Badge>}
        {holiday && <Badge tone="purple">{holiday.name}</Badge>}
      </div>
      {allowCorrections && (
        <Link
          to={`/regularization?date=${dateKey}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium text-fg shadow-sm hover:bg-surface-2"
        >
          <FilePenLine className="h-4 w-4" aria-hidden />
          Request correction
        </Link>
      )}
    </div>
    {record ? (
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[
          ['Clock in', formatTimeIn(record.checkIn, timeZone)],
          ['Clock out', formatTimeIn(record.checkOut, timeZone)],
          ['Worked', minutesToHours(record.workingMinutes)],
          ['Break', minutesToHours(record.breakMinutes)],
          ['Overtime', minutesToHours(record.overtimeMinutes)],
          ['Mode', label(record.workMode)],
          ['Shift', record.shiftId ? `${record.shiftId.name} (${shiftRange(record.shiftId.startTime, record.shiftId.endTime)})` : '—'],
          ['Early exit', record.isEarlyDeparture ? minutesToHours(record.earlyDepartureMinutes) : '—'],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="mt-0.5 font-medium text-fg tabular-nums">{v}</dd>
          </div>
        ))}
        {record.note && (
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-xs text-muted">Note</dt>
            <dd className="mt-0.5 whitespace-pre-line text-fg-2">{record.note}</dd>
          </div>
        )}
      </dl>
    ) : null}
    {record?.checkIn && <CaptureDetails record={record} timeZone={timeZone} className="mt-4" />}
    {!record && (
      <p className="mt-2 text-sm text-muted">{holiday ? holiday.description || 'Organization holiday.' : 'No attendance recorded for this day.'}</p>
    )}
  </div>
);

/**
 * Monthly attendance: summary tiles, calendar/list of records and month
 * navigation. Without `employeeId` it shows the signed-in user's data.
 */
export const MonthlyAttendance = ({ employeeId, allowCorrections, title = 'My attendance' }: { employeeId?: string; allowCorrections?: boolean; title?: string }) => {
  const timeZone = useOrgTimezone();
  const todayKey = dateKeyIn(timeZone);
  const currentMonth = todayKey.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [selected, setSelected] = useState<string | null>(null);
  const bounds = monthBounds(month);
  const who = employeeId ? { employeeId } : { scope: 'me' };

  const summary = useAttendanceSummary({ from: bounds.from, to: bounds.to, ...who });
  const records = useAttendanceList({ from: bounds.from, to: bounds.to, ...who, limit: 31, sortBy: 'date', sortOrder: 'asc' });
  const holidays = useHolidays({ year: Number(month.slice(0, 4)) });

  const byDate = useMemo(() => new Map((records.data?.data ?? []).map((r) => [r.date.slice(0, 10), r])), [records.data]);
  const holidayByDate = useMemo(
    () => new Map((holidays.data ?? []).filter((h) => !h.locationIds.length && h.date.startsWith(month)).map((h) => [h.date, h])),
    [holidays.data, month],
  );
  const s = summary.data?.employees[0];

  const go = (delta: number) => {
    setMonth((m) => shiftMonth(m, delta));
    setSelected(null);
  };

  const cells: (string | null)[] = [...Array.from({ length: bounds.firstWeekday }, () => null), ...Array.from({ length: bounds.days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const error = summary.error ?? records.error;

  return (
    <Card>
      <CardHeader
        title={title}
        description={formatKey(`${month}-01`, 'MMMM yyyy')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-line-strong" role="group" aria-label="Change month">
              <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => go(-1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-24 text-center text-sm font-medium text-fg tabular-nums" aria-live="polite">
                {formatKey(`${month}-01`, 'MMM yyyy')}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label="Next month" disabled={month >= currentMonth} onClick={() => go(1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {month !== currentMonth && (
              <Button variant="ghost" size="sm" onClick={() => setMonth(currentMonth)}>
                This month
              </Button>
            )}
            <div className="flex rounded-lg border border-line-strong p-0.5" role="group" aria-label="View">
              <Button variant={view === 'calendar' ? 'secondary' : 'ghost'} size="icon-sm" className="h-7 w-7" aria-label="Calendar view" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}>
                <CalendarDays className="h-4 w-4" />
              </Button>
              <Button variant={view === 'list' ? 'secondary' : 'ghost'} size="icon-sm" className="h-7 w-7" aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}>
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        }
      />
      <CardBody className="space-y-5">
        {error ? (
          <ErrorState message={error.message} onRetry={() => void Promise.all([summary.refetch(), records.refetch()])} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
              {summary.isLoading ? (
                Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-[66px]" />)
              ) : (
                <>
                  <Tile label="Present" value={s?.present ?? 0} dot={STATUS_DOT.PRESENT} />
                  <Tile label="Absent" value={s?.absent ?? 0} dot={STATUS_DOT.ABSENT} />
                  <Tile label="Late" value={s?.late ?? 0} dot={STATUS_DOT.LATE} />
                  <Tile label="Half day" value={s?.halfDay ?? 0} dot={STATUS_DOT.HALF_DAY} />
                  <Tile label="Leave" value={s?.leave ?? 0} dot={STATUS_DOT.LEAVE} />
                  <Tile label="Holiday" value={s?.holiday ?? 0} dot={STATUS_DOT.HOLIDAY} />
                  <Tile label="WFH" value={s?.workFromHome ?? 0} dot={STATUS_DOT.WORK_FROM_HOME} />
                  <Tile label="Total hours" value={hoursLabel(s?.totalWorkingHours)} />
                  <Tile label="Overtime" value={hoursLabel(s?.overtimeHours)} />
                  <Tile label="Avg / day" value={hoursLabel(s?.averageHours)} />
                </>
              )}
            </div>

            {records.isLoading ? (
              <Skeleton className="h-72" />
            ) : view === 'calendar' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-7 gap-1 sm:gap-1.5" role="group" aria-label={`Attendance for ${formatKey(`${month}-01`, 'MMMM yyyy')}`}>
                  {WEEKDAYS_SUN_FIRST.map((d) => (
                    <div key={d} aria-hidden className="pb-1 text-center text-[11px] font-semibold tracking-wide text-muted uppercase">
                      <span className="sm:hidden">{d.slice(0, 1)}</span>
                      <span className="hidden sm:inline">{d}</span>
                    </div>
                  ))}
                  {cells.map((key, i) => {
                    if (!key) return <div key={`empty-${i}`} aria-hidden />;
                    const rec = byDate.get(key);
                    const hol = holidayByDate.get(key);
                    const status = rec?.status ?? (hol ? 'HOLIDAY' : undefined);
                    const future = key > todayKey;
                    const isToday = key === todayKey;
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={selected === key}
                        aria-label={`${formatKey(key, 'dd MMMM')}: ${status ? label(status) : future ? 'Upcoming' : 'No record'}${rec?.workingMinutes ? `, ${minutesToHours(rec.workingMinutes)} worked` : ''}`}
                        onClick={() => setSelected((cur) => (cur === key ? null : key))}
                        className={cn(
                          'flex min-h-12 flex-col items-start justify-between rounded-lg p-1.5 text-left ring-1 ring-inset transition-shadow sm:min-h-[72px] sm:p-2',
                          status ? STATUS_CELL[status] : future ? 'bg-surface text-subtle ring-line/60' : 'bg-surface text-fg-2 ring-line',
                          selected === key && 'ring-2 ring-brand-500',
                          isToday && 'outline-2 outline-offset-1 outline-brand-500',
                        )}
                      >
                        <span className={cn('text-xs font-semibold tabular-nums', isToday && 'text-brand-600 dark:text-brand-300')}>{Number(key.slice(8))}</span>
                        <span className="hidden w-full truncate text-[11px] leading-tight sm:block">
                          {rec ? (rec.workingMinutes ? minutesToHours(rec.workingMinutes) : label(rec.status)) : hol ? hol.name : ''}
                        </span>
                        {status && <span className={cn('h-1.5 w-1.5 rounded-full sm:hidden', STATUS_DOT[status])} aria-hidden />}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted" aria-label="Legend">
                  {Object.entries(STATUS_DOT).map(([k, dot]) => (
                    <span key={k} className="inline-flex items-center gap-1.5">
                      <span className={cn('h-2 w-2 rounded-full', dot)} aria-hidden />
                      {label(k)}
                    </span>
                  ))}
                </div>
                {selected && <DayDetail dateKey={selected} record={byDate.get(selected)} holiday={holidayByDate.get(selected)} timeZone={timeZone} allowCorrections={allowCorrections && selected <= todayKey} />}
              </div>
            ) : !records.data?.data.length ? (
              <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No attendance this month" description="Records appear here once attendance is captured." />
            ) : (
              <div className="scrollbar-thin -mx-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Attendance records</caption>
                  <thead className="bg-surface-2">
                    <tr>
                      {['Date', 'Status', 'In', 'Out', 'Worked', 'Break', 'Overtime', 'Mode'].map((h) => (
                        <th key={h} scope="col" className="border-b border-line px-4 py-2 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-muted uppercase">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {records.data.data.map((r) => (
                      <tr key={r._id} className="text-fg-2">
                        <td className="px-4 py-2.5 whitespace-nowrap text-fg">{formatKey(r.date, 'EEE, dd MMM')}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="flex items-center gap-1.5">
                            <StatusBadge status={r.status} />
                            {r.isLate && r.status !== 'LATE' && <Badge tone="amber">Late</Badge>}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums">{formatTimeIn(r.checkIn, timeZone)}</td>
                        <td className="px-4 py-2.5 tabular-nums">{formatTimeIn(r.checkOut, timeZone)}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{minutesToHours(r.workingMinutes)}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{minutesToHours(r.breakMinutes)}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{r.overtimeMinutes ? minutesToHours(r.overtimeMinutes) : '—'}</td>
                        <td className="px-4 py-2.5">{label(r.workMode)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
};
