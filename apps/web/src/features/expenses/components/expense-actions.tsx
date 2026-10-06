import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Banknote } from 'lucide-react';
import { expensePaySchema } from '@stencil/shared';
import { applyServerErrors, FormError, FormField } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { PersonCell } from '@/components/ui/display';
import { Input } from '@/components/ui/input';
import { Modal, useConfirm } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { formatDate, formatMoney, fullName, toDateKey } from '@/lib/utils';
import { usePayExpense, useExpenseTransition, type ExpenseRecord } from '../api';

type PayValues = z.input<typeof expensePaySchema>;

export const PayExpenseModal = ({ expense, onClose }: { expense: ExpenseRecord | null; onClose: () => void }) => {
  const pay = usePayExpense();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<PayValues, unknown, z.output<typeof expensePaySchema>>({ resolver: zodResolver(expensePaySchema) });
  const { register, handleSubmit, reset, formState, setError } = form;
  const errors = formState.errors;

  useEffect(() => {
    if (!expense) return;
    setServerError(null);
    reset({ paidDate: toDateKey(new Date()), paymentReference: '' });
  }, [expense, reset]);

  const onSubmit = handleSubmit(async (values) => {
    if (!expense) return;
    setServerError(null);
    try {
      await pay.mutateAsync({ id: expense._id, paidDate: values.paidDate, paymentReference: values.paymentReference || undefined });
      toast.success(`${expense.expenseNumber} marked as paid`);
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, ['paidDate', 'paymentReference']));
    }
  });

  return (
    <Modal
      open={!!expense}
      onClose={onClose}
      title={`Mark ${expense?.expenseNumber ?? ''} as paid`}
      description="Record the reimbursement. This is final and notifies the employee."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="success" onClick={onSubmit} loading={formState.isSubmitting} icon={<Banknote className="h-4 w-4" />}>
            Mark as paid
          </Button>
        </>
      }
    >
      {expense && (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <FormError error={serverError} />
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-3">
            <PersonCell name={fullName(expense.employeeId)} subtitle={`${label(expense.category)} · ${formatDate(expense.date)}`} photo={expense.employeeId.profilePhoto} />
            <span className="text-lg font-semibold text-fg tabular-nums">{formatMoney(expense.amount, expense.currency)}</span>
          </div>
          <FormField label="Paid on" required error={errors.paidDate}>
            {({ id, invalid }) => <Input id={id} type="date" aria-invalid={invalid} {...register('paidDate')} />}
          </FormField>
          <FormField label="Payment reference" error={errors.paymentReference} hint="Bank transfer ID, payroll batch or cheque number.">
            {({ id, invalid }) => <Input id={id} maxLength={100} autoComplete="off" aria-invalid={invalid} {...register('paymentReference')} />}
          </FormField>
        </form>
      )}
    </Modal>
  );
};

/** Approve / reject / submit / cancel / pay with confirmations and toasts. Render `element` once. */
export const useExpenseActions = () => {
  const confirm = useConfirm();
  const transition = useExpenseTransition();
  const [paying, setPaying] = useState<ExpenseRecord | null>(null);

  const run = (e: ExpenseRecord, action: 'submit' | 'cancel' | 'approve' | 'reject', message: string, body?: object) =>
    transition
      .mutateAsync({ id: e._id, action, body })
      .then(() => {
        toast.success(message);
        return true;
      })
      .catch(() => false);

  const approve = (e: ExpenseRecord) => run(e, 'approve', `${e.expenseNumber} approved`);

  const reject = async (e: ExpenseRecord) => {
    const { confirmed, reason } = await confirm({
      title: `Reject ${e.expenseNumber}?`,
      message: (
        <>
          {fullName(e.employeeId)} · {formatMoney(e.amount, e.currency)}. The employee sees your reason; a rejected claim cannot be reopened.
        </>
      ),
      confirmLabel: 'Reject expense',
      requireReason: true,
      reasonLabel: 'Reason for rejection',
    });
    if (!confirmed || !reason) return false;
    return run(e, 'reject', `${e.expenseNumber} rejected`, { reason });
  };

  const cancel = async (e: ExpenseRecord) => {
    const { confirmed } = await confirm({
      title: `Cancel ${e.expenseNumber}?`,
      message: 'The claim is withdrawn from approval and cannot be resubmitted. Create a new expense if you need to claim it again.',
      confirmLabel: 'Cancel expense',
    });
    if (!confirmed) return false;
    return run(e, 'cancel', `${e.expenseNumber} cancelled`);
  };

  const submit = (e: ExpenseRecord) => run(e, 'submit', `${e.expenseNumber} submitted for approval`);

  const element: ReactNode = <PayExpenseModal expense={paying} onClose={() => setPaying(null)} />;

  return { approve, reject, cancel, submit, pay: setPaying, element, busy: transition.isPending, pendingId: transition.isPending ? transition.variables?.id : undefined };
};
