import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronRight, ClipboardCheck, ClipboardList, DoorOpen, ExternalLink, FileText, LogOut, Megaphone, Package, PartyPopper, Receipt, Settings, Siren, Target, UserRound, Users, Wallet } from 'lucide-react-native';
import { Appear, Avatar, Button, Card, GradientCard, ListItem, Screen, Header, Skeleton, Text, toast, useConfirm, type IconComponent } from '@/components';
import { useUnreadAnnouncements } from '@/features/announcements/api';
import { useUnreadCount } from '@/features/notifications/api';
import { usePendingApprovals } from '@/features/approvals/api';
import { useActiveEmergencies } from '@/features/emergencies/api';
import { useAssignable, useTasks } from '@/features/tasks/api';
import { signOut, useAuth } from '@/lib/auth';
import { API_ORIGIN, APP_VERSION } from '@/lib/config';
import { fullName } from '@/lib/format';
import { openWebApp } from '@/lib/links';
import { radius, space, toneColors, useTheme, type Tone } from '@/theme';
import { useMyEmployee } from '../api';
import { CountBadge } from '../kit/ui';

interface Entry {
  key: string;
  title: string;
  subtitle: string;
  icon: IconComponent;
  href: Href;
  right?: ReactNode;
  hidden?: boolean;
}

/** A friendly colour per menu item (icon bubble), instead of every icon being the same indigo. */
const ENTRY_TONE: Record<string, Tone> = {
  payslips: 'green',
  expenses: 'amber',
  notifications: 'red',
  announcements: 'amber',
  profile: 'brand',
  approvals: 'amber',
  goals: 'purple',
  tasks: 'amber',
  emergencies: 'red',
  holidays: 'teal',
  documents: 'blue',
  assets: 'teal',
  team: 'blue',
  resignation: 'gray',
  settings: 'gray',
};

/** Menu groups slide in one after another (staggered by their title's position). */
const GROUP_ORDER = ['Needs you', 'Pay & claims', 'Stay informed', 'Me & my team', 'App'];

const Group = ({ title, entries }: { title: string; entries: Entry[] }) => {
  const { c } = useTheme();
  const visible = entries.filter((e) => !e.hidden);
  if (!visible.length) return null;
  return (
    <Appear index={GROUP_ORDER.indexOf(title) + 1} style={styles.group}>
      <Text size="xs" weight="semibold" color="muted" accessibilityRole="header" style={styles.groupTitle}>
        {title.toUpperCase()}
      </Text>
      <Card padding={0}>
        {visible.map((e, i) => {
          const Icon = e.icon;
          const tone = toneColors(ENTRY_TONE[e.key] ?? 'brand', c);
          return (
            <ListItem
              key={e.key}
              divider={i > 0}
              title={e.title}
              subtitle={e.subtitle}
              left={
                <View style={[styles.icon, { backgroundColor: tone.bg }]}>
                  <Icon size={18} color={tone.solid} />
                </View>
              }
              right={e.right}
              onPress={() => router.push(e.href)}
            />
          );
        })}
      </Card>
    </Appear>
  );
};

export const MoreScreen = () => {
  const { user, hasEmployee, isManager, isApprover, can } = useAuth();
  const { c } = useTheme();
  const pending = usePendingApprovals(isApprover);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const me = useMyEmployee();
  const unread = useUnreadCount();
  const announcements = useUnreadAnnouncements();
  const openTasks = useTasks('mine', 'open', hasEmployee);
  const activeEmergencies = useActiveEmergencies(can('emergency:manage'));
  const canAssign = (useAssignable().data?.length ?? 0) > 0;
  const [signingOut, setSigningOut] = useState(false);
  if (!user) return null;

  const name = fullName(user);
  const e = me.data;
  const announcementCount = announcements.data?.count ?? 0;

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['employees', 'me'] }),
      qc.invalidateQueries({ queryKey: ['notifications'] }),
      qc.invalidateQueries({ queryKey: ['announcements'] }),
    ]);

  const onSignOut = async () => {
    const { confirmed } = await confirm({
      title: 'Sign out?',
      message: 'You will stop receiving notifications on this device until you sign in again.',
      confirmLabel: 'Sign out',
      tone: 'danger',
    });
    if (!confirmed) return;
    setSigningOut(true);
    await signOut();
    toast.success('Signed out');
  };

  return (
    <Screen inTabs header={<Header title="More" large />} onRefresh={refresh}>
      {/* Profile banner (reference design): photo and details on the role's colour; tap for My profile. */}
      <Pressable
        onPress={hasEmployee ? () => router.push('/more/profile') : undefined}
        disabled={!hasEmployee}
        accessibilityRole={hasEmployee ? 'button' : 'summary'}
        accessibilityLabel={hasEmployee ? `${name}, view my profile` : name}
      >
        <GradientCard colors={c.hero} radius={radius.xl} style={styles.profile}>
          <View style={styles.avatarRing}>
            <Avatar name={name} uri={user.avatar ?? e?.profilePhoto} size={60} />
          </View>
          <View style={styles.flex}>
            <Text size="lg" weight="bold" numberOfLines={1} style={styles.white}>
              {name}
            </Text>
            {hasEmployee && me.isLoading ? (
              <Skeleton width={140} height={14} />
            ) : e ? (
              <>
                {e.designationId ? (
                  <Text size="sm" numberOfLines={1} style={styles.soft}>
                    {e.designationId.name}
                  </Text>
                ) : null}
                <Text size="xs" numberOfLines={1} style={styles.soft}>
                  {[e.employeeId, e.departmentId?.name].filter(Boolean).join(' · ')}
                </Text>
              </>
            ) : (
              <Text size="sm" numberOfLines={1} style={styles.soft}>
                {user.email}
              </Text>
            )}
            <Text size="xs" numberOfLines={1} style={styles.soft}>
              {`${user.roles.map((r) => r.name).join(', ')} · ${user.organization.name}`}
            </Text>
          </View>
          {hasEmployee ? <ChevronRight size={20} color="#ffffff" /> : null}
        </GradientCard>
      </Pressable>

      {isApprover ? (
        <Group
          title="Needs you"
          entries={[
            {
              key: 'approvals',
              title: 'Approvals',
              subtitle: 'Leave, attendance and expense requests',
              icon: ClipboardCheck,
              href: '/approvals',
              right: <CountBadge count={pending.data?.total} label="requests waiting" />,
            },
          ]}
        />
      ) : null}

      <Group
        title="Pay & claims"
        entries={[
          { key: 'payslips', title: 'Payslips', subtitle: 'Monthly pay and PDF downloads', icon: Wallet, href: '/more/payslips', hidden: !hasEmployee },
          {
            key: 'expenses',
            title: 'Expenses',
            subtitle: 'Claims and reimbursements',
            icon: Receipt,
            href: '/more/expenses',
            hidden: !hasEmployee && !can('expense:create'),
          },
        ]}
      />
      <Group
        title="Stay informed"
        entries={[
          {
            key: 'notifications',
            title: 'Notifications',
            subtitle: 'Approvals, reminders and updates',
            icon: Bell,
            href: '/more/notifications',
            right: <CountBadge count={unread.data} label="unread notifications" />,
          },
          {
            key: 'emergencies',
            title: 'Emergencies',
            subtitle: 'Employee emergency alerts',
            icon: Siren,
            href: '/more/emergencies',
            right: <CountBadge count={activeEmergencies.data?.length} label="active emergencies" />,
            hidden: !can('emergency:manage'),
          },
          {
            key: 'announcements',
            title: 'Announcements',
            subtitle: 'Company news',
            icon: Megaphone,
            href: '/more/announcements',
            right: <CountBadge count={announcements.data?.capped ? 100 : announcementCount} label="unread announcements" />,
          },
        ]}
      />
      <Group
        title="Me & my team"
        entries={[
          { key: 'profile', title: 'My profile', subtitle: 'Contact, emergency and job details', icon: UserRound, href: '/more/profile', hidden: !hasEmployee },
          {
            key: 'tasks',
            title: 'Tasks',
            subtitle: canAssign ? 'Your tasks and tasks you assigned' : 'Work assigned to you',
            icon: ClipboardList,
            href: '/more/tasks',
            right: <CountBadge count={openTasks.data?.length} label="open tasks" />,
            hidden: !hasEmployee && !canAssign,
          },
          { key: 'goals', title: 'My goals', subtitle: 'Targets and progress', icon: Target, href: '/more/goals', hidden: !hasEmployee },
          { key: 'holidays', title: 'Holidays', subtitle: 'Company holiday calendar', icon: PartyPopper, href: '/more/holidays' },
          { key: 'documents', title: 'Documents', subtitle: 'Your records and company policies', icon: FileText, href: '/more/documents' },
          { key: 'assets', title: 'My assets', subtitle: 'Equipment assigned to you', icon: Package, href: '/more/assets', hidden: !hasEmployee },
          {
            key: 'team',
            title: can('employee:read') ? 'Employees' : 'My team',
            subtitle: can('employee:read')
              ? 'Everyone’s profile, attendance, selfies and locations'
              : isManager
                ? 'People who report to you'
                : 'Your reporting manager and teammates',
            icon: Users,
            href: '/more/team',
            hidden: !isManager && !hasEmployee && !can('employee:read'),
          },
          {
            key: 'resignation',
            title: 'Resignation',
            subtitle: 'Submit your resignation or follow its progress',
            icon: DoorOpen,
            href: '/more/resignation',
            hidden: !hasEmployee,
          },
        ]}
      />
      <Group
        title="App"
        entries={[{ key: 'settings', title: 'Settings', subtitle: 'Theme, notifications, security', icon: Settings, href: '/more/settings' }]}
      />

      <View style={styles.footer}>
        {API_ORIGIN ? (
          <Button variant="outline" icon={ExternalLink} onPress={() => void openWebApp(API_ORIGIN)} accessibilityHint="Opens the full web app in the browser">
            Open Stencil on the web
          </Button>
        ) : null}
        <Button variant="outline" icon={LogOut} loading={signingOut} onPress={() => void onSignOut()}>
          Sign out
        </Button>
        <Text size="xs" color="subtle" align="center">
          {`Stencil HRMS ${APP_VERSION}`}
        </Text>
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(4) },
  avatarRing: { borderRadius: 34, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)', padding: 2 },
  white: { color: '#ffffff' },
  soft: { color: 'rgba(255,255,255,0.85)' },
  group: { gap: space(2) },
  groupTitle: { paddingHorizontal: space(1), letterSpacing: 0.5 },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  footer: { gap: space(3), paddingTop: space(2) },
});
