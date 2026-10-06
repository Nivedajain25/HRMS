import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Check, ChevronDown } from 'lucide-react-native';
import { radius, space, TOUCH_TARGET, useTheme } from '@/theme';
import { BottomSheet } from './BottomSheet';
import { Field } from './Field';
import { Text } from './Text';

export interface SelectOption<V extends string> {
  value: V;
  label: string;
  description?: string;
}

export interface SelectProps<V extends string> {
  label?: string;
  value: V | null | undefined;
  options: SelectOption<V>[];
  onChange: (value: V) => void;
  placeholder?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  disabled?: boolean;
}

/** Form select that opens a bottom-sheet picker. */
export const Select = <V extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  required,
  error,
  hint,
  disabled,
}: SelectProps<V>) => {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <Field label={label} required={required} error={error} hint={hint}>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label ?? 'Select'}: ${selected?.label ?? 'not selected'}`}
        accessibilityHint="Opens a list of options"
        accessibilityState={{ disabled: !!disabled, expanded: open }}
        style={({ pressed }) => [
          styles.box,
          { borderColor: error ? c.danger : c.lineStrong, backgroundColor: disabled ? c.surface3 : pressed ? c.surface2 : c.surface },
        ]}
      >
        <Text numberOfLines={1} color={selected ? 'fg' : 'subtle'} style={styles.flex}>
          {selected?.label ?? placeholder}
        </Text>
        <ChevronDown size={18} color={c.muted} />
      </Pressable>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={label ?? placeholder}>
        <View accessibilityRole="radiogroup">
          {options.map((o) => {
            const active = o.value === value;
            return (
              <Pressable
                key={o.value}
                onPress={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                accessibilityLabel={o.description ? `${o.label}, ${o.description}` : o.label}
                style={({ pressed }) => [styles.option, { backgroundColor: active ? c.accentSoft : pressed ? c.surface2 : 'transparent' }]}
              >
                <View style={styles.flex}>
                  <Text weight={active ? 'semibold' : 'regular'} color={active ? 'accent' : 'fg'}>
                    {o.label}
                  </Text>
                  {o.description ? (
                    <Text size="sm" color="muted">
                      {o.description}
                    </Text>
                  ) : null}
                </View>
                {active ? <Check size={20} color={c.accent} /> : null}
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    </Field>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  box: {
    minHeight: TOUCH_TARGET + 4,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(3),
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
  },
  option: {
    minHeight: TOUCH_TARGET + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingHorizontal: space(3),
    borderRadius: radius.md,
  },
});
