import { AlarmClock, ClipboardList, History, Megaphone, PartyPopper, TreePalm, Users, Zap, type LucideIcon } from 'lucide-react-native';
import { dashboardKind, useAuth } from '@/lib/auth';
import { withAlpha } from '@/theme';

/**
 * The web employee dashboard's colours, for the mobile app (employees only; HR and admins keep their own look).
 * Mirrors apps/web: EMPLOYEE_TILES (widget.tsx), the blue greeting hero (greeting-hero.tsx), the Today card
 * (admin-clock-card.tsx) and the navy menu pill (`.chrome-wine` in styles/index.css).
 */

/** Section title: an icon on a soft-blue tile (a different light blue per card), plain black title. */
const TILES: Record<string, { icon: LucideIcon; tile: string; hue: string }> = {
  Today: { icon: AlarmClock, tile: '#bfdbfe', hue: '#3b82f6' }, // blue-200
  'My Tasks': { icon: ClipboardList, tile: '#c7d2fe', hue: '#6366f1' }, // indigo-200
  Announcements: { icon: Megaphone, tile: '#c7d2fe', hue: '#6366f1' }, // indigo-200
  'Upcoming Holidays': { icon: PartyPopper, tile: '#bae6fd', hue: '#0ea5e9' }, // sky-200
  'My Recent Activity': { icon: History, tile: '#a5f3fc', hue: '#06b6d4' }, // cyan-200
  'Quick Actions': { icon: Zap, tile: '#bfdbfe', hue: '#3b82f6' },
  'Leave balance': { icon: TreePalm, tile: '#bae6fd', hue: '#0ea5e9' },
  'My team today': { icon: Users, tile: '#bfdbfe', hue: '#3b82f6' },
};

/** The tile for a section title (the tile's own hue for the icon; in dark mode a translucent tile with a light icon). */
export const employeeTitle = (title: string, dark: boolean) => {
  const t = TILES[title];
  if (!t) return undefined;
  return { icon: t.icon, bg: dark ? withAlpha(t.hue, 0.3) : t.tile, color: dark ? t.tile : t.hue };
};

/** True on the employee dashboard look (not Super Admin / Admin / HR). */
export const useEmployeeLook = () => dashboardKind(useAuth().user?.roles) === 'employee';
