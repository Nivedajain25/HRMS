import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { addDays, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { EXIT_TYPES, offboardingCreateSchema } from '@stencil/shared';
import { EmployeePicker } from '@/components/common/controls';
import { applyServerErrors, FormError, FormField, FormGrid } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { DatePicker, Input, Select, Textarea } from '@/components/ui/input';
import { Drawer, useConfirm } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { formatDate, toDateKey } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useEmployee, useMyEmployee } from '@/features/employees/api';
import { useCreateOffboarding, type OffboardingCreateInput, type OffboardingDetail } from '../api';
import { todayKey } from './lifecycle-ui';

const plusDays = (key: string, days: number) => toDateKey(addDays(parseISO(key), days));

interface FormValues {
  employeeId: string;
  exitType: OffboardingCreateInput['exitType'];
  reason: string;
  requestDate: string;
  lastWorkingDate: string;
}

/**
 * Starts an offboarding (HR) or submits the signed-in employee's own
 * resignation (`mode="resign"`: employee and exit type are locked).
 */
export const OffboardingFormDrawer = ({ open, mode, onClose }: { open: boolean; mode: 'start' | 'resign'; onClose: (created?: OffboardingDetail) => void }) => {
  const resign = mode === 'resign';
  const { user } = usePermissions();
  const create = useCreateOffboarding();
  const confirm = useConfirm();
  const [serverError, setServerError] = useState<string | null>(null);
  const me = useMyEmployee();

  const defaults = (): FormValues => ({
    employeeId: resign ? (user?.employeeId ?? '') : '',
    exitType: 'RESIGNATION',
    reason: '',
    requestDate: todayKey(),
    lastWorkingDate: '',
  });

  const form = useForm<FormValues>({ resolver: zodResolver(offboardingCreateSchema), defaultValues: defaults() });
  const { control, register, handleSubmit, reset, setError, setValue, getFieldState, formState } = form;
  const errors = formState.errors;
  const employeeId = useWatch({ control, name: 'employeeId' });
  const requestDate = useWatch({ control, name: 'requestDate' });
  const selected = useEmployee(!resign && open && employeeId ? employeeId : undefined);
  const noticeDays = resign ? me.data?.noticePeriodDays : selected.data?.noticePeriodDays;

  useEffect(() => {
    if (open) {
      reset(defaults());
      setServerError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset]);

  // Suggest the last working day from the notice period until the user edits it.
  useEffect(() => {
    if (!open || noticeDays === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(requestDate) || getFieldState('lastWorkingDate').isDirty) return;
    setValue('lastWorkingDate', plusDays(requestDate, noticeDays), { shouldValidate: formState.isSubmitted });
  }, [open, noticeDays, requestDate, getFieldState, setValue, formState.isSubmitted]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    if (resign) {
      const { confirmed } = await confirm({
        title: 'Submit your resignation?',
        message: `HR and your manager will be notified. Your requested last working day is ${formatDate(values.lastWorkingDate)}. You can withdraw it until the asset return step begins.`,
        confirmLabel: 'Submit resignation',
        tone: 'primary',
      });
      if (!confirmed) return;
    }
    try {
      const res = await create.mutateAsync(resign ? { ...values, employeeId: user?.employeeId ?? '', exitType: 'RESIGNATION' } : values);
      toast.success(resign ? 'Resignation submitted' : (res.message ?? 'Offboarding started'));
      onClose(res.data);
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError));
    }
  });

  return (
    <Drawer
      open={open}
      onClose={() => onClose()}
      title={resign ? 'Resign' : 'Start offboarding'}
      description={
        resign
          ? 'Submit your resignation. HR will guide you through the notice period, asset return and clearance.'
          : 'Moves the employee to their notice period and starts the exit workflow.'
      }
      footer={
        <>
          <Button variant="outline" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            {resign ? 'Submit resignation' : 'Start offboarding'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError error={serverError} />
        {!resign && (
          <FormField label="Employee" required error={errors.employeeId}>
            {({ id, invalid }) => (
              <Controller
                control={control}
                name="employeeId"
                render={({ field }) => <EmployeePicker id={id} invalid={invalid} value={field.value || null} onChange={(v) => field.onChange(typeof v === 'string' ? v : '')} />}
              />
            )}
          </FormField>
        )}
        <FormField label="Exit type" required={!resign} error={errors.exitType} hint={resign ? 'Employees can only submit a resignation.' : undefined}>
          {({ id, invalid }) =>
            resign ? (
              <Input id={id} readOnly value={label('RESIGNATION')} className="bg-surface-2" />
            ) : (
              <Select id={id} aria-invalid={invalid} options={EXIT_TYPES.map((t) => ({ value: t, label: label(t) }))} {...register('exitType')} />
            )
          }
        </FormField>
        <FormField label={resign ? 'Reason for resigning' : 'Reason'} required error={errors.reason}>
          {({ id, invalid }) => <Textarea id={id} rows={4} maxLength={2000} aria-invalid={invalid} {...register('reason')} />}
        </FormField>
        <FormGrid>
          <FormField label={resign ? 'Submission date' : 'Request date'} required error={errors.requestDate}>
            {({ id, invalid }) => <DatePicker id={id} aria-invalid={invalid} {...register('requestDate')} />}
          </FormField>
          <FormField
            label="Last working date"
            required
            error={errors.lastWorkingDate}
            hint={noticeDays !== undefined ? `Notice period: ${noticeDays} day${noticeDays === 1 ? '' : 's'}` : undefined}
          >
            {({ id, invalid }) => <DatePicker id={id} aria-invalid={invalid} min={requestDate || undefined} {...register('lastWorkingDate')} />}
          </FormField>
        </FormGrid>
      </form>
    </Drawer>
  );
};
