import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Image } from 'expo-image';
import { Ban, CircleCheck, CircleX, Clock, Download, FileText, MinusCircle, Pencil, Send } from 'lucide-react-native';
import { Button, Card, EmptyState, ErrorState, Header, Notice, Screen, SectionHeader, Skeleton, StatusBadge, Text, toast, useConfirm } from '@/components';
import { DetailCard } from '@/features/profile/kit/detail-list';
import { formatBytes, openProtectedFile } from '@/features/profile/kit/files';
import { ApiError, apiUrl, authHeaders, toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatMoney, fullName, label } from '@/lib/format';
import { formatDate, formatDateTimeIn } from '@/lib/time';
import { radius, space, useTheme } from '@/theme';
import { APPROVER_LABEL, PENDING_STATUSES, useExpense, useExpenseTransition, type ExpenseDetail, type ReceiptRef } from '../api';

const ReceiptPreview = ({ receipt, url }: { receipt: ReceiptRef; url: string | null }) => {
  const { c } = useTheme();
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const isImage = receipt.mimeType.startsWith('image/');
  const open = async () => {
    setOpening(true);
    await openProtectedFile(`/files/${receipt._id}`, { fileName: receipt.originalName, mimeType: receipt.mimeType });
    setOpening(false);
  };
  return (
    <Card style={styles.gap}>
      {isImage && url && !failed ? (
        <Image
          source={{ uri: apiUrl(url, { inline: 1 }), headers: authHeaders(), cacheKey: `receipt-${receipt._id}` }}
          style={[styles.receipt, { backgroundColor: c.surface2 }]}
          contentFit="contain"
          transition={150}
          accessibilityLabel={`Receipt ${receipt.originalName}`}
          onError={() => setFailed(true)}
        />
      ) : null}
      <View style={styles.inline}>
        <FileText size={18} color={c.accent} />
        <View style={styles.flex}>
          <Text size="sm" weight="medium" numberOfLines={1}>
            {receipt.originalName}
          </Text>
          <Text size="xs" color="muted">
            {formatBytes(receipt.size)}
          </Text>
        </View>
      </View>
      <Button variant="outline" icon={Download} loading={opening} onPress={() => void open()} accessibilityLabel={`Open or share receipt ${receipt.originalName}`}>
        Open / share
      </Button>
    </Card>
  );
};

const ApprovalTrail = ({ e, timeZone }: { e: ExpenseDetail; timeZone: string }) => {
  const { c } = useTheme();
  const pending = PENDING_STATUSES.includes(e.status);
  if (!e.approvalSteps.length && !e.submittedAt) {
    return (
      <Card>
        <Text size="sm" color="muted">
          Not submitted yet.
        </Text>
      </Card>
    );
  }
  const rows: { key: string; title: string; icon: typeof Clock; color: string; meta?: string; comment?: string | null; status?: string }[] = [];
  if (e.submittedAt) {
    rows.push({ key: 'submitted', title: 'Submitted', icon: Send, color: c.accent, meta: `${formatDateTimeIn(e.submittedAt, timeZone)} · ${fullName(e.employeeId)}` });
  }
  e.approvalSteps.forEach((s, i) => {
    const current = pending && i === e.currentStep && s.status === 'PENDING';
    rows.push({
      key: `step-${i}`,
      title: APPROVER_LABEL[s.approverType] ?? label(s.approverType),
      icon: s.status === 'APPROVED' ? CircleCheck : s.status === 'REJECTED' ? CircleX : s.status === 'SKIPPED' ? MinusCircle : Clock,
      color: s.status === 'APPROVED' ? c.success : s.status === 'REJECTED' ? c.danger : current ? c.warning : c.subtle,
      meta: [s.actedByName, s.actedAt ? formatDateTimeIn(s.actedAt, timeZone) : null].filter(Boolean).join(' · ') || (current ? 'Awaiting decision' : undefined),
      comment: s.comment,
      status: current ? undefined : s.status,
    });
  });
  if (e.status === 'PAID') rows.push({ key: 'paid', title: 'Paid', icon: CircleCheck, color: c.success, meta: formatDate(e.paidAt) });
  return (
    <Card>
      {rows.map((r, i) => {
        const Icon = r.icon;
        return (
          <View key={r.key} style={styles.step} accessible accessibilityLabel={[r.title, r.status ? label(r.status) : null, r.meta, r.comment].filter(Boolean).join(', ')}>
            <View style={styles.rail}>
              <Icon size={20} color={r.color} />
              {i < rows.length - 1 ? <View style={[styles.railLine, { backgroundColor: c.line }]} /> : null}
            </View>
            <View style={styles.stepBody}>
              <View style={styles.stepHead}>
                <Text weight="medium" style={styles.flex}>
                  {r.title}
                </Text>
                {r.status ? <StatusBadge status={r.status} /> : null}
              </View>
              {r.meta ? (
                <Text size="sm" color="muted">
                  {r.meta}
                </Text>
              ) : null}
              {r.comment ? (
                <Text size="sm" color="fg2">
                  {`“${r.comment}”`}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </Card>
  );
};

export const ExpenseDetailScreen = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, timeZone, isApprover } = useAuth();
  const query = useExpense(id);
  const transition = useExpenseTransition();
  const confirm = useConfirm();
  const e = query.data;
  const p = e?.permissions;
  const mine = !!e && !!user?.employeeId && e.employeeId._id === user.employeeId;
  const notFound = query.error instanceof ApiError && (query.error.status === 403 || query.error.status === 404);

  const submit = async (x: ExpenseDetail) => {
    const { confirmed } = await confirm({
      title: `Submit ${x.expenseNumber}?`,
      message: `${formatMoney(x.amount, x.currency)} will be sent for approval. Submitted claims can no longer be edited.`,
      confirmLabel: 'Submit',
    });
    if (!confirmed) return;
    try {
      await transition.mutateAsync({ id: x._id, action: 'submit' });
      toast.success(`${x.expenseNumber} submitted for approval`);
    } catch (err) {
      toast.error('Could not submit the expense', toApiError(err).message);
    }
  };

  const cancel = async (x: ExpenseDetail) => {
    const { confirmed } = await confirm({
      title: `Cancel ${x.expenseNumber}?`,
      message: 'The claim is withdrawn and cannot be resubmitted. Create a new expense if you need to claim it again.',
      confirmLabel: 'Cancel expense',
      cancelLabel: 'Keep',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await transition.mutateAsync({ id: x._id, action: 'cancel' });
      toast.success(`${x.expenseNumber} cancelled`);
    } catch (err) {
      toast.error('Could not cancel the expense', toApiError(err).message);
    }
  };

  const paidBy = e?.paidBy && typeof e.paidBy === 'object' ? fullName(e.paidBy) : null;
  const hasActions = !!p && (p.canEdit || p.canCancel);

  return (
    <Screen
      header={<Header title={e?.expenseNumber ?? 'Expense'} subtitle={e ? `${label(e.category)} · ${formatDate(e.date)}` : undefined} back backTo="/more/expenses" />}
      onRefresh={() => query.refetch()}
      footer={
        e && p && hasActions ? (
          <View style={styles.actions}>
            {p.canCancel ? (
              <Button variant="outline" icon={Ban} style={styles.flex} disabled={transition.isPending} onPress={() => void cancel(e)}>
                Cancel
              </Button>
            ) : null}
            {p.canEdit ? (
              <Button
                variant="outline"
                icon={Pencil}
                style={styles.flex}
                disabled={transition.isPending}
                onPress={() => router.push({ pathname: '/more/expenses/new', params: { id: e._id } })}
              >
                Edit
              </Button>
            ) : null}
            {p.canEdit ? (
              <Button icon={Send} style={styles.flex} loading={transition.isPending} onPress={() => void submit(e)}>
                Submit
              </Button>
            ) : null}
          </View>
        ) : undefined
      }
    >
      {query.isLoading ? (
        <Card style={styles.gap}>
          <Skeleton width={160} height={28} />
          <Skeleton height={80} />
          <Skeleton height={120} />
        </Card>
      ) : notFound ? (
        <Card>
          <EmptyState icon={FileText} title="Expense unavailable" message="This expense does not exist or you do not have access to it." />
        </Card>
      ) : query.error || !e ? (
        <Card>
          <ErrorState title="Could not load this expense" error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      ) : (
        <>
          {!mine && p?.canApprove && isApprover ? (
            <Notice
              tone="info"
              action={
                <Button variant="outline" onPress={() => router.push(`/approvals/expense/${e._id}` as Href)}>
                  Review in Approvals
                </Button>
              }
            >
              {`${fullName(e.employeeId)}'s claim is waiting for your decision.`}
            </Notice>
          ) : null}
          <Card style={styles.gap}>
            <View style={styles.amountRow}>
              <View style={styles.flex}>
                <Text size="xs" color="muted" weight="medium">
                  AMOUNT
                </Text>
                <Text size="2xl" weight="bold" tabular numberOfLines={1} adjustsFontSizeToFit>
                  {formatMoney(e.amount, e.currency)}
                </Text>
              </View>
              <StatusBadge status={e.status} />
            </View>
            {PENDING_STATUSES.includes(e.status) && e.currentApproverType ? (
              <Text size="sm" color="muted">{`Awaiting ${APPROVER_LABEL[e.currentApproverType]}`}</Text>
            ) : null}
          </Card>

          {e.status === 'REJECTED' && e.rejectionReason ? <Notice tone="danger">{`Rejected: ${e.rejectionReason}`}</Notice> : null}
          {e.status === 'PAID' ? (
            <Notice tone="success">
              {`Paid on ${formatDate(e.paidAt)}${paidBy ? ` by ${paidBy}` : ''}${e.paymentReference ? ` · Ref ${e.paymentReference}` : ''}`}
            </Notice>
          ) : null}

          <DetailCard
            title="Details"
            items={[
              { label: 'Employee', value: mine ? null : `${fullName(e.employeeId)} (${e.employeeId.employeeId})` },
              { label: 'Category', value: label(e.category) },
              { label: 'Expense date', value: formatDate(e.date) },
              { label: 'Merchant', value: e.merchant },
              { label: 'Project / cost center', value: e.project },
              { label: 'Submitted', value: e.submittedAt ? formatDateTimeIn(e.submittedAt, timeZone) : null },
              { label: 'Created', value: formatDateTimeIn(e.createdAt, timeZone) },
            ]}
          />
          <Card style={styles.block}>
            <Text size="sm" color="muted">
              Description
            </Text>
            <Text>{e.description}</Text>
          </Card>

          <SectionHeader title="Receipt" />
          {e.receiptFileId ? (
            <ReceiptPreview receipt={e.receiptFileId} url={e.receiptUrl} />
          ) : (
            <Card>
              <Text size="sm" color="muted">
                {p?.canEdit ? 'No receipt attached. Edit the draft to add one.' : 'No receipt attached.'}
              </Text>
            </Card>
          )}

          <SectionHeader title="Approval trail" />
          <ApprovalTrail e={e} timeZone={timeZone} />
        </>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space(3) },
  block: { gap: space(1) },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  actions: { flexDirection: 'row', gap: space(2) },
  amountRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space(2) },
  receipt: { width: '100%', height: 260, borderRadius: radius.md },
  step: { flexDirection: 'row', gap: space(3) },
  rail: { alignItems: 'center', width: 20 },
  railLine: { width: 2, flex: 1, marginVertical: space(1), minHeight: 16 },
  stepBody: { flex: 1, gap: 2, paddingBottom: space(4) },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
});
