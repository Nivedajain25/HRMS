import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { ClipboardCheck } from 'lucide-react';
import { REVIEW_STATUS } from '@stencil/shared';
import { FilterBar } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { EmptyState, PageHeader, PersonCell } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { Tabs } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { label } from '@/lib/i18n';
import { formatDate, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { scaleOf, useCycleOptions, useReviews, type Review } from './api';
import { CycleSelect, PerformanceLinks, RatingValue } from './components/perf-ui';

type Tab = 'mine' | 'team' | 'all';
const SCOPE: Record<Tab, 'me' | 'team' | 'all'> = { mine: 'me', team: 'team', all: 'all' };

export const ReviewsPage = () => {
  const { can, isManager, hasEmployee } = usePermissions();
  const navigate = useNavigate();
  const allowed: Record<Tab, boolean> = { mine: hasEmployee, team: isManager && hasEmployee, all: can('performance:read') };
  const defaultTab: Tab = allowed.team ? 'team' : hasEmployee ? 'mine' : 'all';
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'createdAt', sortOrder: 'desc' });
  const requested = (params.tab as Tab | undefined) ?? defaultTab;
  const tab: Tab = allowed[requested] ? requested : defaultTab;
  const cycles = useCycleOptions();

  const apiQuery: Record<string, unknown> = { ...query, scope: SCOPE[tab] };
  delete apiQuery.tab;
  const list = useReviews(apiQuery, allowed[tab]);
  const filterKeys = ['cycleId', 'status'];

  const columns = useMemo<ColumnDef<Review, unknown>[]>(
    () => [
      {
        id: 'employee',
        header: 'Employee',
        enableHiding: false,
        cell: ({ row }) => (row.original.employeeId ? <PersonCell name={fullName(row.original.employeeId)} subtitle={row.original.employeeId.employeeId} photo={row.original.employeeId.profilePhoto} /> : '—'),
      },
      { id: 'cycle', header: 'Cycle', cell: ({ row }) => row.original.cycleId?.name ?? '—' },
      { id: 'manager', header: 'Manager', cell: ({ row }) => (row.original.managerId ? fullName(row.original.managerId) : '—') },
      { id: 'status', header: 'Status', enableSorting: true, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      {
        id: 'finalRating',
        header: 'Final rating',
        enableSorting: true,
        cell: ({ row }) => <RatingValue value={row.original.finalRating} scale={scaleOf(row.original.cycleId?.ratingScale)} />,
      },
      {
        id: 'completedAt',
        header: 'Completed',
        enableSorting: true,
        cell: ({ row }) => (row.original.completedAt ? formatDate(row.original.completedAt) : '—'),
      },
      { id: 'createdAt', header: 'Opened', enableSorting: true, cell: ({ row }) => formatDate(row.original.createdAt) },
    ],
    [],
  );

  const tabDescriptions: Record<Tab, string> = {
    mine: 'Your own appraisals across cycles.',
    team: 'Reviews of your reports and reviews assigned to you as manager.',
    all: 'Every review in the organization.',
  };

  return (
    <>
      <PageHeader title="Performance reviews" description={tabDescriptions[tab]} actions={<PerformanceLinks current="reviews" />} />
      {!allowed[tab] ? (
        <EmptyState className="card" icon={<ClipboardCheck className="h-6 w-6" />} title="No reviews to show" description="Your account is not linked to an employee profile." />
      ) : (
        <div className="space-y-5">
          <Tabs
            tabs={[
              { key: 'team', label: 'To review', hidden: !allowed.team },
              { key: 'mine', label: 'My reviews', hidden: !allowed.mine },
              { key: 'all', label: 'All reviews', hidden: !allowed.all },
            ]}
            active={tab}
            onChange={(key) => set({ tab: key === defaultTab ? undefined : key })}
          />
          <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
            <DataTable
              caption="Performance reviews"
              storageKey="performance-reviews"
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
              onRowClick={(r) => navigate(`/performance/reviews/${r._id}`)}
              emptyTitle={hasFilters(filterKeys) ? 'No reviews match your filters' : 'No reviews yet'}
              emptyDescription={hasFilters(filterKeys) ? 'Try changing the cycle or status.' : 'Reviews are created when a cycle moves to the self-review stage.'}
              toolbar={
                <FilterBar active={hasFilters(filterKeys)} onClear={() => clear(['tab', 'sortBy', 'sortOrder'])}>
                  <CycleSelect cycles={cycles.data} value={String(params.cycleId ?? '')} onChange={(cycleId) => set({ cycleId })} />
                  <Select
                    aria-label="Status"
                    className="w-full sm:w-44"
                    value={String(params.status ?? '')}
                    onChange={(e) => set({ status: e.target.value })}
                    placeholder="All statuses"
                    options={REVIEW_STATUS.map((s) => ({ value: s, label: label(s) }))}
                  />
                </FilterBar>
              }
            />
          </div>
        </div>
      )}
    </>
  );
};
