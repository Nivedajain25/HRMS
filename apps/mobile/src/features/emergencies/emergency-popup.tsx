import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Check, DoorOpen, MapPin, Phone, X } from 'lucide-react-native';
import { Avatar, BottomSheet, Button, Text, TextField, toast } from '@/components';
import { toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fullName } from '@/lib/format';
import { timeAgo } from '@/lib/time';
import { radius, space, toneColors, useTheme } from '@/theme';
import { CATEGORY_META, useActiveEmergencies, useDecideEmergency, useUpdateEmergency, type EmergencyDecision } from './api';

const openUrl = (url: string) => Linking.openURL(url).catch(() => toast.error('No app can open this link'));

/**
 * HR / super admin: pops up over any screen the moment a new emergency arrives while the app is open (checked every
 * 10 s, alongside the push notification), with Approve / Decline / Acknowledge — same as the website's pop-up.
 */
export const EmergencyPopup = () => {
  const { c } = useTheme();
  const { can } = useAuth();
  const active = useActiveEmergencies(can('emergency:manage'));
  const decide = useDecideEmergency();
  const update = useUpdateEmergency();
  // Dismissed for this session (they stay on the Home banner and the Emergencies screen).
  const [seen, setSeen] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const fresh = (active.data ?? []).filter((e) => e.status === 'OPEN' && !seen.includes(e._id));
  const e = fresh[0];
  if (!e) return null;

  const name = e.employeeId ? fullName(e.employeeId) : 'An employee';
  const first = e.employeeId?.firstName ?? 'They';
  const cat = CATEGORY_META[e.category];
  const phone = e.contactPhone || e.employeeId?.phone;
  const red = toneColors('red', c);
  const busy = decide.isPending || update.isPending;

  const done = () => {
    setSeen((s) => [...s, e._id]);
    setNote('');
  };
  const decideAs = async (decision: EmergencyDecision) => {
    try {
      await decide.mutateAsync({ id: e._id, decision, note: note.trim() || undefined });
      toast.success(decision === 'APPROVED' ? 'Approved' : 'Declined', `${first} has been told.`);
      done();
    } catch (err) {
      toast.error('Could not send', toApiError(err).message);
    }
  };
  const acknowledge = async () => {
    try {
      await update.mutateAsync({ id: e._id, status: 'ACKNOWLEDGED' });
      toast.success('Acknowledged', `${first} will see that HR is on it.`);
      done();
    } catch (err) {
      toast.error('Could not update', toApiError(err).message);
    }
  };

  const amber = toneColors('amber', c);

  return (
    <BottomSheet open onClose={done} title="Emergency alert" description={`Raised ${timeAgo(e.createdAt)}`}>
      {/* Who and what */}
      <View style={[styles.card, { backgroundColor: red.bg, borderColor: red.border }]}>
        <View style={styles.row}>
          <Avatar name={name} uri={e.employeeId?.profilePhoto} size={48} />
          <View style={styles.flex}>
            <Text weight="bold" numberOfLines={1}>
              {name}
            </Text>
            <Text size="xs" color="muted" numberOfLines={1}>
              {[e.employeeId?.designationId?.name, e.employeeId?.departmentId?.name].filter(Boolean).join(' · ') || e.employeeId?.employeeId}
            </Text>
          </View>
        </View>
        <View style={styles.tags}>
          <View style={[styles.tag, { backgroundColor: c.surface, borderColor: red.border }]}>
            <cat.icon size={13} color={red.fg} />
            <Text size="xs" weight="semibold" style={{ color: red.fg }}>
              {cat.label}
            </Text>
          </View>
          {e.needToLeave ? (
            <View style={[styles.tag, { backgroundColor: amber.bg, borderColor: amber.border }]}>
              <DoorOpen size={13} color={amber.fg} />
              <Text size="xs" weight="semibold" style={{ color: amber.fg }}>
                Needs to leave now
              </Text>
            </View>
          ) : null}
        </View>
        {e.message ? <Text size="sm" style={[styles.quote, { color: red.fg }]}>{`“${e.message}”`}</Text> : null}
      </View>

      {/* Reach them */}
      {phone || e.location ? (
        <View style={styles.row}>
          {phone ? (
            <Button variant="outline" icon={Phone} onPress={() => void openUrl(`tel:${phone.replace(/\s+/g, '')}`)} style={styles.flex}>
              Call
            </Button>
          ) : null}
          {e.location ? (
            <Button variant="outline" icon={MapPin} onPress={() => void openUrl(`https://www.google.com/maps?q=${e.location!.latitude},${e.location!.longitude}`)} style={styles.flex}>
              Location
            </Button>
          ) : null}
        </View>
      ) : null}

      <TextField label={`Message to ${first === 'They' ? 'the employee' : first} (optional)`} value={note} onChangeText={setNote} multiline placeholder="e.g. Take care, update us tomorrow" maxLength={1000} />

      {/* The decision */}
      <View style={styles.row}>
        <Button variant="danger" icon={X} loading={decide.isPending} disabled={busy} onPress={() => void decideAs('DECLINED')} style={styles.flex}>
          Decline
        </Button>
        <Button variant="success" icon={Check} loading={decide.isPending} disabled={busy} onPress={() => void decideAs('APPROVED')} style={styles.flex}>
          Approve
        </Button>
      </View>
      <View style={[styles.footer, { borderTopColor: c.line }]}>
        <Pressable onPress={() => void acknowledge()} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Just acknowledge">
          <Text size="sm" weight="semibold" color="fg2" style={busy ? styles.dim : undefined}>
            Just acknowledge
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            done();
            router.push('/more/emergencies');
          }}
          hitSlop={8}
          accessibilityRole="link"
          accessibilityLabel="Open details"
        >
          <Text size="sm" weight="semibold" color="accent">
            Open details →
          </Text>
        </Pressable>
      </View>
      {fresh.length > 1 ? (
        <Text size="xs" color="muted" align="center">{`+${fresh.length - 1} more new alert${fresh.length > 2 ? 's' : ''} after this one`}</Text>
      ) : null}
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space(3.5), gap: space(3) },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5) },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.full, paddingHorizontal: space(2.5), paddingVertical: 4 },
  quote: { fontStyle: 'italic' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space(3) },
  dim: { opacity: 0.5 },
});
