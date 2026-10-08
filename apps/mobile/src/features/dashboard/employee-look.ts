import { dashboardKind, useAuth } from '@/lib/auth';
import { withAlpha } from '@/theme';

/**
 * The web employee dashboard's colours, for the mobile app (employees only; HR and admins keep their own look).
 * Mirrors apps/web: EMPLOYEE_TILES (widget.tsx), the blue greeting hero (greeting-hero.tsx), the Today card
 * (admin-clock-card.tsx) and the navy menu pill (`.chrome-wine` in styles/index.css).
 */

/** Section title: an emoji on a soft-blue tile (a different light blue per card), plain black title. */
const TILES: Record<string, { emoji: string; tile: string; hue: string }> = {
  Today: { emoji: '⏰', tile: '#bfdbfe', hue: '#3b82f6' }, // blue-200
  'My Tasks': { emoji: '📋', tile: '#c7d2fe', hue: '#6366f1' }, // indigo-200
  Announcements: { emoji: '📢', tile: '#c7d2fe', hue: '#6366f1' }, // indigo-200
  'Upcoming Holidays': { emoji: '🎉', tile: '#bae6fd', hue: '#0ea5e9' }, // sky-200
  'My Recent Activity': { emoji: '🕒', tile: '#a5f3fc', hue: '#06b6d4' }, // cyan-200
  'Quick Actions': { emoji: '⚡', tile: '#bfdbfe', hue: '#3b82f6' },
  'Leave balance': { emoji: '🌴', tile: '#bae6fd', hue: '#0ea5e9' },
  'My team today': { emoji: '👥', tile: '#bfdbfe', hue: '#3b82f6' },
};

export const employeeTitle = (title: string, dark: boolean) => {
  const t = TILES[title] ?? { emoji: '', tile: '#bfdbfe', hue: '#3b82f6' };
  return { emoji: t.emoji, tile: dark ? withAlpha(t.hue, 0.3) : t.tile };
};

/** Greeting banner: blue-100 → white → sky-50 (dark: soft blue / sky washes over the surface). */
export const EMPLOYEE_BANNER: Record<'light' | 'dark', [string, string, string]> = {
  light: ['#dbeafe', '#ffffff', '#f0f9ff'],
  dark: ['#1a2640', '#12151c', '#10222f'],
};

/** The menu's current-page pill: dark navy with a white icon. */
export const EMPLOYEE_NAVY = '#1e3a8a';

/** True on the employee dashboard look (not Super Admin / Admin / HR). */
export const useEmployeeLook = () => dashboardKind(useAuth().user?.roles) === 'employee';
