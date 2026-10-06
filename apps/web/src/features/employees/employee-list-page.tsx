import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, Network, Plus, UserPlus, Users } from 'lucide-react';
import { EMPLOYMENT_STATUS, EMPLOYMENT_TYPES } from '@stencil/shared';
import { FilterBar, SearchInput } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { IconTitle, PageHeader, PersonCell } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { useListParams } from '@/hooks/use-list-params';
import { downloadFile } from '@/lib/api';
import { label } from '@/lib/i18n';
import { formatDate, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useAttendanceList } from '@/features/attendance/api';
import { SelfieThumb } from '@/features/attendance/components/attendance-capture';
import { dateKeyIn, useOrgTimezone } from '@/features/attendance/lib';
import { toOptions, useAllOf, useEmployees, type EmployeeSummary } from './api';
import { EmployeeFormDrawer } from './employee-form';

export const EmployeeListPage = () => {
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'firstName', sortOrder: 'asc' });
  const list = useEmployees(query);
  const departments = useAllOf('departments');
  const designations = useAllOf('designations');
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  // Today's clock-in / clock-out selfies, for people who can see attendance (the files need attendance:read).
  const timeZone = useOrgTimezone();
  const today = dateKeyIn(timeZone);
  const showSelfies = can('attendance:read');
  const todays = useAttendanceList({ scope: 'all', from: today, to: today, page: 1, limit: 100 }, showSelfies);
  const selfieByEmployee = useMemo(() => {
    const map = new Map<string, { in?: string | null; out?: string | null }>();
    for (const r of todays.data?.data ?? []) map.set(r.employeeId._id, { in: r.checkInPhotoId, out: r.checkOutPhotoId });
    return map;
  }, [todays.data]);

  const columns = useMemo<ColumnDef<EmployeeSummary, unknown>[]>(
    () => [
      {
        id: 'firstName',
        header: 'Employee',
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => <PersonCell name={fullName(row.original)} subtitle={row.original.workEmail} photo={row.original.profilePhoto} />,
      },
      ...(showSelfies
        ? [
            {
              id: 'selfie',
              header: "Today's selfie",
              cell: ({ row }) => {
                const s = selfieByEmployee.get(row.original._id);
                if (!s?.in && !s?.out) return <span className="text-xs text-muted">—</span>;
                const name = fullName(row.original);
                return (
                  // Clicking a selfie opens it; it shouldn't also open the profile.
                  <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {s.in ? <SelfieThumb fileId={s.in} label={`${name} clock-in selfie`} /> : null}
                    {s.out ? <SelfieThumb fileId={s.out} label={`${name} clock-out selfie`} /> : null}
                  </span>
                );
              },
            } satisfies ColumnDef<EmployeeSummary, unknown>,
          ]
        : []),
      { id: 'employeeId', header: 'ID', enableSorting: true, cell: ({ row }) => <span className="font-mono text-xs">{row.original.employeeId}</span> },
      { id: 'department', header: 'Department', cell: ({ row }) => row.original.departmentId?.name ?? '—' },
      { id: 'designation', header: 'Designation', cell: ({ row }) => row.original.designationId?.name ?? '—' },
      {
        id: 'manager',
        header: 'Manager',
        cell: ({ row }) => (row.original.managerId ? fullName(row.original.managerId) : '—'),
      },
      { id: 'location', header: 'Location', cell: ({ row }) => row.original.locationId?.name ?? '—' },
      { id: 'employmentType', header: 'Type', cell: ({ row }) => label(row.original.employmentType) },
      { id: 'joiningDate', header: 'Joined', enableSorting: true, cell: ({ row }) => formatDate(row.original.joiningDate) },
      { id: 'employmentStatus', header: 'Status', enableSorting: true, cell: ({ row }) => <StatusBadge status={row.original.employmentStatus} /> },
    ],
    [showSelfies, selfieByEmployee],
  );

  const filterKeys = ['search', 'department', 'designation', 'status', 'employmentType'];

  return (
    <>
      <PageHeader
        title={<IconTitle icon={<Users />}>Employees</IconTitle>}
        description={list.data ? `${list.data.pagination.total} people` : 'Everyone in your organization'}
        actions={
          <>
            <Button variant="outline" icon={<Network className="h-4 w-4" />} onClick={() => navigate('/employees/org-chart')}>
              Org chart
            </Button>
            {can('report:read') && (
              <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => downloadFile('/reports/employees', { format: 'csv', departmentId: params.department }, 'employees.csv')}>
                Export
              </Button>
            )}
            {can('employee:create') && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                Add employee
              </Button>
            )}
          </>
        }
      />
      <DataTable
        caption="Employees"
        storageKey="employees"
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
        onRowClick={(e) => navigate(`/employees/${e._id}`)}
        emptyTitle="No employees found"
        emptyDescription={hasFilters(filterKeys) ? 'Try changing your filters.' : 'Add your first employee to get started.'}
        emptyAction={
          can('employee:create') && !hasFilters(filterKeys) ? (
            <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Add employee
            </Button>
          ) : undefined
        }
        toolbar={
          <FilterBar active={hasFilters(filterKeys)} onClear={() => clear(['sortBy', 'sortOrder'])}>
            <SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder="Search name, ID, email…" />
            <Select aria-label="Department" className="w-44" value={String(params.department ?? '')} onChange={(e) => set({ department: e.target.value })} options={toOptions(departments.data)} placeholder="All departments" />
            <Select aria-label="Designation" className="w-44" value={String(params.designation ?? '')} onChange={(e) => set({ designation: e.target.value })} options={toOptions(designations.data)} placeholder="All designations" />
            <Select
              aria-label="Status"
              className="w-40"
              value={String(params.status ?? '')}
              onChange={(e) => set({ status: e.target.value })}
              options={EMPLOYMENT_STATUS.map((s) => ({ value: s, label: label(s) }))}
              placeholder="Current staff"
            />
            <Select
              aria-label="Employment type"
              className="w-36"
              value={String(params.employmentType ?? '')}
              onChange={(e) => set({ employmentType: e.target.value })}
              options={EMPLOYMENT_TYPES.map((s) => ({ value: s, label: label(s) }))}
              placeholder="All types"
            />
          </FilterBar>
        }
      />
      <EmployeeFormDrawer
        open={creating}
        onClose={(saved) => {
          setCreating(false);
          if (saved) navigate(`/employees/${saved._id}`);
        }}
      />
    </>
  );
};
