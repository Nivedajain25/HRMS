import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameMonth, parse, startOfMonth, startOfWeek } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, PartyPopper } from 'lucide-react';
import { useAllOf, toOptions } from '@/features/employees/api';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/display';
import { Checkbox, Select } from '@/components/ui/input';
import { Modal } from '@/components/ui/overlay';
import { apiDateKey, cn, formatDate, fullName, toDateKey } from '@/lib/utils';
import { DEFAULT_TYPE_COLOR, typeOf, useLeaveCalendar, type CalendarHoliday, type CalendarLeave, type LeaveTypeRef } from './api';
import { LeaveDetailDrawer } from './components/leave-detail-drawer';
import { formatKey, sessionLabel } from './components/leave-ui';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_CHIPS = 3;

/** Iterates `YYYY-MM-DD` keys between two keys (inclusive) in UTC. */
const keysBetween = (from: string, to: string) => {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
};

const isPending = (l: CalendarLeave) => l.status === 'SUBMITTED' || l.status === 'PENDING_APPROVAL';
const colorOf = (l: CalendarLeave) => (l.restricted ? DEFAULT_TYPE_COLOR : (typeOf(l)?.color ?? DEFAULT_TYPE_COLOR));
const firstName = (l: CalendarLeave) => l.employeeId?.firstName ?? fullName(l.employeeId);

const chipStyle = (l: CalendarLeave): React.CSSProperties => {
  const color = colorOf(l);
  return isPending(l)
    ? { border: `1px dashed ${color}`, borderLeftWidth: 3 }
    : { backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, borderLeft: `3px solid ${color}` };
};

const describe = (l: CalendarLeave) =>
  [fullName(l.employeeId), l.restricted ? 'On leave' : (typeOf(l)?.name ?? 'Leave'), isPending(l) ? 'pending approval' : 'approved', l.halfDay ? sessionLabel(l.halfDaySession) : null]
    .filter(Boolean)
    .join(' · ');

const LeaveChip = ({ l, onOpen }: { l: CalendarLeave; onOpen: (id: string) => void }) => {
  const content = (
    <>
      <Avatar name={fullName(l.employeeId)} src={l.employeeId?.profilePhoto} size="xs" className="h-4 w-4 text-[8px]" />
      <span className="truncate">{firstName(l)}</span>
      {l.halfDay && <span className="shrink-0 text-[10px] text-muted">½</span>}
    </>
  );
  const cls = 'flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs font-medium text-fg';
  return l.restricted ? (
    <div className={cls} style={chipStyle(l)} title={describe(l)}>
      <span className="sr-only">{describe(l)}</span>
      {content}
    </div>
  ) : (
    <button type="button" className={cn(cls, 'hover:brightness-95 focus-visible:outline-2')} style={chipStyle(l)} title={describe(l)} aria-label={describe(l)} onClick={() => onOpen(l._id)}>
      {content}
    </button>
  );
};

const AgendaRow = ({ l, onOpen }: { l: CalendarLeave; onOpen: (id: string) => void }) => {
  const type = typeOf(l);
  const body = (
    <>
      <Avatar name={fullName(l.employeeId)} src={l.employeeId?.profilePhoto} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{fullName(l.employeeId)}</span>
        <span className="block truncate text-xs text-muted">
          {l.restricted ? 'On leave' : (type?.name ?? 'Leave')}
          {l.halfDay ? ` · ${sessionLabel(l.halfDaySession)}` : ''}
          {apiDateKey(l.startDate) !== apiDateKey(l.endDate) ? ` · ${formatDate(l.startDate, 'dd MMM')} – ${formatDate(l.endDate, 'dd MMM')}` : ''}
        </span>
      </span>
      {isPending(l) ? <StatusBadge status="PENDING" /> : null}
    </>
  );
  const cls = 'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left';
  return (
    <li className="border-l-[3px] pl-1" style={{ borderLeftColor: colorOf(l), borderLeftStyle: isPending(l) ? 'dashed' : 'solid' }}>
      {l.restricted ? (
        <div className={cls}>{body}</div>
      ) : (
        <button type="button" className={cn(cls, 'hover:bg-surface-2')} onClick={() => onOpen(l._id)}>
          {body}
        </button>
      )}
    </li>
  );
};

export const LeaveCalendarPage = () => {
  const [params, setParams] = useSearchParams();
  const monthParam = params.get('month');
  const month = useMemo(() => {
    const parsed = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? parse(`${monthParam}-01`, 'yyyy-MM-dd', new Date()) : new Date();
    return startOfMonth(Number.isNaN(parsed.getTime()) ? new Date() : parsed);
  }, [monthParam]);
  const departmentId = params.get('department') ?? '';
  const [showPending, setShowPending] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const departments = useAllOf('departments');

  const gridStart = startOfWeek(month, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const from = toDateKey(gridStart);
  const to = toDateKey(gridEnd);
  const calendar = useLeaveCalendar(from, to, departmentId || undefined);
  const today = toDateKey(new Date());

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) out.push(d);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const { byDay, holidays, types, counts } = useMemo(() => {
    const map = new Map<string, CalendarLeave[]>();
    const typeMap = new Map<string, LeaveTypeRef>();
    let approved = 0;
    let pending = 0;
    for (const l of calendar.data?.leaves ?? []) {
      if (!showPending && isPending(l)) continue;
      if (isPending(l)) pending++;
      else approved++;
      const t = typeOf(l);
      if (t && !l.restricted) typeMap.set(t._id, t);
      for (const key of keysBetween(apiDateKey(l.startDate), apiDateKey(l.endDate))) {
        if (key < from || key > to) continue;
        const list = map.get(key) ?? [];
        list.push(l);
        map.set(key, list);
      }
    }
    for (const list of map.values()) list.sort((a, b) => Number(isPending(a)) - Number(isPending(b)) || fullName(a.employeeId).localeCompare(fullName(b.employeeId)));
    const hol = new Map<string, CalendarHoliday[]>();
    for (const h of calendar.data?.holidays ?? []) hol.set(h.date, [...(hol.get(h.date) ?? []), h]);
    return { byDay: map, holidays: hol, types: [...typeMap.values()].sort((a, b) => a.name.localeCompare(b.name)), counts: { approved, pending } };
  }, [calendar.data, showPending, from, to]);

  const setMonth = (d: Date | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (d && !isSameMonth(d, new Date())) next.set('month', format(d, 'yyyy-MM'));
        else next.delete('month');
        return next;
      },
      { replace: true },
    );
  const setDepartment = (id: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set('department', id);
        else next.delete('department');
        return next;
      },
      { replace: true },
    );

  const monthDays = days.filter((d) => isSameMonth(d, month));
  const agenda = monthDays.map((d) => toDateKey(d)).filter((k) => byDay.has(k) || holidays.has(k));
  const dayList = dayOpen ? (byDay.get(dayOpen) ?? []) : [];

  return (
    <>
      <PageHeader title="Leave calendar" description="Who is away, approved and pending, alongside holidays." breadcrumb={[{ label: 'Leave', to: '/leave' }, { label: 'Calendar' }]} />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h2 className="min-w-36 text-center text-base font-semibold text-fg" aria-live="polite">
              {format(month, 'MMMM yyyy')}
            </h2>
            <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMonth(null)} disabled={isSameMonth(month, new Date())}>
              Today
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select
              aria-label="Department"
              className="w-full min-w-0 sm:w-52"
              value={departmentId}
              onChange={(e) => setDepartment(e.target.value)}
              options={toOptions(departments.data)}
              placeholder="All departments"
            />
            <Checkbox label="Show pending" checked={showPending} onChange={(e) => setShowPending(e.target.checked)} />
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface-2 px-4 py-2.5 text-xs text-fg-2">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-5 rounded-sm border-l-[3px] border-brand-500 bg-brand-500/15" aria-hidden /> Approved{calendar.data ? ` (${counts.approved})` : ''}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-5 rounded-sm border border-dashed border-brand-500" aria-hidden /> Pending{calendar.data ? ` (${counts.pending})` : ''}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-5 rounded-sm bg-violet-200 dark:bg-violet-500/30" aria-hidden /> Holiday
          </span>
          {types.map((t) => (
            <span key={t._id} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color ?? DEFAULT_TYPE_COLOR }} aria-hidden />
              {t.name}
            </span>
          ))}
        </div>

        {calendar.isLoading ? (
          <div className="p-4">
            <Skeleton className="h-[28rem]" />
          </div>
        ) : calendar.error ? (
          <ErrorState message={calendar.error.message} onRetry={() => calendar.refetch()} />
        ) : (
          <>
            {/* Month grid (tablet and up) */}
            <div className={cn('hidden md:block', calendar.isFetching && 'opacity-70 transition-opacity')}>
              <div className="grid grid-cols-7 border-b border-line bg-surface-2" aria-hidden>
                {WEEKDAYS.map((d) => (
                  <div key={d} className="px-2 py-2 text-xs font-semibold tracking-wide text-muted uppercase">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {days.map((d, i) => {
                  const key = toDateKey(d);
                  const inMonth = isSameMonth(d, month);
                  const entries = byDay.get(key) ?? [];
                  const hol = holidays.get(key);
                  const extra = entries.length - MAX_CHIPS;
                  return (
                    <div
                      key={key}
                      className={cn(
                        // Compact cells (they still grow when a day has more chips).
                        'min-h-20 border-line p-1.5',
                        i % 7 !== 6 && 'border-r',
                        i < days.length - 7 && 'border-b',
                        !inMonth && 'bg-surface-2/70',
                        hol && 'bg-violet-50/70 dark:bg-violet-500/10',
                      )}
                    >
                      <span className="sr-only">
                        {format(d, 'EEEE d MMMM')}
                        {hol ? `, ${hol.map((h) => h.name).join(', ')}` : ''}, {entries.length} on leave
                      </span>
                      <div className="mb-1 flex items-center justify-between gap-1" aria-hidden>
                        <span
                          className={cn(
                            'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium',
                            key === today ? 'bg-brand-600 text-white' : inMonth ? 'text-fg' : 'text-subtle',
                          )}
                        >
                          {format(d, 'd')}
                        </span>
                        {entries.length > 0 && <span className="text-[10px] text-muted">{entries.length} away</span>}
                      </div>
                      {hol?.map((h) => (
                        <p key={h.name} className="mb-1 truncate rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-500/20 dark:text-violet-300" title={`${h.name}${h.optional ? ' (optional)' : ''}${h.locations?.length ? ` — ${h.locations.join(', ')}` : ''}`}>
                          {h.name}
                          {h.locations?.length ? <span className="font-normal opacity-80"> · {h.locations.join(', ')}</span> : null}
                        </p>
                      ))}
                      <div className="space-y-1">
                        {entries.slice(0, MAX_CHIPS).map((l) => (
                          <LeaveChip key={l._id} l={l} onOpen={setOpenId} />
                        ))}
                        {extra > 0 && (
                          <button type="button" className="w-full rounded px-1.5 py-0.5 text-left text-xs font-medium text-brand-600 hover:bg-surface-3 dark:text-brand-400" onClick={() => setDayOpen(key)}>
                            +{extra} more
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Agenda (phones) */}
            <div className="md:hidden">
              {agenda.length === 0 ? (
                <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="Nobody is away" description={`No ${showPending ? '' : 'approved '}leave or holidays in ${format(month, 'MMMM')}.`} />
              ) : (
                <ol className="divide-y divide-line">
                  {agenda.map((key) => {
                    const entries = byDay.get(key) ?? [];
                    return (
                      <li key={key} className="px-4 py-3">
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          <h3 className={cn('text-sm font-semibold', key === today ? 'text-brand-600 dark:text-brand-400' : 'text-fg')}>
                            {formatKey(key, 'EEE, dd MMM')}
                            {key === today && <span className="ml-1.5 text-xs font-medium">· Today</span>}
                          </h3>
                          {holidays.get(key)?.map((h) => (
                            <Badge key={h.name} tone="purple">
                              <PartyPopper className="h-3 w-3" aria-hidden />
                              {h.name}
                              {h.locations?.length ? ` · ${h.locations.join(', ')}` : ''}
                            </Badge>
                          ))}
                        </div>
                        {entries.length > 0 && (
                          <ul className="space-y-1">
                            {entries.map((l) => (
                              <AgendaRow key={l._id} l={l} onOpen={setOpenId} />
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </>
        )}
      </Card>

      <Modal open={!!dayOpen} onClose={() => setDayOpen(null)} title={dayOpen ? formatKey(dayOpen, 'EEEE, dd MMMM yyyy') : ''} description={`${dayList.length} away`} size="sm">
        <ul className="space-y-1">
          {dayList.map((l) => (
            <AgendaRow
              key={l._id}
              l={l}
              onOpen={(id) => {
                setDayOpen(null);
                setOpenId(id);
              }}
            />
          ))}
        </ul>
      </Modal>

      <LeaveDetailDrawer id={openId} onClose={() => setOpenId(null)} />
    </>
  );
};
