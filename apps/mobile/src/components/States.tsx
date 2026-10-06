import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { AlertTriangle, Inbox, WifiOff } from 'lucide-react-native';
import { ApiError } from '@/lib/api';
import { radius, space, useTheme } from '@/theme';
import { Button, type IconComponent } from './Button';
import { Text } from './Text';

/* ------------------------------ EmptyState ------------------------------ */

export const EmptyState = ({
  icon: Icon = Inbox,
  title,
  message,
  action,
  compact,
}: {
  icon?: IconComponent;
  title: string;
  message?: string;
  action?: ReactNode;
  compact?: boolean;
}) => {
  const { c } = useTheme();
  return (
    <View style={[styles.state, compact && styles.compact]} accessible accessibilityLabel={[title, message].filter(Boolean).join('. ')}>
      <View style={[styles.iconWrap, { backgroundColor: c.surface3 }, compact && styles.iconSmall]}>
        <Icon size={compact ? 20 : 26} color={c.muted} />
      </View>
      <Text weight="semibold" align="center" size={compact ? 'sm' : 'md'}>
        {title}
      </Text>
      {message ? (
        <Text size="sm" color="muted" align="center">
          {message}
        </Text>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
};

/* ------------------------------ ErrorState ------------------------------ */

export const ErrorState = ({
  title = 'Could not load this',
  error,
  onRetry,
  compact,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  compact?: boolean;
}) => {
  const { c } = useTheme();
  const offline = error instanceof ApiError && (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT');
  const message = error instanceof Error ? error.message : undefined;
  const Icon = offline ? WifiOff : AlertTriangle;
  return (
    <View style={[styles.state, compact && styles.compact]} accessibilityLiveRegion="polite">
      <View
        style={[
          styles.iconWrap,
          { backgroundColor: c.scheme === 'dark' ? 'rgba(239,68,68,0.15)' : '#fef2f2' },
          compact && styles.iconSmall,
        ]}
      >
        <Icon size={compact ? 20 : 26} color={c.danger} />
      </View>
      <Text weight="semibold" align="center" size={compact ? 'sm' : 'md'}>
        {title}
      </Text>
      {message ? (
        <Text size="sm" color="muted" align="center">
          {message}
        </Text>
      ) : null}
      {onRetry ? (
        <View style={styles.action}>
          <Button variant="outline" onPress={onRetry} accessibilityLabel={`Try again: ${title}`}>
            Try again
          </Button>
        </View>
      ) : null}
    </View>
  );
};

/* ------------------------------- Skeleton ------------------------------- */

export const Skeleton = ({
  width = '100%',
  height = 16,
  style,
  rounded,
}: {
  width?: DimensionValue;
  height?: number;
  style?: StyleProp<ViewStyle>;
  rounded?: boolean;
}) => {
  const { c } = useTheme();
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: rounded ? height / 2 : radius.sm, backgroundColor: c.surface3, opacity }, style]}
    />
  );
};

/** A few skeleton rows (list placeholders). */
export const SkeletonList = ({ rows = 3 }: { rows?: number }) => (
  <View style={styles.list} accessibilityLabel="Loading" accessible>
    {Array.from({ length: rows }, (_, i) => (
      <View key={i} style={styles.listRow}>
        <Skeleton width={40} height={40} rounded />
        <View style={styles.listText}>
          <Skeleton width="60%" height={14} />
          <Skeleton width="40%" height={12} />
        </View>
      </View>
    ))}
  </View>
);

/* ------------------------------- Notice -------------------------------- */

export type NoticeTone = 'info' | 'warning' | 'danger' | 'success';

/** Inline banner for contextual messages (e.g. "running late", "recorded without location"). */
export const Notice = ({
  tone = 'info',
  icon: Icon,
  children,
  action,
}: {
  tone?: NoticeTone;
  icon?: IconComponent;
  children: ReactNode;
  action?: ReactNode;
}) => {
  const { c } = useTheme();
  const dark = c.scheme === 'dark';
  const palette = {
    info: dark ? { bg: 'rgba(14,165,233,0.12)', fg: '#7dd3fc' } : { bg: '#f0f9ff', fg: '#0369a1' },
    warning: dark ? { bg: 'rgba(245,158,11,0.15)', fg: '#fcd34d' } : { bg: '#fffbeb', fg: '#92400e' },
    danger: dark ? { bg: 'rgba(239,68,68,0.15)', fg: '#fca5a5' } : { bg: '#fef2f2', fg: '#b91c1c' },
    success: dark ? { bg: 'rgba(16,185,129,0.12)', fg: '#6ee7b7' } : { bg: '#ecfdf5', fg: '#047857' },
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: palette.bg }]} accessibilityRole="text" accessibilityLiveRegion="polite">
      <View style={styles.noticeRow}>
        {Icon ? <Icon size={18} color={palette.fg} /> : null}
        <View style={styles.flex}>
          {typeof children === 'string' ? (
            <Text size="sm" style={{ color: palette.fg }}>
              {children}
            </Text>
          ) : (
            children
          )}
        </View>
      </View>
      {action ? <View style={styles.noticeAction}>{action}</View> : null}
    </View>
  );
};

/* ------------------------------ ProgressBar ----------------------------- */

export const ProgressBar = ({ value, color, accessibilityLabel }: { value: number; color?: string; accessibilityLabel?: string }) => {
  const { c } = useTheme();
  const pct = Math.max(0, Math.min(100, value));
  // Fills up from its previous value (0 on first show) instead of jumping.
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: pct, duration: 700, delay: 120, useNativeDriver: false }).start();
  }, [anim, pct]);
  const width = anim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });
  return (
    <View
      style={[styles.track, { backgroundColor: c.surface3 }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
    >
      <Animated.View style={[styles.fill, { width, backgroundColor: color ?? c.primary }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  state: { alignItems: 'center', justifyContent: 'center', paddingVertical: space(8), paddingHorizontal: space(6), gap: space(2) },
  compact: { paddingVertical: space(4), paddingHorizontal: space(3) },
  iconWrap: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: space(1) },
  iconSmall: { width: 40, height: 40, borderRadius: 20 },
  action: { marginTop: space(3) },
  list: { gap: space(4), paddingVertical: space(2) },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  listText: { flex: 1, gap: space(2) },
  notice: { borderRadius: radius.md, padding: space(3), gap: space(2) },
  noticeRow: { flexDirection: 'row', gap: space(2), alignItems: 'flex-start' },
  noticeAction: { flexDirection: 'row', justifyContent: 'flex-end' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
});
