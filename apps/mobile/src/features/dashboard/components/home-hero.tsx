import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { AlarmClock, Building2, CalendarX2, ChevronRight, ClipboardCheck, Clock3, Plane, UserCheck, UserX } from 'lucide-react-native';
import { Card, Skeleton, Text, type IconComponent } from '@/components';
import { useAttendanceSummary } from '@/features/attendance/api';
import { usePendingApprovals } from '@/features/approvals/api';
import { useAuth } from '@/lib/auth';
import { dateKeyIn, formatKey, monthBounds } from '@/lib/time';
import { radius, space, toneColors, useTheme, type Tone } from '@/theme';
import { useAdminDashboard } from '../api';

/* The new Home pieces (reference design): the "Today's Overview" card for the boss, stat tiles, and the highlight
   for what's waiting on you. Colours follow the role (employee blue / navy, HR & admin purple). */

/** A small stat tile: coloured round icon, big number, label. */
export const StatTile = ({ label, value, icon: Icon, tone, onPress }: { label: string; value: number | string; icon: IconComponent; tone: Tone; onPress?: () => void }) => {
  const { c } = useTheme();
  const t = toneColors(tone, c);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'summary'}
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: c.surface, borderColor: c.line },
        c.scheme === 'light' && styles.shadow,
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={[styles.tileIcon, { backgroundColor: t.bg }]}>
        <Icon size={18} color={t.solid} />
      </View>
      <View style={styles.flex}>
        <Text size="xs" color="muted" numberOfLines={1}>
          {label}
        </Text>
        <Text size="xl" weight="bold" tabular>
          {value}
        </Text>
      </View>
    </Pressable>
  );
};

/** Employees: this month at a glance (present, late, leave, absent). */
export const MonthStats = () => {
  const { timeZone } = useAuth();
  const month = dateKeyIn(timeZone).slice(0, 7);
  const b = monthBounds(month);
  const q = useAttendanceSummary({ from: b.from, to: b.to });
  const s = q.data?.employees[0];
  if (q.isLoading) {
    return (
      <View style={styles.grid}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} height={64} style={styles.cell} />
        ))}
      </View>
    );
  }
  const open = () => router.push('/attendance');
  return (
    <View style={styles.grid}>
      <View style={styles.cell}>
        <StatTile label="Present" value={(s?.present ?? 0) + (s?.workFromHome ?? 0)} icon={UserCheck} tone="green" onPress={open} />
      </View>
      <View style={styles.cell}>
        <StatTile label="Late" value={s?.late ?? 0} icon={AlarmClock} tone="amber" onPress={open} />
      </View>
      <View style={styles.cell}>
        <StatTile label="On leave" value={s?.leave ?? 0} icon={Plane} tone="purple" onPress={() => router.push('/leave')} />
      </View>
      <View style={styles.cell}>
        <StatTile label="Absent" value={s?.absent ?? 0} icon={CalendarX2} tone="red" onPress={open} />
      </View>
    </View>
  );
};

/** Super Admin / Admin: the whole company today on a white card — one bar split by status, then each status with its count. */
export const CompanyToday = () => {
  const { c } = useTheme();
  const { timeZone } = useAuth();
  const q = useAdminDashboard(true);
  const k = q.data?.cards;
  if (q.isLoading || !k) return <Skeleton height={300} style={{ borderRadius: radius.xl }} />;
  const total = k.totalEmployees || 0;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  // Late people are among the present: the bar shows on time and late side by side, then leave, absent, not in yet.
  const parts: { label: string; value: number; tone: Tone; icon: IconComponent }[] = [
    { label: 'On time', value: Math.max(0, k.presentToday - k.lateToday), tone: 'green', icon: UserCheck },
    { label: 'Late', value: k.lateToday, tone: 'amber', icon: AlarmClock },
    { label: 'On leave', value: k.onLeaveToday, tone: 'blue', icon: Plane },
    { label: 'Absent', value: k.absentToday, tone: 'red', icon: UserX },
    { label: 'Not in yet', value: k.notCheckedInToday, tone: 'gray', icon: Clock3 },
  ];
  const counted = parts.reduce((n, p) => n + p.value, 0);
  const green = toneColors('green', c);
  return (
    <Card
      onPress={() => router.push('/attendance')}
      accessibilityLabel={`Company today: ${k.presentToday} of ${total} present. ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}`}
      style={styles.company}
    >
      <View style={styles.companyTop}>
        <View style={[styles.companyIcon, { backgroundColor: c.accentSoft }]}>
          <Building2 size={18} color={c.accent} />
        </View>
        <View style={styles.flex}>
          <Text weight="bold">Company Today</Text>
          <Text size="xs" color="muted">
            {formatKey(dateKeyIn(timeZone), 'EEE, d MMM yyyy')}
          </Text>
        </View>
        <ChevronRight size={18} color={c.subtle} />
      </View>

      <View style={styles.companyBig}>
        <Text size="3xl" weight="bold">
          {k.presentToday}
        </Text>
        <Text size="sm" color="muted" style={styles.flex}>{`of ${total} present`}</Text>
        <View style={[styles.companyPct, { backgroundColor: green.bg, borderColor: green.border }]}>
          <Text size="xs" weight="bold" style={{ color: green.fg }}>{`${pct(k.presentToday)}%`}</Text>
        </View>
      </View>

      {/* One bar, split by status (2 pt gaps between parts); anyone not counted (e.g. week off) stays as track. */}
      <View style={[styles.companyBar, { backgroundColor: c.surface3 }]}>
        {parts.map((p) =>
          p.value > 0 ? <View key={p.label} style={{ flex: p.value, backgroundColor: toneColors(p.tone, c).solid }} /> : null,
        )}
        {total > counted ? <View style={{ flex: total - counted }} /> : null}
      </View>

      <View style={styles.companyRows}>
        {parts.map((p) => {
          const t = toneColors(p.tone, c);
          return (
            <View key={p.label} style={styles.companyRow}>
              <View style={[styles.companyRowIcon, { backgroundColor: t.bg }]}>
                <p.icon size={14} color={t.solid} />
              </View>
              <Text size="sm" style={styles.flex}>
                {p.label}
              </Text>
              <Text size="sm" weight="bold" tabular>
                {p.value}
              </Text>
              <Text size="xs" color="muted" tabular style={styles.companyRowPct}>
                {`${pct(p.value)}%`}
              </Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
};

/** Approvers: a highlighted card when requests are waiting (leave, attendance corrections, expenses). */
export const ApprovalsHighlight = () => {
  const { c } = useTheme();
  const { isApprover } = useAuth();
  const q = usePendingApprovals(isApprover);
  const d = q.data;
  if (!isApprover || !d?.total) return null;
  const amber = toneColors('amber', c);
  const parts = [
    d.leave ? `${d.leave} leave` : null,
    d.attendance ? `${d.attendance} attendance` : null,
    d.expenses ? `${d.expenses} expense${d.expenses === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return (
    <Pressable
      onPress={() => router.push('/approvals')}
      accessibilityRole="button"
      accessibilityLabel={`${d.total} request${d.total === 1 ? '' : 's'} waiting for your approval`}
      style={({ pressed }) => [styles.alert, { backgroundColor: amber.bg, borderColor: amber.border }, pressed && { opacity: 0.85 }]}
    >
      <View style={[styles.alertIcon, { backgroundColor: amber.solid }]}>
        <ClipboardCheck size={20} color="#ffffff" />
      </View>
      <View style={styles.flex}>
        <Text weight="bold" style={{ color: amber.fg }}>
          {`${d.total} request${d.total === 1 ? '' : 's'} need${d.total === 1 ? 's' : ''} your approval`}
        </Text>
        <Text size="xs" style={{ color: amber.fg }} numberOfLines={1}>
          {parts.join(' · ')}
        </Text>
      </View>
      <ChevronRight size={20} color={amber.fg} />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2.5) },
  cell: { flexBasis: '47%', flexGrow: 1 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: space(3), borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space(3) },
  tileIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  shadow: { shadowColor: '#1e1b4b', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  // Company Today (white card).
  company: { gap: space(3) },
  companyTop: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  companyIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  companyBig: { flexDirection: 'row', alignItems: 'baseline', gap: space(2) },
  companyPct: { borderRadius: radius.full, borderWidth: 1, paddingHorizontal: space(2.5), paddingVertical: 2, alignSelf: 'center' },
  companyBar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 },
  companyRows: { gap: space(2) },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: space(2.5) },
  companyRowIcon: { width: 26, height: 26, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  companyRowPct: { width: 38, textAlign: 'right' },
  alert: { flexDirection: 'row', alignItems: 'center', gap: space(3), borderRadius: radius.xl, borderWidth: 1, padding: space(3.5) },
  alertIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
