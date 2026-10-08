import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { AlarmClock, CalendarX2, ChevronRight, ClipboardCheck, Plane, UserCheck, UserX, Users } from 'lucide-react-native';
import { GradientCard, HalfMoonGauge, Skeleton, Text, type IconComponent } from '@/components';
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

/** Colours of the company half-moon's parts (on the purple / navy hero), shared with the legend tiles. */
const PART = { onTime: '#ffffff', late: '#fbbf24', leave: '#7dd3fc', absent: '#fb7185', notIn: 'rgba(255,255,255,0.5)' } as const;

/** Super Admin / Admin (who don't clock in): the company today as a half-moon — on time, late, on leave, absent, not in yet. */
export const CompanyTodayHero = () => {
  const { c } = useTheme();
  const { timeZone } = useAuth();
  const q = useAdminDashboard(true);
  const k = q.data?.cards;
  if (q.isLoading || !k) return <Skeleton height={190} style={{ borderRadius: radius.xl }} />;
  const total = k.totalEmployees || 0;
  const pct = total ? Math.min(100, Math.round((k.presentToday / total) * 100)) : 0;
  const share = (n: number) => (total ? (n / total) * 100 : 0);
  // Late people are among the present: the arc shows on time and late side by side, then leave, absent, not in yet.
  const onTime = Math.max(0, k.presentToday - k.lateToday);
  const white = { color: '#ffffff' };
  const soft = { color: 'rgba(255,255,255,0.82)' };
  const glass = { backgroundColor: 'rgba(255,255,255,0.14)', borderColor: 'rgba(255,255,255,0.22)' };
  const mini = (label: string, value: number, Icon: IconComponent, color: string) => (
    <View style={[styles.mini, glass]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Icon size={14} color={color} />
      <Text size="lg" weight="bold" tabular style={white}>
        {value}
      </Text>
      <View style={styles.legend}>
        <View style={[styles.legendDot, { backgroundColor: color }]} />
        <Text size="xs" style={soft} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
  return (
    <Pressable onPress={() => router.push('/attendance')} accessibilityRole="button" accessibilityLabel={`Today: ${k.presentToday} of ${total} present`}>
      <GradientCard colors={c.hero} radius={radius.xl} style={styles.hero}>
        <View style={styles.heroTop}>
          <Text size="sm" weight="semibold" style={soft}>
            Today’s Overview
          </Text>
          <View style={[styles.pill, glass]}>
            <Text size="xs" weight="semibold" style={white}>
              {formatKey(dateKeyIn(timeZone), 'd MMM yyyy')}
            </Text>
          </View>
        </View>
        {/* The whole day in one half-moon; the tiles below are its legend. */}
        <HalfMoonGauge
          width={240}
          segments={[
            { value: share(onTime), color: PART.onTime },
            { value: share(k.lateToday), color: PART.late },
            { value: share(k.onLeaveToday), color: PART.leave },
            { value: share(k.absentToday), color: PART.absent },
            { value: share(k.notCheckedInToday), color: PART.notIn },
          ]}
          startLabel="0"
          endLabel={String(total)}
          accessibilityLabel={`${k.presentToday} of ${total} present (${k.lateToday} late), ${k.onLeaveToday} on leave, ${k.absentToday} absent, ${k.notCheckedInToday} not in yet`}
        >
          <Text size="display" weight="bold" tabular style={white}>
            {k.presentToday}
          </Text>
          <Text size="sm" style={soft}>{`of ${total} present · ${pct}%`}</Text>
        </HalfMoonGauge>
        <View style={styles.minis}>
          {mini('Late', k.lateToday, AlarmClock, PART.late)}
          {mini('On leave', k.onLeaveToday, Plane, PART.leave)}
          {mini('Absent', k.absentToday, UserX, PART.absent)}
          {mini('Not in yet', k.notCheckedInToday, Users, PART.notIn)}
        </View>
      </GradientCard>
    </Pressable>
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
  hero: { padding: space(4), gap: space(3) },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: { borderRadius: radius.full, borderWidth: 1, paddingHorizontal: space(2.5), paddingVertical: space(1) },
  minis: { flexDirection: 'row', gap: space(2) },
  mini: { flex: 1, borderRadius: radius.md, borderWidth: 1, paddingVertical: space(2), alignItems: 'center', gap: 2 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%', paddingHorizontal: 2 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  alert: { flexDirection: 'row', alignItems: 'center', gap: space(3), borderRadius: radius.xl, borderWidth: 1, padding: space(3.5) },
  alertIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
