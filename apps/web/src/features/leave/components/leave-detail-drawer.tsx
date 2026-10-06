import { Link } from 'react-router-dom';
import { Ban, Check, CheckCircle2, Circle, Clock3, Paperclip, Pencil, Send, SkipForward, X, XCircle } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Avatar, DescriptionList, ErrorState, Skeleton } from '@/components/ui/display';
import { Drawer } from '@/components/ui/overlay';
import { openFile } from '@/lib/api';
import { label } from '@/lib/i18n';
import { cn, formatBytes, formatDate, formatDateTime, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { attachmentOf, formatDays, isForbidden, typeOf, useLeave, type ApprovalStep, type LeaveRequest } from '../api';
import { canCancelLeave, canDecideLeave, canEditLeave, canRejectLeave, isLeaveOwner, LeaveTypeLabel, sessionLabel } from './leave-ui';
import { useLeaveActions } from './use-leave-actions';

interface TimelineItem {
  key: string;
  title: string;
  meta?: string;
  comment?: string | null;
  tone: 'green' | 'red' | 'amber' | 'gray' | 'brand';
  icon: React.ReactNode;
  current?: boolean;
}

const stepItem = (s: ApprovalStep, i: number, l: LeaveRequest): TimelineItem => {
  const who = `${label(s.approverType)} approval`;
  const isCurrent = s.status === 'PENDING' && i === l.currentStep && (l.status === 'SUBMITTED' || l.status === 'PENDING_APPROVAL');
  switch (s.status) {
    case 'APPROVED':
      return { key: `s${i}`, title: `${who} — approved`, meta: [s.actedByName, s.actedAt ? formatDateTime(s.actedAt) : null].filter(Boolean).join(' · '), comment: s.comment, tone: 'green', icon: <CheckCircle2 className="h-4 w-4" /> };
    case 'REJECTED':
      return { key: `s${i}`, title: `${who} — rejected`, meta: [s.actedByName, s.actedAt ? formatDateTime(s.actedAt) : null].filter(Boolean).join(' · '), comment: s.comment, tone: 'red', icon: <XCircle className="h-4 w-4" /> };
    case 'SKIPPED':
      return { key: `s${i}`, title: `${who} — skipped`, meta: l.status === 'CANCELLED' ? 'Request was cancelled' : 'Not required', tone: 'gray', icon: <SkipForward className="h-4 w-4" /> };
    default:
      return {
        key: `s${i}`,
        title: isCurrent ? `Awaiting ${label(s.approverType).toLowerCase()} approval` : who,
        meta: isCurrent ? 'In progress' : 'Upcoming',
        tone: isCurrent ? 'amber' : 'gray',
        icon: isCurrent ? <Clock3 className="h-4 w-4" /> : <Circle className="h-4 w-4" />,
        current: isCurrent,
      };
  }
};

const toneClass: Record<TimelineItem['tone'], string> = {
  green: 'bg-emerald-50 text-emerald-600 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  red: 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
  amber: 'bg-amber-50 text-amber-600 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  gray: 'bg-surface-3 text-muted ring-line',
  brand: 'bg-brand-50 text-brand-600 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/30',
};

const Timeline = ({ l }: { l: LeaveRequest }) => {
  const items: TimelineItem[] = [];
  if (l.status === 'DRAFT') {
    items.push({ key: 'draft', title: 'Saved as draft', meta: formatDateTime(l.createdAt), tone: 'gray', icon: <Pencil className="h-4 w-4" /> });
  } else {
    items.push({ key: 'submitted', title: 'Submitted', meta: formatDateTime(l.submittedAt ?? l.createdAt), tone: 'brand', icon: <Send className="h-4 w-4" /> });
    l.approvalSteps.forEach((s, i) => items.push(stepItem(s, i, l)));
  }
  if (l.status === 'CANCELLED') {
    items.push({ key: 'cancelled', title: 'Cancelled', meta: l.cancelledAt ? formatDateTime(l.cancelledAt) : undefined, comment: l.cancellationReason, tone: 'gray', icon: <Ban className="h-4 w-4" /> });
  }
  return (
    <ol className="space-y-0">
      {items.map((it, i) => (
        <li key={it.key} className="relative flex gap-3 pb-5 last:pb-0">
          {i < items.length - 1 && <span className="absolute top-8 bottom-0 left-[15px] w-px bg-line" aria-hidden />}
          <span className={cn('relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1', toneClass[it.tone], it.current && 'ring-2')} aria-hidden>
            {it.icon}
          </span>
          <div className="min-w-0 pt-1">
            <p className="text-sm font-medium text-fg">{it.title}</p>
            {it.meta && <p className="text-xs text-muted">{it.meta}</p>}
            {it.comment && <p className="mt-1.5 rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-2">“{it.comment}”</p>}
          </div>
        </li>
      ))}
    </ol>
  );
};

export const LeaveDetailDrawer = ({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit?: (l: LeaveRequest) => void }) => {
  const leave = useLeave(id);
  const { user, can } = usePermissions();
  const actions = useLeaveActions();
  const l = leave.data;
  const type = l ? typeOf(l) : null;
  const attachment = l ? attachmentOf(l) : null;
  const own = l ? isLeaveOwner(user, l) : false;
  const busy = actions.pending;

  const footer = l ? (
    <>
      {canCancelLeave(user, l) && (
        <Button variant="outline" className="flex-1 sm:flex-none" icon={<Ban className="h-4 w-4" />} disabled={busy} onClick={() => void actions.cancel(l)}>
          {l.status === 'DRAFT' ? 'Discard' : 'Cancel leave'}
        </Button>
      )}
      {canEditLeave(user, l) && onEdit && (
        <Button variant="outline" className="flex-1 sm:flex-none" icon={<Pencil className="h-4 w-4" />} disabled={busy} onClick={() => onEdit(l)}>
          Edit
        </Button>
      )}
      {canEditLeave(user, l) && (
        <Button className="flex-1 sm:flex-none" icon={<Send className="h-4 w-4" />} loading={busy} onClick={() => void actions.submit(l)}>
          Submit
        </Button>
      )}
      {canRejectLeave(user, l) && (
        <Button variant="outline" className="flex-1 text-red-600 sm:flex-none dark:text-red-400" icon={<X className="h-4 w-4" />} disabled={busy} onClick={() => void actions.reject(l)}>
          Reject
        </Button>
      )}
      {canDecideLeave(user, l) && (
        <Button variant="success" className="flex-1 sm:flex-none" icon={<Check className="h-4 w-4" />} loading={busy} onClick={() => void actions.approve(l)}>
          Approve
        </Button>
      )}
    </>
  ) : undefined;
  const hasActions = !!l && (canCancelLeave(user, l) || canEditLeave(user, l) || canDecideLeave(user, l));

  return (
    <Drawer open={!!id} onClose={onClose} title="Leave request" description={l ? `${type?.name ?? 'Leave'} · ${formatDays(l.days)}` : undefined} footer={hasActions ? footer : undefined}>
      {leave.isLoading ? (
        <div className="space-y-4" role="status" aria-label="Loading leave request">
          <Skeleton className="h-16" />
          <Skeleton className="h-32" />
          <Skeleton className="h-40" />
        </div>
      ) : leave.error || !l ? (
        <ErrorState
          title={isForbidden(leave.error) ? 'Access denied' : 'Could not load this request'}
          message={leave.error?.message}
          onRetry={isForbidden(leave.error) ? undefined : () => leave.refetch()}
        />
      ) : (
        <div className="space-y-6">
          <div className="flex items-start gap-3">
            <Avatar name={fullName(l.employeeId)} src={l.employeeId?.profilePhoto} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {!own && can('employee:read') ? (
                  <Link to={`/employees/${l.employeeId._id}?tab=leave`} className="truncate text-base font-semibold text-fg hover:underline">
                    {fullName(l.employeeId)}
                  </Link>
                ) : (
                  <span className="truncate text-base font-semibold text-fg">{fullName(l.employeeId)}</span>
                )}
                <StatusBadge status={l.status} />
              </div>
              <p className="mt-0.5 text-sm text-muted">{l.employeeId?.employeeId}</p>
            </div>
          </div>

          <div className="rounded-xl border border-line p-4">
            <DescriptionList
              items={[
                { label: 'Leave type', value: <LeaveTypeLabel type={type} /> },
                { label: 'Duration', value: `${formatDays(l.days)}${l.halfDay ? ` · ${sessionLabel(l.halfDaySession)}` : ''}` },
                { label: 'From', value: formatDate(l.startDate, 'EEE, dd MMM yyyy') },
                { label: 'To', value: formatDate(l.endDate, 'EEE, dd MMM yyyy') },
                { label: 'Paid', value: type?.paid === false ? 'Unpaid' : 'Paid' },
                { label: 'Applied', value: formatDateTime(l.submittedAt ?? l.createdAt) },
              ]}
            />
          </div>

          <section>
            <h3 className="mb-1.5 text-xs font-medium text-muted">Reason</h3>
            <p className="text-sm whitespace-pre-line text-fg">{l.reason}</p>
          </section>

          {l.status === 'REJECTED' && l.rejectionReason && (
            <div role="note" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              <span className="font-medium">Rejected: </span>
              {l.rejectionReason}
            </div>
          )}

          {attachment && (
            <section>
              <h3 className="mb-1.5 text-xs font-medium text-muted">Attachment</h3>
              <button
                type="button"
                onClick={() => void openFile(`/files/${attachment._id}`)}
                className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-left text-sm hover:border-brand-300"
              >
                <Paperclip className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium text-fg">{attachment.originalName ?? attachment.title ?? 'View attachment'}</span>
                {attachment.size ? <span className="shrink-0 text-xs text-muted">{formatBytes(attachment.size)}</span> : null}
              </button>
            </section>
          )}

          <section>
            <h3 className="mb-3 text-xs font-medium text-muted">Approval</h3>
            <Timeline l={l} />
          </section>
        </div>
      )}
    </Drawer>
  );
};
