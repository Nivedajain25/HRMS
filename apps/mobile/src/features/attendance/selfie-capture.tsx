import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { FlipType, ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Camera, Check, RotateCcw, X } from 'lucide-react-native';
import { Button, Text, toast } from '@/components';
import { space } from '@/theme';

const MAX_WIDTH = 720;

/** Downscales to ≤ 720 px wide JPEG (keeps uploads small on slow networks); `flip`: mirrored left↔right. */
const compress = async (uri: string, width: number, flip: boolean) => {
  try {
    const ctx = ImageManipulator.manipulate(uri);
    if (flip) ctx.flip(FlipType.Horizontal);
    if (width > MAX_WIDTH) ctx.resize({ width: MAX_WIDTH });
    const image = await ctx.renderAsync();
    const saved = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    return saved.uri;
  } catch {
    return uri;
  }
};

export interface SelfieCaptureProps {
  open: boolean;
  title: string;
  onCancel: () => void;
  onCapture: (uri: string) => void;
}

/** Full-screen front-camera capture with retake / use. */
export const SelfieCapture = ({ open, title, onCancel, onCapture }: SelfieCaptureProps) => {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const asked = useRef(false);

  useEffect(() => {
    if (!open) return;
    setPhoto(null);
    setReady(false);
    setBusy(false);
    asked.current = false;
  }, [open]);

  // Ask for camera access once per opening.
  useEffect(() => {
    if (open && permission && !permission.granted && permission.canAskAgain && !asked.current) {
      asked.current = true;
      void requestPermission();
    }
  }, [open, permission, requestPermission]);

  const take = async () => {
    if (!camera.current || busy) return;
    setBusy(true);
    try {
      // The phone shows the live front camera mirrored; flip the photo the same way so it matches the preview.
      const pic = await camera.current.takePictureAsync({ quality: 0.6, shutterSound: false });
      if (!pic?.uri) throw new Error('No photo');
      setPhoto(await compress(pic.uri, pic.width, true));
    } catch (err) {
      console.warn('[selfie] capture failed', err);
      toast.error('Could not take the photo.', 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const granted = !!permission?.granted;

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onCancel}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + space(4) }]}>
        <View style={styles.top}>
          <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={8} style={styles.close}>
            <X size={26} color="#ffffff" />
          </Pressable>
          <Text size="lg" weight="semibold" style={styles.white} accessibilityRole="header">
            {title}
          </Text>
          <View style={styles.close} />
        </View>

        <View style={styles.stage}>
          {!permission ? (
            <ActivityIndicator color="#ffffff" />
          ) : !granted ? (
            <View style={styles.permission}>
              <Camera size={40} color="#ffffff" />
              <Text weight="semibold" align="center" style={styles.white}>
                Camera access is needed
              </Text>
              <Text size="sm" align="center" style={styles.dim}>
                Your organization requires a selfie when you clock in or out.
              </Text>
              {permission.canAskAgain ? (
                <Button onPress={() => void requestPermission()}>Allow camera</Button>
              ) : (
                <Button onPress={() => void Linking.openSettings()}>Open settings</Button>
              )}
            </View>
          ) : photo ? (
            // Exactly what is uploaded — the same as the live view.
            <Image source={{ uri: photo }} style={styles.preview} resizeMode="cover" accessibilityLabel="Your selfie" />
          ) : (
            <View style={styles.preview}>
              <View style={StyleSheet.absoluteFill}>
                <CameraView
                  ref={camera}
                  mirror={false}
                  style={StyleSheet.absoluteFill}
                  facing="front"
                  animateShutter={false}
                  onCameraReady={() => setReady(true)}
                  onMountError={(e) => {
                    // Otherwise a camera that fails to start just leaves a dark frame and a dead shutter.
                    console.warn('[selfie] camera failed to start', e.message);
                    toast.error('The camera could not start.', e.message || 'Close other apps using the camera and try again.');
                  }}
                />
              </View>
              <View pointerEvents="none" style={styles.guide} />
            </View>
          )}
        </View>

        {granted ? (
          photo ? (
            <View style={styles.actions}>
              <Button variant="outline" icon={RotateCcw} onPress={() => setPhoto(null)} style={styles.flex}>
                Retake
              </Button>
              <Button icon={Check} onPress={() => onCapture(photo)} style={styles.flex}>
                Use photo
              </Button>
            </View>
          ) : (
            <View style={styles.shutterRow}>
              <Text size="sm" align="center" style={styles.dim}>
                Position your face inside the frame
              </Text>
              <Pressable
                onPress={() => void take()}
                disabled={!ready || busy}
                accessibilityRole="button"
                accessibilityLabel="Take selfie"
                accessibilityState={{ disabled: !ready || busy, busy }}
                style={({ pressed }) => [styles.shutter, (pressed || busy) && styles.shutterPressed, !ready && styles.shutterDisabled]}
              >
                {busy ? <ActivityIndicator color="#111827" /> : <View style={styles.shutterInner} />}
              </Pressable>
            </View>
          )
        ) : null}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  flex: { flex: 1 },
  white: { color: '#ffffff' },
  dim: { color: 'rgba(255,255,255,0.75)' },
  top: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space(2) },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space(4) },
  preview: { width: '100%', aspectRatio: 3 / 4, maxHeight: '100%', borderRadius: 24, overflow: 'hidden', backgroundColor: '#111827' },
  guide: {
    position: 'absolute',
    top: '12%',
    left: '18%',
    right: '18%',
    bottom: '18%',
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
    borderStyle: 'dashed',
  },
  permission: { alignItems: 'center', gap: space(3), paddingHorizontal: space(6) },
  actions: { flexDirection: 'row', gap: space(3), paddingHorizontal: space(4), paddingTop: space(4) },
  shutterRow: { alignItems: 'center', gap: space(3), paddingTop: space(3) },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#ffffff', borderWidth: 2, borderColor: '#111827' },
  shutterPressed: { transform: [{ scale: 0.94 }] },
  shutterDisabled: { opacity: 0.5 },
});
