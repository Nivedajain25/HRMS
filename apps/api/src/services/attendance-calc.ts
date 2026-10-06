import { addDaysKey, zonedInstant } from '../utils/dates';

/**
 * Pure attendance calculations (no database access) so every rule can be
 * unit-tested deterministically.
 *
 * Rules:
 *  - breakMinutes   = sum of closed breaks; a break still open at check-out is
 *                     closed at check-out. Break time is clipped to the
 *                     check-in/check-out window.
 *  - workingMinutes = (checkOut - checkIn) - breakMinutes (0 until check-out).
 *  - lateMinutes    = max(0, checkIn - (shiftStart + grace)); never for flexible shifts.
 *  - earlyDeparture = shiftEnd - checkOut when checking out before shift end;
 *                     never for flexible shifts.
 *  - overtime       = working time beyond the LARGER of the shift's working
 *                     hours and the organization's `overtimeAfterHours`
 *                     threshold. Example: 8h shift, 9h threshold, 9.5h worked
 *                     → 30 minutes overtime.
 *  - status         = WORK_FROM_HOME when remote; otherwise HALF_DAY when the
 *                     worked time at check-out is below the half-day hours;
 *                     LATE when late; else PRESENT. Clocking in on a holiday or
 *                     week-off still yields PRESENT / WORK_FROM_HOME (the day
 *                     kind is reported separately).
 *  - Night shifts: when the shift end is at or before its start, the end is on
 *    the next calendar day.
 */

export type WorkMode = 'OFFICE' | 'REMOTE';
export type ComputedStatus = 'PRESENT' | 'LATE' | 'HALF_DAY' | 'WORK_FROM_HOME';

export interface ShiftRule {
  startTime: string;
  endTime: string;
  gracePeriodMinutes: number;
  breakDurationMinutes?: number;
  workingHours: number;
  halfDayHours: number;
  flexible: boolean;
  nightShift?: boolean;
}

export interface ShiftWindow {
  start: Date;
  end: Date;
}

export interface BreakPeriod {
  start: Date;
  end: Date | null;
}

export interface MetricsInput {
  checkIn: Date | null;
  checkOut: Date | null;
  breaks: BreakPeriod[];
  workMode: WorkMode;
  shift: ShiftRule;
  window: ShiftWindow;
  /** Organization `settings.attendance.overtimeAfterHours`. */
  overtimeAfterHours: number;
  /** Fallback half-day threshold when the shift defines none (org setting). */
  halfDayThresholdHours?: number;
}

export interface AttendanceMetrics {
  workingMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  isLate: boolean;
  earlyDepartureMinutes: number;
  isEarlyDeparture: boolean;
  overtimeMinutes: number;
  status: ComputedStatus;
}

const MINUTE = 60_000;
const diffMinutes = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / MINUTE));

export const toMinutesOfDay = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Does the shift cross midnight? (end at or before start) */
export const spansMidnight = (shift: Pick<ShiftRule, 'startTime' | 'endTime'>) =>
  toMinutesOfDay(shift.endTime) <= toMinutesOfDay(shift.startTime);

/** Shift start/end instants for a calendar date in the organization timezone. */
export const shiftWindow = (dateKey: string, shift: Pick<ShiftRule, 'startTime' | 'endTime'>, timeZone: string): ShiftWindow => {
  const start = zonedInstant(dateKey, shift.startTime, timeZone);
  const endKey = spansMidnight(shift) ? addDaysKey(dateKey, 1) : dateKey;
  return { start, end: zonedInstant(endKey, shift.endTime, timeZone) };
};

/** Closes any open break at `at` (used at check-out). */
export const closeOpenBreaks = (breaks: BreakPeriod[], at: Date): BreakPeriod[] =>
  breaks.map((b) => (b.end ? b : { start: b.start, end: at < b.start ? b.start : at }));

/** Sum of break minutes, clipped to [from, to]. Open breaks count up to `to` when given. */
export const sumBreakMinutes = (breaks: BreakPeriod[], from?: Date | null, to?: Date | null) => {
  let total = 0;
  for (const b of breaks) {
    const end = b.end ?? to ?? null;
    if (!end) continue;
    const s = from && b.start < from ? from : b.start;
    const e = to && end > to ? to : end;
    if (e > s) total += diffMinutes(s, e);
  }
  return total;
};

/** Overtime threshold in minutes: the larger of shift hours and the org threshold. */
export const overtimeThresholdMinutes = (shiftWorkingHours: number, overtimeAfterHours: number) =>
  Math.round(Math.max(shiftWorkingHours || 0, overtimeAfterHours || 0) * 60);

export const computeMetrics = (input: MetricsInput): AttendanceMetrics => {
  const { checkIn, checkOut, shift, window } = input;
  const breaks = checkOut ? closeOpenBreaks(input.breaks, checkOut) : input.breaks;

  const breakMinutes = checkIn && checkOut ? sumBreakMinutes(breaks, checkIn, checkOut) : sumBreakMinutes(breaks.filter((b) => b.end), checkIn);
  const workingMinutes = checkIn && checkOut ? Math.max(0, diffMinutes(checkIn, checkOut) - breakMinutes) : 0;

  let lateMinutes = 0;
  if (checkIn && !shift.flexible) {
    const allowed = new Date(window.start.getTime() + (shift.gracePeriodMinutes || 0) * MINUTE);
    lateMinutes = checkIn > allowed ? diffMinutes(allowed, checkIn) : 0;
  }

  let earlyDepartureMinutes = 0;
  if (checkOut && !shift.flexible && checkOut < window.end) earlyDepartureMinutes = diffMinutes(checkOut, window.end);

  const threshold = overtimeThresholdMinutes(shift.workingHours, input.overtimeAfterHours);
  const overtimeMinutes = checkOut ? Math.max(0, workingMinutes - threshold) : 0;

  const halfDayHours = shift.halfDayHours > 0 ? shift.halfDayHours : (input.halfDayThresholdHours ?? 0);
  let status: ComputedStatus;
  if (input.workMode === 'REMOTE') status = 'WORK_FROM_HOME';
  else if (checkOut && workingMinutes < halfDayHours * 60) status = 'HALF_DAY';
  else if (lateMinutes > 0) status = 'LATE';
  else status = 'PRESENT';

  return {
    workingMinutes,
    breakMinutes,
    lateMinutes,
    isLate: lateMinutes > 0,
    earlyDepartureMinutes,
    isEarlyDeparture: earlyDepartureMinutes > 0,
    overtimeMinutes,
    status,
  };
};

/**
 * Shift used when an organization has no shift at all: built from
 * `settings.attendance.defaultShiftStart/End` with a one-hour break.
 */
export const fallbackShift = (settings: { defaultShiftStart?: string | null; defaultShiftEnd?: string | null; halfDayThresholdHours?: number | null }) => {
  const startTime = settings.defaultShiftStart || '09:00';
  const endTime = settings.defaultShiftEnd || '18:00';
  let span = toMinutesOfDay(endTime) - toMinutesOfDay(startTime);
  if (span <= 0) span += 24 * 60;
  const breakDurationMinutes = span > 6 * 60 ? 60 : 0;
  return {
    _id: null,
    name: 'Default shift',
    code: 'DEFAULT',
    startTime,
    endTime,
    gracePeriodMinutes: 15,
    breakDurationMinutes,
    workingHours: Math.round(((span - breakDurationMinutes) / 60) * 100) / 100,
    halfDayHours: settings.halfDayThresholdHours ?? 4,
    nightShift: spansMidnight({ startTime, endTime }),
    flexible: false,
    color: '#6366f1',
    isDefault: true,
  };
};

/** Great-circle distance in meters between two coordinates (haversine). */
export const haversineMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
};

/** Is a point within the geofence? */
export const withinGeofence = (
  point: { latitude: number; longitude: number },
  fence: { latitude: number; longitude: number; radiusMeters: number },
) => haversineMeters(point.latitude, point.longitude, fence.latitude, fence.longitude) <= fence.radiusMeters;

/** Reported GPS accuracy (m) credited towards the office geofence, capped so a very poor fix cannot count as "in the office". */
export const MAX_ACCURACY_ALLOWANCE_M = 100;

/**
 * Where a GPS point is relative to an office: rounded distance, and whether it is inside the office's
 * geofence (allowing for the reported accuracy). `withinOffice` is null when the office has no radius;
 * the result is null when the office has no coordinates.
 */
export const officeProximity = (
  point: { latitude: number; longitude: number; accuracy?: number | null },
  office: { latitude?: number | null; longitude?: number | null; geofenceRadiusMeters?: number | null },
) => {
  if (typeof office.latitude !== 'number' || typeof office.longitude !== 'number') return null;
  const distanceMeters = Math.round(haversineMeters(point.latitude, point.longitude, office.latitude, office.longitude));
  const radius = office.geofenceRadiusMeters ?? 0;
  const allowance = Math.min(Math.max(point.accuracy ?? 0, 0), MAX_ACCURACY_ALLOWANCE_M);
  return { distanceMeters, withinOffice: radius > 0 ? distanceMeters - allowance <= radius : null };
};

/** Live state of a day's record for the "today" widget. */
export const liveState = (record: { checkIn?: Date | null; checkOut?: Date | null; breaks?: BreakPeriod[] } | null) => {
  if (!record?.checkIn) return 'NOT_CHECKED_IN' as const;
  if (record.checkOut) return 'CHECKED_OUT' as const;
  if (record.breaks?.some((b) => !b.end)) return 'ON_BREAK' as const;
  return 'CHECKED_IN' as const;
};
