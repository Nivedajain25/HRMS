import { useState, type Ref } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { fonts, fontSize, radius, space, TOUCH_TARGET, useTheme } from '@/theme';
import type { IconComponent } from './Button';
import { Field } from './Field';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  leftIcon?: IconComponent;
  /** Password input with a show/hide toggle. */
  password?: boolean;
  ref?: Ref<TextInput>;
}

export const TextField = ({
  label,
  required,
  error,
  hint,
  leftIcon: LeftIcon,
  password,
  multiline,
  ref,
  editable = true,
  ...rest
}: TextFieldProps) => {
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const borderColor = error ? c.danger : focused ? c.ring : c.lineStrong;
  return (
    <Field label={label} required={required} error={error} hint={hint}>
      <View
        style={[
          styles.box,
          { borderColor, backgroundColor: editable ? c.surface : c.surface3 },
          focused && { borderWidth: 2, paddingHorizontal: space(3) - 1 },
          multiline && styles.multiline,
        ]}
      >
        {LeftIcon ? <LeftIcon size={18} color={c.subtle} /> : null}
        <TextInput
          ref={ref}
          {...rest}
          editable={editable}
          multiline={multiline}
          secureTextEntry={password && !visible}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          accessibilityHint={error ?? rest.accessibilityHint}
          accessibilityState={{ disabled: !editable }}
          placeholderTextColor={c.subtle}
          selectionColor={c.ring}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[styles.input, { color: c.fg }, multiline && styles.inputMultiline, Platform.OS === 'web' && styles.noWebOutline]}
          textAlignVertical={multiline ? 'top' : 'center'}
        />
        {password ? (
          <Pressable
            onPress={() => setVisible((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
            hitSlop={8}
            style={styles.toggle}
          >
            {visible ? <EyeOff size={20} color={c.muted} /> : <Eye size={20} color={c.muted} />}
          </Pressable>
        ) : null}
      </View>
    </Field>
  );
};

const styles = StyleSheet.create({
  box: {
    minHeight: TOUCH_TARGET + 4,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(3),
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
  },
  multiline: { alignItems: 'flex-start', paddingVertical: space(2) },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: fontSize.md, paddingVertical: space(2) },
  inputMultiline: { minHeight: 96 },
  // In a browser the inner text box gets its own focus outline (a dark box inside the field); the field's
  // border already turns to the focus colour, so hide it.
  noWebOutline: { outlineWidth: 0, outlineColor: 'transparent' },
  toggle: { width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', marginRight: -space(2) },
});
