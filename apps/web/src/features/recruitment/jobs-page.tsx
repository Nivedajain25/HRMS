import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { BriefcaseBusiness, MoreHorizontal, Plus } from 'lucide-react';
import { JOB_STATUS } from '@stencil/shared';
import { FilterBar, SearchInput } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { Dropdown } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { ApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { cn, formatDate, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { toOptions, useAllOf } from '@/features/employees/api';
import { useJobs, type JobOpening } from './api';
import { JobFormDrawer } from './components/job-form';
import { useJobActions } from './components/job-actions';
import { RecruitmentSummaryStrip } from './components/recruitment-summary';
import { experienceLabel, STAGES, stageColor } from './components/shared';

/** Segmented bar of a job's candidates per stage. */
const StageBar = ({ job }: { job: JobOpening }) => {
  const total = job.candidateTotal;
  if (!total) return <span className="text-xs text-muted">No candidates</span>;
  const parts = STAGES.map((s) => ({ stage: s, count: job.candidateCounts[s] ?? 0 })).filter((p) => p.count > 0);
  const summary = parts.map((p) => `${label(p.stage)} ${p.count}`).join(', ');
  return (
    <div className="w-40" title={summary}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-fg">{total} total</span>
        <span className="text-muted">{job.candidateCounts.HIRED ?? 0} hired</span>
      </div>
      <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={summary}>
        {parts.map((p) => (
          <span key={p.stage} className={cn('h-full', stageColor(p.stage))} style={{ width: `${(p.count / total) * 100}%` }} />
        ))}
      </div>
    </div>
  );
};

export const JobsPage = () => {
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'createdAt', sortOrder: 'desc' });
  const apiQuery = useMemo(() => {
    const { department, ...rest } = query;
    return { ...rest, departmentId: department };
  }, [query]);
  const list = useJobs(apiQuery);
  const departments = useAllOf('departments');
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<JobOpening | undefined>();
  const actions = useJobActions();
  const canCreate = can('recruitment:create');
  const filterKeys = ['search', 'status', 'department'];

  const columns = useMemo<ColumnDef<JobOpening, unknown>[]>(
    () => [
      {
        id: 'title',
        header: 'Job',
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="max-w-64 truncate font-medium text-fg">{row.original.title}</p>
            <p className="text-xs text-muted">
              <span className="font-mono">{row.original.code}</span>
              {row.original.departmentId ? ` · ${row.original.departmentId.name}` : ''}
            </p>
          </div>
        ),
      },
      { id: 'location', header: 'Location', cell: ({ row }) => row.original.locationId?.name ?? '—' },
      { id: 'type', header: 'Type', cell: ({ row }) => label(row.original.employmentType) },
      { id: 'experience', header: 'Experience', cell: ({ row }) => experienceLabel(row.original) },
      { id: 'manager', header: 'Hiring manager', cell: ({ row }) => (row.original.hiringManagerId ? fullName(row.original.hiringManagerId) : '—') },
      {
        id: 'openings',
        header: 'Filled',
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.filled}/{row.original.openings}
          </span>
        ),
      },
      { id: 'pipeline', header: 'Candidates', cell: ({ row }) => <StageBar job={row.original} /> },
      { id: 'closingDate', header: 'Closes', enableSorting: true, cell: ({ row }) => (row.original.closingDate ? formatDate(row.original.closingDate) : '—') },
      { id: 'status', header: 'Status', enableSorting: true, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        enableHiding: false,
        cell: ({ row }) =>
          actions.canUpdate ? (
            <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="flex justify-end">
              <Dropdown
                label={`Actions for ${row.original.title}`}
                items={actions.menuItems(row.original, () => setEditing(row.original))}
                trigger={
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-fg">
                    <MoreHorizontal className="h-4 w-4" />
                  </span>
                }
              />
            </div>
          ) : null,
      },
    ],
    [actions],
  );

  const forbidden = list.error instanceof ApiError && list.error.status === 403;

  return (
    <>
      <PageHeader
        title="Job openings"
        description={list.data ? `${list.data.pagination.total} job${list.data.pagination.total === 1 ? '' : 's'}` : 'Open roles and their hiring pipelines'}
        actions={
          canCreate && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)} className="w-full sm:w-auto">
              New job
            </Button>
          )
        }
      />
      {can('recruitment:read') && <RecruitmentSummaryStrip />}
      {forbidden ? (
        <EmptyState
          className="card"
          icon={<BriefcaseBusiness className="h-6 w-6" />}
          title="No jobs assigned to you"
          description="You will see job openings here once you are made the hiring manager of one."
        />
      ) : (
        <DataTable
          caption="Job openings"
          storageKey="recruitment-jobs"
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
          onRowClick={(job) => navigate(`/recruitment/jobs/${job._id}`)}
          emptyTitle="No job openings found"
          emptyDescription={hasFilters(filterKeys) ? 'Try changing your filters.' : 'Create a job opening to start building a pipeline.'}
          emptyAction={
            canCreate && !hasFilters(filterKeys) ? (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                New job
              </Button>
            ) : undefined
          }
          toolbar={
            <FilterBar active={hasFilters(filterKeys)} onClear={() => clear(['sortBy', 'sortOrder'])}>
              <SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder="Search title, code, skills…" />
              <Select
                aria-label="Status"
                className="w-full sm:w-36"
                value={String(params.status ?? '')}
                onChange={(e) => set({ status: e.target.value })}
                options={JOB_STATUS.map((s) => ({ value: s, label: label(s) }))}
                placeholder="All statuses"
              />
              <Select
                aria-label="Department"
                className="w-full sm:w-44"
                value={String(params.department ?? '')}
                onChange={(e) => set({ department: e.target.value })}
                options={toOptions(departments.data)}
                placeholder="All departments"
              />
            </FilterBar>
          }
        />
      )}
      <JobFormDrawer
        open={creating || !!editing}
        job={editing}
        onClose={(saved) => {
          const wasCreating = creating;
          setCreating(false);
          setEditing(undefined);
          if (saved && wasCreating) navigate(`/recruitment/jobs/${saved._id}`);
        }}
      />
    </>
  );
};
