import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Clock } from 'lucide-react-native';
import { Appear, GradientCard, Screen, SectionHeader, Text, Wave } from '@/components';
import { attendanceKeys } from '@/features/attendance/api';
import { ClockCard } from '@/features/attendance/components/clock-card';
import { EmergencyBanner } from '@/features/emergencies/emergency-banner';
import { EmergencyButton } from '@/features/emergencies/emergency-button';
import { AvatarPhotoButton } from '@/features/profile/components/avatar-photo-button';
import { useAuth } from '@/lib/auth';
import { fullName } from '@/lib/format';
import { useNow } from '@/lib/time';
import { radius, space, useTheme } from '@/theme';
import { dashboardKeys, useEmployeeDashboard, useManagerDashboard } from './api';
import { MyActivity } from './components/my-activity';
import { MyTasks } from './components/my-tasks';
import { AdminKpis, EmployeeAlerts, NewJoiners, QuickActions } from './components/admin-home';
import { Celebrations, Departments, OrgToday, TasksOverview, TeamActivity, WhosIn } from './components/org-overview';
import { Announcements, TeamSummary, UpcomingHolidays } from './components/widgets';
import { greetingFor, longDateIn } from './lib';

/** Greeting banner colours by time of day (soft pastels in light mode, deep tints in dark mode). */
const bannerColors = (greeting: string, scheme: 'light' | 'dark'): [string, string, string] => {
  const light: Record<string, [string, string, string]> = {
    'Good Morning': ['#fef3c7', '#fde7d4', '#e0f2fe'],
    'Good Afternoon': ['#e0f2fe', '#e0e7ff', '#f3e8ff'],
    'Good Evening': ['#e0e7ff', '#f3e8ff', '#fce7f3'],
  };
  const dark: Record<string, [string, string, string]> = {
    'Good Morning': ['#3a2f12', '#2b2433', '#12283a'],
    'Good Afternoon': ['#12283a', '#1e1f45', '#2a1d3f'],
    'Good Evening': ['#1e1f45', '#2a1d3f', '#3a1a31'],
  };
  const set = scheme === 'dark' ? dark : light;
  return set[greeting] ?? set['Good Afternoon']!;
};

const UnreadBell = ({ count }: { count: number | undefined }) => {
  const { c } = useTheme();
  const n = count ?? 0;
  return (
    <View
      style={styles.bell}
      accessible
      accessibilityRole="text"
      accessibilityLabel={n ? `${n} unread notification${n === 1 ? '' : 's'}` : 'No unread notifications'}
    >
      <Bell size={24} color={c.fg2} />
      {n > 0 ? (
        <View style={[styles.bellBadge, { backgroundColor: c.danger, borderColor: c.canvas }]}>
          <Text size="xs" weight="bold" style={styles.bellText}>
            {n > 99 ? '99+' : String(n)}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

export const HomeScreen = () => {
  const { user, timeZone, hasEmployee, can, isApprover } = useAuth();
  const { scheme } = useTheme();
  const qc = useQueryClient();
  const employee = useEmployeeDashboard();
  const showTeam = can('team:view');
  // Company-wide view for the super admin / HR (people who can see every employee).
  const orgWide = can('employee:read') && can('attendance:read');
  const manager = useManagerDashboard(showTeam);
  const now = useNow(60_000);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: dashboardKeys.all }),
      hasEmployee ? qc.invalidateQueries({ queryKey: attendanceKeys.today }) : Promise.resolve(),
    ]);

  const name = user ? fullName(user) : '';
  const greeting = greetingFor(timeZone, now);
  // Super admin: the web admin dashboard's look (lavender banner, stat cards, Quick Actions, New Joiners, Alerts).
  const isAdmin = (user?.roles ?? []).some((r) => r.key === 'super_admin');
  const banner: [string, string, string] = isAdmin
    ? scheme === 'dark'
      ? ['#2a1d4f', '#24194a', '#1e1a3d']
      : ['#ddd6fe', '#ede9fe', '#f5f3ff']
    : bannerColors(greeting.text, scheme);

  return (
    <Screen inTabs onRefresh={refresh}>
      {/* Greeting first; bell and avatar on the right. */}
      <Appear index={0}>
        <GradientCard colors={banner} style={styles.greeting}>
          <View style={styles.flex}>
            {/* The emoji waves once when the screen opens. */}
            <View style={styles.greetLine} accessible accessibilityRole="header" accessibilityLabel={`${greeting.text} ${name}`}>
              <Text size="xl" weight="bold">
                {greeting.text}
              </Text>
              <Wave>
                <Text size="xl">{greeting.emoji}</Text>
              </Wave>
              <Text size="xl" weight="bold" numberOfLines={1} style={styles.shrink}>
                {name}
              </Text>
            </View>
            <Text size="sm" color="muted" numberOfLines={1}>
              {longDateIn(timeZone, now)}
            </Text>
          </View>
          {hasEmployee ? <EmergencyButton /> : null}
          <UnreadBell count={employee.data?.unreadNotifications} />
          <AvatarPhotoButton size={40} />
        </GradientCard>
      </Appear>

      {/* HR / super admin: unresolved emergencies stay on top until handled. */}
      <EmergencyBanner />

      {isAdmin ? (
        <>
          <Appear index={1}>
            <AdminKpis />
          </Appear>
          <Appear index={1}>
            <QuickActions />
          </Appear>
        </>
      ) : null}

      {/* Clock in / Clock out: everyone with an employee profile except the super admin (the boss doesn't clock in). */}
      {hasEmployee && !isAdmin ? (
        <Appear index={1} style={styles.section}>
          <SectionHeader title="Today" icon={Clock} tone="brand" actionLabel="Attendance" onAction={() => router.push('/attendance')} />
          <ClockCard compact />
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
                <EmployeeAlerts />
              </Appear>
            </>
          ) : (
            <Appear index={2}>
              <OrgToday />
            </Appear>
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
  greeting: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(4), marginTop: space(1) },
  greetLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space(1.5) },
  shrink: { flexShrink: 1 },
  section: { gap: space(2) },
  bell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
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
