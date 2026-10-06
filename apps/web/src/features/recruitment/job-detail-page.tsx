import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Briefcase, Building2, CalendarDays, Info, MapPin, MoreHorizontal, UserPlus, UserRound, Users, Wallet } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Breadcrumb, Card, CardBody, CardHeader, DescriptionList, EmptyState, ErrorState, PageSkeleton, ProgressBar, Skeleton } from '@/components/ui/display';
import { Dropdown, Tabs } from '@/components/ui/overlay';
import { label } from '@/lib/i18n';
import { formatDate, formatDateTime, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useJob, usePipeline, type JobOpening } from './api';
import { CandidateFormDrawer } from './components/candidate-form';
import { JobFormDrawer } from './components/job-form';
import { useJobActions } from './components/job-actions';
import { PipelineBoard } from './components/pipeline-board';
import { BOARD_STAGES, experienceLabel, salaryLabel, SkillChips } from './components/shared';

const PipelineTab = ({ job, onAdd, canAdd }: { job: JobOpening; onAdd: () => void; canAdd: boolean }) => {
  const pipeline = usePipeline(job._id);
  const { can } = usePermissions();

  if (pipeline.isLoading) {
    return (
      <div className="flex gap-3 overflow-hidden" role="status" aria-label="Loading pipeline">
        {BOARD_STAGES.slice(0, 5).map((s) => (
          <Skeleton key={s} className="h-80 w-72 shrink-0 rounded-xl" />
        ))}
      </div>
    );
  }
  if (pipeline.error || !pipeline.data) return <ErrorState className="card" message={pipeline.error?.message} onRetry={() => pipeline.refetch()} />;
  const total = pipeline.data.stages.reduce((n, s) => n + s.count, 0);
  if (!total) {
    return (
      <EmptyState
        className="card"
        icon={<Users className="h-6 w-6" />}
        title="No candidates yet"
        description={job.status === 'OPEN' ? 'Add candidates to start moving them through the pipeline.' : `Candidates can be added once the job is open (currently ${label(job.status).toLowerCase()}).`}
        action={
          canAdd ? (
            <Button icon={<UserPlus className="h-4 w-4" />} onClick={onAdd}>
              Add candidate
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Info className="h-3.5 w-3.5" aria-hidden />
        Use a card's Move button{can('recruitment:update') ? ' or drag it onto a highlighted column' : ''} to change its stage. Hiring is done from the Offered stage.
      </p>
      <PipelineBoard pipeline={pipeline.data} canMove={can('recruitment:update')} canHire={can('recruitment:update') && can('employee:create')} />
    </div>
  );
};

const DetailsTab = ({ job, currency }: { job: JobOpening; currency: string }) => (
  <div className="grid gap-6 lg:grid-cols-3">
    <div className="space-y-6 lg:col-span-2">
      <Card>
        <CardHeader title="Description" />
        <CardBody>
          <p className="text-sm leading-relaxed whitespace-pre-line text-fg-2">{job.description}</p>
        </CardBody>
      </Card>
      {job.requirements && (
        <Card>
          <CardHeader title="Requirements" />
          <CardBody>
            <p className="text-sm leading-relaxed whitespace-pre-line text-fg-2">{job.requirements}</p>
          </CardBody>
        </Card>
      )}
    </div>
    <Card>
      <CardHeader title="Summary" />
      <CardBody>
        <DescriptionList
          columns={1}
          items={[
            { label: 'Code', value: <span className="font-mono">{job.code}</span> },
            { label: 'Employment type', value: label(job.employmentType) },
            { label: 'Experience', value: experienceLabel(job) },
            { label: 'Salary range', value: salaryLabel(job, currency) },
            { label: 'Designation', value: job.designationId?.name },
            { label: 'Skills', value: job.skills.length ? <SkillChips skills={job.skills} /> : null },
            { label: 'Published', value: job.publishedAt ? formatDateTime(job.publishedAt) : null },
            { label: 'Created', value: formatDateTime(job.createdAt) },
          ]}
        />
      </CardBody>
    </Card>
  </div>
);

export const JobDetailPage = () => {
  const { id } = useParams();
  const job = useJob(id);
  const { can, user } = usePermissions();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'pipeline';
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const actions = useJobActions();

  if (job.isLoading) return <PageSkeleton />;
  if (job.error || !job.data) return <ErrorState className="card" message={job.error?.message} onRetry={() => job.refetch()} />;
  const j = job.data;
  const currency = user?.organization.currency ?? 'USD';
  const canAdd = can('recruitment:create') && j.status === 'OPEN';
  const primary = j.status === 'DRAFT' ? { to: 'OPEN' as const, label: 'Publish' } : j.status === 'ON_HOLD' ? { to: 'OPEN' as const, label: 'Resume hiring' } : null;
  const salary = salaryLabel(j, currency);
  const menu = actions.menuItems(j, () => setEditing(true), () => navigate('/recruitment/jobs')).filter((m) => !primary || m.label !== primary.label);

  return (
    <>
      <Breadcrumb items={[{ label: 'Jobs', to: '/recruitment/jobs' }, { label: j.title }]} />
      <div className="card mt-2 mb-6 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{j.title}</h1>
              <StatusBadge status={j.status} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted">
              <span className="font-mono text-xs leading-5">{j.code}</span>
              {j.departmentId && (
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-4 w-4" aria-hidden />
                  {j.departmentId.name}
                </span>
              )}
              {j.locationId && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" aria-hidden />
                  {j.locationId.name}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Briefcase className="h-4 w-4" aria-hidden />
                {label(j.employmentType)} · {experienceLabel(j)}
              </span>
              {salary && (
                <span className="flex items-center gap-1.5">
                  <Wallet className="h-4 w-4" aria-hidden />
                  {salary}
                </span>
              )}
              {j.hiringManagerId && (
                <span className="flex items-center gap-1.5">
                  <UserRound className="h-4 w-4" aria-hidden />
                  {can('employee:read') ? (
                    <Link className="hover:text-fg hover:underline" to={`/employees/${j.hiringManagerId._id}`}>
                      {fullName(j.hiringManagerId)}
                    </Link>
                  ) : (
                    fullName(j.hiringManagerId)
                  )}
                </span>
              )}
              {j.closingDate && (
                <span className="flex items-center gap-1.5">
                  <CalendarDays className="h-4 w-4" aria-hidden />
                  Closes {formatDate(j.closingDate)}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canAdd && (
              <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>
                Add candidate
              </Button>
            )}
            {primary && actions.canUpdate && (
              <Button variant="outline" onClick={() => void actions.changeStatus(j, primary.to)} loading={actions.pending}>
                {primary.label}
              </Button>
            )}
            {actions.canUpdate && (
              <Dropdown
                label="More job actions"
                items={menu}
                trigger={
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong bg-surface text-fg-2 shadow-sm hover:bg-surface-2">
                    <MoreHorizontal className="h-4 w-4" />
                  </span>
                }
              />
            )}
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium text-muted">Positions filled</p>
            <p className="mt-1 text-sm font-semibold text-fg tabular-nums">
              {j.filled} of {j.openings}
            </p>
            <ProgressBar className="mt-1.5" tone="green" value={j.openings ? (j.filled / j.openings) * 100 : 0} />
          </div>
          <div>
            <p className="text-xs font-medium text-muted">Candidates</p>
            <p className="mt-1 text-sm font-semibold text-fg tabular-nums">{j.candidateTotal}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted">In interviews</p>
            <p className="mt-1 text-sm font-semibold text-fg tabular-nums">{(j.candidateCounts.INTERVIEW ?? 0) + (j.candidateCounts.ASSESSMENT ?? 0)}</p>
          </div>
        </div>
      </div>

      <Tabs
        className="mb-5"
        tabs={[
          { key: 'pipeline', label: 'Pipeline', count: j.candidateTotal },
          { key: 'details', label: 'Job details' },
        ]}
        active={tab}
        onChange={(key) => setParams({ tab: key }, { replace: true })}
      />
      <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'details' ? <DetailsTab job={j} currency={currency} /> : <PipelineTab job={j} canAdd={canAdd} onAdd={() => setAdding(true)} />}
      </div>

      <JobFormDrawer open={editing} onClose={() => setEditing(false)} job={j} />
      <CandidateFormDrawer open={adding} onClose={() => setAdding(false)} jobId={j._id} jobTitle={j.title} />
    </>
  );
};
