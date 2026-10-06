import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CheckCircle2, Siren } from 'lucide-react-native';
import { BottomSheet, Button, Checkbox, PressScale, PulseRing, Text, TextField, toast } from '@/components';
import { toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { radius, space, useTheme } from '@/theme';
import { CATEGORY_META, useRaiseEmergency, type Emergency, type EmergencyCategory } from './api';

/**
 * Red siren button (home header): a personal emergency, e.g. having to rush home. HR and the reporting manager
 * are notified immediately. Same flow as the web "Emergency" button.
 */
export const EmergencyButton = () => {
  const { c } = useTheme();
  const { hasEmployee } = useAuth();
  const raise = useRaiseEmergency();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<EmergencyCategory>('FAMILY');
  const [needToLeave, setNeedToLeave] = useState(true);
  const [message, setMessage] = useState('');
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState<Emergency | null>(null);

  if (!hasEmployee) return null;

  const close = () => {
    setOpen(false);
    setSent(null);
    setMessage('');
  };

  const submit = async () => {
    try {
      const res = await raise.mutateAsync({ category, needToLeave, message: message.trim() || undefined, contactPhone: phone.trim() || undefined });
      setSent(res.data);
    } catch (err) {
      toast.error('Could not inform HR', toApiError(err).message);
    }
  };

  return (
    <>
      <View style={styles.buttonWrap}>
        {/* Soft pulse so the siren is easy to find, without being alarming. */}
        <PulseRing size={40} color="#ef4444" />
        <PressScale onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Emergency: inform HR" hitSlop={6} scaleTo={0.9} style={styles.button}>
          <Siren size={20} color="#ffffff" />
        </PressScale>
      </View>

      <BottomSheet
        open={open}
        onClose={close}
        title={sent ? 'HR has been informed' : 'Personal emergency'}
        description={sent ? undefined : 'Need to rush home or deal with something urgent? HR and your manager are notified right away.'}
      >
        {sent ? (
          <View style={styles.done}>
            <CheckCircle2 size={48} color={c.success} />
            <Text align="center" color="fg2">
              {`HR and your manager have been notified${sent.needToLeave ? ' that you need to leave' : ''}.${sent.contactPhone ? ` They'll reach you on ${sent.contactPhone} if needed.` : ''}`}
            </Text>
            <Text size="sm" color="muted" align="center">
              Take care. You’ll get a notification when HR responds.
            </Text>
            <Button onPress={close}>Close</Button>
          </View>
        ) : (
          <>
            <Text size="sm" weight="semibold">
              What happened?
            </Text>
            <View style={styles.grid}>
              {(Object.keys(CATEGORY_META) as EmergencyCategory[]).map((k) => {
                const selected = category === k;
                return (
                  <Pressable
                    key={k}
                    onPress={() => setCategory(k)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={CATEGORY_META[k].label}
                    style={[
                      styles.chip,
                      selected ? { borderColor: '#ef4444', backgroundColor: '#fef2f2', borderWidth: 2 } : { borderColor: c.line, backgroundColor: c.surface },
                    ]}
                  >
                    <Text size="xl">{CATEGORY_META[k].emoji}</Text>
                    <Text size="xs" weight="medium" style={selected ? { color: '#b91c1c' } : undefined}>
                      {CATEGORY_META[k].label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Checkbox label="I need to leave work now" checked={needToLeave} onChange={setNeedToLeave} />
            <TextField label="Details (optional)" value={message} onChangeText={setMessage} multiline placeholder="e.g. My father has been admitted to hospital" maxLength={1000} />
            <TextField label="Reach me on (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Leave blank to use your profile number" maxLength={30} />
            <Button variant="danger" icon={Siren} loading={raise.isPending} onPress={() => void submit()}>
              Inform HR
            </Button>
            <Button variant="ghost" onPress={close}>
              Cancel
            </Button>
          </>
        )}
      </BottomSheet>
    </>
  );
};

const styles = StyleSheet.create({
  buttonWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  button: { width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: '#dc2626' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  chip: { width: '31%', flexGrow: 1, alignItems: 'center', gap: space(1), paddingVertical: space(2.5), borderRadius: radius.md, borderWidth: 1 },
  done: { alignItems: 'center', gap: space(3), paddingVertical: space(2) },
});
