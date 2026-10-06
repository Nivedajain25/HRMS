import { useState } from 'react';
import { Plus, Target } from 'lucide-react';
import { GOAL_CATEGORIES, GOAL_STATUS } from '@stencil/shared';
import { EmployeePicker, FilterBar, SearchInput } from '@/components/common/controls';
import { Pagination } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { Tabs } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { label } from '@/lib/i18n';
import { fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useCycleOptions, useGoals, type Cycle, type Goal, type PersonRef } from './api';
import { GoalCard } from './components/goal-card';
import { GoalFormDrawer, WeightMeter } from './components/goal-form';
import { CATEGORY_LABELS, CycleSelect, PerformanceLinks } from './components/perf-ui';

type Tab = 'mine' | 'team' | 'all';
const SCOPE: Record<Tab, 'me' | 'team' | 'all'> = { mine: 'me', team: 'team', all: 'all' };

const SORTS = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'dueDate:asc', label: 'Due soonest' },
  { value: 'progress:asc', label: 'Least progress' },
  { value: 'progress:desc', label: 'Most progress' },
  { value: 'weight:desc', label: 'Highest weight' },
];

/** Name for a pre-selected employee filter, taken from loaded rows. */
export const employeeLabel = (rows: { employeeId: PersonRef | null }[] | undefined, id: string | undefined) => {
  const person = id ? rows?.find((r) => r.employeeId?._id === id)?.employeeId : undefined;
  return person ? { [person._id]: fullName(person) } : undefined;
};

/** Per-cycle weight allocation for one employee (or the caller). */
export const WeightAllocation = ({ employeeId, cycleId, cycles }: { employeeId?: string; cycleId?: string; cycles: Cycle[] | undefined }) => {
  const q = useGoals({ ...(employeeId ? { employeeId } : { scope: 'me' }), cycleId: cycleId || undefined, limit: 100, page: 1 });
  if (q.isLoading) return <Skeleton className="h-24" />;
  if (q.error || !q.data?.data.length) return null;
  const groups = new Map<string, { name: string; total: number; count: number }>();
  for (const g of q.data.data) {
    if (g.status === 'CANCELLED' || !g.cycleId || g.cycleId.status === 'COMPLETED') continue;
    const cur = groups.get(g.cycleId._id) ?? { name: g.cycleId.name, total: 0, count: 0 };
    cur.total += g.weight || 0;
    cur.count += 1;
    groups.set(g.cycleId._id, cur);
  }
  if (!groups.size) return null;
  const ordered = [...groups.entries()].sort(([a], [b]) => (cycles?.findIndex((c) => c._id === a) ?? 0) - (cycles?.findIndex((c) => c._id === b) ?? 0));
  return (
    <section aria-label="Goal weight allocation" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {ordered.map(([id, g]) => (
        <Card key={id} className="p-4">
          <p className="mb-2 truncate text-sm font-medium text-fg">
            {g.name} <span className="font-normal text-muted">· {g.count} goal{g.count === 1 ? '' : 's'}</span>
          </p>
          <WeightMeter allocated={g.total} adding={0} compact />
        </Card>
      ))}
    </section>
  );
};

export const GoalGrid = ({ goals, showOwner }: { goals: Goal[]; showOwner?: boolean }) => (
  <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
    {goals.map((g) => (
      <GoalCard key={g._id} goal={g} showOwner={showOwner} />
    ))}
  </div>
);

export const GoalGridSkeleton = () => (
  <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" role="status" aria-label="Loading goals">
    {Array.from({ length: 4 }).map((_, i) => (
      <Skeleton key={i} className="h-44" />
    ))}
  </div>
);

export const GoalsPage = () => {
  const { can, isManager, hasEmployee } = usePermissions();
  const canAll = can('performance:read');
  const defaultTab: Tab = hasEmployee ? 'mine' : isManager ? 'team' : 'all';
  const { params, query, set, clear, hasFilters } = useListParams({ limit: 12, sortBy: 'createdAt', sortOrder: 'desc' });
  const requested = (params.tab as Tab | undefined) ?? defaultTab;
  const allowed: Record<Tab, boolean> = { mine: hasEmployee, team: isManager, all: canAll };
  const tab: Tab = allowed[requested] ? requested : defaultTab;
  const cycles = useCycleOptions();
  const [creating, setCreating] = useState(false);
  const canCreate = hasEmployee || isManager || (can('performance:create') && canAll);

  const apiQuery: Record<string, unknown> = { ...query, scope: SCOPE[tab], employeeId: tab !== 'mine' ? query.employee : undefined };
  delete apiQuery.tab;
  delete apiQuery.employee;
  const goals = useGoals(apiQuery, allowed[tab]);
  const filterKeys = ['search', 'cycleId', 'status', 'category', 'employee'];
  const sortValue = `${params.sortBy ?? 'createdAt'}:${params.sortOrder}`;

  return (
    <>
      <PageHeader
        title="Goals"
        description="Set, track and align goals across the organization."
        actions={
          <>
            <PerformanceLinks current="goals" />
            {canCreate && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                New goal
              </Button>
            )}
          </>
        }
      />

      {!allowed[tab] ? (
        <EmptyState className="card" icon={<Target className="h-6 w-6" />} title="No goals to show" description="Your account is not linked to an employee profile or a team." />
      ) : (
        <div className="space-y-5">
          <Tabs
            tabs={[
              { key: 'mine', label: 'My goals', hidden: !allowed.mine },
              { key: 'team', label: 'Team goals', hidden: !allowed.team },
              { key: 'all', label: 'All goals', hidden: !allowed.all },
            ]}
            active={tab}
            onChange={(key) => set({ tab: key === defaultTab ? undefined : key, employee: undefined })}
          />
          <div role="tabpanel" aria-labelledby={`tab-${tab}`} className="space-y-5">
            <FilterBar active={hasFilters(filterKeys)} onClear={() => clear(['tab', 'sortBy', 'sortOrder'])}>
              <SearchInput key={`search-${tab}`} value={params.search} onSearch={(search) => set({ search })} placeholder="Search goals…" />
              <CycleSelect cycles={cycles.data} value={String(params.cycleId ?? '')} onChange={(cycleId) => set({ cycleId })} />
              <Select aria-label="Status" className="w-full sm:w-40" value={String(params.status ?? '')} onChange={(e) => set({ status: e.target.value })} placeholder="All statuses" options={GOAL_STATUS.map((s) => ({ value: s, label: label(s) }))} />
              <Select aria-label="Category" className="w-full sm:w-40" value={String(params.category ?? '')} onChange={(e) => set({ category: e.target.value })} placeholder="All categories" options={GOAL_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} />
              {tab !== 'mine' && (
                <div className="w-full sm:w-60">
                  <EmployeePicker
                    value={(params.employee as string | undefined) ?? null}
                    onChange={(v) => set({ employee: typeof v === 'string' ? v : undefined })}
                    placeholder="All employees"
                    selectedLabels={employeeLabel(goals.data?.data, params.employee as string | undefined)}
                  />
                </div>
              )}
              <Select
                aria-label="Sort by"
                className="w-full sm:w-44"
                value={sortValue}
                onChange={(e) => {
                  const [sortBy, sortOrder] = e.target.value.split(':');
                  set({ sortBy, sortOrder });
                }}
                options={SORTS}
              />
            </FilterBar>

            {tab === 'mine' && <WeightAllocation cycleId={params.cycleId as string | undefined} cycles={cycles.data} />}
            {tab !== 'mine' && params.employee && <WeightAllocation employeeId={String(params.employee)} cycleId={params.cycleId as string | undefined} cycles={cycles.data} />}

            {goals.isLoading ? (
              <GoalGridSkeleton />
            ) : goals.error ? (
              <ErrorState className="card" message={goals.error.message} onRetry={() => goals.refetch()} />
            ) : !goals.data?.data.length ? (
              <EmptyState
                className="card"
                icon={<Target className="h-6 w-6" />}
                title={hasFilters(filterKeys) ? 'No goals match your filters' : tab === 'mine' ? 'You have no goals yet' : 'No goals yet'}
                description={hasFilters(filterKeys) ? 'Try changing or clearing the filters.' : 'Goals make expectations explicit and feed into performance reviews.'}
                action={
                  canCreate && !hasFilters(filterKeys) ? (
                    <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                      New goal
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <GoalGrid goals={goals.data.data} showOwner={tab !== 'mine'} />
                <div className="card overflow-hidden">
                  <Pagination pagination={goals.data.pagination} onPageChange={(page) => set({ page })} onLimitChange={(limit) => set({ limit })} loading={goals.isFetching} />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <GoalFormDrawer
        open={creating}
        onClose={() => setCreating(false)}
        defaultCycleId={(params.cycleId as string | undefined) ?? undefined}
        defaultEmployeeId={tab !== 'mine' && params.employee ? String(params.employee) : undefined}
      />
    </>
  );
};
