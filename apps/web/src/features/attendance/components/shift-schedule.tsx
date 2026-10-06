import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { CalendarRange, ChevronLeft, ChevronRight, Moon } from 'lucide-react';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, EmptyState, ErrorState, PersonCell, Skeleton } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { cn, formatDate, fullName, shiftRange } from '@/lib/utils';
import { toOptions, useAllOf } from '@/features/employees/api';
import { useAllShifts, useShiftAssignments, useShiftSchedule, type ScheduleDay, type ShiftAssignment } from '../api';
import { addDaysToKey, dateKeyIn, formatKey, useOrgTimezone, weekStart } from '../lib';

const ShiftChip = ({ day }: { day: ScheduleDay }) => {
  if (day.dayKind !== 'WORKING') {
    return (
      <div className="flex h-11 flex-col justify-center rounded-md border border-dashed border-line bg-surface-2 px-2 text-[11px] leading-tight text-muted" title={day.holiday ?? 'Week off'}>
        <span className="truncate font-medium">{day.dayKind === 'HOLIDAY' ? 'Holiday' : 'Off'}</span>
        {day.holiday && <span className="truncate">{day.holiday}</span>}
      </div>
    );
  }
  const s = day.shift;
  return (
    <div
      className="flex h-11 flex-col justify-center rounded-md border-l-[3px] px-2 text-[11px] leading-tight text-fg"
      style={{ borderLeftColor: s.color, background: `color-mix(in srgb, ${s.color} 14%, transparent)` }}
      title={`${s.name} ${shiftRange(s.startTime, s.endTime)}`}
    >
      <span className="flex items-center gap-1 truncate font-semibold">
        {s.code}
        {s.nightShift && <Moon className="h-3 w-3 shrink-0" aria-label="Night shift" />}
      </span>
      <span className="truncate text-fg-2 tabular-nums">
        {shiftRange(s.startTime, s.endTime)}
      </span>
    </div>
  );
};

/** Weekly (or two-week) roster: employees × days with their resolved shift. */
export const ShiftScheduleGrid = () => {
  const timeZone = useOrgTimezone();
  const today = dateKeyIn(timeZone);
  const [start, setStart] = useState(() => weekStart(today));
  const [span, setSpan] = useState<7 | 14>(7);
  const [departmentId, setDepartmentId] = useState('');
  const departments = useAllOf('departments');
  const to = addDaysToKey(start, span - 1);
  const schedule = useShiftSchedule({ from: start, to, departmentId: departmentId || undefined });
  const data = schedule.data;

  const legend = useMemo(() => {
    const map = new Map<string, ScheduleDay['shift']>();
    for (const row of data?.employees ?? []) for (const d of row.days) if (d.dayKind === 'WORKING') map.set(d.shift.code, d.shift);
    return [...map.values()];
  }, [data]);

  return (
    <Card>
      <CardHeader
        title="Schedule"
        description={`${formatKey(start, 'dd MMM')} – ${formatKey(to, 'dd MMM yyyy')}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Department" className="w-44" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} options={toOptions(departments.data)} placeholder="All departments" />
            <Select aria-label="Range" className="w-28" value={String(span)} onChange={(e) => setSpan(Number(e.target.value) as 7 | 14)} options={[{ value: '7', label: '1 week' }, { value: '14', label: '2 weeks' }]} />
            <div className="flex items-center rounded-lg border border-line-strong">
              <Button variant="ghost" size="icon-sm" aria-label="Previous period" onClick={() => setStart((s) => addDaysToKey(s, -span))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setStart(weekStart(today))}>
                Today
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Next period" onClick={() => setStart((s) => addDaysToKey(s, span))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        }
      />
      <CardBody className="p-0">
        {schedule.isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : schedule.error ? (
          <ErrorState message={schedule.error.message} onRetry={() => schedule.refetch()} />
        ) : !data?.employees.length ? (
          <EmptyState icon={<CalendarRange className="h-6 w-6" />} title="No employees to schedule" description={departmentId ? 'This department has no active employees.' : undefined} />
        ) : (
          <>
            <div className={cn('scrollbar-thin overflow-x-auto', schedule.isFetching && 'opacity-70')}>
              <table className="w-full border-separate border-spacing-0 text-sm">
                <caption className="sr-only">Shift schedule</caption>
                <thead>
                  <tr>
                    <th scope="col" className="sticky left-0 z-10 min-w-48 border-b border-line bg-surface-2 px-4 py-2 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                      Employee
                    </th>
                    {data.dates.map((d) => (
                      <th key={d} scope="col" className={cn('min-w-24 border-b border-line bg-surface-2 px-1.5 py-2 text-center text-xs font-semibold text-muted', d === today && 'text-brand-600 dark:text-brand-300')}>
                        <span className="block uppercase">{formatKey(d, 'EEE')}</span>
                        <span className="block text-fg tabular-nums">{formatKey(d, 'dd MMM')}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.employees.map((row) => (
                    <tr key={row.employee._id}>
                      <th scope="row" className="sticky left-0 z-10 border-b border-line bg-surface px-4 py-2 text-left font-normal">
                        <PersonCell name={fullName(row.employee)} subtitle={[row.employee.employeeId, row.employee.department?.name].filter(Boolean).join(' · ')} photo={row.employee.profilePhoto} />
                      </th>
                      {row.days.map((d) => (
                        <td key={d.date} className={cn('border-b border-line px-1 py-1.5', d.date === today && 'bg-brand-50/50 dark:bg-brand-500/5')}>
                          <ShiftChip day={d} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {legend.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line px-5 py-3 text-xs text-muted">
                {legend.map((s) => (
                  <span key={s.code} className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
                    <span className="font-medium text-fg-2">{s.code}</span> {s.name} ({shiftRange(s.startTime, s.endTime)})
                  </span>
                ))}
                {data.employees.length >= 500 && <span>Showing the first 500 employees — filter by department to narrow down.</span>}
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
};

/** Paginated history of shift assignments. */
export const ShiftAssignmentHistory = () => {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [shiftId, setShiftId] = useState('');
  const shifts = useAllShifts();
  const list = useShiftAssignments({ page, limit, shiftId: shiftId || undefined });

  const columns = useMemo<ColumnDef<ShiftAssignment, unknown>[]>(
    () => [
      {
        id: 'employee',
        header: 'Employee',
        cell: ({ row }) => (row.original.employeeId ? <PersonCell name={fullName(row.original.employeeId)} subtitle={row.original.employeeId.employeeId} photo={row.original.employeeId.profilePhoto} to={`/employees/${row.original.employeeId._id}`} /> : '—'),
      },
      {
        id: 'shift',
        header: 'Shift',
        cell: ({ row }) =>
          row.original.shiftId ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: row.original.shiftId.color ?? 'var(--subtle)' }} aria-hidden />
              <span className="font-medium text-fg">{row.original.shiftId.name}</span>
              <span className="text-xs text-muted tabular-nums">
                {shiftRange(row.original.shiftId.startTime, row.original.shiftId.endTime)}
              </span>
            </span>
          ) : (
            'Deleted shift'
          ),
      },
      { id: 'from', header: 'From', cell: ({ row }) => formatDate(row.original.effectiveFrom) },
      { id: 'to', header: 'Until', cell: ({ row }) => (row.original.effectiveTo ? formatDate(row.original.effectiveTo) : <span className="text-muted">Ongoing</span>) },
      { id: 'by', header: 'Assigned by', cell: ({ row }) => (row.original.assignedBy ? fullName(row.original.assignedBy) : '—') },
    ],
    [],
  );

  return (
    <DataTable
      caption="Shift assignment history"
      columns={columns}
      data={list.data?.data}
      loading={list.isLoading || list.isFetching}
      error={list.error}
      onRetry={() => list.refetch()}
      pagination={list.data?.pagination}
      onPageChange={setPage}
      onLimitChange={(l) => {
        setLimit(l);
        setPage(1);
      }}
      emptyTitle="No assignments yet"
      emptyDescription={shiftId ? 'No assignments for this shift.' : 'Assign a shift to employees to build the history.'}
      toolbar={
        <Select
          aria-label="Shift"
          className="w-52"
          value={shiftId}
          onChange={(e) => {
            setShiftId(e.target.value);
            setPage(1);
          }}
          options={(shifts.data ?? []).map((s) => ({ value: s._id, label: s.name }))}
          placeholder="All shifts"
        />
      }
    />
  );
};
