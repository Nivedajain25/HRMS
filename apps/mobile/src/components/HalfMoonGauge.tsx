import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedProps, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { space } from '@/theme';
import { Text } from './Text';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export interface HalfMoonSegment {
  /** Share of the arc, 0–100. */
  value: number;
  color: string;
}

/** One coloured part of the arc, from `start` to `start + size` (percent), revealed left to right with `sweep`. */
const Segment = ({ d, length, start, size, color, stroke, round, sweep }: { d: string; length: number; start: number; size: number; color: string; stroke: number; round: boolean; sweep: SharedValue<number> }) => {
  const animatedProps = useAnimatedProps(() => {
    const shown = Math.max(0, Math.min(size, sweep.value - start));
    return { strokeDasharray: `0 ${(start / 100) * length} ${(shown / 100) * length} ${length * 2}` };
  });
  return <AnimatedPath d={d} stroke={color} strokeWidth={stroke} strokeLinecap={round ? 'round' : 'butt'} fill="none" animatedProps={animatedProps} />;
};

/**
 * Half-moon (semicircle) gauge sweeping left to right. Either one `value` (0–100) or several coloured `segments`
 * laid end to end (e.g. on time / late / on leave / absent). `children` sit in the middle under the arc and the
 * optional `startLabel` / `endLabel` under its two ends. White on a translucent track by default, for gradient cards.
 */
export const HalfMoonGauge = ({
  value = 0,
  segments,
  width = 220,
  stroke = 14,
  color = '#ffffff',
  track = 'rgba(255,255,255,0.22)',
  startLabel,
  endLabel,
  children,
  accessibilityLabel,
}: {
  value?: number;
  segments?: HalfMoonSegment[];
  width?: number;
  stroke?: number;
  color?: string;
  track?: string;
  startLabel?: string;
  endLabel?: string;
  children?: ReactNode;
  accessibilityLabel?: string;
}) => {
  const r = (width - stroke) / 2;
  const cy = r + stroke / 2;
  const height = cy + stroke / 2;
  const length = Math.PI * r;
  const arc = `M ${stroke / 2} ${cy} A ${r} ${r} 0 0 1 ${width - stroke / 2} ${cy}`;
  const parts = (segments ?? [{ value, color }]).map((s) => ({ ...s, value: Math.max(0, s.value) }));
  let at = 0;
  const placed = parts.map((s) => {
    const size = Math.min(s.value, 100 - at);
    const p = { ...s, start: at, size };
    at += size;
    return p;
  });
  const total = Math.round(at);
  // Sweeps in once when it first appears; later changes (a live countdown, someone checking in) update in place.
  const sweep = useSharedValue(0);
  useEffect(() => {
    sweep.value = withTiming(100, { duration: 900, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System });
  }, [sweep]);
  const soft = { color: 'rgba(255,255,255,0.75)' };

  return (
    <View style={styles.wrap} accessible accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel} accessibilityValue={{ min: 0, max: 100, now: total }}>
      <View style={{ width, height }}>
        <Svg width={width} height={height}>
          <Path d={arc} stroke={track} strokeWidth={stroke} strokeLinecap="round" fill="none" />
          {placed.map((s, i) =>
            s.size > 0 ? (
              <Segment key={i} d={arc} length={length} start={s.start} size={s.size} color={s.color} stroke={stroke} round={!segments} sweep={sweep} />
            ) : null,
          )}
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.center, { paddingTop: stroke + space(4) }]}>{children}</View>
      </View>
      {startLabel || endLabel ? (
        <View style={[styles.ends, { width }]}>
          <Text size="xs" weight="medium" tabular style={soft}>
            {startLabel ?? ''}
          </Text>
          <Text size="xs" weight="medium" tabular style={soft}>
            {endLabel ?? ''}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space(1) },
  center: { alignItems: 'center', justifyContent: 'flex-end' },
  ends: { flexDirection: 'row', justifyContent: 'space-between' },
});
