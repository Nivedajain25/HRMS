import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Trash2, Upload, UserX } from 'lucide-react-native';
import { DOCUMENT_CATEGORIES, documentUploadSchema } from '@stencil/shared';
import { Button, Card, Checkbox, DateField, EmptyState, Field, Header, IconButton, Notice, Screen, Select, Text, TextField, toast } from '@/components';
import { pickImage, type ImageSource } from '@/features/profile/kit/files';
import { ImageSourceButtons } from '@/features/profile/kit/ui';
import { toApiError, type UploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { label } from '@/lib/format';
import { radius, space, useTheme } from '@/theme';
import { MAX_UPLOAD_MB, useUploadDocument } from '../api';

type Values = z.input<typeof documentUploadSchema>;
type Output = z.output<typeof documentUploadSchema>;
type Category = (typeof DOCUMENT_CATEGORIES)[number];

const FIELDS = ['title', 'category', 'description', 'expiryDate'] as const;
const CATEGORY_OPTIONS = DOCUMENT_CATEGORIES.filter((c) => c !== 'PAYSLIP' && c !== 'POLICY').map((c) => ({ value: c, label: label(c) }));
const asText = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export const DocumentUploadScreen = () => {
  const { c } = useTheme();
  const { user, hasEmployee } = useAuth();
  const uploadDoc = useUploadDocument();
  const [file, setFile] = useState<UploadFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const { control, handleSubmit, setError, setValue, watch, formState } = useForm<Values, unknown, Output>({
    resolver: zodResolver(documentUploadSchema),
    defaultValues: { title: '', category: 'IDENTITY', description: '', expiryDate: '', confidential: false },
  });
  const expiry = asText(watch('expiryDate'));

  const pick = async (source: ImageSource) => {
    const picked = await pickImage(source, { maxMb: MAX_UPLOAD_MB, prefix: 'document' });
    if (picked) {
      setFile(picked);
      setFileError(null);
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    if (!file) {
      setFileError('Take or choose a picture of the document');
      return;
    }
    try {
      await uploadDoc.mutateAsync({
        file,
        fields: {
          title: values.title,
          category: values.category,
          employeeId: user?.employeeId ?? undefined,
          description: values.description,
          expiryDate: values.expiryDate,
          confidential: values.confidential,
        },
      });
      toast.success('Document uploaded', 'HR will verify it.');
      if (router.canGoBack()) router.back();
      else router.replace('/more/documents');
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

  if (!hasEmployee) {
    return (
      <Screen header={<Header title="Upload document" back backTo="/more/documents" />}>
        <Card>
          <EmptyState icon={UserX} title="No employee profile" message="Only users linked to an employee record can upload personal documents." />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      keyboard
      header={<Header title="Upload document" subtitle="Stored privately; HR verifies it" back backTo="/more/documents" />}
      footer={
        <Button icon={Upload} fullWidth loading={formState.isSubmitting} onPress={() => void onSubmit()}>
          Upload
        </Button>
      }
    >
      {serverError ? <Notice tone="danger">{serverError}</Notice> : null}
      <Card style={styles.form}>
        <Field label="File" required error={fileError ?? undefined} hint={`Photo of the document · JPG, PNG or WebP · max ${MAX_UPLOAD_MB} MB`}>
          {file ? (
            <View style={[styles.preview, { borderColor: c.line, backgroundColor: c.surface2 }]}>
              <Image source={{ uri: file.uri }} style={styles.image} resizeMode="contain" accessibilityLabel="Selected document" />
              <View style={styles.previewBar}>
                <Text size="sm" numberOfLines={1} style={styles.flex}>
                  {file.name}
                </Text>
                <IconButton icon={Trash2} color={c.danger} onPress={() => setFile(null)} accessibilityLabel="Remove picture" />
              </View>
            </View>
          ) : (
            <ImageSourceButtons onPick={(s) => void pick(s)} disabled={formState.isSubmitting} />
          )}
        </Field>
        <Controller
          control={control}
          name="title"
          render={({ field, fieldState }) => (
            <TextField
              label="Title"
              required
              maxLength={150}
              placeholder="e.g. Passport"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="category"
          render={({ field, fieldState }) => (
            <Select<Category> label="Category" required value={field.value} options={CATEGORY_OPTIONS} onChange={field.onChange} error={fieldState.error?.message} />
          )}
        />
        <Controller
          control={control}
          name="expiryDate"
          render={({ field, fieldState }) => (
            <DateField
              label="Expiry date"
              value={asText(field.value)}
              onChange={field.onChange}
              placeholder="No expiry"
              hint="You and HR are reminded before it expires."
              error={fieldState.error?.message}
            />
          )}
        />
        {expiry ? (
          <Button variant="ghost" onPress={() => setValue('expiryDate', '')} accessibilityLabel="Clear expiry date">
            Clear expiry date
          </Button>
        ) : null}
        <Controller
          control={control}
          name="description"
          render={({ field, fieldState }) => (
            <TextField
              label="Description"
              multiline
              maxLength={500}
              value={asText(field.value)}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="confidential"
          render={({ field }) => (
            <View style={styles.gap}>
              <Checkbox label="Confidential" checked={field.value === true} onChange={field.onChange} />
              <Text size="xs" color="muted">
                Hidden from managers; only you and document administrators can view it.
              </Text>
            </View>
          )}
        />
      </Card>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space(1) },
  form: { gap: space(4) },
  preview: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  image: { width: '100%', height: 220 },
  previewBar: { flexDirection: 'row', alignItems: 'center', gap: space(2), paddingLeft: space(3) },
});
