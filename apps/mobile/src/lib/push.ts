import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import type * as NotificationsModule from 'expo-notifications';
import { router } from 'expo-router';
import { brand } from '@/theme/tokens';
import { post } from './api';
import { APP_VERSION, EAS_PROJECT_ID, IN_EXPO_GO } from './config';
import { hrefForLink } from './links';
import { queryClient } from './query-client';
import { storage, StorageKeys } from './storage';

/**
 * Expo Go (SDK 53+) no longer supports remote push, and merely importing expo-notifications there throws on
 * Android. So the module is loaded lazily and push is skipped entirely inside Expo Go; real builds are unaffected.
 */
let notificationsModule: typeof NotificationsModule | null | undefined;
const loadNotifications = (): typeof NotificationsModule | null => {
  if (notificationsModule !== undefined) return notificationsModule;
  // Not in Expo Go (unsupported) nor in the browser preview (the web module lacks most of the API and throws).
  if (IN_EXPO_GO || Platform.OS === 'web') {
    // Silently: a console warning here pops up over the app in Expo Go.
    notificationsModule = null;
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Notifications = require('expo-notifications') as typeof NotificationsModule;
  // Show notifications while the app is in the foreground too.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  notificationsModule = Notifications;
  return Notifications;
};

/**
 * Asks for notification permission, obtains the Expo push token and registers
 * it with `POST /devices`. Returns the token, or `null` when push is not
 * available (Expo Go, simulator, permission denied, no EAS project id).
 */
export const registerForPush = async (): Promise<string | null> => {
  const Notifications = loadNotifications();
  if (!Notifications || !Device.isDevice) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Notifications',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: brand[600],
    });
  }
  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted;
  if (!granted && current.canAskAgain) granted = (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return null;
  if (!EAS_PROJECT_ID) {
    console.warn('[push] EAS project id is not configured (EAS_PROJECT_ID); push notifications are disabled.');
    return null;
  }
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
  await post('/devices', {
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    appVersion: APP_VERSION,
    deviceName: (Device.deviceName ?? Device.modelName ?? undefined)?.slice(0, 120),
  });
  await storage.set(StorageKeys.pushToken, token);
  return token;
};

const openFromNotification = (response: NotificationsModule.NotificationResponse) => {
  const link = response.notification.request.content.data?.link;
  const href = hrefForLink(typeof link === 'string' ? link : null);
  if (href) router.push(href);
};

/**
 * Registers this device for push after sign-in (re-run when the user changes)
 * and routes notification taps to the matching screen. A no-op in Expo Go.
 */
export const usePushNotifications = (userId: string | null) => {
  useEffect(() => {
    const Notifications = loadNotifications();
    if (!userId || !Notifications) return;
    registerForPush().catch((err: unknown) => console.warn('[push] registration failed', err));
    // Expo push tokens rarely rotate; when the native token changes, register again.
    const sub = Notifications.addPushTokenListener(() => {
      registerForPush().catch((err: unknown) => console.warn('[push] re-registration failed', err));
    });
    return () => sub.remove();
  }, [userId]);

  useEffect(() => {
    const Notifications = loadNotifications();
    if (!userId || !Notifications) return;
    // App launched by tapping a notification.
    const last = Notifications.getLastNotificationResponse();
    if (last && last.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
      Notifications.clearLastNotificationResponse();
      openFromNotification(last);
    }
    const tap = Notifications.addNotificationResponseReceivedListener((response) => {
      if (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) openFromNotification(response);
    });
    // Keep unread counts and lists fresh while the app is open.
    const received = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    return () => {
      tap.remove();
      received.remove();
    };
  }, [userId]);
};
