import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Paperclip, Receipt } from 'lucide-react-native';
import { Avatar, Badge, Card, StatusBadge, Text } from '@/components';
import { TimeComparison } from '@/features/attendance/components/regularization-card';
import type { Regularization } from '@/features/attendance/api';
import { formatMoney, fullName, label } from '@/lib/format';
import { formatDate, formatKey, timeAgo } from '@/lib/time';
import { radius, space, useTheme } from '@/theme';
import type { ExpenseRecord } from '../api';
import { approverLabel } from '../lib';

const Frame = ({ onPress, a11y, children }: { onPress: () => void; a11y: string; children: ReactNode }) => {
  const { c } = useTheme();
  return (
    <Card padding={0}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint="Opens the request to approve or reject it"
        style={({ pressed }) => [styles.card, pressed && { backgroundColor: c.surface2 }]}
      >
        {children}
      </Pressable>
    </Card>
  );
};

const Person = ({ name, code, photo, right }: { name: string; code?: string; photo?: string | null; right?: ReactNode }) => (
  <View style={styles.person}>
    <Avatar name={name} uri={photo} size={40} />
    <View style={styles.flex}>
      <Text weight="semibold" numberOfLines={1}>
        {name}
      </Text>
      {code ? (
        <Text size="xs" color="muted" numberOfLines={1}>
          {code}
        </Text>
      ) : null}
    </View>
    {right}
  </View>
);

export const RegularizationApprovalCard = ({ r, timeZone, onPress }: { r: Regularization; timeZone: string; onPress: () => void }) => {
  const { c } = useTheme();
  const name = fullName(r.employeeId);
  const dateLabel = formatKey(r.date.slice(0, 10), 'EEE, dd MMM yyyy');
  return (
    <Frame onPress={onPress} a11y={`${name}, attendance regularization for ${dateLabel}, requested ${r.requestedCheckIn} to ${r.requestedCheckOut}. ${r.reason}`}>
      <Person name={name} code={r.employeeId?.employeeId} photo={r.employeeId?.profilePhoto} right={<StatusBadge status={r.status} />} />
      <Text weight="medium">{dateLabel}</Text>
      <TimeComparison r={r} timeZone={timeZone} />
      <View style={styles.row}>
        <Text size="sm" color="fg2" numberOfLines={2} style={styles.flex}>
          {r.reason}
        </Text>
        {r.attachmentId ? <Paperclip size={14} color={c.muted} accessibilityLabel="Has attachment" /> : null}
      </View>
      <View style={styles.row}>
        <Text size="xs" color="subtle" style={styles.flex}>
          {`Submitted ${timeAgo(r.submittedAt ?? r.createdAt)}`}
        </Text>
        {r.currentApproverType ? <Badge tone="gray">{`${label(r.currentApproverType)} step`}</Badge> : null}
      </View>
    </Frame>
  );
};

export const ExpenseApprovalCard = ({ e, onPress }: { e: ExpenseRecord; onPress: () => void }) => {
  const { c } = useTheme();
  const name = fullName(e.employeeId);
  const amount = formatMoney(e.amount, e.currency);
  return (
    <Frame onPress={onPress} a11y={`${name}, ${amount}, ${label(e.category)} on ${formatDate(e.date)}${e.merchant ? ` at ${e.merchant}` : ''}, ${e.expenseNumber}, ${label(e.status)}`}>
      <Person
        name={name}
        code={e.employeeId?.employeeId}
        photo={e.employeeId?.profilePhoto}
        right={
          <Text size="lg" weight="bold" tabular>
            {amount}
          </Text>
        }
      />
      <View style={styles.row}>
        <Text size="sm" weight="medium" style={styles.flex} numberOfLines={1}>
          {`${label(e.category)} · ${formatDate(e.date)}`}
        </Text>
        <StatusBadge status={e.status} />
      </View>
      {e.merchant || e.description ? (
        <Text size="sm" color="fg2" numberOfLines={2}>
          {[e.merchant, e.description].filter(Boolean).join(' — ')}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Text size="xs" color="subtle" style={styles.flex} numberOfLines={1}>
          {`${e.expenseNumber} · ${e.status === 'APPROVED' && e.approvedAt ? `approved ${timeAgo(e.approvedAt)}` : `submitted ${timeAgo(e.submittedAt ?? e.createdAt)}`}`}
        </Text>
        {e.receiptFileId ? <Receipt size={14} color={c.muted} accessibilityLabel="Has receipt" /> : null}
        {e.currentApproverType && e.status !== 'APPROVED' ? <Badge tone="gray">{`${approverLabel(e.currentApproverType)} step`}</Badge> : null}
      </View>
    </Frame>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { padding: space(4), gap: space(2.5), borderRadius: radius.lg },
  person: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
});
