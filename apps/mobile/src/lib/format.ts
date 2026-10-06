import { humanize } from '@stencil/shared';

/** Enum label (`PENDING_APPROVAL` → `Pending approval`) — same as the web `label()`. */
export const label = (value: string | null | undefined) => humanize(value);

export const fullName = (p?: { firstName?: string; lastName?: string } | null) =>
  p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : '';

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');

export const formatMoney = (amount: number | null | undefined, currency = 'USD') => {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};

export const formatNumber = (n: number | null | undefined, digits = 0) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const factor = 10 ** digits;
  const rounded = Math.round(n * factor) / factor;
  return String(rounded);
};

/** `1 day` / `2.5 days`. */
/** "19:00" → "7:00 PM" (shift times are stored as 24-hour HH:mm). Anything unparseable is returned as-is. */
export const clock12 = (hhmm: string | null | undefined) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  if (!m) return hhmm ?? '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};

/** "10:00 AM – 7:00 PM" */
export const shiftRange = (start: string | null | undefined, end: string | null | undefined) => `${clock12(start)} – ${clock12(end)}`;

export const pluralDays =(n: number) => `${formatNumber(n, 1)} ${n === 1 ? 'day' : 'days'}`;

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
