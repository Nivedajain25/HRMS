import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, space, useTheme } from '@/theme';

export interface CardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Inner padding (default 16). Pass 0 for edge-to-edge content such as lists. */
  padding?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export const Card = ({ children, style, padding = space(4), onPress, accessibilityLabel, accessibilityHint }: CardProps) => {
  const { c } = useTheme();
  const base = [styles.card, { backgroundColor: c.surface, borderColor: c.line, padding }, c.scheme === 'light' && styles.shadow];
  if (!onPress) {
    return <View style={[base, style]}>{children}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [base, pressed && { backgroundColor: c.surface2 }, style]}
    >
      {children}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2 },
  shadow: {
    shadowColor: '#101828',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
});
