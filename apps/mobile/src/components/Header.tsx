import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { space, useTheme, type Tone } from '@/theme';
import { IconButton } from './Button';
import { GradientCard } from './GradientCard';
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
  /** Large headers: a soft gradient band in this colour (matches the tab's colour). */
  tone?: Tone;
}

/** Soft gradient bands for large (tab) headers, light and dark. */
const BANDS: Partial<Record<Tone, { light: [string, string]; dark: [string, string] }>> = {
  green: { light: ['#d1fae5', '#e0f2fe'], dark: ['#0f2f24', '#0f2233'] },
  teal: { light: ['#ccfbf1', '#e0e7ff'], dark: ['#0f2d2b', '#1a1f3d'] },
  amber: { light: ['#fef3c7', '#ffe4e6'], dark: ['#33270c', '#33151c'] },
  purple: { light: ['#ede9fe', '#fce7f3'], dark: ['#231a3d', '#331a2c'] },
  brand: { light: ['#e0e7ff', '#f3e8ff'], dark: ['#1a1f3d', '#231a3d'] },
  blue: { light: ['#dbeafe', '#e0e7ff'], dark: ['#10233a', '#1a1f3d'] },
};

export const Header = ({ title, subtitle, back, backTo, right, large, tone }: HeaderProps) => {
  const { c, scheme } = useTheme();
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else if (backTo) router.replace(backTo);
  };
  const band = large && tone ? BANDS[tone] : undefined;
  const content = (
    <>
      {back ? <IconButton icon={ChevronLeft} onPress={goBack} accessibilityLabel="Go back" color={c.fg} /> : null}
      <View style={[styles.titles, !back && { paddingLeft: space(4) }]}>
        <Text size="lg" weight="semibold" numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text size="sm" color="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </>
  );
  if (band) {
    return (
      <GradientCard colors={scheme === 'dark' ? band.dark : band.light} radius={0} style={[styles.row, styles.large, { borderBottomColor: 'transparent' }]}>
        {content}
      </GradientCard>
    );
  }
  return (
    <View
      style={[
        styles.row,
        { borderBottomColor: large ? 'transparent' : c.line, backgroundColor: large ? c.canvas : c.surface },
        large && styles.large,
      ]}
    >
      {content}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space(1),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  large: { paddingTop: space(2), paddingBottom: space(1) },
  titles: { flex: 1, paddingRight: space(2) },
  right: { flexDirection: 'row', alignItems: 'center', paddingRight: space(2), gap: space(1) },
});
