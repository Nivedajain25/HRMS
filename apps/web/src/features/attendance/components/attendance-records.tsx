import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { CalendarPlus, Pencil } from 'lucide-react';
import { ATTENDANCE_STATUS } from '@stencil/shared';
import { EmployeePicker, FilterBar } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Badge, PersonCell } from '@/components/ui/display';
import { Input, Select } from '@/components/ui/input';
import { useListParams } from '@/hooks/use-list-params';
import { label } from '@/lib/i18n';
import { fullName, minutesToHours } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { toOptions, useAllOf } from '@/features/employees/api';
import { useAttendanceList, type AttendanceRow, type PersonRef } from '../api';
import { dateKeyIn, formatKey, formatTimeIn, useOrgTimezone } from '../lib';
import { CaptureCell, PlaceCell } from './attendance-capture';
import { AttendanceDrawer, MarkAttendanceModal } from './attendance-forms';
import { EmployeeAttendanceDrawer } from './employee-attendance-drawer';

const FILTER_KEYS = ['departmentId', 'employeeId', 'status', 'scope'];

/**
 * One day's attendance records (the `date` URL param, default today) with filters and admin actions. The super admin
 * / HR pick the day in the page header; others get a day picker here. An employee's whole history opens from their name.
 */
export const AttendanceRecords = ({ dayPicker = false }: { dayPicker?: boolean }) => {
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'checkIn', sortOrder: 'asc' });
  const { can, isManager } = usePermissions();
  const timeZone = useOrgTimezone();
  const departments = useAllOf('departments');
  const canUpdate = can('attendance:update');
  const canCreate = can('attendance:create');
  const [open, setOpen] = useState<AttendanceRow | null>(null);
  const [marking, setMarking] = useState(false);
  const [monthOf, setMonthOf] = useState<{ employee: PersonRef; date: string } | null>(null);

  const today = dateKeyIn(timeZone);
  const day = typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today;
  const apiQuery = useMemo(() => {
    const rest = { ...(query as Record<string, unknown>) };
    for (const k of ['view', 'date', 'from', 'to']) delete rest[k];
    return { ...rest, from: day, to: day };
  }, [query, day]);
  const list = useAttendanceList(apiQuery);

  const columns = useMemo<ColumnDef<AttendanceRow, unknown>[]>(
    () => [
      {
        id: 'employee',
        header: 'Employee',
        enableHiding: false,
        // Clicking the employee opens their whole month (selfies, places, times for every day).
        cell: ({ row }) => {
          const e = row.original.employeeId;
          return (
            <button
              type="button"
              title="See this employee's week, month or full history"
              aria-label={`See ${fullName(e)}'s attendance history`}
              onClick={(ev) => {
                ev.stopPropagation();
                if (e) setMonthOf({ employee: e, date: row.original.date.slice(0, 10) });
              }}
              className="-m-1 rounded-lg p-1 text-left ring-brand-200 hover:bg-brand-50 hover:ring-1 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:ring-brand-500/30 dark:hover:bg-brand-500/10"
            >
              <PersonCell name={fullName(e)} subtitle={[e?.employeeId, e?.departmentId?.name].filter(Boolean).join(' · ')} photo={e?.profilePhoto} />
            </button>
          );
        },
      },
      { id: 'date', header: 'Date', enableSorting: true, cell: ({ row }) => formatKey(row.original.date, 'EEE, dd MMM yyyy') },
      {
        id: 'shift',
        header: 'Shift',
        cell: ({ row }) =>
          row.original.shiftId ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: row.original.shiftId.color ?? 'var(--subtle)' }} aria-hidden />
              {row.original.shiftId.name}
            </span>
          ) : (
            '—'
          ),
      },
      // Order: hours first (worked, break, overtime), then times, locations, selfie, mode and status.
      { id: 'workingMinutes', header: 'Worked', enableSorting: true, cell: ({ row }) => <span className="tabular-nums">{minutesToHours(row.original.workingMinutes)}</span> },
      { id: 'breakMinutes', header: 'Break', cell: ({ row }) => <span className="tabular-nums">{minutesToHours(row.original.breakMinutes)}</span> },
      { id: 'overtime', header: 'Overtime', cell: ({ row }) => (row.original.overtimeMinutes ? <span className="tabular-nums">{minutesToHours(row.original.overtimeMinutes)}</span> : '—') },
      {
        id: 'checkIn',
        header: 'In',
        enableSorting: true,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            {formatTimeIn(row.original.checkIn, timeZone)}
            {row.original.isLate && <Badge tone="amber">+{minutesToHours(row.original.lateMinutes)}</Badge>}
          </span>
        ),
      },
      { id: 'checkOut', header: 'Out', enableSorting: true, cell: ({ row }) => <span className="tabular-nums">{formatTimeIn(row.original.checkOut, timeZone)}</span> },
      { id: 'place', header: 'Check-in location', cell: ({ row }) => (row.original.checkIn ? <PlaceCell point={row.original.checkInLocation} /> : '—') },
      { id: 'placeOut', header: 'Check-out location', cell: ({ row }) => (row.original.checkOut ? <PlaceCell point={row.original.checkOutLocation} /> : '—') },
      { id: 'verification', header: 'Selfie', cell: ({ row }) => <CaptureCell record={row.original} /> },
      { id: 'workMode', header: 'Mode', cell: ({ row }) => label(row.original.workMode) },
      {
        id: 'status',
        header: 'Status',
        enableSorting: true,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <StatusBadge status={row.original.status} />
            {row.original.regularized && <Badge tone="purple">Regularized</Badge>}
          </span>
        ),
      },
      ...(canUpdate
        ? [
            {
              id: 'actions',
              header: '',
              enableHiding: false,
              cell: ({ row }: { row: { original: AttendanceRow } }) => (
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit attendance of ${fullName(row.original.employeeId)} on ${formatKey(row.original.date)}`}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setOpen(row.original);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              ),
            } as ColumnDef<AttendanceRow, unknown>,
          ]
        : []),
    ],
    [timeZone, canUpdate],
  );

  return (
    <>
      <DataTable
        caption="Attendance records"
        storageKey="attendance-records"
        columns={columns}
        data={list.data?.data}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => list.refetch()}
        pagination={list.data?.pagination}
        onPageChange={(page) => set({ page })}
        onLimitChange={(limit) => set({ limit })}
        sorting={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
        onSortingChange={(s) => set({ sortBy: s.sortBy, sortOrder: s.sortOrder })}
        onRowClick={(row) => setOpen(row)}
        emptyTitle="No attendance records"
        emptyDescription={hasFilters(FILTER_KEYS) ? 'Try changing your filters.' : `No one has checked in on ${formatKey(day, 'EEE, dd MMM yyyy')}${day === today ? ' yet' : ''}.`}
        emptyAction={
          canCreate ? (
            <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setMarking(true)}>
              Mark attendance
            </Button>
          ) : undefined
        }
        toolbar={
          <FilterBar active={hasFilters(FILTER_KEYS)} onClear={() => clear(['view', 'date', 'sortBy', 'sortOrder'])}>
            {dayPicker ? (
              <Input type="date" aria-label="Day" className="w-44" max={today} value={day} onChange={(e) => set({ date: e.target.value && e.target.value !== today ? e.target.value : undefined })} />
            ) : (
              <span className="inline-flex h-9 items-center rounded-lg bg-surface-2 px-3 text-sm font-medium text-fg ring-1 ring-line">
                {day === today ? 'Today' : formatKey(day, 'EEE, dd MMM yyyy')}
              </span>
            )}
            <Select aria-label="Department" className="w-44" value={String(params.departmentId ?? '')} onChange={(e) => set({ departmentId: e.target.value })} options={toOptions(departments.data)} placeholder="All departments" />
            <div className="w-full sm:w-56">
              <EmployeePicker value={(params.employeeId as string | undefined) ?? null} onChange={(v) => set({ employeeId: (v as string | null) ?? undefined })} placeholder="All employees" />
            </div>
            <Select aria-label="Status" className="w-40" value={String(params.status ?? '')} onChange={(e) => set({ status: e.target.value })} options={ATTENDANCE_STATUS.map((s) => ({ value: s, label: label(s) }))} placeholder="All statuses" />
            {can('attendance:read') && isManager && (
              <Select aria-label="Scope" className="w-36" value={String(params.scope ?? '')} onChange={(e) => set({ scope: e.target.value })} options={[{ value: 'team', label: 'My team' }]} placeholder="Everyone" />
            )}
            {canCreate && (
              <Button variant="outline" size="md" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setMarking(true)}>
                Mark attendance
              </Button>
            )}
          </FilterBar>
        }
      />
      <AttendanceDrawer record={open} onClose={() => setOpen(null)} canEdit={canUpdate} />
      <MarkAttendanceModal open={marking} onClose={() => setMarking(false)} />
      <EmployeeAttendanceDrawer
        employee={monthOf?.employee ?? null}
        initialDate={monthOf?.date}
        onClose={() => setMonthOf(null)}
        onEdit={
          canUpdate
            ? (record) => {
                // One panel at a time: the day's editor replaces the month view.
                setMonthOf(null);
                setOpen(record);
              }
            : undefined
        }
      />
    </>
  );
};
