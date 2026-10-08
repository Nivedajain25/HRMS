import {
  Activity,
  Banknote,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  CloudSun,
  FilePen,
  LogIn,
  LogOut,
  Moon,
  Plane,
  Receipt,
  Sun,
  Target,
  Trophy,
  type LucideIcon,
} from 'lucide-react-native';
import { dateKeyIn, formatKey, hourIn } from '@/lib/time';
import type { Tone } from '@/theme';

/** Greeting (and matching icon and colour) for the current hour in the organization's timezone (same rules as the web). */
export const greetingFor = (timeZone: string, now = new Date()): { text: string; icon: LucideIcon; tone: Tone } => {
  const hour = hourIn(timeZone, now);
  if (hour < 5) return { text: 'Good Evening', icon: Moon, tone: 'brand' };
  if (hour < 12) return { text: 'Good Morning', icon: Sun, tone: 'amber' };
  if (hour < 17) return { text: 'Good Afternoon', icon: CloudSun, tone: 'blue' };
  return { text: 'Good Evening', icon: Moon, tone: 'brand' };
};

/** Icon and colour for an activity-feed entry (clock-ins, leave, expenses, goals, tasks…). */
const ACTIVITY_ICONS: Record<string, { icon: LucideIcon; tone: Tone }> = {
  CLOCK_IN: { icon: LogIn, tone: 'green' },
  CLOCK_OUT: { icon: LogOut, tone: 'blue' },
  LEAVE_APPLIED: { icon: Plane, tone: 'blue' },
  LEAVE_APPROVED: { icon: CircleCheck, tone: 'green' },
  LEAVE_REJECTED: { icon: CircleX, tone: 'red' },
  REGULARIZATION_REQUESTED: { icon: FilePen, tone: 'amber' },
  REGULARIZATION_APPROVED: { icon: CircleCheck, tone: 'green' },
  REGULARIZATION_REJECTED: { icon: CircleX, tone: 'red' },
  EXPENSE_SUBMITTED: { icon: Receipt, tone: 'amber' },
  EXPENSE_APPROVED: { icon: CircleCheck, tone: 'green' },
  EXPENSE_PAID: { icon: Banknote, tone: 'green' },
  GOAL_PROGRESS: { icon: Target, tone: 'purple' },
  GOAL_COMPLETED: { icon: Trophy, tone: 'amber' },
  TASK_DONE: { icon: ClipboardCheck, tone: 'teal' },
};

export const activityIcon = (type: string) => ACTIVITY_ICONS[type] ?? { icon: Activity, tone: 'gray' as Tone };

/** "Wednesday, 23 September 2026" (or another `pattern`, e.g. "Wed, 23 Sep 2026") in the organization's timezone. */
export const longDateIn = (timeZone: string, now = new Date(), pattern = 'EEEE, d MMMM yyyy') => formatKey(dateKeyIn(timeZone, now), pattern);

export const monthName = (month: number, year: number, pattern = 'MMMM yyyy') =>
  formatKey(`${year}-${String(month).padStart(2, '0')}-01`, pattern);

/** "Today", "Tomorrow", "In 5 days". */
export const inDaysLabel = (days: number) => (days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`);

/** Trims trailing zeros from fractional day counts (1.5, 2, 0.5). */
export const formatCount = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
