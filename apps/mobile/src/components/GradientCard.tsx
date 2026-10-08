import { useId, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { radius as radii } from '@/theme';

/**
 * A card with a diagonal gradient background (drawn with SVG so it works on phones, Expo Go and web).
 * `colors` go from top-left to bottom-right. The gradient is drawn at the card's measured size — percentage sizes
 * left a white strip on the right and bottom on Android once the card grew after its first layout.
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
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!size || Math.abs(size.w - width) > 0.5 || Math.abs(size.h - height) > 0.5) setSize({ w: width, h: height });
  };
  return (
    // Until measured, the first colour fills the card so it never flashes white.
    <View onLayout={onLayout} style={[{ borderRadius: radius, overflow: 'hidden', backgroundColor: colors[0] }, style]}>
      {size ? (
        <Svg style={StyleSheet.absoluteFill} width={size.w} height={size.h} pointerEvents="none">
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              {colors.map((color, i) => (
                <Stop key={i} offset={i / (colors.length - 1)} stopColor={color} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={size.w} height={size.h} fill={`url(#${id})`} />
        </Svg>
      ) : null}
      {children}
    </View>
  );
};
