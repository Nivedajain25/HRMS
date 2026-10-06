import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { ArrowRight, Minus, Plus, RotateCcw } from 'lucide-react';
import { leaveBalanceAdjustSchema } from '@stencil/shared';
import { EmployeePicker } from '@/components/common/controls';
import { applyServerErrors, FormError, FormField, FormGrid } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { formatNum, useActiveLeaveTypes, useAdjustBalance, useCarryForward, useLeaveBalances } from '../api';

type AdjIn = z.input<typeof leaveBalanceAdjustSchema>;
type AdjOut = z.output<typeof leaveBalanceAdjustSchema>;

const yearOptions = (center: number, back = 2, forward = 1) =>
  Array.from({ length: back + forward + 1 }, (_, i) => center - back + i).map((y) => ({ value: String(y), label: String(y) }));

export const AdjustBalanceModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const thisYear = new Date().getFullYear();
  const { user } = usePermissions();
  const types = useActiveLeaveTypes();
  const adjust = useAdjustBalance();
  const [mode, setMode] = useState<'add' | 'deduct'>('add');
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<AdjIn, unknown, AdjOut>({
    resolver: zodResolver(leaveBalanceAdjustSchema),
    defaultValues: { employeeId: '', leaveTypeId: '', year: thisYear, adjustment: 1, reason: '' },
  });
  const { register, control, handleSubmit, reset, setError, formState } = form;
  const errors = formState.errors;
  const v = useWatch({ control });

  useEffect(() => {
    if (!open) return;
    reset({ employeeId: '', leaveTypeId: '', year: thisYear, adjustment: 1, reason: '' });
    setMode('add');
    setServerError(null);
  }, [open, reset, thisYear]);

  const year = Number(v.year) || thisYear;
  const balances = useLeaveBalances({ employeeId: v.employeeId || undefined, year, enabled: open && !!v.employeeId });
  const current = balances.data?.find((b) => b.leaveType._id === v.leaveTypeId);
  const magnitude = Math.abs(Number(v.adjustment) || 0);
  const after = current ? current.remaining + (mode === 'add' ? magnitude : -magnitude) : null;
  const self = !!v.employeeId && v.employeeId === user?.employeeId;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const amount = Math.abs(values.adjustment);
    if (amount === 0) {
      setError('adjustment', { message: 'Enter the number of days to add or deduct' });
      return;
    }
    try {
      const res = await adjust.mutateAsync({ ...values, adjustment: mode === 'add' ? amount : -amount });
      toast.success(res.message ?? 'Leave balance adjusted');
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, ['employeeId', 'leaveTypeId', 'year', 'adjustment', 'reason']));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adjust leave balance"
      description="Credit or debit days on an employee's balance. Every adjustment is recorded in the balance ledger and audit log."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting} disabled={self}>
            {mode === 'add' ? 'Add days' : 'Deduct days'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError error={serverError} />
        <FormField label="Employee" required error={errors.employeeId?.message ? 'Select an employee' : undefined}>
          {({ id }) => (
            <Controller
              control={control}
              name="employeeId"
              render={({ field }) => <EmployeePicker id={id} value={field.value || null} onChange={(val) => field.onChange((val as string | null) ?? '')} />}
            />
          )}
        </FormField>
        {self && (
          <p role="alert" className="-mt-2 text-xs text-red-600 dark:text-red-400">
            You cannot adjust your own leave balance.
          </p>
        )}
        <FormGrid>
          <FormField label="Leave type" required error={errors.leaveTypeId?.message ? 'Select a leave type' : undefined}>
            {({ id, invalid }) => (
              <Select id={id} aria-invalid={invalid} placeholder="Select…" options={(types.data ?? []).map((t) => ({ value: t._id, label: t.name }))} {...register('leaveTypeId')} />
            )}
          </FormField>
          <FormField label="Year" required error={errors.year}>
            {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={yearOptions(thisYear)} {...register('year')} />}
          </FormField>
        </FormGrid>

        <FormField label="Adjustment" required error={errors.adjustment}>
          {({ id, invalid }) => (
            <div className="flex gap-2">
              <div role="radiogroup" aria-label="Direction" className="inline-flex shrink-0 rounded-lg border border-line-strong p-0.5">
                {(['add', 'deduct'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => setMode(m)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-2.5 text-sm font-medium transition-colors',
                      mode === m ? (m === 'add' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white') : 'text-fg-2 hover:bg-surface-3',
                    )}
                  >
                    {m === 'add' ? <Plus className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                    {m === 'add' ? 'Add' : 'Deduct'}
                  </button>
                ))}
              </div>
              <Input id={id} type="number" min={0} max={365} step={0.5} inputMode="decimal" aria-invalid={invalid} className="flex-1" {...register('adjustment')} />
            </div>
          )}
        </FormField>

        {v.employeeId && v.leaveTypeId && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2.5 text-sm" aria-live="polite">
            {balances.isLoading ? (
              <span className="text-muted">Loading current balance…</span>
            ) : !current ? (
              <span className="text-muted">{balances.error ? balances.error.message : `No ${year} balance exists for this type (it may not apply to the employee).`}</span>
            ) : (
              <>
                <span className="text-muted">Remaining</span>
                <span className="flex items-center gap-2 font-medium text-fg tabular-nums">
                  {formatNum(current.remaining)}
                  <ArrowRight className="h-3.5 w-3.5 text-muted" aria-label="becomes" />
                  <span className={cn(after !== null && after < 0 && 'text-red-600 dark:text-red-400')}>{after === null ? '—' : formatNum(after)}</span>
                </span>
              </>
            )}
          </div>
        )}

        <FormField label="Reason" required error={errors.reason}>
          {({ id, invalid }) => <Textarea id={id} rows={2} maxLength={300} aria-invalid={invalid} placeholder="e.g. Compensatory off for weekend release" {...register('reason')} />}
        </FormField>
      </form>
    </Modal>
  );
};

export const CarryForwardModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const thisYear = new Date().getFullYear();
  const [fromYear, setFromYear] = useState(thisYear - 1);
  const run = useCarryForward();

  useEffect(() => {
    if (open) setFromYear(thisYear - 1);
  }, [open, thisYear]);

  const onRun = async () => {
    try {
      const res = await run.mutateAsync(fromYear);
      toast.success(res.message ?? 'Carry forward completed', {
        description: `${res.data.processed} balance${res.data.processed === 1 ? '' : 's'} carried from ${res.data.fromYear} into ${res.data.toYear}.`,
      });
      onClose();
    } catch {
      // Toasted by the global mutation error handler.
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Run carry forward"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void onRun()} loading={run.isPending} icon={<RotateCcw className="h-4 w-4" />}>
            Carry forward {fromYear} → {fromYear + 1}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-fg-2">
        <p>
          Unused days of leave types that allow carry forward are moved into next year's balances, capped at each type's maximum. Re-running for the same year recalculates the
          amounts instead of adding to them.
        </p>
        <FormField label="From leave year">
          {({ id }) => (
            <Select
              id={id}
              value={String(fromYear)}
              onChange={(e) => setFromYear(Number(e.target.value))}
              options={yearOptions(thisYear - 1, 3, 0)}
            />
          )}
        </FormField>
        <p className="text-xs text-muted">Only completed years can be carried forward.</p>
      </div>
    </Modal>
  );
};
