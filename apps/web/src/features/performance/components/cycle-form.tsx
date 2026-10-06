import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Lock, RotateCcw, X } from 'lucide-react';
import { DEFAULT_RATING_SCALE, performanceCycleSchema } from '@stencil/shared';
import { Combobox } from '@/components/common/controls';
import { applyServerErrors, errorAt, FormError, FormField, FormGrid, FormSection } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Drawer } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { apiDateKey } from '@/lib/utils';
import { toOptions, useAllOf } from '@/features/employees/api';
import { useSaveCycle, type Cycle, type RatingScale } from '../api';

type In = z.input<typeof performanceCycleSchema>;
type Out = z.output<typeof performanceCycleSchema>;

const SCALE_EDITABLE = ['DRAFT', 'GOAL_SETTING', 'IN_PROGRESS'];

const toFormValues = (c?: Cycle): In => ({
  name: c?.name ?? '',
  description: c?.description ?? '',
  startDate: apiDateKey(c?.startDate),
  endDate: apiDateKey(c?.endDate),
  selfReviewDue: apiDateKey(c?.selfReviewDue),
  managerReviewDue: apiDateKey(c?.managerReviewDue),
  ratingScale: c ? { min: c.ratingScale.min, max: c.ratingScale.max, labels: c.ratingScale.labels.map((l) => ({ value: l.value, label: l.label })) } : structuredClone(DEFAULT_RATING_SCALE),
  goalWeightage: c?.goalWeightage ?? 70,
  competencies: c?.competencies ?? [],
  departmentIds: (c?.departmentIds ?? []).map((d) => (typeof d === 'string' ? d : d._id)),
});

/** Editor for the rating scale: bounds plus an optional label per point. */
const ScaleEditor = ({ value, onChange, disabled, error }: { value: RatingScale; onChange: (v: RatingScale) => void; disabled?: boolean; error?: string }) => {
  const baseId = useId();
  const min = Number(value.min);
  const max = Number(value.max);
  const valid = Number.isInteger(min) && Number.isInteger(max) && max > min && max - min <= 10;
  const points = valid ? Array.from({ length: max - min + 1 }, (_, i) => min + i) : [];
  const setBound = (key: 'min' | 'max', raw: string) => {
    const n = raw === '' ? Number.NaN : Math.round(Number(raw));
    const next = { ...value, [key]: n };
    // Drop labels that fall outside the new bounds (keep them while the field is being retyped).
    const lo = key === 'min' ? n : min;
    const hi = key === 'max' ? n : max;
    if (!Number.isNaN(lo) && !Number.isNaN(hi)) next.labels = value.labels.filter((l) => l.value >= lo && l.value <= hi);
    onChange(next);
  };
  const setLabel = (point: number, text: string) => {
    const others = value.labels.filter((l) => l.value !== point);
    onChange({ ...value, labels: text.trim() ? [...others, { value: point, label: text }].sort((a, b) => a.value - b.value) : others });
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-28">
          <label htmlFor={`${baseId}-min`} className="mb-1.5 block text-sm font-medium text-fg">
            Lowest
          </label>
          <Input id={`${baseId}-min`} type="number" min={0} max={9} disabled={disabled} value={Number.isNaN(min) ? '' : min} onChange={(e) => setBound('min', e.target.value)} />
        </div>
        <div className="w-28">
          <label htmlFor={`${baseId}-max`} className="mb-1.5 block text-sm font-medium text-fg">
            Highest
          </label>
          <Input id={`${baseId}-max`} type="number" min={1} max={10} disabled={disabled} value={Number.isNaN(max) ? '' : max} onChange={(e) => setBound('max', e.target.value)} />
        </div>
        {!disabled && (
          <Button variant="ghost" size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={() => onChange(structuredClone(DEFAULT_RATING_SCALE))}>
            Reset to default
          </Button>
        )}
      </div>
      {valid ? (
        <fieldset className="space-y-2" disabled={disabled}>
          <legend className="mb-1 text-sm font-medium text-fg">Labels</legend>
          {points.map((p) => (
            <div key={p} className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-sm font-semibold text-fg tabular-nums" aria-hidden>
                {p}
              </span>
              <Input aria-label={`Label for rating ${p}`} maxLength={40} placeholder="Optional label" value={value.labels.find((l) => l.value === p)?.label ?? ''} onChange={(e) => setLabel(p, e.target.value)} />
            </div>
          ))}
        </fieldset>
      ) : (
        <p className="text-sm text-muted">Enter whole numbers between 0 and 10 with the highest above the lowest.</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
};

/** Chip list editor: Enter or comma adds, Backspace on empty input removes the last. */
const TagInput = ({ id, value, onChange, max = 20, placeholder }: { id: string; value: string[]; onChange: (v: string[]) => void; max?: number; placeholder?: string }) => {
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim().slice(0, 80);
    if (!t || value.some((v) => v.toLowerCase() === t.toLowerCase()) || value.length >= max) return setText('');
    onChange([...value, t]);
    setText('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Competencies">
          {value.map((v) => (
            <li key={v} className="inline-flex items-center gap-1 rounded-md bg-surface-3 py-1 pr-1 pl-2 text-sm text-fg">
              {v}
              <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="rounded p-0.5 text-muted hover:bg-line hover:text-fg">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input id={id} aria-label="Add competency" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} onBlur={add} placeholder={value.length >= max ? `Maximum of ${max} reached` : placeholder} disabled={value.length >= max} />
        <Button variant="outline" onClick={add} disabled={!text.trim() || value.length >= max}>
          Add
        </Button>
      </div>
    </div>
  );
};

export const CycleFormDrawer = ({ open, onClose, cycle }: { open: boolean; onClose: (saved?: Cycle) => void; cycle?: Cycle }) => {
  const editing = !!cycle;
  const scaleLocked = editing && !SCALE_EDITABLE.includes(cycle.status);
  const save = useSaveCycle(cycle?._id);
  const departments = useAllOf('departments');
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(performanceCycleSchema), defaultValues: toFormValues(cycle) });
  const { register, control, handleSubmit, reset, formState, setError, watch } = form;
  const errors = formState.errors;

  useEffect(() => {
    if (open) {
      reset(toFormValues(cycle));
      setServerError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cycle?._id]);

  const weightage = Number(watch('goalWeightage')) || 0;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) if (v !== '' && v !== undefined) payload[k] = v;
    if (scaleLocked) {
      delete payload.ratingScale;
      delete payload.goalWeightage;
    }
    try {
      const res = await save.mutateAsync(payload);
      toast.success(res.message ?? (editing ? 'Cycle updated' : 'Cycle created'));
      onClose(res.data);
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError));
    }
  });

  const scaleError = errorAt(errors, 'ratingScale')?.message ?? errorAt(errors, 'ratingScale.max')?.message ?? errorAt(errors, 'ratingScale.labels')?.message ?? errorAt(errors, 'ratingScale.min')?.message;

  return (
    <Drawer
      open={open}
      onClose={() => onClose()}
      title={editing ? `Edit ${cycle.name}` : 'New performance cycle'}
      description={editing ? undefined : 'Cycles start as drafts. Advance them through goal setting and review stages when ready.'}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            {editing ? 'Save changes' : 'Create cycle'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-8">
        <FormError error={serverError} />
        <FormSection title="Cycle">
          <FormField label="Name" required error={errors.name}>
            {({ id, invalid }) => <Input id={id} data-autofocus aria-invalid={invalid} placeholder="e.g. Annual review 2026" {...register('name')} />}
          </FormField>
          <FormField label="Description" error={errors.description}>
            {({ id }) => <Textarea id={id} rows={2} {...register('description')} />}
          </FormField>
          <FormGrid>
            <FormField label="Start date" required error={errors.startDate}>
              {({ id, invalid }) => <Input id={id} type="date" aria-invalid={invalid} {...register('startDate')} />}
            </FormField>
            <FormField label="End date" required error={errors.endDate}>
              {({ id, invalid }) => <Input id={id} type="date" aria-invalid={invalid} {...register('endDate')} />}
            </FormField>
            <FormField label="Self review due" error={errorAt(errors, 'selfReviewDue')}>
              {({ id, invalid }) => <Input id={id} type="date" aria-invalid={invalid} {...register('selfReviewDue')} />}
            </FormField>
            <FormField label="Manager review due" error={errorAt(errors, 'managerReviewDue')}>
              {({ id, invalid }) => <Input id={id} type="date" aria-invalid={invalid} {...register('managerReviewDue')} />}
            </FormField>
          </FormGrid>
          <FormField label="Departments" hint="Leave empty to include every department." error={errorAt(errors, 'departmentIds')}>
            {({ id }) => (
              <Controller
                control={control}
                name="departmentIds"
                render={({ field }) => (
                  <Combobox
                    id={id}
                    multiple
                    placeholder="All departments"
                    options={toOptions(departments.data)}
                    value={(field.value as string[] | undefined) ?? []}
                    onChange={(v) => field.onChange(Array.isArray(v) ? v : v ? [v] : [])}
                  />
                )}
              />
            )}
          </FormField>
        </FormSection>

        <FormSection title="Scoring" description="Final rating = goal weightage × goal score + the rest × overall rating.">
          {scaleLocked && (
            <p className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-muted">
              <Lock className="h-4 w-4 shrink-0" aria-hidden /> The rating scale and goal weightage are locked once reviews have started.
            </p>
          )}
          <FormField label="Goal weightage" error={errors.goalWeightage} hint={`${weightage}% goals · ${Math.max(0, 100 - weightage)}% overall rating`}>
            {({ id, describedBy }) => (
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  aria-label="Goal weightage"
                  aria-valuetext={`${weightage}%`}
                  aria-describedby={describedBy}
                  disabled={scaleLocked}
                  className="min-w-0 flex-1 accent-brand-600"
                  style={{ accentColor: 'var(--color-brand-600)' }}
                  value={weightage}
                  onChange={(e) => form.setValue('goalWeightage', Number(e.target.value), { shouldDirty: true })}
                />
                <div className="relative w-24 shrink-0">
                  <Input id={id} type="number" min={0} max={100} disabled={scaleLocked} className="pr-7 text-right" {...register('goalWeightage')} />
                  <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted">%</span>
                </div>
              </div>
            )}
          </FormField>
          <div>
            <p className="mb-2 text-sm font-semibold text-fg">Rating scale</p>
            <Controller
              control={control}
              name="ratingScale"
              render={({ field }) => (
                <ScaleEditor
                  value={{ min: Number(field.value?.min), max: Number(field.value?.max), labels: field.value?.labels ?? [] }}
                  onChange={field.onChange}
                  disabled={scaleLocked}
                  error={scaleError}
                />
              )}
            />
          </div>
        </FormSection>

        <FormSection title="Competencies" description="Rated by employees, managers and HR in addition to goals (up to 20).">
          <FormField error={errorAt(errors, 'competencies')?.message}>
            {({ id }) => (
              <Controller
                control={control}
                name="competencies"
                render={({ field }) => <TagInput id={id} value={(field.value as string[] | undefined) ?? []} onChange={field.onChange} placeholder="e.g. Communication, Ownership…" />}
              />
            )}
          </FormField>
        </FormSection>
      </form>
    </Drawer>
  );
};
