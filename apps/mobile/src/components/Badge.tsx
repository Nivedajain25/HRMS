import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { label } from '@/lib/format';
import { radius, space, toneColors, useTheme, type Tone } from '@/theme';
import type { IconComponent } from './Button';
import { Text } from './Text';

export const Badge = ({
  tone = 'gray',
  children,
  dot,
  icon: Icon,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  icon?: IconComponent;
}) => {
  const { c } = useTheme();
  const t = toneColors(tone, c);
  return (
    <View style={[styles.badge, { backgroundColor: t.bg, borderColor: t.border }]}>
      {dot ? <View style={[styles.dot, { backgroundColor: t.solid }]} /> : null}
      {Icon ? <Icon size={12} color={t.fg} strokeWidth={2.4} /> : null}
      <Text size="xs" weight="medium" style={{ color: t.fg }} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
};

/** One place that maps every workflow/status enum to a tone — identical to the web `StatusBadge`. */
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
  ON_LEAVE: 'purple',
  EXITED: 'gray',
  // attendance
  PRESENT: 'green',
  ABSENT: 'red',
  HALF_DAY: 'amber',
  LATE: 'amber',
  WORK_FROM_HOME: 'blue',
  HOLIDAY: 'purple',
  LEAVE: 'purple',
  WEEK_OFF: 'gray',
  // payroll
  PROCESSING: 'blue',
  REVIEW: 'amber',
  FINAL: 'brand',
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
  HR_REVIEW: 'purple',
  PENDING_SELF: 'amber',
  PENDING_MANAGER: 'amber',
  PENDING_HR: 'purple',
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

export const StatusBadge = ({ status }: { status?: string | null }) =>
  status ? (
    <Badge tone={statusTone(status)} dot>
      {label(status)}
    </Badge>
  ) : null;

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space(1.5),
    paddingHorizontal: space(2),
    paddingVertical: 2,
    borderRadius: radius.sm - 2,
    borderWidth: 1,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
