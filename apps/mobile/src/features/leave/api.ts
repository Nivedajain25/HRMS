import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApproverType, LeavePreviewInput, LeaveRequestInput, LeaveRequestUpdateInput, LeaveStatus } from '@stencil/shared';
import { get, getPaged, patch, post, upload, type Paged, type UploadFile } from '@/lib/api';

/* -------------------------------- Types -------------------------------- */
// Same shapes as the web `features/leave/api.ts`.

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

export type HalfDaySession = 'FIRST_HALF' | 'SECOND_HALF';

export interface LeaveRequest {
  _id: string;
  employeeId: LeaveEmployeeRef;
  leaveTypeId: LeaveTypeRef | string | null;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  halfDaySession?: HalfDaySession | null;
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
  halfDaySession?: HalfDaySession | null;
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
  calendar: (from: string, to: string) => ['leaves', 'calendar', from, to] as const,
  preview: (body: object) => ['leaves', 'preview', body] as const,
};

export const leaveTypeKeys = {
  all: ['leave-types'] as const,
  active: ['leave-types', 'all'] as const,
};

const PAGE_SIZE = 20;

/** Next page for `useInfiniteQuery` from the API pagination block. */
export const nextPageOf = <T>(last: Paged<T>) =>
  last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined;

/* -------------------------------- Queries ------------------------------ */

export interface LeaveListQuery {
  scope: LeaveScope;
  /** A status, or `PENDING` for anything still awaiting a decision. */
  status?: LeaveStatus | 'PENDING';
  sortBy?: 'startDate' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

/** Paginated leave requests (infinite scroll). */
export const useLeaveList = (query: LeaveListQuery, enabled = true) =>
  useInfiniteQuery({
    queryKey: leaveKeys.list(query),
    queryFn: ({ pageParam }) =>
      getPaged<LeaveRequest>('/leaves', {
        scope: query.scope,
        status: query.status,
        sortBy: query.sortBy ?? 'startDate',
        sortOrder: query.sortOrder ?? 'desc',
        page: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: nextPageOf,
    enabled,
  });

export const useLeave = (id: string | undefined) =>
  useQuery({ queryKey: leaveKeys.detail(id ?? ''), queryFn: () => get<LeaveRequest>(`/leaves/${id}`), enabled: !!id });

export const useLeaveBalances = (opts: { employeeId?: string; year: number; enabled?: boolean }) =>
  useQuery({
    queryKey: leaveKeys.balances(opts.employeeId, opts.year),
    queryFn: () => get<LeaveBalance[]>('/leaves/balances', { employeeId: opts.employeeId, year: opts.year }),
    enabled: opts.enabled ?? true,
    placeholderData: keepPreviousData,
  });

export const useLeaveCalendar = (from: string, to: string) =>
  useQuery({
    queryKey: leaveKeys.calendar(from, to),
    queryFn: () => get<LeaveCalendar>('/leaves/calendar', { from, to }),
    placeholderData: keepPreviousData,
  });

export const useLeavePreview = (body: LeavePreviewInput | null) =>
  useQuery({
    queryKey: leaveKeys.preview(body ?? {}),
    queryFn: async () => (await post<LeavePreview>('/leaves/preview', body)).data,
    enabled: !!body,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    retry: false,
  });

export const useActiveLeaveTypes = () =>
  useQuery({ queryKey: leaveTypeKeys.active, queryFn: () => get<LeaveType[]>('/leave-types/all'), staleTime: 5 * 60_000 });

/* ------------------------------- Mutations ----------------------------- */

/** Leave changes also move balances on the home dashboard. */
export const useInvalidateLeaves = () => {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: leaveKeys.all }), qc.invalidateQueries({ queryKey: ['dashboard'] })]);
};

/** Uploads a supporting document (`POST /files`, context LEAVE); returns the file id. */
export const uploadLeaveAttachment = async (file: UploadFile) =>
  (await upload<{ _id: string }>('/files', file, { context: 'LEAVE', title: file.name })).data._id;

export type SaveLeaveInput =
  | { mode: 'create'; input: LeaveRequestInput }
  | { mode: 'update'; id: string; input: LeaveRequestUpdateInput; submit: boolean };

/** Creates a request (or draft), or updates a draft and optionally submits it. */
export const useSaveLeave = () => {
  const invalidate = useInvalidateLeaves();
  return useMutation({
    mutationFn: async (v: SaveLeaveInput) => {
      if (v.mode === 'create') return post<LeaveRequest>('/leaves', v.input);
      const saved = await patch<LeaveRequest>(`/leaves/${v.id}`, v.input);
      return v.submit ? post<LeaveRequest>(`/leaves/${v.id}/submit`) : saved;
    },
    onSettled: invalidate,
  });
};

export type LeaveAction = 'approve' | 'reject' | 'cancel' | 'submit';

export const useLeaveAction = () => {
  const invalidate = useInvalidateLeaves();
  return useMutation({
    mutationFn: (v: { id: string; action: LeaveAction; comment?: string; reason?: string }) =>
      post<LeaveRequest>(
        `/leaves/${v.id}/${v.action}`,
        v.action === 'approve' ? { comment: v.comment } : v.action === 'submit' ? {} : { reason: v.reason },
      ),
    onSettled: invalidate,
  });
};
