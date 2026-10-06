import { Stack } from 'expo-router';
import { useTheme } from '@/theme';

// Deep links (notifications, Home) into a More screen keep the hub underneath, so "back" lands on it.
export const unstable_settings = { initialRouteName: 'index' };

export default function MoreLayout() {
  const { c } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.canvas } }} />;
}
