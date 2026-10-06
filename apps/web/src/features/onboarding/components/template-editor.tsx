import { useEffect, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { ArrowDown, ArrowUp, ListPlus, Plus, Trash2 } from 'lucide-react';
import { ONBOARDING_TASK_CATEGORIES, TASK_ASSIGNEE, onboardingTemplateSchema } from '@stencil/shared';
import { applyServerErrors, errorAt, FormError, FormField, FormGrid, FormSection } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/display';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { Drawer } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { toOptions, useAllOf } from '@/features/employees/api';
import { useSaveTemplate, useTemplate, type OnboardingTemplate, type TemplateInput } from '../api';

type FormValues = z.input<typeof onboardingTemplateSchema>;

const enumOptions = (values: readonly string[]) => values.map((v) => ({ value: v, label: label(v) }));

const blankTask = (): NonNullable<FormValues['tasks']>[number] => ({
  title: '',
  description: '',
  category: 'OTHER',
  assignee: 'HR',
  dueInDays: 0,
  required: true,
});

const toFormValues = (t?: OnboardingTemplate): FormValues => ({
  name: t?.name ?? '',
  description: t?.description ?? '',
  departmentId: t?.departmentId?._id ?? '',
  isDefault: t?.isDefault ?? false,
  tasks: t?.tasks.length
    ? t.tasks.map((task) => ({
        title: task.title,
        description: task.description ?? '',
        category: task.category,
        assignee: task.assignee,
        dueInDays: task.dueInDays,
        required: task.required,
      }))
    : [blankTask()],
});

const dueHint = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 'On the start date';
  return n > 0 ? `${n} day${n === 1 ? '' : 's'} after start` : `${Math.abs(n)} day${n === -1 ? '' : 's'} before start`;
};

/** Create/edit an onboarding template with an ordered task list. */
export const TemplateEditorDrawer = ({ open, templateId, onClose }: { open: boolean; templateId?: string; onClose: () => void }) => {
  const editing = !!templateId;
  const template = useTemplate(open ? templateId : undefined);
  const departments = useAllOf('departments');
  const save = useSaveTemplate(templateId);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FormValues>({ resolver: zodResolver(onboardingTemplateSchema), defaultValues: toFormValues() });
  const { register, control, handleSubmit, reset, setError, watch, formState } = form;
  const errors = formState.errors;
  const tasks = useFieldArray({ control, name: 'tasks' });

  useEffect(() => {
    if (!open) return;
    setServerError(null);
    if (!editing) reset(toFormValues());
    else if (template.data) reset(toFormValues(template.data));
  }, [open, editing, template.data, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const parsed = onboardingTemplateSchema.parse(values) as TemplateInput;
      const res = await save.mutateAsync(parsed);
      toast.success(res.message ?? (editing ? 'Template updated' : 'Template created'));
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError));
    }
  });

  const tasksError = errorAt(errors, 'tasks');
  const loading = editing && template.isLoading;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? 'Edit onboarding template' : 'New onboarding template'}
      description="Tasks are copied into each new onboarding checklist. Due dates are relative to the onboarding start date."
      width="max-w-3xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting} disabled={loading || !!template.error}>
            {editing ? 'Save changes' : 'Create template'}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="space-y-4" role="status" aria-label="Loading template">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : template.error ? (
        <ErrorState message={template.error.message} onRetry={() => template.refetch()} />
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-8">
          <FormError error={serverError} />
          <FormSection title="Details">
            <FormGrid>
              <FormField label="Name" required error={errors.name}>
                {({ id, invalid }) => <Input id={id} aria-invalid={invalid} maxLength={120} {...register('name')} />}
              </FormField>
              <FormField label="Department" hint="Leave empty to use it for any department." error={errorAt(errors, 'departmentId')}>
                {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={toOptions(departments.data)} placeholder="All departments" {...register('departmentId')} />}
              </FormField>
            </FormGrid>
            <FormField label="Description" error={errors.description}>
              {({ id }) => <Textarea id={id} rows={2} maxLength={500} {...register('description')} />}
            </FormField>
            <Checkbox label="Default template" description="Used automatically when an employee is created without choosing a template." {...register('isDefault')} />
          </FormSection>

          <FormSection title={`Tasks (${tasks.fields.length})`} description="Order matters — tasks appear in this order on the checklist.">
            {tasksError?.message && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {tasksError.message}
              </p>
            )}
            {tasks.fields.length === 0 ? (
              <EmptyState
                className="rounded-lg border border-dashed border-line-strong py-8"
                icon={<ListPlus className="h-6 w-6" />}
                title="No tasks yet"
                description="A template needs at least one task."
                action={
                  <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => tasks.append(blankTask())}>
                    Add task
                  </Button>
                }
              />
            ) : (
              <ol className="space-y-3">
                {tasks.fields.map((field, index) => {
                  const base = `tasks.${index}` as const;
                  const title = watch(`${base}.title`);
                  return (
                    <li key={field.id} className="rounded-xl border border-line bg-surface-2/60 p-4">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-fg">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                            {index + 1}
                          </span>
                          <span className="truncate">{title || 'Untitled task'}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <Button variant="ghost" size="icon-sm" aria-label={`Move task ${index + 1} up`} disabled={index === 0} onClick={() => tasks.move(index, index - 1)}>
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Move task ${index + 1} down`}
                            disabled={index === tasks.fields.length - 1}
                            onClick={() => tasks.move(index, index + 1)}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label={`Remove task ${index + 1}`} onClick={() => tasks.remove(index)}>
                            <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                          </Button>
                        </span>
                      </div>
                      <div className="space-y-4">
                        <FormField label="Title" required error={errorAt(errors, `${base}.title`)}>
                          {({ id, invalid }) => <Input id={id} aria-invalid={invalid} maxLength={200} {...register(`${base}.title`)} />}
                        </FormField>
                        <FormGrid cols={3}>
                          <FormField label="Category" error={errorAt(errors, `${base}.category`)}>
                            {({ id }) => <Select id={id} options={enumOptions(ONBOARDING_TASK_CATEGORIES)} {...register(`${base}.category`)} />}
                          </FormField>
                          <FormField label="Assignee" error={errorAt(errors, `${base}.assignee`)}>
                            {({ id }) => <Select id={id} options={enumOptions(TASK_ASSIGNEE)} {...register(`${base}.assignee`)} />}
                          </FormField>
                          <FormField label="Due in days" hint={dueHint(watch(`${base}.dueInDays`))} error={errorAt(errors, `${base}.dueInDays`)}>
                            {({ id, invalid }) => <Input id={id} type="number" min={-60} max={180} step={1} aria-invalid={invalid} {...register(`${base}.dueInDays`)} />}
                          </FormField>
                        </FormGrid>
                        <FormField label="Description" error={errorAt(errors, `${base}.description`)}>
                          {({ id }) => <Textarea id={id} rows={2} maxLength={1000} {...register(`${base}.description`)} />}
                        </FormField>
                        <Checkbox label="Required" description="Onboarding completes when every required task is done." {...register(`${base}.required`)} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            {tasks.fields.length > 0 && (
              <Button variant="outline" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => tasks.append(blankTask())} disabled={tasks.fields.length >= 100}>
                Add task
              </Button>
            )}
          </FormSection>
        </form>
      )}
    </Drawer>
  );
};
