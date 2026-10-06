import { Pressable, StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import {
  AlarmClock,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bell,
  Cake,
  CalendarPlus,
  ChevronRight,
  FileWarning,
  Hourglass,
  House,
  LayoutGrid,
  Megaphone,
  Plane,
  Target,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  Zap,
} from 'lucide-react-native';
import { Avatar, Card, SkeletonList, Text } from '@/components';
import { useAuth } from '@/lib/auth';
import { formatKey } from '@/lib/time';
import { radius, space, toneColors, useTheme, type Tone } from '@/theme';
import { useAdminDashboard, useAttendanceBoard } from '../api';

/* Super admin Home: the same blocks as the web admin dashboard (stat cards, Quick Actions, New Joiners, Employee Alerts). */

const VIOLET = { bg: '#f5f3ff', soft: '#ede9fe', fg: '#7c3aed', border: '#ddd6fe' };

/** Card title row: violet icon + black title, optional "View all". */
const Title = ({ icon: Icon, title, onAll }: { icon: typeof Users; title: string; onAll?: () => void }) => {
  const { c } = useTheme();
  return (
    <View style={styles.titleRow}>
      <View style={styles.titleLeft}>
        <Icon size={18} color={c.scheme === 'dark' ? '#c4b5fd' : VIOLET.fg} />
        <Text size="md" weight="semibold" accessibilityRole="header">
          {title}
        </Text>
      </View>
      {onAll ? (
        <Pressable onPress={onAll} hitSlop={8} accessibilityRole="link" accessibilityLabel={`View all ${title}`}>
          <Text size="xs" weight="semibold" style={{ color: c.scheme === 'dark' ? '#c4b5fd' : VIOLET.fg }}>
            View all
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

/* ------------------------------ Stat cards ------------------------------ */

const change = (now: number, before: number | undefined) => (before ? Math.round(((now - before) / before) * 1000) / 10 : null);

const Kpi = ({
  label,
  value,
  icon: Icon,
  tone,
  delta,
  share,
  note,
  to,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  tone: Tone;
  delta?: number | null;
  share?: number;
  note: string;
  to: Href;
}) => {
  const { c } = useTheme();
  const t = toneColors(tone, c);
  return (
    <Pressable
      onPress={() => router.push(to)}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => [styles.kpi, { backgroundColor: t.bg, borderColor: t.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={[styles.kpiIcon, { backgroundColor: t.solid }]}>
        <Icon size={18} color="#ffffff" />
      </View>
      <Text size="sm" weight="medium" numberOfLines={1}>
        {label}
      </Text>
      <Text size="2xl" weight="bold" tabular>
        {value}
      </Text>
      {delta != null ? (
        <View style={styles.deltaRow}>
          {delta >= 0 ? <ArrowUp size={12} color={c.success} /> : <ArrowDown size={12} color={c.danger} />}
          <Text size="xs" weight="semibold" style={{ color: delta >= 0 ? c.success : c.danger }}>{`${Math.abs(delta)}%`}</Text>
        </View>
      ) : (
        <Text size="xs" weight="semibold" style={{ color: t.fg }}>{`${share ?? 0}%`}</Text>
      )}
      <Text size="xs" color="muted" numberOfLines={1}>
        {note}
      </Text>
    </Pressable>
  );
};

/** Headcount, present, on leave, absent, remote and new joiners — two per row. */
export const AdminKpis = () => {
  const q = useAdminDashboard(true);
  const board = useAttendanceBoard(true);
  const k = q.data?.cards;
  if (q.isLoading || !k) return <SkeletonList rows={3} />;
  const total = k.totalEmployees;
  const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  const growth = q.data?.charts.employeeGrowth ?? [];
  const thisMonth = growth[growth.length - 1];
  const lastMonth = growth[growth.length - 2];
  const remote = (board.data?.cards ?? []).filter((p) => p.workMode === 'REMOTE' && p.column !== 'NOT_IN').length;
  const joiners = q.data?.insights?.joinersThisMonth.length ?? thisMonth?.joined ?? 0;
  return (
    <View style={styles.kpiGrid}>
      <Kpi label="Total Employees" value={total} icon={Users} tone="purple" delta={change(thisMonth?.headcount ?? total, lastMonth?.headcount)} note="vs. last month" to="/more/team" />
      <Kpi label="Present Today" value={k.presentToday} icon={UserCheck} tone="green" share={pct(k.presentToday)} note="of total employees" to="/attendance" />
      <Kpi label="On Leave Today" value={k.onLeaveToday} icon={Plane} tone="amber" share={pct(k.onLeaveToday)} note="of total employees" to="/leave" />
      <Kpi label="Absent Today" value={k.absentToday} icon={UserX} tone="red" share={pct(k.absentToday)} note="of total employees" to="/attendance" />
      <Kpi label="Working Remotely" value={remote} icon={House} tone="blue" share={pct(remote)} note="of total employees" to="/attendance" />
      <Kpi label="New Joiners" value={joiners} icon={UserPlus} tone="purple" delta={change(thisMonth?.joined ?? joiners, lastMonth?.joined)} note="this month vs. last" to="/more/team" />
    </View>
  );
};

/* ----------------------------- Quick Actions ---------------------------- */

export const QuickActions = () => {
  const { c } = useTheme();
  const { hasEmployee, can } = useAuth();
  const actions: { label: string; icon: typeof Users; to: Href }[] = [
    ...(hasEmployee
      ? [
          { label: 'Apply leave', icon: CalendarPlus, to: '/leave/apply' as Href },
          { label: 'My Goals', icon: Target, to: '/more/goals' as Href },
        ]
      : []),
    { label: 'Live board', icon: LayoutGrid, to: '/attendance' },
    ...(can('announcement:manage') ? [{ label: 'Announce', icon: Megaphone, to: '/more/announcements' as Href }] : []),
  ];
  const dark = c.scheme === 'dark';
  return (
    <Card style={styles.gap}>
      <Title icon={Zap} title="Quick Actions" />
      {actions.map((a) => (
        <Pressable
          key={a.label}
          onPress={() => router.push(a.to)}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          style={({ pressed }) => [styles.action, { backgroundColor: dark ? 'rgba(139,92,246,0.15)' : VIOLET.bg, opacity: pressed ? 0.8 : 1 }]}
        >
          <View style={[styles.actionIcon, { backgroundColor: dark ? 'rgba(139,92,246,0.25)' : '#ffffff' }]}>
            <a.icon size={16} color={dark ? '#ddd6fe' : VIOLET.fg} />
          </View>
          <Text size="sm" weight="medium" style={styles.flex}>
            {a.label}
          </Text>
          <ArrowRight size={16} color={dark ? '#c4b5fd' : '#8b5cf6'} />
        </Pressable>
      ))}
    </Card>
  );
};

/* ------------------------------ New Joiners ----------------------------- */

export const NewJoiners = () => {
  const { c } = useTheme();
  const q = useAdminDashboard(true);
  const people = q.data?.insights?.recentJoiners ?? q.data?.insights?.joinersThisMonth ?? [];
  const dark = c.scheme === 'dark';
  return (
    <Card style={styles.gap}>
      <Title icon={UserPlus} title="New Joiners" onAll={() => router.push('/more/team')} />
      {q.isLoading ? (
        <SkeletonList rows={3} />
      ) : people.length ? (
        people.slice(0, 4).map((p) => (
          <Pressable
            key={p._id}
            onPress={() => router.push({ pathname: '/more/team/[id]', params: { id: p._id } })}
            accessibilityRole="button"
            accessibilityLabel={`${p.name}${p.date ? `, joined ${formatKey(p.date, 'dd MMM')}` : ''}`}
            style={styles.person}
          >
            <Avatar name={p.name} uri={p.profilePhoto} size={36} />
            <View style={styles.flex}>
              <Text size="sm" weight="semibold" numberOfLines={1}>
                {p.name}
              </Text>
              <Text size="xs" color="muted" numberOfLines={1}>
                {[p.designation, p.department].filter(Boolean).join(' · ') || 'New joiner'}
              </Text>
            </View>
            {p.date ? (
              <View style={[styles.pill, { backgroundColor: dark ? 'rgba(139,92,246,0.2)' : VIOLET.soft }]}>
                <Text size="xs" weight="semibold" style={{ color: dark ? '#ddd6fe' : '#6d28d9' }}>
                  {formatKey(p.date, 'dd MMM')}
                </Text>
              </View>
            ) : null}
          </Pressable>
        ))
      ) : (
        <Text size="sm" color="muted">
          No recent joiners.
        </Text>
      )}
    </Card>
  );
};

/* ---------------------------- Employee Alerts --------------------------- */

export const EmployeeAlerts = () => {
  const { c } = useTheme();
  const q = useAdminDashboard(true);
  const d = q.data;
  const birthdays = (d?.widgets.upcomingBirthdays ?? []).filter((b) => b.inDays <= 7).length;
  const rows: { text: string; count: number; icon: typeof Users; tone: Tone; to: Href }[] = d
    ? [
        { text: 'Absent today', count: d.cards.absentToday, icon: UserX, tone: 'red', to: '/attendance' },
        { text: 'Arrived late', count: d.cards.lateToday, icon: AlarmClock, tone: 'amber', to: '/attendance' },
        { text: 'Documents expiring soon', count: d.widgets.expiringDocuments?.length ?? 0, icon: FileWarning, tone: 'blue', to: '/more/documents' },
        { text: 'Probation ending soon', count: d.insights?.probationEndingSoon ?? 0, icon: Hourglass, tone: 'purple', to: '/more/team' },
        { text: 'Birthdays this week', count: birthdays, icon: Cake, tone: 'red', to: '/more/team' },
      ]
    : [];
  return (
    <Card style={styles.gap}>
      <Title icon={Bell} title="Employee Alerts" onAll={() => router.push('/more/notifications')} />
      {q.isLoading ? (
        <SkeletonList rows={4} />
      ) : (
        rows.map((r) => {
          const t = toneColors(r.tone, c);
          return (
            <Pressable key={r.text} onPress={() => router.push(r.to)} accessibilityRole="button" accessibilityLabel={`${r.text}: ${r.count}`} style={styles.alert}>
              <View style={[styles.alertIcon, { backgroundColor: t.bg }]}>
                <r.icon size={16} color={t.solid} />
              </View>
              <Text size="sm" style={styles.flex}>
                {r.text}
              </Text>
              <View style={[styles.count, { backgroundColor: t.bg }]}>
                <Text size="xs" weight="bold" tabular style={{ color: t.fg }}>
                  {r.count}
                </Text>
              </View>
              <ChevronRight size={16} color={c.subtle} />
            </Pressable>
          );
        })
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space(2.5) },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleLeft: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2.5) },
  kpi: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderRadius: radius.lg, padding: space(3), gap: 2 },
  kpiIcon: { width: 32, height: 32, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: space(1.5) },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  action: { flexDirection: 'row', alignItems: 'center', gap: space(3), borderRadius: radius.md, paddingVertical: space(2.5), paddingHorizontal: space(3) },
  actionIcon: { width: 30, height: 30, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  person: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  pill: { borderRadius: radius.full, paddingHorizontal: space(2), paddingVertical: 2 },
  alert: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(1) },
  alertIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  count: { minWidth: 28, borderRadius: radius.full, paddingHorizontal: space(2), paddingVertical: 2, alignItems: 'center' },
});
