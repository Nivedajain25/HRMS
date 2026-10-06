import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { ClipboardList, PartyPopper, UserRound } from 'lucide-react';
import { EMPLOYMENT_TYPES, hireCandidateSchema } from '@stencil/shared';
import { EmployeePicker } from '@/components/common/controls';
import { applyServerErrors, FormError, FormField, FormGrid, FormSection } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/display';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Drawer, useConfirm } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { fullName } from '@/lib/utils';
import { toOptions, useAllOf } from '@/features/employees/api';
import { useHire, useHirePrefill, useJob, useOnboardingTemplates, type HirePrefill, type HireResult } from '../api';

type HireIn = z.input<typeof hireCandidateSchema>;
type HireOut = z.output<typeof hireCandidateSchema>;

const toValues = (p: HirePrefill | undefined, templateId: string): HireIn => ({
  joiningDate: p?.joiningDate ?? '',
  workEmail: '',
  departmentId: p?.departmentId ?? '',
  designationId: p?.designationId ?? '',
  locationId: p?.locationId ?? '',
  managerId: p?.managerId ?? '',
  employmentType: (p?.employmentType as HireOut['employmentType']) ?? 'FULL_TIME',
  onboardingTemplateId: templateId,
  createUserAccount: true,
});

/**
 * Converts an OFFERED candidate into an employee (user account, leave
 * balances and onboarding are created by the API).
 */
export const HireDrawer = ({ open, onClose, candidateId, candidateName }: { open: boolean; onClose: () => void; candidateId: string; candidateName: string }) => {
  const prefill = useHirePrefill(candidateId, open);
  const templates = useOnboardingTemplates(open);
  const job = useJob(open ? prefill.data?.job._id : undefined);
  const hire = useHire(candidateId);
  const confirm = useConfirm();
  const departments = useAllOf('departments');
  const designations = useAllOf('designations');
  const locations = useAllOf('locations');
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<HireResult | null>(null);

  const defaultTemplate = templates.data?.find((t) => t.isDefault)?._id ?? '';
  const { register, handleSubmit, control, formState, reset, setError } = useForm<HireIn, unknown, HireOut>({
    resolver: zodResolver(hireCandidateSchema),
    defaultValues: toValues(prefill.data, defaultTemplate),
  });
  const errors = formState.errors;

  const initialized = useRef(false);
  useEffect(() => {
    if (open) {
      setServerError(null);
      setResult(null);
    } else {
      initialized.current = false;
    }
  }, [open]);
  // Initialise once per opening, after the pre-fill and templates have loaded.
  useEffect(() => {
    if (!open || initialized.current || !prefill.data || templates.isLoading) return;
    initialized.current = true;
    reset(toValues(prefill.data, defaultTemplate));
  }, [open, prefill.data, templates.isLoading, defaultTemplate, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const { confirmed } = await confirm({
      title: `Hire ${candidateName}?`,
      message: `This creates an employee record${values.createUserAccount ? ', a user account with an invitation' : ''} and starts onboarding. The candidate will be marked as hired.`,
      confirmLabel: 'Hire candidate',
      tone: 'primary',
    });
    if (!confirmed) return;
    const payload: Partial<HireOut> = { ...values };
    if (!payload.onboardingTemplateId) delete payload.onboardingTemplateId;
    try {
      const res = await hire.mutateAsync(payload as HireOut);
      setResult(res.data);
      toast.success(`${candidateName} hired as ${res.data.employee.employeeId}`);
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError));
    }
  });

  const managerLabel =
    job.data?.hiringManagerId && prefill.data?.managerId === job.data.hiringManagerId._id ? { [job.data.hiringManagerId._id]: fullName(job.data.hiringManagerId) } : undefined;
  const p = prefill.data;

  const body = () => {
    if (result) {
      return (
        <EmptyState
          icon={<PartyPopper className="h-6 w-6 text-emerald-600" />}
          title={`${fullName(result.employee)} has been hired`}
          description={`Employee ID ${result.employee.employeeId}.${result.job?.status === 'CLOSED' ? ' All openings for this job are now filled and the job was closed.' : ''}`}
          action={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link to={`/employees/${result.employee._id}`} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
                <UserRound className="h-4 w-4" /> View employee profile
              </Link>
              {result.onboardingId && (
                <Link to={`/onboarding/${result.onboardingId}`} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium text-fg hover:bg-surface-2">
                  <ClipboardList className="h-4 w-4" /> View onboarding
                </Link>
              )}
            </div>
          }
        />
      );
    }
    if (prefill.isLoading) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-40" />
          <Skeleton className="h-24" />
        </div>
      );
    }
    if (prefill.error || !p) return <ErrorState message={prefill.error?.message} onRetry={() => prefill.refetch()} />;
    if (!p.canHire) {
      return (
        <EmptyState
          title="This candidate cannot be hired yet"
          description={`Only candidates in the Offered stage can be hired. ${candidateName} is currently in ${label(p.stage)}.`}
        />
      );
    }
    return (
      <form onSubmit={onSubmit} noValidate className="space-y-8">
        <FormError error={serverError} />
        <div className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm">
          <p className="font-medium text-fg">
            {p.firstName} {p.lastName}
          </p>
          <p className="text-muted">
            {p.job.title} ({p.job.code}) · personal email {p.personalEmail}
            {p.phone ? ` · ${p.phone}` : ''}
          </p>
        </div>
        <FormSection title="Employment" description="Pre-filled from the job opening; adjust as needed.">
          <FormGrid>
            <FormField label="Joining date" required error={errors.joiningDate}>
              {({ id, invalid }) => <Input id={id} type="date" aria-invalid={invalid} {...register('joiningDate')} />}
            </FormField>
            <FormField label="Work email" required error={errors.workEmail} hint="Used to sign in to Stencil.">
              {({ id, invalid }) => <Input id={id} type="email" autoComplete="off" aria-invalid={invalid} {...register('workEmail')} />}
            </FormField>
            <FormField label="Department" error={errors.departmentId}>
              {({ id }) => <Select id={id} options={toOptions(departments.data)} placeholder="None" {...register('departmentId')} />}
            </FormField>
            <FormField label="Designation" error={errors.designationId}>
              {({ id }) => <Select id={id} options={toOptions(designations.data)} placeholder="None" {...register('designationId')} />}
            </FormField>
            <FormField label="Location" error={errors.locationId}>
              {({ id }) => <Select id={id} options={toOptions(locations.data)} placeholder="None" {...register('locationId')} />}
            </FormField>
            <FormField label="Employment type" error={errors.employmentType}>
              {({ id }) => <Select id={id} options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: label(t) }))} {...register('employmentType')} />}
            </FormField>
            <FormField label="Reporting manager" error={errors.managerId}>
              {({ id }) => (
                <Controller
                  control={control}
                  name="managerId"
                  render={({ field }) => (
                    <EmployeePicker id={id} value={(field.value as string | null | undefined) ?? null} onChange={(v) => field.onChange(typeof v === 'string' ? v : '')} selectedLabels={managerLabel} />
                  )}
                />
              )}
            </FormField>
            <FormField label="Onboarding template" error={errors.onboardingTemplateId} hint={templates.data && !templates.data.length ? 'No templates configured — the default checklist is used.' : undefined}>
              {({ id }) => (
                <Select
                  id={id}
                  options={(templates.data ?? []).map((t) => ({ value: t._id, label: t.isDefault ? `${t.name} (default)` : t.name }))}
                  placeholder={templates.isLoading ? 'Loading…' : 'Organization default'}
                  {...register('onboardingTemplateId')}
                />
              )}
            </FormField>
          </FormGrid>
        </FormSection>
        <FormSection title="Access">
          <Checkbox label="Create a user account and email an invitation" description="The new employee sets their own password from the invite link." {...register('createUserAccount')} />
        </FormSection>
      </form>
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={result ? 'Hire complete' : `Hire ${candidateName}`}
      description={result ? undefined : 'Creates the employee, user account and onboarding checklist.'}
      width="max-w-2xl"
      footer={
        result ? (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {p?.canHire && (
              <Button variant="success" onClick={onSubmit} loading={formState.isSubmitting}>
                Hire candidate
              </Button>
            )}
          </>
        )
      }
    >
      {body()}
    </Drawer>
  );
};
