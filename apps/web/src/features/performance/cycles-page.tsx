import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight, BarChart3, ClipboardList, Pencil, Plus, RefreshCcw, Star, Target, Trash2, Users } from 'lucide-react';
import { CYCLE_STATUS, PERFORMANCE_CYCLE_WORKFLOW, REVIEW_STATUS, type CycleStatus } from '@stencil/shared';
import { FilterBar, SearchInput } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, DescriptionList, EmptyState, ErrorState, PageHeader, PageSkeleton, ProgressBar, Skeleton, StatCard } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { ApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { formatDate, formatNumber } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useAdvanceCycle, useCycle, useCycles, useDeleteCycle, useGenerateReviews, useSummary, type Cycle, type PerformanceSummary } from './api';
import { CycleFormDrawer } from './components/cycle-form';
import { PerformanceLinks, Stepper } from './components/perf-ui';

const REVIEW_STAGES: CycleStatus[] = ['SELF_REVIEW', 'MANAGER_REVIEW', 'HR_REVIEW'];

const ADVANCE_COPY: Record<CycleStatus, string> = {
  DRAFT: '',
  GOAL_SETTING: 'Employees in scope are notified to add or review their goals.',
  IN_PROGRESS: 'The cycle becomes active. Employees keep tracking progress and can still add goals.',
  SELF_REVIEW:
    'A review is created for every active employee in scope and self reviews open. The rating scale and goal weightage become locked. Employees can no longer add their own goals.',
  MANAGER_REVIEW: 'Signals that manager reviews are due. Individual reviews still move forward as each section is submitted.',
  HR_REVIEW: 'Signals that HR calibration and finalization is due.',
  COMPLETED: 'Closes the cycle. Goals become read-only and remaining reviews can no longer be submitted. This cannot be undone.',
};

const departmentsLabel = (c: Cycle) => (c.departmentIds.length ? c.departmentIds.map((d) => (typeof d === 'string' ? 'Department' : d.name)).join(', ') : 'All departments');

/* ------------------------------- List ------------------------------- */

export const CyclesPage = () => {
  const { can } = usePermissions();
  const navigate = useNavigate();
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'startDate', sortOrder: 'desc' });
  const list = useCycles(query);
  const [creating, setCreating] = useState(false);
  const canCreate = can('performance:create');
  const filterKeys = ['search', 'status'];

  const columns = useMemo<ColumnDef<Cycle, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Cycle',
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <span className="block max-w-xs">
            <span className="block truncate font-medium text-fg">{row.original.name}</span>
            {row.original.description && <span className="block truncate text-xs text-muted">{row.original.description}</span>}
          </span>
        ),
      },
      { id: 'startDate', header: 'Period', enableSorting: true, cell: ({ row }) => `${formatDate(row.original.startDate)} – ${formatDate(row.original.endDate)}` },
      { id: 'status', header: 'Stage', enableSorting: true, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { id: 'goalWeightage', header: 'Goal weightage', cell: ({ row }) => `${row.original.goalWeightage}%` },
      { id: 'scale', header: 'Scale', cell: ({ row }) => `${row.original.ratingScale.min}–${row.original.ratingScale.max}` },
      { id: 'departments', header: 'Scope', cell: ({ row }) => <span className="block max-w-56 truncate">{departmentsLabel(row.original)}</span> },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Performance', to: '/performance/goals' }, { label: 'Cycles' }]}
        title="Performance cycles"
        description="Plan review periods, their scoring rules and stages."
        actions={
          <>
            <PerformanceLinks current="cycles" />
            {canCreate && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                New cycle
              </Button>
            )}
          </>
        }
      />
      <DataTable
        caption="Performance cycles"
        storageKey="performance-cycles"
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
        onRowClick={(c) => navigate(`/performance/cycles/${c._id}`)}
        emptyTitle={hasFilters(filterKeys) ? 'No cycles match your filters' : 'No performance cycles yet'}
        emptyDescription={hasFilters(filterKeys) ? 'Try changing your filters.' : 'Create a cycle to run goal setting and reviews.'}
        emptyAction={
          canCreate && !hasFilters(filterKeys) ? (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New cycle
            </Button>
          ) : undefined
        }
        toolbar={
          <FilterBar active={hasFilters(filterKeys)} onClear={() => clear(['sortBy', 'sortOrder'])}>
            <SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder="Search cycles…" />
            <Select
              aria-label="Stage"
              className="w-full sm:w-44"
              value={String(params.status ?? '')}
              onChange={(e) => set({ status: e.target.value })}
              placeholder="All stages"
              options={CYCLE_STATUS.map((s) => ({ value: s, label: label(s) }))}
            />
          </FilterBar>
        }
      />
      <CycleFormDrawer
        open={creating}
        onClose={(saved) => {
          setCreating(false);
          if (saved) navigate(`/performance/cycles/${saved._id}`);
        }}
      />
    </>
  );
};

/* ------------------------------ Summary ----------------------------- */

const ChartTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: { value: number; label: string | null; count: number } }[] }) => {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="font-medium text-fg">
        {p.value}
        {p.label ? ` · ${p.label}` : ''}
      </p>
      <p className="text-muted">
        {p.count} review{p.count === 1 ? '' : 's'}
      </p>
    </div>
  );
};

const RatingDistribution = ({ data }: { data: PerformanceSummary['ratingDistribution'] }) => {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (!total) return <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No final ratings yet" description="The distribution appears as reviews are completed." />;
  return (
    <>
      <div className="h-64" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }} barCategoryGap="25%">
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="value" tickLine={false} axisLine={{ stroke: 'var(--line)' }} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
            <Tooltip cursor={{ fill: 'var(--surface-3)' }} content={<ChartTooltip />} />
            <Bar dataKey="count" fill="var(--color-brand-600)" radius={[4, 4, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="mt-3 w-full text-sm">
        <caption className="sr-only">Final rating distribution</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Rating</th>
            <th scope="col">Label</th>
            <th scope="col">Reviews</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.map((d) => (
            <tr key={d.value}>
              <td className="w-10 py-1.5 font-semibold text-fg tabular-nums">{d.value}</td>
              <td className="py-1.5 text-fg-2">{d.label ?? '—'}</td>
              <td className="py-1.5 text-right text-fg tabular-nums">
                {d.count} <span className="text-xs text-muted">({Math.round((d.count / total) * 100)}%)</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
};

const StatusBreakdown = ({ counts, statuses, total }: { counts: Partial<Record<string, number>>; statuses: readonly string[]; total: number }) => (
  <ul className="space-y-3">
    {statuses.map((s) => {
      const n = counts[s] ?? 0;
      return (
        <li key={s}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <StatusBadge status={s} />
            <span className="text-fg tabular-nums">
              {n}
              <span className="text-xs text-muted"> / {total}</span>
            </span>
          </div>
          <ProgressBar value={total ? (n / total) * 100 : 0} tone={s === 'COMPLETED' ? 'green' : 'brand'} className="h-1.5" />
        </li>
      );
    })}
  </ul>
);

const CycleSummary = ({ cycle }: { cycle: Cycle }) => {
  const { can, isManager } = usePermissions();
  const allowed = can('performance:read') || isManager;
  const summary = useSummary(cycle._id, allowed);

  if (!allowed || (summary.error instanceof ApiError && summary.error.status === 403)) {
    const counts = cycle.reviewCounts ?? {};
    const total = Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);
    return (
      <Card>
        <CardHeader title="Reviews" description="Detailed analytics require performance read access." />
        <CardBody>{total ? <StatusBreakdown counts={counts} statuses={REVIEW_STATUS} total={total} /> : <p className="text-sm text-muted">No reviews have been generated yet.</p>}</CardBody>
      </Card>
    );
  }
  if (summary.isLoading)
    return (
      <div className="space-y-4" role="status" aria-label="Loading summary">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  if (summary.error || !summary.data) return <ErrorState className="card" message={summary.error?.message} onRetry={() => summary.refetch()} />;
  const s = summary.data;
  const completed = s.reviews.byStatus.COMPLETED ?? 0;

  return (
    <section aria-label="Cycle summary" className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Reviews" value={formatNumber(s.reviews.total)} icon={<Users className="h-5 w-5" />} hint={can('performance:read') ? 'Organization-wide' : 'Your team'} />
        <StatCard label="Completed" value={s.reviews.total ? `${Math.round((completed / s.reviews.total) * 100)}%` : '—'} icon={<ClipboardList className="h-5 w-5" />} tone="green" hint={`${completed} of ${s.reviews.total}`} />
        <StatCard label="Avg final rating" value={s.averageFinalRating ?? '—'} icon={<Star className="h-5 w-5" />} tone="amber" hint={s.cycle ? `Scale ${s.cycle.ratingScale.min}–${s.cycle.ratingScale.max}` : undefined} />
        <StatCard label="Avg goal progress" value={`${formatNumber(s.goals.averageProgress, 1)}%`} icon={<Target className="h-5 w-5" />} tone="blue" hint={`${s.goals.total} active goals`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Final rating distribution" description="Completed reviews, rounded to the nearest scale point." />
          <CardBody>
            <RatingDistribution data={s.ratingDistribution} />
          </CardBody>
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Reviews by status" />
            <CardBody>{s.reviews.total ? <StatusBreakdown counts={s.reviews.byStatus} statuses={REVIEW_STATUS} total={s.reviews.total} /> : <p className="text-sm text-muted">No reviews yet.</p>}</CardBody>
          </Card>
          <Card>
            <CardHeader title="Goals by status" />
            <CardBody>
              {Object.values(s.goals.byStatus).some(Boolean) ? (
                <StatusBreakdown counts={s.goals.byStatus} statuses={['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']} total={Object.values(s.goals.byStatus).reduce((a, n) => a + (n ?? 0), 0)} />
              ) : (
                <p className="text-sm text-muted">No goals in this cycle yet.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </section>
  );
};

/* ------------------------------ Detail ------------------------------ */

export const CycleDetailPage = () => {
  const { id } = useParams();
  const cycle = useCycle(id);
  const navigate = useNavigate();
  const { can, canAny } = usePermissions();
  const confirm = useConfirm();
  const advance = useAdvanceCycle();
  const generate = useGenerateReviews();
  const remove = useDeleteCycle();
  const [editing, setEditing] = useState(false);

  if (cycle.isLoading) return <PageSkeleton />;
  if (cycle.error instanceof ApiError && cycle.error.status === 404) {
    return <EmptyState className="card" title="Cycle not found" description={cycle.error.message} action={<Button onClick={() => navigate('/performance/cycles')}>Back to cycles</Button>} />;
  }
  if (cycle.error || !cycle.data) return <ErrorState className="card" message={cycle.error?.message} onRetry={() => cycle.refetch()} />;
  const c = cycle.data;
  const next = PERFORMANCE_CYCLE_WORKFLOW.next(c.status)[0];
  const canAdvance = canAny('performance:create', 'performance:review') && !!next;
  const canEdit = can('performance:create') && c.status !== 'COMPLETED';
  const canGenerate = canAny('performance:create', 'performance:review') && REVIEW_STAGES.includes(c.status);
  const pending = Object.entries(c.reviewCounts ?? {}).reduce((s, [k, n]) => (k === 'COMPLETED' ? s : s + (n ?? 0)), 0);

  const onAdvance = async () => {
    if (!next) return;
    const { confirmed } = await confirm({
      title: `Move to ${label(next).toLowerCase()}?`,
      message: (
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2">
            <StatusBadge status={c.status} /> <ArrowRight className="h-4 w-4 text-muted" aria-hidden /> <StatusBadge status={next} />
          </p>
          <p>{ADVANCE_COPY[next]}</p>
          {next === 'COMPLETED' && pending > 0 && (
            <p className="font-medium text-amber-700 dark:text-amber-300">
              {pending} review{pending === 1 ? ' is' : 's are'} not completed yet.
            </p>
          )}
        </div>
      ),
      confirmLabel: `Move to ${label(next).toLowerCase()}`,
      tone: next === 'COMPLETED' ? 'danger' : 'primary',
    });
    if (!confirmed) return;
    const res = await advance.mutateAsync({ id: c._id, status: next }).catch(() => null); // errors are toasted globally
    if (!res) return;
    toast.success(res.data.reviewsCreated !== undefined ? `Cycle advanced · ${res.data.reviewsCreated} review${res.data.reviewsCreated === 1 ? '' : 's'} created` : (res.message ?? 'Cycle advanced'));
  };

  const onGenerate = async () => {
    const { confirmed } = await confirm({
      title: 'Generate missing reviews?',
      message: 'Creates reviews for active employees in scope who do not have one yet (for example new joiners). Existing reviews are not changed.',
      confirmLabel: 'Generate reviews',
      tone: 'primary',
    });
    if (!confirmed) return;
    const res = await generate.mutateAsync(c._id).catch(() => null);
    if (!res) return;
    toast.success(res.data.created ? `${res.data.created} review${res.data.created === 1 ? '' : 's'} created (${res.data.total} employees in scope)` : 'Everyone in scope already has a review');
  };

  const onDelete = async () => {
    const { confirmed } = await confirm({ title: `Delete ${c.name}?`, message: 'The draft cycle will be removed. This cannot be undone.', confirmLabel: 'Delete cycle' });
    if (!confirmed) return;
    const ok = await remove.mutateAsync(c._id).then(() => true).catch(() => false);
    if (!ok) return;
    toast.success('Cycle deleted');
    navigate('/performance/cycles');
  };

  const stageIndex = CYCLE_STATUS.indexOf(c.status);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Cycles', to: '/performance/cycles' }, { label: c.name }]}
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {formatDate(c.startDate)} – {formatDate(c.endDate)}
            <StatusBadge status={c.status} />
          </span>
        }
        actions={
          <>
            {can('performance:read') && (
              <Button variant="outline" icon={<ClipboardList className="h-4 w-4" />} onClick={() => navigate(`/performance/reviews?tab=all&cycleId=${c._id}`)}>
                Reviews
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {canGenerate && (
              <Button variant="outline" icon={<RefreshCcw className="h-4 w-4" />} onClick={onGenerate} loading={generate.isPending}>
                Generate reviews
              </Button>
            )}
            {c.status === 'DRAFT' && can('performance:create') && (
              <Button variant="outline" icon={<Trash2 className="h-4 w-4" />} onClick={onDelete} loading={remove.isPending}>
                Delete
              </Button>
            )}
            {canAdvance && next && (
              <Button icon={<ArrowRight className="h-4 w-4" />} onClick={onAdvance} loading={advance.isPending}>
                Move to {label(next).toLowerCase()}
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardBody className="overflow-x-auto">
            <Stepper steps={CYCLE_STATUS.map((s) => ({ key: s, label: label(s) }))} current={c.status === 'COMPLETED' ? CYCLE_STATUS.length : stageIndex} label="Cycle stages" />
          </CardBody>
        </Card>

        <CycleSummary cycle={c} />

        <Card>
          <CardHeader title="Configuration" />
          <CardBody className="space-y-6">
            {c.description && <p className="text-sm whitespace-pre-line text-fg-2">{c.description}</p>}
            <DescriptionList
              columns={3}
              items={[
                { label: 'Self review due', value: c.selfReviewDue ? formatDate(c.selfReviewDue) : null },
                { label: 'Manager review due', value: c.managerReviewDue ? formatDate(c.managerReviewDue) : null },
                { label: 'Goal weightage', value: `${c.goalWeightage}% goals · ${100 - c.goalWeightage}% overall` },
                { label: 'Departments', value: departmentsLabel(c) },
                {
                  label: 'Competencies',
                  value: c.competencies.length ? (
                    <span className="flex flex-wrap gap-1.5">
                      {c.competencies.map((x) => (
                        <Badge key={x}>{x}</Badge>
                      ))}
                    </span>
                  ) : null,
                },
                {
                  label: `Rating scale (${c.ratingScale.min}–${c.ratingScale.max})`,
                  value: c.ratingScale.labels.length ? (
                    <ul className="space-y-0.5">
                      {c.ratingScale.labels.map((l) => (
                        <li key={l.value}>
                          <span className="font-semibold tabular-nums">{l.value}</span> · {l.label}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    'No labels'
                  ),
                },
              ]}
            />
          </CardBody>
        </Card>
      </div>
      <CycleFormDrawer open={editing} cycle={c} onClose={() => setEditing(false)} />
    </>
  );
};
