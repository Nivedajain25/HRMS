import { useEffect, type ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';

/*
 * Small, reusable motion primitives (Reanimated). All of them follow the device "Reduce motion" setting.
 */

/** Fades + slides a block up into place; `index` staggers siblings (70 ms apart). */
export const Appear = ({ index = 0, children, style }: { index?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) => (
  <Animated.View
    entering={FadeInDown.delay(Math.min(index, 12) * 70)
      .duration(420)
      .easing(Easing.out(Easing.cubic))
      .reduceMotion(ReduceMotion.System)}
    style={style}
  >
    {children}
  </Animated.View>
);

/** Pops a value in (e.g. a clock-in time appearing). Re-runs when `id` changes. */
export const PopIn = ({ id, children }: { id?: string | number | null; children: ReactNode }) => (
  <Animated.View key={id ?? undefined} entering={ZoomIn.springify().damping(12).reduceMotion(ReduceMotion.System)}>
    {children}
  </Animated.View>
);

/**
 * Pressable that gently shrinks while pressed (tactile feedback). `style` styles the animated content;
 * `pressableStyle` the outer touch target (e.g. `{ flex: 1 }` inside a row).
 */
export const PressScale = ({
  style,
  pressableStyle,
  children,
  scaleTo = 0.96,
  ...props
}: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; pressableStyle?: StyleProp<ViewStyle>; children: ReactNode; scaleTo?: number }) => {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      {...props}
      style={pressableStyle}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, { damping: 15, stiffness: 300, reduceMotion: ReduceMotion.System });
        props.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, { damping: 12, stiffness: 250, reduceMotion: ReduceMotion.System });
        props.onPressOut?.(e);
      }}
    >
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </Pressable>
  );
};

/** A friendly one-off wave (for the greeting emoji). */
export const Wave = ({ children }: { children: ReactNode }) => {
  const r = useSharedValue(0);
  useEffect(() => {
    const t = (deg: number) => withTiming(deg, { duration: 140, reduceMotion: ReduceMotion.System });
    r.value = withDelay(400, withSequence(t(-14), t(12), t(-8), t(6), t(0)));
  }, [r]);
  const animated = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return <Animated.View style={animated}>{children}</Animated.View>;
};

/** Gently fades its content in and out forever (draws the eye to e.g. "Running late"). */
export const Blink = ({ children }: { children: ReactNode }) => {
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = withRepeat(withTiming(0.35, { duration: 900, easing: Easing.inOut(Easing.quad), reduceMotion: ReduceMotion.System }), -1, true);
  }, [o]);
  const animated = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={animated}>{children}</Animated.View>;
};

/** A soft, endless pulse ring behind a round button (e.g. the emergency siren). */
export const PulseRing = ({ size, color }: { size: number; color: string }) => {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.System }), -1, false);
  }, [p]);
  const animated = useAnimatedStyle(() => ({ opacity: 0.45 * (1 - p.value), transform: [{ scale: 1 + p.value * 0.55 }] }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, animated]}
    />
  );
};
