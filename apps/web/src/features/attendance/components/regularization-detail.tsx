import { Check, CircleDashed, Paperclip, SkipForward, X } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { DescriptionList, ErrorState, PersonCell, Skeleton } from '@/components/ui/display';
import { Drawer, useConfirm } from '@/components/ui/overlay';
import { openFile } from '@/lib/api';
import { label } from '@/lib/i18n';
import { cn, formatDateTime, fullName } from '@/lib/utils';
import { useRegularization, useRegularizationDecision, type ApprovalStep, type Regularization } from '../api';
import { formatKey, formatTimeIn, useOrgTimezone } from '../lib';

const STEP_ICON = {
  APPROVED: { icon: Check, cls: 'bg-emerald-500 text-white' },
  REJECTED: { icon: X, cls: 'bg-red-500 text-white' },
  SKIPPED: { icon: SkipForward, cls: 'bg-surface-3 text-muted' },
  PENDING: { icon: CircleDashed, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
} as const;

export const ApprovalTrail = ({ steps, current, active }: { steps: ApprovalStep[]; current: number; active: boolean }) =>
  !steps.length ? (
    <p className="text-sm text-muted">No approval steps.</p>
  ) : (
    <ol className="space-y-4" aria-label="Approval steps">
      {steps.map((s, i) => {
        const meta = STEP_ICON[s.status] ?? STEP_ICON.PENDING;
        const Icon = meta.icon;
        const waiting = active && i === current && s.status === 'PENDING';
        return (
          <li key={i} className="flex gap-3">
            <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', meta.cls)} aria-hidden>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-medium text-fg">
                {label(s.approverType)} approval <span className="font-normal text-muted">· {waiting ? 'Awaiting decision' : label(s.status)}</span>
              </p>
              {(s.actedByName || s.actedAt) && (
                <p className="text-xs text-muted">
                  {s.actedByName ?? 'Approver'}
                  {s.actedAt ? ` · ${formatDateTime(s.actedAt)}` : ''}
                </p>
              )}
              {s.comment && <p className="mt-1 rounded-md bg-surface-2 px-2 py-1 text-xs text-fg-2">{s.comment}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );

/** Original vs requested times side by side. */
export const TimeComparison = ({ r, timeZone }: { r: Regularization; timeZone: string }) => (
  <span className="inline-flex flex-wrap items-center gap-x-1.5 tabular-nums">
    <span className="text-muted line-through decoration-muted/50">
      {r.originalCheckIn || r.originalCheckOut ? `${formatTimeIn(r.originalCheckIn, timeZone)}–${formatTimeIn(r.originalCheckOut, timeZone)}` : 'No record'}
    </span>
    <span aria-hidden className="text-subtle">→</span>
    <span className="sr-only">requested</span>
    <span className="font-medium text-fg">
      {r.requestedCheckIn}–{r.requestedCheckOut}
    </span>
  </span>
);

export const useRegularizationActions = () => {
  const decide = useRegularizationDecision();
  const confirm = useConfirm();

  const approve = async (r: Regularization) => {
    const { confirmed } = await confirm({
      title: `Approve correction for ${formatKey(r.date)}?`,
      message: `${fullName(r.employeeId)} requested ${r.requestedCheckIn}–${r.requestedCheckOut}. On final approval the attendance record is updated.`,
      confirmLabel: 'Approve',
      tone: 'primary',
    });
    if (!confirmed) return false;
    const res = await decide.mutateAsync({ id: r._id, action: 'approve' });
    toast.success(res.message ?? 'Correction approved');
    return true;
  };
  const reject = async (r: Regularization) => {
    const { confirmed, reason } = await confirm({
      title: `Reject correction for ${formatKey(r.date)}?`,
      message: `The request from ${fullName(r.employeeId)} will be closed.`,
      confirmLabel: 'Reject',
      requireReason: true,
      reasonLabel: 'Reason for rejection',
    });
    if (!confirmed || !reason) return false;
    const res = await decide.mutateAsync({ id: r._id, action: 'reject', reason });
    toast.success(res.message ?? 'Correction rejected');
    return true;
  };
  const cancel = async (r: Regularization) => {
    const { confirmed } = await confirm({ title: 'Cancel this request?', message: `Your correction request for ${formatKey(r.date)} will be withdrawn.`, confirmLabel: 'Cancel request' });
    if (!confirmed) return false;
    const res = await decide.mutateAsync({ id: r._id, action: 'cancel' });
    toast.success(res.message ?? 'Request cancelled');
    return true;
  };
  return { approve, reject, cancel, pending: decide.isPending };
};

export const RegularizationDrawer = ({ id, onClose }: { id: string | null; onClose: () => void }) => {
  const timeZone = useOrgTimezone();
  const detail = useRegularization(id);
  const actions = useRegularizationActions();
  const r = detail.data;
  const pending = r ? ['SUBMITTED', 'PENDING_APPROVAL'].includes(r.status) : false;
  const act = async (fn: (r: Regularization) => Promise<boolean>) => {
    if (!r) return;
    try {
      if (await fn(r)) onClose();
    } catch {
      /* toasted globally */
    }
  };

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title="Correction request"
      description={r ? formatKey(r.date, 'EEEE, dd MMM yyyy') : undefined}
      footer={
        r && (r.canAct || r.canCancel) ? (
          <>
            {r.canCancel && (
              <Button variant="outline" onClick={() => act(actions.cancel)} disabled={actions.pending}>
                Cancel request
              </Button>
            )}
            {r.canAct && (
              <>
                <Button variant="danger" icon={<X className="h-4 w-4" />} onClick={() => act(actions.reject)} disabled={actions.pending}>
                  Reject
                </Button>
                <Button variant="success" icon={<Check className="h-4 w-4" />} onClick={() => act(actions.approve)} disabled={actions.pending}>
                  Approve
                </Button>
              </>
            )}
          </>
        ) : undefined
      }
    >
      {detail.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-14" />
          <Skeleton className="h-32" />
          <Skeleton className="h-24" />
        </div>
      ) : detail.error || !r ? (
        <ErrorState message={detail.error?.message} onRetry={() => detail.refetch()} />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 p-3">
            <PersonCell name={fullName(r.employeeId)} subtitle={[r.employeeId.employeeId, r.employeeId.departmentId?.name].filter(Boolean).join(' · ')} photo={r.employeeId.profilePhoto} />
            <StatusBadge status={r.status} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-line p-3">
              <p className="text-xs font-medium tracking-wide text-muted uppercase">Recorded</p>
              <p className="mt-1 text-lg font-semibold text-fg-2 tabular-nums">
                {r.originalCheckIn || r.originalCheckOut ? `${formatTimeIn(r.originalCheckIn, timeZone)} – ${formatTimeIn(r.originalCheckOut, timeZone)}` : 'No record'}
              </p>
            </div>
            <div className="rounded-xl border border-brand-200 bg-brand-50 p-3 dark:border-brand-500/30 dark:bg-brand-500/10">
              <p className="text-xs font-medium tracking-wide text-brand-700 uppercase dark:text-brand-300">Requested</p>
              <p className="mt-1 text-lg font-semibold text-fg tabular-nums">
                {r.requestedCheckIn} – {r.requestedCheckOut}
              </p>
            </div>
          </div>
          <DescriptionList
            columns={1}
            items={[
              { label: 'Reason', value: <span className="whitespace-pre-line">{r.reason}</span> },
              ...(r.rejectionReason ? [{ label: 'Rejection reason', value: r.rejectionReason }] : []),
              { label: 'Submitted', value: formatDateTime(r.submittedAt ?? r.createdAt) },
              ...(r.decidedAt ? [{ label: 'Decided', value: formatDateTime(r.decidedAt) }] : []),
              {
                label: 'Attachment',
                value: r.attachmentId ? (
                  <Button variant="link" icon={<Paperclip className="h-4 w-4" />} onClick={() => void openFile(`/files/${r.attachmentId!._id}`)}>
                    {r.attachmentId.originalName ?? r.attachmentId.name ?? 'View attachment'}
                  </Button>
                ) : null,
              },
            ]}
          />
          <section>
            <h3 className="mb-3 text-sm font-semibold text-fg">Approval trail</h3>
            <ApprovalTrail steps={r.approvalSteps} current={r.currentStep} active={pending} />
          </section>
        </div>
      )}
    </Drawer>
  );
};
