import { Image, StyleSheet, View } from 'react-native';
import { space, useTheme } from '@/theme';
// The Stencil brand (same files as the web): the "Stencil® Interior & Exterior Products" logo and the "S" mark.
import LOGO from '../../assets/images/brand/stencil-logo.png';
import LOGO_DARK from '../../assets/images/brand/stencil-logo-dark.png';
import MARK from '../../assets/images/brand/stencil-mark.png';
import { Text } from './Text';
/** Width ÷ height of the logo images. */
const LOGO_RATIO = 837 / 285;

/** Stencil "S" mark (rounded navy square), e.g. on the loading screen. */
export const Logomark = ({ size = 40 }: { size?: number }) => (
  <Image source={MARK} style={{ width: size, height: size, borderRadius: size * 0.22 }} accessibilityIgnoresInvertColors accessible={false} />
);

/** The Stencil logo with "HRMS" beside it; `size` is the logo's height. Light text version in dark mode. */
export const Logo = ({ size = 40 }: { size?: number }) => {
  const { scheme } = useTheme();
  return (
    <View style={styles.row} accessible accessibilityRole="image" accessibilityLabel="Stencil HRMS">
      <Image source={scheme === 'dark' ? LOGO_DARK : LOGO} style={{ height: size, width: size * LOGO_RATIO }} resizeMode="contain" accessibilityIgnoresInvertColors />
      <View style={styles.divider} />
      <Text weight="semibold" size="sm" color="muted" style={styles.sub}>
        HRMS
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  divider: { width: StyleSheet.hairlineWidth * 2, height: 22, backgroundColor: '#94a3b8', opacity: 0.6 },
  sub: { letterSpacing: 2.4 },
});
