import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Banknote } from 'lucide-react-native';
import { expensePaySchema } from '@stencil/shared';
import { BottomSheet, Button, DateField, Notice, Text, TextField, toast } from '@/components';
import { toApiError } from '@/lib/api';
import { formatMoney, fullName } from '@/lib/format';
import { space, useTheme } from '@/theme';
import { usePayExpense, type ExpenseRecord } from '../api';

type Errors = Partial<Record<'paidDate' | 'paymentReference', string>>;

/** Records the reimbursement of an approved expense (paid date + reference). */
export const PaySheet = ({
  expense,
  open,
  today,
  onClose,
  onPaid,
}: {
  expense: ExpenseRecord;
  open: boolean;
  /** `YYYY-MM-DD` in the organization timezone. */
  today: string;
  onClose: () => void;
  onPaid: () => void;
}) => {
  const { c } = useTheme();
  const pay = usePayExpense();
  const [paidDate, setPaidDate] = useState(today);
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const submit = async () => {
    setServerError(null);
    const parsed = expensePaySchema.safeParse({ paidDate, paymentReference: reference.trim() || undefined });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === 'paidDate' || key === 'paymentReference') && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    try {
      await pay.mutateAsync({ id: expense._id, paidDate: parsed.data.paidDate, paymentReference: parsed.data.paymentReference });
      toast.success(`${expense.expenseNumber} marked as paid`, `${fullName(expense.employeeId)} has been notified.`);
      onPaid();
    } catch (err) {
      const e = toApiError(err);
      const field: Errors = {};
      for (const fe of e.fieldErrors) if (fe.path === 'paidDate' || fe.path === 'paymentReference') field[fe.path] = fe.message;
      setErrors(field);
      setServerError(e.message);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={() => {
        if (!pay.isPending) onClose();
      }}
      title={`Mark ${expense.expenseNumber} as paid`}
      description="Record the reimbursement. This is final and notifies the employee."
      footer={
        <View style={styles.actions}>
          <Button variant="outline" style={styles.flex} onPress={onClose} disabled={pay.isPending}>
            Cancel
          </Button>
          <Button variant="success" icon={Banknote} style={styles.flex} loading={pay.isPending} onPress={() => void submit()}>
            Mark paid
          </Button>
        </View>
      }
    >
      {serverError ? <Notice tone="danger">{serverError}</Notice> : null}
      <View style={[styles.summary, { backgroundColor: c.surface2 }]}>
        <Text weight="medium" style={styles.flex} numberOfLines={1}>
          {fullName(expense.employeeId)}
        </Text>
        <Text size="lg" weight="bold" tabular>
          {formatMoney(expense.amount, expense.currency)}
        </Text>
      </View>
      <DateField label="Paid on" required value={paidDate} onChange={setPaidDate} maximumDate={today} error={errors.paidDate} />
      <TextField
        label="Payment reference"
        value={reference}
        onChangeText={setReference}
        maxLength={100}
        autoCapitalize="characters"
        autoCorrect={false}
        hint="Bank transfer ID, payroll batch or cheque number."
        error={errors.paymentReference}
      />
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  actions: { flexDirection: 'row', gap: space(3) },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space(3), borderRadius: 12, padding: space(3) },
});
