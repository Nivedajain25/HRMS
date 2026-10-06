import { Pressable, StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { radius, space, TOUCH_TARGET, useTheme } from '@/theme';
import { Text } from './Text';

export const Checkbox = ({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) => {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled: !!disabled }}
      style={styles.row}
      hitSlop={4}
    >
      <View style={[styles.box, { borderColor: checked ? c.primary : c.lineStrong, backgroundColor: checked ? c.primary : c.surface }]}>
        {checked ? <Check size={14} color={c.onPrimary} strokeWidth={3} /> : null}
      </View>
      <Text size="sm" color="fg2">
        {label}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2), minHeight: TOUCH_TARGET },
  box: { width: 22, height: 22, borderRadius: radius.sm - 3, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
