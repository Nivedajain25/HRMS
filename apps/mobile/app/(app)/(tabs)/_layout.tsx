import { View } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { CalendarDays, ClipboardCheck, Clock, Home, Menu, UserRound, type LucideIcon } from 'lucide-react-native';
import { EMPLOYEE_NAVY } from '@/features/dashboard/employee-look';
import { dashboardKind, useAuth } from '@/lib/auth';
import { fonts, radius, toneColors, useTheme, type Tone } from '@/theme';

/** Each tab has its own colour; the active one sits in a soft pill of that colour. */
const TAB_TONE: Record<string, Tone> = { index: 'brand', attendance: 'green', leave: 'teal', profile: 'blue', approvals: 'amber', more: 'purple' };

export default function TabsLayout() {
  const { c } = useTheme();
  const { isApprover, hasEmployee, user } = useAuth();
  // Employees: like the web employee menu, the current tab is a dark navy pill with a white icon (every tab).
  const employeeLook = dashboardKind(user?.roles) === 'employee';

  const icon =
    (name: string, Icon: LucideIcon) =>
    ({ focused, size }: { focused: boolean; size: number }) => {
      const t = toneColors(TAB_TONE[name] ?? 'brand', c);
      return (
        <View
          style={{
            width: 52,
            height: 30,
            borderRadius: radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: focused ? (employeeLook ? EMPLOYEE_NAVY : t.bg) : 'transparent',
          }}
        >
          <Icon color={focused ? (employeeLook ? '#ffffff' : t.solid) : c.muted} size={size - 2} strokeWidth={focused ? 2.4 : 2} />
        </View>
      );
    };
  const tint = (name: string) => (employeeLook ? (c.scheme === 'dark' ? '#bfdbfe' : EMPLOYEE_NAVY) : toneColors(TAB_TONE[name] ?? 'brand', c).fg);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line, height: 64, paddingTop: 6 },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11 },
        sceneStyle: { backgroundColor: c.canvas },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarAccessibilityLabel: 'Home', tabBarActiveTintColor: tint('index'), tabBarIcon: icon('index', Home) }}
      />
      <Tabs.Screen
        name="attendance"
        options={{ title: 'Attendance', tabBarAccessibilityLabel: 'Attendance', tabBarActiveTintColor: tint('attendance'), tabBarIcon: icon('attendance', Clock) }}
      />
      <Tabs.Screen
        name="leave"
        options={{ title: 'Leave', tabBarAccessibilityLabel: 'Leave', tabBarActiveTintColor: tint('leave'), tabBarIcon: icon('leave', CalendarDays) }}
      />
      <Tabs.Protected guard={hasEmployee}>
        <Tabs.Screen
          name="profile"
          options={{ title: 'Profile', tabBarAccessibilityLabel: 'My profile', tabBarActiveTintColor: tint('profile'), tabBarIcon: icon('profile', UserRound) }}
        />
      </Tabs.Protected>
      <Tabs.Protected guard={isApprover}>
        <Tabs.Screen
          name="approvals"
          options={{
            title: 'Approvals',
            tabBarAccessibilityLabel: 'Approvals',
            tabBarActiveTintColor: tint('approvals'),
            tabBarIcon: icon('approvals', ClipboardCheck),
          }}
        />
      </Tabs.Protected>
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarAccessibilityLabel: 'More', tabBarActiveTintColor: tint('more'), tabBarIcon: icon('more', Menu) }}
      />
    </Tabs>
  );
}
