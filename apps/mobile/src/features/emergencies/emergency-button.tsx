import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { G, Path, Rect } from 'react-native-svg';
import { CheckCircle2, Siren } from 'lucide-react-native';
import { BottomSheet, Button, Checkbox, Text, TextField, toast } from '@/components';
import { toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { radius, space, useTheme } from '@/theme';
import { CATEGORY_META, useRaiseEmergency, type Emergency, type EmergencyCategory } from './api';

/** Flat emergency siren (same drawing as the web button): red dome with a shine on a dark base, orange rays. */
const SirenIcon = ({ size, dark }: { size: number; dark: boolean }) => (
  <Svg width={size} height={size} viewBox="0 0 100 100">
    <G stroke="#f6a723" strokeWidth={5.5} strokeLinecap="round">
      <Path d="M50 18.5v7.5M26.5 25.8l4.5 5M73.5 25.8l-4.5 5M15.8 42.4l7.2 2M84.2 42.4l-7.2 2M16 65.4l6.8-2M84 65.4l-6.8-2" />
    </G>
    <Path d="M28.6 74V53c0-12 9.6-21.4 21.4-21.4S71.4 41 71.4 53v21Z" fill="#ef3339" />
    <Path d="M42.6 55.2c0-1.6 1.2-2.7 2.7-2.7h9.4c1.5 0 2.7 1.1 2.7 2.7s-1.2 2.7-2.7 2.7h-2.4V74h-4.8V57.9h-2.2c-1.5 0-2.7-1.2-2.7-2.7Z" fill="#d42f36" />
    <Path d="M33.5 52c0-7.5 5.5-13.4 12.8-14.5" fill="none" stroke="#fbdde0" strokeWidth={5} strokeLinecap="round" />
    <Path d="M33.5 60v2.6" stroke="#fbdde0" strokeWidth={5} strokeLinecap="round" />
    <Rect x={23.6} y={73} width={52.8} height={8.8} rx={2.2} fill={dark ? '#64748b' : '#37474f'} />
  </Svg>
);

/**
 * Siren button (home header): a personal emergency, e.g. having to rush home. HR and the reporting manager
 * are notified immediately. Same button, flow and icon as the web "Emergency" button.
 */
export const EmergencyButton = () => {
  const { c, scheme } = useTheme();
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
      {/* Same as the web header button: the siren with EMERGENCY under it in a rounded square (red tint when pressed). */}
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Emergency: inform HR"
        hitSlop={4}
        style={({ pressed }) => [styles.button, pressed && { backgroundColor: scheme === 'dark' ? 'rgba(239,68,68,0.1)' : '#fef2f2' }]}
      >
        {({ pressed }) => (
          <>
            <View style={pressed ? styles.grow : undefined}>
              <SirenIcon size={34} dark={scheme === 'dark'} />
            </View>
            <Text weight="bold" style={[styles.label, { color: scheme === 'dark' ? '#f87171' : '#dc2626' }]} numberOfLines={1}>
              EMERGENCY
            </Text>
          </>
        )}
      </Pressable>

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
                const CategoryIcon = CATEGORY_META[k].icon;
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
                    <CategoryIcon size={24} color={selected ? '#dc2626' : c.fg2} />
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
  // Rounded square like the web's (rounded-xl, 56 tall); just wide enough for EMERGENCY to leave the greeting room.
  button: { width: 52, height: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', gap: 2 },
  grow: { transform: [{ scale: 1.1 }] },
  label: { fontSize: 8, lineHeight: 9 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  chip: { width: '31%', flexGrow: 1, alignItems: 'center', gap: space(1), paddingVertical: space(2.5), borderRadius: radius.md, borderWidth: 1 },
  done: { alignItems: 'center', gap: space(3), paddingVertical: space(2) },
});
