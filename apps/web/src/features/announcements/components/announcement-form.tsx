import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { z } from 'zod';
import { FileText, Loader2, X } from 'lucide-react';
import { ANNOUNCEMENT_AUDIENCE, ANNOUNCEMENT_PRIORITY, announcementBaseSchema, type AnnouncementUpdateInput } from '@stencil/shared';
import { Combobox, EmployeePicker, FileUpload } from '@/components/common/controls';
import { applyServerErrors, FormError, FormField, FormGrid, FormSection } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Select, Switch } from '@/components/ui/input';
import { Drawer } from '@/components/ui/overlay';
import { get, toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { cn, formatBytes } from '@/lib/utils';
import { useAllOf } from '@/features/employees/api';
import { attachmentName, uploadAnnouncementAttachment, useSaveAnnouncement, type Announcement, type AnnouncementAttachment } from '../api';
import { isHtmlEmpty, RichTextEditor } from './rich-text-editor';

const MAX_ATTACHMENTS = 10;

const formSchema = announcementBaseSchema
  .omit({ publishAt: true, expiresAt: true, attachmentIds: true })
  .extend({ publishAt: z.string(), expiresAt: z.string() })
  .superRefine((d, ctx) => {
    if (isHtmlEmpty(d.content)) ctx.addIssue({ code: 'custom', path: ['content'], message: 'Content is required' });
    if (d.audience === 'DEPARTMENTS' && !d.departmentIds.length) ctx.addIssue({ code: 'custom', path: ['departmentIds'], message: 'Select at least one department' });
    if (d.audience === 'EMPLOYEES' && !d.employeeIds.length) ctx.addIssue({ code: 'custom', path: ['employeeIds'], message: 'Select at least one employee' });
    if (d.expiresAt) {
      const expires = new Date(d.expiresAt).getTime();
      const publish = d.publishAt ? new Date(d.publishAt).getTime() : Date.now();
      if (expires <= publish) ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Expiry must be after the publish time' });
    }
  });

type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

/** ISO instant → `datetime-local` value (viewer's local time). */
const toLocalInput = (iso?: string | null) => (iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : '');
const toIso = (local: string) => new Date(local).toISOString();

const toFormValues = (a?: Announcement): FormInput => ({
  title: a?.title ?? '',
  content: a?.content ?? '',
  priority: a?.priority ?? 'NORMAL',
  audience: a?.audience ?? 'ALL',
  departmentIds: a?.departmentIds ?? [],
  employeeIds: a?.employeeIds ?? [],
  publishAt: a && a.status === 'SCHEDULED' ? toLocalInput(a.publishAt) : '',
  expiresAt: toLocalInput(a?.expiresAt),
  pinned: a?.pinned ?? false,
  sendEmail: a?.sendEmail ?? false,
});


export const AnnouncementFormDrawer = ({ open, onClose, announcement }: { open: boolean; onClose: (saved?: Announcement) => void; announcement?: Announcement }) => {
  const editing = !!announcement;
  const save = useSaveAnnouncement(announcement?._id);
  const departments = useAllOf('departments');
  const [serverError, setServerError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AnnouncementAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadKey, setUploadKey] = useState(0);

  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(formSchema), defaultValues: toFormValues(announcement) });
  const { register, control, handleSubmit, formState, reset, setError, watch } = form;
  const errors = formState.errors;
  const audience = watch('audience');

  // Names for already-targeted employees: the detail endpoint resolves them for managers.
  const needsNames = open && editing && (announcement?.employeeIds.length ?? 0) > 0;
  const detail = useQuery({
    queryKey: ['announcements', 'detail', announcement?._id, 'targets'],
    queryFn: () => get<{ audienceTargets?: { employees: { _id: string; name: string }[] } }>(`/announcements/${announcement!._id}`),
    enabled: needsNames,
  });
  const employeeLabels = useMemo(() => {
    if (!announcement?.employeeIds.length) return undefined;
    const byId = new Map((detail.data?.audienceTargets?.employees ?? []).map((e) => [e._id, e.name]));
    return Object.fromEntries(announcement.employeeIds.map((id) => [id, byId.get(id) ?? (detail.isLoading ? 'Loading…' : `Employee …${id.slice(-4)}`)]));
  }, [announcement, detail.data, detail.isLoading]);

  const departmentOptions = useMemo(() => (departments.data ?? []).map((d) => ({ value: d._id, label: d.name })), [departments.data]);

  useEffect(() => {
    if (open) {
      reset(toFormValues(announcement));
      setAttachments(announcement?.attachmentIds ?? []);
      setServerError(null);
    }
  }, [open, announcement, reset]);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const doc = await uploadAnnouncementAttachment(file);
      setAttachments((list) => [...list, doc]);
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setUploading(false);
      setUploadKey((k) => k + 1);
    }
  };

  const onSubmit = handleSubmit(async (v) => {
    setServerError(null);
    const base = {
      title: v.title,
      content: v.content,
      priority: v.priority,
      audience: v.audience,
      departmentIds: v.audience === 'DEPARTMENTS' ? v.departmentIds : [],
      employeeIds: v.audience === 'EMPLOYEES' ? v.employeeIds : [],
      attachmentIds: attachments.map((a) => a._id),
      pinned: v.pinned,
      sendEmail: v.sendEmail,
    };
    let payload: AnnouncementUpdateInput;
    if (editing) {
      payload = {
        ...base,
        ...(formState.dirtyFields.publishAt && v.publishAt ? { publishAt: toIso(v.publishAt) } : {}),
        expiresAt: v.expiresAt ? toIso(v.expiresAt) : null,
      };
    } else {
      payload = {
        ...base,
        ...(v.publishAt ? { publishAt: toIso(v.publishAt) } : {}),
        ...(v.expiresAt ? { expiresAt: toIso(v.expiresAt) } : {}),
      };
    }
    try {
      const res = await save.mutateAsync(payload);
      const scheduled = res.data.status === 'SCHEDULED';
      toast.success(res.message ?? (editing ? 'Announcement updated' : scheduled ? 'Announcement scheduled' : 'Announcement published'));
      onClose(res.data);
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError));
    }
  });

  return (
    <Drawer
      open={open}
      onClose={() => onClose()}
      title={editing ? 'Edit announcement' : 'New announcement'}
      description={editing ? announcement?.title : 'Share news with everyone, specific departments or people.'}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting} disabled={uploading}>
            {editing ? 'Save changes' : watch('publishAt') ? 'Schedule' : 'Publish'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-7">
        <FormError error={serverError} />
        <FormSection title="Message">
          <FormField label="Title" required error={errors.title}>
            {({ id, invalid, describedBy }) => <Input id={id} aria-invalid={invalid} aria-describedby={describedBy} maxLength={200} {...register('title')} />}
          </FormField>
          <FormField label="Content" required error={errors.content} hint="Use the toolbar for headings, lists and links. Pasted text is inserted without formatting.">
            {({ id, invalid, describedBy }) => (
              <Controller
                control={control}
                name="content"
                render={({ field }) => <RichTextEditor id={id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} invalid={invalid} describedBy={describedBy} />}
              />
            )}
          </FormField>
          <div>
            <p className="mb-1.5 text-sm font-medium text-fg">Attachments</p>
            {attachments.length > 0 && (
              <ul className="mb-2 space-y-1.5">
                {attachments.map((a) => (
                  <li key={a._id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                      <span className="truncate font-medium">{attachmentName(a)}</span>
                      {a.size ? <span className="shrink-0 text-xs text-muted">{formatBytes(a.size)}</span> : null}
                    </span>
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${attachmentName(a)}`} onClick={() => setAttachments((list) => list.filter((x) => x._id !== a._id))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {uploading ? (
              <p className="flex items-center gap-2 rounded-lg border border-dashed border-line-strong px-4 py-5 text-sm text-muted" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Uploading…
              </p>
            ) : attachments.length < MAX_ATTACHMENTS ? (
              <FileUpload key={uploadKey} id="announcement-attachment" onFile={onFile} label="Add an attachment" hint={`PDF, image, Word or Excel · max 10 MB · up to ${MAX_ATTACHMENTS} files`} />
            ) : (
              <p className="text-xs text-muted">Maximum of {MAX_ATTACHMENTS} attachments reached.</p>
            )}
          </div>
        </FormSection>

        <FormSection title="Audience">
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-fg">Who should see this?</legend>
              <Controller
                control={control}
                name="audience"
                render={({ field }) => (
                  <div role="radiogroup" aria-label="Audience" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {ANNOUNCEMENT_AUDIENCE.map((a) => {
                      const selected = field.value === a;
                      return (
                        <button
                          key={a}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => field.onChange(a)}
                          className={cn(
                            'rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                            selected ? 'border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500/20 dark:bg-brand-500/15 dark:text-brand-200' : 'border-line-strong bg-surface text-fg-2 hover:bg-surface-2',
                          )}
                        >
                          <span className="block font-medium">{a === 'ALL' ? 'Everyone' : a === 'DEPARTMENTS' ? 'Departments' : 'Specific people'}</span>
                          <span className="block text-xs text-muted">{a === 'ALL' ? 'All active users' : a === 'DEPARTMENTS' ? 'Members of chosen teams' : 'Hand-picked employees'}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              />
          </fieldset>
          {audience === 'DEPARTMENTS' && (
            <FormField label="Departments" required error={errors.departmentIds as { message?: string } | undefined}>
              {({ id, invalid }) => (
                <Controller
                  control={control}
                  name="departmentIds"
                  render={({ field }) => (
                    <Combobox
                      id={id}
                      multiple
                      invalid={invalid}
                      placeholder={departments.isLoading ? 'Loading departments…' : 'Select departments…'}
                      options={departmentOptions}
                      value={field.value ?? []}
                      onChange={(v) => field.onChange(Array.isArray(v) ? v : v ? [v] : [])}
                    />
                  )}
                />
              )}
            </FormField>
          )}
          {audience === 'EMPLOYEES' && (
            <FormField label="Employees" required error={errors.employeeIds as { message?: string } | undefined}>
              {({ id, invalid }) => (
                <Controller
                  control={control}
                  name="employeeIds"
                  render={({ field }) => (
                    <EmployeePicker
                      id={id}
                      multiple
                      invalid={invalid}
                      placeholder="Select employees…"
                      selectedLabels={employeeLabels}
                      value={field.value ?? []}
                      onChange={(v) => field.onChange(Array.isArray(v) ? v : v ? [v] : [])}
                    />
                  )}
                />
              )}
            </FormField>
          )}
        </FormSection>

        <FormSection title="Delivery" description="Times are in your local timezone.">
          <FormGrid>
            <FormField label="Priority" error={errors.priority}>
              {({ id }) => <Select id={id} options={ANNOUNCEMENT_PRIORITY.map((p) => ({ value: p, label: label(p) }))} {...register('priority')} />}
            </FormField>
            <div />
            <FormField label="Publish at" error={errors.publishAt} hint={editing && announcement?.status !== 'SCHEDULED' ? 'Already published. Set a future time to re-schedule.' : 'Leave empty to publish now.'}>
              {({ id, invalid, describedBy }) => <Input id={id} type="datetime-local" aria-invalid={invalid} aria-describedby={describedBy} {...register('publishAt')} />}
            </FormField>
            <FormField label="Expires at" error={errors.expiresAt} hint="Leave empty and it comes down at 12:00 AM after the day it is published. Pick a later date to keep it up longer.">
              {({ id, invalid, describedBy }) => <Input id={id} type="datetime-local" aria-invalid={invalid} aria-describedby={describedBy} {...register('expiresAt')} />}
            </FormField>
          </FormGrid>
          <div className="space-y-3 rounded-lg border border-line p-3">
            <Controller
              control={control}
              name="pinned"
              render={({ field }) => (
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="announcement-pinned" className="text-sm">
                    <span className="block font-medium text-fg">Pin to top</span>
                    <span className="block text-muted">
                      Everyone sees a pop-up once. Pinned announcements then stay in the bar at the top of every page until they expire (others for 7 days) and
                      can’t be closed.
                    </span>
                  </label>
                  <Switch id="announcement-pinned" checked={!!field.value} onChange={field.onChange} label="Pin to top" />
                </div>
              )}
            />
            <Checkbox label="Also send by email" description="The audience receives an email when the announcement is published." {...register('sendEmail')} />
          </div>
        </FormSection>
      </form>
    </Drawer>
  );
};
