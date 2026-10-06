import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Camera, CameraOff, ImageUp, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/overlay';
import { cn } from '@/lib/utils';

/** Longest side of the exported selfie, in pixels. */
const MAX_SIDE = 720;
const JPEG_QUALITY = 0.8;

type Mode = 'starting' | 'live' | 'fallback';

interface SelfieCaptureProps {
  open: boolean;
  /** Called when the dialog is dismissed without a photo. */
  onClose: () => void;
  /** Called with the JPEG selfie when the user confirms it. */
  onCapture: (photo: Blob) => void;
  title?: string;
}

const cameraErrorMessage = (err: unknown) => {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return 'Camera access was blocked. Allow the camera for this site in your browser settings (site settings → Camera) and try again, or take a photo below.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
    return 'No camera was found on this device. You can take or choose a photo instead.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The camera is being used by another app. Close it and try again, or take a photo below.';
  }
  return 'The camera could not be started. You can take or choose a photo instead.';
};

const scaledSize = (w: number, h: number) => {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
};

const canvasToJpeg = (canvas: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY));

/** Draws an image source onto a canvas no larger than MAX_SIDE and exports a JPEG (`flip`: mirrored left↔right). */
const toJpeg = async (source: CanvasImageSource, w: number, h: number, flip = false) => {
  const { width, height } = scaledSize(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (flip) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, width, height);
  return canvasToJpeg(canvas);
};

/** Downscales a picked file to a JPEG; falls back to the original when the browser cannot decode it. */
const fileToJpeg = async (file: File): Promise<Blob> => {
  try {
    const bitmap = await createImageBitmap(file);
    const blob = await toJpeg(bitmap, bitmap.width, bitmap.height);
    bitmap.close();
    if (blob) return blob;
  } catch {
    /* fall through */
  }
  return file;
};

/**
 * Front-camera selfie capture (live preview → capture → retake / use). The live view and the saved photo are both
 * flipped left↔right, so the photo looks exactly like the preview.
 * Falls back to a native file picker (`capture="user"`) when the camera API is
 * unavailable or permission is denied. The camera is released on close.
 */
export const SelfieCapture = ({ open, onClose, onCapture, title = 'Take a selfie' }: SelfieCaptureProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [mode, setMode] = useState<Mode>('starting');
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Start the camera when opened; always release it on close/unmount.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhoto(null);
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMode('fallback');
      setError('Your browser does not support the camera here. Take or choose a photo instead.');
      return;
    }
    setMode('starting');
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setMode('live');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMode('fallback');
        setError(cameraErrorMessage(err));
      });
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, stopCamera]);

  // Attach the stream once the <video> element is rendered.
  useEffect(() => {
    const video = videoRef.current;
    if (mode !== 'live' || !video || !streamRef.current) return;
    if (video.srcObject !== streamRef.current) video.srcObject = streamRef.current;
    void video.play().catch(() => undefined);
  }, [mode, previewUrl]);

  // Object URL for the captured preview.
  useEffect(() => {
    if (!photo) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setBusy(true);
    try {
      // Flipped left↔right, matching the live view.
      const blob = await toJpeg(video, video.videoWidth, video.videoHeight, true);
      if (blob) setPhoto(blob);
      else setError('Could not capture the photo. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image (JPEG, PNG or WebP).');
      return;
    }
    setBusy(true);
    try {
      setPhoto(await fileToJpeg(file));
    } finally {
      setBusy(false);
    }
  };

  // Stable so the dialog's focus management does not re-run on every render.
  const close = useCallback(() => {
    stopCamera();
    onClose();
  }, [stopCamera, onClose]);

  const confirm = () => {
    if (!photo) return;
    stopCamera();
    onCapture(photo);
  };

  const retake = () => {
    setPhoto(null);
    if (mode === 'fallback') fileRef.current?.click();
  };

  const footer = photo ? (
    <>
      <Button variant="outline" icon={<RotateCcw className="h-4 w-4" />} onClick={retake} className="w-full sm:w-auto">
        Retake
      </Button>
      <Button onClick={confirm} data-autofocus className="w-full sm:w-auto">
        Use photo
      </Button>
    </>
  ) : (
    <Button variant="outline" onClick={close} className="w-full sm:w-auto">
      Cancel
    </Button>
  );

  return (
    <Modal open={open} onClose={close} title={title} description="Your photo is only visible to you, your managers and HR." footer={footer}>
      <div className="space-y-3">
        <div className="relative mx-auto aspect-[3/4] w-full max-w-sm overflow-hidden rounded-2xl bg-slate-900 sm:aspect-[4/3]">
          {previewUrl ? (
            <img src={previewUrl} alt="Captured selfie preview" className="h-full w-full object-cover" />
          ) : mode === 'live' ? (
            <video ref={videoRef} autoPlay playsInline muted aria-label="Live camera preview" className="h-full w-full -scale-x-100 object-cover" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-200">
              {mode === 'starting' ? (
                <>
                  <Camera className="h-8 w-8 animate-pulse" aria-hidden />
                  <span role="status">Starting camera… Allow camera access if your browser asks.</span>
                </>
              ) : (
                <>
                  <CameraOff className="h-8 w-8" aria-hidden />
                  <span>Camera unavailable</span>
                </>
              )}
            </div>
          )}
          {mode === 'live' && !photo && (
            <div className="absolute inset-x-0 bottom-4 flex justify-center">
              <button
                type="button"
                onClick={capture}
                disabled={busy}
                aria-label="Capture photo"
                className={cn(
                  'h-16 w-16 rounded-full border-4 border-white bg-white/30 shadow-lg ring-2 ring-black/20 backdrop-blur transition',
                  'hover:bg-white/50 focus-visible:ring-4 focus-visible:ring-brand-400 focus-visible:outline-none active:scale-95 disabled:opacity-60',
                )}
              />
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
            {error}
          </p>
        )}

        {mode === 'live' && !photo && (
          <p className="text-center text-xs text-muted">Center your face in the frame, then press the round button.</p>
        )}

        {mode === 'fallback' && (
          <input ref={fileRef} type="file" accept="image/*" capture="user" aria-label="Take or choose a photo" tabIndex={-1} className="sr-only" onChange={onPick} />
        )}
        {mode === 'fallback' && !photo && (
          <div className="flex justify-center">
            <Button icon={<ImageUp className="h-4 w-4" />} loading={busy} onClick={() => fileRef.current?.click()} className="w-full sm:w-auto">
              Take or choose a photo
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
};
