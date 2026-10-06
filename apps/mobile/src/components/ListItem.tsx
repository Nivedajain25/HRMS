import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { space, TOUCH_TARGET, useTheme } from '@/theme';
import { Text } from './Text';

export interface ListItemProps {
  title: string;
  subtitle?: string;
  /** Extra line under the subtitle. */
  meta?: string;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  /** Show a chevron (defaults to true when pressable). */
  chevron?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Draw a separator above the row. */
  divider?: boolean;
}

export const ListItem = ({
  title,
  subtitle,
  meta,
  left,
  right,
  onPress,
  chevron,
  accessibilityLabel,
  accessibilityHint,
  divider,
}: ListItemProps) => {
  const { c } = useTheme();
  const content = (
    <>
      {left ? <View style={styles.left}>{left}</View> : null}
      <View style={styles.body}>
        <Text weight="medium" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text size="sm" color="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? (
          <Text size="xs" color="subtle" numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
      {(chevron ?? !!onPress) ? <ChevronRight size={18} color={c.subtle} /> : null}
    </>
  );
  const rowStyle = [styles.row, divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }];
  if (!onPress) {
    return (
      <View style={rowStyle} accessible accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [rowStyle, pressed && { backgroundColor: c.surface2 }]}
    >
      {content}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    minHeight: TOUCH_TARGET + 12,
    paddingVertical: space(3),
    paddingHorizontal: space(4),
  },
  left: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  right: { alignItems: 'flex-end', gap: space(1), maxWidth: '45%' },
});
