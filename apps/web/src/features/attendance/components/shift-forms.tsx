import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { shiftAssignmentSchema, shiftSchema } from '@stencil/shared';
import { EmployeePicker } from '@/components/common/controls';
import { applyServerErrors, FormError, FormField, FormGrid, FormSection } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Drawer, Modal } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { cn, shiftRange } from '@/lib/utils';
import { toOptions, useAllOf } from '@/features/employees/api';
import { useAllShifts, useAssignShift, useSaveShift, type Shift } from '../api';
import { dateKeyIn, useOrgTimezone } from '../lib';

/* ------------------------------ Shift form ------------------------------ */

type ShiftValues = z.input<typeof shiftSchema>;
const SHIFT_FIELDS = ['name', 'code', 'startTime', 'endTime', 'gracePeriodMinutes', 'breakDurationMinutes', 'workingHours', 'halfDayHours', 'nightShift', 'flexible', 'color', 'isDefault'];
const PRESET_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#64748b'];

const toValues = (s?: Shift): ShiftValues => ({
  name: s?.name ?? '',
  code: s?.code ?? '',
  startTime: s?.startTime ?? '09:00',
  endTime: s?.endTime ?? '18:00',
  gracePeriodMinutes: s?.gracePeriodMinutes ?? 15,
  breakDurationMinutes: s?.breakDurationMinutes ?? 60,
  workingHours: s?.workingHours ?? 8,
  halfDayHours: s?.halfDayHours ?? 4,
  nightShift: s?.nightShift ?? false,
  flexible: s?.flexible ?? false,
  color: s?.color ?? '#6366f1',
  isDefault: s?.isDefault ?? false,
});

export const ShiftFormDrawer = ({ open, shift, onClose }: { open: boolean; shift?: Shift | null; onClose: () => void }) => {
  const editing = !!shift;
  const save = useSaveShift(shift?._id);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<ShiftValues>({ resolver: zodResolver(shiftSchema), defaultValues: toValues() });
  const { register, handleSubmit, reset, formState, setError, control, watch } = form;
  const errors = formState.errors;
  const start = watch('startTime');
  const end = watch('endTime');
  const spansMidnight = !!start && !!end && end <= start;

  useEffect(() => {
    if (open) {
      setServerError(null);
      reset(toValues(shift ?? undefined));
    }
  }, [open, shift, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const payload: Partial<ShiftValues> = { ...shiftSchema.parse(values) };
    // The default flag can only be moved to another shift, never unset.
    if (editing && (shift?.isDefault || !payload.isDefault)) delete payload.isDefault;
    try {
      const res = await save.mutateAsync(payload);
      toast.success(res.message ?? (editing ? 'Shift updated' : 'Shift created'));
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, SHIFT_FIELDS));
    }
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${shift?.name}` : 'New shift'}
      description="Times are in the organization timezone. A shift ending before it starts runs overnight."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            {editing ? 'Save changes' : 'Create shift'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-7">
        <FormError error={serverError} />
        <FormSection title="Details">
          <FormGrid>
            <FormField label="Name" required error={errors.name}>
              {({ id, invalid }) => <Input id={id} aria-invalid={invalid} placeholder="General shift" {...register('name')} />}
            </FormField>
            <FormField label="Code" required error={errors.code} hint="Up to 12 letters, digits, - or _">
              {({ id, invalid }) => <Input id={id} aria-invalid={invalid} className="uppercase" placeholder="GEN" {...register('code')} />}
            </FormField>
          </FormGrid>
          <FormField label="Color" error={errors.color}>
            {() => (
              <Controller
                control={control}
                name="color"
                render={({ field }) => (
                  <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Shift color">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={field.value === c}
                        aria-label={c}
                        onClick={() => field.onChange(c)}
                        className={cn('h-8 w-8 rounded-full ring-offset-2 ring-offset-surface transition', field.value === c ? 'ring-2 ring-fg' : 'hover:scale-110')}
                        style={{ background: c }}
                      />
                    ))}
                    <input type="color" aria-label="Custom color" value={field.value ?? '#6366f1'} onChange={(e) => field.onChange(e.target.value)} className="h-8 w-10 cursor-pointer rounded-md border border-line-strong bg-surface p-0.5" />
                  </div>
                )}
              />
            )}
          </FormField>
        </FormSection>

        <FormSection title="Timing">
          <FormGrid>
            <FormField label="Start time" required error={errors.startTime}>
              {({ id, invalid }) => <Input id={id} type="time" aria-invalid={invalid} {...register('startTime')} />}
            </FormField>
            <FormField label="End time" required error={errors.endTime} hint={spansMidnight ? 'Ends the next day (overnight shift).' : undefined}>
              {({ id, invalid }) => <Input id={id} type="time" aria-invalid={invalid} {...register('endTime')} />}
            </FormField>
            <FormField label="Working hours" error={errors.workingHours}>
              {({ id, invalid }) => <Input id={id} type="number" step="0.5" min={0.5} max={24} aria-invalid={invalid} {...register('workingHours')} />}
            </FormField>
            <FormField label="Half-day hours" error={errors.halfDayHours}>
              {({ id, invalid }) => <Input id={id} type="number" step="0.5" min={0} max={24} aria-invalid={invalid} {...register('halfDayHours')} />}
            </FormField>
            <FormField label="Grace period (min)" error={errors.gracePeriodMinutes} hint="Arrivals within this window are not late.">
              {({ id, invalid }) => <Input id={id} type="number" min={0} max={240} aria-invalid={invalid} {...register('gracePeriodMinutes')} />}
            </FormField>
            <FormField label="Break duration (min)" error={errors.breakDurationMinutes}>
              {({ id, invalid }) => <Input id={id} type="number" min={0} max={480} aria-invalid={invalid} {...register('breakDurationMinutes')} />}
            </FormField>
          </FormGrid>
        </FormSection>

        <FormSection title="Options">
          <div className="space-y-3">
            <Checkbox label="Night shift" description="Records belong to the day the shift starts." {...register('nightShift')} />
            <Checkbox label="Flexible timing" description="No late marking; only total hours count." {...register('flexible')} />
            <Checkbox
              label="Default shift"
              description={shift?.isDefault ? 'This is the default shift. Make another shift default to change it.' : 'Used for employees without an assigned shift.'}
              disabled={!!shift?.isDefault}
              {...register('isDefault')}
            />
          </div>
        </FormSection>
      </form>
    </Drawer>
  );
};

/* ---------------------------- Assign dialog ---------------------------- */

type AssignValues = z.input<typeof shiftAssignmentSchema>;

export const AssignShiftModal = ({ open, onClose, initialShiftId }: { open: boolean; onClose: () => void; initialShiftId?: string }) => {
  const timeZone = useOrgTimezone();
  const shifts = useAllShifts();
  const departments = useAllOf('departments');
  const assign = useAssignShift();
  const [target, setTarget] = useState<'employees' | 'department'>('employees');
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<AssignValues>({ resolver: zodResolver(shiftAssignmentSchema) });
  const { register, handleSubmit, reset, formState, setError, control, setValue } = form;
  const errors = formState.errors;

  useEffect(() => {
    if (open) {
      setServerError(null);
      setTarget('employees');
      reset({ shiftId: initialShiftId ?? '', employeeIds: [], departmentId: undefined, effectiveFrom: dateKeyIn(timeZone), effectiveTo: '' });
    }
  }, [open, initialShiftId, reset, timeZone]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const input: AssignValues = {
      shiftId: values.shiftId,
      effectiveFrom: values.effectiveFrom,
      effectiveTo: values.effectiveTo || undefined,
      ...(target === 'employees' ? { employeeIds: values.employeeIds } : { departmentId: values.departmentId }),
    };
    try {
      const res = await assign.mutateAsync(input);
      toast.success(`${res.message ?? 'Shift assigned'} · ${res.data.assigned} employee${res.data.assigned === 1 ? '' : 's'}`);
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, ['shiftId', 'employeeIds', 'departmentId', 'effectiveFrom', 'effectiveTo']));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign shift"
      description="Future assignments starting on or after this date are replaced; the current one is closed."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            Assign
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError error={serverError} />
        <FormField label="Shift" required error={errors.shiftId}>
          {({ id, invalid }) => (
            <Select
              id={id}
              aria-invalid={invalid}
              placeholder="Select a shift…"
              options={(shifts.data ?? []).map((s) => ({ value: s._id, label: `${s.name} (${shiftRange(s.startTime, s.endTime)})` }))}
              {...register('shiftId')}
            />
          )}
        </FormField>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-fg">Assign to</legend>
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {(['employees', 'department'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={target === t}
                onClick={() => {
                  setTarget(t);
                  if (t === 'employees') setValue('departmentId', undefined);
                  else setValue('employeeIds', []);
                }}
                className={cn(
                  'h-10 rounded-lg border text-sm font-medium transition-colors',
                  target === t ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200' : 'border-line-strong text-fg-2 hover:bg-surface-2',
                )}
              >
                {t === 'employees' ? 'Employees' : 'Whole department'}
              </button>
            ))}
          </div>
        </fieldset>
        {target === 'employees' ? (
          <FormField label="Employees" required error={errors.employeeIds as { message?: string } | undefined}>
            {({ id, invalid }) => (
              <Controller
                control={control}
                name="employeeIds"
                render={({ field }) => <EmployeePicker id={id} multiple invalid={invalid} placeholder="Select employees…" value={field.value ?? []} onChange={(v) => field.onChange(Array.isArray(v) ? v : [])} />}
              />
            )}
          </FormField>
        ) : (
          <FormField label="Department" required error={errors.departmentId ?? (errors.employeeIds as { message?: string } | undefined)}>
            {({ id, invalid }) => (
              <Select id={id} aria-invalid={invalid} placeholder="Select a department…" options={toOptions(departments.data)} {...register('departmentId', { setValueAs: (v: string) => v || undefined })} />
            )}
          </FormField>
        )}
        <FormGrid>
          <FormField label="Effective from" required error={errors.effectiveFrom}>
            {({ id, invalid }) => <Input id={id} type="date" aria-invalid={invalid} {...register('effectiveFrom')} />}
          </FormField>
          <FormField label="Effective to" error={errors.effectiveTo} hint="Leave empty for a permanent change.">
            {({ id, invalid }) => <Input id={id} type="date" aria-invalid={invalid} {...register('effectiveTo')} />}
          </FormField>
        </FormGrid>
      </form>
    </Modal>
  );
};
