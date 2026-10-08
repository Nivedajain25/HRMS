import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { CalendarClock, Check, DoorOpen, LogOut, Undo2 } from 'lucide-react-native';
import { offboardingCreateSchema, type OffboardingStatus } from '@stencil/shared';
import { Button, Card, DateField, ErrorState, Header, Notice, Screen, Skeleton, StatusBadge, Text, TextField, toast, useConfirm } from '@/components';
import { useMyEmployee } from '@/features/profile/api';
import { toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { label } from '@/lib/format';
import { addDaysKey, dateKeyIn, formatDate, formatKey } from '@/lib/time';
import { radius, space, toneColors, useTheme } from '@/theme';
import { useMyResignation, useResignationDetail, useSubmitResignation, useWithdrawResignation, type Resignation } from './api';

type Values = z.input<typeof offboardingCreateSchema>;
type Output = z.output<typeof offboardingCreateSchema>;
const FIELDS = ['reason', 'requestDate', 'lastWorkingDate'] as const;

/** The resignation in progress: status, last working day, the steps, and Withdraw while still allowed. */
const InProgress = ({ r, today }: { r: Resignation; today: string }) => {
  const { c } = useTheme();
  const confirm = useConfirm();
  const detail = useResignationDetail(r._id);
  const withdraw = useWithdrawResignation(r._id);
  const steps: OffboardingStatus[] = detail.data?.steps.filter((s) => s !== 'CANCELLED') ?? [];
  const current = steps.indexOf(r.status);
  const last = r.lastWorkingDate.slice(0, 10);
  const daysLeft = Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const amber = toneColors('amber', c);
  const green = toneColors('green', c);

  const onWithdraw = async () => {
    const { confirmed } = await confirm({
      title: 'Withdraw your resignation?',
      message: 'HR and your manager will be told, and your employment carries on as before.',
      confirmLabel: 'Withdraw resignation',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await withdraw.mutateAsync();
      toast.success('Resignation withdrawn');
    } catch (err) {
      toast.error('Could not withdraw', toApiError(err).message);
    }
  };

  return (
    <>
      <Card style={styles.gap}>
        <View style={styles.headRow}>
          <View style={[styles.iconTile, { backgroundColor: amber.bg }]}>
            <DoorOpen size={20} color={amber.solid} />
          </View>
          <View style={styles.flex}>
            <Text weight="semibold">Your resignation is in progress</Text>
            <Text size="sm" color="fg2">{`Submitted ${formatDate(r.requestDate)}. HR will guide you through the remaining steps.`}</Text>
          </View>
        </View>
        <StatusBadge status={r.status} />
        <View style={[styles.lastDay, { backgroundColor: c.surface2, borderColor: c.line }]}>
          <CalendarClock size={18} color={c.muted} />
          <Text size="sm" style={styles.flex}>
            {'Last working day '}
            <Text size="sm" weight="bold">
              {formatKey(last)}
            </Text>
            {daysLeft >= 0 ? <Text size="sm" color="muted">{` · ${daysLeft === 0 ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}`}</Text> : null}
          </Text>
        </View>
      </Card>

      <Card style={styles.gap}>
        <Text weight="semibold">Steps</Text>
        {detail.isLoading ? (
          <Skeleton height={120} />
        ) : (
          steps.map((s, i) => {
            const done = i < current || r.status === 'COMPLETED';
            const now = i === current && r.status !== 'COMPLETED';
            return (
              <View key={s} style={styles.step} accessible accessibilityLabel={`${label(s)}${done ? ', done' : now ? ', current step' : ''}`}>
                <View
                  style={[
                    styles.dot,
                    done ? { backgroundColor: green.solid, borderColor: green.solid } : now ? { borderColor: c.accent, borderWidth: 2 } : { borderColor: c.lineStrong },
                  ]}
                >
                  {done ? <Check size={12} color="#ffffff" strokeWidth={3} /> : null}
                </View>
                <Text size="sm" weight={now ? 'semibold' : 'regular'} color={done || now ? 'fg' : 'muted'}>
                  {label(s)}
                </Text>
              </View>
            );
          })
        )}
      </Card>

      {detail.data?.canCancel ? (
        <Button variant="outline" icon={Undo2} loading={withdraw.isPending} onPress={() => void onWithdraw()}>
          Withdraw resignation
        </Button>
      ) : detail.data ? (
        <Text size="xs" color="muted" align="center">
          It can no longer be withdrawn here — please speak to HR.
        </Text>
      ) : null}
    </>
  );
};

/** The resignation form (reason, submission date, last working day suggested from the notice period). */
const SubmitForm = ({ today }: { today: string }) => {
  const { c } = useTheme();
  const { user } = useAuth();
  const confirm = useConfirm();
  const me = useMyEmployee();
  const submit = useSubmitResignation();
  const [serverError, setServerError] = useState<string | null>(null);
  const noticeDays = me.data?.noticePeriodDays;

  const { control, handleSubmit, setError, watch, setValue, getFieldState, formState } = useForm<Values, unknown, Output>({
    resolver: zodResolver(offboardingCreateSchema),
    defaultValues: { employeeId: user?.employeeId ?? '', exitType: 'RESIGNATION', reason: '', requestDate: today, lastWorkingDate: '' },
  });
  const requestDate = watch('requestDate');

  // Suggest the last working day from the notice period until it is edited.
  useEffect(() => {
    if (noticeDays === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(requestDate ?? '') || getFieldState('lastWorkingDate').isDirty) return;
    setValue('lastWorkingDate', addDaysKey(requestDate, noticeDays));
  }, [noticeDays, requestDate, getFieldState, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const { confirmed } = await confirm({
      title: 'Submit your resignation?',
      message: `HR and your manager will be notified. Your requested last working day is ${formatKey(values.lastWorkingDate)}. You can withdraw it until the asset return step begins.`,
      confirmLabel: 'Submit resignation',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await submit.mutateAsync({ ...values, employeeId: user?.employeeId ?? '', exitType: 'RESIGNATION' });
      toast.success('Resignation submitted');
    } catch (err) {
      const e = toApiError(err);
      let matched = false;
      for (const fe of e.fieldErrors) {
        const field = FIELDS.find((f) => f === fe.path);
        if (field) {
          setError(field, { message: fe.message });
          matched = true;
        }
      }
      if (!matched) setServerError(e.message);
    }
  });

  return (
    <>
      <Card style={styles.gap}>
        <View style={styles.headRow}>
          <View style={[styles.iconTile, { backgroundColor: c.surface3 }]}>
            <LogOut size={20} color={c.fg2} />
          </View>
          <View style={styles.flex}>
            <Text weight="semibold">Submit your resignation</Text>
            <Text size="sm" color="fg2">
              HR and your reporting manager are notified as soon as you submit. You can withdraw it while it is still in the early steps.
            </Text>
          </View>
        </View>
        {noticeDays !== undefined ? (
          <Text size="sm" color="fg2">
            {'Your notice period is '}
            <Text size="sm" weight="bold">{`${noticeDays} day${noticeDays === 1 ? '' : 's'}`}</Text>.
          </Text>
        ) : null}
      </Card>

      {serverError ? <Notice tone="danger">{serverError}</Notice> : null}
      <Card style={styles.form}>
        <Controller
          control={control}
          name="reason"
          render={({ field, fieldState }) => (
            <TextField
              label="Reason for resigning"
              required
              multiline
              maxLength={2000}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="requestDate"
          render={({ field, fieldState }) => (
            <DateField label="Submission date" required value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
          )}
        />
        <Controller
          control={control}
          name="lastWorkingDate"
          render={({ field, fieldState }) => (
            <DateField
              label="Last working date"
              required
              value={field.value}
              onChange={field.onChange}
              minimumDate={requestDate || undefined}
              hint={noticeDays !== undefined ? `Notice period: ${noticeDays} day${noticeDays === 1 ? '' : 's'}` : undefined}
              error={fieldState.error?.message}
            />
          )}
        />
      </Card>
      <Button variant="danger" icon={LogOut} loading={formState.isSubmitting} onPress={() => void onSubmit()}>
        Submit resignation
      </Button>
    </>
  );
};

/** More → Resignation: submit my resignation, or follow (and withdraw) the one in progress. Same as the web. */
export const ResignationScreen = () => {
  const { hasEmployee, timeZone } = useAuth();
  const qc = useQueryClient();
  const mine = useMyResignation(hasEmployee);
  const today = dateKeyIn(timeZone);

  return (
    <Screen
      keyboard
      header={<Header title="Resignation" subtitle="Submit your resignation or follow its progress" back backTo="/more" />}
      onRefresh={() => qc.invalidateQueries({ queryKey: ['offboarding'] })}
    >
      {mine.isLoading ? (
        <Skeleton height={180} />
      ) : mine.error ? (
        <Card>
          <ErrorState compact title="Could not load your resignation" error={mine.error} onRetry={() => void mine.refetch()} />
        </Card>
      ) : mine.data ? (
        <InProgress r={mine.data} today={today} />
      ) : (
        <SubmitForm today={today} />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space(3) },
  form: { gap: space(4) },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space(3) },
  iconTile: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  lastDay: { flexDirection: 'row', alignItems: 'center', gap: space(2.5), borderWidth: 1, borderRadius: radius.md, padding: space(3) },
  step: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 28 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
