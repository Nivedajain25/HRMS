import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Send } from 'lucide-react-native';
import { Avatar, Card, ErrorState, Header, Notice, Screen, SectionHeader, Skeleton, StatusBadge, Text, toast, useConfirm } from '@/components';
import { useRegularization } from '@/features/attendance/api';
import { TimeComparison } from '@/features/attendance/components/regularization-card';
import { AttachmentRow } from '@/features/leave/components/attachment-row';
import { stepItem, Timeline, type TimelineItem } from '@/features/leave/components/timeline';
import { ApiError, toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fullName, label } from '@/lib/format';
import { formatDateTimeIn, formatKey } from '@/lib/time';
import { space } from '@/theme';
import { useRegularizationDecision } from '../api';
import { DecisionBar } from '../components/decision-bar';
import { ReceiptPreview } from '../components/receipt-preview';
import { isAwaitingDecision } from '../lib';

export const RegularizationApprovalScreen = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { timeZone } = useAuth();
  const confirm = useConfirm();
  const query = useRegularization(id);
  const decision = useRegularizationDecision();
  const [error, setError] = useState<string | null>(null);
  const r = query.data;
  const header = <Header title="Attendance regularization" back backTo="/approvals" />;

  if (query.isLoading) {
    return (
      <Screen header={header}>
        <Card style={styles.gap}>
          <Skeleton width={200} height={22} />
          <Skeleton height={56} />
          <Skeleton height={64} />
        </Card>
      </Screen>
    );
  }
  if (query.error || !r) {
    const e = query.error;
    const final = e instanceof ApiError && (e.status === 403 || e.status === 404);
    return (
      <Screen header={header} onRefresh={() => query.refetch()}>
        <Card>
          <ErrorState
            title={e instanceof ApiError && e.status === 403 ? 'Access denied' : 'Could not load this request'}
            error={e}
            onRetry={final ? undefined : () => void query.refetch()}
          />
        </Card>
      </Screen>
    );
  }

  const name = fullName(r.employeeId);
  const dateLabel = formatKey(r.date.slice(0, 10), 'EEEE, d MMM yyyy');
  const pending = isAwaitingDecision(r.status);
  const canAct = pending && r.canAct !== false;
  const busy = decision.isPending ? (decision.variables?.action ?? null) : null;

  const act = async (action: 'approve' | 'reject') => {
    const { confirmed, reason } = await confirm(
      action === 'approve'
        ? {
            title: `Approve regularization for ${name}?`,
            message: `${dateLabel}: ${r.requestedCheckIn} – ${r.requestedCheckOut}. The attendance record is updated when the last step approves.`,
            confirmLabel: 'Approve',
            reason: { label: 'Comment (optional)', placeholder: 'Visible to the employee', maxLength: 1000 },
          }
        : {
            title: `Reject regularization for ${name}?`,
            message: `${dateLabel}. The employee sees your reason.`,
            confirmLabel: 'Reject',
            tone: 'danger',
            reason: { label: 'Reason for rejection', required: true, maxLength: 1000 },
          },
    );
    if (!confirmed || (action === 'reject' && !reason)) return;
    setError(null);
    try {
      const res = await decision.mutateAsync({ id: r._id, action, reason: action === 'reject' ? reason : undefined, comment: action === 'approve' ? reason : undefined });
      toast.success(
        action === 'reject' ? 'Regularization rejected' : res.data?.status === 'APPROVED' ? 'Regularization approved' : 'Approved — sent to the next approver',
        `${name} · ${formatKey(r.date.slice(0, 10), 'dd MMM yyyy')}`,
      );
      if (router.canGoBack()) router.back();
      else router.replace('/approvals');
    } catch (err) {
      const message = toApiError(err).message;
      setError(message);
      toast.error(action === 'approve' ? 'Could not approve' : 'Could not reject', message);
      void query.refetch();
    }
  };

  const timeline: TimelineItem[] = [
    { key: 'submitted', title: 'Submitted', meta: formatDateTimeIn(r.submittedAt ?? r.createdAt, timeZone), tone: 'brand', icon: Send },
    ...r.approvalSteps.map((s, i) =>
      stepItem(s, i, { current: s.status === 'PENDING' && i === r.currentStep && pending, cancelled: r.status === 'CANCELLED', timeZone }),
    ),
  ];
  const attachment = r.attachmentId;
  const attachmentName = attachment?.originalName ?? attachment?.name ?? 'Attachment';

  return (
    <Screen
      header={header}
      onRefresh={() => query.refetch()}
      footer={canAct ? <DecisionBar subject={`regularization for ${name}`} busy={busy} onApprove={() => void act('approve')} onReject={() => void act('reject')} /> : undefined}
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!pending ? <Notice tone="info">{`This request is ${label(r.status).toLowerCase()} — no decision is needed.`}</Notice> : null}
      {pending && !canAct ? <Notice tone="info">This request is waiting for another approver.</Notice> : null}

      <Card style={styles.gap}>
        <View style={styles.person}>
          <Avatar name={name} uri={r.employeeId?.profilePhoto} size={48} />
          <View style={styles.flex}>
            <Text size="lg" weight="semibold" numberOfLines={1}>
              {name}
            </Text>
            <Text size="sm" color="muted" numberOfLines={1}>
              {[r.employeeId?.employeeId, r.employeeId?.departmentId?.name].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
        <View style={styles.row}>
          <Text size="lg" weight="semibold" style={styles.flex} accessibilityRole="header">
            {dateLabel}
          </Text>
          <StatusBadge status={r.status} />
        </View>
        <TimeComparison r={r} timeZone={timeZone} />
        <Text size="xs" color="muted">
          {`Times are in ${timeZone}. A check-out earlier than the check-in ends the next day.`}
        </Text>
        <View style={styles.block}>
          <Text size="sm" color="muted">
            Reason
          </Text>
          <Text>{r.reason}</Text>
        </View>
        {r.rejectionReason ? <Notice tone="danger">{`Rejected: ${r.rejectionReason}`}</Notice> : null}
        {attachment ? (
          <View style={styles.block}>
            <Text size="sm" color="muted">
              Attachment
            </Text>
            {attachment.mimeType?.startsWith('image/') ? <ReceiptPreview fileId={attachment._id} name={attachmentName} /> : null}
            <AttachmentRow fileId={attachment._id} name={attachmentName} size={attachment.size} mimeType={attachment.mimeType} />
          </View>
        ) : null}
      </Card>

      <SectionHeader title="Approval chain" />
      <Card>
        <Timeline items={timeline} />
      </Card>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space(4) },
  block: { gap: space(1.5) },
  person: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
});
