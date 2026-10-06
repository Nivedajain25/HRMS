import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { AlertTriangle, CalendarRange, CheckCircle2, FileText, Info, Loader2, Paperclip, X } from 'lucide-react';
import { leaveRequestSchema, type LeaveRequestInput } from '@stencil/shared';
import { EmployeePicker, FileUpload } from '@/components/common/controls';
import { applyServerErrors, FormError, FormField } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Badge, Skeleton } from '@/components/ui/display';
import { Input, Switch, Textarea } from '@/components/ui/input';
import { Drawer } from '@/components/ui/overlay';
import { useDebounce } from '@/hooks/use-debounce';
import { openFile, toApiError, upload } from '@/lib/api';
import { apiDateKey, cn } from '@/lib/utils';
import { formatKey } from './leave-ui';
import { usePermissions } from '@/store/auth';
import {
  attachmentOf,
  DEFAULT_TYPE_COLOR,
  formatNum,
  leaveActionRequest,
  useActiveLeaveTypes,
  useLeaveBalances,
  useLeavePreview,
  useSaveLeave,
  type LeaveAttachment,
  type LeavePreview,
  type LeaveRequest,
  type LeaveType,
} from '../api';

type FormIn = LeaveRequestInput;
type FormOut = z.output<typeof leaveRequestSchema>;

/** Validation codes the API tolerates when saving a draft (re-checked on submit). */
const DRAFT_TOLERATED = new Set(['INSUFFICIENT_BALANCE', 'DOCUMENT_REQUIRED']);

const defaults = (draft?: LeaveRequest | null, typeId?: string): FormIn => ({
  leaveTypeId: draft?.leaveTypeId?._id ?? typeId ?? '',
  startDate: apiDateKey(draft?.startDate),
  endDate: apiDateKey(draft?.endDate),
  halfDay: draft?.halfDay ?? false,
  halfDaySession: draft?.halfDaySession ?? 'FIRST_HALF',
  reason: draft?.reason ?? '',
  employeeId: '',
});

const policyNotes = (t: LeaveType) => {
  const notes: string[] = [];
  if (!t.paid) notes.push('Unpaid — not limited by balance');
  if (t.minNoticeDays > 0) notes.push(`Apply ${t.minNoticeDays} day${t.minNoticeDays === 1 ? '' : 's'} in advance`);
  if (t.maxConsecutiveDays > 0) notes.push(`Max ${t.maxConsecutiveDays} consecutive day${t.maxConsecutiveDays === 1 ? '' : 's'}`);
  if (t.documentRequired) notes.push(t.documentRequiredAfterDays > 0 ? `Document needed beyond ${t.documentRequiredAfterDays} day${t.documentRequiredAfterDays === 1 ? '' : 's'}` : 'Supporting document required');
  if (!t.halfDayAllowed) notes.push('Full days only');
  return notes;
};

/* ------------------------------ Preview ------------------------------ */

const PreviewPanel = ({
  ready,
  preview,
  loading,
  fetching,
  error,
  warnings,
}: {
  ready: boolean;
  preview?: LeavePreview;
  loading: boolean;
  fetching: boolean;
  error: Error | null;
  warnings: { code: string; message: string }[];
}) => {
  if (!ready) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-dashed border-line-strong p-4 text-sm text-muted">
        <CalendarRange className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Choose a leave type and dates to see working days, excluded holidays and your balance after this request.
      </div>
    );
  }
  if (loading) return <Skeleton className="h-32 rounded-xl" />;
  if (error && !preview) {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        {error.message}
      </div>
    );
  }
  if (!preview) return null;
  const negative = preview.balanceAfter !== null && preview.balanceAfter < 0 && !preview.unlimited;
  return (
    <section aria-label="Leave preview" aria-live="polite" className="overflow-hidden rounded-xl border border-line bg-surface-2">
      <div className="grid grid-cols-2 divide-x divide-line">
        <div className="p-4">
          <p className="text-xs font-medium text-muted">Days requested</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-fg tabular-nums">{formatNum(preview.days)}</p>
          <p className="text-xs text-muted">{preview.days === 1 ? 'working day' : 'working days'}</p>
        </div>
        <div className="p-4">
          <p className="text-xs font-medium text-muted">{preview.unlimited ? 'Balance' : 'Balance after'}</p>
          {preview.unlimited ? (
            <>
              <p className="mt-1 text-base font-semibold text-fg">Unpaid</p>
              <p className="text-xs text-muted">Not deducted from balance</p>
            </>
          ) : preview.balanceAfter === null ? (
            <p className="mt-1 text-base font-semibold text-muted">—</p>
          ) : (
            <>
              <p className={cn('mt-1 text-2xl font-semibold tracking-tight tabular-nums', negative ? 'text-red-600 dark:text-red-400' : 'text-fg')}>{formatNum(preview.balanceAfter)}</p>
              <p className="text-xs text-muted">of {formatNum(preview.balance ?? 0)} available</p>
            </>
          )}
        </div>
      </div>

      {(preview.holidays.length > 0 || preview.weekOffs.length > 0) && (
        <div className="space-y-2 border-t border-line px-4 py-3">
          <p className="text-xs font-medium text-muted">Not counted</p>
          <ul className="flex flex-wrap gap-1.5">
            {preview.holidays.map((h) => (
              <li key={h.date}>
                <Badge tone="purple">
                  {formatKey(h.date, 'dd MMM')} · {h.name}
                </Badge>
              </li>
            ))}
            {preview.weekOffs.slice(0, 8).map((d) => (
              <li key={d}>
                <Badge tone="gray">{formatKey(d, 'EEE dd MMM')} · Week off</Badge>
              </li>
            ))}
            {preview.weekOffs.length > 8 && (
              <li>
                <Badge tone="gray">+{preview.weekOffs.length - 8} week-off days</Badge>
              </li>
            )}
          </ul>
        </div>
      )}

      {warnings.length > 0 ? (
        <ul className="space-y-1.5 border-t border-line bg-amber-50 px-4 py-3 dark:bg-amber-500/10">
          {warnings.map((w) => (
            <li key={w.code + w.message} className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{w.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          Looks good — ready to submit.
          {fetching && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted" aria-label="Updating preview" />}
        </p>
      )}
    </section>
  );
};

/* ------------------------------- Drawer ------------------------------ */

export const ApplyLeaveDrawer = ({
  open,
  onClose,
  draft,
  initialTypeId,
}: {
  open: boolean;
  onClose: (saved?: LeaveRequest) => void;
  /** Editing an existing draft. */
  draft?: LeaveRequest | null;
  initialTypeId?: string;
}) => {
  const editing = !!draft;
  const { can, user } = usePermissions();
  const canOnBehalf = can('leave:create') && !editing;
  const year = new Date().getFullYear();
  const types = useActiveLeaveTypes();
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<{ file: File; id: string } | null>(null);
  const [existing, setExisting] = useState<LeaveAttachment | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'submit' | 'draft' | null>(null);
  const save = useSaveLeave(draft?._id);

  const form = useForm<FormIn, unknown, FormOut>({ resolver: zodResolver(leaveRequestSchema), defaultValues: defaults(draft, initialTypeId) });
  const { register, control, handleSubmit, reset, setValue, setError, formState } = form;
  const errors = formState.errors;
  const values = useWatch({ control });

  useEffect(() => {
    if (!open) return;
    reset(defaults(draft, initialTypeId));
    setFile(null);
    setUploaded(null);
    setExisting(draft ? attachmentOf(draft) : null);
    setServerError(null);
  }, [open, draft, initialTypeId, reset]);

  const forSelf = !values.employeeId;
  const balances = useLeaveBalances({ year, enabled: open && forSelf && !!user?.employeeId });
  const remainingByType = useMemo(() => new Map((balances.data ?? []).map((b) => [b.leaveType._id, b.remaining])), [balances.data]);

  // When applying for self, offer the types that apply to the employee (those with a balance row).
  const typeOptions = useMemo(() => {
    const all = types.data ?? [];
    if (!forSelf || !balances.data?.length) return all;
    const applicable = all.filter((t) => remainingByType.has(t._id) || t._id === values.leaveTypeId);
    return applicable.length ? applicable : all;
  }, [types.data, forSelf, balances.data, remainingByType, values.leaveTypeId]);
  const selectedType = (types.data ?? []).find((t) => t._id === values.leaveTypeId);

  const singleDay = !!values.startDate && (!values.endDate || values.startDate === values.endDate);
  const halfDayAvailable = !!selectedType?.halfDayAllowed && singleDay;

  // Keep the form consistent as the user changes dates / type.
  useEffect(() => {
    if (values.halfDay && !halfDayAvailable) setValue('halfDay', false);
  }, [values.halfDay, halfDayAvailable, setValue]);

  /* ---------------- Live preview (debounced by a stable string key) --------------- */
  const previewBody = useMemo(() => {
    const { leaveTypeId, startDate, endDate } = values;
    if (!leaveTypeId || !startDate || !endDate || endDate < startDate) return '';
    if (!forSelf && !values.employeeId) return '';
    if (forSelf && !user?.employeeId) return '';
    const body: LeaveRequestInput = {
      leaveTypeId,
      startDate,
      endDate,
      halfDay: !!values.halfDay && startDate === endDate,
      halfDaySession: values.halfDay ? (values.halfDaySession ?? 'FIRST_HALF') : undefined,
      // The preview endpoint validates the full request body, including a reason.
      reason: values.reason?.trim() || 'Preview',
      attachmentId: existing?._id,
      employeeId: values.employeeId || undefined,
    };
    return JSON.stringify(body);
  }, [values, forSelf, user?.employeeId, existing]);
  const debouncedBody = useDebounce(previewBody, 350);
  const preview = useLeavePreview(open && debouncedBody ? (JSON.parse(debouncedBody) as LeaveRequestInput) : null);
  const previewCurrent = debouncedBody === previewBody;

  const warnings = useMemo(() => {
    const list = preview.data?.warnings ?? [];
    const ownRange = draft ? `(${apiDateKey(draft.startDate)} to ${apiDateKey(draft.endDate)})` : null;
    return list.filter((w) => {
      if (w.code === 'DOCUMENT_REQUIRED' && file) return false;
      // The preview does not exclude the draft being edited from the overlap check.
      if (w.code === 'LEAVE_OVERLAP' && ownRange && w.message.includes(ownRange)) return false;
      return true;
    });
  }, [preview.data, file, draft]);
  const blockingSubmit = previewCurrent && !!preview.data && warnings.length > 0;
  const blockingDraft = previewCurrent && !!preview.data && warnings.some((w) => !DRAFT_TOLERATED.has(w.code));

  /* ----------------------------- Submit ----------------------------- */
  const uploadAttachment = async () => {
    if (!file) return existing?._id ?? null;
    if (uploaded?.file === file) return uploaded.id;
    const res = await upload<{ _id: string }>('/files', file, { context: 'LEAVE', title: file.name });
    setUploaded({ file, id: res.data._id });
    return res.data._id;
  };

  const run = (mode: 'submit' | 'draft') =>
    handleSubmit(async (v) => {
      setServerError(null);
      setBusy(mode);
      try {
        const attachmentId = await uploadAttachment();
        const halfDay = !!v.halfDay && v.startDate === v.endDate;
        const session = halfDay ? (v.halfDaySession ?? 'FIRST_HALF') : undefined;
        let saved: LeaveRequest;
        if (editing && draft) {
          const res = await save.mutateAsync({
            leaveTypeId: v.leaveTypeId,
            startDate: v.startDate,
            endDate: v.endDate,
            halfDay,
            halfDaySession: session ?? null,
            reason: v.reason,
            attachmentId,
          });
          saved = res.data;
          if (mode === 'submit') saved = (await leaveActionRequest(draft._id, 'submit')).data;
        } else {
          const res = await save.mutateAsync({
            leaveTypeId: v.leaveTypeId,
            startDate: v.startDate,
            endDate: v.endDate,
            halfDay,
            halfDaySession: session,
            reason: v.reason,
            attachmentId: attachmentId ?? undefined,
            employeeId: v.employeeId || undefined,
            saveAsDraft: mode === 'draft',
          });
          saved = res.data;
        }
        toast.success(mode === 'draft' ? 'Draft saved' : 'Leave request submitted', {
          description: mode === 'submit' ? 'Your approver has been notified.' : 'Submit it when you are ready.',
        });
        onClose(saved);
      } catch (err) {
        const apiError = toApiError(err);
        setServerError(applyServerErrors(apiError, setError, ['leaveTypeId', 'startDate', 'endDate', 'halfDay', 'halfDaySession', 'reason', 'employeeId']));
      } finally {
        setBusy(null);
      }
    })();

  return (
    <Drawer
      open={open}
      onClose={() => onClose()}
      title={editing ? 'Edit draft leave request' : 'Apply for leave'}
      description={editing ? 'Update the details, then save or submit for approval.' : 'Your manager is notified as soon as you submit.'}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" className="hidden sm:inline-flex" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className="flex-1 sm:flex-none"
            onClick={() => void run('draft')}
            loading={busy === 'draft'}
            disabled={!!busy || blockingDraft}
            icon={<FileText className="h-4 w-4" />}
          >
            {editing ? 'Save draft' : 'Save as draft'}
          </Button>
          <Button className="flex-1 sm:flex-none" onClick={() => void run('submit')} loading={busy === 'submit'} disabled={!!busy || blockingSubmit}>
            Submit request
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void run('submit');
        }}
      >
        <FormError error={serverError} />

        {canOnBehalf && (
          <FormField
            label="Employee"
            error={errors.employeeId}
            required={!user?.employeeId}
            hint={user?.employeeId ? 'Leave blank to apply for yourself. Notice and backdating limits do not apply on behalf of others.' : 'Select who this leave is for.'}
          >
            {({ id }) => (
              <Controller
                control={control}
                name="employeeId"
                render={({ field }) => <EmployeePicker id={id} value={(field.value as string | undefined) || null} onChange={(v) => field.onChange((v as string | null) ?? '')} placeholder="Myself" />}
              />
            )}
          </FormField>
        )}

        {/* Leave type as radio cards: fast to scan and thumb-friendly on phones. */}
        <fieldset>
          <legend className="mb-2 block text-sm font-medium text-fg">
            Leave type<span className="ml-0.5 text-red-500" aria-hidden>*</span>
          </legend>
          {types.isLoading ? (
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : types.error ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              Could not load leave types. {types.error.message}
            </p>
          ) : !typeOptions.length ? (
            <p className="text-sm text-muted">No leave types are configured yet. Ask HR to set up leave policies.</p>
          ) : (
            <div role="radiogroup" aria-invalid={!!errors.leaveTypeId || undefined} className="grid grid-cols-2 gap-2">
              {typeOptions.map((t) => {
                const checked = values.leaveTypeId === t._id;
                const remaining = forSelf ? remainingByType.get(t._id) : undefined;
                return (
                  <label
                    key={t._id}
                    className={cn(
                      'relative flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-brand-500/40',
                      checked ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-line-strong hover:bg-surface-2',
                    )}
                  >
                    <input type="radio" value={t._id} className="sr-only" {...register('leaveTypeId')} />
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color || DEFAULT_TYPE_COLOR }} aria-hidden />
                      <span className="truncate text-sm font-medium text-fg">{t.name}</span>
                    </span>
                    <span className="text-xs text-muted">
                      {!t.paid ? 'Unpaid' : remaining !== undefined ? `${formatNum(remaining)} day${remaining === 1 ? '' : 's'} left` : `${formatNum(t.annualAllowance)} days / year`}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {errors.leaveTypeId && (
            <p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
              {errors.leaveTypeId.message === 'Invalid identifier' ? 'Choose a leave type' : errors.leaveTypeId.message}
            </p>
          )}
          {selectedType && policyNotes(selectedType).length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Policy for this leave type">
              {policyNotes(selectedType).map((n) => (
                <li key={n} className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-0.5 text-xs text-fg-2">
                  <Info className="h-3 w-3 text-muted" aria-hidden />
                  {n}
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="From" required error={errors.startDate}>
            {({ id, invalid }) => (
              <Input
                id={id}
                type="date"
                aria-invalid={invalid}
                {...register('startDate', {
                  onChange: (e: { target: { value: string } }) => {
                    const start = e.target.value;
                    const end = form.getValues('endDate');
                    if (start && (!end || end < start)) setValue('endDate', start, { shouldValidate: formState.isSubmitted });
                  },
                })}
              />
            )}
          </FormField>
          <FormField label="To" required error={errors.endDate}>
            {({ id, invalid }) => <Input id={id} type="date" min={values.startDate || undefined} aria-invalid={invalid} {...register('endDate')} />}
          </FormField>
        </div>

        {halfDayAvailable && (
          <div className="space-y-3 rounded-xl border border-line p-3">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="leave-half-day" className="text-sm">
                <span className="block font-medium text-fg">Half day</span>
                <span className="block text-xs text-muted">Counts as 0.5 day</span>
              </label>
              <Controller
                control={control}
                name="halfDay"
                render={({ field }) => <Switch id="leave-half-day" checked={!!field.value} onChange={field.onChange} label="Half day" />}
              />
            </div>
            {values.halfDay && (
              <div role="radiogroup" aria-label="Session" className="grid grid-cols-2 gap-2">
                {(['FIRST_HALF', 'SECOND_HALF'] as const).map((s) => (
                  <label
                    key={s}
                    className={cn(
                      'cursor-pointer rounded-lg border px-3 py-2 text-center text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-brand-500/40',
                      values.halfDaySession === s ? 'border-brand-500 bg-brand-50/60 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300' : 'border-line-strong text-fg-2 hover:bg-surface-2',
                    )}
                  >
                    <input type="radio" value={s} className="sr-only" {...register('halfDaySession')} />
                    {s === 'FIRST_HALF' ? 'First half' : 'Second half'}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        {errors.halfDay && (
          <p role="alert" className="-mt-4 text-xs text-red-600 dark:text-red-400">
            {errors.halfDay.message}
          </p>
        )}

        <PreviewPanel
          ready={!!previewBody}
          preview={preview.data}
          loading={preview.isLoading || (!preview.data && !!previewBody && !previewCurrent)}
          fetching={preview.isFetching || !previewCurrent}
          error={preview.error}
          warnings={warnings}
        />

        <FormField label="Reason" required error={errors.reason}>
          {({ id, invalid, describedBy }) => (
            <Textarea id={id} rows={3} maxLength={1000} aria-invalid={invalid} aria-describedby={describedBy} placeholder="Briefly describe the reason for your leave" {...register('reason')} />
          )}
        </FormField>

        <FormField
          label={selectedType?.documentRequired ? 'Supporting document' : 'Attachment (optional)'}
          hint={
            selectedType?.documentRequired
              ? selectedType.documentRequiredAfterDays > 0
                ? `Required when leave exceeds ${selectedType.documentRequiredAfterDays} day(s). PDF or image, max 10 MB.`
                : 'Required for this leave type. PDF or image, max 10 MB.'
              : 'For example a medical certificate. PDF or image, max 10 MB.'
          }
        >
          {({ id }) =>
            existing && !file ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm">
                <button type="button" className="flex min-w-0 items-center gap-2 text-left hover:underline" onClick={() => void openFile(`/files/${existing._id}`)}>
                  <Paperclip className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                  <span className="truncate font-medium">{existing.originalName ?? existing.title ?? 'Attachment'}</span>
                </button>
                <Button variant="ghost" size="icon-sm" aria-label="Remove attachment" onClick={() => setExisting(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <FileUpload id={id} file={file} onFile={setFile} accept=".pdf,.png,.jpg,.jpeg,.webp" label="Upload a document" />
            )
          }
        </FormField>

        {blockingSubmit && (
          <p className="text-xs text-muted">
            Resolve the highlighted issues to submit{blockingDraft ? '.' : ' — you can still save this as a draft.'}
          </p>
        )}
      </form>
    </Drawer>
  );
};
