import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Banknote, Send, Wallet } from 'lucide-react-native';
import { Avatar, Button, Card, ErrorState, Header, Notice, Screen, SectionHeader, Skeleton, StatusBadge, Text, toast, useConfirm } from '@/components';
import { AttachmentRow } from '@/features/leave/components/attachment-row';
import { stepItem, Timeline, type TimelineItem } from '@/features/leave/components/timeline';
import { ApiError, toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatMoney, fullName, label } from '@/lib/format';
import { dateKeyIn, formatDate, formatDateTimeIn } from '@/lib/time';
import { radius, space, useTheme } from '@/theme';
import { useExpense, useExpenseDecision, type ExpenseDetail } from '../api';
import { DecisionBar } from '../components/decision-bar';
import { PaySheet } from '../components/pay-sheet';
import { ReceiptPreview } from '../components/receipt-preview';
import { approverLabel, canRejectExpense, isAwaitingDecision } from '../lib';

const Fact = ({ label: text, children }: { label: string; children: ReactNode }) => (
  <View style={styles.fact} accessible>
    <Text size="sm" color="muted">
      {text}
    </Text>
    <Text size="sm" weight="medium" align="right" style={styles.flex}>
      {children}
    </Text>
  </View>
);

const trail = (e: ExpenseDetail, timeZone: string): TimelineItem[] => {
  const items: TimelineItem[] = [];
  const pending = isAwaitingDecision(e.status);
  if (e.submittedAt) {
    items.push({
      key: 'submitted',
      title: 'Submitted',
      meta: `${formatDateTimeIn(e.submittedAt, timeZone)} · ${fullName(e.employeeId)}`,
      tone: 'brand',
      icon: Send,
    });
  }
  e.approvalSteps.forEach((s, i) =>
    items.push(
      stepItem(s, i, {
        current: pending && i === e.currentStep && s.status === 'PENDING',
        cancelled: e.status === 'CANCELLED',
        timeZone,
        approverLabel,
      }),
    ),
  );
  if (e.status === 'PAID') {
    items.push({
      key: 'paid',
      title: 'Paid',
      meta: [formatDate(e.paidAt), e.paymentReference ? `Ref ${e.paymentReference}` : null].filter(Boolean).join(' · '),
      tone: 'teal',
      icon: Banknote,
    });
  }
  return items;
};

export const ExpenseApprovalScreen = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { can, timeZone } = useAuth();
  const confirm = useConfirm();
  const query = useExpense(id);
  const decision = useExpenseDecision();
  const [error, setError] = useState<string | null>(null);
  const [payKey, setPayKey] = useState(0);
  const [paying, setPaying] = useState(false);
  const e = query.data;
  const header = <Header title={e ? e.expenseNumber : 'Expense claim'} subtitle={e ? label(e.category) : undefined} back backTo="/approvals" />;

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/approvals');
  };

  if (query.isLoading) {
    return (
      <Screen header={header}>
        <Card style={styles.gap}>
          <Skeleton width={160} height={32} />
          <Skeleton height={48} />
          <Skeleton height={120} />
        </Card>
      </Screen>
    );
  }
  if (query.error || !e) {
    const err = query.error;
    const final = err instanceof ApiError && (err.status === 403 || err.status === 404);
    return (
      <Screen header={header} onRefresh={() => query.refetch()}>
        <Card>
          <ErrorState
            title={err instanceof ApiError && err.status === 403 ? 'Access denied' : 'Could not load this expense'}
            error={err}
            onRetry={final ? undefined : () => void query.refetch()}
          />
        </Card>
      </Screen>
    );
  }

  const name = fullName(e.employeeId);
  const amount = formatMoney(e.amount, e.currency);
  const canApprove = e.permissions.canApprove;
  const canReject = canRejectExpense(e, can);
  const canPay = e.permissions.canPay;
  const busy = decision.isPending ? (decision.variables?.action ?? null) : null;
  const paidBy = e.paidBy && typeof e.paidBy === 'object' ? fullName(e.paidBy) : null;
  const receipt = e.receiptFileId;

  const act = async (action: 'approve' | 'reject') => {
    const { confirmed, reason } = await confirm(
      action === 'approve'
        ? {
            title: `Approve ${e.expenseNumber}?`,
            message: `${name} · ${amount}. The claim moves to its next approval step or to payment.`,
            confirmLabel: 'Approve',
            reason: { label: 'Comment (optional)', placeholder: 'Visible to the employee', maxLength: 1000 },
          }
        : {
            title: `Reject ${e.expenseNumber}?`,
            message: `${name} · ${amount}. The employee sees your reason; a rejected claim cannot be reopened.`,
            confirmLabel: 'Reject expense',
            tone: 'danger',
            reason: { label: 'Reason for rejection', required: true, maxLength: 1000 },
          },
    );
    if (!confirmed || (action === 'reject' && !reason)) return;
    setError(null);
    try {
      await decision.mutateAsync({ id: e._id, action, reason: action === 'reject' ? reason : undefined, comment: action === 'approve' ? reason : undefined });
      toast.success(`${e.expenseNumber} ${action === 'approve' ? 'approved' : 'rejected'}`, `${name} · ${amount}`);
      goBack();
    } catch (err) {
      const message = toApiError(err).message;
      setError(message);
      toast.error(action === 'approve' ? 'Could not approve' : 'Could not reject', message);
      void query.refetch();
    }
  };

  const footer = canApprove ? (
    <DecisionBar subject={`${e.expenseNumber} from ${name}`} busy={busy} onApprove={() => void act('approve')} onReject={canReject ? () => void act('reject') : undefined} />
  ) : canPay ? (
    <Button
      variant="success"
      size="lg"
      icon={Banknote}
      fullWidth
      onPress={() => {
        setPayKey((k) => k + 1);
        setPaying(true);
      }}
      accessibilityLabel={`Mark ${e.expenseNumber} as paid`}
    >
      Mark paid
    </Button>
  ) : undefined;

  return (
    <Screen header={header} footer={footer} onRefresh={() => query.refetch()}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!canApprove && !canPay && isAwaitingDecision(e.status) ? (
        <Notice tone="info">{`Waiting for ${approverLabel(e.currentApproverType ?? 'MANAGER').toLowerCase()} approval — not your step.`}</Notice>
      ) : null}

      <Card style={styles.gap}>
        <View style={styles.person}>
          <Avatar name={name} uri={e.employeeId?.profilePhoto} size={48} />
          <View style={styles.flex}>
            <Text size="lg" weight="semibold" numberOfLines={1}>
              {name}
            </Text>
            <Text size="sm" color="muted">
              {e.employeeId?.employeeId}
            </Text>
          </View>
        </View>
        <View style={[styles.amount, { backgroundColor: c.surface2, borderColor: c.line }]} accessible accessibilityLabel={`Amount ${amount}, ${label(e.status)}`}>
          <View style={styles.flex}>
            <Text size="xs" color="muted" weight="medium">
              AMOUNT
            </Text>
            <Text size="3xl" weight="bold" tabular>
              {amount}
            </Text>
          </View>
          <StatusBadge status={e.status} />
        </View>
        {e.status === 'REJECTED' && e.rejectionReason ? <Notice tone="danger">{`Rejected: ${e.rejectionReason}`}</Notice> : null}
        {e.status === 'PAID' ? (
          <Notice tone="success">
            {`Paid on ${formatDate(e.paidAt)}${paidBy ? ` by ${paidBy}` : ''}${e.paymentReference ? ` · Ref ${e.paymentReference}` : ''}`}
          </Notice>
        ) : null}
        <View>
          <Fact label="Category">{label(e.category)}</Fact>
          <Fact label="Expense date">{formatDate(e.date, 'EEE, dd MMM yyyy')}</Fact>
          {e.merchant ? <Fact label="Merchant">{e.merchant}</Fact> : null}
          {e.project ? <Fact label="Project / cost center">{e.project}</Fact> : null}
          <Fact label="Currency">{e.currency}</Fact>
          {e.submittedAt ? <Fact label="Submitted">{formatDateTimeIn(e.submittedAt, timeZone)}</Fact> : null}
        </View>
        <View style={styles.block}>
          <Text size="sm" color="muted">
            Description
          </Text>
          <Text>{e.description}</Text>
        </View>
      </Card>

      <SectionHeader title="Receipt" />
      <Card style={styles.gap}>
        {receipt ? (
          <>
            {receipt.mimeType.startsWith('image/') ? <ReceiptPreview fileId={receipt._id} name={receipt.originalName} /> : null}
            <AttachmentRow fileId={receipt._id} name={receipt.originalName} size={receipt.size} mimeType={receipt.mimeType} />
          </>
        ) : (
          <View style={styles.row}>
            <Wallet size={18} color={c.muted} />
            <Text size="sm" color="muted">
              No receipt attached.
            </Text>
          </View>
        )}
      </Card>

      <SectionHeader title="Approval trail" />
      <Card>
        {e.approvalSteps.length || e.submittedAt ? (
          <Timeline items={trail(e, timeZone)} />
        ) : (
          <Text size="sm" color="muted">
            Not submitted yet.
          </Text>
        )}
      </Card>

      {canPay ? (
        <PaySheet
          key={payKey}
          expense={e}
          open={paying}
          today={dateKeyIn(timeZone)}
          onClose={() => setPaying(false)}
          onPaid={() => {
            setPaying(false);
            goBack();
          }}
        />
      ) : null}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space(4) },
  block: { gap: space(1.5) },
  person: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  amount: { flexDirection: 'row', alignItems: 'center', gap: space(3), borderWidth: 1, borderRadius: radius.md, padding: space(4) },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: space(3), paddingVertical: space(2) },
});
