import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { usePermissions } from '@/store/auth';

/* ------------------------------ Timezone ------------------------------ */

/** Organization timezone (falls back to the browser's). */
export const useOrgTimezone = () => {
  const { user } = usePermissions();
  return user?.organization.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
};

const safeFormatter = (timeZone: string, opts: Intl.DateTimeFormatOptions) => {
  try {
    return new Intl.DateTimeFormat(undefined, { ...opts, timeZone });
  } catch {
    return new Intl.DateTimeFormat(undefined, opts);
  }
};

const toInstant = (value: string | Date | null | undefined) => {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
};

/** `HH:mm` of an instant in a timezone. */
export const formatTimeIn = (value: string | Date | null | undefined, timeZone: string) => {
  const d = toInstant(value);
  return d ? safeFormatter(timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d) : '—';
};

export const formatDateTimeIn = (value: string | Date | null | undefined, timeZone: string) => {
  const d = toInstant(value);
  return d
    ? safeFormatter(timeZone, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
    : '—';
};

const zonedParts = (instant: Date, timeZone: string) => {
  const parts = safeFormatter(timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') };
};

/** `YYYY-MM-DD` of "now" (or an instant) in a timezone. */
export const dateKeyIn = (timeZone: string, instant: Date = new Date()) => {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

/** `HH:mm` (24h) of an instant in a timezone — for time inputs. */
export const timeValueIn = (value: string | null | undefined, timeZone: string) => {
  const d = toInstant(value);
  if (!d) return '';
  const p = zonedParts(d, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
};

const offsetMinutes = (instant: Date, timeZone: string) => {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
};

/** ISO instant for a wall-clock `HH:mm` on `YYYY-MM-DD` in a timezone. */
export const zonedToIso = (dateKey: string, time: string, timeZone: string) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  const first = offsetMinutes(new Date(guess), timeZone);
  let ts = guess - first * 60000;
  const second = offsetMinutes(new Date(ts), timeZone);
  if (second !== first) ts = guess - second * 60000;
  return new Date(ts).toISOString();
};

/* ---------------------------- Calendar keys --------------------------- */

/** Date from a `YYYY-MM-DD` key, as a UTC-midnight ISO string (for `formatDate`). */
export const keyToIso = (key: string) => `${key.slice(0, 10)}T00:00:00.000Z`;

export const addDaysToKey = (key: string, days: number) => {
  const d = new Date(keyToIso(key));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Formats a date key with a date-fns pattern, independent of the viewer's timezone. */
export const formatKey = (key: string, pattern = 'dd MMM yyyy') => {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  return format(new Date(y!, m! - 1, d!), pattern);
};

export const monthBounds = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}`, days: last, firstWeekday: new Date(Date.UTC(y!, m! - 1, 1)).getUTCDay() };
};

export const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Monday of the week containing `key`. */
export const weekStart = (key: string) => {
  const day = new Date(keyToIso(key)).getUTCDay();
  return addDaysToKey(key, -((day + 6) % 7));
};

/* ------------------------------ Durations ----------------------------- */

export const formatClock = (totalSeconds: number) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
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
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
};

/* ----------------------------- Geolocation ---------------------------- */

export type GeoResult = { latitude: number; longitude: number; accuracy?: number } | { error: 'denied' | 'unavailable' | 'unsupported' };

/** Best-effort browser location: a fresh high-accuracy fix (accuracy in meters); never rejects. */
export const getBrowserLocation = (timeoutMs = 15_000): Promise<GeoResult> =>
  new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve({ error: 'unsupported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
          ...(Number.isFinite(pos.coords.accuracy) ? { accuracy: Math.min(100_000, Math.round(pos.coords.accuracy)) } : {}),
        }),
      (err) => resolve({ error: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
      // maximumAge 0: never reuse a cached position — record where the person is right now.
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });

/** How to re-enable a blocked/unavailable location, for error messages. */
export const locationHelp = (error: 'denied' | 'unavailable' | 'unsupported') =>
  error === 'denied'
    ? 'Location access is blocked. Allow location for this site (click the lock icon in the address bar → Location → Allow, or enable it in your phone settings), then try again.'
    : error === 'unsupported'
      ? 'This browser cannot share your location. Use a different browser or device to check in.'
      : 'Your location could not be determined. Turn on location services / GPS, move to an open area and try again.';

/** OpenStreetMap link for a coordinate. */
export const mapLink = (latitude: number, longitude: number) =>
  `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=18/${latitude}/${longitude}`;

/* ------------------------------- Colors ------------------------------- */

/** Calendar cell styles per attendance status. */
export const STATUS_CELL: Record<string, string> = {
  PRESENT: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/30',
  LATE: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30',
  HALF_DAY: 'bg-orange-50 text-orange-800 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-200 dark:ring-orange-500/30',
  ABSENT: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-500/30',
  WORK_FROM_HOME: 'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-500/30',
  LEAVE: 'bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-200 dark:ring-violet-500/30',
  HOLIDAY: 'bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-200 dark:bg-fuchsia-500/15 dark:text-fuchsia-200 dark:ring-fuchsia-500/30',
  WEEK_OFF: 'bg-surface-3 text-muted ring-line',
};

export const STATUS_DOT: Record<string, string> = {
  PRESENT: 'bg-emerald-500',
  LATE: 'bg-amber-500',
  HALF_DAY: 'bg-orange-500',
  ABSENT: 'bg-red-500',
  WORK_FROM_HOME: 'bg-sky-500',
  LEAVE: 'bg-violet-500',
  HOLIDAY: 'bg-fuchsia-500',
  WEEK_OFF: 'bg-slate-400',
};

export const HOLIDAY_TYPE_STYLE: Record<string, { cell: string; dot: string }> = {
  PUBLIC: { cell: 'bg-brand-50 text-brand-800 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-500/30', dot: 'bg-brand-500' },
  COMPANY: { cell: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/30', dot: 'bg-emerald-500' },
  OPTIONAL: { cell: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30', dot: 'bg-amber-500' },
  REGIONAL: { cell: 'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-500/30', dot: 'bg-sky-500' },
};

export const WEEKDAYS_SUN_FIRST = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
