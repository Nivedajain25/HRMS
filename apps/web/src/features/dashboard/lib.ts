import { CloudSun, Moon, Sun, type LucideIcon } from 'lucide-react';
import { formatDate } from '@/lib/utils';

/** `YYYY-MM-DD` calendar key as a UTC-midnight ISO string (safe for `formatDate`). */
export const keyIso = (key: string) => `${key.slice(0, 10)}T00:00:00.000Z`;

/** Formats a calendar key (`YYYY-MM-DD` or `YYYY-MM`) without timezone drift. */
export const formatKey = (key: string, pattern = 'dd MMM yyyy') => formatDate(keyIso(key.length === 7 ? `${key}-01` : key), pattern);

export const monthName = (month: number, year: number, pattern = 'MMMM yyyy') =>
  formatKey(`${year}-${String(month).padStart(2, '0')}-01`, pattern);

/** "Today", "Tomorrow", "In 5 days". */
export const inDaysLabel = (days: number) => (days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`);

const safeParts = (timeZone: string, opts: Intl.DateTimeFormatOptions, now: Date) => {
  try {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone }).formatToParts(now);
  } catch {
    return new Intl.DateTimeFormat('en-US', opts).formatToParts(now);
  }
};

/** Greeting (and matching icon + its colour) for the current hour in the organization's timezone. */
export const greetingFor = (timeZone: string, now = new Date()): { text: string; icon: LucideIcon; tone: string } => {
  const hour = Number(safeParts(timeZone, { hour: 'numeric', hourCycle: 'h23' }, now).find((p) => p.type === 'hour')?.value ?? 12) % 24;
  // `icon` is also the banner's big faded picture for the part of the day (morning sun, afternoon sun + cloud,
  // evening moon — as on the mobile app).
  const evening = { text: 'Good Evening', icon: Moon, tone: 'text-indigo-500 dark:text-indigo-300' };
  if (hour < 5) return evening;
  if (hour < 12) return { text: 'Good Morning', icon: Sun, tone: 'text-amber-500 dark:text-amber-300' };
  if (hour < 17) return { text: 'Good Afternoon', icon: CloudSun, tone: 'text-amber-500 dark:text-amber-300' };
  return evening;
};

/** Long date ("Wednesday, 23 September 2026") in the organization's timezone. */
export const longDateIn = (timeZone: string, now = new Date()) => {
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  try {
    return new Intl.DateTimeFormat(undefined, { ...opts, timeZone }).format(now);
  } catch {
    return new Intl.DateTimeFormat(undefined, opts).format(now);
  }
};

/** Trims trailing zeros from fractional day counts (1.5, 2, 0.5). */
export const formatCount = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** Which dashboard a user gets: Head (super admin), HR (HR admin / manager) or Employee (everyone else). */
export type DashboardKind = 'head' | 'hr' | 'employee';

export const dashboardKind = (roles: { key?: string }[] | undefined): DashboardKind => {
  const keys = (roles ?? []).map((r) => r.key);
  // Admin gets the Super Admin's dashboard.
  if (keys.some((k) => k === 'super_admin' || k === 'admin')) return 'head';
  if (keys.some((k) => k === 'hr_admin' || k === 'hr_manager')) return 'hr';
  return 'employee';
};
