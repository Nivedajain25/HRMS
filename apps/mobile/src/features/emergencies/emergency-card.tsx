import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Check, CheckCircle2, Eye, MapPin, Phone, X } from 'lucide-react-native';
import { Avatar, Badge, BottomSheet, Button, Card, Text, TextField, toast } from '@/components';
import { toApiError } from '@/lib/api';
import { fullName } from '@/lib/format';
import { timeAgo } from '@/lib/time';
import { radius, space, toneColors, useTheme } from '@/theme';
import { CATEGORY_META, useDecideEmergency, useUpdateEmergency, type Emergency, type EmergencyDecision } from './api';

const openUrl = (url: string) => Linking.openURL(url).catch(() => toast.error('No app can open this link'));

/** "Resolve" with an optional note on what was done. */
const ResolveSheet = ({ e, onClose }: { e: Emergency; onClose: () => void }) => {
  const update = useUpdateEmergency();
  const [note, setNote] = useState('');
  const save = async () => {
    try {
      await update.mutateAsync({ id: e._id, status: 'RESOLVED', note: note.trim() || undefined });
      toast.success('Emergency closed', 'The employee has been told.');
      onClose();
    } catch (err) {
      toast.error('Could not update', toApiError(err).message);
    }
  };
  return (
    <BottomSheet open onClose={onClose} title="Close this emergency?" description={e.employeeId ? fullName(e.employeeId) : undefined}>
      <TextField label="Note (optional)" value={note} onChangeText={setNote} multiline placeholder="What was done, e.g. allowed to go home" maxLength={1000} />
      <Button variant="success" icon={CheckCircle2} loading={update.isPending} onPress={() => void save()}>
        Mark as resolved
      </Button>
      <Button variant="ghost" onPress={onClose}>
        Cancel
      </Button>
    </BottomSheet>
  );
};

/** Approve (they may leave) or decline, with an optional message to the employee. */
const DecisionSheet = ({ e, decision, onClose }: { e: Emergency; decision: EmergencyDecision; onClose: () => void }) => {
  const decide = useDecideEmergency();
  const [note, setNote] = useState('');
  const approve = decision === 'APPROVED';
  const name = e.employeeId?.firstName ?? 'The employee';
  const save = async () => {
    try {
      await decide.mutateAsync({ id: e._id, decision, note: note.trim() || undefined });
      toast.success(approve ? 'Approved' : 'Declined', `${name} has been told.`);
      onClose();
    } catch (err) {
      toast.error('Could not send', toApiError(err).message);
    }
  };
  return (
    <BottomSheet
      open
      onClose={onClose}
      title={approve ? `Let ${name} leave?` : `Decline ${name}'s request?`}
      description={approve ? 'They get a notification straight away, and it is noted on today\u2019s attendance.' : 'They get a notification straight away.'}
    >
      <TextField
        label="Message to the employee (optional)"
        value={note}
        onChangeText={setNote}
        multiline
        placeholder={approve ? 'e.g. Take care, update us tomorrow' : 'e.g. Please wait until your manager arrives'}
        maxLength={1000}
      />
      <Button variant={approve ? 'success' : 'danger'} icon={approve ? Check : X} loading={decide.isPending} onPress={() => void save()}>
        {approve ? 'Approve' : 'Decline'}
      </Button>
      <Button variant="ghost" onPress={onClose}>
        Cancel
      </Button>
    </BottomSheet>
  );
};

/** One emergency alert: who, what, when, call / map, and Approve / Decline / Acknowledge / Resolve for HR. */
export const EmergencyCard = ({ e }: { e: Emergency }) => {
  const { c } = useTheme();
  const update = useUpdateEmergency();
  const [resolving, setResolving] = useState(false);
  const [deciding, setDeciding] = useState<EmergencyDecision | null>(null);
  const name = e.employeeId ? fullName(e.employeeId) : 'An employee';
  const cat = CATEGORY_META[e.category];
  const phone = e.contactPhone || e.employeeId?.phone;
  const open = e.status !== 'RESOLVED';
  const tone = toneColors(e.status === 'OPEN' ? 'red' : 'amber', c);

  const acknowledge = async () => {
    try {
      await update.mutateAsync({ id: e._id, status: 'ACKNOWLEDGED' });
      toast.success('Acknowledged', `${e.employeeId?.firstName ?? 'They'} will see that HR is on it.`);
    } catch (err) {
      toast.error('Could not update', toApiError(err).message);
    }
  };

  return (
    <Card style={[styles.card, open && { borderColor: e.status === 'OPEN' ? c.danger : c.warning, borderWidth: 2 }]}>
      <View style={styles.row}>
        <Avatar name={name} uri={e.employeeId?.profilePhoto} size={44} />
        <View style={styles.flex}>
          <Text weight="bold" numberOfLines={1}>
            {name}
          </Text>
          <Text size="xs" color="muted" numberOfLines={1}>
            {[e.employeeId?.employeeId, e.employeeId?.departmentId?.name].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {e.decision ? (
          <Badge tone={e.decision === 'APPROVED' ? 'green' : 'red'} dot>
            {e.decision === 'APPROVED' ? 'Approved' : 'Declined'}
          </Badge>
        ) : (
          <Badge tone={e.status === 'OPEN' ? 'red' : e.status === 'ACKNOWLEDGED' ? 'amber' : 'green'} dot>
            {e.status === 'OPEN' ? 'New' : e.status === 'ACKNOWLEDGED' ? 'Acknowledged' : 'Resolved'}
          </Badge>
        )}
      </View>

      <View style={[styles.what, { backgroundColor: open ? tone.bg : c.surface2 }]}>
        <View style={styles.row}>
          <cat.icon size={18} color={open ? tone.fg : c.fg2} />
          <Text size="md" weight="semibold" style={[styles.flex, open ? { color: tone.fg } : undefined]}>{`${cat.label}${e.needToLeave ? ' · needs to leave now' : ''}`}</Text>
        </View>
        {e.message ? (
          <Text size="sm" style={{ color: open ? tone.fg : c.fg2 }}>
            {`“${e.message}”`}
          </Text>
        ) : null}
      </View>

      <Text size="xs" color="muted">
        {[
          `Raised ${timeAgo(e.createdAt)}`,
          e.acknowledgedBy ? `seen by ${fullName(e.acknowledgedBy)}` : null,
          e.decidedBy
            ? `${e.decision === 'APPROVED' ? 'approved' : 'declined'} by ${fullName(e.decidedBy)} ${timeAgo(e.decidedAt)}`
            : e.resolvedBy
              ? `closed by ${fullName(e.resolvedBy)} ${timeAgo(e.resolvedAt)}`
              : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {e.notes?.length ? (
        <Text size="xs" color="fg2">{`Note: “${e.notes.at(-1)!.text}”${e.notes.at(-1)!.byName ? ` — ${e.notes.at(-1)!.byName}` : ''}`}</Text>
      ) : null}

      <View style={styles.row}>
        {phone ? (
          <Button variant="outline" icon={Phone} onPress={() => void openUrl(`tel:${phone.replace(/\s+/g, '')}`)} style={styles.flex}>
            Call
          </Button>
        ) : null}
        {e.location ? (
          <Button variant="outline" icon={MapPin} onPress={() => void openUrl(`https://www.google.com/maps?q=${e.location!.latitude},${e.location!.longitude}`)} style={styles.flex}>
            Map
          </Button>
        ) : null}
      </View>
      {open ? (
        <View style={styles.row}>
          <Button variant="success" icon={Check} onPress={() => setDeciding('APPROVED')} style={styles.flex}>
            Approve
          </Button>
          <Button variant="danger" icon={X} onPress={() => setDeciding('DECLINED')} style={styles.flex}>
            Decline
          </Button>
        </View>
      ) : null}
      {open ? (
        <View style={styles.row}>
          {e.status === 'OPEN' ? (
            <Button variant="outline" icon={Eye} loading={update.isPending} onPress={() => void acknowledge()} style={styles.flex}>
              Acknowledge
            </Button>
          ) : null}
          <Button variant="ghost" icon={CheckCircle2} onPress={() => setResolving(true)} style={styles.flex}>
            Just close
          </Button>
        </View>
      ) : null}
      {resolving ? <ResolveSheet e={e} onClose={() => setResolving(false)} /> : null}
      {deciding ? <DecisionSheet e={e} decision={deciding} onClose={() => setDeciding(null)} /> : null}
    </Card>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: space(3) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  what: { borderRadius: radius.md, padding: space(3), gap: space(1) },
});
