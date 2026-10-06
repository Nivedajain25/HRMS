import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, StyleSheet, Switch, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { AlertTriangle, CalendarRange, Camera, CheckCircle2, FileText, ImagePlus, Info, Send, Trash2 } from 'lucide-react-native';
import { leaveRequestSchema, type LeavePreviewInput } from '@stencil/shared';
import {
  Badge,
  Button,
  Card,
  DateField,
  ErrorState,
  Field,
  Header,
  IconButton,
  Notice,
  Screen,
  Segmented,
  Select,
  Skeleton,
  Text,
  TextField,
  toast,
} from '@/components';
import { ApiError, toApiError, type UploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateKeyIn, formatKey } from '@/lib/time';
import { radius, space, toneColors, useTheme } from '@/theme';
import {
  uploadLeaveAttachment,
  useActiveLeaveTypes,
  useLeave,
  useLeaveBalances,
  useLeavePreview,
  useSaveLeave,
  type HalfDaySession,
  type LeaveAttachment,
  type LeavePreview,
  type LeaveRequest,
} from '../api';
import { AttachmentRow } from '../components/attachment-row';
import { useDebouncedValue } from '../components/list-helpers';
import { attachmentOf, dateKeyOf, formatNum, policyNotes, typeOf } from '../lib';

type FormIn = z.input<typeof leaveRequestSchema>;
type FormOut = z.output<typeof leaveRequestSchema>;

const FIELDS = ['leaveTypeId', 'startDate', 'endDate', 'halfDay', 'halfDaySession', 'reason'] as const;
/** Validation codes the API tolerates when saving a draft (re-checked on submit). */
const DRAFT_TOLERATED = new Set(['INSUFFICIENT_BALANCE', 'DOCUMENT_REQUIRED']);
const MAX_BYTES = 10 * 1024 * 1024;
const SESSIONS: { value: HalfDaySession; label: string }[] = [
  { value: 'FIRST_HALF', label: 'First half' },
  { value: 'SECOND_HALF', label: 'Second half' },
];

const defaults = (draft: LeaveRequest | null, typeId?: string): FormIn => ({
  leaveTypeId: (draft ? (typeOf(draft)?._id ?? (typeof draft.leaveTypeId === 'string' ? draft.leaveTypeId : undefined)) : typeId) ?? '',
  startDate: dateKeyOf(draft?.startDate),
  endDate: dateKeyOf(draft?.endDate),
  halfDay: draft?.halfDay ?? false,
  halfDaySession: draft?.halfDaySession ?? 'FIRST_HALF',
  reason: draft?.reason ?? '',
});

/* ------------------------------ Preview ------------------------------ */

const PreviewPanel = ({
  ready,
  preview,
  loading,
  updating,
  error,
  warnings,
}: {
  ready: boolean;
  preview?: LeavePreview;
  loading: boolean;
  updating: boolean;
  error: Error | null;
  warnings: { code: string; message: string }[];
}) => {
  const { c } = useTheme();
  if (!ready) {
    return (
      <View style={[styles.previewHint, { borderColor: c.lineStrong }]}>
        <CalendarRange size={18} color={c.muted} />
        <Text size="sm" color="muted" style={styles.flex}>
          Choose a leave type and dates to see working days, excluded holidays and your balance after this request.
        </Text>
      </View>
    );
  }
  if (loading) return <Skeleton height={132} />;
  if (error && !preview) return <Notice tone="danger" icon={AlertTriangle}>{error.message}</Notice>;
  if (!preview) return null;
  const negative = !preview.unlimited && preview.balanceAfter !== null && preview.balanceAfter < 0;
  const purple = toneColors('purple', c);
  return (
    <View
      style={[styles.preview, { borderColor: c.line, backgroundColor: c.surface2 }]}
      accessibilityLabel="Leave preview"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.previewStats}>
        <View style={styles.previewStat} accessible accessibilityLabel={`${formatNum(preview.days)} working days requested`}>
          <Text size="xs" color="muted" weight="medium">
            Days requested
          </Text>
          <Text size="2xl" weight="bold" tabular>
            {formatNum(preview.days)}
          </Text>
          <Text size="xs" color="muted">
            {preview.days === 1 ? 'working day' : 'working days'}
          </Text>
        </View>
        <View style={[styles.previewDivider, { backgroundColor: c.line }]} />
        <View
          style={styles.previewStat}
          accessible
          accessibilityLabel={
            preview.unlimited
              ? 'Unpaid, not deducted from balance'
              : preview.balanceAfter === null
                ? 'Balance after: not available'
                : `Balance after: ${formatNum(preview.balanceAfter)} of ${formatNum(preview.balance ?? 0)} available`
          }
        >
          <Text size="xs" color="muted" weight="medium">
            {preview.unlimited ? 'Balance' : 'Balance after'}
          </Text>
          {preview.unlimited ? (
            <>
              <Text size="lg" weight="semibold">
                Unpaid
              </Text>
              <Text size="xs" color="muted">
                Not deducted from balance
              </Text>
            </>
          ) : preview.balanceAfter === null ? (
            <Text size="lg" weight="semibold" color="muted">
              —
            </Text>
          ) : (
            <>
              <Text size="2xl" weight="bold" tabular style={negative ? { color: c.danger } : undefined}>
                {formatNum(preview.balanceAfter)}
              </Text>
              <Text size="xs" color="muted">{`of ${formatNum(preview.balance ?? 0)} available`}</Text>
            </>
          )}
        </View>
      </View>

      {preview.holidays.length > 0 || preview.weekOffs.length > 0 ? (
        <View style={[styles.previewSection, { borderTopColor: c.line }]}>
          <Text size="xs" color="muted" weight="medium">
            Not counted
          </Text>
          <View style={styles.badges}>
            {preview.holidays.map((h) => (
              <View key={h.date} style={[styles.holiday, { backgroundColor: purple.bg, borderColor: purple.border }]}>
                <Text size="xs" weight="medium" style={{ color: purple.fg }}>{`${formatKey(h.date, 'dd MMM')} · ${h.name}`}</Text>
              </View>
            ))}
            {preview.weekOffs.slice(0, 6).map((d) => (
              <Badge key={d} tone="gray">{`${formatKey(d, 'EEE dd MMM')} · Week off`}</Badge>
            ))}
            {preview.weekOffs.length > 6 ? <Badge tone="gray">{`+${preview.weekOffs.length - 6} week-off days`}</Badge> : null}
          </View>
        </View>
      ) : null}

      {warnings.length > 0 ? (
        <View style={[styles.previewSection, { borderTopColor: c.line }]}>
          {warnings.map((w) => (
            <Notice key={w.code + w.message} tone="warning" icon={AlertTriangle}>
              {w.message}
            </Notice>
          ))}
        </View>
      ) : (
        <View style={[styles.previewOk, { borderTopColor: c.line }]}>
          <CheckCircle2 size={16} color={c.success} />
          <Text size="sm" color="success" style={styles.flex}>
            Looks good — ready to submit.
          </Text>
          {updating ? <ActivityIndicator size="small" color={c.muted} accessibilityLabel="Updating preview" /> : null}
        </View>
      )}
    </View>
  );
};

/* -------------------------------- Form -------------------------------- */

const LeaveForm = ({ draft, initialTypeId }: { draft: LeaveRequest | null; initialTypeId?: string }) => {
  const { c } = useTheme();
  const { timeZone } = useAuth();
  const editing = !!draft;
  const today = dateKeyIn(timeZone);
  const types = useActiveLeaveTypes();
  const save = useSaveLeave();
  const [file, setFile] = useState<UploadFile | null>(null);
  const [uploaded, setUploaded] = useState<{ uri: string; id: string } | null>(null);
  const [existing, setExisting] = useState<LeaveAttachment | null>(() => (draft ? attachmentOf(draft) : null));
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'submit' | 'draft' | null>(null);

  const { control, handleSubmit, setValue, getValues, setError, formState } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(leaveRequestSchema),
    defaultValues: defaults(draft, initialTypeId),
  });
  const values = useWatch({ control });

  const year = values.startDate && /^\d{4}/.test(values.startDate) ? Number(values.startDate.slice(0, 4)) : Number(today.slice(0, 4));
  const balances = useLeaveBalances({ year });
  const remainingByType = useMemo(() => new Map((balances.data ?? []).map((b) => [b.leaveType._id, b.remaining])), [balances.data]);

  // Offer the types that apply to the employee (those with a balance row), plus the selected one.
  const typeOptions = useMemo(() => {
    const all = types.data ?? [];
    if (!balances.data?.length) return all;
    const applicable = all.filter((t) => remainingByType.has(t._id) || t._id === values.leaveTypeId);
    return applicable.length ? applicable : all;
  }, [types.data, balances.data, remainingByType, values.leaveTypeId]);
  const selectedType = (types.data ?? []).find((t) => t._id === values.leaveTypeId);

  const singleDay = !!values.startDate && (!values.endDate || values.startDate === values.endDate);
  const halfDayAvailable = !!selectedType?.halfDayAllowed && singleDay;
  const halfDay = !!values.halfDay && halfDayAvailable;

  /* ---------------- Live preview (debounced by a stable string key) --------------- */
  const previewKey = useMemo(() => {
    const { leaveTypeId, startDate, endDate, halfDaySession } = values;
    if (!leaveTypeId || !startDate || !endDate || endDate < startDate) return '';
    const body: LeavePreviewInput = {
      leaveTypeId,
      startDate,
      endDate,
      halfDay,
      halfDaySession: halfDay ? (halfDaySession ?? 'FIRST_HALF') : undefined,
      // The reason does not affect days or balance, so typing it does not re-run the preview.
      attachmentId: existing?._id,
      excludeId: draft?._id,
    };
    return JSON.stringify(body);
  }, [values, halfDay, existing, draft]);
  const debouncedKey = useDebouncedValue(previewKey, 400);
  const previewBody = useMemo(() => (debouncedKey ? (JSON.parse(debouncedKey) as LeavePreviewInput) : null), [debouncedKey]);
  const preview = useLeavePreview(previewBody);
  const previewCurrent = debouncedKey === previewKey;

  const warnings = useMemo(
    () => (preview.data?.warnings ?? []).filter((w) => !(w.code === 'DOCUMENT_REQUIRED' && file)),
    [preview.data, file],
  );
  const blockingSubmit = previewCurrent && !!preview.data && warnings.length > 0;
  const blockingDraft = previewCurrent && !!preview.data && warnings.some((w) => !DRAFT_TOLERATED.has(w.code));

  /* ----------------------------- Attachment ----------------------------- */
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
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.75, allowsEditing: false };
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      const asset = result.canceled ? undefined : result.assets[0];
      if (!asset) return;
      if (asset.fileSize && asset.fileSize > MAX_BYTES) {
        toast.error('That file is too large', 'Attachments can be up to 10 MB.');
        return;
      }
      const type = asset.mimeType ?? 'image/jpeg';
      const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
      setFile({ uri: asset.uri, name: asset.fileName ?? `leave-document-${Date.now()}.${ext}`, type });
    } catch (err) {
      toast.error('Could not attach the photo', toApiError(err).message);
    }
  };

  const uploadAttachment = async () => {
    if (!file) return existing?._id ?? null;
    if (uploaded?.uri === file.uri) return uploaded.id;
    const id = await uploadLeaveAttachment(file);
    setUploaded({ uri: file.uri, id });
    return id;
  };

  /* ----------------------------- Submit ----------------------------- */
  const run = (mode: 'submit' | 'draft') =>
    handleSubmit(async (v) => {
      setServerError(null);
      setBusy(mode);
      try {
        const attachmentId = await uploadAttachment();
        const isHalf = !!v.halfDay && v.startDate === v.endDate;
        const session = isHalf ? (v.halfDaySession ?? 'FIRST_HALF') : undefined;
        const res = draft
          ? await save.mutateAsync({
              mode: 'update',
              id: draft._id,
              submit: mode === 'submit',
              input: {
                leaveTypeId: v.leaveTypeId,
                startDate: v.startDate,
                endDate: v.endDate,
                halfDay: isHalf,
                halfDaySession: session ?? null,
                reason: v.reason,
                attachmentId,
              },
            })
          : await save.mutateAsync({
              mode: 'create',
              input: {
                leaveTypeId: v.leaveTypeId,
                startDate: v.startDate,
                endDate: v.endDate,
                halfDay: isHalf,
                halfDaySession: session,
                reason: v.reason,
                attachmentId: attachmentId ?? undefined,
                saveAsDraft: mode === 'draft',
              },
            });
        toast.success(
          mode === 'draft' ? 'Draft saved' : 'Leave request submitted',
          mode === 'draft' ? 'Submit it when you are ready.' : 'Your approver has been notified.',
        );
        if (draft && router.canGoBack()) router.back();
        else router.replace({ pathname: '/leave/[id]', params: { id: res.data._id } });
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
        setBusy(null);
      }
    })();

  const typeError = formState.errors.leaveTypeId?.message;

  return (
    <Screen
      keyboard
      header={
        <Header
          title={editing ? 'Edit draft' : 'Apply for leave'}
          subtitle={editing ? 'Update, then save or submit' : 'Your approver is notified when you submit'}
          back
          backTo="/leave"
        />
      }
      footer={
        <View style={styles.footer}>
          {blockingSubmit ? (
            <Text size="xs" color="muted" align="center">
              {blockingDraft ? 'Resolve the issues above to continue.' : 'Resolve the issues above to submit — you can still save a draft.'}
            </Text>
          ) : null}
          <View style={styles.row}>
            <Button
              variant="outline"
              icon={FileText}
              style={styles.flex}
              loading={busy === 'draft'}
              disabled={!!busy || blockingDraft}
              onPress={() => void run('draft')}
            >
              Save draft
            </Button>
            <Button
              icon={Send}
              style={styles.flex}
              loading={busy === 'submit'}
              disabled={!!busy || blockingSubmit}
              onPress={() => void run('submit')}
            >
              Submit
            </Button>
          </View>
        </View>
      }
    >
      {serverError ? <Notice tone="danger">{serverError}</Notice> : null}

      <Card style={styles.form}>
        {types.isLoading ? (
          <Skeleton height={48} />
        ) : types.error ? (
          <ErrorState compact title="Could not load leave types" error={types.error} onRetry={() => void types.refetch()} />
        ) : typeOptions.length === 0 ? (
          <Notice tone="info" icon={Info}>
            No leave types are configured yet. Ask HR to set up leave policies.
          </Notice>
        ) : (
          <Controller
            control={control}
            name="leaveTypeId"
            render={({ field }) => (
              <Select
                label="Leave type"
                required
                value={field.value}
                placeholder="Choose a leave type"
                options={typeOptions.map((t) => {
                  const remaining = remainingByType.get(t._id);
                  return {
                    value: t._id,
                    label: t.name,
                    description: !t.paid
                      ? 'Unpaid'
                      : remaining !== undefined
                        ? `${formatNum(remaining)} day${remaining === 1 ? '' : 's'} left`
                        : `${formatNum(t.annualAllowance)} days / year`,
                  };
                })}
                onChange={(id) => {
                  field.onChange(id);
                  const next = (types.data ?? []).find((t) => t._id === id);
                  if (!next?.halfDayAllowed) setValue('halfDay', false);
                }}
                error={typeError === 'Invalid identifier' ? 'Choose a leave type' : typeError}
                hint={(() => {
                  if (!selectedType || !selectedType.paid) return undefined;
                  const r = remainingByType.get(selectedType._id);
                  return r !== undefined ? `${formatNum(r)} day${r === 1 ? '' : 's'} remaining in ${year}` : undefined;
                })()}
              />
            )}
          />
        )}
        {selectedType && policyNotes(selectedType).length > 0 ? (
          <View style={styles.badges} accessibilityLabel={`Policy: ${policyNotes(selectedType).join('. ')}`} accessible>
            {policyNotes(selectedType).map((n) => (
              <Badge key={n} tone="gray" icon={Info}>
                {n}
              </Badge>
            ))}
          </View>
        ) : null}

        <View style={styles.row}>
          <View style={styles.flex}>
            <Controller
              control={control}
              name="startDate"
              render={({ field, fieldState }) => (
                <DateField
                  label="From"
                  required
                  value={field.value}
                  onChange={(start) => {
                    field.onChange(start);
                    const end = getValues('endDate');
                    const nextEnd = !end || end < start ? start : end;
                    if (nextEnd !== end) setValue('endDate', nextEnd, { shouldValidate: formState.isSubmitted });
                    if (nextEnd !== start) setValue('halfDay', false);
                  }}
                  error={fieldState.error?.message}
                />
              )}
            />
          </View>
          <View style={styles.flex}>
            <Controller
              control={control}
              name="endDate"
              render={({ field, fieldState }) => (
                <DateField
                  label="To"
                  required
                  value={field.value}
                  minimumDate={values.startDate || undefined}
                  onChange={(end) => {
                    field.onChange(end);
                    if (end !== getValues('startDate')) setValue('halfDay', false);
                  }}
                  error={fieldState.error?.message}
                />
              )}
            />
          </View>
        </View>

        {halfDayAvailable ? (
          <View style={[styles.halfDay, { borderColor: c.line }]}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text weight="medium">Half day</Text>
                <Text size="xs" color="muted">
                  Counts as 0.5 day
                </Text>
              </View>
              <Controller
                control={control}
                name="halfDay"
                render={({ field }) => (
                  <Switch
                    value={!!field.value}
                    onValueChange={field.onChange}
                    accessibilityLabel="Half day"
                    trackColor={{ false: c.lineStrong, true: c.primary }}
                    thumbColor="#ffffff"
                    ios_backgroundColor={c.lineStrong}
                  />
                )}
              />
            </View>
            {halfDay ? (
              <Controller
                control={control}
                name="halfDaySession"
                render={({ field }) => (
                  <Segmented<HalfDaySession>
                    value={field.value === 'SECOND_HALF' ? 'SECOND_HALF' : 'FIRST_HALF'}
                    options={SESSIONS}
                    onChange={field.onChange}
                    accessibilityLabel="Half-day session"
                  />
                )}
              />
            ) : null}
          </View>
        ) : null}
        {formState.errors.halfDay?.message ? (
          <Text size="sm" color="danger" accessibilityRole="alert">
            {formState.errors.halfDay.message}
          </Text>
        ) : null}

        <PreviewPanel
          ready={!!previewKey}
          preview={preview.data}
          loading={preview.isLoading || (!preview.data && !!previewKey && !previewCurrent)}
          updating={preview.isFetching || !previewCurrent}
          error={preview.error}
          warnings={warnings}
        />

        <Controller
          control={control}
          name="reason"
          render={({ field, fieldState }) => (
            <TextField
              label="Reason"
              required
              multiline
              maxLength={1000}
              placeholder="Briefly describe the reason for your leave"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        <Field
          label={selectedType?.documentRequired ? 'Supporting document' : 'Attachment (optional)'}
          hint={
            selectedType?.documentRequired
              ? selectedType.documentRequiredAfterDays > 0
                ? `Required when leave exceeds ${selectedType.documentRequiredAfterDays} day(s). Photo of the document, max 10 MB.`
                : 'Required for this leave type. Photo of the document, max 10 MB.'
              : 'For example a medical certificate. Photo of the document, max 10 MB.'
          }
        >
          {file ? (
            <View style={[styles.attachment, { borderColor: c.line, backgroundColor: c.surface2 }]}>
              <Image source={{ uri: file.uri }} style={styles.thumb} accessibilityIgnoresInvertColors />
              <Text size="sm" numberOfLines={1} style={styles.flex}>
                {file.name}
              </Text>
              <IconButton icon={Trash2} color={c.danger} onPress={() => setFile(null)} accessibilityLabel="Remove attachment" />
            </View>
          ) : existing ? (
            <View style={styles.existing}>
              <View style={styles.flex}>
                <AttachmentRow fileId={existing._id} name={existing.originalName ?? existing.title} size={existing.size} mimeType={existing.mimeType} />
              </View>
              <IconButton icon={Trash2} color={c.danger} onPress={() => setExisting(null)} accessibilityLabel="Remove attachment" />
            </View>
          ) : (
            <View style={styles.row}>
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

/* ------------------------------- Screen ------------------------------- */

export const ApplyLeaveScreen = () => {
  const params = useLocalSearchParams<{ draftId?: string; typeId?: string }>();
  const draftId = typeof params.draftId === 'string' && /^[a-f\d]{24}$/i.test(params.draftId) ? params.draftId : undefined;
  const typeId = typeof params.typeId === 'string' && /^[a-f\d]{24}$/i.test(params.typeId) ? params.typeId : undefined;
  const { hasEmployee } = useAuth();
  const draft = useLeave(draftId);

  if (!hasEmployee) {
    return (
      <Screen header={<Header title="Apply for leave" back backTo="/leave" />}>
        <Notice tone="info" icon={Info}>
          Your account is not linked to an employee profile, so you cannot apply for leave. Contact HR if this is unexpected.
        </Notice>
      </Screen>
    );
  }

  if (draftId) {
    if (draft.isLoading) {
      return (
        <Screen header={<Header title="Edit draft" back backTo="/leave" />}>
          <Card style={styles.form}>
            <Skeleton height={48} />
            <Skeleton height={48} />
            <Skeleton height={96} />
          </Card>
        </Screen>
      );
    }
    if (draft.error || !draft.data) {
      return (
        <Screen header={<Header title="Edit draft" back backTo="/leave" />}>
          <Card>
            <ErrorState
              title="Could not load this draft"
              error={draft.error}
              onRetry={draft.error instanceof ApiError && draft.error.status === 404 ? undefined : () => void draft.refetch()}
            />
          </Card>
        </Screen>
      );
    }
    if (draft.data.status !== 'DRAFT') {
      return (
        <Screen header={<Header title="Edit draft" back backTo="/leave" />}>
          <Notice tone="info" icon={Info}>
            Only drafts can be edited. This request has already been submitted.
          </Notice>
        </Screen>
      );
    }
    return <LeaveForm key={draft.data._id} draft={draft.data} />;
  }
  return <LeaveForm draft={null} initialTypeId={typeId} />;
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: space(4) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  footer: { gap: space(2) },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5) },
  halfDay: { borderWidth: 1, borderRadius: radius.md, padding: space(3), gap: space(3) },
  previewHint: { flexDirection: 'row', gap: space(3), borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.md, padding: space(4) },
  preview: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  previewStats: { flexDirection: 'row' },
  previewStat: { flex: 1, padding: space(4), gap: 2 },
  previewDivider: { width: StyleSheet.hairlineWidth * 2 },
  previewSection: { borderTopWidth: StyleSheet.hairlineWidth * 2, padding: space(3), gap: space(2) },
  previewOk: { borderTopWidth: StyleSheet.hairlineWidth * 2, flexDirection: 'row', alignItems: 'center', gap: space(2), padding: space(3) },
  holiday: { maxWidth: '100%', borderWidth: 1, borderRadius: radius.sm - 2, paddingHorizontal: space(2), paddingVertical: 2 },
  attachment: { flexDirection: 'row', alignItems: 'center', gap: space(3), borderWidth: 1, borderRadius: radius.md, paddingLeft: space(2) },
  existing: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  thumb: { width: 40, height: 40, borderRadius: radius.sm },
});
