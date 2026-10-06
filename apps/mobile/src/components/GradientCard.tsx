import { useId, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { radius as radii } from '@/theme';

/**
 * A card with a soft diagonal gradient background (drawn with SVG so it works on phones, Expo Go and web).
 * `colors` go from top-left to bottom-right.
 */
export const GradientCard = ({
  colors,
  children,
  style,
  radius = radii.lg,
}: {
  colors: [string, string, ...string[]];
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
}) => {
  const id = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden' }, style]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            {colors.map((color, i) => (
              <Stop key={i} offset={i / (colors.length - 1)} stopColor={color} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      {children}
    </View>
  );
};
