import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationThemeProvider, type Theme } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { ConfirmProvider, ToastViewport } from '@/components';
import { BootScreen } from '@/features/auth/boot-screen';
import { bootstrapSession, useAuthStore } from '@/lib/auth';
import { IN_EXPO_GO } from '@/lib/config';
import { queryClient, subscribeAppFocus } from '@/lib/query-client';
import { ThemeProvider, useTheme } from '@/theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
// Expo Go doesn't support splash options (it warns); installed builds get the fade.
if (!IN_EXPO_GO) SplashScreen.setOptions({ fade: true, duration: 200 });

// Bundled with the app (not resolved from node_modules): the pnpm store lives on another
// drive, which Metro cannot express as an asset URL. Keys are the family names in theme/tokens.
/* eslint-disable @typescript-eslint/no-require-imports -- Metro asset modules */
const FONTS = {
  Outfit_400Regular: require('../assets/fonts/Outfit_400Regular.ttf'),
  Outfit_500Medium: require('../assets/fonts/Outfit_500Medium.ttf'),
  Outfit_600SemiBold: require('../assets/fonts/Outfit_600SemiBold.ttf'),
  Outfit_700Bold: require('../assets/fonts/Outfit_700Bold.ttf'),
};
/* eslint-enable @typescript-eslint/no-require-imports */

const RootNavigator = () => {
  const { c, scheme, ready: themeReady } = useTheme();
  const status = useAuthStore((s) => s.status);
  const [fontsLoaded, fontError] = useFonts(FONTS);
  const ready = themeReady && (fontsLoaded || !!fontError) && status !== 'loading';

  useEffect(() => {
    void bootstrapSession();
    return subscribeAppFocus();
  }, []);

  const [splashHidden, setSplashHidden] = useState(false);
  useEffect(() => {
    if (!ready) return;
    void SplashScreen.hideAsync()
      .catch(() => undefined)
      .finally(() => setSplashHidden(true));
  }, [ready]);

  const navTheme = useMemo<Theme>(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: c.primary,
        background: c.canvas,
        card: c.surface,
        text: c.fg,
        border: c.line,
        notification: c.danger,
      },
    };
  }, [scheme, c]);

  // Before the first paint the native splash stays up; a later session restore (retry) shows the boot screen.
  if (status === 'loading' && !splashHidden) return <View style={[styles.flex, { backgroundColor: c.canvas }]} />;

  return (
    <NavigationThemeProvider value={navTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {status === 'offline' || status === 'loading' ? (
        <BootScreen />
      ) : (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.canvas } }}>
          <Stack.Protected guard={status === 'authenticated'}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>
          <Stack.Protected guard={status !== 'authenticated'}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
        </Stack>
      )}
      <ToastViewport />
    </NavigationThemeProvider>
  );
};

export default function RootLayout() {
  const app = (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <ConfirmProvider>
            <RootNavigator />
          </ConfirmProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
  // Browser preview on a laptop: show the app in a phone-sized column instead of stretching it across the screen.
  if (Platform.OS !== 'web') return app;
  return (
    <View style={styles.webBackdrop}>
      <View style={styles.webPhone}>{app}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  webBackdrop: { flex: 1, alignItems: 'center', backgroundColor: '#e2e8f0' },
  webPhone: {
    flex: 1,
    width: '100%',
    maxWidth: 430,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    boxShadow: '0 0 24px rgba(15, 23, 42, 0.18)',
  },
});
