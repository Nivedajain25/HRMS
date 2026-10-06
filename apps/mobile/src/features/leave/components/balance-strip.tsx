import { Pressable, StyleSheet, View } from 'react-native';
import type { UseQueryResult } from '@tanstack/react-query';
import { Wallet } from 'lucide-react-native';
import { Card, EmptyState, ErrorState, Skeleton, Text } from '@/components';
import { radius, space, useTheme, withAlpha } from '@/theme';
import type { LeaveBalance } from '../api';
import { formatNum, typeColor } from '../lib';

const BalanceChip = ({ b, onPress }: { b: LeaveBalance; onPress?: (typeId: string) => void }) => {
  const { c } = useTheme();
  const color = typeColor(b.leaveType);
  const unpaid = b.leaveType.paid === false;
  const entitlement = Math.max(0, b.opening + b.allocated + b.carryForward + b.adjusted - b.encashed);
  const usedPct = entitlement > 0 ? Math.min(100, (b.used / entitlement) * 100) : 0;
  const pendingPct = entitlement > 0 ? Math.min(100 - usedPct, (b.pending / entitlement) * 100) : 0;
  const low = !unpaid && (b.remaining < 0 || (b.remaining === 0 && entitlement > 0));
  const a11y = unpaid
    ? `${b.leaveType.name}: unpaid, ${formatNum(b.used)} days taken${b.pending ? `, ${formatNum(b.pending)} pending` : ''}`
    : `${b.leaveType.name}: ${formatNum(b.remaining)} days remaining of ${formatNum(entitlement)}, ${formatNum(b.used)} used, ${formatNum(b.pending)} pending`;
  return (
    <Pressable
      onPress={onPress ? () => onPress(b.leaveType._id) : undefined}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'summary'}
      accessibilityLabel={a11y}
      accessibilityHint={onPress ? `Apply for ${b.leaveType.name}` : undefined}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: withAlpha(color, 0.35),
          backgroundColor: pressed ? withAlpha(color, 0.2) : withAlpha(color, c.scheme === 'dark' ? 0.14 : 0.07),
        },
      ]}
    >
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text size="xs" weight="semibold" color="fg2" numberOfLines={1} style={styles.shrink}>
          {b.leaveType.name}
        </Text>
      </View>
      <View style={styles.big}>
        <Text size="2xl" weight="bold" tabular style={low ? { color: c.danger } : undefined}>
          {formatNum(unpaid ? b.used : b.remaining)}
        </Text>
        <Text size="xs" color="muted">
          {unpaid ? 'taken' : `of ${formatNum(entitlement)} left`}
        </Text>
      </View>
      {!unpaid ? (
        <View style={[styles.track, { backgroundColor: c.surface3 }]}>
          <View style={{ width: `${usedPct}%`, backgroundColor: color }} />
          <View style={{ width: `${pendingPct}%`, backgroundColor: withAlpha(color, 0.4) }} />
        </View>
      ) : null}
      <Text size="xs" color="muted" numberOfLines={1}>
        {unpaid ? (b.pending ? `${formatNum(b.pending)} pending` : 'Unpaid') : `${formatNum(b.used)} used · ${formatNum(b.pending)} pending`}
      </Text>
    </Pressable>
  );
};

/** Leave balances as a two-column grid of cards (tap one to apply for that type). */
export const BalanceStrip = ({
  query,
  year,
  onApply,
}: {
  query: UseQueryResult<LeaveBalance[]>;
  year: number;
  onApply?: (typeId: string) => void;
}) => {
  if (query.isLoading) {
    return (
      <View style={styles.loading} accessible accessibilityLabel="Loading balances">
        <Skeleton width={156} height={128} />
        <Skeleton width={156} height={128} />
      </View>
    );
  }
  if (query.error || !query.data) {
    return (
      <Card>
        <ErrorState compact title="Could not load balances" error={query.error} onRetry={() => void query.refetch()} />
      </Card>
    );
  }
  // Hide leave types you have nothing in (0 of 0, nothing used or pending) to keep the strip short.
  const shown = query.data.filter((b) => b.remaining > 0 || b.used > 0 || b.pending > 0 || b.allocated + b.carryForward + b.adjusted > 0);
  if (!shown.length) {
    return (
      <Card>
        <EmptyState compact icon={Wallet} title="No leave balances" message={`No leave types apply for ${year}. Ask HR to configure leave policies.`} />
      </Card>
    );
  }
  // A two-column grid: every balance is visible at once, no sideways scrolling.
  return (
    <View style={styles.grid} accessibilityLabel={`Leave balances for ${year}`}>
      {shown.map((b) => (
        <BalanceChip key={b._id} b={b} onPress={onApply} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  shrink: { flexShrink: 1 },
  loading: { flexDirection: 'row', gap: space(3), overflow: 'hidden' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2.5) },
  // Two per row (the gap is subtracted via flexBasis just under 50%).
  chip: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderRadius: radius.md, padding: space(3), gap: space(1.5) },
  head: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  dot: { width: 8, height: 8, borderRadius: 4 },
  big: { flexDirection: 'row', alignItems: 'baseline', gap: space(1) },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', flexDirection: 'row' },
});
