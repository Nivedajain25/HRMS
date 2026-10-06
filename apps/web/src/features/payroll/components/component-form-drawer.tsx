import { useEffect, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Plus, Trash2 } from 'lucide-react';
import { SALARY_CALCULATION_TYPES, SALARY_COMPONENT_TYPES, salaryComponentSchema } from '@stencil/shared';
import { applyServerErrors, errorAt, FormError, FormField, FormGrid, FormSection } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { Drawer } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { useSaveComponent, type SalaryComponent } from '../api';
import { CALC_LABELS, isPercent, useOrgCurrency } from '../lib';

type FormIn = z.input<typeof salaryComponentSchema>;
type FormOut = z.output<typeof salaryComponentSchema>;

const toForm = (c?: SalaryComponent): FormIn => ({
  name: c?.name ?? '',
  code: c?.code ?? '',
  type: c?.type ?? 'EARNING',
  calculationType: c?.calculationType ?? 'FIXED',
  defaultValue: c?.defaultValue ?? 0,
  maxAmount: c?.maxAmount ?? 0,
  baseCap: c?.baseCap ?? 0,
  eligibilityMaxGross: c?.eligibilityMaxGross ?? 0,
  slabs: (c?.slabs ?? []).map((s) => ({ from: s.from, to: s.to, amount: s.amount })),
  taxable: c?.taxable ?? true,
  prorate: c?.prorate ?? true,
  isStatutory: c?.isStatutory ?? false,
  employerContribution: c?.employerContribution ?? false,
  order: c?.order ?? 100,
  description: c?.description ?? '',
  active: c?.active ?? true,
});

const nullableNumber = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));

const FIELDS = ['name', 'code', 'type', 'calculationType', 'defaultValue', 'maxAmount', 'baseCap', 'eligibilityMaxGross', 'slabs', 'taxable', 'prorate', 'isStatutory', 'employerContribution', 'order', 'description', 'active'];

export const ComponentFormDrawer = ({ component, onClose }: { component?: SalaryComponent; onClose: () => void }) => {
  const editing = !!component;
  const isBasic = component?.code === 'BASIC';
  const currency = useOrgCurrency();
  const save = useSaveComponent(component?._id);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FormIn, unknown, FormOut>({ resolver: zodResolver(salaryComponentSchema), defaultValues: toForm(component) });
  const { register, control, handleSubmit, formState, setError, reset } = form;
  const errors = formState.errors;
  const slabs = useFieldArray({ control, name: 'slabs' });
  const calculationType = useWatch({ control, name: 'calculationType' });
  const type = useWatch({ control, name: 'type' });

  useEffect(() => {
    reset(toForm(component));
  }, [component, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const body: Record<string, unknown> = { ...values, description: values.description ?? '' };
    try {
      const res = await save.mutateAsync(body);
      toast.success(res.message ?? 'Salary component saved');
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, FIELDS));
    }
  });

  const num = (name: 'defaultValue' | 'maxAmount' | 'baseCap' | 'eligibilityMaxGross' | 'order', lbl: string, hint?: string, disabled?: boolean) => (
    <FormField label={lbl} error={errorAt(errors, name)} hint={hint}>
      {({ id, invalid }) => <Input id={id} type="number" inputMode="decimal" min={0} step="any" disabled={disabled} aria-invalid={invalid} {...register(name)} />}
    </FormField>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      title={editing ? `Edit ${component.name}` : 'New salary component'}
      description={isBasic ? 'BASIC is a system component: its code, type and calculation are fixed.' : 'Earnings, deductions and employer contributions used in salary structures.'}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            {editing ? 'Save changes' : 'Create component'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-8">
        <FormError error={serverError} />
        <FormSection title="Definition">
          <FormGrid>
            <FormField label="Name" required error={errors.name}>
              {({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...register('name')} />}
            </FormField>
            <FormField label="Code" required error={errors.code} hint="Uppercase letters, digits and _ (max 16)">
              {({ id, invalid }) =>
                isBasic ? <Input id={id} className="font-mono" value="BASIC" readOnly disabled /> : <Input id={id} className="font-mono uppercase" aria-invalid={invalid} {...register('code')} />
              }
            </FormField>
            <FormField label="Type" error={errors.type}>
              {({ id }) =>
                isBasic ? <Input id={id} value={label('EARNING')} readOnly disabled /> : <Select id={id} options={SALARY_COMPONENT_TYPES.map((t) => ({ value: t, label: label(t) }))} {...register('type')} />
              }
            </FormField>
            <FormField label="Calculation" error={errors.calculationType}>
              {({ id }) =>
                isBasic ? (
                  <Input id={id} value={CALC_LABELS.FIXED} readOnly disabled />
                ) : (
                  <Select id={id} options={SALARY_CALCULATION_TYPES.map((t) => ({ value: t, label: CALC_LABELS[t] }))} {...register('calculationType')} />
                )
              }
            </FormField>
            {calculationType !== 'SLAB' &&
              num(
                'defaultValue',
                isPercent(calculationType) ? 'Default percentage' : `Default amount (${currency})`,
                isPercent(calculationType) ? 'Between 0 and 100. Pre-filled in new salary structures.' : 'Monthly amount pre-filled in new salary structures.',
              )}
            {num('order', 'Display order', 'Lower numbers are evaluated and shown first.')}
          </FormGrid>
        </FormSection>

        {calculationType === 'SLAB' && (
          <FormSection
            title="Slabs"
            description={
              type === 'EARNING'
                ? 'Earnings: the slab matching the monthly basic applies. Bounds are inclusive; the first matching slab wins. Leave “To” empty for no upper bound.'
                : 'Deductions / contributions: the slab matching the monthly gross applies. Bounds are inclusive; the first matching slab wins. Leave “To” empty for no upper bound.'
            }
          >
            {errorAt(errors, 'slabs')?.message && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {errorAt(errors, 'slabs')?.message}
              </p>
            )}
            <div className="space-y-2">
              {slabs.fields.map((f, i) => (
                <div key={f.id} className="grid grid-cols-[1fr_1fr_1fr_auto] items-start gap-2">
                  <FormField label={i === 0 ? 'From' : undefined} error={errorAt(errors, `slabs.${i}.from`)}>
                    {({ id, invalid }) => <Input id={id} type="number" min={0} step="any" aria-label={`Slab ${i + 1} from`} aria-invalid={invalid} {...register(`slabs.${i}.from`)} />}
                  </FormField>
                  <FormField label={i === 0 ? 'To' : undefined} error={errorAt(errors, `slabs.${i}.to`)}>
                    {({ id, invalid }) => (
                      <Input id={id} type="number" min={0} step="any" placeholder="∞" aria-label={`Slab ${i + 1} to`} aria-invalid={invalid} {...register(`slabs.${i}.to`, { setValueAs: nullableNumber })} />
                    )}
                  </FormField>
                  <FormField label={i === 0 ? 'Amount' : undefined} error={errorAt(errors, `slabs.${i}.amount`)}>
                    {({ id, invalid }) => <Input id={id} type="number" min={0} step="any" aria-label={`Slab ${i + 1} amount`} aria-invalid={invalid} {...register(`slabs.${i}.amount`)} />}
                  </FormField>
                  <Button variant="ghost" size="icon" className={i === 0 ? 'mt-7' : undefined} aria-label={`Remove slab ${i + 1}`} onClick={() => slabs.remove(i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              disabled={slabs.fields.length >= 20}
              onClick={() => {
                const last = slabs.fields.length ? form.getValues(`slabs.${slabs.fields.length - 1}.to`) : null;
                slabs.append({ from: last !== null && last !== undefined && last !== '' ? Number(last) + 1 : 0, to: null, amount: 0 });
              }}
            >
              Add slab
            </Button>
          </FormSection>
        )}

        <FormSection title="Limits" description="Use 0 for no limit.">
          <FormGrid>
            {num('maxAmount', `Maximum monthly amount (${currency})`, 'Caps the computed amount.')}
            {num('baseCap', `Base cap (${currency})`, 'For percentages: the base is capped at this value (e.g. 12% of basic up to 15,000).')}
            {num('eligibilityMaxGross', `Eligible up to gross (${currency})`, 'Only applies while monthly gross is at or below this value.')}
          </FormGrid>
        </FormSection>

        <FormSection title="Behaviour">
          <div className="grid gap-4 sm:grid-cols-2">
            <Checkbox label="Taxable" description="Counts as taxable income." {...register('taxable')} />
            <Checkbox label="Prorate" description="Reduced for loss-of-pay and partial months." {...register('prorate')} />
            <Checkbox label="Statutory" description="Mandated by law (e.g. provident fund, social security)." {...register('isStatutory')} />
            {!isBasic && (
              <>
                <Checkbox label="Employer contribution" description="Paid by the employer: part of CTC, not gross or net pay." {...register('employerContribution')} />
                <Checkbox label="Active" description="Inactive components cannot be added to new structures." {...register('active')} />
              </>
            )}
          </div>
        </FormSection>

        <FormField label="Description" error={errors.description}>
          {({ id }) => <Textarea id={id} rows={2} maxLength={300} {...register('description')} />}
        </FormField>
      </form>
    </Drawer>
  );
};
