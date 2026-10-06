import { useState } from 'react';
import { toast, useConfirm } from '@/components';
import { toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fullName } from '@/lib/format';
import { useLeaveAction, type LeaveAction, type LeaveRequest } from '../api';
import { formatDays, isLeaveOwner, leaveRange, typeOf } from '../lib';

const describe = (l: LeaveRequest) => `${typeOf(l)?.name ?? 'Leave'} · ${leaveRange(l)} (${formatDays(l.days)})`;

/**
 * Confirmed, toasted leave workflow actions (same copy as the web `useLeaveActions`).
 * Each resolves with the updated request, or `null` when dismissed / failed;
 * the last API error stays in `error` so screens can show it inline.
 */
export const useLeaveActions = () => {
  const confirm = useConfirm();
  const { user } = useAuth();
  const action = useLeaveAction();
  const [error, setError] = useState<string | null>(null);

  const run = async (input: { id: string; action: LeaveAction; comment?: string; reason?: string }, failTitle: string) => {
    setError(null);
    try {
      return (await action.mutateAsync(input)).data;
    } catch (err) {
      const message = toApiError(err).message;
      setError(message);
      toast.error(failTitle, message);
      return null;
    }
  };

  const approve = async (l: LeaveRequest) => {
    const { confirmed, reason } = await confirm({
      title: `Approve leave for ${fullName(l.employeeId)}?`,
      message: describe(l),
      confirmLabel: 'Approve',
      reason: { label: 'Comment (optional)', placeholder: 'Visible to the employee', maxLength: 1000 },
    });
    if (!confirmed) return null;
    const data = await run({ id: l._id, action: 'approve', comment: reason }, 'Could not approve the leave');
    if (data) toast.success(data.status === 'APPROVED' ? 'Leave approved' : 'Approved — sent to the next approver', `${fullName(l.employeeId)} · ${leaveRange(l)}`);
    return data;
  };

  const reject = async (l: LeaveRequest) => {
    const { confirmed, reason } = await confirm({
      title: `Reject leave for ${fullName(l.employeeId)}?`,
      message: `${describe(l)}. The employee is notified with your reason and the reserved balance is released.`,
      confirmLabel: 'Reject leave',
      tone: 'danger',
      reason: { label: 'Reason for rejection', required: true, maxLength: 1000 },
    });
    if (!confirmed || !reason) return null;
    const data = await run({ id: l._id, action: 'reject', reason }, 'Could not reject the leave');
    if (data) toast.success('Leave rejected');
    return data;
  };

  const cancel = async (l: LeaveRequest) => {
    const own = isLeaveOwner(user, l);
    const draft = l.status === 'DRAFT';
    const approved = l.status === 'APPROVED';
    const { confirmed, reason } = await confirm({
      title: draft ? 'Discard this draft?' : own ? 'Cancel your leave request?' : `Cancel leave for ${fullName(l.employeeId)}?`,
      message: `${describe(l)}. ${
        draft
          ? 'The draft will be discarded.'
          : approved
            ? 'The used days are returned to the balance.'
            : 'The reserved days are released back to the balance.'
      }`,
      confirmLabel: draft ? 'Discard draft' : 'Cancel leave',
      cancelLabel: 'Keep',
      tone: 'danger',
      reason: draft ? undefined : { label: 'Reason for cancellation', required: approved || !own, maxLength: 1000 },
    });
    if (!confirmed) return null;
    const data = await run({ id: l._id, action: 'cancel', reason }, draft ? 'Could not discard the draft' : 'Could not cancel the leave');
    if (data) toast.success(draft ? 'Draft discarded' : 'Leave cancelled');
    return data;
  };

  const submit = async (l: LeaveRequest) => {
    const data = await run({ id: l._id, action: 'submit' }, 'Could not submit the request');
    if (data) toast.success('Leave request submitted', 'Your approver has been notified.');
    return data;
  };

  return { approve, reject, cancel, submit, pending: action.isPending, pendingAction: action.isPending ? action.variables?.action : undefined, error, clearError: () => setError(null) };
};
