import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { CalendarPlus, Pencil } from 'lucide-react';
import { ATTENDANCE_STATUS } from '@stencil/shared';
import { EmployeePicker, FilterBar } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Badge, PersonCell } from '@/components/ui/display';
import { DateRangePicker, Select } from '@/components/ui/input';
import { useListParams } from '@/hooks/use-list-params';
import { label } from '@/lib/i18n';
import { fullName, minutesToHours } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { toOptions, useAllOf } from '@/features/employees/api';
import { useAttendanceList, type AttendanceRow } from '../api';
import { formatKey, formatTimeIn, useOrgTimezone } from '../lib';
import { CaptureCell, PlaceCell } from './attendance-capture';
import { AttendanceDrawer, MarkAttendanceModal } from './attendance-forms';

const FILTER_KEYS = ['from', 'to', 'departmentId', 'employeeId', 'status', 'scope'];

/** Server-paginated attendance records with filters and admin actions. */
export const AttendanceRecords = () => {
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'date', sortOrder: 'desc' });
  const { can, isManager } = usePermissions();
  const timeZone = useOrgTimezone();
  const departments = useAllOf('departments');
  const canUpdate = can('attendance:update');
  const canCreate = can('attendance:create');
  const [open, setOpen] = useState<AttendanceRow | null>(null);
  const [marking, setMarking] = useState(false);

  const apiQuery = useMemo(() => {
    const { view: _view, ...rest } = query as Record<string, unknown>;
    void _view;
    return rest;
  }, [query]);
  const list = useAttendanceList(apiQuery);

  const columns = useMemo<ColumnDef<AttendanceRow, unknown>[]>(
    () => [
      {
        id: 'employee',
        header: 'Employee',
        enableHiding: false,
        cell: ({ row }) => {
          const e = row.original.employeeId;
          return <PersonCell name={fullName(e)} subtitle={[e?.employeeId, e?.departmentId?.name].filter(Boolean).join(' · ')} photo={e?.profilePhoto} />;
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
        emptyDescription={hasFilters(FILTER_KEYS) ? 'Try changing your filters.' : 'Records appear as employees check in.'}
        emptyAction={
          canCreate ? (
            <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setMarking(true)}>
              Mark attendance
            </Button>
          ) : undefined
        }
        toolbar={
          <FilterBar active={hasFilters(FILTER_KEYS)} onClear={() => clear(['view', 'sortBy', 'sortOrder'])}>
            <DateRangePicker from={params.from as string | undefined} to={params.to as string | undefined} onChange={(r) => set({ from: r.from, to: r.to })} />
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
    </>
  );
};
