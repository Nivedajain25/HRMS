import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { CalendarClock, CheckCircle2, ExternalLink, MapPin, MessageSquarePlus, Pencil, UserX, Video, XCircle } from 'lucide-react';
import { INTERVIEW_TYPES, interviewFeedbackSchema, interviewSchema } from '@stencil/shared';
import { Combobox, EmployeePicker, type ComboOption } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { applyServerErrors, errorAt, FormError, FormField, FormGrid } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, DescriptionList, ErrorState, Skeleton, type Tone } from '@/components/ui/display';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Drawer, Modal, useConfirm } from '@/components/ui/overlay';
import { getPaged, toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { formatDateTime, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import {
  useInterview,
  useInterviewFeedback,
  useInterviewStatus,
  useSaveInterview,
  type CandidateSummary,
  type Interview,
  type Recommendation,
} from '../api';
import { CLOSED_STAGES, interviewWhen, RatingStars, RatingInput, todayInTz, zonedParts } from './shared';

/* -------------------------------- Helpers ------------------------------- */

export const interviewCandidate = (i: Interview) => (typeof i.candidateId === 'object' && i.candidateId ? i.candidateId : null);
export const interviewCandidateId = (i: Interview) => (typeof i.candidateId === 'string' ? i.candidateId : (i.candidateId?._id ?? ''));
export const interviewJob = (i: Interview) => (typeof i.jobId === 'object' && i.jobId ? i.jobId : null);

export const RECOMMENDATIONS: { value: Recommendation; label: string; tone: Tone }[] = [
  { value: 'STRONG_HIRE', label: 'Strong hire', tone: 'green' },
  { value: 'HIRE', label: 'Hire', tone: 'teal' },
  { value: 'NO_HIRE', label: 'No hire', tone: 'amber' },
  { value: 'STRONG_NO_HIRE', label: 'Strong no hire', tone: 'red' },
];

export const RecommendationBadge = ({ value }: { value?: Recommendation }) => {
  const rec = RECOMMENDATIONS.find((r) => r.value === value);
  return rec ? <Badge tone={rec.tone}>{rec.label}</Badge> : null;
};

const useOrgTz = () => usePermissions().user?.organization.timezone ?? 'UTC';

/** What the current user may do with an interview. */
export const useInterviewAbilities = (interview: Interview | undefined) => {
  const { can, user } = usePermissions();
  const canManage = can('recruitment:update');
  if (!interview || !user) return { canManage, isInterviewer: false, submitted: false, canFeedback: false, scheduled: false };
  const reviewerId = user.employeeId ?? user._id;
  const isInterviewer = !!user.employeeId && interview.interviewerIds.some((p) => p._id === user.employeeId);
  const submitted = interview.feedback.some((f) => String(f.interviewerId) === reviewerId);
  const open = interview.status === 'SCHEDULED' || interview.status === 'COMPLETED';
  return { canManage, isInterviewer, submitted, canFeedback: open && !submitted && (isInterviewer || canManage), scheduled: interview.status === 'SCHEDULED' };
};

/** Complete / no-show / cancel with confirmations. */
export const useInterviewActions = () => {
  const confirm = useConfirm();
  const status = useInterviewStatus();
  /** Runs the status change; failures are toasted globally by the mutation cache. */
  const run = async (input: Parameters<typeof status.mutateAsync>[0], success: string) => {
    try {
      await status.mutateAsync(input);
      toast.success(success);
    } catch {
      /* toasted globally */
    }
  };
  const complete = async (i: Interview) => {
    const { confirmed } = await confirm({ title: 'Mark interview as completed?', message: 'Interviewers can still submit feedback afterwards.', confirmLabel: 'Mark completed', tone: 'primary' });
    if (confirmed) await run({ id: i._id, status: 'COMPLETED' }, 'Interview marked completed');
  };
  const noShow = async (i: Interview) => {
    const c = interviewCandidate(i);
    const { confirmed } = await confirm({ title: 'Mark as no-show?', message: `${c ? fullName(c) : 'The candidate'} did not attend. This cannot be undone.`, confirmLabel: 'Mark no-show' });
    if (confirmed) await run({ id: i._id, status: 'NO_SHOW' }, 'Interview marked as no-show');
  };
  const cancel = async (i: Interview) => {
    const res = await confirm({
      title: 'Cancel this interview?',
      message: 'Interviewers are notified. A cancelled interview cannot be reopened — schedule a new one if needed.',
      confirmLabel: 'Cancel interview',
      requireReason: true,
      reasonLabel: 'Cancellation reason',
    });
    if (res.confirmed) await run({ id: i._id, status: 'CANCELLED', reason: res.reason }, 'Interview cancelled');
  };
  return { complete, noShow, cancel, pending: status.isPending };
};

/* ---------------------------- Schedule dialog --------------------------- */

type ScheduleIn = z.input<typeof interviewSchema>;
type ScheduleOut = z.output<typeof interviewSchema>;

const loadCandidateOptions = async (search: string): Promise<ComboOption[]> => {
  const res = await getPaged<CandidateSummary>('/recruitment/candidates', { search: search || undefined, limit: 30, sortBy: 'createdAt', sortOrder: 'desc' });
  return res.data
    .filter((c) => !CLOSED_STAGES.includes(c.stage))
    .map((c) => ({ value: c._id, label: `${c.firstName} ${c.lastName}`, description: [c.jobId?.title, label(c.stage)].filter(Boolean).join(' · ') }));
};

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];
export const durationLabel = (d: number) => (d < 60 ? `${d} min` : `${Math.floor(d / 60)} h${d % 60 ? ` ${d % 60} min` : ''}`);

/**
 * Schedule a new interview, or reschedule/edit an existing one. Date and time
 * are entered in the organization timezone.
 */
export const InterviewFormModal = ({
  open,
  onClose,
  interview,
  candidate,
}: {
  open: boolean;
  onClose: () => void;
  interview?: Interview;
  /** Fixes the candidate (e.g. from the candidate profile). */
  candidate?: { _id: string; name: string };
}) => {
  const editing = !!interview;
  const tz = useOrgTz();
  const save = useSaveInterview(interview?._id);
  const [serverError, setServerError] = useState<string | null>(null);

  const defaults = (): ScheduleIn => {
    if (interview) {
      const { date, time } = zonedParts(interview.scheduledAt, tz);
      return {
        candidateId: interviewCandidateId(interview),
        interviewerIds: interview.interviewerIds.map((p) => p._id),
        date,
        startTime: time,
        durationMinutes: interview.durationMinutes ?? 60,
        type: interview.type as ScheduleOut['type'],
        round: interview.round ?? 1,
        meetingLink: interview.meetingLink ?? '',
        location: interview.location ?? '',
        notes: interview.notes ?? '',
      };
    }
    return { candidateId: candidate?._id ?? '', interviewerIds: [], date: todayInTz(tz), startTime: '10:00', durationMinutes: 60, type: 'VIDEO', round: 1, meetingLink: '', location: '', notes: '' };
  };

  const { register, handleSubmit, control, formState, reset, setError, watch } = useForm<ScheduleIn, unknown, ScheduleOut>({ resolver: zodResolver(interviewSchema), defaultValues: defaults() });
  const errors = formState.errors;
  const type = watch('type');

  useEffect(() => {
    if (open) {
      reset(defaults());
      setServerError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, interview?._id, candidate?._id]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const payload: Partial<ScheduleOut> = { ...values };
    for (const key of ['meetingLink', 'location', 'notes'] as const) if (!payload[key]) delete payload[key];
    if (editing) delete payload.candidateId;
    try {
      const res = await save.mutateAsync(payload as ScheduleOut);
      toast.success(res.message ?? (editing ? 'Interview updated' : 'Interview scheduled'));
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError));
    }
  });

  const fixedCandidateName = interview ? fullName(interviewCandidate(interview)) : candidate?.name;
  const interviewerLabels = Object.fromEntries((interview?.interviewerIds ?? []).map((p) => [p._id, fullName(p)]));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? 'Reschedule interview' : 'Schedule interview'}
      description={`${fixedCandidateName ? `${fixedCandidateName} · ` : ''}Times are in ${tz}. The candidate and interviewers are notified.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            {editing ? 'Save changes' : 'Schedule'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError error={serverError} />
        {!fixedCandidateName && (
          <FormField label="Candidate" required error={errors.candidateId}>
            {({ id, invalid }) => (
              <Controller
                control={control}
                name="candidateId"
                render={({ field }) => (
                  <Combobox id={id} invalid={invalid} placeholder="Search candidates…" value={field.value} onChange={(v) => field.onChange(typeof v === 'string' ? v : '')} loadOptions={loadCandidateOptions} />
                )}
              />
            )}
          </FormField>
        )}
        <FormField label="Interviewers" required error={errorAt(errors, 'interviewerIds')}>
          {({ id, invalid }) => (
            <Controller
              control={control}
              name="interviewerIds"
              render={({ field }) => (
                <EmployeePicker
                  id={id}
                  multiple
                  invalid={invalid}
                  placeholder="Select interviewers…"
                  value={field.value}
                  onChange={(v) => field.onChange(Array.isArray(v) ? v : v ? [v] : [])}
                  selectedLabels={interviewerLabels}
                />
              )}
            />
          )}
        </FormField>
        <FormGrid cols={3}>
          <FormField label="Date" required error={errors.date}>
            {({ id, invalid }) => <Input id={id} type="date" min={editing ? undefined : todayInTz(tz)} aria-invalid={invalid} {...register('date')} />}
          </FormField>
          <FormField label="Start time" required error={errors.startTime}>
            {({ id, invalid }) => <Input id={id} type="time" aria-invalid={invalid} {...register('startTime')} />}
          </FormField>
          <FormField label="Duration" error={errors.durationMinutes}>
            {({ id }) => <Select id={id} options={DURATIONS.map((d) => ({ value: String(d), label: durationLabel(d) }))} {...register('durationMinutes')} />}
          </FormField>
          <FormField label="Type" error={errors.type}>
            {({ id }) => <Select id={id} options={INTERVIEW_TYPES.map((t) => ({ value: t, label: label(t) }))} {...register('type')} />}
          </FormField>
          <FormField label="Round" error={errors.round}>
            {({ id, invalid }) => <Input id={id} type="number" min={1} max={20} aria-invalid={invalid} {...register('round')} />}
          </FormField>
        </FormGrid>
        <FormGrid>
          <FormField label="Meeting link" error={errors.meetingLink} hint={type === 'VIDEO' ? 'Shared with the candidate and interviewers.' : undefined}>
            {({ id, invalid }) => <Input id={id} type="url" placeholder="https://" aria-invalid={invalid} {...register('meetingLink')} />}
          </FormField>
          <FormField label="Location" error={errors.location}>
            {({ id, invalid }) => <Input id={id} placeholder={type === 'ONSITE' ? 'Office, room' : 'Optional'} aria-invalid={invalid} {...register('location')} />}
          </FormField>
        </FormGrid>
        <FormField label="Notes for interviewers" error={errors.notes}>
          {({ id, invalid }) => <Textarea id={id} rows={3} aria-invalid={invalid} {...register('notes')} />}
        </FormField>
      </form>
    </Modal>
  );
};

/* ---------------------------- Feedback dialog --------------------------- */

type FeedbackIn = z.input<typeof interviewFeedbackSchema>;
type FeedbackOut = z.output<typeof interviewFeedbackSchema>;

export const FeedbackModal = ({ open, onClose, interview }: { open: boolean; onClose: () => void; interview: Interview }) => {
  const submit = useInterviewFeedback(interview._id);
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, control, formState, reset, setError } = useForm<FeedbackIn, unknown, FeedbackOut>({
    resolver: zodResolver(interviewFeedbackSchema),
    defaultValues: { rating: undefined, recommendation: undefined, feedback: '' },
  });
  const errors = formState.errors;
  const c = interviewCandidate(interview);

  useEffect(() => {
    if (open) {
      reset({ rating: undefined, recommendation: undefined, feedback: '' });
      setServerError(null);
    }
  }, [open, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await submit.mutateAsync(values);
      toast.success(res.message ?? 'Feedback submitted');
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Interview feedback"
      description={`${c ? fullName(c) : 'Candidate'} · Round ${interview.round} · ${label(interview.type)}. Feedback can be submitted once and completes the interview.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            Submit feedback
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError error={serverError} />
        <FormField label="Overall rating" required error={errors.rating}>
          {({ id, invalid }) => (
            <Controller control={control} name="rating" render={({ field }) => <RatingInput id={id} invalid={invalid} value={typeof field.value === 'number' ? field.value : undefined} onChange={field.onChange} />} />
          )}
        </FormField>
        <FormField label="Recommendation" required error={errors.recommendation}>
          {({ id, invalid }) => <Select id={id} aria-invalid={invalid} placeholder="Select…" options={RECOMMENDATIONS.map((r) => ({ value: r.value, label: r.label }))} {...register('recommendation')} />}
        </FormField>
        <FormField label="Feedback" required error={errors.feedback} hint="Strengths, concerns and evidence from the interview.">
          {({ id, invalid }) => <Textarea id={id} rows={6} aria-invalid={invalid} {...register('feedback')} />}
        </FormField>
      </form>
    </Modal>
  );
};

/* ----------------------------- Feedback list ---------------------------- */

export const FeedbackList = ({ interview }: { interview: Interview }) => {
  if (!interview.feedback.length) return <p className="text-sm text-muted">No feedback yet.</p>;
  return (
    <ul className="space-y-3">
      {interview.feedback.map((f, idx) => (
        <li key={`${f.interviewerId}-${idx}`} className="rounded-lg border border-line bg-surface-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-fg">{f.interviewerName ?? 'Interviewer'}</span>
            <span className="flex items-center gap-2">
              <RatingStars value={f.rating} />
              <RecommendationBadge value={f.recommendation} />
            </span>
          </div>
          {f.feedback && <p className="mt-2 text-sm whitespace-pre-line text-fg-2">{f.feedback}</p>}
          <p className="mt-1.5 text-xs text-muted">{formatDateTime(f.at)}</p>
        </li>
      ))}
    </ul>
  );
};

/* ----------------------------- Detail drawer ---------------------------- */

export const InterviewDetailDrawer = ({ interviewId, onClose }: { interviewId: string | null; onClose: () => void }) => {
  const query = useInterview(interviewId ?? undefined);
  const i = query.data;
  const tz = useOrgTz();
  const { canManage, canFeedback, submitted, scheduled, isInterviewer } = useInterviewAbilities(i);
  const actions = useInterviewActions();
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const c = i ? interviewCandidate(i) : null;
  const job = i ? interviewJob(i) : null;
  const when = i ? interviewWhen(i.scheduledAt, tz) : null;
  const { canAny, isManager } = usePermissions();
  const canOpenCandidate = canAny('recruitment:read') || isManager;

  return (
    <>
      <Drawer
        open={!!interviewId && !editing && !feedback}
        onClose={onClose}
        title={c ? `Interview with ${fullName(c)}` : 'Interview'}
        description={job ? `${job.title} (${job.code})` : undefined}
        footer={
          i ? (
            <>
              {canManage && scheduled && (
                <>
                  <Button variant="outline" icon={<XCircle className="h-4 w-4" />} onClick={() => actions.cancel(i)} disabled={actions.pending}>
                    Cancel interview
                  </Button>
                  <Button variant="outline" icon={<UserX className="h-4 w-4" />} onClick={() => actions.noShow(i)} disabled={actions.pending}>
                    No-show
                  </Button>
                  <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                    Reschedule
                  </Button>
                  <Button variant="outline" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => actions.complete(i)} disabled={actions.pending}>
                    Complete
                  </Button>
                </>
              )}
              {canFeedback && (
                <Button icon={<MessageSquarePlus className="h-4 w-4" />} onClick={() => setFeedback(true)}>
                  Give feedback
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        {query.isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        ) : query.error || !i || !when ? (
          <ErrorState message={query.error?.message} onRetry={() => query.refetch()} />
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={i.status} />
              <Badge tone="gray">Round {i.round}</Badge>
              <Badge tone="blue">{label(i.type)}</Badge>
              {(i.rescheduleCount ?? 0) > 0 && <Badge tone="amber">Rescheduled {i.rescheduleCount}×</Badge>}
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-2 p-4">
              <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-fg">{when.day}</p>
                <p className="text-sm text-muted">
                  {when.time} · {i.durationMinutes} min <span className="text-xs">({tz})</span>
                </p>
              </div>
            </div>
            <DescriptionList
              items={[
                { label: 'Candidate', value: c ? canOpenCandidate ? <Link className="text-brand-600 hover:underline dark:text-brand-400" to={`/recruitment/candidates/${c._id}`}>{fullName(c)}</Link> : fullName(c) : null },
                { label: 'Candidate stage', value: c ? <StatusBadge status={c.stage} /> : null },
                {
                  label: 'Meeting link',
                  value: i.meetingLink ? (
                    <a href={i.meetingLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400">
                      <Video className="h-4 w-4" /> Join meeting <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null,
                },
                { label: 'Location', value: i.location ? <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4 text-muted" />{i.location}</span> : null },
                { label: 'Average rating', value: <RatingStars value={i.rating} /> },
                ...(i.status === 'CANCELLED' ? [{ label: 'Cancellation reason', value: i.cancellationReason }] : []),
              ]}
            />
            <div>
              <h3 className="mb-2 text-sm font-semibold text-fg">Interviewers</h3>
              <ul className="space-y-2">
                {i.interviewerIds.map((p) => {
                  const done = i.feedback.some((f) => String(f.interviewerId) === p._id);
                  return (
                    <li key={p._id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2">
                        <Avatar name={fullName(p)} src={p.profilePhoto} size="xs" />
                        {fullName(p)}
                      </span>
                      <Badge tone={done ? 'green' : 'gray'}>{done ? 'Feedback in' : 'Awaiting feedback'}</Badge>
                    </li>
                  );
                })}
              </ul>
            </div>
            {i.notes && (
              <div>
                <h3 className="mb-1 text-sm font-semibold text-fg">Notes</h3>
                <p className="text-sm whitespace-pre-line text-fg-2">{i.notes}</p>
              </div>
            )}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-fg">Feedback</h3>
              {submitted && <p className="mb-2 text-xs text-muted">You have submitted feedback for this interview.</p>}
              {!submitted && isInterviewer && i.status === 'SCHEDULED' && <p className="mb-2 text-xs text-muted">Submit your feedback after the interview — it completes the interview.</p>}
              <FeedbackList interview={i} />
            </div>
          </div>
        )}
      </Drawer>
      {i && <InterviewFormModal open={editing} onClose={() => setEditing(false)} interview={i} />}
      {i && <FeedbackModal open={feedback} onClose={() => setFeedback(false)} interview={i} />}
    </>
  );
};
