import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { UseQueryResult } from '@tanstack/react-query';
import { CalendarDays, ClipboardCheck, Megaphone, PartyPopper, Pin, Receipt, Users } from 'lucide-react-native';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  ListItem,
  SectionHeader,
  SkeletonList,
  StatusBadge,
  Text,
  type IconComponent,
} from '@/components';
import { formatMoney, label } from '@/lib/format';
import { formatDate, formatKey, timeAgo } from '@/lib/time';
import { radius, space, TOUCH_TARGET, useTheme, withAlpha, type Tone } from '@/theme';
import type { EmployeeDashboard, ManagerDashboard } from '../api';
import { employeeTitle, useEmployeeLook } from '../employee-look';
import { formatCount, inDaysLabel, monthName } from '../lib';

/* -------------------------------- Frame -------------------------------- */

interface WidgetProps<T> {
  title: string;
  icon: IconComponent;
  query: UseQueryResult<T>;
  isEmpty: (data: T) => boolean;
  empty: { icon: IconComponent; title: string; message?: string };
  children: (data: T) => ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  /** Card inner padding (lists use 0). */
  padding?: number;
}

/** Each home section gets its own soft colour, so the screen isn't a wall of grey. */
const SECTION_TONE: Record<string, Tone> = {
  'Leave balance': 'teal',
  'Upcoming Holidays': 'green',
  'Latest payslips': 'blue',
  Announcements: 'amber',
  'My team today': 'blue',
  'My Recent Activity': 'purple',
  'My Tasks': 'amber',
};

/** Section title + card with its own loading / error / empty states. */
export const Widget = <T,>({ title, icon, query, isEmpty, empty, children, actionLabel, onAction, padding = 0 }: WidgetProps<T>) => (
  <View style={styles.widget}>
    <WidgetTitle title={title} icon={icon} actionLabel={actionLabel} onAction={onAction} />
    <Card padding={padding}>
      {query.isLoading ? (
        <View style={styles.pad}>
          <SkeletonList rows={2} />
        </View>
      ) : query.error || !query.data ? (
        <ErrorState compact title={`Could not load ${title.toLowerCase()}`} error={query.error} onRetry={() => void query.refetch()} />
      ) : isEmpty(query.data) ? (
        <EmptyState compact icon={empty.icon} title={empty.title} message={empty.message} />
      ) : (
        children(query.data)
      )}
    </Card>
  </View>
);

/** Employees: an icon on the web's soft-blue tile + plain black title; everyone else: the coloured icon bubble. */
const WidgetTitle = ({ title, icon, actionLabel, onAction }: { title: string; icon: IconComponent; actionLabel?: string; onAction?: () => void }) => {
  const { c } = useTheme();
  const employee = useEmployeeLook();
  return (
    <SectionHeader
      title={title}
      icon={icon}
      actionLabel={actionLabel}
      onAction={onAction}
      tone={SECTION_TONE[title] ?? 'brand'}
      tile={employee ? employeeTitle(title, c.scheme === 'dark') : undefined}
    />
  );
};

/* ---------------------------- Leave balances --------------------------- */

export const LeaveBalances = ({ query }: { query: UseQueryResult<EmployeeDashboard> }) => {
  const { c } = useTheme();
  return (
    <Widget
      title="Leave balance"
      icon={CalendarDays}
      query={query}
      padding={space(3)}
      isEmpty={(d) => d.leaveBalances.length === 0}
      empty={{ icon: CalendarDays, title: 'No leave balances', message: 'Leave types assigned to you will show here.' }}
      actionLabel="Leave"
      onAction={() => router.push('/leave')}
    >
      {(d) => (
        <View style={styles.chips}>
          {d.leaveBalances.map((b) => {
            const color = b.leaveType.color ?? c.primary;
            return (
              <Pressable
                key={b._id}
                onPress={() => router.push('/leave')}
                accessibilityRole="button"
                accessibilityLabel={`${b.leaveType.name}: ${formatCount(b.remaining)} days left of ${formatCount(b.allocated + b.carryForward)}${b.pending ? `, ${formatCount(b.pending)} pending` : ''}`}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: withAlpha(color, 0.35),
                    backgroundColor: pressed ? withAlpha(color, 0.18) : withAlpha(color, c.scheme === 'dark' ? 0.14 : 0.08),
                  },
                ]}
              >
                <View style={styles.chipHead}>
                  <View style={[styles.dot, { backgroundColor: color }]} />
                  <Text size="xs" weight="medium" color="fg2" numberOfLines={1} style={styles.flexShrink}>
                    {b.leaveType.name}
                  </Text>
                </View>
                <Text size="xl" weight="bold" tabular>
                  {formatCount(b.remaining)}
                  <Text size="xs" color="muted">{` / ${formatCount(b.allocated + b.carryForward)}`}</Text>
                </Text>
                {b.pending ? (
                  <Text size="xs" color="warning">
                    {`${formatCount(b.pending)} pending`}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </Widget>
  );
};

/* ---------------------------- Holidays ---------------------------- */

export const UpcomingHolidays = ({ query }: { query: UseQueryResult<EmployeeDashboard> }) => {
  const { c } = useTheme();
  return (
    <Widget
      title="Upcoming Holidays"
      icon={PartyPopper}
      query={query}
      isEmpty={(d) => d.upcomingHolidays.length === 0}
      empty={{ icon: PartyPopper, title: 'No upcoming holidays' }}
    >
      {(d) =>
        d.upcomingHolidays.slice(0, 5).map((h, i) => (
          <ListItem
            key={`${h.date}-${h.name}`}
            divider={i > 0}
            title={h.name}
            subtitle={formatKey(h.date.slice(0, 10), 'EEE, dd MMM yyyy')}
            left={
              <View style={[styles.dateBox, { backgroundColor: c.accentSoft }]}>
                <Text size="xs" weight="semibold" color="accent">
                  {formatKey(h.date.slice(0, 10), 'MMM').toUpperCase()}
                </Text>
                <Text size="md" weight="bold" color="accent" style={styles.dateDay}>
                  {formatKey(h.date.slice(0, 10), 'd')}
                </Text>
              </View>
            }
            right={
              <>
                <Text size="xs" weight="medium" color={h.inDays <= 7 ? 'accent' : 'muted'}>
                  {inDaysLabel(h.inDays)}
                </Text>
                {h.optional || h.type === 'OPTIONAL' ? <Badge tone="amber">Optional</Badge> : null}
              </>
            }
          />
        ))
      }
    </Widget>
  );
};

/* ---------------------------- Payslips ---------------------------- */

export const LatestPayslips = ({ query }: { query: UseQueryResult<EmployeeDashboard> }) => (
  <Widget
    title="Latest payslips"
    icon={Receipt}
    query={query}
    isEmpty={(d) => d.payslips.length === 0}
    empty={{ icon: Receipt, title: 'No payslips yet', message: 'Published payslips will appear here.' }}
  >
    {(d) =>
      d.payslips.slice(0, 3).map((p, i) => (
        <ListItem
          key={p._id}
          divider={i > 0}
          title={monthName(p.month, p.year)}
          subtitle={p.paymentDate ? `Paid ${formatDate(p.paymentDate)}` : `Gross ${formatMoney(p.grossEarnings, p.currency)}`}
          right={
            <>
              <Text weight="semibold" tabular>
                {formatMoney(p.netPay, p.currency)}
              </Text>
              <StatusBadge status={p.status} />
            </>
          }
          accessibilityLabel={`Payslip ${monthName(p.month, p.year)}, net pay ${formatMoney(p.netPay, p.currency)}, ${label(p.status)}`}
        />
      ))
    }
  </Widget>
);

/* -------------------------- Announcements -------------------------- */

export const Announcements = ({ query }: { query: UseQueryResult<EmployeeDashboard> }) => {
  const { c } = useTheme();
  return (
    <Widget
      title="Announcements"
      icon={Megaphone}
      query={query}
      isEmpty={(d) => d.announcements.length === 0}
      empty={{ icon: Megaphone, title: 'No announcements', message: 'Company news will show up here.' }}
    >
      {(d) =>
        d.announcements.slice(0, 4).map((a, i) => (
          <View
            key={a._id}
            style={[styles.announcement, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}
            accessible
          >
            <View style={styles.announcementHead}>
              {!a.read ? <View style={[styles.unread, { backgroundColor: c.primary }]} accessibilityLabel="Unread" /> : null}
              <Text weight={a.read ? 'medium' : 'semibold'} style={styles.flex} numberOfLines={2}>
                {a.title}
              </Text>
              {a.pinned ? <Pin size={14} color={c.accent} accessibilityLabel="Pinned" /> : null}
            </View>
            {a.excerpt ? (
              <Text size="sm" color="muted" numberOfLines={2}>
                {a.excerpt}
              </Text>
            ) : null}
            <View style={styles.announcementFoot}>
              <Text size="xs" color="subtle">
                {timeAgo(a.publishAt)}
              </Text>
              {a.priority === 'HIGH' || a.priority === 'URGENT' ? <StatusBadge status={a.priority} /> : null}
            </View>
          </View>
        ))
      }
    </Widget>
  );
};

/* ----------------------------- Manager ----------------------------- */

const Stat = ({ label: text, value, tone }: { label: string; value: number; tone?: string }) => {
  const { c } = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: c.surface2, borderColor: c.line }]} accessible accessibilityLabel={`${text}: ${value}`}>
      <Text size="xl" weight="bold" tabular style={tone ? { color: tone } : undefined}>
        {value}
      </Text>
      <Text size="xs" color="muted" numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
};

export const TeamSummary = ({ query, canApprove }: { query: UseQueryResult<ManagerDashboard>; canApprove: boolean }) => {
  const { c } = useTheme();
  return (
    <Widget
      title="My team today"
      icon={Users}
      query={query}
      padding={space(3)}
      isEmpty={(d) => d.teamSize === 0}
      empty={{ icon: Users, title: 'No team members', message: 'People who report to you will appear here.' }}
      actionLabel={canApprove ? 'Approvals' : undefined}
      onAction={canApprove ? () => router.push('/approvals') : undefined}
    >
      {(d) => {
        const t = d.attendanceToday;
        const pending = d.pendingLeave.count + d.pendingExpenses.count;
        return (
          <View style={styles.teamBody}>
            <View style={styles.stats}>
              <Stat label="Team" value={d.teamSize} />
              <Stat label="Present" value={t?.present ?? 0} tone={c.success} />
              <Stat label="Late" value={t?.late ?? 0} tone={c.warning} />
              <Stat label="On leave" value={t?.onLeave ?? 0} />
              <Stat label="WFH" value={t?.workFromHome ?? 0} />
              <Stat label="Not in" value={t?.notCheckedIn ?? 0} tone={t?.notCheckedIn ? c.danger : undefined} />
            </View>
            {t && !t.isWorkingDay ? (
              <Text size="xs" color="muted">
                Today is not a working day.
              </Text>
            ) : null}
            {pending > 0 ? (
              <Pressable
                onPress={canApprove ? () => router.push('/approvals') : undefined}
                disabled={!canApprove}
                accessibilityRole={canApprove ? 'button' : 'text'}
                accessibilityLabel={`${d.pendingLeave.count} leave and ${d.pendingExpenses.count} expense requests awaiting approval`}
                style={({ pressed }) => [styles.pending, { backgroundColor: pressed ? c.surface3 : c.accentSoft }]}
              >
                <ClipboardCheck size={18} color={c.accent} />
                <Text size="sm" weight="medium" color="accent" style={styles.flex}>
                  {[
                    d.pendingLeave.count ? `${d.pendingLeave.count} leave` : null,
                    d.pendingExpenses.count ? `${d.pendingExpenses.count} expense` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}{' '}
                  {pending === 1 ? 'request awaits' : 'requests await'} approval
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      }}
    </Widget>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  widget: { gap: space(2) },
  pad: { padding: space(4) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  chip: { flexGrow: 1, flexBasis: '30%', minWidth: 96, borderWidth: 1, borderRadius: radius.md, padding: space(2.5), gap: 2 },
  chipHead: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dateBox: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  dateDay: { lineHeight: 18 },
  announcement: { padding: space(4), gap: space(1) },
  announcementHead: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  announcementFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(2) },
  unread: { width: 8, height: 8, borderRadius: 4 },
  teamBody: { gap: space(3) },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  stat: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 84,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space(2),
    paddingHorizontal: space(3),
  },
  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    borderRadius: radius.md,
    padding: space(3),
    minHeight: TOUCH_TARGET,
  },
});
