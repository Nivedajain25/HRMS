import { useEffect, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs } from 'expo-router/js-tabs';
import { Clock, Home, Menu, Plane, Plus, type LucideIcon } from 'lucide-react-native';
import { Text } from '@/components';
import { QuickActionsSheet } from '@/features/quick-actions/quick-actions';
import { radius, space, useTheme } from '@/theme';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/** The four tabs in the bar; Actions in the middle opens Quick actions. Profile and Approvals open from Home / More. */
const TABS: { name: string; label: string; icon: LucideIcon }[] = [
  { name: 'index', label: 'Home', icon: Home },
  { name: 'attendance', label: 'Attendance', icon: Clock },
  { name: 'leave', label: 'Leave', icon: Plane },
  { name: 'more', label: 'More', icon: Menu },
];

/** Tabs with their own pages (a stack under the tab, e.g. More → Payslips). */
const STACK_TABS = new Set(['attendance', 'leave', 'more']);

/**
 * One tab. Every icon sits on the same soft rounded tile (like Actions); the page you're on fills its tile with the
 * role's colour — it stays in the bar (no pop-out), with a quick fade rather than a bounce.
 */
const TabItem = ({ label, icon: Icon, focused, onPress }: { label: string; icon: LucideIcon; focused: boolean; onPress: () => void }) => {
  const { c } = useTheme();
  const up = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    up.value = withTiming(focused ? 1 : 0, { duration: 180, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.System });
  }, [focused, up]);
  const fill = useAnimatedStyle(() => ({ opacity: up.value }));
  const tile = useAnimatedStyle(() => ({ opacity: 1 - up.value }));
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={label} style={styles.item}>
      <View style={styles.bubble}>
        <Animated.View style={[styles.tile, { backgroundColor: c.surface, borderColor: c.line }, tile]} />
        <Animated.View style={[styles.bubbleFill, { backgroundColor: c.primary, shadowColor: c.primary }, fill]} />
        {/* Above the tiles' shadows (on Android a raised view draws over its flat siblings). */}
        <View style={styles.iconLayer}>
          <Icon size={20} color={focused ? c.onPrimary : c.muted} strokeWidth={focused ? 2.4 : 2} />
        </View>
      </View>
      <Text size="xs" weight={focused ? 'bold' : 'medium'} style={{ color: focused ? c.accent : c.muted }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
};

/**
 * Bottom bar like the reference design: a rounded white bar where the current page pops up in a bubble, and
 * Actions in the middle for quick actions. It sits above the phone's own navigation buttons.
 */
const TabBar = ({ state, navigation }: TabBarProps) => {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [quick, setQuick] = useState(false);
  const current = state.routes[state.index]?.name;

  const item = ({ name, label, icon }: (typeof TABS)[number]) => {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return null;
    const focused = current === name;
    return (
      <TabItem
        key={name}
        label={label}
        icon={icon}
        focused={focused}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (event.defaultPrevented) return;
          // A tab always opens on its main page, not a sub-page left open earlier (e.g. Payslips under More, opened
          // from Home's quick actions) — otherwise More, and a browser reload, kept landing on that sub-page.
          if (STACK_TABS.has(route.name)) navigation.navigate(route.name, { screen: 'index', pop: true });
          else if (!focused) navigation.navigate(route.name, route.params);
        }}
      />
    );
  };

  return (
    <>
      <View style={[styles.bar, { backgroundColor: c.surface, borderColor: c.line, paddingBottom: Math.max(insets.bottom, space(2)) }]}>
        {item(TABS[0]!)}
        {item(TABS[1]!)}
        <Pressable onPress={() => setQuick(true)} accessibilityRole="button" accessibilityLabel="Quick actions" style={styles.item}>
          {({ pressed }) => (
            <>
              <View style={[styles.actions, { backgroundColor: c.accentSoft, shadowColor: c.accent, opacity: pressed ? 0.7 : 1 }]}>
                <Plus size={20} color={c.accent} strokeWidth={2.6} />
              </View>
              <Text size="xs" weight="medium" style={{ color: c.muted }} numberOfLines={1}>
                Actions
              </Text>
            </>
          )}
        </Pressable>
        {item(TABS[2]!)}
        {item(TABS[3]!)}
      </View>
      <QuickActionsSheet open={quick} onClose={() => setQuick(false)} />
    </>
  );
};

export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.canvas } }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Tabs.Screen name="leave" options={{ title: 'Leave' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
      {/* Not in the bar: My profile (avatar on Home, More → My profile) and Approvals (Home highlight, + sheet, More). */}
      <Tabs.Screen name="profile" options={{ title: 'Profile', href: null }} />
      <Tabs.Screen name="approvals" options={{ title: 'Approvals', href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: space(2),
    paddingHorizontal: space(2),
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    shadowColor: '#1e1b4b',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  item: { flex: 1, alignItems: 'center', gap: 4 },
  // Same footprint as the Actions tile: 44 × 34, in the 30 pt icon row.
  bubble: { width: 44, height: 34, marginVertical: -2, alignItems: 'center', justifyContent: 'center' },
  // The current page: the tile filled with the role's colour (stays in the bar).
  bubbleFill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 12,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  iconLayer: { zIndex: 1, elevation: 5 },
  // Soft tile under each flat tab icon: a light, professional shadow (not a dark fill).
  tile: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  actions: {
    width: 44,
    height: 34,
    marginVertical: -2,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
});
