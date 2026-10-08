import { Pressable, StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { AlarmClock, Bell, Cake, ChevronRight, FileWarning, Handshake, Hourglass, Trophy, UserPlus, UserX, type LucideIcon } from 'lucide-react-native';
import { Avatar, Card, SkeletonList, StatusBadge, Text } from '@/components';
import { useAuth } from '@/lib/auth';
import { formatKey } from '@/lib/time';
import { radius, space, toneColors, useTheme, type Tone } from '@/theme';
import { useAdminDashboard, useReferralSummary } from '../api';

/* Super admin / HR Home cards from the web admin dashboard: New Joiners, Employee Alerts, Referrals. */

const VIOLET = { bg: '#f5f3ff', soft: '#ede9fe', fg: '#7c3aed', border: '#ddd6fe' };

/** Card title row: violet icon + black title, optional "View all". */
const Title = ({ icon: Icon, title, onAll }: { icon: LucideIcon; title: string; onAll?: () => void }) => {
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
  const rows: { text: string; count: number; icon: LucideIcon; tone: Tone; to: Href }[] = d
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

/* ------------------------------- Referrals ------------------------------ */

/**
 * Candidates referred by employees (as on the web dashboard): totals, the latest few — who referred them and where
 * they are — and the top referrer. Super Admin, Admin and HR (anyone with recruitment:read).
 */
export const Referrals = () => {
  const { c } = useTheme();
  const { can } = useAuth();
  const allowed = can('recruitment:read');
  const q = useReferralSummary(allowed);
  if (!allowed) return null;
  const d = q.data;
  const dark = c.scheme === 'dark';
  const accent = dark ? '#ddd6fe' : '#6d28d9';
  const name = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();
  return (
    <Card style={styles.gap}>
      <Title icon={Handshake} title="Referrals" />
      {q.isLoading ? (
        <SkeletonList rows={3} />
      ) : q.isError || !d ? (
        <Text size="sm" color="muted">
          Couldn’t load referrals.
        </Text>
      ) : d.total ? (
        <>
          <View style={styles.refStats}>
            {[
              { label: 'Referred', value: d.total },
              { label: 'In process', value: d.inProcess },
              { label: 'Hired', value: d.hired },
            ].map((s) => (
              <View key={s.label} style={[styles.refStat, { backgroundColor: dark ? 'rgba(139,92,246,0.12)' : VIOLET.bg }]} accessible accessibilityLabel={`${s.label}: ${s.value}`}>
                <Text size="lg" weight="bold" tabular style={{ color: accent }}>
                  {s.value}
                </Text>
                <Text size="xs" color="muted">
                  {s.label}
                </Text>
              </View>
            ))}
          </View>
          {d.recent.slice(0, 4).map((r) => (
            <View key={r._id} style={styles.person}>
              <View style={styles.flex}>
                <Text size="sm" weight="semibold" numberOfLines={1}>
                  {name(r)}
                </Text>
                <Text size="xs" color="muted" numberOfLines={1}>
                  {[r.jobId?.title, r.referredBy ? `by ${name(r.referredBy)}` : null].filter(Boolean).join(' · ') || 'Referral'}
                </Text>
              </View>
              <StatusBadge status={r.stage} />
            </View>
          ))}
          {d.topReferrer ? (
            <Pressable
              onPress={() => router.push({ pathname: '/more/team/[id]', params: { id: d.topReferrer!._id } })}
              accessibilityRole="button"
              accessibilityLabel={`Top referrer: ${name(d.topReferrer)}, ${d.topReferrer.count} referrals`}
              style={[styles.person, styles.topRef, { borderTopColor: dark ? 'rgba(139,92,246,0.2)' : VIOLET.soft }]}
            >
              <Trophy size={16} color="#f59e0b" />
              <Avatar name={name(d.topReferrer)} uri={d.topReferrer.profilePhoto} size={24} />
              <Text size="xs" color="fg2" numberOfLines={1} style={styles.flex}>
                {'Top referrer: '}
                <Text size="xs" weight="semibold">
                  {name(d.topReferrer)}
                </Text>
              </Text>
              <Text size="xs" weight="semibold" tabular>
                {d.topReferrer.count}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <Text size="sm" color="muted">
          No referrals yet. HR adds them as candidates with source “Referral” (on the web, under Recruitment).
        </Text>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  refStats: { flexDirection: 'row', gap: space(2) },
  refStat: { flex: 1, alignItems: 'center', borderRadius: radius.md, paddingVertical: space(1.5) },
  topRef: { borderTopWidth: 1, paddingTop: space(2.5), gap: space(2) },
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
