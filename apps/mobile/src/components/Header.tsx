import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { radius, space, useTheme, type Tone } from '@/theme';
import { IconButton } from './Button';
import { Text } from './Text';

export interface HeaderProps {
  title: string;
  subtitle?: string;
  /** Show a back button (uses the router history; falls back to `backTo`). */
  back?: boolean;
  backTo?: Parameters<typeof router.replace>[0];
  right?: ReactNode;
  /** Large title for tab roots. */
  large?: boolean;
  /** Kept for existing callers; the new look uses the role's own colour instead of per-tab bands. */
  tone?: Tone;
}

/**
 * Screen header. Tab roots (`large`) get a big bold title on the page background; inner screens a compact bar with
 * a round back button — both in the role's colours (employee blue / navy, HR & admin purple).
 */
export const Header = ({ title, subtitle, back, backTo, right, large }: HeaderProps) => {
  const { c } = useTheme();
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else if (backTo) router.replace(backTo);
  };
  return (
    <View
      style={[
        styles.row,
        large ? [styles.large, { backgroundColor: c.canvas }] : { backgroundColor: c.surface, borderBottomColor: c.line, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      {back ? (
        <View style={[styles.back, { backgroundColor: c.accentSoft }]}>
          <IconButton icon={ChevronLeft} onPress={goBack} accessibilityLabel="Go back" color={c.accent} size={40} />
        </View>
      ) : null}
      <View style={[styles.titles, !back && { paddingLeft: space(4) }]}>
        <Text size={large ? '2xl' : 'lg'} weight="bold" numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text size="sm" color="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space(2), gap: space(1) },
  large: { paddingTop: space(3), paddingBottom: space(1) },
  back: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginLeft: space(1) },
  titles: { flex: 1, paddingRight: space(2), paddingLeft: space(1) },
  right: { flexDirection: 'row', alignItems: 'center', paddingRight: space(2), gap: space(1) },
});
