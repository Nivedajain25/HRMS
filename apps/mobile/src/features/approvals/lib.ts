import type { Permission } from '@stencil/shared';
import { label } from '@/lib/format';
import type { ExpenseDetail } from './api';

const APPROVER_LABEL: Record<string, string> = { MANAGER: 'Reporting manager', HR: 'HR', FINANCE: 'Finance', PAYROLL: 'Payroll' };

/** Approval-step label (same wording as the web expense trail). */
export const approverLabel = (type: string) => APPROVER_LABEL[type] ?? label(type);

/**
 * Reject is offered when the server says the user may act on the current step and they hold the
 * permission the API checks for it (`expense:pay` for FINANCE steps, `expense:reject` otherwise).
 */
export const canRejectExpense = (e: ExpenseDetail, can: (p: Permission) => boolean) =>
  e.permissions.canApprove && (e.currentApproverType === 'FINANCE' ? can('expense:pay') || can('expense:reject') : can('expense:reject'));

/** Pending approval states shared by leave, corrections and expenses. */
export const isAwaitingDecision = (status: string) => status === 'SUBMITTED' || status === 'PENDING_APPROVAL';
