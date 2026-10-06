import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound } from 'lucide-react-native';
import { changePasswordSchema, type ChangePasswordInput } from '@stencil/shared';
import { Button, Card, Header, Notice, Screen, TextField, toast } from '@/components';
import { toApiError } from '@/lib/api';
import { space } from '@/theme';
import { sessionKeys, useChangePassword } from '../api';

const FIELDS = ['currentPassword', 'newPassword'] as const;

export const ChangePasswordScreen = () => {
  const qc = useQueryClient();
  const change = useChangePassword();
  const [serverError, setServerError] = useState<string | null>(null);
  const { control, handleSubmit, setError, setFocus, formState } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await change.mutateAsync(values);
      void qc.invalidateQueries({ queryKey: sessionKeys.all });
      toast.success(res.message ?? 'Password changed', 'Your other devices have been signed out.');
      if (router.canGoBack()) router.back();
      else router.replace('/more/settings');
    } catch (err) {
      const e = toApiError(err);
      let matched = false;
      for (const fe of e.fieldErrors) {
        const field = FIELDS.find((f) => f === fe.path);
        if (field) {
          setError(field, { message: fe.message });
          matched = true;
        }
      }
      if (!matched) setServerError(e.message);
    }
  });

  return (
    <Screen
      keyboard
      header={<Header title="Change password" back backTo="/more/settings" />}
      footer={
        <Button icon={KeyRound} fullWidth loading={formState.isSubmitting} onPress={() => void onSubmit()}>
          Change password
        </Button>
      }
    >
      <Notice tone="info">Changing your password signs you out of every other device and the web app. This phone stays signed in.</Notice>
      {serverError ? <Notice tone="danger">{serverError}</Notice> : null}
      <Card style={styles.form}>
        <Controller
          control={control}
          name="currentPassword"
          render={({ field, fieldState }) => (
            <TextField
              ref={field.ref}
              label="Current password"
              required
              password
              autoCapitalize="none"
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="next"
              onSubmitEditing={() => setFocus('newPassword')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="newPassword"
          render={({ field, fieldState }) => (
            <TextField
              ref={field.ref}
              label="New password"
              required
              password
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={() => void onSubmit()}
              hint="At least 8 characters with an uppercase letter, a lowercase letter and a number."
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
      </Card>
    </Screen>
  );
};

const styles = StyleSheet.create({
  form: { gap: space(4) },
});
