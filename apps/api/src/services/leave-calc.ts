/**
 * Pure leave day-count helpers (no I/O) so they can be unit tested in
 * isolation. Dates are `YYYY-MM-DD` calendar keys.
 */

export type LeaveDayKind = 'WORKING' | 'WEEK_OFF' | 'HOLIDAY';

export interface LeaveDayCount {
  /** Days charged: working days, or 0.5 for a half day on a working day. */
  days: number;
  workingDates: string[];
  weekOffs: string[];
  holidays: string[];
}

const DAY_MS = 86_400_000;
const keyToUtc = (key: string) => Date.parse(`${key}T00:00:00.000Z`);
const utcToKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Inclusive list of date keys between two keys. */
export const dateKeysBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let t = keyToUtc(from), end = keyToUtc(to); t <= end; t += DAY_MS) out.push(utcToKey(t));
  return out;
};

/** Whole calendar days from `a` to `b` (negative when b is before a). */
export const daysBetween = (a: string, b: string) => Math.round((keyToUtc(b) - keyToUtc(a)) / DAY_MS);

/**
 * Counts chargeable leave days in [from, to]: week-offs and (non-optional)
 * holidays are excluded; a half day counts 0.5 when it falls on a working day.
 */
export const countLeaveDays = (
  from: string,
  to: string,
  halfDay: boolean,
  kindOf: (dateKey: string) => LeaveDayKind,
): LeaveDayCount => {
  const result: LeaveDayCount = { days: 0, workingDates: [], weekOffs: [], holidays: [] };
  if (to < from) return result;
  for (const key of dateKeysBetween(from, to)) {
    const kind = kindOf(key);
    if (kind === 'WORKING') result.workingDates.push(key);
    else if (kind === 'HOLIDAY') result.holidays.push(key);
    else result.weekOffs.push(key);
  }
  result.days = halfDay ? (result.workingDates.length ? 0.5 : 0) : result.workingDates.length;
  return result;
};

export const spansMultipleYears = (from: string, to: string) => from.slice(0, 4) !== to.slice(0, 4);

export interface LeaveRange {
  startDate: string;
  endDate: string;
  halfDay?: boolean | null;
  halfDaySession?: string | null;
}

/**
 * Whether two leave ranges collide. Two half days on the same date only
 * coexist when they are for different sessions (FIRST_HALF vs SECOND_HALF).
 */
export const leaveRangesOverlap = (a: LeaveRange, b: LeaveRange) => {
  if (a.startDate > b.endDate || b.startDate > a.endDate) return false;
  if (a.halfDay && b.halfDay && a.startDate === b.startDate) {
    const sa = a.halfDaySession ?? 'FIRST_HALF';
    const sb = b.halfDaySession ?? 'FIRST_HALF';
    return sa === sb;
  }
  return true;
};

/** Builds a `kindOf` function from working weekdays (0=Sun..6=Sat) and holiday keys. */
export const simpleKindOf =
  (workingWeekdays: readonly number[], holidays: ReadonlySet<string>) =>
  (key: string): LeaveDayKind => {
    if (holidays.has(key)) return 'HOLIDAY';
    return workingWeekdays.includes(new Date(keyToUtc(key)).getUTCDay()) ? 'WORKING' : 'WEEK_OFF';
  };
