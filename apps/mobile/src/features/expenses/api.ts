import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmployeeRef } from '@stencil/types';
import type { ExpenseStatus } from '@stencil/shared';
import { get, patch, post, upload, type UploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useInfiniteList } from '@/features/profile/kit/infinite';

/* Same shapes as the web `features/expenses/api.ts`. */

export type ApproverType = 'MANAGER' | 'HR' | 'FINANCE' | 'PAYROLL';

export interface ExpenseApprovalStep {
  approverType: ApproverType;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED';
  actedByName?: string | null;
  actedAt?: string | null;
  comment?: string | null;
}

export interface ReceiptRef {
  _id: string;
  title?: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt?: string;
}

interface UserName {
  _id: string;
  firstName: string;
  lastName: string;
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
  currentApproverType?: ApproverType | null;
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

export interface ExpenseSummary {
  byStatus: { status: ExpenseStatus; currency: string; count: number; total: number }[];
  totals: { currency: string; count: number; total: number }[];
}

export const PENDING_STATUSES: ExpenseStatus[] = ['SUBMITTED', 'PENDING_APPROVAL'];
export const MAX_RECEIPT_MB = 10;

export const APPROVER_LABEL: Record<ApproverType, string> = {
  MANAGER: 'Reporting manager',
  HR: 'HR',
  FINANCE: 'Finance',
  PAYROLL: 'Payroll',
};

export const expenseKeys = {
  all: ['expenses'] as const,
  list: (q: object) => ['expenses', 'list', q] as const,
  detail: (id: string) => ['expenses', 'detail', id] as const,
  summary: (q: object) => ['expenses', 'summary', q] as const,
};

export const useMyExpenses = (status: ExpenseStatus | undefined) => {
  const query = { scope: 'me', status, sortBy: 'createdAt', sortOrder: 'desc' } as const;
  return useInfiniteList<ExpenseRecord>(expenseKeys.list(query), '/expenses', query);
};

export const useMyExpenseSummary = () =>
  useQuery({
    queryKey: expenseKeys.summary({ scope: 'me' }),
    queryFn: () => get<ExpenseSummary>('/expenses/summary', { scope: 'me' }),
    placeholderData: keepPreviousData,
  });

export const useExpense = (id: string | undefined) =>
  useQuery({ queryKey: expenseKeys.detail(id ?? ''), queryFn: () => get<ExpenseDetail>(`/expenses/${id}`), enabled: !!id });

const useInvalidate = () => {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: expenseKeys.all }), qc.invalidateQueries({ queryKey: ['dashboard'] })]);
};

export const uploadReceipt = async (file: UploadFile) =>
  (await upload<{ _id: string }>('/files', file, { context: 'EXPENSE', title: file.name })).data._id;

export interface ExpenseFields {
  category: string;
  amount: number;
  currency: string;
  date: string;
  description: string;
  merchant?: string;
  project?: string;
  receiptFileId?: string;
}

/** Creates (optionally submitting) or updates a draft; submitting an edited draft is a second call. */
export const useSaveExpense = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, fields, submit }: { id?: string; fields: ExpenseFields; submit: boolean }) => {
      if (id) {
        let saved = await patch<ExpenseDetail>(`/expenses/${id}`, fields);
        if (submit) saved = await post<ExpenseDetail>(`/expenses/${id}/submit`);
        return saved;
      }
      const body: Record<string, unknown> = { ...fields, submit };
      if (!fields.merchant) delete body.merchant;
      if (!fields.project) delete body.project;
      return post<ExpenseDetail>('/expenses', body);
    },
    onSuccess: invalidate,
  });
};

export const useExpenseTransition = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'submit' | 'cancel' }) => post<ExpenseDetail>(`/expenses/${id}/${action}`),
    onSuccess: invalidate,
  });
};

/** Whether the user can file expenses from the app (own claims need an employee profile). */
export const useCanClaim = () => useAuth().hasEmployee;
