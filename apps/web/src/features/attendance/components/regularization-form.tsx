import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { History } from 'lucide-react';
import { regularizationSchema } from '@stencil/shared';
import { FileUpload } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { applyServerErrors, FormError, FormField, FormGrid } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { useAttendanceList, useSubmitRegularization } from '../api';
import { dateKeyIn, formatTimeIn, timeValueIn, useOrgTimezone } from '../lib';

type Values = z.input<typeof regularizationSchema>;

export const RegularizationFormModal = ({ open, onClose, initialDate }: { open: boolean; onClose: () => void; initialDate?: string }) => {
  const timeZone = useOrgTimezone();
  const today = dateKeyIn(timeZone);
  const submit = useSubmitRegularization();
  const [file, setFile] = useState<File | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(regularizationSchema) });
  const { register, handleSubmit, reset, formState, setError, watch, setValue, getValues } = form;
  const errors = formState.errors;
  const date = watch('date');
  const validDate = !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;

  const existing = useAttendanceList({ scope: 'me', from: date, to: date, limit: 1 }, open && validDate);
  const record = validDate ? existing.data?.data[0] : undefined;

  useEffect(() => {
    if (open) {
      setServerError(null);
      setFile(null);
      reset({ date: initialDate && initialDate <= today ? initialDate : today, requestedCheckIn: '', requestedCheckOut: '', reason: '' });
    }
  }, [open, initialDate, reset, today]);

  // Prefill the times from the existing record when the fields are still empty.
  useEffect(() => {
    if (!record) return;
    if (!getValues('requestedCheckIn') && record.checkIn) setValue('requestedCheckIn', timeValueIn(record.checkIn, timeZone));
    if (!getValues('requestedCheckOut') && record.checkOut) setValue('requestedCheckOut', timeValueIn(record.checkOut, timeZone));
  }, [record, getValues, setValue, timeZone]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await submit.mutateAsync({ input: regularizationSchema.parse(values), file });
      toast.success(res.message ?? 'Correction request submitted');
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, ['date', 'requestedCheckIn', 'requestedCheckOut', 'reason']));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request attendance correction"
      description={`Times are in ${timeZone}. Your request goes through the approval chain.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            Submit request
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError error={serverError} />
        <FormField label="Date" required error={errors.date}>
          {({ id, invalid }) => <Input id={id} type="date" max={today} aria-invalid={invalid} {...register('date')} />}
        </FormField>
        {validDate && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg-2">
            <History className="h-4 w-4 text-muted" aria-hidden />
            {existing.isLoading ? (
              <span className="text-muted">Checking recorded attendance…</span>
            ) : record ? (
              <>
                <span>
                  Recorded: <span className="font-medium tabular-nums text-fg">{formatTimeIn(record.checkIn, timeZone)}</span> –{' '}
                  <span className="font-medium tabular-nums text-fg">{formatTimeIn(record.checkOut, timeZone)}</span>
                </span>
                <StatusBadge status={record.status} />
              </>
            ) : (
              <span className="text-muted">No attendance recorded for this date.</span>
            )}
          </div>
        )}
        <FormGrid>
          <FormField label="Check-in" required error={errors.requestedCheckIn}>
            {({ id, invalid }) => <Input id={id} type="time" aria-invalid={invalid} {...register('requestedCheckIn')} />}
          </FormField>
          <FormField label="Check-out" required error={errors.requestedCheckOut}>
            {({ id, invalid }) => <Input id={id} type="time" aria-invalid={invalid} {...register('requestedCheckOut')} />}
          </FormField>
        </FormGrid>
        <FormField label="Reason" required error={errors.reason}>
          {({ id, invalid }) => <Textarea id={id} rows={3} maxLength={1000} placeholder="e.g. Forgot to clock out after the client meeting" aria-invalid={invalid} {...register('reason')} />}
        </FormField>
        <FormField label="Attachment" hint="Optional proof such as a gate log or email (PDF or image, max 10 MB).">
          {({ id }) => <FileUpload id={id} file={file} onFile={setFile} accept=".pdf,.png,.jpg,.jpeg,.webp" label="Attach a file" />}
        </FormField>
      </form>
    </Modal>
  );
};
