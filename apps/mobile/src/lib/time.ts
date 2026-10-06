import { useEffect, useState } from 'react';
import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';

/*
 * Date/time helpers (ported from the web `features/attendance/lib.ts` and
 * `lib/utils.ts`). Two kinds of values come from the API:
 *  - calendar dates (`date`, `startDate`…) stored at 00:00 UTC → render by their `YYYY-MM-DD` key;
 *  - instants (`checkIn`, `createdAt`…) → render in the organization timezone.
 */

/* ------------------------------ Timezones ------------------------------ */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const partsFormatter = (timeZone: string) => {
  let f = formatterCache.get(timeZone);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      hour12: false,
    };
    try {
      f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone });
    } catch {
      f = new Intl.DateTimeFormat('en-US', opts);
    }
    formatterCache.set(timeZone, f);
  }
  return f;
};

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Wall-clock parts of an instant in a timezone (works with Hermes' Intl on both platforms). */
export const zonedParts = (instant: Date, timeZone: string): ZonedParts => {
  const f = partsFormatter(timeZone);
  if (typeof f.formatToParts === 'function') {
    const parts = f.formatToParts(instant);
    const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour') % 24,
      minute: get('minute'),
      second: get('second'),
    };
  }
  // en-US: "MM/DD/YYYY, HH:mm:ss"
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(f.format(instant));
  if (!m) {
    return {
      year: instant.getFullYear(),
      month: instant.getMonth() + 1,
      day: instant.getDate(),
      hour: instant.getHours(),
      minute: instant.getMinutes(),
      second: instant.getSeconds(),
    };
  }
  return {
    year: Number(m[3]),
    month: Number(m[1]),
    day: Number(m[2]),
    hour: Number(m[4]) % 24,
    minute: Number(m[5]),
    second: Number(m[6]),
  };
};

const pad = (n: number) => String(n).padStart(2, '0');

const toInstant = (value: string | Date | null | undefined) => {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
};

/** `YYYY-MM-DD` of now (or an instant) in a timezone. */
export const dateKeyIn = (timeZone: string, instant: Date = new Date()) => {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

/** 12-hour clock parts: 13 → { h: 1, suffix: 'PM' }. */
const twelve = (hour: number) => ({ h: hour % 12 || 12, suffix: hour < 12 ? 'AM' : 'PM' });

/** `h:mm AM/PM` of an instant in a timezone (for display), `—` when empty. */
export const formatTimeIn = (value: string | Date | null | undefined, timeZone: string) => {
  const d = toInstant(value);
  if (!d) return '—';
  const p = zonedParts(d, timeZone);
  const { h, suffix } = twelve(p.hour);
  return `${h}:${pad(p.minute)} ${suffix}`;
};

/** `h:mm:ss AM/PM` of an instant in a timezone (live clocks). */
export const formatClockTimeIn = (instant: Date, timeZone: string) => {
  const p = zonedParts(instant, timeZone);
  const { h, suffix } = twelve(p.hour);
  return `${h}:${pad(p.minute)}:${pad(p.second)} ${suffix}`;
};

/** `HH:mm` (24 h) for form inputs, `''` when empty. */
export const timeValueIn = (value: string | null | undefined, timeZone: string) => {
  const d = toInstant(value);
  if (!d) return '';
  const p = zonedParts(d, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
};

/** `dd MMM yyyy, HH:mm` of an instant in a timezone. */
export const formatDateTimeIn = (value: string | Date | null | undefined, timeZone: string) => {
  const d = toInstant(value);
  if (!d) return '—';
  return `${formatKey(dateKeyIn(timeZone, d))}, ${formatTimeIn(d, timeZone)}`;
};

/** Hour of day (0–23) in a timezone. */
export const hourIn = (timeZone: string, instant: Date = new Date()) => zonedParts(instant, timeZone).hour;

/* ---------------------------- Calendar keys --------------------------- */

/** Local `Date` at midnight for a `YYYY-MM-DD` key (for date-fns formatting and pickers). */
export const keyToDate = (key: string) => {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};

/** `YYYY-MM-DD` of a local Date. */
export const toDateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Formats a date key with a date-fns pattern, independent of the device timezone. */
export const formatKey = (key: string | null | undefined, pattern = 'dd MMM yyyy') => (key ? format(keyToDate(key), pattern) : '—');

/** API calendar date (UTC midnight ISO) → formatted. */
export const formatDate = (value: string | null | undefined, pattern = 'dd MMM yyyy') =>
  value ? formatKey(value.slice(0, 10), pattern) : '—';

export const addDaysToKey = (key: string, days: number) => {
  const d = keyToDate(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
};

/** `YYYY-MM` month helpers. */
export const monthBounds = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y ?? 1970, m ?? 1, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}`, days: last };
};

/** `YYYY-MM-DD` ± days (calendar arithmetic, no timezone involved). */
export const addDaysKey = (key: string, days: number) => {
  const d = keyToDate(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
};

export const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y ?? 1970, (m ?? 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

/** ISO instant for a wall-clock `HH:mm` on `YYYY-MM-DD` in a timezone. */
export const zonedToIso = (dateKey: string, time: string, timeZone: string) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
  const offset = (instant: Date) => {
    const p = zonedParts(instant, timeZone);
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant.getTime()) / 60000);
  };
  const first = offset(new Date(guess));
  let ts = guess - first * 60000;
  const second = offset(new Date(ts));
  if (second !== first) ts = guess - second * 60000;
  return new Date(ts).toISOString();
};

/* ------------------------------ Instants ------------------------------ */

const parse = (value: string | Date | null | undefined) => {
  if (!value) return null;
  const d = typeof value === 'string' ? parseISO(value) : value;
  return isValid(d) ? d : null;
};

/** Instant in the device's local time. */
export const formatDateTime = (value: string | Date | null | undefined, pattern = 'dd MMM yyyy, HH:mm') => {
  const d = parse(value);
  return d ? format(d, pattern) : '—';
};

export const timeAgo = (value: string | Date | null | undefined) => {
  const d = parse(value);
  return d ? `${formatDistanceToNowStrict(d)} ago` : '—';
};

/* ------------------------------ Durations ----------------------------- */

export const formatClock = (totalSeconds: number) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};

export const minutesToHours = (minutes: number | null | undefined) => {
  if (!minutes) return '0h';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
};

export const hoursLabel = (hours: number | null | undefined) => {
  if (!hours) return '0h';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m ? `${h}h ${m}m` : `${h}h`;
};

/** Current time, updated every `intervalMs`. */
export const useNow = (intervalMs = 1000) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
};
