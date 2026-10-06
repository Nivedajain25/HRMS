import { differenceInCalendarDays, parseISO } from 'date-fns';
import { Badge, type Tone } from '@/components/ui/display';
import { label } from '@/lib/i18n';
import { apiDateKey, toDateKey } from '@/lib/utils';
import type { ExitType, TaskAssignee } from '../api';

export const todayKey = () => toDateKey(new Date());

/** Calendar days from today until an API calendar date (negative when past). */
export const daysUntil = (value: string | null | undefined) => {
  const key = apiDateKey(value);
  if (!key) return null;
  return differenceInCalendarDays(parseISO(key), parseISO(todayKey()));
};

export const isPastDue = (value: string | null | undefined) => {
  const key = apiDateKey(value);
  return !!key && key < todayKey();
};

const ASSIGNEE_TONES: Record<TaskAssignee, Tone> = { EMPLOYEE: 'brand', HR: 'purple', MANAGER: 'teal', IT: 'blue' };

export const AssigneeBadge = ({ assignee }: { assignee: TaskAssignee }) => <Badge tone={ASSIGNEE_TONES[assignee] ?? 'gray'}>{label(assignee)}</Badge>;

const EXIT_TONES: Record<ExitType, Tone> = { RESIGNATION: 'blue', TERMINATION: 'red', RETIREMENT: 'teal', CONTRACT_END: 'amber', OTHER: 'gray' };

export const ExitTypeBadge = ({ type }: { type: ExitType }) => <Badge tone={EXIT_TONES[type] ?? 'gray'}>{label(type)}</Badge>;

export const monthLabel = (month: number, year: number) =>
  new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
