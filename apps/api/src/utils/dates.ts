import { TZDate } from '@date-fns/tz';
import type { Weekday } from '@stencil/shared';

/**
 * Date conventions:
 *  - Instants (clock-in, createdAt) are stored as UTC `Date`s.
 *  - Calendar dates (leave days, holidays, attendance day) are stored as
 *    `Date` at 00:00 UTC and handled as `YYYY-MM-DD` keys.
 *  - "Which calendar day is it?" is always answered in the organization timezone.
 */

const WEEKDAY_KEYS: Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Calendar date key (YYYY-MM-DD) of an instant in the given timezone. */
export const dateKeyInTz = (instant: Date, timeZone: string): string => {
  const d = new TZDate(instant.getTime(), timeZone);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const todayKey = (timeZone: string) => dateKeyInTz(new Date(), timeZone);

/** `HH:mm` of an instant in a timezone. */
export const timeInTz = (instant: Date, timeZone: string): string => {
  const d = new TZDate(instant.getTime(), timeZone);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** UTC instant for a wall-clock time on a calendar date in a timezone. */
export const zonedInstant = (dateKey: string, time: string, timeZone: string): Date => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(new TZDate(y!, m! - 1, d!, hh!, mm!, 0, 0, timeZone).getTime());
};

/** Calendar date key -> Date at 00:00 UTC (storage form). */
export const dateOnly = (dateKey: string): Date => new Date(`${dateKey}T00:00:00.000Z`);

/** Storage-form Date -> calendar date key. */
export const toDateKey = (date: Date): string => date.toISOString().slice(0, 10);

export const addDaysKey = (dateKey: string, days: number): string => {
  const d = dateOnly(dateKey);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateKey(d);
};

export const eachDateKey = (from: string, to: string): string[] => {
  const keys: string[] = [];
  for (let k = from; k <= to; k = addDaysKey(k, 1)) keys.push(k);
  return keys;
};

export const weekdayOf = (dateKey: string): Weekday => WEEKDAY_KEYS[dateOnly(dateKey).getUTCDay()]!;

export const monthRange = (year: number, month: number) => {
  const start = `${year}-${pad(month)}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start, end: `${year}-${pad(month)}-${pad(lastDay)}`, days: lastDay };
};

export const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
