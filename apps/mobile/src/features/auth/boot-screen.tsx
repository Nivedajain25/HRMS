import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WifiOff } from 'lucide-react-native';
import { Button, Logomark, Text } from '@/components';
import { abandonSession, bootstrapSession, useAuthStore } from '@/lib/auth';
import { API_ORIGIN } from '@/lib/config';
import { space, useTheme } from '@/theme';

/** Shown while a stored session is being restored, or when the server could not be reached. */
export const BootScreen = () => {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.bootError);
  const loading = status === 'loading';
  return (
    <View style={[styles.root, { backgroundColor: c.canvas, paddingTop: insets.top, paddingBottom: insets.bottom + space(6) }]}>
      <View style={styles.center}>
        <Logomark size={56} />
        {loading ? (
          <>
            <ActivityIndicator color={c.accent} size="large" />
            <Text color="muted" accessibilityLiveRegion="polite">
              Restoring your session…
            </Text>
          </>
        ) : (
          <>
            <View style={styles.title}>
              <WifiOff size={20} color={c.danger} />
              <Text size="lg" weight="semibold" accessibilityRole="header">
                Can’t reach Stencil
              </Text>
            </View>
            <Text color="muted" align="center">
              {error ?? 'Cannot reach the server.'}
            </Text>
            {API_ORIGIN ? (
              <Text size="xs" color="subtle" align="center">
                Server: {API_ORIGIN.replace(/^https?:\/\//, '')}
              </Text>
            ) : null}
          </>
        )}
      </View>
      {!loading ? (
        <View style={styles.actions}>
          <Button fullWidth size="lg" onPress={() => void bootstrapSession()}>
            Try again
          </Button>
          <Button fullWidth variant="ghost" onPress={() => void abandonSession()}>
            Sign in with a different account
          </Button>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space(6) },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(4) },
  title: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  actions: { gap: space(2) },
});
