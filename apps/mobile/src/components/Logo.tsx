import { StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { brand, space } from '@/theme';
import { Text } from './Text';

/** Stencil logomark: three offset strokes suggesting a cut stencil (same as the web). */
export const Logomark = ({ size = 40 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 32 32" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Rect width={32} height={32} rx={9} fill={brand[600]} />
    <Path d="M10 11h12M10 16h8M10 21h12" stroke="#ffffff" strokeWidth={2.6} strokeLinecap="round" />
  </Svg>
);

export const Logo = ({ size = 40 }: { size?: number }) => (
  <View style={styles.row} accessible accessibilityRole="image" accessibilityLabel="Stencil HRMS">
    <Logomark size={size} />
    <View>
      <Text weight="bold" size="md" style={styles.word}>
        STENCIL
      </Text>
      <Text weight="medium" size="xs" color="muted" style={styles.sub}>
        HRMS
      </Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  word: { letterSpacing: 2.2, lineHeight: 18 },
  sub: { letterSpacing: 2.4, lineHeight: 14 },
});
