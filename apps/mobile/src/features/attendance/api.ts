import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttendanceStatus, RegularizationInput } from '@stencil/shared';
import { get, getPaged, post, upload, type UploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/* -------------------------------- Types -------------------------------- */
// Same shapes as the web `features/attendance/api.ts`.

export type LiveState = 'NOT_CHECKED_IN' | 'CHECKED_IN' | 'ON_BREAK' | 'CHECKED_OUT';
export type DayKind = 'WORKING' | 'WEEK_OFF' | 'HOLIDAY';
export type WorkMode = 'OFFICE' | 'REMOTE';

export interface PersonRef {
  _id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  profilePhoto?: string | null;
  departmentId?: { _id: string; name: string } | null;
}

export interface ShiftRef {
  _id: string;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  color?: string;
}

export interface BreakPeriod {
  start: string;
  end: string | null;
}

export interface GeoPoint {
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
}

export interface AttendanceBase {
  _id: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  breaks: BreakPeriod[];
  workMode: WorkMode;
  status: AttendanceStatus;
  workingMinutes: number;
  breakMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  isLate: boolean;
  isEarlyDeparture: boolean;
  note?: string | null;
  source?: string;
  regularized?: boolean;
  checkInLocation?: GeoPoint | null;
  checkOutLocation?: GeoPoint | null;
}

export interface AttendanceRow extends AttendanceBase {
  employeeId: PersonRef;
  shiftId?: ShiftRef | null;
}

export interface ResolvedShift {
  _id: string | null;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  gracePeriodMinutes: number;
  breakDurationMinutes: number;
  workingHours: number;
  halfDayHours: number;
  nightShift: boolean;
  flexible: boolean;
  color: string;
  isDefault: boolean;
}

export interface TodayState {
  date: string;
  state: LiveState;
  record: AttendanceBase | null;
  shift: ResolvedShift;
  shiftStart: string;
  shiftEnd: string;
  dayKind: DayKind;
  holiday: string | null;
  workedMinutesSoFar: number;
  allowRemoteClockIn: boolean;
  requireSelfie: boolean;
  requireLocation: boolean;
  /** Breaks are turned on (web Settings → Attendance, Super Admin only). Missing on older servers. */
  allowBreaks?: boolean;
}

export interface SummaryRow {
  employee: PersonRef;
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  leave: number;
  holiday: number;
  weekOff: number;
  workFromHome: number;
  workedDays: number;
  totalWorkingHours: number;
  overtimeHours: number;
  averageHours: number;
  lateMinutes: number;
}

export interface AttendanceSummary {
  from: string;
  to: string;
  employees: SummaryRow[];
}

export interface ApprovalStep {
  approverType: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED';
  actedByName?: string | null;
  actedAt?: string | null;
  comment?: string | null;
}

export interface Regularization {
  _id: string;
  employeeId: PersonRef;
  date: string;
  requestedCheckIn: string;
  requestedCheckOut: string;
  originalCheckIn: string | null;
  originalCheckOut: string | null;
  reason: string;
  attachmentId?: { _id: string; name?: string; originalName?: string; mimeType?: string; size?: number } | null;
  status: string;
  approvalSteps: ApprovalStep[];
  currentStep: number;
  currentApproverType?: string | null;
  rejectionReason?: string | null;
  submittedAt?: string | null;
  decidedAt?: string | null;
  createdAt: string;
  canAct?: boolean;
  canCancel?: boolean;
}

/* ------------------------------ Attendance ----------------------------- */

export const attendanceKeys = {
  all: ['attendance'] as const,
  today: ['attendance', 'today'] as const,
  list: (q: object) => ['attendance', 'list', q] as const,
  summary: (q: object) => ['attendance', 'summary', q] as const,
};

export const fetchToday = () => get<TodayState>('/attendance/today');

/** Today's attendance (only for users linked to an employee profile). */
export const useToday = () => {
  const { hasEmployee } = useAuth();
  return useQuery({ queryKey: attendanceKeys.today, queryFn: fetchToday, enabled: hasEmployee, refetchInterval: 60_000 });
};

export type ClockAction = 'check-in' | 'check-out' | 'break/start' | 'break/end';

export const useClockAction = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, body }: { action: ClockAction; body?: Record<string, unknown> }) =>
      post<TodayState>(`/attendance/${action}`, body ?? {}),
    onSuccess: (res) => {
      qc.setQueryData(attendanceKeys.today, res.data);
      void qc.invalidateQueries({ queryKey: attendanceKeys.all, predicate: (q) => q.queryKey[1] !== 'today' });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
};

/** Uploads a clock-in/out selfie (`POST /files`, context ATTENDANCE); returns the file id. */
export const uploadSelfie = async (uri: string) => {
  const res = await upload<{ _id: string }>(
    '/files',
    { uri, name: `selfie-${Date.now()}.jpg`, type: 'image/jpeg' },
    { context: 'ATTENDANCE' },
  );
  return res.data._id;
};

export const useAttendanceList = (query: { from: string; to: string; scope?: 'me'; limit?: number; page?: number }, enabled = true) =>
  useQuery({
    queryKey: attendanceKeys.list(query),
    queryFn: () => getPaged<AttendanceRow>('/attendance', { scope: 'me', sortBy: 'date', sortOrder: 'desc', limit: 31, ...query }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useAttendanceSummary = (query: { from: string; to: string }, enabled = true) =>
  useQuery({
    queryKey: attendanceKeys.summary(query),
    queryFn: () => get<AttendanceSummary>('/attendance/summary', { ...query, scope: 'me' }),
    placeholderData: keepPreviousData,
    enabled,
  });

/* --------------------------- Regularization ---------------------------- */

export const regularizationKeys = {
  all: ['regularizations'] as const,
  list: (q: object) => ['regularizations', 'list', q] as const,
  detail: (id: string) => ['regularizations', 'detail', id] as const,
};

export const useMyRegularizations = (status?: string) =>
  useQuery({
    queryKey: regularizationKeys.list({ scope: 'me', status }),
    queryFn: () =>
      getPaged<Regularization>('/attendance/regularizations', { scope: 'me', status, sortBy: 'createdAt', sortOrder: 'desc', limit: 50 }),
    placeholderData: keepPreviousData,
  });

export const useRegularization = (id: string | undefined) =>
  useQuery({
    queryKey: regularizationKeys.detail(id ?? ''),
    queryFn: () => get<Regularization>(`/attendance/regularizations/${id}`),
    enabled: !!id,
  });

const useInvalidateRegularizations = () => {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: regularizationKeys.all }),
      qc.invalidateQueries({ queryKey: attendanceKeys.all }),
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
};

export const useSubmitRegularization = () => {
  const invalidate = useInvalidateRegularizations();
  return useMutation({
    mutationFn: async ({ input, attachment }: { input: RegularizationInput; attachment?: UploadFile | null }) => {
      let attachmentId: string | undefined;
      if (attachment) {
        const res = await upload<{ _id: string }>('/files', attachment, { context: 'REGULARIZATION' });
        attachmentId = res.data._id;
      }
      return post<Regularization>('/attendance/regularizations', { ...input, attachmentId });
    },
    onSuccess: invalidate,
  });
};

export const useCancelRegularization = () => {
  const invalidate = useInvalidateRegularizations();
  return useMutation({
    mutationFn: (id: string) => post<Regularization>(`/attendance/regularizations/${id}/cancel`),
    onSuccess: invalidate,
  });
};
