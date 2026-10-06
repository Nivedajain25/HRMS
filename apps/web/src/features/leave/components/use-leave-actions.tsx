import { toast } from 'sonner';
import { useConfirm } from '@/components/ui/overlay';
import { fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { formatDays, leaveActionRequest, typeOf, useLeaveAction, type LeaveRequest } from '../api';
import { isLeaveOwner, leaveRange } from './leave-ui';

const describe = (l: LeaveRequest) => `${typeOf(l)?.name ?? 'Leave'} · ${leaveRange(l)} (${formatDays(l.days)})`;

/** Confirmed, toasted leave workflow actions shared by tables and the detail drawer. */
export const useLeaveActions = () => {
  const confirm = useConfirm();
  const { user } = usePermissions();
  const action = useLeaveAction();

  /** Errors are toasted by the global mutation handler; resolve with null. */
  const run = async (input: Parameters<typeof action.mutateAsync>[0]) => {
    try {
      return (await action.mutateAsync(input)).data;
    } catch {
      return null;
    }
  };

  const approve = async (l: LeaveRequest) => {
    const data = await run({ id: l._id, action: 'approve' });
    if (data) toast.success(data.status === 'APPROVED' ? 'Leave approved' : 'Approved — sent to the next approver', { description: `${fullName(l.employeeId)} · ${leaveRange(l)}` });
    return data;
  };

  const reject = async (l: LeaveRequest) => {
    const { confirmed, reason } = await confirm({
      title: `Reject leave for ${fullName(l.employeeId)}?`,
      message: <>{describe(l)}. The employee is notified with your reason and the reserved balance is released.</>,
      confirmLabel: 'Reject leave',
      requireReason: true,
      reasonLabel: 'Reason for rejection',
    });
    if (!confirmed || !reason) return null;
    const data = await run({ id: l._id, action: 'reject', reason });
    if (data) toast.success('Leave rejected');
    return data;
  };

  const cancel = async (l: LeaveRequest) => {
    const own = isLeaveOwner(user, l);
    const draft = l.status === 'DRAFT';
    const { confirmed, reason } = await confirm({
      title: draft ? 'Discard this draft?' : own ? 'Cancel your leave request?' : `Cancel leave for ${fullName(l.employeeId)}?`,
      message: (
        <>
          {describe(l)}.{' '}
          {draft
            ? 'The draft will be discarded.'
            : l.status === 'APPROVED'
              ? 'The used days are returned to the balance.'
              : 'The reserved days are released back to the balance.'}
        </>
      ),
      confirmLabel: draft ? 'Discard draft' : 'Cancel leave',
      requireReason: !own,
      reasonLabel: 'Reason for cancellation',
    });
    if (!confirmed) return null;
    const data = await run({ id: l._id, action: 'cancel', reason });
    if (data) toast.success(draft ? 'Draft discarded' : 'Leave cancelled');
    return data;
  };

  const submit = async (l: LeaveRequest) => {
    const data = await run({ id: l._id, action: 'submit' });
    if (data) toast.success('Leave request submitted', { description: 'Your approver has been notified.' });
    return data;
  };

  return { approve, reject, cancel, submit, pending: action.isPending, pendingId: action.isPending ? action.variables?.id : undefined };
};

/**
 * Approves requests one by one (each may belong to a different approval
 * step) and reports how many succeeded.
 */
export const bulkApprove = async (rows: LeaveRequest[], onProgress?: (done: number) => void) => {
  const failures: { row: LeaveRequest; message: string }[] = [];
  let ok = 0;
  for (const [i, row] of rows.entries()) {
    try {
      await leaveActionRequest(row._id, 'approve');
      ok++;
    } catch (err) {
      failures.push({ row, message: err instanceof Error ? err.message : 'Failed' });
    }
    onProgress?.(i + 1);
  }
  return { ok, failures };
};
