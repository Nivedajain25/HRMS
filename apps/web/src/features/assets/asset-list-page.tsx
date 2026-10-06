import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { Archive, ArrowRightLeft, CalendarDays, CheckCircle2, Laptop, MoreHorizontal, Package, Plus, UserCheck, Wrench } from 'lucide-react';
import { ASSET_CATEGORIES, ASSET_STATUS } from '@stencil/shared';
import { FilterBar, SearchInput } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, ErrorState, PageHeader, PersonCell, Skeleton, StatCard } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { Dropdown } from '@/components/ui/overlay';
import { toOptions, useAllOf } from '@/features/employees/api';
import { useListParams } from '@/hooks/use-list-params';
import { label } from '@/lib/i18n';
import { apiDateKey, formatDate, formatMoney, formatNumber, fullName, toDateKey } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useAssets, useAssetSummary, useMyAssets, type AssetRecord } from './api';
import { useAssetActions } from './components/asset-actions';
import { AssetFormDrawer } from './components/asset-form-drawer';

const FILTER_KEYS = ['search', 'status', 'category', 'locationId'];

const SummaryCards = () => {
  const summary = useAssetSummary();
  const { user } = usePermissions();
  const s = summary.data;
  const count = (status: string) => s?.byStatus.find((b) => b.status === status)?.count ?? 0;
  const currency = s?.currency ?? user?.organization.currency ?? 'USD';
  if (summary.error) return null;
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-5">
      <div className="col-span-2 lg:col-span-1">
        <StatCard label="Total assets" value={formatNumber(s?.total)} hint={s ? `${formatMoney(s.totalValue, currency)} purchase value` : undefined} icon={<Package className="h-5 w-5" />} loading={summary.isLoading} />
      </div>
      <StatCard label="Available" value={formatNumber(count('AVAILABLE'))} icon={<CheckCircle2 className="h-5 w-5" />} tone="green" to="/assets?status=AVAILABLE" loading={summary.isLoading} />
      <StatCard label="Assigned" value={formatNumber(count('ASSIGNED'))} icon={<UserCheck className="h-5 w-5" />} tone="blue" to="/assets?status=ASSIGNED" loading={summary.isLoading} />
      <StatCard label="In repair" value={formatNumber(count('REPAIR'))} icon={<Wrench className="h-5 w-5" />} tone="amber" to="/assets?status=REPAIR" loading={summary.isLoading} />
      <StatCard label="Retired" value={formatNumber(count('RETIRED'))} icon={<Archive className="h-5 w-5" />} tone="gray" to="/assets?status=RETIRED" loading={summary.isLoading} />
    </div>
  );
};

const Inventory = () => {
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'assetTag', sortOrder: 'asc' });
  const list = useAssets(query);
  const locations = useAllOf('locations');
  const { can, user } = usePermissions();
  const navigate = useNavigate();
  const actions = useAssetActions();
  const [creating, setCreating] = useState(false);
  const currency = user?.organization.currency ?? 'USD';
  const filtered = hasFilters(FILTER_KEYS);

  const columns: ColumnDef<AssetRecord, unknown>[] = [
    {
      id: 'assetTag',
      header: 'Asset',
      enableSorting: true,
      enableHiding: false,
      cell: ({ row }) => (
        <span className="block min-w-0">
          <span className="block font-medium text-fg">{row.original.name}</span>
          <span className="block text-xs text-muted">
            <span className="font-mono">{row.original.assetTag}</span>
            {row.original.brand || row.original.model ? ` · ${[row.original.brand, row.original.model].filter(Boolean).join(' ')}` : ''}
          </span>
        </span>
      ),
    },
    { id: 'category', header: 'Category', enableSorting: true, cell: ({ row }) => label(row.original.category) },
    { id: 'serialNumber', header: 'Serial', cell: ({ row }) => (row.original.serialNumber ? <span className="font-mono text-xs">{row.original.serialNumber}</span> : '—') },
    { id: 'status', header: 'Status', enableSorting: true, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      id: 'holder',
      header: 'Assigned to',
      cell: ({ row }) =>
        row.original.currentEmployeeId ? (
          <PersonCell name={fullName(row.original.currentEmployeeId)} subtitle={row.original.currentEmployeeId.employeeId} photo={row.original.currentEmployeeId.profilePhoto} />
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    { id: 'location', header: 'Location', cell: ({ row }) => row.original.locationId?.name ?? '—' },
    { id: 'condition', header: 'Condition', cell: ({ row }) => <Badge tone={row.original.condition === 'DAMAGED' ? 'red' : 'gray'}>{label(row.original.condition)}</Badge> },
    {
      id: 'purchaseDate',
      header: 'Purchased',
      enableSorting: true,
      cell: ({ row }) => (
        <span>
          {formatDate(row.original.purchaseDate)}
          {row.original.purchaseCost != null && <span className="block text-xs text-muted">{formatMoney(row.original.purchaseCost, currency)}</span>}
        </span>
      ),
    },
    {
      id: 'warranty',
      header: 'Warranty',
      cell: ({ row }) => {
        const w = row.original.warrantyExpiry;
        if (!w) return '—';
        const expired = apiDateKey(w) < toDateKey(new Date());
        return (
          <span className="flex items-center gap-2">
            {formatDate(w)}
            {expired && <Badge>Expired</Badge>}
          </span>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Dropdown
            label={`Actions for ${row.original.assetTag}`}
            trigger={
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3">
                <MoreHorizontal className="h-4 w-4" />
              </span>
            }
            items={actions.items(row.original)}
          />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Assets"
        description="Company equipment inventory, allocation and lifecycle."
        actions={
          <>
            <Button variant="outline" icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => navigate('/assets/assignments')}>
              Asset Allocation
            </Button>
            {can('asset:create') && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                Add asset
              </Button>
            )}
          </>
        }
      />
      <SummaryCards />
      <DataTable
        caption="Assets"
        storageKey="assets"
        columns={columns}
        getRowId={(a) => a._id}
        data={list.data?.data}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => list.refetch()}
        pagination={list.data?.pagination}
        onPageChange={(page) => set({ page })}
        onLimitChange={(limit) => set({ limit })}
        sorting={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
        onSortingChange={(s) => set({ sortBy: s.sortBy, sortOrder: s.sortOrder })}
        onRowClick={(a) => navigate(`/assets/${a._id}`)}
        emptyTitle={filtered ? 'No assets match your filters' : 'No assets yet'}
        emptyDescription={filtered ? 'Try changing or clearing the filters.' : 'Add laptops, phones and other equipment to track who has what.'}
        emptyAction={
          !filtered && can('asset:create') ? (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Add asset
            </Button>
          ) : undefined
        }
        toolbar={
          <FilterBar active={filtered} onClear={() => clear(['sortBy', 'sortOrder'])}>
            <SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder="Search tag, name, serial…" />
            <Select aria-label="Status" className="w-full sm:w-36" value={String(params.status ?? '')} onChange={(e) => set({ status: e.target.value })} options={ASSET_STATUS.map((s) => ({ value: s, label: label(s) }))} placeholder="All statuses" />
            <Select aria-label="Category" className="w-full sm:w-40" value={String(params.category ?? '')} onChange={(e) => set({ category: e.target.value })} options={ASSET_CATEGORIES.map((c) => ({ value: c, label: label(c) }))} placeholder="All categories" />
            <Select aria-label="Location" className="w-full sm:w-44" value={String(params.locationId ?? '')} onChange={(e) => set({ locationId: e.target.value })} options={toOptions(locations.data)} placeholder="All locations" />
          </FilterBar>
        }
      />
      {actions.element}
      <AssetFormDrawer
        open={creating}
        onClose={(saved) => {
          setCreating(false);
          if (saved) navigate(`/assets/${saved._id}`);
        }}
      />
    </>
  );
};

const MyAssets = () => {
  const mine = useMyAssets();
  return (
    <>
      <PageHeader title="My assets" description="Equipment currently assigned to you. Contact IT or HR to report a problem or return an item." />
      {mine.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : mine.error ? (
        <ErrorState className="card" message={mine.error.message} onRetry={() => mine.refetch()} />
      ) : !mine.data?.length ? (
        <EmptyState className="card" icon={<Laptop className="h-6 w-6" />} title="No assets assigned to you" description="When the company issues you a laptop, phone or other equipment it will appear here." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {mine.data.map((a) => (
            <li key={a._id}>
              <Link to={`/assets/${a.assetId._id}`} className="card block h-full p-5 transition-shadow hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                    <Laptop className="h-5 w-5" aria-hidden />
                  </span>
                  <Badge>{label(a.assetId.category)}</Badge>
                </div>
                <p className="mt-3 font-semibold text-fg">{a.assetId.name}</p>
                <p className="text-xs text-muted">
                  <span className="font-mono">{a.assetId.assetTag}</span>
                  {a.assetId.brand || a.assetId.model ? ` · ${[a.assetId.brand, a.assetId.model].filter(Boolean).join(' ')}` : ''}
                </p>
                <dl className="mt-4 space-y-1.5 text-sm">
                  {a.assetId.serialNumber && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Serial</dt>
                      <dd className="truncate font-mono text-xs text-fg">{a.assetId.serialNumber}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Assigned</dt>
                    <dd className="text-fg">{formatDate(a.assignedDate)}</dd>
                  </div>
                  {a.expectedReturnDate && (
                    <div className="flex justify-between gap-3">
                      <dt className="flex items-center gap-1 text-muted">
                        <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Return by
                      </dt>
                      <dd className={apiDateKey(a.expectedReturnDate) < toDateKey(new Date()) ? 'font-medium text-red-600 dark:text-red-400' : 'text-fg'}>{formatDate(a.expectedReturnDate)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Condition at handover</dt>
                    <dd className="text-fg">{label(a.conditionAtAssignment)}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

export const AssetListPage = () => {
  const { can } = usePermissions();
  return can('asset:read') ? <Inventory /> : <MyAssets />;
};
