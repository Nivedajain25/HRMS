import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApproverType, LeaveStatus, LeaveTypeInput, LeaveRequestInput, LeaveRequestUpdateInput } from '@stencil/shared';
import { ApiError, del, get, getPaged, patch, post } from '@/lib/api';

/* -------------------------------- Types -------------------------------- */

export interface LeaveTypeRef {
  _id: string;
  name: string;
  code: string;
  color?: string;
  paid?: boolean;
  isWorkFromHome?: boolean;
  halfDayAllowed?: boolean;
}

export interface LeaveType {
  _id: string;
  name: string;
  code: string;
  description?: string;
  color: string;
  paid: boolean;
  annualAllowance: number;
  accrual: 'ANNUAL' | 'MONTHLY';
  carryForward: boolean;
  maximumCarryForward: number;
  encashment: boolean;
  halfDayAllowed: boolean;
  documentRequired: boolean;
  documentRequiredAfterDays: number;
  maxConsecutiveDays: number;
  minNoticeDays: number;
  applicableGenders: string[];
  isWorkFromHome: boolean;
  active: boolean;
}

export interface LeaveEmployeeRef {
  _id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  profilePhoto?: string | null;
  departmentId?: string | null;
}

export interface ApprovalStep {
  approverType: ApproverType;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED';
  actedBy?: string | null;
  actedByName?: string | null;
  actedAt?: string | null;
  comment?: string | null;
}

export interface LeaveAttachment {
  _id: string;
  title?: string;
  originalName?: string;
  mimeType?: string;
  size?: number;
}

export interface LeaveRequest {
  _id: string;
  employeeId: LeaveEmployeeRef;
  leaveTypeId: LeaveTypeRef;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  halfDaySession?: 'FIRST_HALF' | 'SECOND_HALF' | null;
  days: number;
  reason: string;
  status: LeaveStatus;
  attachmentId?: LeaveAttachment | string | null;
  approvalSteps: ApprovalStep[];
  currentStep: number;
  currentApproverType?: ApproverType | null;
  rejectionReason?: string | null;
  cancellationReason?: string | null;
  submittedAt?: string | null;
  decidedAt?: string | null;
  cancelledAt?: string | null;
  requestedBy?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface LeaveBalance {
  _id: string;
  leaveType: LeaveTypeRef & { active?: boolean };
  year: number;
  opening: number;
  allocated: number;
  carryForward: number;
  adjusted: number;
  used: number;
  pending: number;
  encashed: number;
  remaining: number;
}

export interface LeavePreview {
  days: number;
  workingDates: string[];
  holidays: { date: string; name: string }[];
  weekOffs: string[];
  balance: number | null;
  balanceAfter: number | null;
  unlimited: boolean;
  warnings: { code: string; message: string }[];
}

export interface CalendarLeave {
  _id: string;
  employeeId: LeaveEmployeeRef;
  leaveTypeId?: LeaveTypeRef | string | null;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  halfDaySession?: 'FIRST_HALF' | 'SECOND_HALF' | null;
  days?: number;
  status: LeaveStatus;
  reason?: string;
  /** Colleague leave shown with minimal fields (no type, reason). */
  restricted: boolean;
}

export interface CalendarHoliday {
  date: string;
  name: string;
  type: string;
  optional?: boolean;
  /** Location names the holiday applies to; empty = every location. */
  locations?: string[];
}

export interface LeaveCalendar {
  from: string;
  to: string;
  leaves: CalendarLeave[];
  holidays: CalendarHoliday[];
}

export type LeaveScope = 'me' | 'team' | 'approvals' | 'all';

/* ------------------------------ Query keys ----------------------------- */

export const leaveKeys = {
  all: ['leaves'] as const,
  list: (q: object) => ['leaves', 'list', q] as const,
  detail: (id: string) => ['leaves', 'detail', id] as const,
  balances: (employeeId: string | undefined, year: number) => ['leaves', 'balances', employeeId ?? 'me', year] as const,
  calendar: (from: string, to: string, departmentId?: string) => ['leaves', 'calendar', from, to, departmentId ?? ''] as const,
  preview: (body: object) => ['leaves', 'preview', body] as const,
};

export const leaveTypeKeys = {
  all: ['leave-types'] as const,
  list: (q: object) => ['leave-types', 'list', q] as const,
};

export const isForbidden = (error: unknown) => error instanceof ApiError && error.status === 403;

/* -------------------------------- Queries ------------------------------ */

export const useLeaves = (query: object, enabled = true) =>
  useQuery({ queryKey: leaveKeys.list(query), queryFn: () => getPaged<LeaveRequest>('/leaves', query), placeholderData: keepPreviousData, enabled });

export const useLeave = (id: string | null | undefined) =>
  useQuery({ queryKey: leaveKeys.detail(id ?? ''), queryFn: () => get<LeaveRequest>(`/leaves/${id}`), enabled: !!id });

export const useLeaveBalances = (opts: { employeeId?: string; year: number; enabled?: boolean }) =>
  useQuery({
    queryKey: leaveKeys.balances(opts.employeeId, opts.year),
    queryFn: () => get<LeaveBalance[]>('/leaves/balances', { employeeId: opts.employeeId, year: opts.year }),
    enabled: opts.enabled ?? true,
  });

export const useLeaveCalendar = (from: string, to: string, departmentId?: string) =>
  useQuery({
    queryKey: leaveKeys.calendar(from, to, departmentId),
    queryFn: () => get<LeaveCalendar>('/leaves/calendar', { from, to, departmentId: departmentId || undefined }),
    placeholderData: keepPreviousData,
  });

export const useLeavePreview = (body: LeaveRequestInput | null) =>
  useQuery({
    queryKey: leaveKeys.preview(body ?? {}),
    queryFn: async () => (await post<LeavePreview>('/leaves/preview', body)).data,
    enabled: !!body,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

export const useLeaveTypesPage = (query: object) =>
  useQuery({ queryKey: leaveTypeKeys.list(query), queryFn: () => getPaged<LeaveType>('/leave-types', query), placeholderData: keepPreviousData });

export const useActiveLeaveTypes = () =>
  useQuery({ queryKey: ['leave-types', 'all'], queryFn: () => get<LeaveType[]>('/leave-types/all'), staleTime: 5 * 60_000 });

/* ------------------------------- Mutations ----------------------------- */

const useInvalidateLeaves = () => {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: leaveKeys.all });
};

export const useSaveLeave = (id?: string) => {
  const invalidate = useInvalidateLeaves();
  return useMutation({
    mutationFn: (input: LeaveRequestInput | LeaveRequestUpdateInput) =>
      id ? patch<LeaveRequest>(`/leaves/${id}`, input) : post<LeaveRequest>('/leaves', input),
    meta: { silent: true },
    onSuccess: invalidate,
  });
};

export type LeaveAction = 'approve' | 'reject' | 'cancel' | 'submit';

export const leaveActionRequest = (id: string, action: LeaveAction, body: { comment?: string; reason?: string } = {}) =>
  post<LeaveRequest>(`/leaves/${id}/${action}`, body);

export const useLeaveAction = (opts: { silent?: boolean } = {}) => {
  const invalidate = useInvalidateLeaves();
  return useMutation({
    mutationFn: (v: { id: string; action: LeaveAction; comment?: string; reason?: string }) =>
      leaveActionRequest(v.id, v.action, v.action === 'approve' ? { comment: v.comment } : v.action === 'submit' ? {} : { reason: v.reason }),
    meta: { silent: opts.silent },
    onSuccess: invalidate,
  });
};

export const useAdjustBalance = () => {
  const invalidate = useInvalidateLeaves();
  return useMutation({
    mutationFn: (input: { employeeId: string; leaveTypeId: string; year: number; adjustment: number; reason: string }) =>
      post<LeaveBalance>('/leaves/balances/adjust', input),
    meta: { silent: true },
    onSuccess: invalidate,
  });
};

export const useCarryForward = () => {
  const invalidate = useInvalidateLeaves();
  return useMutation({
    mutationFn: (fromYear: number) => post<{ fromYear: number; toYear: number; processed: number }>('/leaves/balances/carry-forward', { fromYear }),
    onSuccess: invalidate,
  });
};

export const useSaveLeaveType = (id?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LeaveTypeInput) => (id ? patch<LeaveType>(`/leave-types/${id}`, input) : post<LeaveType>('/leave-types', input)),
    meta: { silent: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: leaveTypeKeys.all });
      void qc.invalidateQueries({ queryKey: leaveKeys.all });
    },
  });
};

export const useArchiveLeaveType = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/leave-types/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: leaveTypeKeys.all });
      void qc.invalidateQueries({ queryKey: leaveKeys.all });
    },
  });
};

/* -------------------------------- Helpers ------------------------------ */

export const typeOf = (l: { leaveTypeId?: LeaveTypeRef | string | null }): LeaveTypeRef | null =>
  l.leaveTypeId && typeof l.leaveTypeId === 'object' ? l.leaveTypeId : null;

export const attachmentOf = (l: LeaveRequest): LeaveAttachment | null =>
  !l.attachmentId ? null : typeof l.attachmentId === 'object' ? l.attachmentId : { _id: l.attachmentId };

export const DEFAULT_TYPE_COLOR = '#64748b';

export const formatDays = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1).replace(/\.0$/, '')} ${n === 1 ? 'day' : 'days'}`;

export const formatNum = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

export const PENDING_STATUSES: LeaveStatus[] = ['SUBMITTED', 'PENDING_APPROVAL'];
