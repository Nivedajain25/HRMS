import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ImageOff, Pencil, UserRound } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui/display';
import { Drawer } from '@/components/ui/overlay';
import { label } from '@/lib/i18n';
import { cn, fullName, minutesToHours } from '@/lib/utils';
import { useAttendanceList, useAttendanceSummary, useHolidays, type AttendanceRow, type GeoPoint, type PersonRef } from '../api';
import { dateKeyIn, formatKey, formatTimeIn, hoursLabel, monthBounds, shiftMonth, STATUS_DOT, useOrgTimezone } from '../lib';
import { CaptureDetails, PlaceBadge, SelfieThumb } from './attendance-capture';

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

/**
 * One employee's whole month of attendance for HR / admins: totals and a day-by-day register with check-in and
 * check-out selfies, times, places and hours. A day opens to the full verification (big selfies, coordinates, map).
 */
export const EmployeeMonthDrawer = ({
  employee,
  initialDate,
  onClose,
  onEdit,
}: {
  employee: PersonRef | null;
  /** Any `YYYY-MM-DD` in the month to open on (defaults to this month). */
  initialDate?: string;
  onClose: () => void;
  /** Present when the viewer may edit attendance: opens the day's record editor. */
  onEdit?: (record: AttendanceRow) => void;
}) => {
  const timeZone = useOrgTimezone();
  const todayKey = dateKeyIn(timeZone);
  const currentMonth = todayKey.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [expanded, setExpanded] = useState<string | null>(null);
  const employeeId = employee?._id;

  useEffect(() => {
    if (!employeeId) return;
    setMonth((initialDate ?? todayKey).slice(0, 7));
    setExpanded(null);
  }, [employeeId, initialDate, todayKey]);

  const bounds = monthBounds(month);
  const enabled = !!employeeId;
  const summary = useAttendanceSummary({ from: bounds.from, to: bounds.to, employeeId }, enabled);
  const records = useAttendanceList({ from: bounds.from, to: bounds.to, employeeId, limit: 31, sortBy: 'date', sortOrder: 'asc' }, enabled);
  const holidays = useHolidays({ year: Number(month.slice(0, 4)) });

  const byDate = useMemo(() => new Map((records.data?.data ?? []).map((r) => [r.date.slice(0, 10), r])), [records.data]);
  const holidayByDate = useMemo(
    () => new Map((holidays.data ?? []).filter((h) => !h.locationIds.length && h.date.startsWith(month)).map((h) => [h.date, h])),
    [holidays.data, month],
  );
  // Every day of the month, up to today for the current month.
  const days = useMemo(
    () => Array.from({ length: bounds.days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`).filter((k) => k <= todayKey),
    [bounds.days, month, todayKey],
  );
  const s = summary.data?.employees[0];
  const error = summary.error ?? records.error;
  const go = (delta: number) => {
    setMonth((m) => shiftMonth(m, delta));
    setExpanded(null);
  };

  const name = fullName(employee ?? undefined);
  const sub = [employee?.employeeId, employee?.departmentId?.name].filter(Boolean).join(' · ');

  return (
    <Drawer open={!!employee} onClose={onClose} width="max-w-6xl" title={`${name} — monthly attendance`} description={formatKey(`${month}-01`, 'MMMM yyyy')}>
      {employee && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={name} src={employee.profilePhoto} size="md" />
              <div className="min-w-0">
                <p className="truncate font-semibold text-fg">{name}</p>
                {sub && <p className="truncate text-xs text-muted">{sub}</p>}
              </div>
              <Link to={`/employees/${employee._id}`} className="ml-1 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                <UserRound className="h-3.5 w-3.5" aria-hidden />
                Profile
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-lg border border-line-strong bg-surface" role="group" aria-label="Change month">
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
                <Button variant="ghost" size="sm" onClick={() => {
                    setMonth(currentMonth);
                    setExpanded(null);
                  }}>
                  This month
                </Button>
              )}
            </div>
          </div>

          {error ? (
            <ErrorState message={error.message} onRetry={() => void Promise.all([summary.refetch(), records.refetch()])} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                {summary.isLoading ? (
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

              {records.isLoading ? (
                <Skeleton className="h-96" />
              ) : !days.length ? (
                <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="Nothing yet" description="This month hasn't started." />
              ) : (
                <div className="scrollbar-thin -mx-5 overflow-x-auto border-y border-line sm:mx-0 sm:rounded-xl sm:border-x">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      Attendance of {name} for {formatKey(`${month}-01`, 'MMMM yyyy')}
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
                            <span className={cn('block font-semibold text-fg tabular-nums', isToday && 'text-brand-600 dark:text-brand-300')}>{formatKey(key, 'dd MMM')}</span>
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
