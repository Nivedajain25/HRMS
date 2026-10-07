import { Types, type AnyBulkWriteOperation, type FilterQuery } from 'mongoose';
import type { AttendanceCreateInput, AttendanceStatus, AttendanceUpdateInput, PaginationQuery } from '@stencil/shared';
import { clockInSchema, clockOutSchema } from '@stencil/shared';
import type { z } from 'zod';
import { defineScheduledJob } from '../jobs';
import {
  AttendanceModel,
  DepartmentModel,
  DocumentModel,
  EmployeeModel,
  LeaveRequestModel,
  LeaveTypeModel,
  LocationModel,
  OrganizationModel,
  type Attendance,
  type AttendanceDoc,
} from '../models';
import type { RequestContext } from '../types/context';
import { addDaysKey, dateOnly, monthRange, round2, todayKey, toDateKey, weekdayOf, zonedInstant } from '../utils/dates';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../utils/errors';
import { buildSort, paginate } from '../utils/pagination';
import { closeOpenBreaks, computeMetrics, liveState, officeProximity, shiftWindow, sumBreakMinutes, type BreakPeriod } from './attendance-calc';
import { audit, diff } from './audit.service';
import { buildWorkCalendar, holidaysInRange } from './calendar.service';
import { reverseGeocode } from './geocode.service';
import { assertRefsInOrg } from './refs.service';
import { assertEmployeeAccess, resolveEmployeeScope } from './scope.service';
import { loadOrgAttendanceConfig, resolveShift, type OrgAttendanceConfig, type ResolvedShift } from './shift.service';

const ACTIVE_EMPLOYMENT = { $nin: ['EXITED', 'ARCHIVED'] };
/** Employees whose attendance is tracked (excludes e.g. the owner, marked attendanceExempt). */
const TRACKED = { attendanceExempt: { $ne: true } };
const EMPLOYEE_POPULATE = {
  path: 'employeeId',
  select: 'employeeId firstName lastName profilePhoto departmentId',
  populate: { path: 'departmentId', select: 'name' },
};

const isDuplicateKey = (err: unknown) => typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

/* ------------------------------ Metrics ------------------------------ */

const plainBreaks = (doc: AttendanceDoc): BreakPeriod[] => doc.breaks.map((b) => ({ start: b.start, end: b.end ?? null }));

/**
 * Recomputes every derived field of an attendance record from its instants,
 * the resolved shift and org settings. `statusOverride` (admin) wins over the
 * computed status. Records without a check-in keep their status (ABSENT,
 * LEAVE, HOLIDAY...) with zeroed metrics.
 */
export const applyMetrics = (
  doc: AttendanceDoc,
  shift: ResolvedShift,
  cfg: OrgAttendanceConfig,
  statusOverride?: AttendanceStatus,
) => {
  doc.set('shiftId', shift._id);
  if (!doc.checkIn) {
    doc.set({
      workingMinutes: 0,
      breakMinutes: 0,
      overtimeMinutes: 0,
      lateMinutes: 0,
      earlyDepartureMinutes: 0,
      isLate: false,
      isEarlyDeparture: false,
      status: statusOverride ?? (['PRESENT', 'LATE', 'HALF_DAY', 'WORK_FROM_HOME'].includes(doc.status) ? 'ABSENT' : doc.status),
    });
    return;
  }
  let breaks = plainBreaks(doc);
  if (doc.checkOut) {
    breaks = closeOpenBreaks(breaks, doc.checkOut);
    doc.set('breaks', breaks);
  }
  const m = computeMetrics({
    checkIn: doc.checkIn,
    checkOut: doc.checkOut ?? null,
    breaks,
    workMode: doc.workMode === 'REMOTE' ? 'REMOTE' : 'OFFICE',
    shift,
    window: shiftWindow(toDateKey(doc.date), shift, cfg.timezone),
    overtimeAfterHours: cfg.attendance.overtimeAfterHours,
    halfDayThresholdHours: cfg.attendance.halfDayThresholdHours,
  });
  doc.set({
    workingMinutes: m.workingMinutes,
    breakMinutes: m.breakMinutes,
    overtimeMinutes: m.overtimeMinutes,
    lateMinutes: m.lateMinutes,
    earlyDepartureMinutes: m.earlyDepartureMinutes,
    isLate: m.isLate,
    isEarlyDeparture: m.isEarlyDeparture,
    status: statusOverride ?? m.status,
  });
};

/* ---------------------------- Self-service ---------------------------- */

const requireOwnEmployee = async (ctx: RequestContext) => {
  if (!ctx.employeeId) throw badRequest('No employee profile is linked to your account', 'NO_EMPLOYEE_PROFILE');
  const emp = await EmployeeModel.findOne({ _id: ctx.employeeId, organizationId: ctx.organizationId, deletedAt: null })
    .select('_id shiftId locationId managerId userId firstName lastName')
    .lean();
  if (!emp) throw badRequest('No employee profile is linked to your account', 'NO_EMPLOYEE_PROFILE');
  return emp;
};

type OwnEmployee = Awaited<ReturnType<typeof requireOwnEmployee>>;

/** Today's record, or an open night-shift record from yesterday. */
const findCurrentRecord = async (ctx: RequestContext, emp: OwnEmployee, cfg: OrgAttendanceConfig) => {
  const today = todayKey(cfg.timezone);
  const todays = await AttendanceModel.findOne({ organizationId: ctx.organizationId, employeeId: emp._id, date: dateOnly(today) });
  if (todays?.checkIn && !todays.checkOut) return { record: todays, dateKey: today };
  const yesterday = addDaysKey(today, -1);
  const open = await AttendanceModel.findOne({
    organizationId: ctx.organizationId,
    employeeId: emp._id,
    date: dateOnly(yesterday),
    checkIn: { $ne: null },
    checkOut: null,
  });
  if (open) {
    const shift = await resolveShift(ctx.organizationId, emp, yesterday, cfg.attendance);
    if (shift.nightShift) return { record: open, dateKey: yesterday };
  }
  return { record: todays, dateKey: today };
};

const requireOpenRecord = async (ctx: RequestContext, emp: OwnEmployee, cfg: OrgAttendanceConfig) => {
  const { record, dateKey } = await findCurrentRecord(ctx, emp, cfg);
  if (!record?.checkIn) throw badRequest('You have not checked in yet', 'NOT_CHECKED_IN');
  if (record.checkOut) throw conflict('You have already checked out', 'ALREADY_CHECKED_OUT');
  return { record, dateKey };
};

const appendNote = (current: string | null | undefined, note?: string) =>
  note ? (current ? `${current}\n${note}` : note).slice(0, 1000) : (current ?? undefined);

export const getToday = async (ctx: RequestContext) => {
  // Independent lookups run in parallel: every query is a round trip to the (remote) database.
  const [emp, cfg] = await Promise.all([requireOwnEmployee(ctx), loadOrgAttendanceConfig(ctx.organizationId)]);
  const { record, dateKey } = await findCurrentRecord(ctx, emp, cfg);
  const [shift, calendar] = await Promise.all([
    resolveShift(ctx.organizationId, emp, dateKey, cfg.attendance),
    buildWorkCalendar(ctx.organizationId, dateKey, dateKey, emp._id),
  ]);
  const window = shiftWindow(dateKey, shift, cfg.timezone);
  let workedMinutesSoFar = record?.workingMinutes ?? 0;
  if (record?.checkIn && !record.checkOut) {
    const now = new Date();
    const elapsed = Math.max(0, Math.round((now.getTime() - record.checkIn.getTime()) / 60000));
    workedMinutesSoFar = Math.max(0, elapsed - sumBreakMinutes(plainBreaks(record), record.checkIn, now));
  }
  return {
    date: dateKey,
    state: liveState(record ? { checkIn: record.checkIn, checkOut: record.checkOut, breaks: plainBreaks(record) } : null),
    record: record ? record.toJSON() : null,
    shift,
    shiftStart: window.start,
    shiftEnd: window.end,
    dayKind: calendar.kindOf(dateKey),
    holiday: calendar.holidays.get(dateKey) ?? null,
    workedMinutesSoFar,
    allowRemoteClockIn: cfg.attendance.allowRemoteClockIn,
    requireSelfie: cfg.attendance.requireSelfie,
    requireLocation: cfg.attendance.requireLocation,
    allowBreaks: cfg.attendance.allowBreaks,
  };
};

/** A clock-in/out selfie must be uploaded shortly before it is used. */
const SELFIE_MAX_AGE_MS = 10 * 60 * 1000;

interface ClockCapture {
  photoId?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  address?: string;
}

/**
 * Enforces the organization's selfie / location requirements for self-service
 * clock in/out and validates a supplied selfie: it must be a fresh ATTENDANCE
 * upload by the caller that no attendance record references yet.
 *
 * GPS is stored together with where it was relative to the employee's office
 * (distance, inside/outside the geofence). Being outside never blocks the
 * clock action: it is flagged for HR (attendance list, record and reports).
 */
const resolveCapture = async (
  ctx: RequestContext,
  cfg: OrgAttendanceConfig,
  input: ClockCapture,
  emp: { locationId?: Types.ObjectId | null },
  action: 'check-in' | 'check-out',
) => {
  const hasCoords = input.latitude !== undefined && input.longitude !== undefined;
  // The selfie is taken when clocking IN (clock-out may still carry one, but never requires it).
  // Same for location below.
  if (cfg.attendance.requireSelfie && action === 'check-in' && !input.photoId) {
    throw badRequest('A selfie is required to clock in', 'SELFIE_REQUIRED', [{ path: 'photoId', message: 'Selfie required' }]);
  }
  // Location is mandatory at clock-in; at clock-out it is recorded when the device provides it.
  if (cfg.attendance.requireLocation && action === 'check-in' && !hasCoords) {
    throw badRequest('Your location is required to clock in', 'LOCATION_REQUIRED', [{ path: 'latitude', message: 'Location required' }]);
  }
  let photoId: Types.ObjectId | null = null;
  if (input.photoId) {
    const doc = await DocumentModel.findOne({
      _id: input.photoId,
      organizationId: ctx.organizationId,
      deletedAt: null,
      context: 'ATTENDANCE',
      uploadedBy: ctx.userId,
      createdAt: { $gte: new Date(Date.now() - SELFIE_MAX_AGE_MS) },
    })
      .select('_id')
      .lean();
    const reused =
      !!doc &&
      !!(await AttendanceModel.exists({ organizationId: ctx.organizationId, $or: [{ checkInPhotoId: doc._id }, { checkOutPhotoId: doc._id }] }));
    if (!doc || reused) {
      throw badRequest('The selfie is invalid or has expired. Please take a new photo.', 'INVALID_SELFIE', [{ path: 'photoId', message: 'Take a new photo' }]);
    }
    photoId = doc._id;
  }
  let location: Record<string, unknown> | undefined;
  if (hasCoords) {
    const point = { latitude: input.latitude!, longitude: input.longitude!, ...(input.accuracy !== undefined ? { accuracy: input.accuracy } : {}) };
    const office = emp.locationId
      ? await LocationModel.findOne({ _id: emp.locationId, organizationId: ctx.organizationId }).select('name latitude longitude geofenceRadiusMeters').lean()
      : null;
    const near = office ? officeProximity(point, office) : null;
    // The exact place, in words: from the device when it sent one, else looked up (best-effort, never blocks).
    const address = input.address?.trim() || (await reverseGeocode(point.latitude, point.longitude));
    location = {
      ...point,
      ...(address ? { address } : {}),
      ...(office ? { officeId: office._id, officeName: office.name } : {}),
      ...(near ? { distanceMeters: near.distanceMeters } : {}),
      ...(near && near.withinOffice !== null ? { withinOffice: near.withinOffice } : {}),
    };
  }
  return { hasCoords, photoId, location };
};

export const checkIn = async (ctx: RequestContext, input: z.output<typeof clockInSchema>) => {
  const emp = await requireOwnEmployee(ctx);
  const cfg = await loadOrgAttendanceConfig(ctx.organizationId);
  if (input.workMode === 'REMOTE' && !cfg.attendance.allowRemoteClockIn) {
    throw forbidden('Remote clock-in is not allowed in your organization', 'REMOTE_CLOCK_IN_DISABLED');
  }
  const dateKey = todayKey(cfg.timezone);
  const existing = await AttendanceModel.findOne({ organizationId: ctx.organizationId, employeeId: emp._id, date: dateOnly(dateKey) });
  if (existing?.checkIn) throw conflict('You have already checked in today', 'ALREADY_CHECKED_IN');
  const capture = await resolveCapture(ctx, cfg, input, emp, 'check-in');
  const shift = await resolveShift(ctx.organizationId, emp, dateKey, cfg.attendance);

  const doc = existing ?? new AttendanceModel({ organizationId: ctx.organizationId, employeeId: emp._id, date: dateOnly(dateKey) });
  doc.set({
    checkIn: new Date(),
    checkOut: null,
    breaks: [],
    workMode: input.workMode,
    note: appendNote(existing?.note, input.note),
    checkInLocation: capture.location,
    checkInPhotoId: capture.photoId,
    checkOutLocation: undefined,
    checkOutPhotoId: null,
    source: 'WEB',
  });
  applyMetrics(doc, shift, cfg);
  try {
    await doc.save();
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('You have already checked in today', 'ALREADY_CHECKED_IN');
    throw err;
  }
  return getToday(ctx);
};

export const checkOut = async (ctx: RequestContext, input: z.output<typeof clockOutSchema>) => {
  const emp = await requireOwnEmployee(ctx);
  const cfg = await loadOrgAttendanceConfig(ctx.organizationId);
  const { record, dateKey } = await requireOpenRecord(ctx, emp, cfg);
  const capture = await resolveCapture(ctx, cfg, input, emp, 'check-out');
  const shift = await resolveShift(ctx.organizationId, emp, dateKey, cfg.attendance);
  record.checkOut = new Date();
  record.note = appendNote(record.note, input.note);
  record.set({ checkOutLocation: capture.location, checkOutPhotoId: capture.photoId });
  applyMetrics(record, shift, cfg);
  await record.save();
  return getToday(ctx);
};

export const startBreak = async (ctx: RequestContext) => {
  const emp = await requireOwnEmployee(ctx);
  const cfg = await loadOrgAttendanceConfig(ctx.organizationId);
  // Ending a break stays possible when breaks are turned off, so nobody is stuck "on break".
  if (!cfg.attendance.allowBreaks) throw unprocessable('Breaks are turned off for your organization', 'BREAKS_DISABLED');
  const { record } = await requireOpenRecord(ctx, emp, cfg);
  if (record.breaks.some((b) => !b.end)) throw conflict('You are already on a break', 'ALREADY_ON_BREAK');
  record.breaks.push({ start: new Date(), end: null });
  await record.save();
  return getToday(ctx);
};

export const endBreak = async (ctx: RequestContext) => {
  const emp = await requireOwnEmployee(ctx);
  const cfg = await loadOrgAttendanceConfig(ctx.organizationId);
  const { record, dateKey } = await requireOpenRecord(ctx, emp, cfg);
  const open = record.breaks.find((b) => !b.end);
  if (!open) throw badRequest('You are not on a break', 'NOT_ON_BREAK');
  open.end = new Date();
  const shift = await resolveShift(ctx.organizationId, emp, dateKey, cfg.attendance);
  applyMetrics(record, shift, cfg);
  await record.save();
  return getToday(ctx);
};

/* ------------------------------- Queries ------------------------------ */

/**
 * Employee ids the caller may see, narrowed by optional employee/department
 * filters. `null` = unrestricted (org-wide).
 */
const allowedEmployeeIds = async (
  ctx: RequestContext,
  q: { scope?: string; employeeId?: string; departmentId?: string },
): Promise<Types.ObjectId[] | null> => {
  const scope = await resolveEmployeeScope(ctx, 'attendance:read', q.scope);
  let allowed = scope.employeeIds;
  if (q.employeeId) {
    const id = new Types.ObjectId(q.employeeId);
    if (allowed !== null && !allowed.some((a) => a.equals(id))) throw forbidden('You do not have access to this record');
    allowed = [id];
  }
  if (q.departmentId) {
    const members = await EmployeeModel.find({ organizationId: ctx.organizationId, departmentId: q.departmentId }).select('_id').lean();
    const ids = members.map((m) => m._id);
    allowed = allowed === null ? ids : allowed.filter((a) => ids.some((i) => i.equals(a)));
  }
  return allowed;
};

type ListQuery = PaginationQuery & {
  employeeId?: string;
  departmentId?: string;
  from?: string;
  to?: string;
  status?: string;
  scope?: string;
};

export const listAttendance = async (ctx: RequestContext, q: ListQuery) => {
  const allowed = await allowedEmployeeIds(ctx, q);
  const filter: FilterQuery<Attendance> = { organizationId: ctx.organizationId };
  if (allowed !== null) filter.employeeId = { $in: allowed };
  // Company / team lists leave out people not tracked for attendance (e.g. the super admin); asking for one
  // person by id, or your own records ("me"), still shows them.
  if (!q.employeeId && q.scope !== 'me') {
    const exempt = await EmployeeModel.find({ organizationId: ctx.organizationId, attendanceExempt: true }).distinct('_id');
    if (exempt.length) filter.employeeId = { ...(filter.employeeId ?? {}), $nin: exempt };
  }
  if (q.from || q.to) {
    filter.date = { ...(q.from ? { $gte: dateOnly(q.from) } : {}), ...(q.to ? { $lte: dateOnly(q.to) } : {}) };
  }
  if (q.status) filter.status = q.status;
  return paginate(AttendanceModel, {
    filter,
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['date', 'checkIn', 'checkOut', 'workingMinutes', 'status'], { date: -1, _id: 1 }),
    populate: [EMPLOYEE_POPULATE, { path: 'shiftId', select: 'name code startTime endTime color' }],
  });
};

export const getAttendance = async (ctx: RequestContext, id: string) => {
  const doc = await AttendanceModel.findOne({ _id: id, organizationId: ctx.organizationId })
    .populate([EMPLOYEE_POPULATE, { path: 'shiftId', select: 'name code startTime endTime color' }])
    .lean();
  if (!doc) throw notFound('Attendance record');
  const employee = doc.employeeId as unknown as { _id: Types.ObjectId };
  await assertEmployeeAccess(ctx, employee._id, 'attendance:read');
  return doc;
};

interface SummaryRow {
  _id: Types.ObjectId;
  present: number;
  late: number;
  halfDay: number;
  absent: number;
  leave: number;
  holiday: number;
  weekOff: number;
  workFromHome: number;
  workingMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  workedDays: number;
  records: number;
}

const statusCount = (status: string) => ({ $sum: { $cond: [{ $eq: ['$status', status] }, 1, 0] } });

/**
 * Per-employee summary for a period (default: current month).
 * `present` counts full office days (PRESENT + LATE); `late` counts late
 * arrivals regardless of final status; half days and WFH are counted separately.
 */
export const attendanceSummary = async (
  ctx: RequestContext,
  q: { from?: string; to?: string; employeeId?: string; departmentId?: string; scope?: string },
) => {
  const today = todayKey(ctx.timezone);
  const month = monthRange(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  const from = q.from ?? month.start;
  const to = q.to ?? month.end;
  if (to < from) throw badRequest('End date must be on or after start date', 'VALIDATION_ERROR');
  if (dateOnly(to).getTime() - dateOnly(from).getTime() > 366 * 86_400_000) throw badRequest('The range is limited to one year', 'RANGE_TOO_LARGE');
  const allowed = await allowedEmployeeIds(ctx, q);

  const match: FilterQuery<Attendance> = { organizationId: ctx.organizationId, date: { $gte: dateOnly(from), $lte: dateOnly(to) } };
  if (allowed !== null) match.employeeId = { $in: allowed };
  const rows = await AttendanceModel.aggregate<SummaryRow>([
    { $match: match },
    {
      $group: {
        _id: '$employeeId',
        present: { $sum: { $cond: [{ $in: ['$status', ['PRESENT', 'LATE']] }, 1, 0] } },
        late: { $sum: { $cond: ['$isLate', 1, 0] } },
        halfDay: statusCount('HALF_DAY'),
        absent: statusCount('ABSENT'),
        leave: statusCount('LEAVE'),
        holiday: statusCount('HOLIDAY'),
        weekOff: statusCount('WEEK_OFF'),
        workFromHome: statusCount('WORK_FROM_HOME'),
        workingMinutes: { $sum: '$workingMinutes' },
        overtimeMinutes: { $sum: '$overtimeMinutes' },
        lateMinutes: { $sum: '$lateMinutes' },
        workedDays: { $sum: { $cond: [{ $gt: ['$workingMinutes', 0] }, 1, 0] } },
        records: { $sum: 1 },
      },
    },
  ]);
  const byEmp = new Map(rows.map((r) => [String(r._id), r]));

  const empFilter: FilterQuery<unknown> = { organizationId: ctx.organizationId };
  if (allowed !== null) empFilter._id = { $in: [...new Set([...allowed.map(String), ...rows.map((r) => String(r._id))])] };
  else empFilter.$or = [{ deletedAt: null, employmentStatus: ACTIVE_EMPLOYMENT, ...TRACKED }, { _id: { $in: rows.map((r) => r._id) } }];
  const employees = await EmployeeModel.find(empFilter)
    .select('employeeId firstName lastName profilePhoto departmentId')
    .populate({ path: 'departmentId', select: 'name' })
    .sort({ firstName: 1, lastName: 1 })
    .limit(2000)
    .lean();

  const summaries = employees.map((e) => {
    const r = byEmp.get(String(e._id));
    const workingMinutes = r?.workingMinutes ?? 0;
    const workedDays = r?.workedDays ?? 0;
    return {
      employee: { _id: e._id, employeeId: e.employeeId, firstName: e.firstName, lastName: e.lastName, profilePhoto: e.profilePhoto, department: e.departmentId },
      present: r?.present ?? 0,
      absent: r?.absent ?? 0,
      late: r?.late ?? 0,
      halfDay: r?.halfDay ?? 0,
      leave: r?.leave ?? 0,
      holiday: r?.holiday ?? 0,
      weekOff: r?.weekOff ?? 0,
      workFromHome: r?.workFromHome ?? 0,
      workedDays,
      totalWorkingHours: round2(workingMinutes / 60),
      overtimeHours: round2((r?.overtimeMinutes ?? 0) / 60),
      averageHours: workedDays ? round2(workingMinutes / 60 / workedDays) : 0,
      lateMinutes: r?.lateMinutes ?? 0,
    };
  });
  return { from, to, employees: summaries };
};

interface TrendRow {
  _id: string;
  present: number;
  absent: number;
  late: number;
  leave: number;
  workFromHome: number;
  workingMinutes: number;
  closed: number;
  overtimeMinutes: number;
}

const trendGroup = (key: unknown) => ({
  $group: {
    _id: key,
    present: { $sum: { $cond: [{ $ne: ['$checkIn', null] }, 1, 0] } },
    absent: statusCount('ABSENT'),
    late: { $sum: { $cond: ['$isLate', 1, 0] } },
    leave: statusCount('LEAVE'),
    workFromHome: statusCount('WORK_FROM_HOME'),
    workingMinutes: { $sum: { $cond: [{ $ne: ['$checkOut', null] }, '$workingMinutes', 0] } },
    closed: { $sum: { $cond: [{ $ne: ['$checkOut', null] }, 1, 0] } },
    overtimeMinutes: { $sum: '$overtimeMinutes' },
  },
});

const trendPoint = (r: TrendRow | undefined) => ({
  present: r?.present ?? 0,
  absent: r?.absent ?? 0,
  late: r?.late ?? 0,
  onLeave: r?.leave ?? 0,
  workFromHome: r?.workFromHome ?? 0,
  averageHours: r?.closed ? round2(r.workingMinutes / r.closed / 60) : 0,
  overtimeHours: round2((r?.overtimeMinutes ?? 0) / 60),
});

/**
 * Attendance dashboard for a date (org-wide with `attendance:read`, team
 * otherwise). `presentToday` counts everyone who clocked in (office or remote);
 * `workFromHome` is the remote subset plus approved work-from-home leave.
 */
export type BoardColumn = 'NOT_IN' | 'WORKING' | 'ON_BREAK' | 'DONE' | 'AWAY';
const BOARD_COLUMNS: { key: BoardColumn; label: string }[] = [
  { key: 'NOT_IN', label: 'Yet to clock in' },
  { key: 'WORKING', label: 'Working' },
  { key: 'ON_BREAK', label: 'On break' },
  { key: 'DONE', label: 'Clocked out' },
  { key: 'AWAY', label: 'On leave / off' },
];

/**
 * Kanban board of a day's attendance (default today): every active employee in scope as a card in one column —
 * yet to clock in (incl. marked absent), working, on break, clocked out, or away (leave / holiday / week off).
 * Columns follow real clock actions, so the board is read-only.
 */
export const attendanceBoard = async (ctx: RequestContext, q: { date?: string; scope?: string; departmentId?: string }) => {
  const scope = await resolveEmployeeScope(ctx, 'attendance:read', q.scope);
  const date = q.date ?? todayKey(ctx.timezone);
  const d = dateOnly(date);

  // Plain employees see only their own team — their manager and colleagues sharing that manager, or (when no
  // manager is set) the colleagues in their department — and only whether each person is in, on a break, out or
  // away: times, lateness, absence, leave type and location stay private.
  const peers = scope.scope === 'self' && q.scope !== 'me' && !!ctx.employeeId;
  let ids = scope.employeeIds;
  if (peers) {
    const me = await EmployeeModel.findOne({ _id: ctx.employeeId, organizationId: ctx.organizationId }).select('managerId departmentId').lean();
    if (me?.managerId) {
      const mates = await EmployeeModel.find({ organizationId: ctx.organizationId, managerId: me.managerId, deletedAt: null }).select('_id').lean();
      ids = [ctx.employeeId!, me.managerId, ...mates.map((m) => m._id)];
    } else if (me?.departmentId) {
      const mates = await EmployeeModel.find({ organizationId: ctx.organizationId, departmentId: me.departmentId, deletedAt: null }).select('_id').lean();
      ids = [ctx.employeeId!, ...mates.map((m) => m._id)];
    }
  }
  const selfId = ctx.employeeId ? String(ctx.employeeId) : null;

  const empFilter: FilterQuery<unknown> = {
    organizationId: ctx.organizationId,
    deletedAt: null,
    employmentStatus: ACTIVE_EMPLOYMENT,
    joiningDate: { $lte: d },
    ...TRACKED,
  };
  if (ids !== null) empFilter._id = { $in: ids };
  if (q.departmentId) empFilter.departmentId = new Types.ObjectId(q.departmentId);
  const employees = await EmployeeModel.find(empFilter)
    .select('employeeId firstName lastName profilePhoto departmentId designationId')
    .populate([
      { path: 'departmentId', select: 'name' },
      { path: 'designationId', select: 'name' },
    ])
    .sort({ firstName: 1, lastName: 1 })
    .lean();
  const empIds = employees.map((e) => e._id);

  const [records, leaves, calendar] = await Promise.all([
    AttendanceModel.find({ organizationId: ctx.organizationId, date: d, employeeId: { $in: empIds } })
      .select('employeeId status checkIn checkOut breaks workMode isLate lateMinutes workingMinutes checkInLocation')
      .lean(),
    LeaveRequestModel.find({ organizationId: ctx.organizationId, status: 'APPROVED', startDate: { $lte: d }, endDate: { $gte: d }, employeeId: { $in: empIds } })
      .select('employeeId leaveTypeId halfDay')
      .populate({ path: 'leaveTypeId', select: 'name isWorkFromHome' })
      .lean(),
    buildWorkCalendar(ctx.organizationId, date, date),
  ]);
  const recByEmp = new Map(records.map((r) => [String(r.employeeId), r]));
  const leaveByEmp = new Map<string, { name: string; halfDay: boolean }>();
  for (const l of leaves) {
    const type = l.leaveTypeId as unknown as { name?: string; isWorkFromHome?: boolean } | null;
    if (type?.isWorkFromHome) continue; // WFH leave: still expected to clock in (remotely)
    leaveByEmp.set(String(l.employeeId), { name: type?.name ?? 'Leave', halfDay: !!l.halfDay });
  }
  const dayKind = calendar.kindOf(date);
  const offLabel = dayKind === 'HOLIDAY' ? (calendar.holidays.get(date) ?? 'Holiday') : dayKind === 'WEEK_OFF' ? 'Week off' : null;

  const cards = employees.map((e) => {
    const k = String(e._id);
    const r = recByEmp.get(k);
    const leave = leaveByEmp.get(k);
    const lastBreak = r?.breaks?.[r.breaks.length - 1];
    let column: BoardColumn;
    let awayReason: string | null = null;
    if (r?.checkIn && r.checkOut) column = 'DONE';
    else if (r?.checkIn) column = lastBreak && !lastBreak.end ? 'ON_BREAK' : 'WORKING';
    else if (leave || r?.status === 'LEAVE') {
      column = 'AWAY';
      awayReason = leave ? `${leave.name}${leave.halfDay ? ' (half day)' : ''}` : 'On leave';
    } else if (r?.status === 'HOLIDAY' || r?.status === 'WEEK_OFF' || offLabel) {
      column = 'AWAY';
      awayReason = r?.status === 'WEEK_OFF' ? 'Week off' : r?.status === 'HOLIDAY' ? 'Holiday' : offLabel;
    } else column = 'NOT_IN';
    const loc = r?.checkInLocation as { latitude?: number; withinOffice?: boolean; distanceMeters?: number; officeName?: string; address?: string } | undefined;
    if (peers && k !== selfId) {
      return {
        column,
        restricted: true,
        attendanceId: null,
        employee: {
          _id: e._id,
          employeeId: e.employeeId,
          firstName: e.firstName,
          lastName: e.lastName,
          profilePhoto: e.profilePhoto ?? null,
          department: (e.departmentId as unknown as { name?: string } | null)?.name ?? null,
          designation: (e.designationId as unknown as { name?: string } | null)?.name ?? null,
        },
        checkIn: null,
        checkOut: null,
        breakSince: null,
        breakMinutesSoFar: 0,
        workingMinutes: 0,
        isLate: false,
        lateMinutes: 0,
        workMode: null,
        absent: false,
        awayReason: column === 'AWAY' ? (leave ? 'On leave' : awayReason) : null,
        place: null,
      };
    }
    return {
      column,
      restricted: false,
      attendanceId: r?._id ?? null,
      employee: {
        _id: e._id,
        employeeId: e.employeeId,
        firstName: e.firstName,
        lastName: e.lastName,
        profilePhoto: e.profilePhoto ?? null,
        department: (e.departmentId as unknown as { name?: string } | null)?.name ?? null,
        designation: (e.designationId as unknown as { name?: string } | null)?.name ?? null,
      },
      checkIn: r?.checkIn ?? null,
      checkOut: r?.checkOut ?? null,
      breakSince: column === 'ON_BREAK' ? (lastBreak?.start ?? null) : null,
      breakMinutesSoFar: (r?.breaks ?? []).reduce((a, b) => a + (b.end ? Math.max(0, Math.round((b.end.getTime() - b.start.getTime()) / 60000)) : 0), 0),
      workingMinutes: r?.workingMinutes ?? 0,
      isLate: !!r?.isLate,
      lateMinutes: r?.lateMinutes ?? 0,
      workMode: r?.checkIn ? (r.workMode ?? 'OFFICE') : null,
      absent: r?.status === 'ABSENT',
      awayReason,
      place:
        typeof loc?.latitude === 'number'
          ? { withinOffice: loc.withinOffice ?? null, distanceMeters: loc.distanceMeters ?? null, officeName: loc.officeName ?? null, address: loc.address ?? null }
          : null,
    };
  });

  // Earliest arrivals first while working; latest leavers first when done.
  const time = (v: Date | null) => (v ? v.getTime() : 0);
  cards.sort((a, b) =>
    a.column !== b.column
      ? 0
      : a.column === 'WORKING' || a.column === 'ON_BREAK'
        ? time(a.checkIn) - time(b.checkIn)
        : a.column === 'DONE'
          ? time(b.checkOut) - time(a.checkOut)
          : 0,
  );
  const { allowBreaks } = (await loadOrgAttendanceConfig(ctx.organizationId)).attendance;
  const columns = BOARD_COLUMNS.map((c) => ({ ...c, count: cards.filter((x) => x.column === c.key).length }));
  return {
    date,
    dayKind,
    scope: scope.employeeIds === null ? 'all' : peers ? 'peers' : 'team',
    allowBreaks,
    // No "On break" column while breaks are turned off (unless someone is still on one).
    columns: columns.filter((c) => c.key !== 'ON_BREAK' || allowBreaks || c.count > 0),
    cards,
  };
};

export const attendanceDashboard = async (ctx: RequestContext, q: { date?: string; scope?: string }) => {
  const scope = await resolveEmployeeScope(ctx, 'attendance:read', q.scope);
  const today = todayKey(ctx.timezone);
  const date = q.date ?? today;
  const d = dateOnly(date);

  const empFilter: FilterQuery<unknown> = {
    organizationId: ctx.organizationId,
    deletedAt: null,
    employmentStatus: ACTIVE_EMPLOYMENT,
    joiningDate: { $lte: d },
    ...TRACKED,
  };
  if (scope.employeeIds !== null) empFilter._id = { $in: scope.employeeIds };
  const employees = await EmployeeModel.find(empFilter).select('_id departmentId').lean();
  const empIds = employees.map((e) => e._id);

  const [records, leaves, calendar] = await Promise.all([
    AttendanceModel.find({ organizationId: ctx.organizationId, date: d, employeeId: { $in: empIds } }).lean(),
    LeaveRequestModel.find({ organizationId: ctx.organizationId, status: 'APPROVED', startDate: { $lte: d }, endDate: { $gte: d }, employeeId: { $in: empIds } })
      .select('employeeId leaveTypeId')
      .lean(),
    buildWorkCalendar(ctx.organizationId, date, date),
  ]);
  const wfhTypes = new Set(
    (await LeaveTypeModel.find({ organizationId: ctx.organizationId, _id: { $in: leaves.map((l) => l.leaveTypeId) }, isWorkFromHome: true }).select('_id').lean()).map((t) => String(t._id)),
  );

  const recByEmp = new Map(records.map((r) => [String(r.employeeId), r]));
  const onLeave = new Set<string>();
  const wfhLeave = new Set<string>();
  for (const l of leaves) (wfhTypes.has(String(l.leaveTypeId)) ? wfhLeave : onLeave).add(String(l.employeeId));
  for (const r of records) if (r.status === 'LEAVE') onLeave.add(String(r.employeeId));

  const clockedIn = records.filter((r) => r.checkIn);
  const closed = clockedIn.filter((r) => r.checkOut);
  const wfh = new Set<string>([...clockedIn.filter((r) => r.workMode === 'REMOTE' || r.status === 'WORK_FROM_HOME').map((r) => String(r.employeeId)), ...wfhLeave]);
  const dayKind = calendar.kindOf(date);
  let absent = records.filter((r) => r.status === 'ABSENT').length;
  let notClockedIn = 0;
  if (dayKind === 'WORKING') {
    const missing = employees.filter((e) => {
      const k = String(e._id);
      const r = recByEmp.get(k);
      return !r?.checkIn && !onLeave.has(k) && !wfhLeave.has(k) && r?.status !== 'ABSENT' && r?.status !== 'HOLIDAY' && r?.status !== 'WEEK_OFF';
    }).length;
    if (date < today) absent += missing;
    else if (date === today) notClockedIn = missing;
  }

  // 14-day trend and 6-month series.
  const scopeMatch: FilterQuery<Attendance> = { organizationId: ctx.organizationId };
  if (scope.employeeIds !== null) scopeMatch.employeeId = { $in: scope.employeeIds };
  const trendFrom = addDaysKey(date, -13);
  const monthStart = monthRange(Number(date.slice(0, 4)), Number(date.slice(5, 7))).start;
  const sixMonthsFrom = (() => {
    let y = Number(date.slice(0, 4));
    let m = Number(date.slice(5, 7)) - 5;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    return `${y}-${String(m).padStart(2, '0')}-01`;
  })();
  const [trendRows, monthRows, departments] = await Promise.all([
    AttendanceModel.aggregate<TrendRow>([
      { $match: { ...scopeMatch, date: { $gte: dateOnly(trendFrom), $lte: d } } },
      trendGroup({ $dateToString: { format: '%Y-%m-%d', date: '$date' } }),
    ]),
    AttendanceModel.aggregate<TrendRow>([
      { $match: { ...scopeMatch, date: { $gte: dateOnly(sixMonthsFrom), $lte: dateOnly(monthRange(Number(date.slice(0, 4)), Number(date.slice(5, 7))).end) } } },
      trendGroup({ $dateToString: { format: '%Y-%m', date: '$date' } }),
    ]),
    DepartmentModel.find({ organizationId: ctx.organizationId, _id: { $in: [...new Set(employees.map((e) => String(e.departmentId ?? '')).filter(Boolean))] } })
      .select('name')
      .lean(),
  ]);
  const trendByDay = new Map(trendRows.map((r) => [r._id, r]));
  const trend = [];
  for (let k = trendFrom; k <= date; k = addDaysKey(k, 1)) trend.push({ date: k, ...trendPoint(trendByDay.get(k)) });
  const monthByKey = new Map(monthRows.map((r) => [r._id, r]));
  const monthly = [];
  for (let k = sixMonthsFrom; k <= monthStart; ) {
    const key = k.slice(0, 7);
    monthly.push({ month: key, ...trendPoint(monthByKey.get(key)) });
    const [y, m] = key.split('-').map(Number);
    k = m === 12 ? `${y! + 1}-01-01` : `${y}-${String(m! + 1).padStart(2, '0')}-01`;
  }

  const deptName = new Map(departments.map((x) => [String(x._id), x.name]));
  const deptStats = new Map<string, { departmentId: string | null; name: string; total: number; present: number; onLeave: number }>();
  for (const e of employees) {
    const key = String(e.departmentId ?? '');
    const s = deptStats.get(key) ?? { departmentId: key || null, name: deptName.get(key) ?? 'Unassigned', total: 0, present: 0, onLeave: 0 };
    s.total += 1;
    if (recByEmp.get(String(e._id))?.checkIn) s.present += 1;
    if (onLeave.has(String(e._id))) s.onLeave += 1;
    deptStats.set(key, s);
  }
  const byDepartment = [...deptStats.values()]
    .map((s) => ({ ...s, attendanceRate: s.total ? round2((s.present / s.total) * 100) : 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    date,
    scope: scope.scope,
    dayKind,
    holiday: calendar.holidays.get(date) ?? null,
    totalEmployees: employees.length,
    presentToday: clockedIn.length,
    absentToday: absent,
    lateToday: clockedIn.filter((r) => r.isLate).length,
    onLeave: onLeave.size,
    workFromHome: wfh.size,
    notClockedIn,
    averageHours: closed.length ? round2(closed.reduce((s, r) => s + r.workingMinutes, 0) / closed.length / 60) : 0,
    overtimeHours: round2(clockedIn.reduce((s, r) => s + r.overtimeMinutes, 0) / 60),
    trend,
    byDepartment,
    monthly,
  };
};

/* ------------------------------- Admin -------------------------------- */

const AUDIT_FIELDS = ['checkIn', 'checkOut', 'status', 'workMode', 'note', 'workingMinutes', 'overtimeMinutes', 'lateMinutes', 'breakMinutes'] as const;
const snapshot = (doc: AttendanceDoc) => Object.fromEntries(AUDIT_FIELDS.map((k) => [k, doc.get(k) as unknown]));

export const updateAttendance = async (ctx: RequestContext, id: string, input: AttendanceUpdateInput) => {
  const doc = await AttendanceModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!doc) throw notFound('Attendance record');
  const emp = await EmployeeModel.findOne({ _id: doc.employeeId, organizationId: ctx.organizationId }).select('_id shiftId firstName lastName employeeId').lean();
  if (!emp) throw notFound('Employee');
  const before = snapshot(doc);

  if (input.checkIn !== undefined) doc.checkIn = input.checkIn ? new Date(input.checkIn) : null;
  if (input.checkOut !== undefined) doc.checkOut = input.checkOut ? new Date(input.checkOut) : null;
  if (doc.checkOut && !doc.checkIn) throw badRequest('Check-in is required when check-out is set', 'VALIDATION_ERROR', [{ path: 'checkIn', message: 'Required with check-out' }]);
  if (doc.checkIn && doc.checkOut && doc.checkOut <= doc.checkIn) {
    throw badRequest('Check-out must be after check-in', 'VALIDATION_ERROR', [{ path: 'checkOut', message: 'Must be after check-in' }]);
  }
  if (doc.checkIn && doc.checkIn.getTime() > Date.now() + 60_000) throw badRequest('Check-in cannot be in the future', 'VALIDATION_ERROR');
  if (input.workMode) doc.workMode = input.workMode;
  if (input.note !== undefined) doc.note = input.note;
  // Drop breaks that fall outside the corrected window.
  if (doc.checkIn) {
    const inWindow = plainBreaks(doc).filter((b) => b.start >= doc.checkIn! && (!doc.checkOut || b.start < doc.checkOut));
    doc.set('breaks', inWindow);
  } else {
    doc.set('breaks', []);
  }

  const cfg = await loadOrgAttendanceConfig(ctx.organizationId);
  const shift = await resolveShift(ctx.organizationId, emp, toDateKey(doc.date), cfg.attendance);
  applyMetrics(doc, shift, cfg, input.status);
  await doc.save();

  await audit(ctx, {
    action: 'ATTENDANCE_UPDATED',
    module: 'attendance',
    recordId: doc._id,
    recordLabel: `${emp.firstName} ${emp.lastName} (${emp.employeeId}) — ${toDateKey(doc.date)}`,
    ...diff(before, snapshot(doc)),
  });
  return getAttendance(ctx, id);
};

export const createAttendance = async (ctx: RequestContext, input: AttendanceCreateInput) => {
  await assertRefsInOrg(ctx.organizationId, { employeeId: input.employeeId }, ['employeeId']);
  const emp = await EmployeeModel.findOne({ _id: input.employeeId, organizationId: ctx.organizationId }).select('_id shiftId firstName lastName employeeId').lean();
  if (!emp) throw notFound('Employee');
  const cfg = await loadOrgAttendanceConfig(ctx.organizationId);
  if (input.checkIn && input.date > todayKey(cfg.timezone)) throw badRequest('Attendance cannot be recorded for a future date', 'FUTURE_DATE');
  if (await AttendanceModel.exists({ organizationId: ctx.organizationId, employeeId: emp._id, date: dateOnly(input.date) })) {
    throw conflict('Attendance already exists for this date; edit the existing record instead', 'ATTENDANCE_EXISTS');
  }
  const checkIn = input.checkIn ? zonedInstant(input.date, input.checkIn, cfg.timezone) : null;
  const checkOut = input.checkIn && input.checkOut
    ? zonedInstant(input.checkOut <= input.checkIn ? addDaysKey(input.date, 1) : input.date, input.checkOut, cfg.timezone)
    : null;
  if (checkOut && checkOut.getTime() > Date.now() + 60_000) throw badRequest('Check-out cannot be in the future', 'FUTURE_DATE');

  const doc = new AttendanceModel({
    organizationId: ctx.organizationId,
    employeeId: emp._id,
    date: dateOnly(input.date),
    checkIn,
    checkOut,
    workMode: input.workMode,
    note: input.note,
    status: input.status ?? 'ABSENT',
    source: 'ADMIN',
  });
  const shift = await resolveShift(ctx.organizationId, emp, input.date, cfg.attendance);
  applyMetrics(doc, shift, cfg, input.status);
  try {
    await doc.save();
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('Attendance already exists for this date', 'ATTENDANCE_EXISTS');
    throw err;
  }
  await audit(ctx, {
    action: 'ATTENDANCE_UPDATED',
    module: 'attendance',
    recordId: doc._id,
    recordLabel: `${emp.firstName} ${emp.lastName} (${emp.employeeId}) — ${input.date}`,
    oldValues: null,
    newValues: snapshot(doc),
  });
  return getAttendance(ctx, String(doc._id));
};

/* -------------------------------- Jobs -------------------------------- */

/** Hours after shift end before an open record is auto clocked-out. */
const AUTO_CLOSE_AFTER_HOURS = 4;

/** Closes records from past days that have a check-in but no check-out (checkOut = shift end). */
export const autoCloseOpenRecords = async (organizationId: Types.ObjectId, now = new Date()) => {
  const cfg = await loadOrgAttendanceConfig(organizationId);
  const today = dateOnly(todayKey(cfg.timezone));
  const open = await AttendanceModel.find({ organizationId, checkIn: { $ne: null }, checkOut: null, date: { $lt: today } }).limit(5000);
  let closed = 0;
  for (const doc of open) {
    const emp = await EmployeeModel.findOne({ _id: doc.employeeId, organizationId }).select('_id shiftId').lean();
    if (!emp) continue;
    const shift = await resolveShift(organizationId, emp, toDateKey(doc.date), cfg.attendance);
    const window = shiftWindow(toDateKey(doc.date), shift, cfg.timezone);
    if (window.end.getTime() + AUTO_CLOSE_AFTER_HOURS * 3_600_000 > now.getTime()) continue;
    doc.checkOut = doc.checkIn! > window.end ? doc.checkIn : window.end;
    doc.note = appendNote(doc.note, 'Auto clock-out');
    applyMetrics(doc, shift, cfg);
    await doc.save();
    closed += 1;
  }
  return closed;
};

/**
 * Marks the previous day (org timezone) for active employees without a
 * record: HOLIDAY, WEEK_OFF, LEAVE / WORK_FROM_HOME (approved leave) or
 * ABSENT. Idempotent: only inserts missing records.
 */
export const autoMarkPreviousDay = async (organizationId: Types.ObjectId) => {
  const cfg = await loadOrgAttendanceConfig(organizationId);
  if (!cfg.attendance.autoMarkAbsent) return 0;
  const day = addDaysKey(todayKey(cfg.timezone), -1);
  const d = dateOnly(day);
  const employees = await EmployeeModel.find({
    organizationId,
    deletedAt: null,
    employmentStatus: ACTIVE_EMPLOYMENT,
    joiningDate: { $lte: d },
    $or: [{ exitDate: null }, { exitDate: { $gte: d } }],
    ...TRACKED,
  })
    .select('_id locationId')
    .lean();
  if (!employees.length) return 0;
  const existing = new Set(
    (await AttendanceModel.find({ organizationId, date: d, employeeId: { $in: employees.map((e) => e._id) } }).select('employeeId').lean()).map((r) => String(r.employeeId)),
  );
  const missing = employees.filter((e) => !existing.has(String(e._id)));
  if (!missing.length) return 0;

  const leaves = await LeaveRequestModel.find({
    organizationId,
    status: 'APPROVED',
    startDate: { $lte: d },
    endDate: { $gte: d },
    employeeId: { $in: missing.map((e) => e._id) },
  })
    .select('employeeId leaveTypeId halfDay')
    .lean();
  const wfhTypes = new Set(
    (await LeaveTypeModel.find({ organizationId, _id: { $in: leaves.map((l) => l.leaveTypeId) }, isWorkFromHome: true }).select('_id').lean()).map((t) => String(t._id)),
  );
  const leaveByEmp = new Map(leaves.map((l) => [String(l.employeeId), l]));
  const holidayCache = new Map<string, Map<string, { name: string; optional: boolean }>>();
  const isWorkingWeekday = cfg.workingDays.includes(weekdayOf(day));

  const ops: AnyBulkWriteOperation<Attendance>[] = [];
  for (const e of missing) {
    const locKey = String(e.locationId ?? '');
    let holidays = holidayCache.get(locKey);
    if (!holidays) {
      holidays = await holidaysInRange(organizationId, day, day, e.locationId ?? null);
      holidayCache.set(locKey, holidays);
    }
    const holiday = holidays.get(day);
    const leave = leaveByEmp.get(String(e._id));
    let status: AttendanceStatus;
    let note: string | undefined;
    if (holiday && !holiday.optional) {
      status = 'HOLIDAY';
      note = holiday.name;
    } else if (!isWorkingWeekday) {
      status = 'WEEK_OFF';
    } else if (leave) {
      status = wfhTypes.has(String(leave.leaveTypeId)) ? 'WORK_FROM_HOME' : 'LEAVE';
      note = leave.halfDay ? 'Half-day leave' : 'Approved leave';
    } else {
      status = 'ABSENT';
    }
    ops.push({
      updateOne: {
        filter: { organizationId, employeeId: e._id, date: d },
        update: {
          $setOnInsert: {
            organizationId,
            employeeId: e._id,
            date: d,
            status,
            note,
            source: 'SYSTEM',
            workMode: status === 'WORK_FROM_HOME' ? 'REMOTE' : 'OFFICE',
          },
        },
        upsert: true,
      },
    });
  }
  const res = await AttendanceModel.bulkWrite(ops, { ordered: false });
  return res.upsertedCount;
};

export const runAttendanceAutoJobs = async (now = new Date()) => {
  const orgs = await OrganizationModel.find({ status: 'ACTIVE' }).select('_id').lean();
  let closed = 0;
  let marked = 0;
  for (const org of orgs) {
    closed += await autoCloseOpenRecords(org._id, now);
    marked += await autoMarkPreviousDay(org._id);
  }
  return { closed, marked };
};

/**
 * Registers `attendance.auto-absent`. It runs hourly (idempotent) so that
 * every organization timezone gets its previous day marked soon after
 * local midnight and night-shift records are auto-closed promptly.
 */
export const registerAttendanceJobs = () => {
  defineScheduledJob({
    name: 'attendance.auto-absent',
    schedule: '20 * * * *',
    handler: async () => {
      await runAttendanceAutoJobs();
    },
  });
};
