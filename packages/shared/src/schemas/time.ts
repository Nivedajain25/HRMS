import { z } from 'zod';
import {
  ATTENDANCE_STATUS,
  HALF_DAY_SESSIONS,
  HOLIDAY_TYPES,
  LEAVE_STATUS,
  WORK_MODES,
} from '../enums';
import {
  dateString,
  nullableObjectId,
  objectId,
  optionalDateString,
  optionalEnum,
  optionalObjectId,
  optionalString,
  patchSchema,
  requiredString,
  timeString,
} from './common';

/* ---------------------------- Attendance ---------------------------- */

/** Optional selfie + GPS captured by the device at clock in/out (required per org settings). */
const clockCapture = {
  /** File id from `POST /files` with context ATTENDANCE, uploaded within the last 10 minutes. */
  photoId: optionalObjectId,
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  /** Reported GPS accuracy in meters. */
  accuracy: z.coerce.number().min(0).max(100000).optional(),
  /** Street address for the point (from the device); the server looks it up when missing. */
  address: optionalString(300),
};

export const clockInSchema = z.object({
  workMode: z.enum(WORK_MODES).default('OFFICE'),
  note: optionalString(300),
  ...clockCapture,
});
export const clockOutSchema = z.object({ note: optionalString(300), ...clockCapture });

export const attendanceListQuery = z.object({
  employeeId: optionalObjectId,
  departmentId: optionalObjectId,
  from: optionalDateString,
  to: optionalDateString,
  status: z.enum(ATTENDANCE_STATUS).optional(),
  scope: z.enum(['me', 'team', 'all']).optional(),
});

export const attendanceUpdateSchema = z.object({
  checkIn: z.iso.datetime().nullable().optional(),
  checkOut: z.iso.datetime().nullable().optional(),
  status: optionalEnum(ATTENDANCE_STATUS),
  workMode: optionalEnum(WORK_MODES),
  note: optionalString(300),
});
export type AttendanceUpdateInput = z.infer<typeof attendanceUpdateSchema>;

/** Admin: record/mark attendance for an employee. Times are HH:mm in the org timezone. */
export const attendanceCreateSchema = z
  .object({
    employeeId: objectId,
    date: dateString,
    checkIn: timeString.optional(),
    checkOut: timeString.optional(),
    status: optionalEnum(ATTENDANCE_STATUS),
    workMode: z.enum(WORK_MODES).default('OFFICE'),
    note: optionalString(300),
  })
  .refine((d) => !d.checkOut || !!d.checkIn, { message: 'Check-in is required with check-out', path: ['checkIn'] })
  .refine((d) => !!d.checkIn || !!d.status, { message: 'Provide check-in time or a status', path: ['status'] });
export type AttendanceCreateInput = z.infer<typeof attendanceCreateSchema>;

export const attendanceSummaryQuery = z.object({
  from: optionalDateString,
  to: optionalDateString,
  employeeId: optionalObjectId,
  departmentId: optionalObjectId,
  scope: z.enum(['me', 'team', 'all']).optional(),
});

export const attendanceDashboardQuery = z.object({
  date: optionalDateString,
  scope: z.enum(['team', 'all']).optional(),
});

/** Live board: one card per employee in a column by today's state. */
export const attendanceBoardQuery = attendanceDashboardQuery.extend({
  departmentId: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id').optional(),
});

export const regularizationListQuery = z.object({
  status: z.enum(LEAVE_STATUS).optional(),
  employeeId: optionalObjectId,
  scope: z.enum(['me', 'team', 'all', 'approvals']).optional(),
});

export const regularizationSchema = z
  .object({
    date: dateString,
    requestedCheckIn: timeString,
    requestedCheckOut: timeString,
    reason: requiredString('Reason', 1000),
    attachmentId: optionalObjectId,
  })
  // A check-out earlier than the check-in is an overnight (night shift) correction ending the next day.
  .refine((d) => d.requestedCheckOut !== d.requestedCheckIn, {
    message: 'Check-out must differ from check-in',
    path: ['requestedCheckOut'],
  });
export type RegularizationInput = z.infer<typeof regularizationSchema>;

/* ------------------------------ Shifts ------------------------------ */

export const shiftSchema = z.object({
  name: requiredString('Name', 80),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,12}$/),
  startTime: timeString,
  endTime: timeString,
  gracePeriodMinutes: z.coerce.number().int().min(0).max(240).default(15),
  breakDurationMinutes: z.coerce.number().int().min(0).max(480).default(60),
  workingHours: z.coerce.number().min(0.5).max(24).default(8),
  halfDayHours: z.coerce.number().min(0).max(24).default(4),
  nightShift: z.boolean().default(false),
  flexible: z.boolean().default(false),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
  isDefault: z.boolean().default(false),
});
export type ShiftInput = z.input<typeof shiftSchema>;

export const shiftAssignmentSchema = z
  .object({
    shiftId: objectId,
    employeeIds: z.array(objectId).max(500).optional(),
    departmentId: optionalObjectId,
    effectiveFrom: dateString,
    effectiveTo: optionalDateString,
  })
  .refine((d) => (d.employeeIds?.length ?? 0) > 0 || !!d.departmentId, {
    message: 'Select employees or a department',
    path: ['employeeIds'],
  });
export type ShiftAssignmentInput = z.input<typeof shiftAssignmentSchema>;

/** Partial update without defaults (a `.partial()` of `shiftSchema` would re-apply defaults). */
export const shiftUpdateSchema = z.object({
  name: requiredString('Name', 80).optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,12}$/).optional(),
  startTime: timeString.optional(),
  endTime: timeString.optional(),
  gracePeriodMinutes: z.coerce.number().int().min(0).max(240).optional(),
  breakDurationMinutes: z.coerce.number().int().min(0).max(480).optional(),
  workingHours: z.coerce.number().min(0.5).max(24).optional(),
  halfDayHours: z.coerce.number().min(0).max(24).optional(),
  nightShift: z.boolean().optional(),
  flexible: z.boolean().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isDefault: z.boolean().optional(),
});

export const shiftAssignmentListQuery = z.object({
  employeeId: optionalObjectId,
  shiftId: optionalObjectId,
});

export const shiftScheduleQuery = z
  .object({
    from: dateString,
    to: dateString,
    departmentId: optionalObjectId,
  })
  .refine((d) => d.to >= d.from, { message: 'End date must be on or after start date', path: ['to'] });

/* ----------------------------- Holidays ----------------------------- */

export const holidaySchema = z.object({
  name: requiredString('Name', 120),
  date: dateString,
  type: z.enum(HOLIDAY_TYPES).default('PUBLIC'),
  description: optionalString(500),
  locationIds: z.array(objectId).max(100).default([]),
  recurring: z.boolean().default(false),
});
export type HolidayInput = z.input<typeof holidaySchema>;

/** Partial update without defaults. */
export const holidayUpdateSchema = z.object({
  name: requiredString('Name', 120).optional(),
  date: dateString.optional(),
  type: z.enum(HOLIDAY_TYPES).optional(),
  description: optionalString(500),
  locationIds: z.array(objectId).max(100).optional(),
  recurring: z.boolean().optional(),
});

export const holidayListQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  locationId: optionalObjectId,
  type: z.enum(HOLIDAY_TYPES).optional(),
});

export const holidayUpcomingQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/* ------------------------------- Leave ------------------------------ */

export const leaveTypeSchema = z.object({
  name: requiredString('Name', 80),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,10}$/),
  description: optionalString(500),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0ea5e9'),
  paid: z.boolean().default(true),
  annualAllowance: z.coerce.number().min(0).max(365).default(12),
  accrual: z.enum(['ANNUAL', 'MONTHLY']).default('ANNUAL'),
  carryForward: z.boolean().default(false),
  maximumCarryForward: z.coerce.number().min(0).max(365).default(0),
  encashment: z.boolean().default(false),
  halfDayAllowed: z.boolean().default(true),
  documentRequired: z.boolean().default(false),
  documentRequiredAfterDays: z.coerce.number().int().min(0).max(365).default(0),
  maxConsecutiveDays: z.coerce.number().int().min(0).max(365).default(0),
  minNoticeDays: z.coerce.number().int().min(0).max(365).default(0),
  applicableGenders: z.array(z.enum(['MALE', 'FEMALE', 'NON_BINARY', 'UNDISCLOSED'])).default([]),
  isWorkFromHome: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type LeaveTypeInput = z.input<typeof leaveTypeSchema>;

/** Partial update without defaults (a `.partial()` of `leaveTypeSchema` would re-apply defaults). */
export const leaveTypeUpdateSchema = patchSchema(leaveTypeSchema);

export const leaveTypeListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  sortBy: z.string().regex(/^[a-zA-Z.]{1,40}$/).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  active: z.enum(['true', 'false']).optional(),
});

const leaveRequestBase = z.object({
  leaveTypeId: objectId,
  startDate: dateString,
  endDate: dateString,
  halfDay: z.boolean().default(false),
  halfDaySession: optionalEnum(HALF_DAY_SESSIONS),
  reason: requiredString('Reason', 1000),
  attachmentId: optionalObjectId,
  employeeId: optionalObjectId,
  saveAsDraft: z.boolean().default(false),
});

/** Partial edit of a draft / untouched submitted request (re-validated server-side after merge). */
export const leaveRequestUpdateSchema = z.object({
  leaveTypeId: objectId.optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  halfDay: z.boolean().optional(),
  halfDaySession: z.enum(HALF_DAY_SESSIONS).nullable().optional(),
  reason: requiredString('Reason', 1000).optional(),
  attachmentId: nullableObjectId,
});
export type LeaveRequestUpdateInput = z.input<typeof leaveRequestUpdateSchema>;

export const leaveCancelSchema = z.object({ reason: optionalString(1000) });

export const leaveBalanceQuery = z.object({
  employeeId: optionalObjectId,
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const leaveRequestSchema = leaveRequestBase
  .refine((d) => d.endDate >= d.startDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  })
  .refine((d) => !d.halfDay || d.startDate === d.endDate, {
    message: 'Half day leave must be a single day',
    path: ['halfDay'],
  });
export type LeaveRequestInput = z.input<typeof leaveRequestSchema>;

/**
 * Body of `POST /leaves/preview`: the request without a required reason.
 * `excludeId` is the request being edited (its own dates never count as an overlap).
 */
export const leavePreviewSchema = leaveRequestBase
  .extend({ reason: optionalString(1000), excludeId: optionalObjectId })
  .refine((d) => d.endDate >= d.startDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  })
  .refine((d) => !d.halfDay || d.startDate === d.endDate, {
    message: 'Half day leave must be a single day',
    path: ['halfDay'],
  });
export type LeavePreviewInput = z.input<typeof leavePreviewSchema>;

export const leaveListQuery = z.object({
  /** A leave status, or `PENDING` for anything still awaiting a decision (submitted / pending approval). */
  status: z.enum([...LEAVE_STATUS, 'PENDING']).optional(),
  employeeId: optionalObjectId,
  leaveTypeId: optionalObjectId,
  from: optionalDateString,
  to: optionalDateString,
  scope: z.enum(['me', 'team', 'all', 'approvals']).optional(),
});

export const leaveBalanceAdjustSchema = z.object({
  employeeId: objectId,
  leaveTypeId: objectId,
  year: z.coerce.number().int().min(2000).max(2100),
  adjustment: z.coerce.number().min(-365).max(365),
  reason: requiredString('Reason', 300),
});

export const leaveCarryForwardSchema = z.object({
  fromYear: z.coerce.number().int().min(2000).max(2100),
});

export const leaveCalendarQuery = z.object({
  from: dateString,
  to: dateString,
  departmentId: nullableObjectId,
});
