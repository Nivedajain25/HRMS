import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { space } from '@/theme';
import { Text } from './Text';

/** Label + control + hint/error, shared by all form controls. */
export const Field = ({
  label,
  required,
  error,
  hint,
  children,
}: {
  label?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}) => (
  <View style={styles.field}>
    {label ? (
      <Text size="sm" weight="medium" color="fg2">
        {label}
        {required ? <Text color="danger"> *</Text> : null}
      </Text>
    ) : null}
    {children}
    {error ? (
      <Text size="sm" color="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
        {error}
      </Text>
    ) : hint ? (
      <Text size="xs" color="muted">
        {hint}
      </Text>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  field: { gap: space(1.5) },
});
