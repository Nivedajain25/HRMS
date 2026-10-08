import { useEffect, useState } from 'react';
import { Image, Linking, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Camera, History, ImagePlus, Send, Trash2 } from 'lucide-react-native';
import { regularizationSchema } from '@stencil/shared';
import { Button, Card, DateField, Field, Header, IconButton, Notice, Screen, StatusBadge, Text, TextField, toast } from '@/components';
import { toApiError, type UploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateKeyIn, formatTimeIn, timeValueIn } from '@/lib/time';
import { radius, space, useTheme } from '@/theme';
import { useAttendanceList, useSubmitRegularization } from '../api';

type Values = z.input<typeof regularizationSchema>;
type Output = z.output<typeof regularizationSchema>;
const FIELDS = ['date', 'requestedCheckIn', 'requestedCheckOut', 'reason'] as const;
const isDateKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export const RegularizationFormScreen = () => {
  const { c } = useTheme();
  const { timeZone } = useAuth();
  const params = useLocalSearchParams<{ date?: string }>();
  const today = dateKeyIn(timeZone);
  const initialDate = isDateKey(params.date) && params.date <= today ? params.date : today;
  const submit = useSubmitRegularization();
  const [attachment, setAttachment] = useState<UploadFile | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const { control, handleSubmit, formState, setError, watch, setValue, getValues } = useForm<Values, unknown, Output>({
    resolver: zodResolver(regularizationSchema),
    defaultValues: { date: initialDate, requestedCheckIn: '', requestedCheckOut: '', reason: '' },
  });
  const date = watch('date');
  const validDate = isDateKey(date) && date <= today;
  const existing = useAttendanceList({ from: date, to: date, limit: 1 }, validDate);
  const record = validDate ? existing.data?.data[0] : undefined;

  // Prefill the times from the recorded attendance while the fields are still empty.
  useEffect(() => {
    if (!record) return;
    if (!getValues('requestedCheckIn') && record.checkIn) setValue('requestedCheckIn', timeValueIn(record.checkIn, timeZone));
    if (!getValues('requestedCheckOut') && record.checkOut) setValue('requestedCheckOut', timeValueIn(record.checkOut, timeZone));
  }, [record, getValues, setValue, timeZone]);

  const pick = async (source: 'camera' | 'library') => {
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          toast.error('Camera access is off', 'Allow camera access in Settings to take a photo.');
          if (!perm.canAskAgain) void Linking.openSettings();
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, allowsEditing: false };
      const result =
        source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) {
        toast.error('That file is too large', 'Attachments can be up to 10 MB.');
        return;
      }
      const type = asset.mimeType ?? 'image/jpeg';
      const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
      setAttachment({ uri: asset.uri, name: asset.fileName ?? `attachment-${Date.now()}.${ext}`, type });
    } catch (err) {
      toast.error('Could not attach the photo', toApiError(err).message);
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await submit.mutateAsync({ input: values, attachment });
      toast.success(res.message ?? 'Regularization request submitted');
      router.replace({ pathname: '/attendance/regularizations/[id]', params: { id: res.data._id } });
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
      header={<Header title="Request regularization" subtitle={`Times are in ${timeZone}`} back backTo="/attendance/regularizations" />}
      footer={
        <Button icon={Send} fullWidth loading={formState.isSubmitting} onPress={() => void onSubmit()}>
          Submit request
        </Button>
      }
    >
      {serverError ? <Notice tone="danger">{serverError}</Notice> : null}
      <Card style={styles.form}>
        <Controller
          control={control}
          name="date"
          render={({ field, fieldState }) => (
            <DateField
              label="Date"
              required
              value={field.value}
              onChange={field.onChange}
              maximumDate={today}
              error={fieldState.error?.message}
            />
          )}
        />
        {validDate ? (
          <View style={[styles.recorded, { backgroundColor: c.surface2, borderColor: c.line }]} accessibilityLiveRegion="polite">
            <History size={16} color={c.muted} />
            {existing.isLoading ? (
              <Text size="sm" color="muted">
                Checking recorded attendance…
              </Text>
            ) : record ? (
              <View style={styles.recordedBody}>
                <Text size="sm" color="fg2" tabular>
                  {`Recorded: ${formatTimeIn(record.checkIn, timeZone)} – ${formatTimeIn(record.checkOut, timeZone)}`}
                </Text>
                <StatusBadge status={record.status} />
              </View>
            ) : (
              <Text size="sm" color="muted">
                No attendance recorded for this date.
              </Text>
            )}
          </View>
        ) : null}
        <View style={styles.times}>
          <View style={styles.flex}>
            <Controller
              control={control}
              name="requestedCheckIn"
              render={({ field, fieldState }) => (
                <DateField
                  mode="time"
                  label="Check-in"
                  required
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />
          </View>
          <View style={styles.flex}>
            <Controller
              control={control}
              name="requestedCheckOut"
              render={({ field, fieldState }) => (
                <DateField
                  mode="time"
                  label="Check-out"
                  required
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />
          </View>
        </View>
        <Text size="xs" color="muted">
          A check-out earlier than the check-in is treated as an overnight shift ending the next day.
        </Text>
        <Controller
          control={control}
          name="reason"
          render={({ field, fieldState }) => (
            <TextField
              label="Reason"
              required
              multiline
              maxLength={1000}
              placeholder="e.g. Forgot to check out after the client meeting"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
        <Field label="Attachment" hint="Optional proof such as a gate log or email screenshot (image, max 10 MB).">
          {attachment ? (
            <View style={[styles.attachment, { borderColor: c.line, backgroundColor: c.surface2 }]}>
              <Image source={{ uri: attachment.uri }} style={styles.thumb} accessibilityIgnoresInvertColors />
              <Text size="sm" numberOfLines={1} style={styles.flex}>
                {attachment.name}
              </Text>
              <IconButton icon={Trash2} color={c.danger} onPress={() => setAttachment(null)} accessibilityLabel="Remove attachment" />
            </View>
          ) : (
            <View style={styles.pickers}>
              <Button variant="outline" icon={Camera} onPress={() => void pick('camera')} style={styles.flex}>
                Take photo
              </Button>
              <Button variant="outline" icon={ImagePlus} onPress={() => void pick('library')} style={styles.flex}>
                Choose
              </Button>
            </View>
          )}
        </Field>
      </Card>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: space(4) },
  times: { flexDirection: 'row', gap: space(3) },
  recorded: { flexDirection: 'row', alignItems: 'center', gap: space(2), borderWidth: 1, borderRadius: radius.md, padding: space(3) },
  recordedBody: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space(2) },
  attachment: { flexDirection: 'row', alignItems: 'center', gap: space(3), borderWidth: 1, borderRadius: radius.md, paddingLeft: space(2) },
  thumb: { width: 40, height: 40, borderRadius: radius.sm },
  pickers: { flexDirection: 'row', gap: space(2) },
});
