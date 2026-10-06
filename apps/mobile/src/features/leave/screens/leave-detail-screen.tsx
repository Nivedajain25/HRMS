import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ban, Check, Pencil, Send, X } from 'lucide-react-native';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ErrorState,
  Header,
  Notice,
  Screen,
  SectionHeader,
  Skeleton,
  StatusBadge,
  Text,
} from '@/components';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fullName, label } from '@/lib/format';
import { dateKeyIn, formatDate, formatDateTimeIn } from '@/lib/time';
import { space, useTheme } from '@/theme';
import { useLeave, useLeaveBalances, type LeaveRequest } from '../api';
import { AttachmentRow } from '../components/attachment-row';
import { leaveTimeline, Timeline } from '../components/timeline';
import { useLeaveActions } from '../components/use-leave-actions';
import {
  attachmentOf,
  canCancelLeave,
  canDecideLeave,
  canEditLeave,
  canRejectLeave,
  canSubmitLeave,
  formatDays,
  formatNum,
  isLeaveOwner,
  isPendingStatus,
  sessionLabel,
  typeColor,
  typeOf,
} from '../lib';

const Fact = ({ label: text, children }: { label: string; children: ReactNode }) => (
  <View style={styles.fact} accessible>
    <Text size="sm" color="muted" style={styles.factLabel}>
      {text}
    </Text>
    <View style={styles.factValue}>{typeof children === 'string' ? <Text size="sm" weight="medium" align="right">{children}</Text> : children}</View>
  </View>
);

/** The employee's balance for the requested type (shown to approvers when they can read it). */
const BalanceContext = ({ l }: { l: LeaveRequest }) => {
  const type = typeOf(l);
  const year = Number(l.startDate.slice(0, 4));
  const balances = useLeaveBalances({ employeeId: l.employeeId._id, year, enabled: !!type });
  if (!type || balances.error || balances.isLoading) {
    return balances.isLoading ? <Skeleton height={20} width="70%" /> : null;
  }
  const b = balances.data?.find((x) => x.leaveType._id === type._id);
  if (!b) return null;
  if (b.leaveType.paid === false) {
    return (
      <Notice tone="info">{`${type.name} is unpaid. ${formatNum(b.used)} days taken in ${year}${b.pending ? `, ${formatNum(b.pending)} pending` : ''}.`}</Notice>
    );
  }
  const low = b.remaining < 0;
  return (
    <Notice tone={low ? 'warning' : 'info'}>
      {`${type.name} balance ${year}: ${formatNum(b.remaining)} days remaining · ${formatNum(b.used)} used · ${formatNum(b.pending)} pending (pending includes this request).`}
    </Notice>
  );
};

/**
 * Leave request detail. Owners can submit / edit / cancel their drafts and requests;
 * approvers (and the Approvals tab, `approval`) get Approve / Reject.
 */
export const LeaveDetailScreen = ({ approval }: { approval?: boolean }) => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { user, timeZone } = useAuth();
  const query = useLeave(id);
  const actions = useLeaveActions();
  const l = query.data;
  const backTo = approval ? '/approvals' : '/leave';

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(backTo);
  };

  const header = <Header title={approval ? 'Leave approval' : 'Leave request'} back backTo={backTo} />;

  if (query.isLoading) {
    return (
      <Screen header={header}>
        <Card style={styles.gap}>
          <Skeleton width={200} height={22} />
          <Skeleton height={80} />
          <Skeleton height={48} />
        </Card>
        <Card>
          <Skeleton height={120} />
        </Card>
      </Screen>
    );
  }

  if (query.error || !l) {
    const e = query.error;
    const forbidden = e instanceof ApiError && e.status === 403;
    const missing = e instanceof ApiError && e.status === 404;
    return (
      <Screen header={header} onRefresh={() => query.refetch()}>
        <Card>
          <ErrorState
            title={forbidden ? 'Access denied' : missing ? 'Request not found' : 'Could not load this request'}
            error={e}
            onRetry={forbidden || missing ? undefined : () => void query.refetch()}
          />
        </Card>
      </Screen>
    );
  }

  const type = typeOf(l);
  const color = typeColor(type);
  const own = isLeaveOwner(user, l);
  const today = dateKeyIn(timeZone);
  const attachment = attachmentOf(l);
  const decide = canDecideLeave(user, l);
  const reject = canRejectLeave(user, l);
  const submit = canSubmitLeave(user, l);
  const edit = canEditLeave(user, l);
  const cancel = canCancelLeave(user, l, today);
  const busy = actions.pending;
  const name = fullName(l.employeeId);

  const afterDecision = (done: unknown) => {
    if (done) goBack();
  };

  const footer =
    decide || submit || edit || cancel ? (
      <View style={styles.footer}>
        {decide ? (
          <View style={styles.row}>
            {reject ? (
              <Button
                variant="danger"
                size="lg"
                icon={X}
                style={styles.flex}
                disabled={busy}
                loading={actions.pendingAction === 'reject'}
                onPress={() => void actions.reject(l).then(afterDecision)}
                accessibilityLabel={`Reject leave for ${name}`}
              >
                Reject
              </Button>
            ) : null}
            <Button
              variant="success"
              size="lg"
              icon={Check}
              style={styles.flex}
              disabled={busy}
              loading={actions.pendingAction === 'approve'}
              onPress={() => void actions.approve(l).then(afterDecision)}
              accessibilityLabel={`Approve leave for ${name}`}
            >
              Approve
            </Button>
          </View>
        ) : null}
        {submit ? (
          <Button icon={Send} fullWidth disabled={busy} loading={actions.pendingAction === 'submit'} onPress={() => void actions.submit(l)}>
            Submit for approval
          </Button>
        ) : null}
        {edit || cancel ? (
          <View style={styles.row}>
            {edit ? (
              <Button
                variant="outline"
                icon={Pencil}
                style={styles.flex}
                disabled={busy}
                onPress={() => router.push({ pathname: '/leave/apply', params: { draftId: l._id } })}
              >
                Edit draft
              </Button>
            ) : null}
            {cancel ? (
              <Button
                variant="outline"
                icon={Ban}
                style={styles.flex}
                disabled={busy}
                loading={actions.pendingAction === 'cancel'}
                onPress={() =>
                  void actions.cancel(l).then((done) => {
                    if (done && l.status === 'DRAFT') goBack();
                  })
                }
              >
                {l.status === 'DRAFT' ? 'Discard' : 'Cancel leave'}
              </Button>
            ) : null}
          </View>
        ) : null}
      </View>
    ) : undefined;

  return (
    <Screen header={header} footer={footer} onRefresh={() => query.refetch()}>
      {actions.error ? <Notice tone="danger">{actions.error}</Notice> : null}
      {approval && !decide && !isPendingStatus(l.status) ? (
        <Notice tone="info">{`This request is ${label(l.status).toLowerCase()} — no decision is needed.`}</Notice>
      ) : null}

      <Card style={styles.gap}>
        {!own || approval ? (
          <View style={styles.person}>
            <Avatar name={name} uri={l.employeeId?.profilePhoto} size={48} />
            <View style={styles.flex}>
              <Text size="lg" weight="semibold" numberOfLines={1}>
                {name}
              </Text>
              <Text size="sm" color="muted">
                {l.employeeId?.employeeId}
              </Text>
            </View>
          </View>
        ) : null}
        <View style={styles.row}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <Text size="lg" weight="semibold" style={styles.flex} accessibilityRole="header">
            {type?.name ?? 'Leave'}
          </Text>
          <StatusBadge status={l.status} />
        </View>
        <View style={[styles.days, { backgroundColor: c.surface2, borderColor: c.line }]}>
          <Text size="3xl" weight="bold" tabular>
            {formatNum(l.days)}
          </Text>
          <Text color="muted">{l.days === 1 ? 'day' : 'days'}</Text>
          {l.halfDay ? <Badge tone="amber">{sessionLabel(l.halfDaySession)}</Badge> : null}
        </View>
        <View>
          <Fact label="From">{formatDate(l.startDate, 'EEE, dd MMM yyyy')}</Fact>
          <Fact label="To">{formatDate(l.endDate, 'EEE, dd MMM yyyy')}</Fact>
          <Fact label="Duration">{`${formatDays(l.days)}${l.halfDay ? ` · ${sessionLabel(l.halfDaySession)}` : ''}`}</Fact>
          <Fact label="Pay">{type?.paid === false ? 'Unpaid' : 'Paid'}</Fact>
          <Fact label={l.status === 'DRAFT' ? 'Created' : 'Applied'}>{formatDateTimeIn(l.submittedAt ?? l.createdAt, timeZone)}</Fact>
          {isPendingStatus(l.status) && l.currentApproverType ? (
            <Fact label="Waiting for">{`${label(l.currentApproverType)} approval`}</Fact>
          ) : null}
        </View>
      </Card>

      {decide ? <BalanceContext l={l} /> : null}

      <Card style={styles.gap}>
        <View style={styles.block}>
          <Text size="sm" color="muted">
            Reason
          </Text>
          <Text>{l.reason}</Text>
        </View>
        {l.status === 'REJECTED' && l.rejectionReason ? <Notice tone="danger">{`Rejected: ${l.rejectionReason}`}</Notice> : null}
        {attachment ? (
          <View style={styles.block}>
            <Text size="sm" color="muted">
              Attachment
            </Text>
            <AttachmentRow
              fileId={attachment._id}
              name={attachment.originalName ?? attachment.title}
              size={attachment.size}
              mimeType={attachment.mimeType}
            />
          </View>
        ) : null}
      </Card>

      <SectionHeader title="Approval" />
      <Card>
        <Timeline items={leaveTimeline(l, timeZone)} />
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
  dot: { width: 12, height: 12, borderRadius: 6 },
  days: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: space(2),
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: space(4),
    paddingVertical: space(3),
  },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: space(3), paddingVertical: space(2) },
  factLabel: { flexShrink: 0 },
  factValue: { flex: 1, alignItems: 'flex-end' },
  footer: { gap: space(2) },
});
