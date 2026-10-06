import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Save } from 'lucide-react-native';
import { BLOOD_GROUPS, selfProfileUpdateSchema } from '@stencil/shared';
import { Button, Card, ErrorState, Header, Notice, Screen, Select, Skeleton, Text, TextField, toast, type SelectOption } from '@/components';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/format';
import { space } from '@/theme';
import type { TextInputProps } from 'react-native';
import { useMyEmployee, useUpdateMyProfile, type EmployeeDetail } from '../api';

type Values = z.input<typeof selfProfileUpdateSchema>;
type Output = z.output<typeof selfProfileUpdateSchema>;

const MARITAL = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'UNDISCLOSED'] as const;
const BLOOD_OPTIONS: SelectOption<string>[] = [{ value: '', label: 'Not specified' }, ...BLOOD_GROUPS.map((b) => ({ value: b, label: b }))];
const MARITAL_OPTIONS: SelectOption<string>[] = [{ value: '', label: 'Not specified' }, ...MARITAL.map((m) => ({ value: m, label: label(m) }))];

const FIELDS: Path<Values>[] = [
  'personalEmail',
  'phone',
  'alternatePhone',
  'address',
  'city',
  'state',
  'country',
  'postalCode',
  'bloodGroup',
  'maritalStatus',
  'emergencyContact.contactName',
  'emergencyContact.relationship',
  'emergencyContact.phone',
  'emergencyContact.address',
];

const asText = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const toForm = (e: EmployeeDetail): Values => ({
  personalEmail: e.personalEmail ?? '',
  phone: e.phone ?? '',
  alternatePhone: e.alternatePhone ?? '',
  address: e.address ?? '',
  city: e.city ?? '',
  state: e.state ?? '',
  country: e.country ?? '',
  postalCode: e.postalCode ?? '',
  bloodGroup: e.bloodGroup ?? '',
  maritalStatus: e.maritalStatus ?? '',
  emergencyContact: {
    contactName: e.emergencyContact?.contactName ?? '',
    relationship: e.emergencyContact?.relationship ?? '',
    phone: e.emergencyContact?.phone ?? '',
    address: e.emergencyContact?.address ?? '',
  },
});

export const ProfileEditScreen = () => {
  const me = useMyEmployee();
  const save = useUpdateMyProfile();
  const [serverError, setServerError] = useState<string | null>(null);
  const { control, handleSubmit, reset, setError, formState } = useForm<Values, unknown, Output>({ resolver: zodResolver(selfProfileUpdateSchema) });

  const e = me.data;
  useEffect(() => {
    if (e) reset(toForm(e));
  }, [e, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await save.mutateAsync(values);
      toast.success('Profile updated');
      if (router.canGoBack()) router.back();
      else router.replace('/more/profile');
    } catch (err) {
      const apiErr = toApiError(err);
      let matched = false;
      for (const fe of apiErr.fieldErrors) {
        const field = FIELDS.find((f) => f === fe.path);
        if (field) {
          setError(field, { message: fe.message });
          matched = true;
        }
      }
      if (!matched) setServerError(apiErr.message);
    }
  });

  const text = (name: Path<Values>, fieldLabel: string, props: Omit<TextInputProps, 'value' | 'onChangeText'> = {}) => (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          label={fieldLabel}
          value={asText(field.value)}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
          {...props}
        />
      )}
    />
  );

  return (
    <Screen
      keyboard
      header={<Header title="Edit my details" subtitle="Employment details are maintained by HR" back backTo="/more/profile" />}
      footer={
        e ? (
          <Button icon={Save} fullWidth loading={formState.isSubmitting} onPress={() => void onSubmit()}>
            Save changes
          </Button>
        ) : undefined
      }
    >
      {me.isLoading ? (
        <Card style={styles.form}>
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </Card>
      ) : me.error || !e ? (
        <Card>
          <ErrorState title="Could not load your profile" error={me.error} onRetry={() => void me.refetch()} />
        </Card>
      ) : (
        <>
          {serverError ? <Notice tone="danger">{serverError}</Notice> : null}
          <Card style={styles.form}>
            <Text size="lg" weight="semibold" accessibilityRole="header">
              Contact
            </Text>
            {text('personalEmail', 'Personal email', { keyboardType: 'email-address', autoCapitalize: 'none', autoComplete: 'email', maxLength: 254 })}
            {text('phone', 'Phone', { keyboardType: 'phone-pad', autoComplete: 'tel', maxLength: 20 })}
            {text('alternatePhone', 'Alternate phone', { keyboardType: 'phone-pad', maxLength: 20 })}
            {text('address', 'Address', { multiline: true, maxLength: 300, autoComplete: 'street-address' })}
            {text('city', 'City', { maxLength: 80 })}
            {text('state', 'State / Region', { maxLength: 80 })}
            {text('country', 'Country', { maxLength: 80, autoComplete: 'country' })}
            {text('postalCode', 'Postal code', { maxLength: 20, autoComplete: 'postal-code' })}
          </Card>
          <Card style={styles.form}>
            <Text size="lg" weight="semibold" accessibilityRole="header">
              Personal
            </Text>
            <Controller
              control={control}
              name="bloodGroup"
              render={({ field, fieldState }) => (
                <Select label="Blood group" value={asText(field.value)} options={BLOOD_OPTIONS} onChange={field.onChange} error={fieldState.error?.message} />
              )}
            />
            <Controller
              control={control}
              name="maritalStatus"
              render={({ field, fieldState }) => (
                <Select label="Marital status" value={asText(field.value)} options={MARITAL_OPTIONS} onChange={field.onChange} error={fieldState.error?.message} />
              )}
            />
          </Card>
          <Card style={styles.form}>
            <Text size="lg" weight="semibold" accessibilityRole="header">
              Emergency contact
            </Text>
            {text('emergencyContact.contactName', 'Name', { maxLength: 120, autoComplete: 'name' })}
            {text('emergencyContact.relationship', 'Relationship', { maxLength: 60, placeholder: 'e.g. Spouse, Parent' })}
            {text('emergencyContact.phone', 'Phone', { keyboardType: 'phone-pad', maxLength: 20 })}
            {text('emergencyContact.address', 'Address', { multiline: true, maxLength: 300 })}
          </Card>
        </>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  form: { gap: space(4) },
});
