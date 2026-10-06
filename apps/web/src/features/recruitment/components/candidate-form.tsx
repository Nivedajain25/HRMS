import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FileText } from 'lucide-react';
import { CANDIDATE_SOURCES, candidateSchema } from '@stencil/shared';
import { FileUpload } from '@/components/common/controls';
import { applyServerErrors, errorAt, FormError, FormField, FormGrid, FormSection } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Drawer } from '@/components/ui/overlay';
import { openFile, toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { usePermissions } from '@/store/auth';
import { uploadResume, useJobOptions, useSaveCandidate, type CandidateDetail } from '../api';
import { TagInput } from './shared';

type FormIn = z.input<typeof candidateSchema>;
type FormOut = z.output<typeof candidateSchema>;

const optionalNumber = { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? undefined : Number(v)) };

const toFormValues = (c: CandidateDetail | undefined, jobId?: string): FormIn => ({
  jobId: c?.jobId?._id ?? jobId ?? '',
  firstName: c?.firstName ?? '',
  lastName: c?.lastName ?? '',
  email: c?.email ?? '',
  phone: c?.phone ?? '',
  skills: c?.skills ?? [],
  experienceYears: c?.experienceYears ?? 0,
  currentCompany: c?.currentCompany ?? '',
  currentSalary: c?.currentSalary ?? undefined,
  expectedSalary: c?.expectedSalary ?? undefined,
  noticePeriodDays: c?.noticePeriodDays ?? undefined,
  source: (c?.source as FormIn['source']) ?? 'CAREERS_PAGE',
  notes: c?.notes ?? '',
});

/**
 * Add / edit a candidate. When `jobId` is given the job is fixed (e.g. from the
 * job pipeline). The resume is uploaded first and referenced by id.
 */
export const CandidateFormDrawer = ({
  open,
  onClose,
  candidate,
  jobId,
  jobTitle,
}: {
  open: boolean;
  onClose: (saved?: CandidateDetail) => void;
  candidate?: CandidateDetail;
  jobId?: string;
  jobTitle?: string;
}) => {
  const editing = !!candidate;
  const { user } = usePermissions();
  const currency = user?.organization.currency ?? 'USD';
  const save = useSaveCandidate(candidate?._id);
  const jobs = useJobOptions('OPEN');
  const [serverError, setServerError] = useState<string | null>(null);
  const [resume, setResume] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const { register, handleSubmit, control, formState, reset, setError } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(candidateSchema),
    defaultValues: toFormValues(candidate, jobId),
  });
  const errors = formState.errors;

  useEffect(() => {
    if (open) {
      reset(toFormValues(candidate, jobId));
      setServerError(null);
      setResume(null);
    }
  }, [open, candidate, jobId, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      let resumeFileId = values.resumeFileId;
      if (resume) {
        setUploading(true);
        try {
          resumeFileId = await uploadResume(resume);
        } finally {
          setUploading(false);
        }
      }
      const payload: Partial<FormOut> = { ...values, resumeFileId };
      for (const key of ['phone', 'currentCompany', 'notes', 'resumeFileId'] as const) if (!payload[key]) delete payload[key];
      if (editing) delete payload.jobId;
      const res = await save.mutateAsync(payload as FormOut);
      toast.success(res.message ?? (editing ? 'Candidate updated' : 'Candidate added'));
      onClose(res.data);
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError));
    }
  });

  const text = (name: keyof FormIn, lbl: string, opts: { type?: string; required?: boolean; hint?: string; optionalNumber?: boolean } = {}) => (
    <FormField label={lbl} error={errorAt(errors, name)} required={opts.required} hint={opts.hint}>
      {({ id, invalid }) => (
        <Input id={id} type={opts.type ?? 'text'} min={opts.type === 'number' ? 0 : undefined} aria-invalid={invalid} {...register(name, opts.optionalNumber ? optionalNumber : undefined)} />
      )}
    </FormField>
  );

  const jobOptions = (jobs.data ?? []).map((j) => ({ value: j._id, label: `${j.title} (${j.code})` }));
  const fixedJob = !!jobId || editing;

  return (
    <Drawer
      open={open}
      onClose={() => onClose()}
      title={editing ? `Edit ${candidate.firstName} ${candidate.lastName}` : 'Add candidate'}
      description={editing ? `${candidate.jobId?.title ?? ''}` : jobTitle ? `Applying for ${jobTitle}` : 'Candidates can only be added to open jobs.'}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            {uploading ? 'Uploading resume…' : editing ? 'Save changes' : 'Add candidate'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-8">
        <FormError error={serverError} />
        {!fixedJob && (
          <FormField label="Job opening" required error={errors.jobId} hint={jobs.data && !jobs.data.length ? 'There are no open jobs. Publish a job first.' : undefined}>
            {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={jobOptions} placeholder={jobs.isLoading ? 'Loading jobs…' : 'Select a job…'} {...register('jobId')} />}
          </FormField>
        )}

        <FormSection title="Candidate">
          <FormGrid>
            {text('firstName', 'First name', { required: true })}
            {text('lastName', 'Last name', { required: true })}
            {text('email', 'Email', { type: 'email', required: true })}
            {text('phone', 'Phone', { type: 'tel' })}
            <FormField label="Source" error={errors.source}>
              {({ id }) => <Select id={id} options={CANDIDATE_SOURCES.map((s) => ({ value: s, label: label(s) }))} {...register('source')} />}
            </FormField>
            {text('experienceYears', 'Experience (years)', { type: 'number' })}
          </FormGrid>
          <FormField label="Skills" error={errorAt(errors, 'skills')} hint="Press Enter or comma to add a skill.">
            {({ id, invalid }) => (
              <Controller control={control} name="skills" render={({ field }) => <TagInput id={id} invalid={invalid} value={(field.value as string[] | undefined) ?? []} onChange={field.onChange} />} />
            )}
          </FormField>
        </FormSection>

        <FormSection title="Current employment & expectations" description={`Amounts in ${currency}.`}>
          <FormGrid>
            {text('currentCompany', 'Current company')}
            {text('noticePeriodDays', 'Notice period (days)', { type: 'number', optionalNumber: true })}
            {text('currentSalary', 'Current salary', { type: 'number', optionalNumber: true })}
            {text('expectedSalary', 'Expected salary', { type: 'number', optionalNumber: true })}
          </FormGrid>
        </FormSection>

        <FormSection title="Resume" description="PDF or Word document, up to 10 MB.">
          {candidate?.resumeFileId && !resume && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm">
              <span className="flex items-center gap-2 text-fg">
                <FileText className="h-4 w-4 text-brand-600" /> Current resume on file
              </span>
              <Button variant="link" size="sm" onClick={() => openFile(`/files/${candidate.resumeFileId}`).catch(() => toast.error('Could not open the resume'))}>
                View
              </Button>
            </div>
          )}
          <FileUpload
            id="candidate-resume"
            file={resume}
            onFile={setResume}
            accept=".pdf,.doc,.docx"
            label={candidate?.resumeFileId ? 'Replace resume' : 'Upload resume'}
          />
        </FormSection>

        <FormField label="Notes" error={errors.notes}>
          {({ id, invalid }) => <Textarea id={id} rows={3} aria-invalid={invalid} {...register('notes')} />}
        </FormField>
      </form>
    </Drawer>
  );
};
