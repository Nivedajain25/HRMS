import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CalendarHeart, ChevronLeft, ChevronRight, MapPin, Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import { HOLIDAY_TYPES } from '@stencil/shared';
import { FilterBar } from '@/components/common/controls';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, type Tone } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/overlay';
import { label } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { toOptions, useAllOf } from '@/features/employees/api';
import { useDeleteHoliday, useHolidays, useUpcomingHolidays, type HolidayOccurrence } from './api';
import { HolidayFormDrawer } from './components/holiday-form';
import { dateKeyIn, formatKey, HOLIDAY_TYPE_STYLE, monthBounds, useOrgTimezone, WEEKDAYS_SUN_FIRST } from './lib';

const TYPE_TONE: Record<string, Tone> = { PUBLIC: 'brand', COMPANY: 'green', OPTIONAL: 'amber', REGIONAL: 'blue' };

const daysUntil = (key: string, today: string) => Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

const HolidayItem = ({ h, canManage, onEdit, onDelete, today }: { h: HolidayOccurrence; canManage: boolean; onEdit: (h: HolidayOccurrence) => void; onDelete: (h: HolidayOccurrence) => void; today: string }) => {
  const past = h.date < today;
  return (
    <li className={cn('flex items-start gap-3 py-3', past && 'opacity-60')}>
      <div className="flex w-12 shrink-0 flex-col items-center rounded-lg border border-line bg-surface-2 py-1">
        <span className="text-[10px] font-semibold tracking-wide text-muted uppercase">{formatKey(h.date, 'MMM')}</span>
        <span className="text-lg leading-tight font-semibold text-fg tabular-nums">{formatKey(h.date, 'd')}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-fg">{h.name}</span>
          <Badge tone={TYPE_TONE[h.type] ?? 'gray'}>{label(h.type)}</Badge>
          {h.recurring && (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Repeat className="h-3 w-3" aria-hidden />
              Yearly
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {formatKey(h.date, 'EEEE')}
          {h.locationIds.length ? (
            <span className="ml-2 inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" aria-hidden />
              {h.locationIds.map((l) => l.name).join(', ')}
            </span>
          ) : (
            <span className="ml-2">All locations</span>
          )}
        </p>
        {h.description && <p className="mt-1 text-sm text-fg-2">{h.description}</p>}
      </div>
      {canManage && (
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${h.name}`} onClick={() => onEdit(h)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${h.name}`} onClick={() => onDelete(h)}>
            <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
          </Button>
        </div>
      )}
    </li>
  );
};

export const HolidaysPage = () => {
  const timeZone = useOrgTimezone();
  const today = dateKeyIn(timeZone);
  const { can } = usePermissions();
  const canManage = can('holiday:manage');
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const year = Number(params.get('year')) || Number(today.slice(0, 4));
  const type = params.get('type') ?? '';
  const locationId = params.get('location') ?? '';
  const [month, setMonth] = useState(() => (Number(today.slice(0, 4)) === year ? Number(today.slice(5, 7)) : 1));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ holiday?: HolidayOccurrence; date?: string } | null>(null);

  const holidays = useHolidays({ year, type: type || undefined, locationId: locationId || undefined });
  const upcoming = useUpcomingHolidays(5);
  const locations = useAllOf('locations');
  const remove = useDeleteHoliday();

  const setParam = (patch: Record<string, string | undefined>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );
  const changeYear = (y: number) => {
    setParam({ year: y === Number(today.slice(0, 4)) ? undefined : String(y) });
    setMonth(y === Number(today.slice(0, 4)) ? Number(today.slice(5, 7)) : 1);
    setSelectedDay(null);
  };

  const byDate = useMemo(() => {
    const map = new Map<string, HolidayOccurrence[]>();
    for (const h of holidays.data ?? []) map.set(h.date, [...(map.get(h.date) ?? []), h]);
    return map;
  }, [holidays.data]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const h of holidays.data ?? []) c[h.type] = (c[h.type] ?? 0) + 1;
    return c;
  }, [holidays.data]);

  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const bounds = monthBounds(monthKey);
  const cells: (string | null)[] = [...Array.from({ length: bounds.firstWeekday }, () => null), ...Array.from({ length: bounds.days }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, '0')}`)];
  const monthHolidays = (holidays.data ?? []).filter((h) => h.date.startsWith(monthKey));

  const onDelete = async (h: HolidayOccurrence) => {
    const { confirmed } = await confirm({
      title: `Delete ${h.name}?`,
      message: h.recurring ? 'This is a recurring holiday; it will be removed from every year.' : 'The holiday will be removed from the calendar.',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    try {
      const res = await remove.mutateAsync(h._id);
      toast.success(res.message ?? 'Holiday deleted');
    } catch {
      /* toasted globally */
    }
  };

  const selected = selectedDay ? (byDate.get(selectedDay) ?? []) : null;
  const listItems = selectedDay ? (selected ?? []) : (holidays.data ?? []);

  return (
    <>
      <PageHeader
        title="Holidays"
        description="Public, company and regional holidays for your organization."
        breadcrumb={[{ label: 'Attendance', to: '/attendance' }, { label: 'Holidays' }]}
        actions={
          <>
            <div className="flex items-center rounded-lg border border-line-strong bg-surface" role="group" aria-label="Year">
              <Button variant="ghost" size="icon-sm" aria-label="Previous year" disabled={year <= 2000} onClick={() => changeYear(year - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="w-14 text-center text-sm font-semibold text-fg tabular-nums" aria-live="polite">
                {year}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label="Next year" disabled={year >= 2100} onClick={() => changeYear(year + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {canManage && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ date: selectedDay ?? undefined })}>
                Add holiday
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4">
        <FilterBar active={!!type || !!locationId} onClear={() => setParam({ type: undefined, location: undefined })}>
          <Select aria-label="Type" className="w-40" value={type} onChange={(e) => setParam({ type: e.target.value })} options={HOLIDAY_TYPES.map((t) => ({ value: t, label: label(t) }))} placeholder="All types" />
          <Select aria-label="Location" className="w-48" value={locationId} onChange={(e) => setParam({ location: e.target.value })} options={toOptions(locations.data)} placeholder="All locations" />
        </FilterBar>
      </div>

      {holidays.error ? (
        <ErrorState className="card" message={holidays.error.message} onRetry={() => holidays.refetch()} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader
                title={formatKey(`${monthKey}-01`, 'MMMM yyyy')}
                description={`${monthHolidays.length} holiday${monthHolidays.length === 1 ? '' : 's'} this month`}
                actions={
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon-sm" aria-label="Previous month" disabled={month <= 1} onClick={() => setMonth((m) => m - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon-sm" aria-label="Next month" disabled={month >= 12} onClick={() => setMonth((m) => m + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                }
              />
              <CardBody>
                {holidays.isLoading ? (
                  <Skeleton className="h-80" />
                ) : (
                  <>
                    <div className="grid grid-cols-7 gap-1 sm:gap-1.5" role="group" aria-label={`Holidays in ${formatKey(`${monthKey}-01`, 'MMMM yyyy')}`}>
                      {WEEKDAYS_SUN_FIRST.map((d) => (
                        <div key={d} aria-hidden className="pb-1 text-center text-[11px] font-semibold tracking-wide text-muted uppercase">
                          <span className="sm:hidden">{d.slice(0, 1)}</span>
                          <span className="hidden sm:inline">{d}</span>
                        </div>
                      ))}
                      {cells.map((key, i) => {
                        if (!key) return <div key={`e-${i}`} aria-hidden />;
                        const items = byDate.get(key) ?? [];
                        const first = items[0];
                        const style = first ? HOLIDAY_TYPE_STYLE[first.type] : undefined;
                        const weekend = new Date(`${key}T00:00:00Z`).getUTCDay() % 6 === 0;
                        return (
                          <button
                            key={key}
                            type="button"
                            aria-pressed={selectedDay === key}
                            aria-label={`${formatKey(key, 'dd MMMM')}${items.length ? `: ${items.map((h) => h.name).join(', ')}` : ''}`}
                            onClick={() => setSelectedDay((cur) => (cur === key ? null : key))}
                            className={cn(
                              'flex min-h-12 flex-col items-start rounded-lg p-1.5 text-left ring-1 ring-inset sm:min-h-20 sm:p-2',
                              style ? style.cell : weekend ? 'bg-surface-2 text-muted ring-line/60' : 'bg-surface text-fg-2 ring-line',
                              selectedDay === key && 'ring-2 ring-brand-500',
                              key === today && 'outline-2 outline-offset-1 outline-brand-500',
                            )}
                          >
                            <span className="text-xs font-semibold tabular-nums">{Number(key.slice(8))}</span>
                            {first && (
                              <>
                                <span className="mt-0.5 hidden w-full text-[11px] leading-tight font-medium sm:line-clamp-2">{first.name}</span>
                                {items.length > 1 && <span className="hidden text-[10px] sm:block">+{items.length - 1} more</span>}
                                <span className={cn('mt-auto h-1.5 w-1.5 rounded-full sm:hidden', style?.dot)} aria-hidden />
                              </>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
                      {HOLIDAY_TYPES.map((t) => (
                        <span key={t} className="inline-flex items-center gap-1.5">
                          <span className={cn('h-2 w-2 rounded-full', HOLIDAY_TYPE_STYLE[t]?.dot)} aria-hidden />
                          {label(t)}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title={selectedDay ? formatKey(selectedDay, 'EEEE, dd MMM yyyy') : `All holidays in ${year}`}
                description={selectedDay ? undefined : `${holidays.data?.length ?? 0} holidays`}
                actions={
                  selectedDay ? (
                    <Button variant="ghost" size="sm" onClick={() => setSelectedDay(null)}>
                      Show all
                    </Button>
                  ) : undefined
                }
              />
              <CardBody className="py-2">
                {holidays.isLoading ? (
                  <div className="space-y-3 py-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-12" />
                    ))}
                  </div>
                ) : !listItems.length ? (
                  <EmptyState
                    icon={<CalendarHeart className="h-6 w-6" />}
                    title={selectedDay ? 'No holiday on this day' : 'No holidays found'}
                    description={type || locationId ? 'Try changing your filters.' : canManage ? 'Add holidays so attendance and leave skip them.' : undefined}
                    action={
                      canManage ? (
                        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ date: selectedDay ?? undefined })}>
                          Add holiday
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {listItems.map((h) => (
                      <HolidayItem key={`${h._id}-${h.date}`} h={h} today={today} canManage={canManage} onEdit={(x) => setEditing({ holiday: x })} onDelete={(x) => void onDelete(x)} />
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Upcoming holidays" description="For your location" />
              <CardBody className="py-2">
                {upcoming.isLoading ? (
                  <div className="space-y-3 py-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-10" />
                    ))}
                  </div>
                ) : upcoming.error ? (
                  <ErrorState message={upcoming.error.message} onRetry={() => upcoming.refetch()} />
                ) : !upcoming.data?.length ? (
                  <p className="py-6 text-center text-sm text-muted">No upcoming holidays.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {upcoming.data.map((h) => {
                      const days = daysUntil(h.date, today);
                      return (
                        <li key={`${h._id}-${h.date}`} className="flex items-center gap-3 py-3">
                          <span className={cn('h-9 w-1 shrink-0 rounded-full', HOLIDAY_TYPE_STYLE[h.type]?.dot ?? 'bg-subtle')} aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-fg">{h.name}</p>
                            <p className="text-xs text-muted">{formatKey(h.date, 'EEE, dd MMM yyyy')}</p>
                          </div>
                          <Badge tone={days === 0 ? 'green' : days <= 7 ? 'amber' : 'gray'}>{days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days} days`}</Badge>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={`${year} at a glance`} />
              <CardBody className="space-y-2.5">
                {HOLIDAY_TYPES.map((t) => (
                  <div key={t} className="flex items-center justify-between text-sm">
                    <span className="inline-flex items-center gap-2 text-fg-2">
                      <span className={cn('h-2.5 w-2.5 rounded-full', HOLIDAY_TYPE_STYLE[t]?.dot)} aria-hidden />
                      {label(t)}
                    </span>
                    <span className="font-semibold text-fg tabular-nums">{holidays.isLoading ? '…' : (counts[t] ?? 0)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-line pt-2.5 text-sm">
                  <span className="font-medium text-fg">Total</span>
                  <span className="font-semibold text-fg tabular-nums">{holidays.data?.length ?? 0}</span>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      <HolidayFormDrawer open={editing !== null} holiday={editing?.holiday} defaultDate={editing?.date} onClose={() => setEditing(null)} />
    </>
  );
};
