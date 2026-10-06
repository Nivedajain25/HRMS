import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Circle, MinusCircle, Paperclip, XCircle } from 'lucide-react-native';
import { Badge, Button, Card, ErrorState, Header, Notice, Screen, SectionHeader, Skeleton, StatusBadge, Text } from '@/components';
import { useAuth } from '@/lib/auth';
import { label } from '@/lib/format';
import { formatDateTimeIn, formatKey } from '@/lib/time';
import { space, useTheme } from '@/theme';
import { useRegularization, type ApprovalStep } from '../api';
import { canCancelRegularization, PENDING_STATUSES, TimeComparison, useCancelRequest } from '../components/regularization-card';

const StepRow = ({ step, current, timeZone, last }: { step: ApprovalStep; current: boolean; timeZone: string; last: boolean }) => {
  const { c } = useTheme();
  const Icon =
    step.status === 'APPROVED' ? CheckCircle2 : step.status === 'REJECTED' ? XCircle : step.status === 'SKIPPED' ? MinusCircle : Circle;
  const color = step.status === 'APPROVED' ? c.success : step.status === 'REJECTED' ? c.danger : current ? c.warning : c.subtle;
  return (
    <View style={styles.step}>
      <View style={styles.rail}>
        <Icon size={20} color={color} />
        {!last ? <View style={[styles.line, { backgroundColor: c.line }]} /> : null}
      </View>
      <View style={styles.stepBody}>
        <View style={styles.stepHead}>
          <Text weight="medium">{`${label(step.approverType)} approval`}</Text>
          <StatusBadge status={step.status} />
        </View>
        {step.actedByName || step.actedAt ? (
          <Text size="sm" color="muted">
            {[step.actedByName, step.actedAt ? formatDateTimeIn(step.actedAt, timeZone) : null].filter(Boolean).join(' · ')}
          </Text>
        ) : current ? (
          <Text size="sm" color="muted">
            Waiting for a decision
          </Text>
        ) : null}
        {step.comment ? (
          <Text size="sm" color="fg2">
            {`“${step.comment}”`}
          </Text>
        ) : null}
      </View>
    </View>
  );
};

export const RegularizationDetailScreen = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { timeZone } = useAuth();
  const query = useRegularization(id);
  const cancel = useCancelRequest();
  const r = query.data;

  return (
    <Screen header={<Header title="Regularization request" back backTo="/attendance/regularizations" />} onRefresh={() => query.refetch()}>
      {query.isLoading ? (
        <Card style={styles.gap}>
          <Skeleton width={180} height={20} />
          <Skeleton height={56} />
          <Skeleton height={40} />
        </Card>
      ) : query.error || !r ? (
        <Card>
          <ErrorState title="Could not load this request" error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      ) : (
        <>
          <Card style={styles.gap}>
            <View style={styles.head}>
              <Text size="lg" weight="semibold" style={styles.flex} accessibilityRole="header">
                {formatKey(r.date.slice(0, 10), 'EEEE, d MMM yyyy')}
              </Text>
              <StatusBadge status={r.status} />
            </View>
            <TimeComparison r={r} timeZone={timeZone} />
            {PENDING_STATUSES.includes(r.status) && r.currentApproverType ? (
              <Badge tone="gray">{`Awaiting ${label(r.currentApproverType)}`}</Badge>
            ) : null}
            <View style={styles.block}>
              <Text size="sm" color="muted">
                Reason
              </Text>
              <Text>{r.reason}</Text>
            </View>
            {r.attachmentId ? (
              <View style={styles.inline}>
                <Paperclip size={16} color={c.muted} />
                <Text size="sm" color="fg2" numberOfLines={1} style={styles.flex}>
                  {r.attachmentId.originalName ?? r.attachmentId.name ?? 'Attachment'}
                </Text>
              </View>
            ) : null}
            {r.rejectionReason ? <Notice tone="danger">{`Rejected: ${r.rejectionReason}`}</Notice> : null}
            <Text size="xs" color="muted">
              {`Submitted ${formatDateTimeIn(r.submittedAt ?? r.createdAt, timeZone)}${r.decidedAt ? ` · Decided ${formatDateTimeIn(r.decidedAt, timeZone)}` : ''}`}
            </Text>
          </Card>

          {r.approvalSteps.length ? (
            <>
              <SectionHeader title="Approval chain" />
              <Card>
                {r.approvalSteps.map((s, i) => (
                  <StepRow
                    key={`${s.approverType}-${i}`}
                    step={s}
                    current={i === r.currentStep && PENDING_STATUSES.includes(r.status)}
                    timeZone={timeZone}
                    last={i === r.approvalSteps.length - 1}
                  />
                ))}
              </Card>
            </>
          ) : null}

          {canCancelRegularization(r) ? (
            <Button
              variant="outline"
              disabled={cancel.pending}
              onPress={() =>
                void cancel.run(r).then((done) => {
                  if (!done) return;
                  if (router.canGoBack()) router.back();
                  else router.replace('/attendance/regularizations');
                })
              }
            >
              Cancel request
            </Button>
          ) : null}
        </>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space(4) },
  head: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  block: { gap: space(1) },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  step: { flexDirection: 'row', gap: space(3) },
  rail: { alignItems: 'center', width: 20 },
  line: { width: 2, flex: 1, marginVertical: space(1), minHeight: 16 },
  stepBody: { flex: 1, gap: 2, paddingBottom: space(4) },
  stepHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(2) },
});
