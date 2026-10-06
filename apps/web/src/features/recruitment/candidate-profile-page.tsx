import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowRightLeft,
  BadgeCheck,
  Briefcase,
  CalendarClock,
  CalendarPlus,
  ChevronRight,
  FileText,
  Mail,
  Pencil,
  Phone,
  UserRound,
  UserX,
} from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Breadcrumb, Card, CardBody, CardHeader, DescriptionList, EmptyState, ErrorState, PageSkeleton } from '@/components/ui/display';
import { Dropdown, type DropdownItem } from '@/components/ui/overlay';
import { openFile } from '@/lib/api';
import { label } from '@/lib/i18n';
import { cn, formatDate, formatDateTime, formatMoney, fullName, timeAgo } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useCandidate, type CandidateDetail, type Interview } from './api';
import { CandidateFormDrawer } from './components/candidate-form';
import { HireDrawer } from './components/hire-drawer';
import { durationLabel, FeedbackList, FeedbackModal, InterviewFormModal, useInterviewAbilities, useInterviewActions } from './components/interviews';
import { canHireFrom, CLOSED_STAGES, interviewWhen, manualTargets, RatingStars, SkillChips, stageColor, useStageMover } from './components/shared';

const InterviewItem = ({ interview, candidate, tz }: { interview: Interview; candidate: CandidateDetail; tz: string }) => {
  const { canManage, canFeedback, scheduled } = useInterviewAbilities(interview);
  const actions = useInterviewActions();
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const when = interviewWhen(interview.scheduledAt, tz);
  // Candidate-profile interviews are not populated with the candidate; give the dialogs what they need.
  const withCandidate: Interview = { ...interview, candidateId: { _id: candidate._id, firstName: candidate.firstName, lastName: candidate.lastName, email: candidate.email, stage: candidate.stage } };
  const items: DropdownItem[] = [
    { label: 'Reschedule', icon: <Pencil className="h-4 w-4" />, hidden: !canManage || !scheduled, onSelect: () => setEditing(true) },
    { label: 'Mark completed', icon: <BadgeCheck className="h-4 w-4" />, hidden: !canManage || !scheduled, onSelect: () => void actions.complete(withCandidate) },
    { label: 'Mark no-show', icon: <UserX className="h-4 w-4" />, hidden: !canManage || !scheduled, onSelect: () => void actions.noShow(withCandidate) },
    { label: 'Cancel interview', icon: <UserX className="h-4 w-4" />, danger: true, hidden: !canManage || !scheduled, onSelect: () => void actions.cancel(withCandidate) },
  ];

  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-fg">
              Round {interview.round} · {label(interview.type)}
            </p>
            <StatusBadge status={interview.status} />
            {typeof interview.rating === 'number' && <RatingStars value={interview.rating} />}
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            <CalendarClock className="h-4 w-4" aria-hidden />
            {when.day}, {when.time} · {durationLabel(interview.durationMinutes)}
          </p>
          <p className="mt-0.5 text-xs text-muted">With {interview.interviewerIds.map(fullName).join(', ') || '—'}</p>
          {interview.status === 'CANCELLED' && interview.cancellationReason && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Cancelled: {interview.cancellationReason}</p>}
        </div>
        <div className="flex items-center gap-2">
          {canFeedback && (
            <Button size="sm" variant="outline" onClick={() => setFeedback(true)}>
              Give feedback
            </Button>
          )}
          <Link to={`/recruitment/interviews/${interview._id}`} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
            Details
          </Link>
          <Dropdown
            label={`Actions for round ${interview.round}`}
            items={items}
            trigger={
              <span className="inline-flex h-8 items-center rounded-lg border border-line-strong bg-surface px-2 text-xs font-medium text-fg-2 hover:bg-surface-2">Manage</span>
            }
          />
        </div>
      </div>
      {interview.feedback.length > 0 && (
        <div className="mt-3">
          <FeedbackList interview={interview} />
        </div>
      )}
      <InterviewFormModal open={editing} onClose={() => setEditing(false)} interview={withCandidate} />
      <FeedbackModal open={feedback} onClose={() => setFeedback(false)} interview={withCandidate} />
    </li>
  );
};

export const CandidateProfilePage = () => {
  const { id } = useParams();
  const candidate = useCandidate(id);
  const { can, user } = usePermissions();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const { move, pending } = useStageMover();

  if (candidate.isLoading) return <PageSkeleton />;
  if (candidate.error || !candidate.data) return <ErrorState className="card" message={candidate.error?.message} onRetry={() => candidate.refetch()} />;
  const c = candidate.data;
  const name = `${c.firstName} ${c.lastName}`;
  const tz = user?.organization.timezone ?? 'UTC';
  const currency = user?.organization.currency ?? 'USD';
  const canUpdate = can('recruitment:update');
  const canHirePermission = canUpdate && can('employee:create');
  const canHire = canHirePermission && canHireFrom(c.stage) && !c.hiringStartedAt;
  // Stays open after the hire succeeds (stage becomes HIRED) so the success panel remains visible.
  const hiring = params.get('hire') === '1' && canHirePermission;
  const setHiring = (open: boolean) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (open) next.set('hire', '1');
        else next.delete('hire');
        return next;
      },
      { replace: true },
    );
  const closed = CLOSED_STAGES.includes(c.stage);
  const targets = canUpdate ? manualTargets(c.stage) : [];
  const moveItems: DropdownItem[] = [
    ...targets.filter((t) => t !== 'REJECTED').map((t) => ({ label: `Move to ${label(t)}`, icon: <ChevronRight className="h-4 w-4" />, onSelect: () => void move(c, t) })),
    { label: 'Reject…', icon: <UserX className="h-4 w-4" />, danger: true, hidden: !targets.includes('REJECTED'), onSelect: () => void move(c, 'REJECTED') },
  ];
  const ratedInterviews = c.interviews.filter((i) => typeof i.rating === 'number');
  const avgRating = ratedInterviews.length ? ratedInterviews.reduce((s, i) => s + (i.rating ?? 0), 0) / ratedInterviews.length : null;

  const openResume = () => {
    if (!c.resumeFileId) return;
    openFile(`/files/${c.resumeFileId}`).catch(() => toast.error('Could not open the resume'));
  };

  return (
    <>
      <Breadcrumb items={[{ label: 'Candidates', to: '/recruitment/candidates' }, { label: name }]} />
      <div className="card mt-2 mb-6 flex flex-col gap-5 p-5 lg:flex-row lg:items-center">
        <Avatar name={name} size="xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-fg">{name}</h1>
            <StatusBadge status={c.stage} />
            {c.hiringStartedAt && <Badge tone="amber">Hire in progress</Badge>}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
            {c.jobId && (
              <span className="flex items-center gap-1.5">
                <Briefcase className="h-4 w-4" aria-hidden />
                <Link to={`/recruitment/jobs/${c.jobId._id}`} className="hover:text-fg hover:underline">
                  {c.jobId.title}
                </Link>
              </span>
            )}
            <a href={`mailto:${c.email}`} className="flex items-center gap-1.5 hover:text-fg hover:underline">
              <Mail className="h-4 w-4" aria-hidden />
              {c.email}
            </a>
            {c.phone && (
              <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 hover:text-fg hover:underline">
                <Phone className="h-4 w-4" aria-hidden />
                {c.phone}
              </a>
            )}
            <span>Applied {formatDate(c.createdAt)}</span>
          </div>
          <div className="mt-2">
            <RatingStars value={c.rating} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.stage === 'HIRED' && c.hiredEmployeeId && (
            <Link
              to={`/employees/${c.hiredEmployeeId._id}`}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
            >
              <UserRound className="h-4 w-4" /> View employee {c.hiredEmployeeId.employeeId}
            </Link>
          )}
          {canUpdate && (
            <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          {canUpdate && !closed && (
            <Button variant="outline" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setScheduling(true)}>
              Schedule interview
            </Button>
          )}
          {moveItems.some((m) => !m.hidden) && (
            <Dropdown
              label="Move stage"
              items={moveItems}
              trigger={
                <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium text-fg shadow-sm hover:bg-surface-2">
                  <ArrowRightLeft className="h-4 w-4" aria-hidden /> {pending ? 'Moving…' : 'Move stage'}
                </span>
              }
            />
          )}
          {canHire && (
            <Button variant="success" icon={<BadgeCheck className="h-4 w-4" />} onClick={() => setHiring(true)}>
              Hire
            </Button>
          )}
        </div>
      </div>

      {c.stage === 'REJECTED' && c.rejectionReason && (
        <div role="note" className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <span className="font-medium">Rejected:</span> {c.rejectionReason}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Experience', value: `${c.experienceYears} years` },
                  { label: 'Current company', value: c.currentCompany },
                  { label: 'Current salary', value: c.currentSalary !== undefined && c.currentSalary !== null ? formatMoney(c.currentSalary, currency) : null },
                  { label: 'Expected salary', value: c.expectedSalary !== undefined && c.expectedSalary !== null ? formatMoney(c.expectedSalary, currency) : null },
                  { label: 'Notice period', value: c.noticePeriodDays !== undefined && c.noticePeriodDays !== null ? `${c.noticePeriodDays} days` : null },
                  { label: 'Source', value: label(c.source) },
                  { label: 'Skills', value: c.skills.length ? <SkillChips skills={c.skills} /> : null },
                  { label: 'Job code', value: c.jobId ? <span className="font-mono">{c.jobId.code}</span> : null },
                ]}
              />
              {c.notes && (
                <div className="mt-5 border-t border-line pt-4">
                  <p className="text-xs font-medium text-muted">Notes</p>
                  <p className="mt-1 text-sm whitespace-pre-line text-fg">{c.notes}</p>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Interviews"
              description={avgRating !== null ? <span className="inline-flex items-center gap-2">Average rating <RatingStars value={avgRating} /></span> : `${c.interviews.length} scheduled`}
              actions={
                canUpdate && !closed ? (
                  <Button size="sm" variant="outline" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setScheduling(true)}>
                    Schedule
                  </Button>
                ) : undefined
              }
            />
            <CardBody>
              {c.interviews.length === 0 ? (
                <EmptyState
                  className="py-8"
                  icon={<CalendarClock className="h-6 w-6" />}
                  title="No interviews yet"
                  description={closed ? 'This candidate is no longer in the active pipeline.' : 'Schedule an interview to collect structured feedback.'}
                />
              ) : (
                <ul className="divide-y divide-line">
                  {c.interviews.map((i) => (
                    <InterviewItem key={i._id} interview={i} candidate={c} tz={tz} />
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Resume" />
            <CardBody>
              {c.resumeFileId ? (
                <button type="button" onClick={openResume} className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-3 text-left text-sm hover:border-brand-400">
                  <FileText className="h-8 w-8 shrink-0 text-brand-600" aria-hidden />
                  <span>
                    <span className="block font-medium text-fg">Open resume</span>
                    <span className="block text-xs text-muted">Opens in a new tab</span>
                  </span>
                </button>
              ) : (
                <p className="text-sm text-muted">
                  No resume uploaded.{' '}
                  {canUpdate && (
                    <button type="button" className="font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => setEditing(true)}>
                      Upload one
                    </button>
                  )}
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Stage history" />
            <CardBody>
              {c.stageHistory.length === 0 ? (
                <p className="text-sm text-muted">No stage changes recorded.</p>
              ) : (
                <ol className="relative space-y-5 border-l border-line pl-5">
                  {[...c.stageHistory].reverse().map((h, idx) => (
                    <li key={`${h.at}-${idx}`} className="relative">
                      <span className={cn('absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full border-2 border-surface', stageColor(h.to))} aria-hidden />
                      <p className="text-sm text-fg">
                        {h.from ? (
                          <>
                            {label(h.from)} → <span className="font-medium">{label(h.to)}</span>
                          </>
                        ) : (
                          <span className="font-medium">{label(h.to)}</span>
                        )}
                      </p>
                      {h.note && <p className="mt-0.5 text-xs text-fg-2">{h.note}</p>}
                      <p className="mt-0.5 text-xs text-muted" title={formatDateTime(h.at)}>
                        {timeAgo(h.at)}
                        {h.by ? ` · ${fullName(h.by)}` : ''}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <CandidateFormDrawer open={editing} onClose={() => setEditing(false)} candidate={c} />
      <InterviewFormModal open={scheduling} onClose={() => setScheduling(false)} candidate={{ _id: c._id, name }} />
      {canHirePermission && <HireDrawer open={hiring} onClose={() => setHiring(false)} candidateId={c._id} candidateName={name} />}
    </>
  );
};
