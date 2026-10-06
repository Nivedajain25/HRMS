import { label } from '@/lib/i18n';
import { Badge, type Tone } from '../ui/display';

/**
 * One place that maps every workflow/status enum to a color, using the app's colour meanings (lib/module-colors):
 * green = done / approved / present, red = rejected / absent / urgent, amber = waiting / needs attention / away,
 * blue = in progress / people, teal = paid, purple = company, gray = closed / inactive.
 */
const TONES: Record<string, Tone> = {
  // generic
  ACTIVE: 'green',
  INACTIVE: 'gray',
  ARCHIVED: 'gray',
  SUSPENDED: 'red',
  DRAFT: 'gray',
  PENDING: 'amber',
  IN_PROGRESS: 'blue',
  COMPLETED: 'green',
  CANCELLED: 'gray',
  // approvals
  SUBMITTED: 'amber',
  PENDING_APPROVAL: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
  PAID: 'teal',
  SKIPPED: 'gray',
  // employment
  PROBATION: 'blue',
  NOTICE_PERIOD: 'amber',
  ON_LEAVE: 'amber',
  EXITED: 'gray',
  // attendance
  PRESENT: 'green',
  ABSENT: 'red',
  HALF_DAY: 'amber',
  LATE: 'amber',
  WORK_FROM_HOME: 'blue',
  HOLIDAY: 'purple',
  LEAVE: 'amber',
  WEEK_OFF: 'gray',
  // payroll
  PROCESSING: 'blue',
  REVIEW: 'amber',
  FINAL: 'teal',
  // recruitment
  OPEN: 'green',
  ON_HOLD: 'amber',
  CLOSED: 'gray',
  APPLIED: 'gray',
  SCREENING: 'blue',
  SHORTLISTED: 'purple',
  INTERVIEW: 'brand',
  ASSESSMENT: 'blue',
  SELECTED: 'teal',
  OFFERED: 'amber',
  HIRED: 'green',
  SCHEDULED: 'blue',
  NO_SHOW: 'red',
  // performance
  NOT_STARTED: 'gray',
  GOAL_SETTING: 'blue',
  SELF_REVIEW: 'amber',
  MANAGER_REVIEW: 'amber',
  HR_REVIEW: 'amber',
  PENDING_SELF: 'amber',
  PENDING_MANAGER: 'amber',
  PENDING_HR: 'amber',
  // assets & documents
  AVAILABLE: 'green',
  ASSIGNED: 'blue',
  REPAIR: 'amber',
  RETIRED: 'gray',
  RETURNED: 'gray',
  VERIFIED: 'green',
  // offboarding
  EXIT_REQUEST: 'amber',
  ASSET_RETURN: 'blue',
  CLEARANCE: 'blue',
  FINAL_PAYROLL: 'purple',
  EXIT_INTERVIEW: 'purple',
  DEACTIVATION: 'red',
  // priority
  LOW: 'gray',
  NORMAL: 'blue',
  HIGH: 'amber',
  URGENT: 'red',
};

export const statusTone = (status?: string | null): Tone => (status ? (TONES[status] ?? 'gray') : 'gray');

export const StatusBadge = ({ status, className }: { status?: string | null; className?: string }) =>
  status ? (
    <Badge tone={statusTone(status)} dot className={className}>
      {label(status)}
    </Badge>
  ) : null;
