import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { ChevronRight, FileText } from 'lucide-react';
import { EmployeePicker, FilterBar } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { DataTable, Pagination } from '@/components/tables/data-table';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { Tabs } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { formatDate, formatMoney } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { usePayslips, type Payslip } from './api';
import { PayslipDrawer, PdfButton } from './components/payroll-ui';
import { formatDays, monthOptions, periodLabel, yearOptions } from './lib';

/** Card for one of my payslips (mobile-first). */
const PayslipCard = ({ slip, onOpen }: { slip: Payslip; onOpen: () => void }) => (
  <li className="card flex flex-col overflow-hidden transition-shadow hover:shadow-pop">
    <button type="button" onClick={onOpen} className="flex flex-1 flex-col p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" aria-label={`View payslip for ${periodLabel(slip.month, slip.year)}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-fg">{periodLabel(slip.month, slip.year)}</p>
          <p className="text-xs text-muted">{slip.paymentDate ? `Paid ${formatDate(slip.paymentDate)}` : 'Awaiting payment'}</p>
        </div>
        <StatusBadge status={slip.status} />
      </div>
      <p className="mt-4 text-xs text-muted">Net pay</p>
      <p className="text-2xl font-semibold tracking-tight text-fg tabular-nums">{formatMoney(slip.netPay, slip.currency)}</p>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted">Gross</dt>
          <dd className="font-medium text-fg tabular-nums">{formatMoney(slip.grossEarnings, slip.currency)}</dd>
        </div>
        <div>
          <dt className="text-muted">Deductions</dt>
          <dd className="font-medium text-fg tabular-nums">{formatMoney(slip.totalDeductions, slip.currency)}</dd>
        </div>
        <div>
          <dt className="text-muted">Paid days</dt>
          <dd className="font-medium text-fg tabular-nums">{formatDays(slip.payableDays)}</dd>
        </div>
      </dl>
    </button>
    <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-2 px-4 py-2">
      <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
        View breakdown <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
      <PdfButton slip={slip} size="xs" variant="ghost" label="PDF" />
    </div>
  </li>
);

const MyPayslips = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const { params, query, set } = useListParams({ limit: 12 });
  const { tab: _tab, ...apiQuery } = query;
  void _tab;
  const list = usePayslips({ ...apiQuery, scope: 'me' });
  const { hasEmployee } = usePermissions();

  if (!hasEmployee) return <EmptyState className="card" icon={<FileText className="h-6 w-6" />} title="No employee profile" description="Payslips are available to users linked to an employee record." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Payslips appear once payroll is approved.</p>
        <Select aria-label="Year" className="w-full sm:w-32" value={String(params.year ?? '')} onChange={(e) => set({ year: e.target.value })} options={yearOptions(10, 0)} placeholder="All years" />
      </div>
      {list.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading payslips">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : list.error ? (
        <ErrorState className="card" message={list.error.message} onRetry={() => list.refetch()} />
      ) : !list.data?.data.length ? (
        <EmptyState
          className="card"
          icon={<FileText className="h-6 w-6" />}
          title={params.year ? `No payslips for ${params.year}` : 'No payslips yet'}
          description={params.year ? 'Try another year.' : 'Your payslips will appear here after your first payroll is approved.'}
        />
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.data.data.map((s) => (
              <PayslipCard key={s._id} slip={s} onOpen={() => onOpen(s._id)} />
            ))}
          </ul>
          {list.data.pagination.totalPages > 1 && (
            <div className="card overflow-hidden">
              <Pagination pagination={list.data.pagination} onPageChange={(page) => set({ page })} loading={list.isFetching} />
            </div>
          )}
        </>
      )}
    </div>
  );
};

const AllPayslips = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'year', sortOrder: 'desc' });
  const { tab: _tab, ...apiQuery } = query;
  void _tab;
  const list = usePayslips({ ...apiQuery, scope: 'all' });
  const columns = useMemo<ColumnDef<Payslip, unknown>[]>(
    () => [
      {
        id: 'employee',
        header: 'Employee',
        enableHiding: false,
        cell: ({ row }) => (
          <span className="block">
            <span className="font-medium text-fg">{row.original.employeeSnapshot.name}</span>
            <span className="block text-xs text-muted">{[row.original.employeeSnapshot.employeeId, row.original.employeeSnapshot.department].filter(Boolean).join(' · ')}</span>
          </span>
        ),
      },
      { id: 'year', header: 'Period', enableSorting: true, cell: ({ row }) => periodLabel(row.original.month, row.original.year) },
      { id: 'payable', header: 'Payable days', cell: ({ row }) => formatDays(row.original.payableDays) },
      { id: 'gross', header: 'Gross', cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.grossEarnings, row.original.currency)}</span> },
      { id: 'deductions', header: 'Deductions', cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.totalDeductions, row.original.currency)}</span> },
      { id: 'netPay', header: 'Net pay', enableSorting: true, cell: ({ row }) => <span className="font-medium text-fg tabular-nums">{formatMoney(row.original.netPay, row.original.currency)}</span> },
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      {
        id: 'pdf',
        header: '',
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <PdfButton slip={row.original} size="xs" variant="ghost" />
          </div>
        ),
      },
    ],
    [],
  );
  const filterKeys = ['employeeId', 'month', 'year'];
  return (
    <DataTable
      caption="All payslips"
      storageKey="payslips-all"
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
      onRowClick={(p) => onOpen(p._id)}
      emptyTitle="No payslips found"
      emptyDescription={hasFilters(filterKeys) ? 'Try changing your filters.' : 'Payslips are created when a payroll run is processed.'}
      toolbar={
        <FilterBar active={hasFilters(filterKeys)} onClear={() => clear(['tab'])}>
          <div className="w-full sm:w-64">
            <EmployeePicker value={(params.employeeId as string | undefined) ?? null} onChange={(v) => set({ employeeId: (v as string | null) ?? undefined })} placeholder="All employees" />
          </div>
          <Select aria-label="Month" className="w-full sm:w-36" value={String(params.month ?? '')} onChange={(e) => set({ month: e.target.value })} options={monthOptions} placeholder="All months" />
          <Select aria-label="Year" className="w-full sm:w-28" value={String(params.year ?? '')} onChange={(e) => set({ year: e.target.value })} options={yearOptions()} placeholder="All years" />
        </FilterBar>
      }
    />
  );
};

export const PayslipsPage = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const canAll = can('payroll:read');
  const tab = canAll && searchParams.get('tab') === 'all' ? 'all' : 'mine';
  // Keep list filters in the URL while the payslip drawer is open (deep links: /payslips/:id).
  const query = searchParams.toString() ? `?${searchParams.toString()}` : '';
  const open = (slipId: string) => navigate(`/payslips/${slipId}${query}`);

  return (
    <>
      <PageHeader title="Payslips" description={tab === 'all' ? 'Payslips across the organization.' : 'Your monthly payslips with earnings, deductions and payment details.'} />
      {canAll && (
        <Tabs
          className="mb-6"
          tabs={[
            { key: 'mine', label: 'My payslips' },
            { key: 'all', label: 'All payslips' },
          ]}
          active={tab}
          onChange={(key) => navigate(key === 'all' ? '/payslips?tab=all' : '/payslips', { replace: true })}
        />
      )}
      <div role={canAll ? 'tabpanel' : undefined} aria-labelledby={canAll ? `tab-${tab}` : undefined}>
        {tab === 'all' ? <AllPayslips onOpen={open} /> : <MyPayslips onOpen={open} />}
      </div>
      <PayslipDrawer id={id ?? null} onClose={() => navigate(`/payslips${query}`)} />
    </>
  );
};
