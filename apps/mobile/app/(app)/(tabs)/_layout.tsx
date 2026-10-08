import { useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs } from 'expo-router/js-tabs';
import { Clock, Home, Menu, Plane, Plus, type LucideIcon } from 'lucide-react-native';
import { Text } from '@/components';
import { QuickActionsSheet } from '@/features/quick-actions/quick-actions';
import { radius, space, useTheme } from '@/theme';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/** The four tabs in the bar; the + in the middle opens Quick actions. Profile and Approvals open from Home / More. */
const TABS: { name: string; label: string; icon: LucideIcon }[] = [
  { name: 'index', label: 'Home', icon: Home },
  { name: 'attendance', label: 'Attendance', icon: Clock },
  { name: 'leave', label: 'Leave', icon: Plane },
  { name: 'more', label: 'More', icon: Menu },
];

/**
 * Bottom bar like the reference design: a rounded white bar, the current tab in a soft pill of the role's colour,
 * and a raised round + button in the middle for quick actions. It sits above the phone's own navigation buttons.
 */
const TabBar = ({ state, navigation }: TabBarProps) => {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [quick, setQuick] = useState(false);
  const current = state.routes[state.index]?.name;

  const item = ({ name, label, icon: Icon }: (typeof TABS)[number]) => {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return null;
    const focused = current === name;
    return (
      <Pressable
        key={name}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={label}
        style={styles.item}
      >
        <View style={[styles.pill, focused && { backgroundColor: c.accentSoft }]}>
          <Icon size={22} color={focused ? c.accent : c.muted} strokeWidth={focused ? 2.4 : 2} />
        </View>
        <Text size="xs" weight={focused ? 'bold' : 'medium'} style={{ color: focused ? c.accent : c.muted }} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <>
      <View style={[styles.bar, { backgroundColor: c.surface, borderColor: c.line, paddingBottom: Math.max(insets.bottom, space(2)) }]}>
        {item(TABS[0]!)}
        {item(TABS[1]!)}
        <View style={styles.item}>
          <Pressable
            onPress={() => setQuick(true)}
            accessibilityRole="button"
            accessibilityLabel="Quick actions"
            style={({ pressed }) => [styles.plus, { backgroundColor: pressed ? c.primaryPressed : c.primary, shadowColor: c.primary }]}
          >
            <Plus size={28} color={c.onPrimary} strokeWidth={2.6} />
          </Pressable>
        </View>
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
  item: { flex: 1, alignItems: 'center', gap: 2 },
  pill: { width: 52, height: 30, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  plus: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginTop: -26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
});
