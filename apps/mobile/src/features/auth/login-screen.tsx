import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type TextInput } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Lock, Mail, ServerCrash, ShieldAlert, WifiOff } from 'lucide-react-native';
import { loginSchema } from '@stencil/shared';
import { Button, Card, Checkbox, Logo, Notice, Screen, Text, TextField, type IconComponent } from '@/components';
import { toApiError, type ApiError } from '@/lib/api';
import { getLastEmail, signIn, useAuthStore } from '@/lib/auth';
import { API_ORIGIN, webUrl } from '@/lib/config';
import { space, useTheme } from '@/theme';

type Values = z.input<typeof loginSchema>;
type Output = z.output<typeof loginSchema>;

interface ServerMessage {
  title: string;
  description?: string;
  icon: IconComponent;
}

/** Friendly copy for sign-in failures (credentials, lockout, rate limit, cold start, offline). */
const describeError = (e: ApiError): ServerMessage => {
  switch (e.code) {
    case 'ACCOUNT_LOCKED':
      return { title: 'Account temporarily locked', description: e.message, icon: ShieldAlert };
    case 'RATE_LIMITED':
      return { title: 'Too many attempts', description: e.message, icon: ShieldAlert };
    case 'SERVER_UNAVAILABLE':
    case 'TIMEOUT':
      return {
        title: 'The server is starting up',
        description: 'Stencil may take up to a minute to wake up. Please try again shortly.',
        icon: ServerCrash,
      };
    case 'NETWORK_ERROR':
      return { title: 'No connection', description: e.message, icon: WifiOff };
    case 'NOT_CONFIGURED':
      return { title: 'App not configured', description: e.message, icon: ServerCrash };
    default:
      return { title: e.message, icon: ShieldAlert };
  }
};

export const LoginScreen = () => {
  const { c } = useTheme();
  const signOutReason = useAuthStore((s) => s.signOutReason);
  const [serverError, setServerError] = useState<ServerMessage | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const form = useForm<Values, unknown, Output>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: true },
  });
  const { control, handleSubmit, formState, setError, setValue, getValues } = form;

  useEffect(() => {
    void getLastEmail().then((email) => {
      if (email && !getValues('email')) setValue('email', email);
    });
  }, [getValues, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await signIn(values);
    } catch (err) {
      const e = toApiError(err);
      let handled = false;
      for (const fe of e.fieldErrors) {
        if (fe.path === 'email' || fe.path === 'password') {
          setError(fe.path, { message: fe.message });
          handled = true;
        }
      }
      if (!handled) setServerError(describeError(e));
    }
  });

  const forgot = () => {
    void WebBrowser.openBrowserAsync(webUrl('/forgot-password'), { controlsColor: c.primary }).catch(() => undefined);
  };

  return (
    <Screen keyboard contentStyle={styles.content}>
      <View style={styles.brand}>
        <Logo size={44} />
      </View>
      <View style={styles.heading}>
        <Text size="2xl" weight="bold" accessibilityRole="header">
          Welcome back
        </Text>
        <Text color="muted">Sign in to your Stencil workspace.</Text>
      </View>

      <Card padding={space(5)} style={styles.card}>
        {signOutReason && !serverError ? <Notice tone="info">{signOutReason}</Notice> : null}
        {serverError ? (
          <Notice tone="danger" icon={serverError.icon}>
            <Text size="sm" weight="semibold" style={{ color: c.scheme === 'dark' ? '#fca5a5' : '#b91c1c' }}>
              {serverError.title}
            </Text>
            {serverError.description ? (
              <Text size="sm" style={{ color: c.scheme === 'dark' ? '#fca5a5' : '#b91c1c' }}>
                {serverError.description}
              </Text>
            ) : null}
          </Notice>
        ) : null}

        <Controller
          control={control}
          name="email"
          render={({ field, fieldState }) => (
            <TextField
              label="Email"
              required
              leftIcon={Mail}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="username"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              submitBehavior="submit"
            />
          )}
        />
        <Controller
          control={control}
          name="password"
          render={({ field, fieldState }) => (
            <TextField
              ref={passwordRef}
              label="Password"
              required
              leftIcon={Lock}
              password
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => void onSubmit()}
            />
          )}
        />
        <View style={styles.row}>
          <Controller
            control={control}
            name="rememberMe"
            render={({ field }) => <Checkbox label="Remember me" checked={!!field.value} onChange={field.onChange} />}
          />
          <Button variant="ghost" onPress={forgot} accessibilityHint="Opens the password reset page in your browser">
            Forgot password?
          </Button>
        </View>
        <Button size="lg" fullWidth loading={formState.isSubmitting} onPress={() => void onSubmit()}>
          Sign in
        </Button>
      </Card>

      {API_ORIGIN ? (
        <Text size="xs" color="subtle" align="center">
          {API_ORIGIN.replace(/^https?:\/\//, '')}
        </Text>
      ) : null}
    </Screen>
  );
};

const styles = StyleSheet.create({
  content: { paddingHorizontal: space(5), paddingTop: space(10), gap: space(6), flexGrow: 1 },
  brand: { alignItems: 'flex-start' },
  heading: { gap: space(1) },
  card: { gap: space(4) },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
});
