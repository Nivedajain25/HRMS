import { Stack } from 'expo-router';
import { useTheme } from '@/theme';

export default function ApprovalsLayout() {
  const { c } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.canvas } }} />;
}
