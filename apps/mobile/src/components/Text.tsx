import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { fonts, fontSize, useTheme, type FontSize, type FontWeight, type Palette } from '@/theme';

export type TextColor = 'fg' | 'fg2' | 'muted' | 'subtle' | 'accent' | 'danger' | 'success' | 'warning' | 'onPrimary';

export interface TextProps extends RNTextProps {
  size?: FontSize;
  weight?: FontWeight;
  color?: TextColor;
  align?: TextStyle['textAlign'];
  /** Tabular (fixed-width) digits for times and amounts. */
  tabular?: boolean;
}

const colorOf = (c: Palette, color: TextColor) => (color === 'onPrimary' ? c.onPrimary : c[color]);

export const Text = ({ size = 'md', weight = 'regular', color = 'fg', align, tabular, style, ...rest }: TextProps) => {
  const { c } = useTheme();
  const px = fontSize[size];
  return (
    <RNText
      maxFontSizeMultiplier={1.6}
      {...rest}
      style={[
        {
          fontFamily: fonts[weight],
          fontSize: px,
          lineHeight: Math.round(px * (px >= 30 ? 1.25 : 1.5)),
          color: colorOf(c, color),
          textAlign: align,
          fontVariant: tabular ? ['tabular-nums'] : undefined,
        },
        style,
      ]}
    />
  );
};
