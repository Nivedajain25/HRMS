import { Stack } from 'expo-router';
import { AnnouncementPopup } from '@/features/announcements/components/announcement-popup';
import { PermissionsPrompt } from '@/features/attendance/permissions-prompt';
import { EmergencyPopup } from '@/features/emergencies/emergency-popup';
import { MyEmergencyStatus } from '@/features/emergencies/my-emergency-status';
import { TaskPopup } from '@/features/tasks/components/task-popup';
import { useAuthStore } from '@/lib/auth';
import { usePushNotifications } from '@/lib/push';
import { useTheme } from '@/theme';

export default function AppLayout() {
  const { c } = useTheme();
  const userId = useAuthStore((s) => s.user?._id ?? null);
  usePushNotifications(userId);
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.canvas } }} />
      <PermissionsPrompt />
      <AnnouncementPopup />
      <TaskPopup />
      <EmergencyPopup />
      <MyEmergencyStatus />
    </>
  );
}
