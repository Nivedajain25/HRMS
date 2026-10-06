import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { GOAL_CATEGORIES, GOAL_STATUS, goalSchema } from '@stencil/shared';
import { EmployeePicker } from '@/components/common/controls';
import { applyServerErrors, errorAt, FormError, FormField, FormGrid, FormSection } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui/display';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Drawer } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { apiDateKey, cn, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useCycleOptions, useGoals, useSaveGoal, type Goal } from '../api';
import { CATEGORY_LABELS } from './perf-ui';

type In = z.input<typeof goalSchema>;
type Out = z.output<typeof goalSchema>;

const SELF_GOAL_STAGES = ['GOAL_SETTING', 'IN_PROGRESS'];

const toFormValues = (goal: Goal | undefined, employeeId: string, cycleId: string): In => ({
  title: goal?.title ?? '',
  description: goal?.description ?? '',
  category: goal?.category ?? 'KPI',
  weight: goal?.weight ?? 0,
  target: goal?.target ?? '',
  metricUnit: goal?.metricUnit ?? '',
  targetValue: goal?.targetValue ?? undefined,
  progress: goal?.progress ?? 0,
  dueDate: apiDateKey(goal?.dueDate),
  status: goal?.status ?? 'NOT_STARTED',
  employeeId: goal?.employeeId?._id ?? employeeId,
  cycleId: goal?.cycleId?._id ?? cycleId,
  keyResults: goal?.keyResults?.map((k) => ({ title: k.title, progress: k.progress })) ?? [],
});

/** Sum of weights of the employee's other active goals in the same cycle (or without cycle). */
const useAllocatedWeight = (employeeId: string | undefined, cycleId: string | undefined, excludeId: string | undefined, enabled: boolean) => {
  const q = useGoals({ employeeId, cycleId: cycleId || undefined, limit: 100, page: 1 }, enabled && !!employeeId);
  const rows = (q.data?.data ?? []).filter((g) => g._id !== excludeId && g.status !== 'CANCELLED' && (cycleId ? g.cycleId?._id === cycleId : !g.cycleId));
  return { allocated: rows.reduce((s, g) => s + (g.weight || 0), 0), count: rows.length, loading: q.isLoading };
};

export const WeightMeter = ({ allocated, adding, compact }: { allocated: number; adding: number; compact?: boolean }) => {
  const total = allocated + adding;
  const over = total > 100;
  return (
    <div className={cn('rounded-lg border p-3', over ? 'border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10' : 'border-line bg-surface-2')}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium text-fg">Total weight {compact ? '' : 'in this cycle'}</span>
        <span className={cn('font-semibold tabular-nums', over ? 'text-red-600 dark:text-red-400' : 'text-fg')}>{total}% / 100%</span>
      </div>
      <ProgressBar value={Math.min(total, 100)} tone={over ? 'amber' : total === 100 ? 'green' : 'brand'} />
      {!compact && (
        <p className="mt-2 text-xs text-muted">
          Other goals: {allocated}% · This goal: {adding}%
        </p>
      )}
      {over && (
        <p role="alert" className="mt-2 flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-300">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Weights exceed 100% by {total - 100}%. Reduce this or another goal's weight.
        </p>
      )}
    </div>
  );
};

export const GoalFormDrawer = ({
  open,
  onClose,
  goal,
  defaultEmployeeId,
  defaultCycleId,
  defaultEmployeeLabel,
}: {
  open: boolean;
  onClose: (saved?: boolean) => void;
  goal?: Goal;
  defaultEmployeeId?: string;
  defaultEmployeeLabel?: string;
  defaultCycleId?: string;
}) => {
  const editing = !!goal;
  const { user, can, isManager } = usePermissions();
  const isHr = can('performance:create') && can('performance:read');
  const canAssign = isHr || isManager;
  const cycles = useCycleOptions();
  const save = useSaveGoal(goal?._id);
  const [serverError, setServerError] = useState<string | null>(null);
  const initialEmployee = defaultEmployeeId ?? user?.employeeId ?? '';

  const form = useForm<In, unknown, Out>({ resolver: zodResolver(goalSchema), defaultValues: toFormValues(goal, initialEmployee, defaultCycleId ?? '') });
  const { register, handleSubmit, control, formState, reset, setError, watch } = form;
  const errors = formState.errors;
  const keyResults = useFieldArray({ control, name: 'keyResults' });

  useEffect(() => {
    if (open) {
      reset(toFormValues(goal, initialEmployee, defaultCycleId ?? ''));
      setServerError(null);
    }
    // Only reset when the drawer opens (or targets another goal), not on background refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal?._id]);

  const employeeId = watch('employeeId') as string | undefined;
  const cycleId = (watch('cycleId') as string | undefined) || undefined;
  const category = watch('category');
  const weight = Number(watch('weight')) || 0;
  const weightInfo = useAllocatedWeight(employeeId, cycleId, goal?._id, open);
  const isSelfGoal = !!user?.employeeId && employeeId === user.employeeId;
  const managesThis = isHr || (isManager && !isSelfGoal);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) if (v !== '' && v !== undefined) payload[k] = v;
    if (editing) {
      delete payload.employeeId;
      delete payload.progress;
      if (!managesThis || values.status === goal?.status) delete payload.status;
    } else {
      delete payload.status;
    }
    try {
      const res = await save.mutateAsync(payload);
      toast.success(res.message ?? (editing ? 'Goal updated' : 'Goal created'));
      onClose(true);
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError));
    }
  });

  const cycleOptions = (cycles.data ?? [])
    .filter((c) => c.status !== 'COMPLETED' || c._id === goal?.cycleId?._id)
    .map((c) => ({
      value: c._id,
      label: `${c.name} · ${label(c.status)}`,
      disabled: !managesThis && !SELF_GOAL_STAGES.includes(c.status) && c._id !== goal?.cycleId?._id,
    }));

  return (
    <Drawer
      open={open}
      onClose={() => onClose()}
      title={editing ? 'Edit goal' : 'New goal'}
      description={editing ? `Owner: ${fullName(goal?.employeeId)}` : 'Define what success looks like, how it is measured and how much it counts.'}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            {editing ? 'Save changes' : 'Create goal'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-8">
        <FormError error={serverError} />
        <FormSection title="Goal">
          <FormField label="Title" required error={errors.title}>
            {({ id, invalid }) => <Input id={id} aria-invalid={invalid} data-autofocus placeholder="e.g. Reduce average ticket resolution time" {...register('title')} />}
          </FormField>
          <FormField label="Description" error={errors.description}>
            {({ id }) => <Textarea id={id} rows={3} {...register('description')} />}
          </FormField>
          <FormGrid>
            <FormField label="Category" error={errors.category}>
              {({ id }) => <Select id={id} options={GOAL_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} {...register('category')} />}
            </FormField>
            <FormField label="Due date" error={errorAt(errors, 'dueDate')}>
              {({ id, invalid }) => <Input id={id} type="date" aria-invalid={invalid} {...register('dueDate')} />}
            </FormField>
            {canAssign && !editing && (
              <FormField label="Employee" required error={errors.employeeId}>
                {({ id, invalid }) => (
                  <Controller
                    control={control}
                    name="employeeId"
                    render={({ field }) => (
                      <EmployeePicker
                        id={id}
                        invalid={invalid}
                        value={(field.value as string | undefined) || null}
                        onChange={(v) => field.onChange(typeof v === 'string' ? v : '')}
                        selectedLabels={{
                          ...(user?.employeeId ? { [user.employeeId]: `${fullName(user)} (you)` } : {}),
                          ...(defaultEmployeeId && defaultEmployeeLabel ? { [defaultEmployeeId]: defaultEmployeeLabel } : {}),
                        }}
                      />
                    )}
                  />
                )}
              </FormField>
            )}
            <FormField label="Performance cycle" error={errorAt(errors, 'cycleId')} hint={!managesThis ? 'You can add your own goals to cycles in goal setting or in progress.' : undefined}>
              {({ id }) => <Select id={id} options={cycleOptions} placeholder="No cycle" {...register('cycleId')} />}
            </FormField>
            {editing && managesThis && (
              <FormField label="Status" error={errors.status}>
                {({ id }) => <Select id={id} options={GOAL_STATUS.map((s) => ({ value: s, label: label(s) }))} {...register('status')} />}
              </FormField>
            )}
          </FormGrid>
        </FormSection>

        <FormSection title="Measurement" description="How progress is judged. Weight is this goal's share of the employee's goal score in the cycle.">
          <FormGrid cols={3}>
            <FormField label="Weight (%)" error={errors.weight}>
              {({ id, invalid }) => <Input id={id} type="number" min={0} max={100} step={5} inputMode="numeric" aria-invalid={invalid} {...register('weight')} />}
            </FormField>
            <FormField label="Target value" error={errorAt(errors, 'targetValue')}>
              {({ id, invalid }) => (
                <Input id={id} type="number" step="any" aria-invalid={invalid} {...register('targetValue', { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? undefined : Number(v)) })} />
              )}
            </FormField>
            <FormField label="Unit" error={errors.metricUnit}>
              {({ id }) => <Input id={id} placeholder="%, hours, deals…" {...register('metricUnit')} />}
            </FormField>
          </FormGrid>
          <FormField label="Target / success criteria" error={errors.target}>
            {({ id }) => <Input id={id} placeholder="e.g. Under 4 hours by end of quarter" {...register('target')} />}
          </FormField>
          {employeeId && <WeightMeter allocated={weightInfo.allocated} adding={weight} />}
        </FormSection>

        <FormSection
          title="Key results"
          description={category === 'OKR' ? 'Measurable outcomes that define this objective. Progress can be rolled up from them.' : 'Optional milestones or measurable outcomes.'}
        >
          {keyResults.fields.length === 0 && <p className="text-sm text-muted">No key results yet.</p>}
          <ol className="space-y-2">
            {keyResults.fields.map((f, i) => (
              <li key={f.id} className="flex items-start gap-2">
                <span className="mt-2 w-6 shrink-0 text-right text-xs font-medium text-muted tabular-nums">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <FormField error={errorAt(errors, `keyResults.${i}.title`)}>
                    {({ id, invalid }) => <Input id={id} aria-label={`Key result ${i + 1}`} aria-invalid={invalid} placeholder="Describe the measurable result" {...register(`keyResults.${i}.title`)} />}
                  </FormField>
                </div>
                <Button variant="ghost" size="icon" aria-label={`Remove key result ${i + 1}`} onClick={() => keyResults.remove(i)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ol>
          {keyResults.fields.length < 10 && (
            <Button variant="outline" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => keyResults.append({ title: '', progress: 0 })}>
              Add key result
            </Button>
          )}
        </FormSection>
      </form>
    </Drawer>
  );
};
