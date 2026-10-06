import { Pressable, StyleSheet, View } from 'react-native';
import { radius, space, toneColors, TOUCH_TARGET, useTheme, type Tone } from '@/theme';
import type { IconComponent } from './Button';
import { Text } from './Text';

export const SectionHeader = ({
  title,
  icon: Icon,
  actionLabel,
  onAction,
  count,
  tone,
}: {
  title: string;
  icon?: IconComponent;
  actionLabel?: string;
  onAction?: () => void;
  count?: number;
  /** Colours the icon in a soft bubble (each home section gets its own colour). */
  tone?: Tone;
}) => {
  const { c } = useTheme();
  const t = tone ? toneColors(tone, c) : null;
  return (
    <View style={styles.row}>
      <View style={styles.title}>
        {Icon && t ? (
          <View style={[styles.bubble, { backgroundColor: t.bg }]}>
            <Icon size={16} color={t.solid} />
          </View>
        ) : Icon ? (
          <Icon size={18} color={c.muted} />
        ) : null}
        <Text size="lg" weight="semibold" accessibilityRole="header">
          {title}
        </Text>
        {count !== undefined ? (
          <Text size="sm" color="muted">
            ({count})
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="link"
          accessibilityLabel={`${actionLabel}: ${title}`}
          hitSlop={8}
          style={styles.action}
        >
          <Text size="sm" weight="semibold" color="accent">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  title: { flexDirection: 'row', alignItems: 'center', gap: space(2), flexShrink: 1 },
  bubble: { width: 30, height: 30, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  action: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingLeft: space(3) },
});
