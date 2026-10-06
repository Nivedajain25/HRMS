import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Camera, CheckCircle2, MapPin } from 'lucide-react-native';
import { BottomSheet, Button, Text, type IconComponent } from '@/components';
import { useAuth } from '@/lib/auth';
import { useOverlayStore } from '@/lib/overlays';
import { radius, space, useTheme } from '@/theme';

type Status = 'granted' | 'ask' | 'blocked';

const toStatus = (p: { granted: boolean; canAskAgain: boolean }): Status => (p.granted ? 'granted' : p.canAskAgain ? 'ask' : 'blocked');

const readStatuses = async () => {
  const [loc, cam] = await Promise.all([
    Location.getForegroundPermissionsAsync().catch(() => ({ granted: false, canAskAgain: true })),
    ImagePicker.getCameraPermissionsAsync().catch(() => ({ granted: false, canAskAgain: true })),
  ]);
  return { location: toStatus(loc), camera: toStatus(cam) };
};

// Asked once per app launch: signing out and back in (or reopening the app) asks again until both are allowed.
let shownThisLaunch = false;

const Row = ({ icon: Icon, title, text, status }: { icon: IconComponent; title: string; text: string; status: Status }) => {
  const { c } = useTheme();
  const ok = status === 'granted';
  return (
    <View style={[styles.row, { backgroundColor: c.surface2, borderColor: c.line }]}>
      <View style={[styles.icon, { backgroundColor: c.surface }]}>
        {ok ? <CheckCircle2 size={20} color={c.success} /> : <Icon size={20} color={c.primary} />}
      </View>
      <View style={styles.flex}>
        <Text size="sm" weight="semibold">
          {title}
        </Text>
        <Text size="xs" color="muted">
          {ok ? 'Allowed' : status === 'blocked' ? 'Turned off. Allow it in Settings.' : text}
        </Text>
      </View>
    </View>
  );
};

/**
 * Right after sign-in, employees are asked to allow location (recorded when clocking in / out) and the camera
 * (clock-in selfie), so the first clock-in doesn't stop for permission prompts. Skipped when both are allowed.
 */
export const PermissionsPrompt = () => {
  const { hasEmployee, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<{ location: Status; camera: Status }>({ location: 'ask', camera: 'ask' });
  const [busy, setBusy] = useState(false);
  const setPermissionsOpen = useOverlayStore((s) => s.setPermissionsOpen);
  const setSettled = useOverlayStore((s) => s.setPermissionsSettled);
  useEffect(() => setPermissionsOpen(open), [open, setPermissionsOpen]);

  useEffect(() => {
    if (!hasEmployee || shownThisLaunch) {
      setSettled(true);
      return;
    }
    let cancelled = false;
    void readStatuses().then((s) => {
      if (cancelled) return;
      setStatus(s);
      if (s.location !== 'granted' || s.camera !== 'granted') {
        shownThisLaunch = true;
        // A moment after the home screen appears, so it reads as a greeting rather than a blocker.
        setTimeout(() => {
          if (cancelled) return;
          setOpen(true);
          setSettled(true);
        }, 600);
      } else {
        setSettled(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hasEmployee, user?._id, setSettled]);

  const allow = async () => {
    setBusy(true);
    try {
      let loc = status.location;
      if (loc === 'ask') loc = toStatus(await Location.requestForegroundPermissionsAsync().catch(() => ({ granted: false, canAskAgain: false })));
      let cam = status.camera;
      if (cam === 'ask') cam = toStatus(await ImagePicker.requestCameraPermissionsAsync().catch(() => ({ granted: false, canAskAgain: false })));
      setStatus({ location: loc, camera: cam });
      if (loc === 'granted' && cam === 'granted') setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const blocked = status.location === 'blocked' || status.camera === 'blocked';
  const allDone = status.location === 'granted' && status.camera === 'granted';

  return (
    <BottomSheet
      open={open}
      onClose={() => setOpen(false)}
      title="Set up attendance"
      description="Allow these once so clocking in is quick. Your location is only recorded when you clock in or out."
    >
      <Row icon={MapPin} title="Track my location" text="Records where you clock in and out (office or outside)." status={status.location} />
      <Row icon={Camera} title="Selfie camera" text="Takes a quick selfie when you clock in or out." status={status.camera} />
      {allDone ? (
        <Button onPress={() => setOpen(false)}>Done</Button>
      ) : blocked && status.location !== 'ask' && status.camera !== 'ask' ? (
        <Button onPress={() => void Linking.openSettings()}>Open settings</Button>
      ) : (
        <Button loading={busy} onPress={() => void allow()}>
          Allow location & camera
        </Button>
      )}
      <Button variant="ghost" onPress={() => setOpen(false)}>
        Not now
      </Button>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(3), borderRadius: radius.md, borderWidth: 1 },
  icon: { width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});
