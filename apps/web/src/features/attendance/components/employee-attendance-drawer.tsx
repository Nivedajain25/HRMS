import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ImageOff, Pencil, UserRound } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui/display';
import { Drawer } from '@/components/ui/overlay';
import { label } from '@/lib/i18n';
import { cn, fullName, minutesToHours } from '@/lib/utils';
import { useEmployee } from '@/features/employees/api';
import { useAttendanceList, useAttendanceSummary, useHolidays, type AttendanceRow, type GeoPoint, type PersonRef } from '../api';
import { addDaysToKey, dateKeyIn, formatKey, formatTimeIn, hoursLabel, monthBounds, shiftMonth, STATUS_DOT, useOrgTimezone, weekStart } from '../lib';
import { CaptureDetails, PlaceBadge, SelfieThumb } from './attendance-capture';

type Period = 'week' | 'month' | 'all';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'Since joining' },
];
/** Days per page in "Since joining" (one list request; keeps selfie loading light). */
const PAGE_DAYS = 31;

const Stat = ({ text, value, dot }: { text: string; value: string | number; dot?: string }) => (
  <div className="rounded-xl border border-line bg-surface px-3 py-2">
    <p className="flex items-center gap-1.5 truncate text-[11px] font-medium tracking-wide text-muted uppercase">
      {dot && <span className={cn('h-2 w-2 rounded-full', dot)} aria-hidden />}
      {text}
    </p>
    <p className="mt-0.5 text-lg font-semibold text-fg tabular-nums">{value}</p>
  </div>
);

/** One clock action in the register: selfie, time, office badge and address. */
const Punch = ({ title, time, photoId, point, timeZone, extra }: { title: string; time: string | null; photoId?: string | null; point?: GeoPoint | null; timeZone: string; extra?: ReactNode }) => {
  if (!time) return <span className="text-muted">—</span>;
  return (
    <span className="flex min-w-[13rem] items-start gap-2.5">
      {photoId ? (
        <SelfieThumb fileId={photoId} label={`${title} selfie`} size="md" />
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-muted" title="No selfie">
          <ImageOff className="h-4 w-4" aria-hidden />
        </span>
      )}
      <span className="flex min-w-0 flex-col items-start gap-1">
        <span className="flex items-center gap-1.5">
          <span className="font-semibold text-fg tabular-nums">{formatTimeIn(time, timeZone)}</span>
          {extra}
        </span>
        <PlaceBadge point={point} />
        {point?.address && (
          <span className="max-w-[12rem] truncate text-xs text-muted" title={point.address}>
            {point.address}
          </span>
        )}
      </span>
    </span>
  );
};

/** Every `YYYY-MM-DD` from `from` to `to`, inclusive. */
const daysBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let k = from; k <= to; k = addDaysToKey(k, 1)) out.push(k);
  return out;
};

/**
 * One employee's attendance history for HR / admins — a week, a month or everything since they joined: totals and a
 * day-by-day register with check-in and check-out selfies, times, places and hours. A day opens to the full
 * verification (big selfies, coordinates, map).
 */
export const EmployeeAttendanceDrawer = ({
  employee,
  initialDate,
  onClose,
  onEdit,
}: {
  employee: PersonRef | null;
  /** The day to open on (defaults to today); the week / month around it is shown. */
  initialDate?: string;
  onClose: () => void;
  /** Present when the viewer may edit attendance: opens the day's record editor. */
  onEdit?: (record: AttendanceRow) => void;
}) => {
  const timeZone = useOrgTimezone();
  const todayKey = dateKeyIn(timeZone);
  const [period, setPeriod] = useState<Period>('month');
  const [anchor, setAnchor] = useState(todayKey);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const employeeId = employee?._id;

  useEffect(() => {
    if (!employeeId) return;
    setPeriod('month');
    setAnchor(initialDate ?? todayKey);
    setPage(0);
    setExpanded(null);
  }, [employeeId, initialDate, todayKey]);

  const detail = useEmployee(employeeId);
  // Without a joining date (still loading or not visible), "Since joining" falls back to the last year.
  const joined = detail.data?.joiningDate?.slice(0, 10);
  const waitingForJoin = period === 'all' && detail.isLoading;

  // The period's window, clipped to [joining date, today].
  const win = useMemo(() => {
    let from: string;
    let to: string;
    if (period === 'week') {
      from = weekStart(anchor);
      to = addDaysToKey(from, 6);
    } else if (period === 'month') {
      const b = monthBounds(anchor.slice(0, 7));
      from = b.from;
      to = b.to;
    } else {
      from = joined ?? addDaysToKey(todayKey, -365);
      to = todayKey;
    }
    return { from, to, start: joined && joined > from ? joined : from, end: to < todayKey ? to : todayKey };
  }, [period, anchor, joined, todayKey]);

  const allDays = useMemo(() => (win.start <= win.end ? daysBetween(win.start, win.end) : []), [win.start, win.end]);
  // Week / month read top to bottom like a register; "Since joining" pages backwards from today.
  const pages = period === 'all' ? Math.max(1, Math.ceil(allDays.length / PAGE_DAYS)) : 1;
  const days = useMemo(
    () => (period === 'all' ? [...allDays].reverse().slice(page * PAGE_DAYS, (page + 1) * PAGE_DAYS) : allDays),
    [allDays, period, page],
  );
  const span = days.length ? { from: days.reduce((a, b) => (a < b ? a : b)), to: days.reduce((a, b) => (a > b ? a : b)) } : null;

  const enabled = !!employeeId && !waitingForJoin && allDays.length > 0;
  const summary = useAttendanceSummary({ from: win.start, to: win.end, employeeId }, enabled);
  const records = useAttendanceList({ from: span?.from, to: span?.to, employeeId, limit: PAGE_DAYS, sortBy: 'date', sortOrder: 'asc' }, enabled && !!span);
  const years = useMemo(() => [...new Set(days.map((k) => Number(k.slice(0, 4))))], [days]);
  const holidaysA = useHolidays({ year: years[0] ?? Number(todayKey.slice(0, 4)) });
  const holidaysB = useHolidays({ year: years[years.length - 1] ?? Number(todayKey.slice(0, 4)) });

  const byDate = useMemo(() => new Map((records.data?.data ?? []).map((r) => [r.date.slice(0, 10), r])), [records.data]);
  const holidayByDate = useMemo(
    () => new Map([...(holidaysA.data ?? []), ...(holidaysB.data ?? [])].filter((h) => !h.locationIds.length).map((h) => [h.date, h])),
    [holidaysA.data, holidaysB.data],
  );
  const s = summary.data?.employees[0];
  const error = summary.error ?? records.error;

  const choose = (p: Period) => {
    setPeriod(p);
    setPage(0);
    setExpanded(null);
  };
  const step = (delta: number) => {
    setExpanded(null);
    if (period === 'all') setPage((p) => Math.min(pages - 1, Math.max(0, p + delta)));
    else if (period === 'week') setAnchor((a) => addDaysToKey(weekStart(a), delta * 7));
    else setAnchor((a) => `${shiftMonth(a.slice(0, 7), delta)}-01`);
  };
  // "Back" is older; "Forward" is newer (for "Since joining", page 0 is the newest).
  const canBack = period === 'all' ? page < pages - 1 : !joined || win.from > joined;
  const canForward = period === 'all' ? page > 0 : win.to < todayKey;

  const rangeLabel =
    period === 'week'
      ? `${formatKey(win.from, 'dd MMM')} – ${formatKey(win.to, 'dd MMM yyyy')}`
      : period === 'month'
        ? formatKey(win.from, 'MMMM yyyy')
        : `Since ${formatKey(win.start, 'dd MMM yyyy')}${joined ? '' : ' (last year)'}`;
  const pagerLabel = span ? `${formatKey(span.to, 'dd MMM yyyy')} – ${formatKey(span.from, 'dd MMM yyyy')}` : '';

  const name = fullName(employee ?? undefined);
  const sub = [employee?.employeeId, employee?.departmentId?.name].filter(Boolean).join(' · ');

  return (
    <Drawer open={!!employee} onClose={onClose} width="max-w-6xl" title={`${name} — attendance`} description={rangeLabel}>
      {employee && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={name} src={employee.profilePhoto} size="md" />
              <div className="min-w-0">
                <p className="truncate font-semibold text-fg">{name}</p>
                <p className="truncate text-xs text-muted">
                  {[sub, joined ? `Joined ${formatKey(joined, 'dd MMM yyyy')}` : null].filter(Boolean).join(' · ')}
                </p>
              </div>
              <Link to={`/employees/${employee._id}`} className="ml-1 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                <UserRound className="h-3.5 w-3.5" aria-hidden />
                Profile
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-line-strong bg-surface p-0.5" role="group" aria-label="Period">
                {PERIODS.map((p) => (
                  <Button key={p.key} variant={period === p.key ? 'secondary' : 'ghost'} size="sm" className="h-7" aria-pressed={period === p.key} onClick={() => choose(p.key)}>
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="flex items-center rounded-lg border border-line-strong bg-surface" role="group" aria-label="Change period">
                <Button variant="ghost" size="icon-sm" aria-label={period === 'all' ? 'Older days' : `Previous ${period}`} disabled={!canBack} onClick={() => step(period === 'all' ? 1 : -1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-28 px-1 text-center text-sm font-medium whitespace-nowrap text-fg tabular-nums" aria-live="polite">
                  {period === 'all' ? `Page ${page + 1} of ${pages}` : period === 'week' ? `${formatKey(win.from, 'dd MMM')} – ${formatKey(win.to, 'dd MMM')}` : formatKey(win.from, 'MMM yyyy')}
                </span>
                <Button variant="ghost" size="icon-sm" aria-label={period === 'all' ? 'Newer days' : `Next ${period}`} disabled={!canForward} onClick={() => step(period === 'all' ? -1 : 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {error ? (
            <ErrorState message={error.message} onRetry={() => void Promise.all([summary.refetch(), records.refetch()])} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                {summary.isLoading || waitingForJoin ? (
                  Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[58px]" />)
                ) : (
                  <>
                    <Stat text="Present" value={s?.present ?? 0} dot={STATUS_DOT.PRESENT} />
                    <Stat text="Late" value={s?.late ?? 0} dot={STATUS_DOT.LATE} />
                    <Stat text="Half day" value={s?.halfDay ?? 0} dot={STATUS_DOT.HALF_DAY} />
                    <Stat text="Absent" value={s?.absent ?? 0} dot={STATUS_DOT.ABSENT} />
                    <Stat text="Leave" value={s?.leave ?? 0} dot={STATUS_DOT.LEAVE} />
                    <Stat text="WFH" value={s?.workFromHome ?? 0} dot={STATUS_DOT.WORK_FROM_HOME} />
                    <Stat text="Total hours" value={hoursLabel(s?.totalWorkingHours)} />
                    <Stat text="Avg / day" value={hoursLabel(s?.averageHours)} />
                  </>
                )}
              </div>

              {period === 'all' && span && (
                <p className="text-xs text-muted">
                  Totals cover everything since joining. Showing {pagerLabel} ({allDays.length} days in all, newest first).
                </p>
              )}

              {records.isLoading || waitingForJoin ? (
                <Skeleton className="h-96" />
              ) : !days.length ? (
                <EmptyState
                  icon={<CalendarDays className="h-6 w-6" />}
                  title={joined && win.to < joined ? 'Not joined yet' : 'Nothing yet'}
                  description={joined && win.to < joined ? `${name} joined on ${formatKey(joined, 'dd MMM yyyy')}.` : "This period hasn't started."}
                />
              ) : (
                <div className="scrollbar-thin -mx-5 overflow-x-auto border-y border-line sm:mx-0 sm:rounded-xl sm:border-x">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      Attendance of {name}, {rangeLabel}
                    </caption>
                    <thead className="bg-surface-2">
                      <tr>
                        {['Date', 'Status', 'Check in', 'Check out', 'Worked', 'Break', 'Overtime', 'Mode', ''].map((h, i) => (
                          <th key={i} scope="col" className="border-b border-line px-3 py-2 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-muted uppercase">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {days.map((key) => {
                        const r = byDate.get(key);
                        const hol = holidayByDate.get(key);
                        const open = expanded === key;
                        const isToday = key === todayKey;
                        const dateCell = (
                          <td className="px-3 py-2.5 align-top whitespace-nowrap">
                            <span className={cn('block font-semibold text-fg tabular-nums', isToday && 'text-brand-600 dark:text-brand-300')}>
                              {formatKey(key, period === 'all' ? 'dd MMM yy' : 'dd MMM')}
                            </span>
                            <span className="block text-xs text-muted">{isToday ? 'Today' : formatKey(key, 'EEEE')}</span>
                          </td>
                        );
                        if (!r) {
                          return (
                            <tr key={key} className="bg-surface-2/40 text-muted">
                              {dateCell}
                              <td className="px-3 py-2.5 align-top" colSpan={8}>
                                {hol ? <Badge tone="purple">{hol.name}</Badge> : <span className="text-xs">No attendance recorded</span>}
                              </td>
                            </tr>
                          );
                        }
                        return (
                          <Fragment key={key}>
                            <tr
                              className={cn('cursor-pointer text-fg-2 hover:bg-surface-2', open && 'bg-surface-2')}
                              onClick={() => setExpanded(open ? null : key)}
                              aria-expanded={r.checkIn ? open : undefined}
                            >
                              {dateCell}
                              <td className="px-3 py-2.5 align-top">
                                <span className="flex flex-col items-start gap-1">
                                  <StatusBadge status={r.status} />
                                  {r.regularized && <Badge tone="purple">Regularized</Badge>}
                                  {hol && <Badge tone="purple">{hol.name}</Badge>}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 align-top">
                                <Punch
                                  title="Check-in"
                                  time={r.checkIn}
                                  photoId={r.checkInPhotoId}
                                  point={r.checkInLocation}
                                  timeZone={timeZone}
                                  extra={r.isLate ? <Badge tone="amber">Late {minutesToHours(r.lateMinutes)}</Badge> : r.checkIn ? <Badge tone="green">On time</Badge> : null}
                                />
                              </td>
                              <td className="px-3 py-2.5 align-top">
                                {r.checkIn && !r.checkOut ? (
                                  <span className="text-xs text-muted">{isToday ? 'Still working' : 'No check-out'}</span>
                                ) : (
                                  <Punch
                                    title="Check-out"
                                    time={r.checkOut}
                                    photoId={r.checkOutPhotoId}
                                    point={r.checkOutLocation}
                                    timeZone={timeZone}
                                    extra={r.isEarlyDeparture ? <Badge tone="amber">Early {minutesToHours(r.earlyDepartureMinutes)}</Badge> : null}
                                  />
                                )}
                              </td>
                              <td className="px-3 py-2.5 align-top font-medium whitespace-nowrap text-fg tabular-nums">{minutesToHours(r.workingMinutes)}</td>
                              <td className="px-3 py-2.5 align-top whitespace-nowrap tabular-nums">{minutesToHours(r.breakMinutes)}</td>
                              <td className="px-3 py-2.5 align-top whitespace-nowrap tabular-nums">{r.overtimeMinutes ? minutesToHours(r.overtimeMinutes) : '—'}</td>
                              <td className="px-3 py-2.5 align-top whitespace-nowrap">{label(r.workMode)}</td>
                              <td className="px-2 py-2.5 align-top">
                                <span className="flex items-center justify-end gap-0.5">
                                  {onEdit && (
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label={`Edit attendance on ${formatKey(key)}`}
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        onEdit(r);
                                      }}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                  )}
                                  {r.checkIn && <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', open && 'rotate-180')} aria-hidden />}
                                </span>
                              </td>
                            </tr>
                            {open && r.checkIn && (
                              <tr className="bg-surface-2">
                                <td colSpan={9} className="px-3 pt-1 pb-4">
                                  <CaptureDetails record={r} timeZone={timeZone} />
                                  {r.note && <p className="mt-3 text-xs whitespace-pre-line text-fg-2">Note: {r.note}</p>}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-muted">Times are in {timeZone}. Click a day for the full-size selfies, exact coordinates and map. Click a selfie to open it.</p>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
};
