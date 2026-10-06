import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ArrowRight, Paperclip } from 'lucide-react-native';
import { APPROVAL_STATUS, REGULARIZATION_WORKFLOW, type ApprovalStatus } from '@stencil/shared';
import { Badge, Button, Card, StatusBadge, Text, toast, useConfirm } from '@/components';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/format';
import { formatKey, formatTimeIn, timeAgo } from '@/lib/time';
import { radius, space, useTheme } from '@/theme';
import { useCancelRegularization, type Regularization } from '../api';

export const PENDING_STATUSES = ['SUBMITTED', 'PENDING_APPROVAL'];

const isApprovalStatus = (s: string): s is ApprovalStatus => (APPROVAL_STATUS as readonly string[]).includes(s);

/** Whether the requester can still cancel (server flag, else the shared workflow). */
export const canCancelRegularization = (r: Regularization) =>
  r.canCancel ?? (isApprovalStatus(r.status) && PENDING_STATUSES.includes(r.status) && REGULARIZATION_WORKFLOW.can(r.status, 'CANCELLED'));

/** Recorded → requested times. */
export const TimeComparison = ({ r, timeZone }: { r: Regularization; timeZone: string }) => {
  const { c } = useTheme();
  const recorded =
    r.originalCheckIn || r.originalCheckOut
      ? `${formatTimeIn(r.originalCheckIn, timeZone)} – ${formatTimeIn(r.originalCheckOut, timeZone)}`
      : 'No record';
  const requested = `${r.requestedCheckIn} – ${r.requestedCheckOut}`;
  return (
    <View style={styles.compare} accessible accessibilityLabel={`Recorded ${recorded}, requested ${requested}`}>
      <View style={[styles.timeBox, { backgroundColor: c.surface2, borderColor: c.line }]}>
        <Text size="xs" color="muted">
          Recorded
        </Text>
        <Text size="sm" weight="medium" color="muted" tabular style={recorded !== 'No record' ? styles.strike : undefined}>
          {recorded}
        </Text>
      </View>
      <ArrowRight size={16} color={c.subtle} />
      <View
        style={[styles.timeBox, { backgroundColor: c.accentSoft, borderColor: c.scheme === 'dark' ? 'rgba(99,102,241,0.3)' : '#c7d2fe' }]}
      >
        <Text size="xs" color="accent">
          Requested
        </Text>
        <Text size="sm" weight="semibold" tabular>
          {requested}
        </Text>
      </View>
    </View>
  );
};

/** Confirm + cancel a pending regularization request. */
export const useCancelRequest = () => {
  const confirm = useConfirm();
  const cancel = useCancelRegularization();
  const run = async (r: Regularization) => {
    const { confirmed } = await confirm({
      title: 'Cancel this request?',
      message: `Your regularization request for ${formatKey(r.date.slice(0, 10), 'EEE, dd MMM yyyy')} will be withdrawn.`,
      confirmLabel: 'Cancel request',
      cancelLabel: 'Keep',
      tone: 'danger',
    });
    if (!confirmed) return false;
    try {
      const res = await cancel.mutateAsync(r._id);
      toast.success(res.message ?? 'Request cancelled');
      return true;
    } catch (err) {
      toast.error('Could not cancel the request', toApiError(err).message);
      return false;
    }
  };
  return { run, pending: cancel.isPending };
};

export const RegularizationCard = ({ r, timeZone }: { r: Regularization; timeZone: string }) => {
  const { c } = useTheme();
  const cancel = useCancelRequest();
  const pending = PENDING_STATUSES.includes(r.status);
  const dateLabel = formatKey(r.date.slice(0, 10), 'EEE, dd MMM yyyy');
  return (
    <Card padding={0}>
      <Pressable
        onPress={() => router.push({ pathname: '/attendance/regularizations/[id]', params: { id: r._id } })}
        accessibilityRole="button"
        accessibilityLabel={`Regularization for ${dateLabel}, ${label(r.status)}, requested ${r.requestedCheckIn} to ${r.requestedCheckOut}`}
        accessibilityHint="Opens the request details"
        style={({ pressed }) => [styles.card, pressed && { backgroundColor: c.surface2 }]}
      >
        <View style={styles.head}>
          <Text weight="semibold" style={styles.flex}>
            {dateLabel}
          </Text>
          <StatusBadge status={r.status} />
        </View>
        <TimeComparison r={r} timeZone={timeZone} />
        <View style={styles.reason}>
          <Text size="sm" color="fg2" numberOfLines={2} style={styles.flex}>
            {r.reason}
          </Text>
          {r.attachmentId ? <Paperclip size={14} color={c.muted} accessibilityLabel="Has attachment" /> : null}
        </View>
        <View style={styles.foot}>
          <Text size="xs" color="muted" style={styles.flex}>
            {`Submitted ${timeAgo(r.submittedAt ?? r.createdAt)}`}
          </Text>
          {pending && r.currentApproverType ? <Badge tone="gray">{`Awaiting ${label(r.currentApproverType)}`}</Badge> : null}
        </View>
      </Pressable>
      {canCancelRegularization(r) ? (
        <View style={[styles.cancel, { borderTopColor: c.line }]}>
          <Button
            variant="outline"
            disabled={cancel.pending}
            onPress={() => void cancel.run(r)}
            accessibilityLabel={`Cancel request for ${dateLabel}`}
          >
            Cancel request
          </Button>
        </View>
      ) : null}
    </Card>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: space(3), padding: space(4), borderRadius: radius.lg },
  cancel: { borderTopWidth: StyleSheet.hairlineWidth, padding: space(3) },
  head: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  compare: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  timeBox: { flex: 1, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space(3), paddingVertical: space(2) },
  strike: { textDecorationLine: 'line-through' },
  reason: { flexDirection: 'row', alignItems: 'flex-start', gap: space(2) },
  foot: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
});
