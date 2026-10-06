import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AttendanceCreateInput,
  AttendanceStatus,
  AttendanceUpdateInput,
  HolidayInput,
  RegularizationInput,
  ShiftAssignmentInput,
  ShiftInput,
} from '@stencil/shared';
import { del, get, getPaged, patch, post, upload } from '@/lib/api';
import { cleanParams } from '@/lib/utils';

/* -------------------------------- Types -------------------------------- */

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
  department?: { _id: string; name: string } | null;
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
  /** Selfie file ids (served by `/files/:id`). */
  checkInPhotoId?: string | null;
  checkOutPhotoId?: string | null;
}

export interface GeoPoint {
  latitude?: number | null;
  longitude?: number | null;
  /** Meters. */
  accuracy?: number | null;
  /** Street address of the point (e.g. "5th Cross, Rajajinagar, Bengaluru, 560010"). */
  address?: string | null;
  /** The employee's office at the time, and where the point was relative to it. */
  officeId?: string | null;
  officeName?: string | null;
  /** Straight-line distance to the office, meters. */
  distanceMeters?: number | null;
  /** Inside the office's geofence (absent when the office has no radius / coordinates). */
  withinOffice?: boolean | null;
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

export interface TrendPoint {
  present: number;
  absent: number;
  late: number;
  onLeave: number;
  workFromHome: number;
  averageHours: number;
  overtimeHours: number;
}

export interface AttendanceDashboard {
  date: string;
  scope: 'all' | 'team' | 'self';
  dayKind: DayKind;
  holiday: string | null;
  totalEmployees: number;
  presentToday: number;
  absentToday: number;
  lateToday: number;
  onLeave: number;
  workFromHome: number;
  notClockedIn: number;
  averageHours: number;
  overtimeHours: number;
  trend: (TrendPoint & { date: string })[];
  byDepartment: { departmentId: string | null; name: string; total: number; present: number; onLeave: number; attendanceRate: number }[];
  monthly: (TrendPoint & { month: string })[];
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

export interface Shift {
  _id: string;
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
  employeeCount?: number;
}

export interface ShiftAssignment {
  _id: string;
  employeeId: PersonRef | null;
  shiftId: ShiftRef | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  assignedBy?: { firstName: string; lastName: string } | null;
  createdAt: string;
}

export interface ScheduleDay {
  date: string;
  dayKind: DayKind;
  holiday: string | null;
  shift: { _id: string | null; name: string; code: string; startTime: string; endTime: string; color: string; nightShift: boolean };
}

export interface ShiftSchedule {
  from: string;
  to: string;
  dates: string[];
  employees: { employee: PersonRef; days: ScheduleDay[] }[];
}

export interface HolidayOccurrence {
  _id: string;
  name: string;
  /** `YYYY-MM-DD` */
  date: string;
  weekday: string;
  type: string;
  description?: string | null;
  recurring: boolean;
  originalDate: string;
  locationIds: { _id: string; name: string; city?: string }[];
}

/* ----------------------------- Attendance ------------------------------ */

export const attendanceKeys = {
  all: ['attendance'] as const,
  today: ['attendance', 'today'] as const,
  list: (q: object) => ['attendance', 'list', q] as const,
  summary: (q: object) => ['attendance', 'summary', q] as const,
  dashboard: (q: object) => ['attendance', 'dashboard', q] as const,
};

export const useToday = (enabled = true) =>
  useQuery({
    queryKey: attendanceKeys.today,
    queryFn: () => get<TodayState>('/attendance/today'),
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

export type ClockAction = 'check-in' | 'check-out' | 'break/start' | 'break/end';

/** Raw clock/break mutation. `silent` skips the global error toast (the caller maps errors itself). */
export const useClockAction = (silent = false) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, body }: { action: ClockAction; body?: Record<string, unknown> }) => post<TodayState>(`/attendance/${action}`, body ?? {}),
    meta: { silent },
    onSuccess: (res) => {
      qc.setQueryData(attendanceKeys.today, res.data);
      void qc.invalidateQueries({ queryKey: attendanceKeys.all, predicate: (q) => q.queryKey[1] !== 'today' });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
};

/** Uploads a clock-in/out selfie; returns the file id. */
export const uploadSelfie = async (photo: Blob) => {
  const type = photo.type || 'image/jpeg';
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  const file = new File([photo], `selfie-${Date.now()}.${ext}`, { type });
  const res = await upload<{ _id: string }>('/files', file, { context: 'ATTENDANCE' });
  return res.data._id;
};

export const useAttendanceList = (query: object, enabled = true) =>
  useQuery({
    queryKey: attendanceKeys.list(query),
    queryFn: () => getPaged<AttendanceRow>('/attendance', cleanParams(query as Record<string, unknown>)),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useAttendanceSummary = (query: { from?: string; to?: string; employeeId?: string; departmentId?: string; scope?: string }, enabled = true) =>
  useQuery({
    queryKey: attendanceKeys.summary(query),
    queryFn: () => get<AttendanceSummary>('/attendance/summary', cleanParams(query)),
    placeholderData: keepPreviousData,
    enabled,
  });

export type BoardColumnKey = 'NOT_IN' | 'WORKING' | 'ON_BREAK' | 'DONE' | 'AWAY';

export interface BoardCard {
  column: BoardColumnKey;
  /** Status only (a colleague on an employee's team board): no times, lateness, location or leave type. */
  restricted: boolean;
  attendanceId: string | null;
  employee: { _id: string; employeeId: string; firstName: string; lastName: string; profilePhoto: string | null; department: string | null; designation: string | null };
  checkIn: string | null;
  checkOut: string | null;
  breakSince: string | null;
  /** Finished breaks so far (minutes), for the live "working for" figure. */
  breakMinutesSoFar: number;
  workingMinutes: number;
  isLate: boolean;
  lateMinutes: number;
  workMode: 'OFFICE' | 'REMOTE' | null;
  /** Marked absent (by the nightly job or HR). */
  absent: boolean;
  awayReason: string | null;
  place: { withinOffice: boolean | null; distanceMeters: number | null; officeName: string | null } | null;
}

export interface AttendanceBoard {
  date: string;
  dayKind: DayKind;
  /** `peers`: a plain employee's own team (manager + teammates), with everyone else's details withheld. */
  scope: 'all' | 'team' | 'peers';
  columns: { key: BoardColumnKey; label: string; count: number }[];
  cards: BoardCard[];
}

/** Live kanban of today's attendance; refreshes every 30 s. */
export const useAttendanceBoard = (query: { scope?: string; departmentId?: string; date?: string }, enabled = true) =>
  useQuery({
    queryKey: ['attendance', 'board', query] as const,
    queryFn: () => get<AttendanceBoard>('/attendance/board', cleanParams(query)),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    enabled,
  });

export const useAttendanceDashboard = (query: { date?: string; scope?: string }, enabled = true) =>
  useQuery({
    queryKey: attendanceKeys.dashboard(query),
    queryFn: () => get<AttendanceDashboard>('/attendance/dashboard', cleanParams(query)),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useCreateAttendance = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AttendanceCreateInput) => post<AttendanceRow>('/attendance', input),
    meta: { silent: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: attendanceKeys.all }),
  });
};

export const useUpdateAttendance = (id: string | undefined) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AttendanceUpdateInput) => patch<AttendanceRow>(`/attendance/${id}`, input),
    meta: { silent: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: attendanceKeys.all }),
  });
};

/* --------------------------- Regularization ---------------------------- */

export const regularizationKeys = {
  all: ['regularizations'] as const,
  list: (q: object) => ['regularizations', 'list', q] as const,
  detail: (id: string) => ['regularizations', 'detail', id] as const,
};

export const useRegularizations = (query: object, enabled = true) =>
  useQuery({
    queryKey: regularizationKeys.list(query),
    queryFn: () => getPaged<Regularization>('/attendance/regularizations', cleanParams(query as Record<string, unknown>)),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useRegularization = (id: string | null) =>
  useQuery({
    queryKey: regularizationKeys.detail(id ?? ''),
    queryFn: () => get<Regularization>(`/attendance/regularizations/${id}`),
    enabled: !!id,
  });

const useInvalidateRegularizations = () => {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: regularizationKeys.all }), qc.invalidateQueries({ queryKey: attendanceKeys.all })]);
};

export const useSubmitRegularization = () => {
  const invalidate = useInvalidateRegularizations();
  return useMutation({
    mutationFn: async ({ input, file }: { input: RegularizationInput; file?: File | null }) => {
      let attachmentId: string | undefined;
      if (file) {
        const res = await upload<{ _id: string }>('/files', file, { context: 'REGULARIZATION' });
        attachmentId = res.data._id;
      }
      return post<Regularization>('/attendance/regularizations', { ...input, attachmentId });
    },
    meta: { silent: true },
    onSuccess: invalidate,
  });
};

export const useRegularizationDecision = () => {
  const invalidate = useInvalidateRegularizations();
  return useMutation({
    mutationFn: ({ id, action, reason, comment }: { id: string; action: 'approve' | 'reject' | 'cancel'; reason?: string; comment?: string }) =>
      post<Regularization>(
        `/attendance/regularizations/${id}/${action}`,
        action === 'reject' ? { reason } : action === 'approve' ? (comment ? { comment } : {}) : undefined,
      ),
    onSuccess: invalidate,
  });
};

/* -------------------------------- Shifts -------------------------------- */

export const shiftKeys = {
  all: ['shifts'] as const,
  list: (q: object) => ['shifts', 'list', q] as const,
  schedule: (q: object) => ['shifts', 'schedule', q] as const,
  assignments: (q: object) => ['shifts', 'assignments', q] as const,
};

export const useShiftList = (query: object) =>
  useQuery({ queryKey: shiftKeys.list(query), queryFn: () => getPaged<Shift>('/shifts', query), placeholderData: keepPreviousData });

export const useAllShifts = () => useQuery({ queryKey: ['shifts', 'all'], queryFn: () => get<Shift[]>('/shifts/all'), staleTime: 5 * 60_000 });

export const useSaveShift = (id?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ShiftInput>) => (id ? patch<Shift>(`/shifts/${id}`, input) : post<Shift>('/shifts', input)),
    meta: { silent: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: shiftKeys.all }),
  });
};

export const useMakeDefaultShift = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => patch<Shift>(`/shifts/${id}`, { isDefault: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: shiftKeys.all }),
  });
};

export const useDeleteShift = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => del(`/shifts/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: shiftKeys.all }) });
};

export const useAssignShift = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ShiftAssignmentInput) =>
      post<{ assigned: number; appliedToProfile: boolean }>('/shifts/assign', input),
    meta: { silent: true },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: shiftKeys.all }), qc.invalidateQueries({ queryKey: ['employees'] })]),
  });
};

export const useShiftSchedule = (query: { from: string; to: string; departmentId?: string }) =>
  useQuery({
    queryKey: shiftKeys.schedule(query),
    queryFn: () => get<ShiftSchedule>('/shifts/schedule', cleanParams(query)),
    placeholderData: keepPreviousData,
  });

export const useShiftAssignments = (query: { page: number; limit: number; employeeId?: string; shiftId?: string }) =>
  useQuery({
    queryKey: shiftKeys.assignments(query),
    queryFn: () => getPaged<ShiftAssignment>('/shifts/assignments', cleanParams(query)),
    placeholderData: keepPreviousData,
  });

/* ------------------------------- Holidays ------------------------------- */

export const holidayKeys = {
  all: ['holidays'] as const,
  list: (q: object) => ['holidays', 'list', q] as const,
  upcoming: ['holidays', 'upcoming'] as const,
};

export const useHolidays = (query: { year: number; locationId?: string; type?: string }) =>
  useQuery({
    queryKey: holidayKeys.list(query),
    queryFn: () => get<HolidayOccurrence[]>('/holidays', cleanParams(query)),
    placeholderData: keepPreviousData,
  });

export const useUpcomingHolidays = (limit = 5) =>
  useQuery({ queryKey: [...holidayKeys.upcoming, limit], queryFn: () => get<HolidayOccurrence[]>('/holidays/upcoming', { limit }) });

export const useSaveHoliday = (id?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HolidayInput) => (id ? patch<unknown>(`/holidays/${id}`, input) : post<unknown>('/holidays', input)),
    meta: { silent: true },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: holidayKeys.all }), qc.invalidateQueries({ queryKey: attendanceKeys.all })]),
  });
};

export const useDeleteHoliday = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => del(`/holidays/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: holidayKeys.all }) });
};
