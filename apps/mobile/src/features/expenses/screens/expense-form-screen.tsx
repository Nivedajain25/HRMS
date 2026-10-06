import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { FileText, Save, Send, Trash2 } from 'lucide-react-native';
import { EXPENSE_CATEGORIES, expenseSchema } from '@stencil/shared';
import { Button, Card, DateField, ErrorState, Field, Header, IconButton, Notice, Screen, Select, Skeleton, Text, TextField, toast } from '@/components';
import { formatBytes, pickImage, type ImageSource } from '@/features/profile/kit/files';
import { ImageSourceButtons } from '@/features/profile/kit/ui';
import { toApiError, type UploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { label } from '@/lib/format';
import { dateKeyIn } from '@/lib/time';
import { radius, space, useTheme } from '@/theme';
import { MAX_RECEIPT_MB, uploadReceipt, useExpense, useSaveExpense, type ExpenseDetail } from '../api';

type Values = z.input<typeof expenseSchema>;
type Output = z.output<typeof expenseSchema>;
type Category = (typeof EXPENSE_CATEGORIES)[number];

const FIELDS = ['category', 'amount', 'currency', 'date', 'description', 'merchant', 'project'] as const;
const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AED', 'SGD', 'AUD', 'CAD', 'JPY', 'CHF'];
const CATEGORY_OPTIONS = EXPENSE_CATEGORIES.map((c) => ({ value: c, label: label(c) }));

const asText = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const isCategory = (v: string): v is Category => (EXPENSE_CATEGORIES as readonly string[]).includes(v);

const toForm = (currency: string, today: string, e?: ExpenseDetail | null): Values => ({
  category: e && isCategory(e.category) ? e.category : 'TRAVEL',
  // Blank fails with "Amount must be positive".
  amount: e ? String(e.amount) : '',
  currency: e?.currency ?? currency,
  date: e?.date.slice(0, 10) ?? today,
  description: e?.description ?? '',
  merchant: e?.merchant ?? '',
  project: e?.project ?? '',
});

export const ExpenseFormScreen = () => {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;
  const { c } = useTheme();
  const { user, timeZone } = useAuth();
  const orgCurrency = user?.organization.currency ?? 'USD';
  const today = dateKeyIn(timeZone);
  const existing = useExpense(id);
  const save = useSaveExpense();
  const [receipt, setReceipt] = useState<UploadFile | null>(null);
  const [intent, setIntent] = useState<'draft' | 'submit' | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  /** Avoids uploading the same picture twice when a save is retried. */
  const uploaded = useRef(new Map<string, string>());

  const { control, handleSubmit, reset, setError, formState } = useForm<Values, unknown, Output>({
    resolver: zodResolver(expenseSchema),
    defaultValues: toForm(orgCurrency, today),
  });

  const loaded = existing.data;
  useEffect(() => {
    if (loaded) reset(toForm(orgCurrency, today, loaded));
  }, [loaded, orgCurrency, today, reset]);

  const currencies = useMemo(
    () => [...new Set([orgCurrency, loaded?.currency, ...COMMON_CURRENCIES].filter((v): v is string => !!v))].map((v) => ({ value: v, label: v })),
    [orgCurrency, loaded?.currency],
  );

  const pick = async (source: ImageSource) => {
    const file = await pickImage(source, { maxMb: MAX_RECEIPT_MB, prefix: 'receipt' });
    if (file) setReceipt(file);
  };

  const persist = (submit: boolean) =>
    handleSubmit(async (values) => {
      setServerError(null);
      setIntent(submit ? 'submit' : 'draft');
      try {
        let receiptFileId: string | undefined;
        if (receipt) {
          receiptFileId = uploaded.current.get(receipt.uri);
          if (!receiptFileId) {
            receiptFileId = await uploadReceipt(receipt);
            uploaded.current.set(receipt.uri, receiptFileId);
          }
        }
        const res = await save.mutateAsync({
          id,
          submit,
          fields: {
            category: values.category,
            amount: values.amount,
            currency: values.currency,
            date: values.date,
            description: values.description,
            merchant: values.merchant ?? '',
            project: values.project ?? '',
            ...(receiptFileId ? { receiptFileId } : {}),
          },
        });
        toast.success(submit ? `${res.data.expenseNumber} submitted for approval` : `${res.data.expenseNumber} saved as draft`);
        router.replace({ pathname: '/more/expenses/[id]', params: { id: res.data._id } });
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
      } finally {
        setIntent(null);
      }
    })();

  const busy = formState.isSubmitting;
  const title = editing ? `Edit ${loaded?.expenseNumber ?? 'draft'}` : 'New expense';
  const notEditable = editing && loaded && !loaded.permissions.canEdit;

  return (
    <Screen
      keyboard
      header={<Header title={title} subtitle={editing ? 'Drafts can be edited until submitted' : 'Claim a business expense'} back backTo="/more/expenses" />}
      footer={
        editing && (existing.isLoading || !loaded || notEditable) ? undefined : (
          <View style={styles.actions}>
            <Button
              variant="outline"
              icon={Save}
              style={styles.flex}
              loading={busy && intent === 'draft'}
              disabled={busy}
              onPress={() => void persist(false)}
            >
              Save draft
            </Button>
            <Button icon={Send} style={styles.flex} loading={busy && intent === 'submit'} disabled={busy} onPress={() => void persist(true)}>
              Submit
            </Button>
          </View>
        )
      }
    >
      {editing && existing.isLoading ? (
        <Card style={styles.form}>
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={96} />
        </Card>
      ) : editing && (existing.error || !loaded) ? (
        <Card>
          <ErrorState title="Could not load this expense" error={existing.error} onRetry={() => void existing.refetch()} />
        </Card>
      ) : notEditable ? (
        <Notice tone="warning">Only draft expenses can be edited. This claim has already been submitted.</Notice>
      ) : (
        <>
          {serverError ? <Notice tone="danger">{serverError}</Notice> : null}
          <Card style={styles.form}>
            <Controller
              control={control}
              name="category"
              render={({ field, fieldState }) => (
                <Select<Category>
                  label="Category"
                  required
                  value={field.value}
                  options={CATEGORY_OPTIONS}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />
            <View style={styles.pair}>
              <View style={styles.amount}>
                <Controller
                  control={control}
                  name="amount"
                  render={({ field, fieldState }) => (
                    <TextField
                      label="Amount"
                      required
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      value={asText(field.value)}
                      onChangeText={(t) => field.onChange(t.replace(',', '.'))}
                      onBlur={field.onBlur}
                      error={fieldState.error?.message}
                    />
                  )}
                />
              </View>
              <View style={styles.currency}>
                <Controller
                  control={control}
                  name="currency"
                  render={({ field, fieldState }) => (
                    <Select
                      label="Currency"
                      required
                      value={field.value}
                      options={currencies}
                      onChange={field.onChange}
                      error={fieldState.error?.message}
                    />
                  )}
                />
              </View>
            </View>
            <Controller
              control={control}
              name="date"
              render={({ field, fieldState }) => (
                <DateField label="Expense date" required value={field.value} onChange={field.onChange} maximumDate={today} error={fieldState.error?.message} />
              )}
            />
            <Controller
              control={control}
              name="merchant"
              render={({ field, fieldState }) => (
                <TextField
                  label="Merchant"
                  placeholder="e.g. Uber, Marriott"
                  maxLength={120}
                  autoComplete="off"
                  value={asText(field.value)}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="project"
              render={({ field, fieldState }) => (
                <TextField
                  label="Project / cost center"
                  maxLength={120}
                  autoComplete="off"
                  value={asText(field.value)}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="description"
              render={({ field, fieldState }) => (
                <TextField
                  label="Description"
                  required
                  multiline
                  maxLength={1000}
                  placeholder="Business purpose, e.g. client visit to Acme, Mumbai"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                />
              )}
            />
            <Field label="Receipt" hint={`Photo of the receipt · JPG, PNG or WebP · max ${MAX_RECEIPT_MB} MB`}>
              {loaded?.receiptFileId && !receipt ? (
                <View style={[styles.file, { borderColor: c.line, backgroundColor: c.surface2 }]}>
                  <FileText size={18} color={c.accent} />
                  <View style={styles.flex}>
                    <Text size="sm" weight="medium" numberOfLines={1}>
                      {loaded.receiptFileId.originalName}
                    </Text>
                    <Text size="xs" color="muted">
                      {`Current receipt · ${formatBytes(loaded.receiptFileId.size)}`}
                    </Text>
                  </View>
                </View>
              ) : null}
              {receipt ? (
                <View style={[styles.preview, { borderColor: c.line, backgroundColor: c.surface2 }]}>
                  <Image source={{ uri: receipt.uri }} style={styles.image} resizeMode="contain" accessibilityLabel="Selected receipt" />
                  <View style={styles.previewBar}>
                    <Text size="sm" numberOfLines={1} style={styles.flex}>
                      {receipt.name}
                    </Text>
                    <IconButton icon={Trash2} color={c.danger} onPress={() => setReceipt(null)} accessibilityLabel="Remove receipt" />
                  </View>
                </View>
              ) : (
                <ImageSourceButtons
                  onPick={(s) => void pick(s)}
                  disabled={busy}
                  cameraLabel={loaded?.receiptFileId ? 'Retake' : 'Take photo'}
                  libraryLabel={loaded?.receiptFileId ? 'Replace' : 'Choose'}
                />
              )}
            </Field>
          </Card>
        </>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: space(4) },
  actions: { flexDirection: 'row', gap: space(3) },
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: space(3) },
  amount: { flexGrow: 2, flexBasis: 160 },
  currency: { flexGrow: 1, flexBasis: 110 },
  file: { flexDirection: 'row', alignItems: 'center', gap: space(3), borderWidth: 1, borderRadius: radius.md, padding: space(3) },
  preview: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  image: { width: '100%', height: 200 },
  previewBar: { flexDirection: 'row', alignItems: 'center', gap: space(2), paddingLeft: space(3) },
});
