import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmployeeRef } from '@stencil/types';
import type { ExpenseStatus } from '@stencil/shared';
import { get, getPaged, post } from '@/lib/api';
import { attendanceKeys, regularizationKeys, type Regularization } from '@/features/attendance/api';
import { leaveKeys, nextPageOf, type LeaveRequest } from '@/features/leave/api';

/* -------------------------------- Types -------------------------------- */
// Same shapes as the web `features/expenses/api.ts`.

export interface UserName {
  _id: string;
  firstName: string;
  lastName: string;
}

export type ExpenseApproverType = 'MANAGER' | 'HR' | 'FINANCE' | 'PAYROLL';

export interface ExpenseApprovalStep {
  approverType: ExpenseApproverType;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED';
  actedBy?: string | null;
  actedByName?: string | null;
  actedAt?: string | null;
  comment?: string | null;
}

export interface ReceiptRef {
  _id: string;
  title: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface ExpenseRecord {
  _id: string;
  expenseNumber: string;
  employeeId: EmployeeRef;
  category: string;
  amount: number;
  currency: string;
  date: string;
  description: string;
  merchant?: string;
  project?: string;
  receiptFileId?: string | ReceiptRef | null;
  status: ExpenseStatus;
  approvalSteps: ExpenseApprovalStep[];
  currentStep: number;
  currentApproverType?: ExpenseApproverType | null;
  rejectionReason?: string;
  submittedAt?: string | null;
  approvedAt?: string | null;
  paidAt?: string | null;
  paidBy?: string | UserName | null;
  paymentReference?: string;
  createdAt: string;
}

export interface ExpenseDetail extends ExpenseRecord {
  receiptFileId: ReceiptRef | null;
  receiptUrl: string | null;
  permissions: { canApprove: boolean; canEdit: boolean; canCancel: boolean; canPay: boolean };
}

export type Segment = 'leave' | 'attendance' | 'expenses' | 'payable';

/* ------------------------------ Query keys ----------------------------- */

export const expenseKeys = {
  all: ['expenses'] as const,
  list: (q: object) => ['expenses', 'list', q] as const,
  detail: (id: string) => ['expenses', 'detail', id] as const,
};

const PAGE_SIZE = 20;

/* ------------------------------- Inboxes ------------------------------- */
// Queues are sorted oldest-first so the longest-waiting requests come first.

export const useLeaveInbox = (enabled: boolean) =>
  useInfiniteQuery({
    queryKey: leaveKeys.list({ scope: 'approvals', sortBy: 'startDate', sortOrder: 'asc' }),
    queryFn: ({ pageParam }) =>
      getPaged<LeaveRequest>('/leaves', { scope: 'approvals', sortBy: 'startDate', sortOrder: 'asc', page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: nextPageOf,
    enabled,
  });

export const useRegularizationInbox = (enabled: boolean) =>
  useInfiniteQuery({
    queryKey: regularizationKeys.list({ scope: 'approvals', sortBy: 'createdAt', sortOrder: 'asc' }),
    queryFn: ({ pageParam }) =>
      getPaged<Regularization>('/attendance/regularizations', {
        scope: 'approvals',
        sortBy: 'createdAt',
        sortOrder: 'asc',
        page: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: nextPageOf,
    enabled,
  });

export const useExpenseInbox = (scope: 'approvals' | 'payable', enabled: boolean) =>
  useInfiniteQuery({
    queryKey: expenseKeys.list({ scope, sortBy: 'submittedAt', sortOrder: 'asc' }),
    queryFn: ({ pageParam }) =>
      getPaged<ExpenseRecord>('/expenses', { scope, sortBy: 'submittedAt', sortOrder: 'asc', page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: nextPageOf,
    enabled,
  });

/* ---------------------------- Regularization --------------------------- */

export const useRegularizationDecision = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, reason, comment }: { id: string; action: 'approve' | 'reject'; reason?: string; comment?: string }) =>
      post<Regularization>(`/attendance/regularizations/${id}/${action}`, action === 'reject' ? { reason } : comment ? { comment } : {}),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: regularizationKeys.all }),
        qc.invalidateQueries({ queryKey: attendanceKeys.all }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
      ]),
  });
};

/* ------------------------------- Expenses ------------------------------ */

export const useExpense = (id: string | undefined) =>
  useQuery({ queryKey: expenseKeys.detail(id ?? ''), queryFn: () => get<ExpenseDetail>(`/expenses/${id}`), enabled: !!id });

const useInvalidateExpenses = () => {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: expenseKeys.all }), qc.invalidateQueries({ queryKey: ['dashboard'] })]);
};

export const useExpenseDecision = () => {
  const invalidate = useInvalidateExpenses();
  return useMutation({
    mutationFn: ({ id, action, reason, comment }: { id: string; action: 'approve' | 'reject'; reason?: string; comment?: string }) =>
      post<ExpenseDetail>(`/expenses/${id}/${action}`, action === 'reject' ? { reason } : comment ? { comment } : {}),
    onSettled: invalidate,
  });
};

export const usePayExpense = () => {
  const invalidate = useInvalidateExpenses();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; paidDate: string; paymentReference?: string }) => post<ExpenseDetail>(`/expenses/${id}/pay`, body),
    onSettled: invalidate,
  });
};
