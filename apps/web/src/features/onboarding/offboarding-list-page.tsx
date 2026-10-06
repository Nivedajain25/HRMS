import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRight, DoorOpen, LogOut, UserMinus } from 'lucide-react';
import { EXIT_TYPES, OFFBOARDING_STATUS } from '@stencil/shared';
import { FilterBar } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { IconTitle, PageHeader, PersonCell } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { useListParams } from '@/hooks/use-list-params';
import { label } from '@/lib/i18n';
import { formatDate, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useMyActiveOffboarding, useOffboardings, type Offboarding } from './api';
import { daysUntil, ExitTypeBadge } from './components/lifecycle-ui';
import { OffboardingFormDrawer } from './components/offboarding-form';
import { CompactStepper } from './components/offboarding-stepper';

const lastDayHint = (o: Offboarding) => {
  if (o.status === 'COMPLETED' || o.status === 'CANCELLED') return null;
  const d = daysUntil(o.lastWorkingDate);
  if (d === null) return null;
  if (d < 0) return `${Math.abs(d)} day${d === -1 ? '' : 's'} ago`;
  if (d === 0) return 'Today';
  return `in ${d} day${d === 1 ? '' : 's'}`;
};

export const OffboardingListPage = () => {
  const { params, query, set, clear, hasFilters } = useListParams({ status: 'ACTIVE' });
  // `ALL` is a UI-only value: the API lists every status when `status` is omitted.
  const apiQuery = useMemo(() => Object.fromEntries(Object.entries(query).filter(([k, v]) => !(k === 'status' && v === 'ALL'))), [query]);
  const list = useOffboardings(apiQuery);
  const { can, hasEmployee } = usePermissions();
  const canManage = can('offboarding:manage');
  const mine = useMyActiveOffboarding(hasEmployee);
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState<'start' | 'resign' | null>(null);
  const filterKeys = ['status', 'exitType'];
  const canResign = hasEmployee && mine.isSuccess && !mine.data;

  const columns = useMemo<ColumnDef<Offboarding, unknown>[]>(
    () => [
      {
        id: 'employee',
        header: 'Employee',
        enableHiding: false,
        cell: ({ row }) => {
          const e = row.original.employeeId;
          return e ? (
            <PersonCell name={fullName(e)} subtitle={[e.employeeId, e.designationId?.name].filter(Boolean).join(' · ')} photo={e.profilePhoto} />
          ) : (
            <span className="text-muted">Removed employee</span>
          );
        },
      },
      { id: 'department', header: 'Department', cell: ({ row }) => row.original.employeeId?.departmentId?.name ?? '—' },
      { id: 'exitType', header: 'Exit type', cell: ({ row }) => <ExitTypeBadge type={row.original.exitType} /> },
      { id: 'requestDate', header: 'Requested', enableSorting: true, cell: ({ row }) => formatDate(row.original.requestDate) },
      {
        id: 'lastWorkingDate',
        header: 'Last working day',
        enableSorting: true,
        cell: ({ row }) => {
          const hint = lastDayHint(row.original);
          return (
            <span>
              {formatDate(row.original.lastWorkingDate)}
              {hint && <span className="block text-xs text-muted">{hint}</span>}
            </span>
          );
        },
      },
      {
        id: 'progress',
        header: 'Progress',
        enableHiding: false,
        cell: ({ row }) => <CompactStepper status={row.original.status} timeline={row.original.timeline} />,
      },
      { id: 'status', header: 'Status', enableSorting: true, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ],
    [],
  );

  const filtered = hasFilters(filterKeys);

  return (
    <>
      <PageHeader
        title={<IconTitle icon={<UserMinus />}>Offboarding</IconTitle>}
        description={canManage ? 'Exit workflows from request to account deactivation' : 'Exit workflows for you and your team'}
        actions={
          <>
            {canResign && (
              <Button variant="outline" icon={<LogOut className="h-4 w-4" />} onClick={() => setDrawer('resign')}>
                Resign
              </Button>
            )}
            {canManage && (
              <Button icon={<UserMinus className="h-4 w-4" />} onClick={() => setDrawer('start')}>
                Start offboarding
              </Button>
            )}
          </>
        }
      />

      {mine.data && (
        <Link
          to={`/offboarding/${mine.data._id}`}
          className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 transition-colors hover:bg-amber-100/70 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200 dark:hover:bg-amber-500/15"
        >
          <span className="flex items-start gap-2.5">
            <DoorOpen className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Your {label(mine.data.exitType).toLowerCase()} is in progress — currently at <strong>{label(mine.data.status)}</strong>. Last working day{' '}
              {formatDate(mine.data.lastWorkingDate)}.
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 font-medium">
            View details <ArrowRight className="h-4 w-4" aria-hidden />
          </span>
        </Link>
      )}

      <DataTable
        caption="Offboardings"
        storageKey="offboardings"
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
        onRowClick={(o) => navigate(`/offboarding/${o._id}`)}
        emptyTitle={params.status === 'ACTIVE' && !params.exitType ? 'No exits in progress' : 'No offboardings found'}
        emptyDescription={
          filtered || params.status === 'ACTIVE' ? 'Change the status filter to see completed or cancelled exits.' : canManage ? 'Start an offboarding when an employee leaves.' : undefined
        }
        emptyAction={
          canManage ? (
            <Button icon={<UserMinus className="h-4 w-4" />} onClick={() => setDrawer('start')}>
              Start offboarding
            </Button>
          ) : undefined
        }
        toolbar={
          <FilterBar active={filtered} onClear={() => clear(['sortBy', 'sortOrder'])}>
            <Select
              aria-label="Status"
              className="w-full sm:w-44"
              value={String(params.status ?? '')}
              onChange={(e) => set({ status: e.target.value === 'ACTIVE' ? undefined : e.target.value })}
              options={[
                { value: 'ACTIVE', label: 'In progress' },
                { value: 'ALL', label: 'All statuses' },
                ...OFFBOARDING_STATUS.map((s) => ({ value: s, label: label(s) })),
              ]}
            />
            <Select
              aria-label="Exit type"
              className="w-full sm:w-44"
              value={String(params.exitType ?? '')}
              onChange={(e) => set({ exitType: e.target.value })}
              options={EXIT_TYPES.map((t) => ({ value: t, label: label(t) }))}
              placeholder="All exit types"
            />
          </FilterBar>
        }
      />

      <OffboardingFormDrawer
        open={drawer !== null}
        mode={drawer ?? 'start'}
        onClose={(created) => {
          setDrawer(null);
          if (created) navigate(`/offboarding/${created._id}`);
        }}
      />
    </>
  );
};
