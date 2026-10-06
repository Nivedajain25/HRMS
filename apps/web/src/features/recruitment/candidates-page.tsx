import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, UserPlus, Users } from 'lucide-react';
import { CANDIDATE_SOURCES, CANDIDATE_STAGES } from '@stencil/shared';
import { FilterBar, SearchInput } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader, PersonCell } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { useListParams } from '@/hooks/use-list-params';
import { ApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { formatDate, formatMoney } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useCandidates, useJobOptions, type CandidateSummary } from './api';
import { CandidateFormDrawer } from './components/candidate-form';
import { RatingStars, SkillChips } from './components/shared';

export const CandidatesPage = () => {
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'createdAt', sortOrder: 'desc' });
  const apiQuery = useMemo(() => {
    const { job, ...rest } = query;
    return { ...rest, jobId: job };
  }, [query]);
  const list = useCandidates(apiQuery);
  const jobs = useJobOptions();
  const { can, user } = usePermissions();
  const currency = user?.organization.currency ?? 'USD';
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const canCreate = can('recruitment:create');
  const filterKeys = ['search', 'job', 'stage', 'source'];

  const columns = useMemo<ColumnDef<CandidateSummary, unknown>[]>(
    () => [
      {
        id: 'firstName',
        header: 'Candidate',
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => <PersonCell name={`${row.original.firstName} ${row.original.lastName}`} subtitle={row.original.email} />,
      },
      {
        id: 'job',
        header: 'Job',
        cell: ({ row }) =>
          row.original.jobId ? (
            <div className="min-w-0">
              <p className="max-w-56 truncate text-fg">{row.original.jobId.title}</p>
              <p className="font-mono text-xs text-muted">{row.original.jobId.code}</p>
            </div>
          ) : (
            '—'
          ),
      },
      { id: 'stage', header: 'Stage', enableSorting: true, cell: ({ row }) => <StatusBadge status={row.original.stage} /> },
      { id: 'source', header: 'Source', cell: ({ row }) => label(row.original.source) },
      { id: 'experienceYears', header: 'Experience', enableSorting: true, cell: ({ row }) => `${row.original.experienceYears} yrs` },
      { id: 'skills', header: 'Skills', cell: ({ row }) => <SkillChips skills={row.original.skills} limit={3} className="max-w-56 flex-nowrap overflow-hidden" /> },
      { id: 'currentCompany', header: 'Current company', cell: ({ row }) => row.original.currentCompany || '—' },
      { id: 'expectedSalary', header: 'Expected salary', cell: ({ row }) => formatMoney(row.original.expectedSalary, currency) },
      { id: 'rating', header: 'Rating', enableSorting: true, cell: ({ row }) => <RatingStars value={row.original.rating} /> },
      { id: 'createdAt', header: 'Applied', enableSorting: true, cell: ({ row }) => formatDate(row.original.createdAt) },
    ],
    [currency],
  );

  const forbidden = list.error instanceof ApiError && list.error.status === 403;

  return (
    <>
      <PageHeader
        title="Candidates"
        description={list.data ? `${list.data.pagination.total} candidate${list.data.pagination.total === 1 ? '' : 's'}` : 'Everyone who applied to your job openings'}
        actions={
          canCreate && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)} className="w-full sm:w-auto">
              Add candidate
            </Button>
          )
        }
      />
      {forbidden ? (
        <EmptyState className="card" icon={<Users className="h-6 w-6" />} title="No candidates to show" description="You will see candidates here once you are the hiring manager of a job opening." />
      ) : (
        <DataTable
          caption="Candidates"
          storageKey="recruitment-candidates"
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
          onRowClick={(c) => navigate(`/recruitment/candidates/${c._id}`)}
          emptyTitle="No candidates found"
          emptyDescription={hasFilters(filterKeys) ? 'Try changing your filters.' : 'Add a candidate to an open job to get started.'}
          emptyAction={
            canCreate && !hasFilters(filterKeys) ? (
              <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                Add candidate
              </Button>
            ) : undefined
          }
          toolbar={
            <FilterBar active={hasFilters(filterKeys)} onClear={() => clear(['sortBy', 'sortOrder'])}>
              <SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder="Search name, email, skills…" />
              <Select
                aria-label="Job"
                className="w-full sm:w-52"
                value={String(params.job ?? '')}
                onChange={(e) => set({ job: e.target.value })}
                options={(jobs.data ?? []).map((j) => ({ value: j._id, label: `${j.title} (${j.code})` }))}
                placeholder="All jobs"
              />
              <Select
                aria-label="Stage"
                className="w-full sm:w-36"
                value={String(params.stage ?? '')}
                onChange={(e) => set({ stage: e.target.value })}
                options={CANDIDATE_STAGES.map((s) => ({ value: s, label: label(s) }))}
                placeholder="All stages"
              />
              <Select
                aria-label="Source"
                className="w-full sm:w-36"
                value={String(params.source ?? '')}
                onChange={(e) => set({ source: e.target.value })}
                options={CANDIDATE_SOURCES.map((s) => ({ value: s, label: label(s) }))}
                placeholder="All sources"
              />
            </FilterBar>
          }
        />
      )}
      <CandidateFormDrawer
        open={creating}
        onClose={(saved) => {
          setCreating(false);
          if (saved) navigate(`/recruitment/candidates/${saved._id}`);
        }}
      />
    </>
  );
};
