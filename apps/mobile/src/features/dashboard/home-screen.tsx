import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Search } from 'lucide-react-native';
import { Appear, Card, Screen, SectionHeader, Text, Wave } from '@/components';
import { attendanceKeys } from '@/features/attendance/api';
import { ClockCard } from '@/features/attendance/components/clock-card';
import { usePlacePopup } from '@/features/attendance/place-popup';
import { EmergencyBanner } from '@/features/emergencies/emergency-banner';
import { EmergencyButton } from '@/features/emergencies/emergency-button';
import { AvatarPhotoButton } from '@/features/profile/components/avatar-photo-button';
import { QuickActionsRow } from '@/features/quick-actions/quick-actions';
import { dashboardKind, useAuth } from '@/lib/auth';
import { fullName } from '@/lib/format';
import { useNow } from '@/lib/time';
import { radius, space, toneColors, useTheme } from '@/theme';
import { dashboardKeys, useEmployeeDashboard, useManagerDashboard } from './api';
import { MyActivity } from './components/my-activity';
import { MyTasks } from './components/my-tasks';
import { EmployeeAlerts, NewJoiners, Referrals } from './components/admin-home';
import { ApprovalsHighlight, CompanyTodayHero, MonthStats } from './components/home-hero';
import { Celebrations, Departments, OrgToday, TasksOverview, TeamActivity, WhosIn } from './components/org-overview';
import { Announcements, TeamSummary, UpcomingHolidays } from './components/widgets';
import { greetingFor, longDateIn } from './lib';

/** Bell in a soft round button (opens Notifications), with the unread count. */
const UnreadBell = ({ count }: { count: number | undefined }) => {
  const { c } = useTheme();
  const n = count ?? 0;
  return (
    <Pressable
      onPress={() => router.push('/more/notifications')}
      accessibilityRole="button"
      accessibilityLabel={n ? `Notifications, ${n} unread` : 'Notifications'}
      style={({ pressed }) => [styles.bell, { backgroundColor: c.surface, borderColor: c.line }, pressed && { opacity: 0.8 }]}
    >
      <Bell size={22} color={c.fg2} />
      {n > 0 ? (
        <View style={[styles.bellBadge, { backgroundColor: c.danger, borderColor: c.surface }]}>
          <Text size="xs" weight="bold" style={styles.bellText}>
            {n > 99 ? '99+' : String(n)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
};

export const HomeScreen = () => {
  const { user, timeZone, hasEmployee, can, isApprover } = useAuth();
  const { c } = useTheme();
  const qc = useQueryClient();
  const employee = useEmployeeDashboard();
  const showTeam = can('team:view');
  // Company-wide view for the super admin / HR (people who can see every employee).
  const orgWide = can('employee:read') && can('attendance:read');
  const manager = useManagerDashboard(showTeam);
  const now = useNow(60_000);
  // Pop-up: at the office, or outside the office area and how far.
  usePlacePopup('home');

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: dashboardKeys.all }),
      hasEmployee ? qc.invalidateQueries({ queryKey: attendanceKeys.today }) : Promise.resolve(),
    ]);

  const firstName = user?.firstName || (user ? fullName(user) : '');
  const greeting = greetingFor(timeZone, now);
  const greetingTone = toneColors(greeting.tone, c);
  // Phones under 400 pt wide (most Android phones): a slightly smaller name and a short date beside the buttons.
  const narrow = useWindowDimensions().width < 400;
  // Super Admin / Admin don't clock in: their highlight card is the company today instead.
  const isAdmin = (user?.roles ?? []).some((r) => r.key === 'super_admin' || r.key === 'admin');
  const employeeKind = dashboardKind(user?.roles) === 'employee';

  return (
    <Screen inTabs onRefresh={refresh}>
      {/* Header (reference design): photo, hello + name, greeting and date; Emergency and the bell on the right. */}
      <Appear index={0}>
        <View style={styles.header}>
          <AvatarPhotoButton size={48} />
          <View style={styles.flex} accessible accessibilityRole="header" accessibilityLabel={`${greeting.text}, ${firstName}`}>
            <View style={styles.nameLine}>
              <Text size={narrow ? 'lg' : 'xl'} weight="bold" numberOfLines={1} style={styles.shrink}>
                {`Hi, ${firstName}`}
              </Text>
              <Wave>
                <greeting.icon size={narrow ? 20 : 22} color={c.scheme === 'dark' ? greetingTone.fg : greetingTone.solid} />
              </Wave>
            </View>
            {/* The date is on the Today's Overview card; wide screens show it here too. */}
            <Text size="sm" color="muted" numberOfLines={1}>
              {narrow ? greeting.text : `${greeting.text} · ${longDateIn(timeZone, now, 'EEE, d MMM')}`}
            </Text>
          </View>
          <View style={styles.headerActions}>
            {hasEmployee ? <EmergencyButton /> : null}
            <UnreadBell count={employee.data?.unreadNotifications} />
          </View>
        </View>
      </Appear>

      {/* Global search: pages ("payslips", "check in"…) and records (people, leave, announcements, documents). */}
      <Appear index={0}>
        <Pressable
          onPress={() => router.push('/search')}
          accessibilityRole="search"
          accessibilityLabel="Search pages, people and leave"
          style={({ pressed }) => [styles.search, { backgroundColor: c.surface, borderColor: c.line }, pressed && { opacity: 0.85 }]}
        >
          <Search size={18} color={c.muted} />
          <Text size="sm" color="subtle" numberOfLines={1} style={styles.flex}>
            Search pages, people, leave…
          </Text>
        </Pressable>
      </Appear>

      {/* HR / super admin: unresolved emergencies stay on top until handled. */}
      <EmergencyBanner />

      {/* Today's Overview: clock in / out for everyone who clocks in; the company today for the boss. */}
      <Appear index={1}>{isAdmin ? <CompanyTodayHero /> : hasEmployee ? <ClockCard hero /> : null}</Appear>

      {/* What needs you: requests waiting for your approval. */}
      <ApprovalsHighlight />

      {/* Quick actions: the four most important shortcuts for the role (all of them behind the + in the bar). */}
      <Appear index={1} style={styles.section}>
        <SectionHeader title="Quick Actions" />
        <Card>
          <QuickActionsRow />
        </Card>
      </Appear>

      {/* Employees: this month at a glance. */}
      {hasEmployee && employeeKind ? (
        <Appear index={2} style={styles.section}>
          <SectionHeader title="This Month" actionLabel="Attendance" onAction={() => router.push('/attendance')} />
          <MonthStats />
        </Appear>
      ) : null}

      {hasEmployee ? (
        <Appear index={2}>
          <MyTasks />
        </Appear>
      ) : null}

      {/* Super admin / HR: the whole company at a glance. */}
      {orgWide ? (
        <>
          {isAdmin ? (
            <>
              <Appear index={2}>
                <NewJoiners />
              </Appear>
              <Appear index={2}>
                <Referrals />
              </Appear>
              <Appear index={2}>
                <EmployeeAlerts />
              </Appear>
            </>
          ) : (
            <>
              <Appear index={2}>
                <OrgToday />
              </Appear>
              {/* HR: the same Referrals card as on the web HR dashboard. */}
              <Appear index={2}>
                <Referrals />
              </Appear>
            </>
          )}
          <Appear index={3}>
            <WhosIn />
          </Appear>
          <Appear index={4}>
            <TasksOverview />
          </Appear>
          <Appear index={5}>
            <TeamActivity />
          </Appear>
          <Appear index={6}>
            <Departments />
          </Appear>
          <Appear index={7}>
            <Celebrations />
          </Appear>
        </>
      ) : null}

      {/* Sections slide in one after another. */}
      {showTeam && !orgWide ? (
        <Appear index={3}>
          <TeamSummary query={manager} canApprove={isApprover} />
        </Appear>
      ) : null}
      {/* Leave balance lives in the Leave tab (kept off home to keep it light). */}
      <Appear index={8}>
        <Announcements query={employee} />
      </Appear>
      {hasEmployee ? (
        <Appear index={9}>
          <UpcomingHolidays query={employee} />
        </Appear>
      ) : null}
      {hasEmployee ? (
        <Appear index={7}>
          <MyActivity />
        </Appear>
      ) : null}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space(3), marginTop: space(1) },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space(1.5), flexShrink: 1 },
  // Emergency and the bell sit close together so the name keeps its room.
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  search: { flexDirection: 'row', alignItems: 'center', gap: space(2.5), minHeight: 48, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space(4) },
  shrink: { flexShrink: 1 },
  section: { gap: space(2) },
  bell: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  bellBadge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 20,
    height: 20,
    borderRadius: radius.full,
    borderWidth: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellText: { color: '#ffffff', fontSize: 10, lineHeight: 12 },
});
