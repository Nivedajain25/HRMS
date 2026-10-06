import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmployeeRef } from '@stencil/types';
import type { ExpenseStatus } from '@stencil/shared';
import { get, getPaged, patch, post, upload } from '@/lib/api';

export interface UserName {
  _id: string;
  firstName: string;
  lastName: string;
}

export interface ApprovalStep {
  approverType: 'MANAGER' | 'HR' | 'FINANCE' | 'PAYROLL';
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
  approvalSteps: ApprovalStep[];
  currentStep: number;
  currentApproverType?: ApprovalStep['approverType'] | null;
  rejectionReason?: string;
  submittedAt?: string | null;
  approvedAt?: string | null;
  paidAt?: string | null;
  paidBy?: string | UserName | null;
  paymentReference?: string;
  createdBy?: string | UserName | null;
  createdAt: string;
}

export interface ExpenseDetail extends ExpenseRecord {
  receiptFileId: ReceiptRef | null;
  receiptUrl: string | null;
  permissions: { canApprove: boolean; canEdit: boolean; canCancel: boolean; canPay: boolean };
}

export interface ExpenseSummary {
  from: string | null;
  to: string | null;
  byStatus: { status: ExpenseStatus; currency: string; count: number; total: number }[];
  byCategory: { category: string; currency: string; count: number; total: number }[];
  totals: { currency: string; count: number; total: number }[];
}

export type ExpenseScope = 'me' | 'team' | 'all' | 'approvals' | 'payable';

export const PENDING_STATUSES: ExpenseStatus[] = ['SUBMITTED', 'PENDING_APPROVAL'];
export const RECEIPT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
export const RECEIPT_ACCEPT = 'image/*,application/pdf';
export const MAX_RECEIPT_MB = 10;

export const receiptId = (r: ExpenseRecord['receiptFileId']) => (r ? (typeof r === 'string' ? r : r._id) : null);

export const expenseKeys = {
  all: ['expenses'] as const,
  list: (q: object) => ['expenses', 'list', q] as const,
  detail: (id: string) => ['expenses', 'detail', id] as const,
  summary: (q: object) => ['expenses', 'summary', q] as const,
};

export const useExpenses = (query: object, enabled = true) =>
  useQuery({ queryKey: expenseKeys.list(query), queryFn: () => getPaged<ExpenseRecord>('/expenses', query), placeholderData: keepPreviousData, enabled });

export const useExpense = (id: string | null | undefined) =>
  useQuery({ queryKey: expenseKeys.detail(id ?? ''), queryFn: () => get<ExpenseDetail>(`/expenses/${id}`), enabled: !!id });

export const useExpenseSummary = (q: { from?: string; to?: string; scope?: 'me' | 'team' | 'all' }) =>
  useQuery({ queryKey: expenseKeys.summary(q), queryFn: () => get<ExpenseSummary>('/expenses/summary', q), placeholderData: keepPreviousData });

const useInvalidate = () => {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: expenseKeys.all });
};

export const uploadReceipt = async (file: File) => (await upload<{ _id: string }>('/files', file, { context: 'EXPENSE', title: file.name })).data._id;

export const useSaveExpense = (id?: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => (id ? patch<ExpenseDetail>(`/expenses/${id}`, input) : post<ExpenseDetail>('/expenses', input)),
    meta: { silent: true },
    onSuccess: invalidate,
  });
};

/** Workflow transitions without a body (submit, cancel) or with a small one (approve, reject, pay). */
export const useExpenseTransition = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: 'submit' | 'cancel' | 'approve' | 'reject' | 'pay'; body?: object }) =>
      post<ExpenseDetail>(`/expenses/${id}/${action}`, body ?? {}),
    onSuccess: invalidate,
  });
};

/** Pay dialog handles its own errors inline. */
export const usePayExpense = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; paidDate: string; paymentReference?: string }) => post<ExpenseDetail>(`/expenses/${id}/pay`, body),
    meta: { silent: true },
    onSuccess: invalidate,
  });
};
