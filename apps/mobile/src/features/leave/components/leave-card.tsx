import { Pressable, StyleSheet, View } from 'react-native';
import { Paperclip } from 'lucide-react-native';
import { Avatar, Badge, Card, StatusBadge, Text } from '@/components';
import { fullName, label } from '@/lib/format';
import { timeAgo } from '@/lib/time';
import { radius, space, useTheme } from '@/theme';
import type { LeaveRequest } from '../api';
import { attachmentOf, formatDays, isPendingStatus, leaveRange, typeColor, typeOf } from '../lib';

/** Leave request card: type color, dates, days, status (and the employee for team / approval lists). */
export const LeaveCard = ({ l, showEmployee, onPress }: { l: LeaveRequest; showEmployee?: boolean; onPress: () => void }) => {
  const { c } = useTheme();
  const type = typeOf(l);
  const color = typeColor(type);
  const name = fullName(l.employeeId);
  const range = leaveRange(l);
  const pending = isPendingStatus(l.status);
  return (
    <Card padding={0}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[
          showEmployee ? name : null,
          type?.name ?? 'Leave',
          range,
          formatDays(l.days),
          label(l.status),
          pending && l.currentApproverType ? `awaiting ${label(l.currentApproverType)}` : null,
        ]
          .filter(Boolean)
          .join(', ')}
        accessibilityHint="Opens the request details"
        style={({ pressed }) => [styles.card, pressed && { backgroundColor: c.surface2 }]}
      >
        <View style={[styles.bar, { backgroundColor: color }]} />
        <View style={styles.body}>
          {showEmployee ? (
            <View style={styles.person}>
              <Avatar name={name} uri={l.employeeId?.profilePhoto} size={32} />
              <View style={styles.flex}>
                <Text weight="semibold" numberOfLines={1}>
                  {name}
                </Text>
                <Text size="xs" color="muted" numberOfLines={1}>
                  {l.employeeId?.employeeId}
                </Text>
              </View>
            </View>
          ) : null}
          <View style={styles.row}>
            <View style={[styles.dot, { backgroundColor: color }]} />
            <Text weight={showEmployee ? 'medium' : 'semibold'} numberOfLines={1} style={styles.flex}>
              {type?.name ?? 'Leave'}
            </Text>
            <StatusBadge status={l.status} />
          </View>
          <View style={styles.row}>
            <Text size="sm" color="fg2" tabular style={styles.flex} numberOfLines={2}>
              {range}
            </Text>
            <Text size="sm" weight="semibold" tabular>
              {formatDays(l.days)}
            </Text>
          </View>
          {l.reason ? (
            <View style={styles.row}>
              <Text size="sm" color="muted" numberOfLines={1} style={styles.flex}>
                {l.reason}
              </Text>
              {attachmentOf(l) ? <Paperclip size={14} color={c.muted} accessibilityLabel="Has attachment" /> : null}
            </View>
          ) : null}
          <View style={styles.row}>
            <Text size="xs" color="subtle" style={styles.flex} numberOfLines={1}>
              {l.status === 'DRAFT' ? `Draft saved ${timeAgo(l.updatedAt ?? l.createdAt)}` : `Applied ${timeAgo(l.submittedAt ?? l.createdAt)}`}
            </Text>
            {pending && l.currentApproverType ? <Badge tone="gray">{`Awaiting ${label(l.currentApproverType)}`}</Badge> : null}
          </View>
        </View>
      </Pressable>
    </Card>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { flexDirection: 'row', borderRadius: radius.lg, overflow: 'hidden' },
  bar: { width: 4 },
  body: { flex: 1, padding: space(4), paddingLeft: space(3.5), gap: space(1.5) },
  person: { flexDirection: 'row', alignItems: 'center', gap: space(2.5), marginBottom: space(1) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
