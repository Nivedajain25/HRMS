import { Pressable, StyleSheet, View } from 'react-native';
import { radius, space, TOUCH_TARGET, useTheme } from '@/theme';
import type { IconComponent } from './Button';
import { Text } from './Text';

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  icon?: IconComponent;
}

/** Single-choice segmented control (radio group): pills, the chosen one filled in the role's colour. */
export const Segmented = <V extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
  disabled,
}: {
  value: V;
  options: SegmentOption<V>[];
  onChange: (value: V) => void;
  accessibilityLabel: string;
  disabled?: boolean;
}) => {
  const { c } = useTheme();
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map(({ value: v, label, icon: Icon }) => {
        const selected = v === value;
        return (
          <Pressable
            key={v}
            onPress={() => onChange(v)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ checked: selected, disabled: !!disabled }}
            style={({ pressed }) => [
              styles.option,
              {
                borderColor: selected ? c.primary : c.line,
                backgroundColor: selected ? (pressed ? c.primaryPressed : c.primary) : pressed ? c.surface2 : c.surface,
              },
            ]}
          >
            {Icon ? <Icon size={18} color={selected ? c.onPrimary : c.fg2} /> : null}
            <Text weight={selected ? 'semibold' : 'medium'} style={{ color: selected ? c.onPrimary : c.fg2 }}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space(2) },
  option: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
    paddingHorizontal: space(2),
  },
});
