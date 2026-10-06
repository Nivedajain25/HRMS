import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { Info, Loader2 } from 'lucide-react';
import { objectId, salaryStructureSchema } from '@stencil/shared';
import { EmployeePicker } from '@/components/common/controls';
import { errorAt, FormError, FormField, FormGrid, FormSection } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Badge, ErrorState, Skeleton } from '@/components/ui/display';
import { Input, Textarea } from '@/components/ui/input';
import { Drawer } from '@/components/ui/overlay';
import { useDebounce } from '@/hooks/use-debounce';
import { toApiError } from '@/lib/api';
import { cn, formatDate, formatMoney, fullName, toDateKey } from '@/lib/utils';
import { useActiveComponents, useCreateStructure, useEmployeeSalary, useSalaryPreview, type SalaryComponent, type SalaryStructure } from '../api';
import { CALC_LABELS, isPercent, useOrgCurrency } from '../lib';
import { LineList } from './payroll-ui';

const formSchema = salaryStructureSchema.omit({ components: true }).extend({
  components: z.array(
    z.object({
      componentId: objectId,
      value: z.coerce.number({ error: 'Enter a number' }).min(0, 'Must be zero or more').max(1e9),
      included: z.boolean(),
    }),
  ),
});
type FormIn = z.input<typeof formSchema>;
type FormOut = z.output<typeof formSchema>;

const addDays = (key: string, days: number) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const sortComponents = (rows: SalaryComponent[]) =>
  rows
    .filter((c) => c.code !== 'BASIC')
    .sort((a, b) => {
      const rank = (c: SalaryComponent) => (c.employerContribution ? 2 : c.type === 'EARNING' ? 0 : 1);
      return rank(a) - rank(b) || a.order - b.order || a.name.localeCompare(b.name);
    });

const slabText = (c: SalaryComponent, currency: string) =>
  c.slabs.map((s) => `${formatMoney(s.from, currency)}–${s.to === null ? '∞' : formatMoney(s.to, currency)}: ${formatMoney(s.amount, currency)}`).join(' · ');

const buildDefaults = (components: SalaryComponent[], latest: SalaryStructure | null, employeeId: string, keep?: Partial<FormIn>): FormIn => {
  const today = toDateKey(new Date());
  const latestKey = latest?.effectiveFrom.slice(0, 10);
  const effectiveFrom = latestKey && latestKey >= today ? addDays(latestKey, 1) : today;
  const byId = new Map((latest?.components ?? []).map((l) => [String(l.componentId), l]));
  return {
    employeeId,
    effectiveFrom,
    basic: latest?.basic ?? 0,
    reason: keep?.reason ?? '',
    components: components.map((c) => {
      const line = byId.get(c._id);
      return {
        componentId: c._id,
        // First structure: start from the organization's template; revisions start from the latest version.
        included: latest ? !!line : true,
        value: line ? line.value : c.defaultValue,
      };
    }),
  };
};

export const SalaryRevisionDrawer = ({ open, onClose, employeeId: lockedEmployee, employeeLabel }: { open: boolean; onClose: () => void; employeeId?: string; employeeLabel?: string }) => {
  const currency = useOrgCurrency();
  const componentsQuery = useActiveComponents(open);
  const components = useMemo(() => sortComponents(componentsQuery.data ?? []), [componentsQuery.data]);
  const save = useCreateStructure();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(formSchema),
    defaultValues: { employeeId: lockedEmployee ?? '', effectiveFrom: toDateKey(new Date()), basic: 0, reason: '', components: [] },
  });
  const { register, control, handleSubmit, reset, setError, getValues, formState } = form;
  const errors = formState.errors;

  const employeeId = useWatch({ control, name: 'employeeId' }) as string;
  const salary = useEmployeeSalary(open && employeeId ? employeeId : undefined);
  const latest = salary.data ? (salary.data.upcoming ?? salary.data.current ?? salary.data.versions[0] ?? null) : null;

  // Initialize (or re-initialize when the employee changes) once master data and history are loaded.
  const initKey = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      initKey.current = null;
      return;
    }
    if (!componentsQuery.data) return;
    if (employeeId && salary.isLoading) return;
    const key = `${employeeId}:${latest?._id ?? 'none'}:${components.length}`;
    if (initKey.current === key) return;
    initKey.current = key;
    setServerError(null);
    reset(buildDefaults(components, latest, employeeId || lockedEmployee || '', { reason: getValues('reason') as string }));
  }, [open, componentsQuery.data, components, employeeId, salary.isLoading, latest, lockedEmployee, reset, getValues]);

  useEffect(() => {
    if (open) setServerError(null);
  }, [open]);

  const watchedBasic = useWatch({ control, name: 'basic' });
  const watchedComponents = useWatch({ control, name: 'components' });
  const previewBody = useMemo(() => {
    const basic = Number(watchedBasic);
    if (!Number.isFinite(basic) || basic < 0) return null;
    const rows = (watchedComponents ?? [])
      .filter((c) => c?.included)
      .map((c) => ({ componentId: c.componentId, value: Math.max(0, Number(c.value) || 0) }));
    return { basic, components: rows };
  }, [watchedBasic, watchedComponents]);
  const debouncedBody = useDebounce(previewBody, 400);
  const preview = useSalaryPreview(open && componentsQuery.data ? debouncedBody : null);
  const amountOf = (componentId: string) =>
    [...(preview.data?.earnings ?? []), ...(preview.data?.deductions ?? []), ...(preview.data?.employerContributions ?? [])].find((l) => l.componentId === componentId)?.amount;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const included: { index: number; componentId: string; value: number }[] = [];
    let invalid = false;
    values.components.forEach((c, index) => {
      if (!c.included) return;
      const master = components[index];
      if (master && isPercent(master.calculationType) && c.value > 100) {
        setError(`components.${index}.value`, { message: 'Percentage cannot exceed 100' });
        invalid = true;
      }
      included.push({ index, componentId: c.componentId, value: master?.calculationType === 'SLAB' ? 0 : c.value });
    });
    if (invalid) return;
    try {
      const res = await save.mutateAsync({
        employeeId: values.employeeId,
        effectiveFrom: values.effectiveFrom,
        basic: values.basic,
        reason: values.reason,
        components: included.map(({ componentId, value }) => ({ componentId, value })),
      });
      toast.success(res.message ?? 'Salary structure saved');
      onClose();
    } catch (err) {
      const apiError = toApiError(err);
      if (apiError.code === 'EFFECTIVE_DATE_INVALID') {
        setError('effectiveFrom', { type: 'server', message: apiError.message });
        return;
      }
      let unmatched = apiError.fieldErrors.length === 0;
      for (const fe of apiError.fieldErrors) {
        const m = /^components\.(\d+)\.(componentId|value)$/.exec(fe.path ?? '');
        if (m) {
          const formIndex = included[Number(m[1])]?.index;
          if (formIndex !== undefined) {
            setError(`components.${formIndex}.value`, { type: 'server', message: fe.message });
            continue;
          }
        }
        if (fe.path && ['employeeId', 'effectiveFrom', 'basic', 'reason'].includes(fe.path)) {
          setError(fe.path as 'employeeId' | 'effectiveFrom' | 'basic' | 'reason', { type: 'server', message: fe.message });
          continue;
        }
        unmatched = true;
      }
      if (unmatched) setServerError(apiError.message);
    }
  });

  const latestKey = latest?.effectiveFrom.slice(0, 10);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Revise salary"
      description={employeeLabel ? `New salary structure version for ${employeeLabel}` : 'Creates a new salary structure version. Earlier versions are kept for history.'}
      width="max-w-5xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting} disabled={!componentsQuery.data}>
            Save salary structure
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <FormError error={serverError} />
          <FormSection title="Employee & effective date">
            <FormGrid>
              <FormField label="Employee" required error={errors.employeeId}>
                {({ id, invalid }) =>
                  lockedEmployee ? (
                    <Input id={id} value={employeeLabel ?? (salary.data ? `${fullName(salary.data.employee)} (${salary.data.employee.employeeId})` : '')} readOnly disabled />
                  ) : (
                    <Controller
                      control={control}
                      name="employeeId"
                      render={({ field }) => <EmployeePicker id={id} invalid={invalid} value={(field.value as string) || null} onChange={(v) => field.onChange((v as string | null) ?? '')} />}
                    />
                  )
                }
              </FormField>
              <FormField
                label="Effective from"
                required
                error={errors.effectiveFrom}
                hint={latestKey ? `Must be after ${formatDate(latestKey)} (latest version).` : 'First salary structure for this employee.'}
              >
                {({ id, invalid }) => <Input id={id} type="date" aria-invalid={invalid} min={latestKey ? addDays(latestKey, 1) : undefined} {...register('effectiveFrom')} />}
              </FormField>
              <FormField label="Basic salary (monthly)" required error={errors.basic} hint={`Amount in ${currency}`}>
                {({ id, invalid }) => <Input id={id} type="number" inputMode="decimal" min={0} step="any" aria-invalid={invalid} {...register('basic')} />}
              </FormField>
            </FormGrid>
            {employeeId && salary.error && <p className="text-sm text-red-600 dark:text-red-400">{salary.error.message}</p>}
          </FormSection>

          <FormSection title="Components" description="Tick the components that apply. Amounts are monthly; percentages apply to basic or gross as configured.">
            {componentsQuery.isLoading || (employeeId && salary.isLoading) ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-14" />
                ))}
              </div>
            ) : componentsQuery.error ? (
              <ErrorState message={componentsQuery.error.message} onRetry={() => componentsQuery.refetch()} />
            ) : !components.length ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-muted">No active salary components besides basic. Add components under Salary → Components.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {components.map((c, index) => (
                  <ComponentRow key={c._id} component={c} index={index} form={form} currency={currency} amount={amountOf(c._id)} error={errorAt(errors, `components.${index}.value`)?.message} />
                ))}
              </ul>
            )}
          </FormSection>

          <FormField label="Reason for change" required error={errors.reason} hint="Recorded in the salary history and audit log.">
            {({ id, invalid }) => <Textarea id={id} rows={2} maxLength={300} aria-invalid={invalid} placeholder="e.g. Annual appraisal 2026" {...register('reason')} />}
          </FormField>
        </div>

        <aside aria-label="Live preview" aria-live="polite" className="lg:sticky lg:top-0 lg:self-start">
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-fg">Live preview</h3>
              {preview.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted" aria-label="Updating preview" />}
            </div>
            {preview.error ? (
              <p className="text-sm text-red-600 dark:text-red-400">{preview.error.message}</p>
            ) : !preview.data ? (
              <div className="space-y-2">
                <Skeleton className="h-6" />
                <Skeleton className="h-6" />
                <Skeleton className="h-20" />
              </div>
            ) : (
              <PreviewPanel data={preview.data} stale={preview.isPlaceholderData} />
            )}
          </div>
        </aside>
      </form>
    </Drawer>
  );
};

const ComponentRow = ({
  component: c,
  index,
  form,
  currency,
  amount,
  error,
}: {
  component: SalaryComponent;
  index: number;
  form: UseFormReturn<FormIn, unknown, FormOut>;
  currency: string;
  amount?: number;
  error?: string;
}) => {
  const included = useWatch({ control: form.control, name: `components.${index}.included` });
  const inputId = `component-${c._id}`;
  return (
    <li className={cn('flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-3', !included && 'bg-surface-2/60')}>
      <input
        type="checkbox"
        id={`${inputId}-inc`}
        className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
        aria-label={`Include ${c.name}`}
        {...form.register(`components.${index}.included`)}
      />
      <label htmlFor={`${inputId}-inc`} className={cn('min-w-0 flex-1 cursor-pointer', !included && 'opacity-60')}>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-fg">{c.name}</span>
          <Badge tone={c.employerContribution ? 'purple' : c.type === 'EARNING' ? 'green' : 'red'}>{c.employerContribution ? 'Employer' : c.type === 'EARNING' ? 'Earning' : 'Deduction'}</Badge>
          {c.isStatutory && <Badge tone="blue">Statutory</Badge>}
        </span>
        <span className="mt-0.5 block text-xs text-muted">
          <span className="font-mono">{c.code}</span> · {CALC_LABELS[c.calculationType]}
          {c.maxAmount > 0 && ` · max ${formatMoney(c.maxAmount, currency)}`}
          {c.baseCap > 0 && ` · base capped at ${formatMoney(c.baseCap, currency)}`}
          {c.eligibilityMaxGross > 0 && ` · only if gross ≤ ${formatMoney(c.eligibilityMaxGross, currency)}`}
        </span>
        {c.calculationType === 'SLAB' && c.slabs.length > 0 && <span className="mt-0.5 block text-xs text-muted">{slabText(c, currency)}</span>}
      </label>
      <div className="flex w-full items-start gap-3 pl-7 sm:w-auto sm:pl-0">
        <div className="w-full sm:w-36">
          {c.calculationType === 'SLAB' ? (
            <p className="flex h-9 items-center rounded-lg border border-dashed border-line px-3 text-xs text-muted">Slab-based</p>
          ) : (
            <Input
              id={inputId}
              type="number"
              inputMode="decimal"
              min={0}
              max={isPercent(c.calculationType) ? 100 : undefined}
              step="any"
              readOnly={!included}
              aria-disabled={!included}
              aria-invalid={!!error}
              aria-label={`${c.name} ${isPercent(c.calculationType) ? 'percentage' : 'amount'}`}
              className={cn(!included && 'bg-surface-3 text-muted', 'pr-9')}
              rightSlot={<span className="text-xs text-muted">{isPercent(c.calculationType) ? '%' : currency}</span>}
              {...form.register(`components.${index}.value`)}
            />
          )}
          {error && (
            <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
        <p className="w-28 shrink-0 pt-2 text-right text-sm font-medium text-fg tabular-nums" aria-label={`${c.name} monthly amount`}>
          {included ? (amount !== undefined ? formatMoney(amount, currency) : '—') : <span className="text-muted">Excluded</span>}
        </p>
      </div>
    </li>
  );
};

const PreviewPanel = ({ data, stale }: { data: NonNullable<ReturnType<typeof useSalaryPreview>['data']>; stale: boolean }) => {
  const c = data.currency;
  const rows = [
    { label: 'Monthly gross', value: data.monthlyGross },
    { label: 'Monthly deductions', value: data.monthlyDeductions },
    { label: 'Employer contributions', value: data.monthlyEmployerContributions },
  ];
  return (
    <div className={cn('space-y-4 transition-opacity', stale && 'opacity-60')}>
      <div className="rounded-lg bg-surface px-3 py-3 ring-1 ring-line">
        <p className="text-xs text-muted">Monthly net pay</p>
        <p className="text-2xl font-semibold tracking-tight text-fg tabular-nums">{formatMoney(data.monthlyNet, c)}</p>
        <p className="mt-2 text-xs text-muted">Annual CTC</p>
        <p className="text-lg font-semibold text-brand-700 tabular-nums dark:text-brand-300">{formatMoney(data.annualCtc, c)}</p>
      </div>
      <dl className="space-y-1.5 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-3">
            <dt className="text-muted">{r.label}</dt>
            <dd className="font-medium text-fg tabular-nums">{formatMoney(r.value, c)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Annual gross</dt>
          <dd className="font-medium text-fg tabular-nums">{formatMoney(data.annualGross, c)}</dd>
        </div>
      </dl>
      <LineList title="Earnings" currency={c} lines={data.earnings.map((l, i) => ({ key: `e${i}`, name: l.name, amount: l.amount }))} />
      <LineList title="Deductions" currency={c} tone="negative" empty="No deductions" lines={data.deductions.map((l, i) => ({ key: `d${i}`, name: l.name, amount: l.amount }))} />
      {data.employerContributions.length > 0 && (
        <LineList title="Employer contributions" currency={c} tone="muted" lines={data.employerContributions.map((l, i) => ({ key: `c${i}`, name: l.name, amount: l.amount }))} />
      )}
      <p className="flex gap-1.5 text-xs text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        CTC = 12 × (gross + employer contributions), full month without loss of pay.
      </p>
    </div>
  );
};
