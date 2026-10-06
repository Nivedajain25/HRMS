import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const toDate = (value: string | Date | null | undefined) => {
  if (!value) return null;
  const d = typeof value === 'string' ? parseISO(value) : value;
  return isValid(d) ? d : null;
};

/**
 * Calendar dates from the API are stored at 00:00 UTC; render them in UTC so
 * the day never shifts with the viewer's timezone.
 */
export const formatDate = (value: string | Date | null | undefined, pattern = 'dd MMM yyyy') => {
  const d = toDate(value);
  if (!d) return '—';
  const utc = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return format(utc, pattern);
};

/** Instants (timestamps) render in the viewer's local time. */
export const formatDateTime = (value: string | Date | null | undefined, pattern = 'dd MMM yyyy, HH:mm') => {
  const d = toDate(value);
  return d ? format(d, pattern) : '—';
};

export const formatTime = (value: string | Date | null | undefined) => formatDateTime(value, 'HH:mm');

export const timeAgo = (value: string | Date | null | undefined) => {
  const d = toDate(value);
  return d ? `${formatDistanceToNowStrict(d)} ago` : '—';
};

/** `YYYY-MM-DD` for a local Date. */
export const toDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** `YYYY-MM-DD` of an API calendar date (UTC midnight). */
export const apiDateKey = (value: string | null | undefined) => (value ? value.slice(0, 10) : '');

export const formatMoney = (amount: number | null | undefined, currency = 'USD') => {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};

/** Short currency for headline figures (e.g. ₹29.6L, $2.96M); full value belongs in a tooltip. */
export const formatMoneyCompact = (amount: number | null | undefined, currency = 'USD') => {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  if (Math.abs(amount) < 100_000) return formatMoney(amount, currency);
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : undefined, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return formatMoney(amount, currency);
  }
};

export const formatNumber =(n: number | null | undefined, digits = 0) =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(n);

export const minutesToHours = (minutes: number | null | undefined) => {
  if (!minutes) return '0h';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
};

export const fullName = (p?: { firstName?: string; lastName?: string } | null) =>
  p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : '';

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/** "19:00" → "7:00 PM" (shift times are stored as 24-hour HH:mm). Anything unparseable is returned as-is. */
export const clock12 = (hhmm: string | null | undefined) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  if (!m) return hhmm ?? '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};

/** "10:00 AM – 7:00 PM" */
export const shiftRange = (start: string | null | undefined, end: string | null | undefined) => `${clock12(start)} – ${clock12(end)}`;

/** Removes empty values so they are not sent as query params. */
export const cleanParams = <T extends Record<string, unknown>>(params: T) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Partial<T>;
