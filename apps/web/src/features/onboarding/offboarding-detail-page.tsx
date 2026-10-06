import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, Ban, Briefcase, Building2, CalendarClock, CheckCircle2, ShieldOff, Undo2, UserRound, XCircle } from 'lucide-react';
import { offboardingAdvanceSchema, type OffboardingStatus } from '@stencil/shared';
import { StatusBadge } from '@/components/common/status-badge';
import { FormError } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Avatar, Card, CardBody, CardHeader, DescriptionList, ErrorState, PageHeader, PageSkeleton } from '@/components/ui/display';
import { Textarea } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/overlay';
import { toApiError, type ApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { cn, formatDate, formatDateTime, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useAdvanceOffboarding, useCancelOffboarding, useOffboarding, type OffboardingAdvanceInput, type OffboardingDetail } from './api';
import { daysUntil, ExitTypeBadge, monthLabel } from './components/lifecycle-ui';
import { AssetReturnPanel, ClearancePanel, ExitInterviewPanel, FinalPayrollPanel, type ClearanceDraft, type ExitInterviewDraft } from './components/offboarding-panels';
import { OffboardingStepper } from './components/offboarding-stepper';

const STEP_COPY: Record<OffboardingStatus, { title: string; description: string }> = {
  EXIT_REQUEST: { title: 'Exit request', description: 'Review the request. Advancing confirms the exit and starts the notice period.' },
  NOTICE_PERIOD: { title: 'Notice period', description: 'The employee is serving notice. Advance when the notice period is served or waived.' },
  ASSET_RETURN: { title: 'Asset return', description: 'Every asset assigned to the employee must be returned before clearance.' },
  CLEARANCE: { title: 'Departmental clearance', description: 'Each department confirms there is nothing outstanding.' },
  FINAL_PAYROLL: { title: 'Final payroll', description: 'Settle the final pay (salary, leave encashment and recoveries).' },
  EXIT_INTERVIEW: { title: 'Exit interview', description: 'Capture feedback from the departing employee.' },
  DEACTIVATION: { title: 'Account deactivation', description: 'Completing the exit deactivates the employee’s account.' },
  COMPLETED: { title: 'Exit completed', description: 'The employee has exited the organization.' },
  CANCELLED: { title: 'Offboarding cancelled', description: 'This exit was cancelled and the employee’s previous status restored.' },
};

const GATE_TITLES: Record<string, string> = {
  ASSETS_NOT_RETURNED: 'Assets are still assigned',
  CLEARANCE_PENDING: 'Clearance is incomplete',
  FINAL_PAYROLL_PENDING: 'Final payroll not processed',
  HAS_REPORTS: 'Direct reports need a new manager',
  INVALID_TRANSITION: 'This step can’t be advanced',
};

const toClearanceDraft = (o: OffboardingDetail): ClearanceDraft[] => o.clearance.map((c) => ({ department: c.department, cleared: !!c.cleared, note: c.note ?? '' }));
const toInterviewDraft = (o: OffboardingDetail): ExitInterviewDraft => ({
  reasonForLeaving: o.exitInterview?.reasonForLeaving ?? '',
  rating: o.exitInterview?.rating ?? undefined,
  wouldRecommend: o.exitInterview?.wouldRecommend ?? undefined,
  feedback: o.exitInterview?.feedback ?? '',
});

const Notice = ({ tone, icon, children }: { tone: 'info' | 'warn' | 'danger' | 'success'; icon: ReactNode; children: ReactNode }) => (
  <div
    className={cn(
      'flex items-start gap-3 rounded-lg border px-4 py-3 text-sm',
      tone === 'info' && 'border-line bg-surface-2 text-fg-2',
      tone === 'warn' && 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
      tone === 'danger' && 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200',
      tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
    )}
  >
    <span className="mt-0.5 shrink-0">{icon}</span>
    <div className="min-w-0">{children}</div>
  </div>
);

const StepPanel = ({ o, canProcess }: { o: OffboardingDetail; canProcess: boolean }) => {
  const advance = useAdvanceOffboarding(o._id);
  const confirm = useConfirm();
  const [clearance, setClearance] = useState<ClearanceDraft[]>(() => toClearanceDraft(o));
  const [interview, setInterview] = useState<ExitInterviewDraft>(() => toInterviewDraft(o));
  const [payrollId, setPayrollId] = useState('');
  const [note, setNote] = useState('');
  const [gateError, setGateError] = useState<ApiError | null>(null);

  // Reset drafts whenever the workflow moves to another step.
  useEffect(() => {
    setClearance(toClearanceDraft(o));
    setInterview(toInterviewDraft(o));
    setPayrollId(o.finalPayrollId && typeof o.finalPayrollId === 'object' ? o.finalPayrollId._id : '');
    setNote('');
    setGateError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o._id, o.status]);

  const step = o.status;
  const copy = STEP_COPY[step];
  const next = o.nextStatus;
  const employeeName = o.employeeId ? fullName(o.employeeId) : 'the employee';
  const lwdDays = daysUntil(o.lastWorkingDate);

  const onAdvance = async () => {
    if (!next) return;
    setGateError(null);
    const payload: OffboardingAdvanceInput = { note: note.trim() || undefined };
    if (step === 'CLEARANCE') payload.clearance = clearance.map((c) => ({ department: c.department, cleared: c.cleared, note: c.note.trim() || undefined }));
    if (step === 'FINAL_PAYROLL' && payrollId) payload.finalPayrollId = payrollId;
    if (step === 'EXIT_INTERVIEW') {
      const filled = interview.reasonForLeaving.trim() || interview.feedback.trim() || interview.rating !== undefined || interview.wouldRecommend !== undefined;
      if (filled) {
        payload.exitInterview = {
          reasonForLeaving: interview.reasonForLeaving.trim() || undefined,
          rating: interview.rating,
          wouldRecommend: interview.wouldRecommend,
          feedback: interview.feedback.trim() || undefined,
        };
      }
    }
    const parsed = offboardingAdvanceSchema.safeParse(payload);
    if (!parsed.success) {
      setGateError(toApiError(new Error(parsed.error.issues[0]?.message ?? 'Check the form and try again')));
      return;
    }

    const final = next === 'COMPLETED';
    const { confirmed } = await confirm({
      title: final ? `Complete the exit of ${employeeName}?` : `Advance to ${label(next)}?`,
      message: final ? (
        <>
          <p>
            {employeeName} will be marked as <strong>exited</strong> effective {formatDate(o.lastWorkingDate)}. Their user account will be deactivated and all active sessions
            signed out.
          </p>
          <p className="mt-2">This cannot be undone.</p>
        </>
      ) : step === 'EXIT_INTERVIEW' && !payload.exitInterview ? (
        'No exit interview responses were entered. Continue without recording an interview?'
      ) : (
        `The offboarding moves from ${label(step)} to ${label(next)}.${next === 'ASSET_RETURN' ? ' It can no longer be cancelled after this.' : ''}`
      ),
      confirmLabel: final ? 'Complete exit & deactivate' : `Advance to ${label(next)}`,
      tone: final ? 'danger' : 'primary',
    });
    if (!confirmed) return;
    try {
      await advance.mutateAsync(payload);
      toast.success(final ? 'Exit completed — account deactivated' : `Moved to ${label(next)}`);
    } catch (err) {
      setGateError(toApiError(err));
    }
  };

  const body = (() => {
    switch (step) {
      case 'EXIT_REQUEST':
        return (
          <Notice tone="info" icon={<CalendarClock className="h-4 w-4" />}>
            <p className="font-medium text-fg">Reason given</p>
            <p className="mt-1 whitespace-pre-line">{o.reason}</p>
          </Notice>
        );
      case 'NOTICE_PERIOD':
        return (
          <Notice tone={lwdDays !== null && lwdDays <= 0 ? 'success' : 'info'} icon={<CalendarClock className="h-4 w-4" />}>
            {lwdDays === null
              ? 'Last working date not set.'
              : lwdDays > 0
                ? `${lwdDays} day${lwdDays === 1 ? '' : 's'} until the last working day (${formatDate(o.lastWorkingDate)}).`
                : lwdDays === 0
                  ? 'Today is the last working day.'
                  : `The last working day (${formatDate(o.lastWorkingDate)}) has passed.`}
          </Notice>
        );
      case 'ASSET_RETURN':
        return <AssetReturnPanel o={o} active />;
      case 'CLEARANCE':
        return <ClearancePanel items={clearance} onChange={setClearance} editable={canProcess} />;
      case 'FINAL_PAYROLL':
        return canProcess ? <FinalPayrollPanel o={o} value={payrollId} onChange={setPayrollId} active /> : <FinalPayrollPanel o={o} value="" onChange={() => undefined} active={false} />;
      case 'EXIT_INTERVIEW':
        return <ExitInterviewPanel value={interview} onChange={setInterview} editable={canProcess} />;
      case 'DEACTIVATION':
        return (
          <Notice tone="danger" icon={<ShieldOff className="h-4 w-4" />}>
            <p className="font-medium">Completing this step will:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>mark the employee as exited with exit date {formatDate(o.lastWorkingDate)}</li>
              <li>deactivate their user account and sign them out of every session</li>
            </ul>
            <p className="mt-2">Direct reports must be reassigned to another manager first.</p>
          </Notice>
        );
      case 'COMPLETED':
        return (
          <Notice tone="success" icon={<CheckCircle2 className="h-4 w-4" />}>
            Exit completed{o.completedAt ? ` on ${formatDateTime(o.completedAt)}` : ''}. The employee’s account has been deactivated.
          </Notice>
        );
      case 'CANCELLED':
        return (
          <Notice tone="info" icon={<Ban className="h-4 w-4" />}>
            This offboarding was cancelled. Employment status was restored to {label(o.previousEmploymentStatus ?? 'ACTIVE').toLowerCase()}.
          </Notice>
        );
      default:
        return null;
    }
  })();

  return (
    <Card>
      <CardHeader title={copy.title} description={copy.description} actions={<StatusBadge status={step} />} />
      <CardBody className="space-y-4">
        {gateError && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {GATE_TITLES[gateError.code] ?? 'Couldn’t advance this offboarding'}
            </p>
            <p className="mt-1 pl-6">{gateError.message}</p>
          </div>
        )}
        {body}
        {canProcess && next && (
          <div className="space-y-3 border-t border-line pt-4">
            <div>
              <label htmlFor="advance-note" className="mb-1.5 block text-sm font-medium text-fg">
                Note for the timeline <span className="font-normal text-muted">(optional)</span>
              </label>
              <Textarea id="advance-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="flex justify-end">
              <Button
                className="w-full sm:w-auto"
                variant={next === 'COMPLETED' ? 'danger' : 'primary'}
                loading={advance.isPending}
                onClick={onAdvance}
                icon={next === 'COMPLETED' ? <ShieldOff className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
              >
                {next === 'COMPLETED' ? 'Complete exit & deactivate' : `Advance to ${label(next)}`}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
};

const Timeline = ({ o, userId }: { o: OffboardingDetail; userId?: string }) => (
  <Card>
    <CardHeader title="Timeline" />
    <CardBody>
      {!o.timeline.length ? (
        <p className="text-sm text-muted">No activity recorded.</p>
      ) : (
        <ol className="relative space-y-5 border-l border-line pl-5">
          {[...o.timeline].reverse().map((t, i) => (
            <li key={`${t.status}-${t.at}-${i}`} className="relative">
              <span
                className={cn('absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full border-2 border-surface', t.status === 'CANCELLED' ? 'bg-red-500' : 'bg-brand-600')}
                aria-hidden
              />
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={t.status} />
                <span className="text-xs text-muted">
                  {formatDateTime(t.at)}
                  {t.by && userId && String(t.by) === userId ? ' · by you' : ''}
                </span>
              </div>
              {t.note && <p className="mt-1 text-sm whitespace-pre-line text-fg-2">{t.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </CardBody>
  </Card>
);

export const OffboardingDetailPage = () => {
  const { id } = useParams();
  const offboarding = useOffboarding(id);
  const cancel = useCancelOffboarding(id ?? '');
  const { can, user } = usePermissions();
  const confirm = useConfirm();

  if (offboarding.isLoading) return <PageSkeleton />;
  if (offboarding.error || !offboarding.data) return <ErrorState className="card" message={offboarding.error?.message} onRetry={() => offboarding.refetch()} />;
  const o = offboarding.data;
  const e = o.employeeId;
  const isSelf = !!user?.employeeId && !!e && user.employeeId === e._id;
  const canManage = can('offboarding:manage');
  const canProcess = canManage && !isSelf;
  const canWithdraw = isSelf && o.exitType === 'RESIGNATION' && o.canCancel;
  const lwdDays = daysUntil(o.lastWorkingDate);
  const finalRun = o.finalPayrollId && typeof o.finalPayrollId === 'object' ? o.finalPayrollId : null;

  const onCancel = async () => {
    const { confirmed, reason } = await confirm({
      title: 'Cancel this offboarding?',
      message: `${e ? fullName(e) : 'The employee'} returns to ${label(o.previousEmploymentStatus ?? 'ACTIVE').toLowerCase()} status. The reason is recorded in the timeline.`,
      confirmLabel: 'Cancel offboarding',
      requireReason: true,
      reasonLabel: 'Reason for cancelling',
    });
    if (!confirmed) return;
    await cancel.mutateAsync(reason);
    toast.success('Offboarding cancelled');
  };

  const onWithdraw = async () => {
    const { confirmed } = await confirm({
      title: 'Withdraw your resignation?',
      message: 'HR and your manager will be notified and your employment status restored.',
      confirmLabel: 'Withdraw resignation',
    });
    if (!confirmed) return;
    await cancel.mutateAsync('Resignation withdrawn by employee');
    toast.success('Resignation withdrawn');
  };

  return (
    <>
      <PageHeader title="Offboarding" breadcrumb={[{ label: 'Offboarding', to: '/offboarding' }, { label: e ? fullName(e) : 'Details' }]} />

      <div className="card mb-6 flex flex-col gap-5 p-5 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Avatar name={e ? fullName(e) : '?'} src={e?.profilePhoto} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold text-fg">{e ? fullName(e) : 'Removed employee'}</h1>
              <ExitTypeBadge type={o.exitType} />
              <StatusBadge status={o.status} />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {e && (
                <span className="flex items-center gap-1.5">
                  <UserRound className="h-4 w-4" aria-hidden />
                  {e.employeeId}
                </span>
              )}
              {e?.designationId && (
                <span className="flex items-center gap-1.5">
                  <Briefcase className="h-4 w-4" aria-hidden />
                  {e.designationId.name}
                </span>
              )}
              {e?.departmentId && (
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-4 w-4" aria-hidden />
                  {e.departmentId.name}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <CalendarClock className="h-4 w-4" aria-hidden />
                Last day {formatDate(o.lastWorkingDate)}
                {o.status !== 'COMPLETED' && o.status !== 'CANCELLED' && lwdDays !== null && lwdDays >= 0 && ` (${lwdDays === 0 ? 'today' : `in ${lwdDays}d`})`}
              </span>
            </div>
          </div>
        </div>
        {((canManage && o.canCancel) || canWithdraw) && (
          <div className="flex flex-wrap gap-2">
            {canManage && o.canCancel && !isSelf && (
              <Button variant="outline" icon={<XCircle className="h-4 w-4" />} onClick={onCancel} loading={cancel.isPending}>
                Cancel offboarding
              </Button>
            )}
            {canWithdraw && (
              <Button variant="outline" icon={<Undo2 className="h-4 w-4" />} onClick={onWithdraw} loading={cancel.isPending}>
                Withdraw resignation
              </Button>
            )}
          </div>
        )}
      </div>

      <Card className="mb-6">
        <CardBody>
          {o.status === 'CANCELLED' && (
            <div className="mb-4">
              <FormError error="This offboarding was cancelled. The stepper shows where it stopped." />
            </div>
          )}
          <OffboardingStepper status={o.status} timeline={o.timeline} />
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <StepPanel o={o} canProcess={canProcess} />
          {isSelf && canManage && o.nextStatus && (
            <p className="text-sm text-muted">You can’t process your own offboarding — another HR administrator must advance it.</p>
          )}
          {o.status !== 'ASSET_RETURN' && o.assets.length > 0 && (
            <Card>
              <CardHeader title="Assigned assets" description={`${o.assets.length} still with the employee`} />
              <CardBody>
                <AssetReturnPanel o={o} active={false} />
              </CardBody>
            </Card>
          )}
          {o.status !== 'CLEARANCE' && o.clearance.length > 0 && (
            <Card>
              <CardHeader title="Clearance" description={`${o.clearance.filter((c) => c.cleared).length} of ${o.clearance.length} cleared`} />
              <CardBody>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {o.clearance.map((c) => (
                    <li key={c.department} className="flex items-start gap-2 text-sm">
                      {c.cleared ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Cleared" />
                      ) : (
                        <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-line-strong" aria-label="Pending" />
                      )}
                      <span className="min-w-0">
                        <span className="font-medium text-fg">{c.department}</span>
                        {c.at && <span className="block text-xs text-muted">{formatDate(c.at)}</span>}
                        {c.note && <span className="block text-xs text-muted">{c.note}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { label: 'Exit type', value: label(o.exitType) },
                  { label: 'Reason', value: <span className="whitespace-pre-line">{o.reason}</span> },
                  { label: 'Request date', value: formatDate(o.requestDate) },
                  { label: 'Last working date', value: formatDate(o.lastWorkingDate) },
                  { label: 'Employment status', value: e?.employmentStatus ? <StatusBadge status={e.employmentStatus} /> : null },
                  {
                    label: 'Final payroll',
                    value: finalRun ? (
                      <span className="flex flex-wrap items-center gap-2">
                        {monthLabel(finalRun.month, finalRun.year)}
                        {finalRun.isOffCycle ? ' (off-cycle)' : ''}
                        <StatusBadge status={finalRun.status} />
                      </span>
                    ) : null,
                  },
                  { label: 'Completed', value: o.completedAt ? formatDateTime(o.completedAt) : null },
                ]}
              />
            </CardBody>
          </Card>
          {o.exitInterview?.conductedAt && (
            <Card>
              <CardHeader title="Exit interview" description={`Recorded ${formatDate(o.exitInterview.conductedAt)}`} />
              <CardBody>
                <DescriptionList
                  columns={1}
                  items={[
                    { label: 'Reason for leaving', value: o.exitInterview.reasonForLeaving },
                    { label: 'Rating', value: o.exitInterview.rating ? `${o.exitInterview.rating} / 5` : null },
                    { label: 'Would recommend', value: o.exitInterview.wouldRecommend === undefined || o.exitInterview.wouldRecommend === null ? null : o.exitInterview.wouldRecommend ? 'Yes' : 'No' },
                    { label: 'Feedback', value: o.exitInterview.feedback ? <span className="whitespace-pre-line">{o.exitInterview.feedback}</span> : null },
                  ]}
                />
              </CardBody>
            </Card>
          )}
          <Timeline o={o} userId={user?._id} />
        </div>
      </div>
    </>
  );
};
