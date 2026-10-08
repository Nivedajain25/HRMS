import { dateKeyIn, formatKey, hourIn } from '@/lib/time';

/** Greeting (and matching emoji) for the current hour in the organization's timezone (same rules as the web). */
export const greetingFor = (timeZone: string, now = new Date()) => {
  const hour = hourIn(timeZone, now);
  if (hour < 5) return { text: 'Good Evening', emoji: '🌙' };
  if (hour < 12) return { text: 'Good Morning', emoji: '☀️' };
  if (hour < 17) return { text: 'Good Afternoon', emoji: '🌤️' };
  return { text: 'Good Evening', emoji: '🌙' };
};

/** "Wednesday, 23 September 2026" (or another `pattern`, e.g. "Wed, 23 Sep 2026") in the organization's timezone. */
export const longDateIn = (timeZone: string, now = new Date(), pattern = 'EEEE, d MMMM yyyy') => formatKey(dateKeyIn(timeZone, now), pattern);

export const monthName = (month: number, year: number, pattern = 'MMMM yyyy') =>
  formatKey(`${year}-${String(month).padStart(2, '0')}-01`, pattern);

/** "Today", "Tomorrow", "In 5 days". */
export const inDaysLabel = (days: number) => (days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`);

/** Trims trailing zeros from fractional day counts (1.5, 2, 0.5). */
export const formatCount = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
