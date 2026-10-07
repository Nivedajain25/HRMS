import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Hourglass } from 'lucide-react-native';
import { BottomSheet, Button, Text } from '@/components';
import { useAuth } from '@/lib/auth';
import { fullName } from '@/lib/format';
import { storage, StorageKeys } from '@/lib/storage';
import { timeAgo } from '@/lib/time';
import { radius, space, toneColors, useTheme } from '@/theme';
import { CATEGORY_META, useMyLatestEmergency, type Emergency } from './api';

const DAY = 24 * 60 * 60 * 1000;
const who = (p?: { firstName: string; lastName: string } | null) => (p ? fullName(p) : 'HR');
/** HR's message sent with the decision ("Approved: …" note), if any. */
const decisionMessage = (e: Emergency) => {
  const last = e.notes?.at(-1)?.text ?? '';
  const m = /^(Approved|Declined):\s*([\s\S]+)$/.exec(last);
  return m?.[2] ?? null;
};

/**
 * The employee's side of an emergency, over every screen: a bar at the top while HR has it, then — the moment HR
 * approves or declines — a one-time pop-up. The decision itself lives in Notifications (with the push), not in a bar.
 */
export const MyEmergencyStatus = () => {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { hasEmployee } = useAuth();
  const q = useMyLatestEmergency(hasEmployee);
  const [seen, setSeen] = useState<string[] | null>(null);

  useEffect(() => {
    void storage.get(StorageKeys.emergencyDecisionsSeen).then((v) => {
      try {
        setSeen(v ? (JSON.parse(v) as string[]) : []);
      } catch {
        setSeen([]);
      }
    });
  }, []);

  const e = q.data;
  if (!e || seen === null) return null;
  const waiting = e.status !== 'RESOLVED';
  const decided = !!e.decision && !!e.decidedAt && Date.now() - Date.parse(e.decidedAt) < DAY;
  if (!waiting && !decided) return null;

  const approved = e.decision === 'APPROVED';
  const message = decided ? decisionMessage(e) : null;
  const tone = toneColors(waiting ? 'amber' : approved ? 'green' : 'red', c);
  const markSeen = () => {
    const next = [...seen, e._id].slice(-50);
    setSeen(next);
    void storage.set(StorageKeys.emergencyDecisionsSeen, JSON.stringify(next));
  };
  return (
    <>
      {waiting ? (
        <View pointerEvents="box-none" style={[styles.barWrap, { top: insets.top + space(1) }]}>
          <Pressable
            onPress={() => router.push('/more/notifications')}
            accessibilityRole="button"
            accessibilityLabel="Your emergency alert is with HR"
            style={[styles.bar, { backgroundColor: tone.solid }]}
          >
            <Hourglass size={18} color="#ffffff" />
            <View style={styles.flex}>
              <Text size="sm" weight="bold" style={styles.white} numberOfLines={1}>
                Your emergency alert is with HR
              </Text>
              <Text size="xs" style={styles.dim} numberOfLines={1}>
                {`${e.status === 'ACKNOWLEDGED' ? `Seen by ${who(e.acknowledgedBy)}` : 'Waiting for a response'} · raised ${timeAgo(e.createdAt)}`}
              </Text>
            </View>
          </Pressable>
        </View>
      ) : null}

      {decided && !seen.includes(e._id) ? (
        <BottomSheet open onClose={markSeen} title={approved ? '✅ Approved — you can leave' : '❌ Request declined'}>
          <View style={[styles.card, { backgroundColor: tone.bg, borderColor: tone.border }]}>
            <Text size="sm">
              <Text size="sm" weight="bold">
                {who(e.decidedBy)}
              </Text>
              {` ${approved ? 'approved' : 'declined'} your ${CATEGORY_META[e.category].label.toLowerCase()} alert ${timeAgo(e.decidedAt!)}.`}
            </Text>
            <Text size="sm" style={message ? [styles.quote, { color: tone.fg }] : undefined} color={message ? undefined : 'muted'}>
              {message ? `“${message}”` : approved ? 'You can go now — take care.' : 'Please speak to HR or your manager.'}
            </Text>
          </View>
          <Button variant={approved ? 'success' : 'primary'} onPress={markSeen}>
            {approved ? 'OK, thanks' : 'OK'}
          </Button>
        </BottomSheet>
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  barWrap: { position: 'absolute', left: space(3), right: space(3), zIndex: 50 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2.5),
    borderRadius: radius.lg,
    paddingVertical: space(2.5),
    paddingHorizontal: space(3.5),
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  white: { color: '#ffffff' },
  dim: { color: 'rgba(255,255,255,0.92)' },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space(3.5), gap: space(2) },
  quote: { fontStyle: 'italic' },
});
