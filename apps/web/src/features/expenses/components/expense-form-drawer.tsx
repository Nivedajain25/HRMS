import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Eye, FileText, Send } from 'lucide-react';
import { EXPENSE_CATEGORIES, expenseSchema } from '@stencil/shared';
import { EmployeePicker, FileUpload } from '@/components/common/controls';
import { applyServerErrors, FormError, FormField, FormGrid } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Drawer } from '@/components/ui/overlay';
import { openFile, post, toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { apiDateKey, formatBytes, toDateKey } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { MAX_RECEIPT_MB, RECEIPT_ACCEPT, RECEIPT_MIME_TYPES, uploadReceipt, useSaveExpense, type ExpenseDetail } from '../api';

type Values = z.input<typeof expenseSchema>;
type Output = z.output<typeof expenseSchema>;

const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AED', 'SGD', 'AUD', 'CAD', 'JPY', 'CHF'];

const toForm = (currency: string, e?: ExpenseDetail | null): Values => ({
  category: (e?.category as Values['category']) ?? 'TRAVEL',
  // Blank coerces to 0 and fails with "Amount must be positive".
  amount: e?.amount ?? '',
  currency: e?.currency ?? currency,
  date: apiDateKey(e?.date) || toDateKey(new Date()),
  description: e?.description ?? '',
  merchant: e?.merchant ?? '',
  project: e?.project ?? '',
  employeeId: '',
});

/** Thumbnail for a freshly picked image (phone photo) before upload. */
const LocalImagePreview = ({ file }: { file: File }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url ? <img src={url} alt="Selected receipt" className="mt-2 max-h-48 w-full rounded-lg border border-line bg-surface-2 object-contain" /> : null;
};

export const ExpenseFormDrawer = ({ open, onClose, expense }: { open: boolean; onClose: (saved?: ExpenseDetail) => void; expense?: ExpenseDetail | null }) => {
  const editing = !!expense;
  const { can, user, hasEmployee } = usePermissions();
  const orgCurrency = user?.organization.currency ?? 'USD';
  const canOnBehalf = can('expense:create') && !editing;
  const save = useSaveExpense(expense?._id);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [intent, setIntent] = useState<'draft' | 'submit' | null>(null);
  /** Avoids re-uploading the same receipt when a save is retried. */
  const uploaded = useRef(new Map<File, string>());

  const form = useForm<Values, unknown, Output>({ resolver: zodResolver(expenseSchema), defaultValues: toForm(orgCurrency, expense) });
  const { register, control, handleSubmit, reset, formState, setError } = form;
  const errors = formState.errors;

  useEffect(() => {
    if (!open) return;
    reset(toForm(orgCurrency, expense));
    setFile(null);
    setFileError(null);
    setServerError(null);
  }, [open, expense, orgCurrency, reset]);

  const currencies = useMemo(() => {
    const list = [orgCurrency, expense?.currency, ...COMMON_CURRENCIES].filter((c): c is string => !!c);
    return [...new Set(list)].map((c) => ({ value: c, label: c }));
  }, [orgCurrency, expense?.currency]);

  const pickFile = (f: File | null) => {
    setFileError(null);
    if (f && f.type && !RECEIPT_MIME_TYPES.includes(f.type)) {
      setFileError('Use a PDF, JPG, PNG or WebP file. On iPhone, set Camera › Formats to "Most Compatible" if photos are HEIC.');
      return;
    }
    setFile(f);
  };

  const persist = (submit: boolean) =>
    handleSubmit(async (values) => {
      setServerError(null);
      setIntent(submit ? 'submit' : 'draft');
      try {
        let receiptFileId: string | undefined;
        if (file) {
          receiptFileId = uploaded.current.get(file);
          if (!receiptFileId) {
            receiptFileId = await uploadReceipt(file);
            uploaded.current.set(file, receiptFileId);
          }
        }
        const base = {
          category: values.category,
          amount: values.amount,
          currency: values.currency,
          date: values.date,
          description: values.description,
          merchant: values.merchant ?? '',
          project: values.project ?? '',
          ...(receiptFileId ? { receiptFileId } : {}),
        };
        let saved: ExpenseDetail;
        if (editing && expense) {
          saved = (await save.mutateAsync(base)).data;
          if (submit) saved = (await post<ExpenseDetail>(`/expenses/${expense._id}/submit`, {})).data;
        } else {
          const payload: Record<string, unknown> = { ...base, submit };
          if (!payload.merchant) delete payload.merchant;
          if (!payload.project) delete payload.project;
          if (canOnBehalf && values.employeeId) payload.employeeId = values.employeeId;
          saved = (await save.mutateAsync(payload)).data;
        }
        toast.success(submit ? `${saved.expenseNumber} submitted for approval` : `${saved.expenseNumber} saved as draft`);
        onClose(saved);
      } catch (err) {
        setServerError(applyServerErrors(toApiError(err), setError, ['category', 'amount', 'currency', 'date', 'description', 'merchant', 'project', 'employeeId']));
      } finally {
        setIntent(null);
      }
    })();

  const busy = formState.isSubmitting;
  const existingReceipt = expense?.receiptFileId;

  return (
    <Drawer
      open={open}
      onClose={() => onClose()}
      title={editing ? `Edit ${expense?.expenseNumber}` : 'New expense'}
      description={editing ? 'Drafts can be edited until they are submitted.' : 'Claim a business expense. Attach the receipt for faster approval.'}
      footer={
        <>
          <Button variant="outline" onClick={() => onClose()} disabled={busy}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => void persist(false)} loading={busy && intent === 'draft'} disabled={busy}>
            Save draft
          </Button>
          <Button onClick={() => void persist(true)} loading={busy && intent === 'submit'} disabled={busy} icon={<Send className="h-4 w-4" />}>
            Submit
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void persist(true);
        }}
        noValidate
        className="space-y-5"
      >
        <FormError error={serverError} />
        {canOnBehalf && (
          <FormField label="Employee" error={errors.employeeId} hint={hasEmployee ? 'Leave empty to claim for yourself.' : 'Select who this expense belongs to.'}>
            {({ id, invalid }) => (
              <Controller
                control={control}
                name="employeeId"
                render={({ field }) => <EmployeePicker id={id} invalid={invalid} value={(field.value as string | undefined) || null} onChange={(v) => field.onChange(typeof v === 'string' ? v : '')} />}
              />
            )}
          </FormField>
        )}
        <FormGrid>
          <FormField label="Category" required error={errors.category}>
            {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: label(c) }))} {...register('category')} />}
          </FormField>
          <FormField label="Date" required error={errors.date}>
            {({ id, invalid }) => <Input id={id} type="date" max={toDateKey(new Date())} aria-invalid={invalid} {...register('date')} />}
          </FormField>
          <FormField label="Amount" required error={errors.amount}>
            {({ id, invalid }) => (
              <Input id={id} type="number" inputMode="decimal" min={0} step="0.01" placeholder="0.00" aria-invalid={invalid} {...register('amount')} />
            )}
          </FormField>
          <FormField label="Currency" required error={errors.currency}>
            {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={currencies} {...register('currency')} />}
          </FormField>
          <FormField label="Merchant" error={errors.merchant}>
            {({ id, invalid }) => <Input id={id} maxLength={120} autoComplete="off" placeholder="e.g. Uber, Marriott" aria-invalid={invalid} {...register('merchant')} />}
          </FormField>
          <FormField label="Project / cost center" error={errors.project}>
            {({ id, invalid }) => <Input id={id} maxLength={120} autoComplete="off" aria-invalid={invalid} {...register('project')} />}
          </FormField>
        </FormGrid>
        <FormField label="Description" required error={errors.description}>
          {({ id, invalid }) => <Textarea id={id} rows={3} maxLength={1000} placeholder="Business purpose, e.g. client visit to Acme, Mumbai" aria-invalid={invalid} {...register('description')} />}
        </FormField>

        <FormField label="Receipt" error={fileError ?? undefined} hint={`Photo or PDF · JPG, PNG, WebP or PDF · max ${MAX_RECEIPT_MB} MB`}>
          {({ id }) => (
            <div>
              {existingReceipt && !file && (
                <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                    <span className="truncate font-medium">{existingReceipt.originalName}</span>
                    <span className="shrink-0 text-muted">{formatBytes(existingReceipt.size)}</span>
                  </span>
                  <Button variant="ghost" size="icon-sm" aria-label="Preview current receipt" onClick={() => void openFile(`/files/${existingReceipt._id}`).catch((err) => toast.error(toApiError(err).message))}>
                    <Eye className="h-4 w-4" />
                  </Button>
                </div>
              )}
              <FileUpload
                id={id}
                file={file}
                onFile={pickFile}
                accept={RECEIPT_ACCEPT}
                maxMb={MAX_RECEIPT_MB}
                label={existingReceipt ? 'Replace receipt' : 'Add receipt photo or PDF'}
                hint={`Tap to take a photo or choose a file · max ${MAX_RECEIPT_MB} MB`}
              />
              {file && file.type.startsWith('image/') && <LocalImagePreview file={file} />}
            </div>
          )}
        </FormField>
      </form>
    </Drawer>
  );
};
