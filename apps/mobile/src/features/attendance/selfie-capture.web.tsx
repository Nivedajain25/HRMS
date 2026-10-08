import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Camera, Check, RotateCcw, X } from 'lucide-react-native';
import { Button, Text } from '@/components';
import { space } from '@/theme';

/**
 * Browser version of the clock-in selfie (Metro picks this file on web; phones use selfie-capture.tsx).
 *
 * expo-camera's web camera asks for `facingMode: { exact: 'user' }`, which most laptop webcams can't satisfy
 * (they don't report a facing mode), so the browser refuses and the camera never opens. Here the front camera is
 * only preferred — any webcam works — and every failure (blocked, no camera, camera busy) is explained.
 */

const MAX_WIDTH = 720;

export interface SelfieCaptureProps {
  open: boolean;
  title: string;
  onCancel: () => void;
  onCapture: (uri: string) => void;
}

type CameraState = { kind: 'starting' } | { kind: 'live' } | { kind: 'error'; title: string; text: string };

const explain = (err: unknown): Extract<CameraState, { kind: 'error' }> => {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      kind: 'error',
      title: 'Camera access is blocked',
      text: 'Allow the camera for this site (click the camera or lock icon in the address bar), then try again.',
    };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return { kind: 'error', title: 'No camera found', text: 'Connect a webcam, or check in from the mobile app on your phone.' };
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return { kind: 'error', title: 'The camera is busy', text: 'Another app may be using it (e.g. Teams, Zoom or another browser tab). Close it and try again.' };
  }
  return { kind: 'error', title: "Couldn't start the camera", text: 'Please try again.' };
};

/** Front camera if there is one, otherwise any camera (a laptop webcam has no "front"). */
const openCamera = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    const err = new Error('getUserMedia unavailable');
    err.name = 'NotFoundError';
    throw err;
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
  } catch (err) {
    if ((err as { name?: string })?.name !== 'OverconstrainedError') throw err;
    return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
};

/** Full-screen selfie with retake / use; the photo matches the mirrored preview (≤ 720 px JPEG). */
export const SelfieCapture = ({ open, title, onCancel, onCapture }: SelfieCaptureProps) => {
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>({ kind: 'starting' });
  const [photo, setPhoto] = useState<string | null>(null);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const start = useCallback(async () => {
    stop();
    setState({ kind: 'starting' });
    try {
      const s = await openCamera();
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      setState({ kind: 'live' });
    } catch (err) {
      setState(explain(err));
    }
  }, [stop]);

  useEffect(() => {
    if (!open) return;
    setPhoto(null);
    void start();
    return stop;
  }, [open, start, stop]);

  // The <video> mounts after the stream may already be open: attach it when it appears.
  const attach = useCallback((el: HTMLVideoElement | null) => {
    video.current = el;
    if (el && stream.current && el.srcObject !== stream.current) {
      el.srcObject = stream.current;
      void el.play().catch(() => undefined);
    }
  }, []);

  const take = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, MAX_WIDTH / v.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    const g = canvas.getContext('2d');
    if (!g) return;
    // Mirror like the preview, so the photo looks the way the person saw themselves.
    g.translate(canvas.width, 0);
    g.scale(-1, 1);
    g.drawImage(v, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL('image/jpeg', 0.7));
  };

  const close = () => {
    stop();
    onCancel();
  };

  return (
    <Modal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      <View style={styles.root}>
        <View style={styles.top}>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={8} style={styles.close}>
            <X size={26} color="#ffffff" />
          </Pressable>
          <Text size="lg" weight="semibold" style={styles.white} accessibilityRole="header">
            {title}
          </Text>
          <View style={styles.close} />
        </View>

        <View style={styles.stage}>
          {state.kind === 'error' ? (
            <View style={styles.message}>
              <Camera size={40} color="#ffffff" />
              <Text weight="semibold" align="center" style={styles.white}>
                {state.title}
              </Text>
              <Text size="sm" align="center" style={styles.dim}>
                {state.text}
              </Text>
              <Button onPress={() => void start()}>Try again</Button>
            </View>
          ) : photo ? (
            <Image source={{ uri: photo }} style={styles.preview} resizeMode="cover" accessibilityLabel="Your selfie" />
          ) : (
            <View style={styles.preview}>
              <video
                ref={attach}
                autoPlay
                playsInline
                muted
                aria-label="Camera preview"
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: 'block' }}
              />
              {state.kind === 'starting' ? (
                <View style={[StyleSheet.absoluteFill, styles.center]}>
                  <ActivityIndicator color="#ffffff" />
                </View>
              ) : null}
              <View pointerEvents="none" style={styles.guide} />
            </View>
          )}
        </View>

        {state.kind === 'error' ? null : photo ? (
          <View style={styles.actions}>
            <Button variant="outline" icon={RotateCcw} onPress={() => setPhoto(null)} style={styles.flex}>
              Retake
            </Button>
            <Button
              icon={Check}
              onPress={() => {
                stop();
                onCapture(photo);
              }}
              style={styles.flex}
            >
              Use photo
            </Button>
          </View>
        ) : (
          <View style={styles.shutterRow}>
            <Text size="sm" align="center" style={styles.dim}>
              Position your face inside the frame
            </Text>
            <Pressable
              onPress={take}
              disabled={state.kind !== 'live'}
              accessibilityRole="button"
              accessibilityLabel="Take selfie"
              accessibilityState={{ disabled: state.kind !== 'live' }}
              style={({ pressed }) => [styles.shutter, pressed && styles.shutterPressed, state.kind !== 'live' && styles.shutterDisabled]}
            >
              <View style={styles.shutterInner} />
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000', paddingBottom: space(4) },
  flex: { flex: 1 },
  white: { color: '#ffffff' },
  dim: { color: 'rgba(255,255,255,0.75)' },
  center: { alignItems: 'center', justifyContent: 'center' },
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
  message: { alignItems: 'center', gap: space(3), paddingHorizontal: space(6), maxWidth: 420 },
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
