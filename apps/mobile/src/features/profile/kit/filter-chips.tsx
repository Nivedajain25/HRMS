import { Pressable, StyleSheet, View } from 'react-native';
import { radius, space, useTheme } from '@/theme';
import { Text } from '@/components';

export interface ChipOption<V extends string> {
  value: V;
  label: string;
  /** Optional count shown after the label. */
  count?: number;
}

/** Single-choice filter chips that wrap onto several lines (never scroll sideways). */
export const FilterChips = <V extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
}: {
  value: V;
  options: ChipOption<V>[];
  onChange: (value: V) => void;
  accessibilityLabel: string;
}) => {
  const { c } = useTheme();
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map((o) => {
        const selected = o.value === value;
        const text = o.count !== undefined ? `${o.label} · ${o.count}` : o.label;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityLabel={text}
            accessibilityState={{ checked: selected }}
            hitSlop={{ top: 4, bottom: 4 }}
            style={({ pressed }) => [
              styles.chip,
              {
                borderColor: selected ? c.primary : c.lineStrong,
                backgroundColor: selected ? c.accentSoft : pressed ? c.surface2 : c.surface,
              },
            ]}
          >
            <Text size="sm" weight={selected ? 'semibold' : 'medium'} style={{ color: selected ? c.accent : c.fg2 }} numberOfLines={1}>
              {text}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  chip: {
    minHeight: 36,
    paddingHorizontal: space(3),
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '100%',
  },
});
