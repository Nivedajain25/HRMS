import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { goalProgressSchema } from '@stencil/shared';
import { StatusBadge } from '@/components/common/status-badge';
import { applyServerErrors, FormError, FormField } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Checkbox, Select, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useGoalProgress, type Goal, type GoalUpdate } from '../api';

type In = z.input<typeof goalProgressSchema>;
type Out = z.output<typeof goalProgressSchema>;

/** Labeled range slider paired with a number box; both keyboard operable. */
export const PercentSlider = ({
  id,
  value,
  onChange,
  label: lbl,
  disabled,
  size = 'md',
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  label: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) => {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={lbl}
        aria-valuetext={`${value}%`}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        className={cn('min-w-0 flex-1 cursor-pointer accent-brand-600 disabled:cursor-not-allowed', size === 'sm' ? 'h-1.5' : 'h-2')}
        style={{ accentColor: 'var(--color-brand-600)' }}
      />
      <div className="relative w-20 shrink-0">
        <input
          type="number"
          min={0}
          max={100}
          inputMode="numeric"
          aria-label={`${lbl} (percent)`}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          className="block h-9 w-full rounded-lg border border-line-strong bg-surface pr-7 pl-2.5 text-right text-sm text-fg tabular-nums focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
        />
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted">%</span>
      </div>
    </div>
  );
};

export const GoalHistory = ({ updates, className }: { updates: GoalUpdate[]; className?: string }) => {
  const { user } = usePermissions();
  const items = [...updates].sort((a, b) => b.at.localeCompare(a.at));
  if (!items.length) return <p className={cn('text-sm text-muted', className)}>No progress updates yet.</p>;
  return (
    <ol className={cn('relative space-y-4 border-l border-line pl-5', className)} aria-label="Progress history">
      {items.map((u, i) => (
        <li key={`${u.at}-${i}`} className="relative">
          <span className="absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full border-2 border-surface bg-brand-600" aria-hidden />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-fg tabular-nums">{u.progress}%</span>
            <StatusBadge status={u.status} />
            <span className="text-xs text-muted" title={formatDateTime(u.at)}>
              {timeAgo(u.at)}
              {u.by && user && u.by === user._id ? ' · by you' : ''}
            </span>
          </div>
          {u.note && <p className="mt-1 text-sm whitespace-pre-line text-fg-2">{u.note}</p>}
        </li>
      ))}
    </ol>
  );
};

const avg = (rows: { progress?: unknown }[]) => (rows.length ? Math.round(rows.reduce((s, r) => s + (Number(r.progress) || 0), 0) / rows.length) : 0);

export const GoalProgressDialog = ({ goal, open, onClose, canManage }: { goal: Goal; open: boolean; onClose: () => void; canManage: boolean }) => {
  const mutation = useGoalProgress(goal._id);
  const [serverError, setServerError] = useState<string | null>(null);
  const [rollup, setRollup] = useState(goal.keyResults.length > 0);
  const terminal = goal.status === 'COMPLETED' || goal.status === 'CANCELLED';

  const defaults = (): In => ({
    progress: goal.progress,
    status: terminal ? 'IN_PROGRESS' : undefined,
    note: '',
    keyResults: goal.keyResults.map((k) => ({ title: k.title, progress: k.progress ?? 0 })),
  });
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(goalProgressSchema), defaultValues: defaults() });
  const { control, register, handleSubmit, reset, setValue, watch, formState, setError } = form;
  const krs = useFieldArray({ control, name: 'keyResults' });
  const krValues = watch('keyResults') ?? [];

  useEffect(() => {
    if (open) {
      reset(defaults());
      setServerError(null);
      setRollup(goal.keyResults.length > 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal._id]);

  const krKey = krValues.map((k) => Number(k.progress) || 0).join(',');
  useEffect(() => {
    if (!rollup || !krKey) return;
    const values = krKey.split(',').map((v) => ({ progress: Number(v) }));
    setValue('progress', avg(values));
  }, [rollup, krKey, setValue]);

  const statusOptions = [
    ...(terminal ? [] : [{ value: '', label: 'Automatic (from progress)' }]),
    { value: 'NOT_STARTED', label: label('NOT_STARTED') },
    { value: 'IN_PROGRESS', label: label('IN_PROGRESS') },
    ...(terminal ? [] : [{ value: 'COMPLETED', label: label('COMPLETED') }]),
    ...(canManage && !terminal ? [{ value: 'CANCELLED', label: 'Cancelled' }] : []),
  ];

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await mutation.mutateAsync({
        progress: values.progress,
        status: values.status,
        note: values.note || undefined,
        keyResults: goal.keyResults.length ? values.keyResults : undefined,
      });
      toast.success(res.message ?? 'Progress updated');
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Update progress"
      description={goal.title}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            {terminal ? 'Reopen goal' : 'Save update'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError error={serverError} />
        {terminal && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            This goal is {label(goal.status).toLowerCase()}. Saving reopens it with the status and progress below.
          </p>
        )}

        {krs.fields.length > 0 && (
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-semibold text-fg">Key results</legend>
            {krs.fields.map((f, i) => (
              <div key={f.id} className="space-y-1.5">
                <label htmlFor={`kr-${f.id}`} className="block text-sm text-fg-2">
                  {i + 1}. {goal.keyResults[i]?.title}
                </label>
                <Controller
                  control={control}
                  name={`keyResults.${i}.progress`}
                  render={({ field }) => (
                    <PercentSlider id={`kr-${f.id}`} size="sm" label={`Progress of key result ${i + 1}`} value={Number(field.value) || 0} onChange={field.onChange} />
                  )}
                />
              </div>
            ))}
            <Checkbox label="Calculate overall progress from key results" description="Uses the average of the key results." checked={rollup} onChange={(e) => setRollup(e.target.checked)} />
          </fieldset>
        )}

        <FormField label="Overall progress" error={formState.errors.progress}>
          {({ id }) => (
            <Controller
              control={control}
              name="progress"
              render={({ field }) => <PercentSlider id={id} label="Overall progress" value={Number(field.value) || 0} onChange={field.onChange} disabled={rollup && krs.fields.length > 0} />}
            />
          )}
        </FormField>

        <FormField label="Status" hint="Reaching 100% marks the goal completed." error={formState.errors.status}>
          {({ id }) => <Select id={id} options={statusOptions} {...register('status', { setValueAs: (v: unknown) => (v === '' || v === null ? undefined : v) })} />}
        </FormField>

        <FormField label="Note" hint="What changed since the last update?" error={formState.errors.note}>
          {({ id }) => <Textarea id={id} rows={3} maxLength={1000} {...register('note')} />}
        </FormField>

        <section aria-labelledby="goal-history-title">
          <h3 id="goal-history-title" className="mb-3 text-sm font-semibold text-fg">
            History
          </h3>
          <GoalHistory updates={goal.updates ?? []} />
        </section>
      </form>
    </Modal>
  );
};
