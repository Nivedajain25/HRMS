import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { onboardingStartSchema } from '@stencil/shared';
import { EmployeePicker } from '@/components/common/controls';
import { applyServerErrors, FormError, FormField } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { DatePicker, Select } from '@/components/ui/input';
import { Modal } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { useAllTemplates, useStartOnboarding, type Onboarding, type OnboardingStartInput } from '../api';

/** Starts an onboarding checklist for an employee from a template. */
export const StartOnboardingDialog = ({ open, onClose }: { open: boolean; onClose: (created?: Onboarding) => void }) => {
  const templates = useAllTemplates(open);
  const start = useStartOnboarding();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<OnboardingStartInput>({ resolver: zodResolver(onboardingStartSchema), defaultValues: { employeeId: '', templateId: '', startDate: '' } });
  const { control, register, handleSubmit, reset, setError, setValue, getValues, formState } = form;

  useEffect(() => {
    if (open) {
      reset({ employeeId: '', templateId: '', startDate: '' });
      setServerError(null);
    }
  }, [open, reset]);

  // Preselect the default template once templates load.
  useEffect(() => {
    if (!open || !templates.data?.length || getValues('templateId')) return;
    const preferred = templates.data.find((t) => t.isDefault) ?? templates.data[0];
    if (preferred) setValue('templateId', preferred._id);
  }, [open, templates.data, getValues, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await start.mutateAsync({ ...values, startDate: values.startDate || undefined });
      toast.success(res.message ?? 'Onboarding started');
      onClose(res.data);
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError));
    }
  });

  const noTemplates = templates.isSuccess && templates.data.length === 0;

  return (
    <Modal
      open={open}
      onClose={() => onClose()}
      title="Start onboarding"
      description="Creates a checklist from the template and notifies the employee and their manager."
      footer={
        <>
          <Button variant="outline" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting} disabled={noTemplates}>
            Start onboarding
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError error={serverError} />
        {noTemplates && <FormError error="Create an onboarding template first (Templates tab)." />}
        <FormField label="Employee" required error={formState.errors.employeeId}>
          {({ id, invalid }) => (
            <Controller
              control={control}
              name="employeeId"
              render={({ field }) => <EmployeePicker id={id} invalid={invalid} value={field.value || null} onChange={(v) => field.onChange(typeof v === 'string' ? v : '')} />}
            />
          )}
        </FormField>
        <FormField label="Template" required error={formState.errors.templateId}>
          {({ id, invalid }) => (
            <Select
              id={id}
              aria-invalid={invalid}
              disabled={templates.isLoading}
              placeholder={templates.isLoading ? 'Loading templates…' : 'Select a template'}
              options={(templates.data ?? []).map((t) => ({ value: t._id, label: t.isDefault ? `${t.name} (default)` : t.name }))}
              {...register('templateId')}
            />
          )}
        </FormField>
        <FormField label="Start date" hint="Defaults to the employee's joining date." error={formState.errors.startDate as { message?: string } | undefined}>
          {({ id, invalid }) => <DatePicker id={id} aria-invalid={invalid} {...register('startDate')} />}
        </FormField>
      </form>
    </Modal>
  );
};
