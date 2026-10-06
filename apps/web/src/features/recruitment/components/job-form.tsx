import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { EMPLOYMENT_TYPES, jobOpeningSchema } from '@stencil/shared';
import { EmployeePicker } from '@/components/common/controls';
import { applyServerErrors, errorAt, FormError, FormField, FormGrid, FormSection } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Drawer } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { apiDateKey, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { toOptions, useAllOf } from '@/features/employees/api';
import { useSaveJob, type JobOpening } from '../api';
import { TagInput } from './shared';

type FormIn = z.input<typeof jobOpeningSchema>;
type FormOut = z.output<typeof jobOpeningSchema>;

const toFormValues = (job: JobOpening | undefined, currency: string): FormIn => ({
  title: job?.title ?? '',
  departmentId: job?.departmentId?._id ?? '',
  designationId: job?.designationId?._id ?? '',
  locationId: job?.locationId?._id ?? '',
  employmentType: (job?.employmentType as FormOut['employmentType']) ?? 'FULL_TIME',
  openings: job?.openings ?? 1,
  experienceMin: job?.experienceMin ?? 0,
  experienceMax: job?.experienceMax ?? 0,
  salaryMin: job?.salaryMin ?? 0,
  salaryMax: job?.salaryMax ?? 0,
  currency: job?.currency || currency,
  skills: job?.skills ?? [],
  description: job?.description ?? '',
  requirements: job?.requirements ?? '',
  status: job?.status ?? 'DRAFT',
  hiringManagerId: job?.hiringManagerId?._id ?? '',
  closingDate: apiDateKey(job?.closingDate),
});

export const JobFormDrawer = ({ open, onClose, job }: { open: boolean; onClose: (saved?: JobOpening) => void; job?: JobOpening }) => {
  const editing = !!job;
  const { user } = usePermissions();
  const orgCurrency = user?.organization.currency ?? 'USD';
  const save = useSaveJob(job?._id);
  const [serverError, setServerError] = useState<string | null>(null);
  const departments = useAllOf('departments');
  const designations = useAllOf('designations');
  const locations = useAllOf('locations');

  const { register, handleSubmit, control, formState, reset, setError } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(jobOpeningSchema),
    defaultValues: toFormValues(job, orgCurrency),
  });
  const errors = formState.errors;

  useEffect(() => {
    if (open) {
      reset(toFormValues(job, orgCurrency));
      setServerError(null);
    }
  }, [open, job, orgCurrency, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const payload: Partial<FormOut> = { ...values, currency: values.currency?.toUpperCase() };
    if (editing) delete payload.status;
    if (!payload.requirements) delete payload.requirements;
    try {
      const res = await save.mutateAsync(payload as FormOut);
      toast.success(res.message ?? (editing ? 'Job opening updated' : 'Job opening created'));
      onClose(res.data);
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError));
    }
  });

  const text = (name: keyof FormIn, lbl: string, opts: { type?: string; required?: boolean; hint?: string; min?: number; step?: string } = {}) => (
    <FormField label={lbl} error={errorAt(errors, name)} required={opts.required} hint={opts.hint}>
      {({ id, invalid }) => <Input id={id} type={opts.type ?? 'text'} min={opts.min} step={opts.step} aria-invalid={invalid} {...register(name)} />}
    </FormField>
  );
  const select = (name: keyof FormIn, lbl: string, options: { value: string; label: string }[], placeholder?: string) => (
    <FormField label={lbl} error={errorAt(errors, name)}>
      {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={options} placeholder={placeholder} {...register(name)} />}
    </FormField>
  );

  return (
    <Drawer
      open={open}
      onClose={() => onClose()}
      title={editing ? `Edit ${job.title}` : 'New job opening'}
      description={editing ? `${job.code} · status changes are made from the job actions` : 'Candidates can be added once the job is open.'}
      width="max-w-3xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            {editing ? 'Save changes' : 'Create job'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-8">
        <FormError error={serverError} />
        <FormSection title="Role">
          <FormGrid>
            <div className="sm:col-span-2">{text('title', 'Job title', { required: true })}</div>
            {select('departmentId', 'Department', toOptions(departments.data), 'None')}
            {select('designationId', 'Designation', toOptions(designations.data), 'None')}
            {select('locationId', 'Location', toOptions(locations.data), 'None')}
            {select('employmentType', 'Employment type', EMPLOYMENT_TYPES.map((t) => ({ value: t, label: label(t) })))}
            {text('openings', 'Openings', { type: 'number', min: 1, required: true })}
            {text('closingDate', 'Closing date', { type: 'date' })}
            <FormField label="Hiring manager" error={errors.hiringManagerId} hint="Hiring managers can see this job and its candidates.">
              {({ id }) => (
                <Controller
                  control={control}
                  name="hiringManagerId"
                  render={({ field }) => (
                    <EmployeePicker
                      id={id}
                      value={(field.value as string | null | undefined) ?? null}
                      onChange={(v) => field.onChange(typeof v === 'string' ? v : '')}
                      selectedLabels={job?.hiringManagerId ? { [job.hiringManagerId._id]: fullName(job.hiringManagerId) } : undefined}
                    />
                  )}
                />
              )}
            </FormField>
            {!editing &&
              select('status', 'Initial status', [
                { value: 'DRAFT', label: 'Draft — not accepting candidates' },
                { value: 'OPEN', label: 'Open — accepting candidates' },
                { value: 'ON_HOLD', label: 'On hold' },
              ])}
          </FormGrid>
        </FormSection>

        <FormSection title="Experience & compensation">
          <FormGrid cols={3}>
            {text('experienceMin', 'Min experience (yrs)', { type: 'number', min: 0, step: '0.5' })}
            {text('experienceMax', 'Max experience (yrs)', { type: 'number', min: 0, step: '0.5', hint: '0 = no upper limit' })}
            {text('currency', 'Currency', { hint: 'ISO code, e.g. INR' })}
            {text('salaryMin', 'Salary from', { type: 'number', min: 0 })}
            {text('salaryMax', 'Salary to', { type: 'number', min: 0 })}
          </FormGrid>
        </FormSection>

        <FormSection title="Details">
          <FormField label="Skills" error={errorAt(errors, 'skills')} hint="Press Enter or comma to add a skill (max 30).">
            {({ id, invalid }) => (
              <Controller control={control} name="skills" render={({ field }) => <TagInput id={id} invalid={invalid} value={(field.value as string[] | undefined) ?? []} onChange={field.onChange} />} />
            )}
          </FormField>
          <FormField label="Description" required error={errors.description}>
            {({ id, invalid }) => <Textarea id={id} rows={6} aria-invalid={invalid} {...register('description')} />}
          </FormField>
          <FormField label="Requirements" error={errors.requirements}>
            {({ id, invalid }) => <Textarea id={id} rows={4} aria-invalid={invalid} {...register('requirements')} />}
          </FormField>
        </FormSection>
      </form>
    </Drawer>
  );
};
