import type { ComponentType, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, space, TOUCH_TARGET, useTheme, type Palette } from '@/theme';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'success';

export interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}
export type IconComponent = ComponentType<IconProps>;

export interface ButtonProps {
  children: ReactNode;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  icon?: IconComponent;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const variantColors = (c: Palette, variant: ButtonVariant, pressed: boolean) => {
  switch (variant) {
    case 'primary':
      return { bg: pressed ? c.primaryPressed : c.primary, fg: c.onPrimary, border: 'transparent' };
    case 'danger':
      return { bg: pressed ? c.dangerPressed : c.danger, fg: '#ffffff', border: 'transparent' };
    case 'success':
      return { bg: pressed ? '#047857' : '#059669', fg: '#ffffff', border: 'transparent' };
    case 'outline':
      return { bg: pressed ? c.surface3 : c.surface, fg: c.fg, border: c.lineStrong };
    case 'ghost':
      return { bg: pressed ? c.surface3 : 'transparent', fg: c.accent, border: 'transparent' };
  }
};

export const Button = ({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading = false,
  disabled = false,
  fullWidth,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) => {
  const { c } = useTheme();
  const inactive = disabled || loading;
  const height = size === 'lg' ? 56 : TOUCH_TARGET + 4;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (typeof children === 'string' ? children : undefined)}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => {
        const v = variantColors(c, variant, pressed);
        return [
          styles.base,
          { minHeight: height, backgroundColor: v.bg, borderColor: v.border, opacity: disabled && !loading ? 0.5 : 1 },
          fullWidth && styles.full,
          style,
        ];
      }}
    >
      {({ pressed }) => {
        const v = variantColors(c, variant, pressed);
        return (
          <View style={styles.content}>
            {loading ? (
              <ActivityIndicator size="small" color={v.fg} />
            ) : Icon ? (
              <Icon size={size === 'lg' ? 22 : 18} color={v.fg} strokeWidth={2.2} />
            ) : null}
            <Text weight="semibold" size={size === 'lg' ? 'lg' : 'md'} style={{ color: v.fg }} numberOfLines={1}>
              {children}
            </Text>
          </View>
        );
      }}
    </Pressable>
  );
};

/** Square icon-only button (≥ 44 pt). */
export const IconButton = ({
  icon: Icon,
  onPress,
  accessibilityLabel,
  color,
  size = TOUCH_TARGET,
  disabled,
}: {
  icon: IconComponent;
  onPress: () => void;
  accessibilityLabel: string;
  color?: string;
  size?: number;
  disabled?: boolean;
}) => {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={4}
      style={({ pressed }) => [
        styles.icon,
        { width: size, height: size, backgroundColor: pressed ? c.surface3 : 'transparent', opacity: disabled ? 0.4 : 1 },
      ]}
    >
      <Icon size={22} color={color ?? c.fg2} />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space(4),
    alignItems: 'center',
    justifyContent: 'center',
  },
  full: { alignSelf: 'stretch' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space(2) },
  icon: { borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});
