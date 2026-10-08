import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight, Siren } from 'lucide-react-native';
import { PressScale, PulseRing, Text } from '@/components';
import { useAuth } from '@/lib/auth';
import { fullName } from '@/lib/format';
import { timeAgo } from '@/lib/time';
import { radius, space, useTheme } from '@/theme';
import { CATEGORY_META, useActiveEmergencies } from './api';

/** HR / super admin Home: a red, pulsing banner while any emergency is unresolved (checked every 10 s). */
export const EmergencyBanner = () => {
  const { c } = useTheme();
  const { can } = useAuth();
  const q = useActiveEmergencies(can('emergency:manage'));
  const items = q.data ?? [];
  if (!items.length) return null;
  const first = items[0]!;
  const name = first.employeeId ? fullName(first.employeeId) : 'An employee';
  const unseen = items.filter((e) => e.status === 'OPEN').length;
  const CategoryIcon = CATEGORY_META[first.category].icon;

  return (
    <PressScale onPress={() => router.push('/more/emergencies')} accessibilityRole="button" accessibilityLabel={`${items.length} active emergencies. Open`}>
      <View style={[styles.banner, { backgroundColor: c.danger }]}>
        <View style={styles.icon}>
          {unseen ? <PulseRing size={40} color="#ffffff" /> : null}
          <Siren size={22} color="#ffffff" />
        </View>
        <View style={styles.flex}>
          <Text weight="bold" style={styles.white} numberOfLines={1}>
            {items.length > 1 ? `${items.length} active emergencies` : `Emergency: ${name}`}
          </Text>
          <View style={styles.line}>
            <CategoryIcon size={14} color="rgba(255,255,255,0.9)" style={styles.lineIcon} />
            <Text size="sm" style={[styles.dim, styles.flex]} numberOfLines={2}>
              {`${CATEGORY_META[first.category].label}${first.needToLeave ? ' · needs to leave' : ''} · ${timeAgo(first.createdAt)}${unseen ? ' · not acknowledged' : ''}`}
            </Text>
          </View>
        </View>
        <ChevronRight size={22} color="#ffffff" />
      </View>
    </PressScale>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: space(1.5) },
  lineIcon: { marginTop: 3.5 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(4), borderRadius: radius.lg },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.2)' },
  white: { color: '#ffffff' },
  dim: { color: 'rgba(255,255,255,0.9)' },
});
