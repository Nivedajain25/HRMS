import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components';
import { toApiError, type ApiError } from '@/lib/api';
import { attendanceKeys, fetchToday, uploadSelfie, useClockAction, type WorkMode } from './api';
import { getDeviceLocation, locationHelp, needsSettings } from './location';
import { SelfieCapture } from './selfie-capture';

export type ClockStep = 'locating' | 'selfie' | 'uploading' | 'saving';

/** Development-only progress log (shows in the Expo dev server's output when testing on a phone; silent in builds). */
const trace = (...args: unknown[]) => {
  // eslint-disable-next-line no-console
  if (__DEV__) console.log('[clock]', ...args);
};
type FlowAction = 'check-in' | 'check-out';

const STEP_LABEL: Record<ClockStep, (a: FlowAction) => string> = {
  locating: () => 'Getting your location…',
  selfie: () => 'Waiting for your selfie…',
  uploading: () => 'Uploading photo…',
  saving: (a) => (a === 'check-in' ? 'Checking in…' : 'Checking out…'),
};

export interface ClockNotice {
  tone: 'warning' | 'danger';
  title: string;
  message?: string;
  /** Offer an "Open settings" action (location/camera permission). */
  settings?: boolean;
}

/** Maps clock-in/out API errors to actionable messages (same copy as the web). */
const friendlyError = (e: ApiError, verb: string): ClockNotice => {
  switch (e.code) {
    case 'SELFIE_REQUIRED':
      return {
        tone: 'danger',
        title: `A selfie is required to ${verb}.`,
        message: 'Please try again and take a photo when the camera opens.',
      };
    case 'LOCATION_REQUIRED':
      return { tone: 'danger', title: `Your location is required to ${verb}.`, message: locationHelp('blocked'), settings: true };
    case 'INVALID_SELFIE':
      return {
        tone: 'danger',
        title: 'That selfie can no longer be used.',
        message: 'It expired or was already used. Please try again and take a new photo.',
      };
    case 'OUTSIDE_GEOFENCE':
      return {
        tone: 'danger',
        title: 'You are outside your office’s check-in area.',
        message: 'Move closer to the office, or choose Remote if you are working from elsewhere today.',
      };
    case 'REMOTE_CLOCK_IN_DISABLED':
      return {
        tone: 'danger',
        title: 'Remote check-in is disabled.',
        message: 'Check in from the office, or ask HR to enable remote check-in.',
      };
    default:
      return { tone: 'danger', title: e.message };
  }
};

/**
 * Self-service clock in/out flow shared by the Attendance clock card and the
 * Home card: GPS (required or best-effort) → selfie (when required) → upload →
 * check-in/out. Render `selfieModal` in the consumer.
 */
export const useClockFlow = () => {
  const qc = useQueryClient();
  const mutation = useClockAction();
  const [active, setActive] = useState<FlowAction | null>(null);
  const [step, setStep] = useState<ClockStep | null>(null);
  const [notice, setNotice] = useState<ClockNotice | null>(null);
  const [selfie, setSelfie] = useState<{ title: string } | null>(null);
  const resolver = useRef<((uri: string | null) => void) | null>(null);

  const requestSelfie = (title: string) =>
    new Promise<string | null>((resolve) => {
      resolver.current = resolve;
      setSelfie({ title });
    });

  const finishSelfie = useCallback((uri: string | null) => {
    resolver.current?.(uri);
    resolver.current = null;
    setSelfie(null);
  }, []);

  const run = async (action: FlowAction, opts: { workMode?: WorkMode; success: string }): Promise<boolean> => {
    if (active) return false;
    const verb = action === 'check-in' ? 'check in' : 'check out';
    setActive(action);
    setNotice(null);
    try {
      const today = await qc.fetchQuery({ queryKey: attendanceKeys.today, queryFn: fetchToday, staleTime: 30_000 });
      const body: Record<string, unknown> = action === 'check-in' ? { workMode: opts.workMode ?? 'OFFICE' } : {};
      let recordedWithoutLocation: ClockNotice | null = null;

      setStep('locating');
      const loc = await getDeviceLocation();
      trace(action, 'location:', 'error' in loc ? `failed (${loc.error})` : `ok ±${loc.accuracy ?? '?'} m`);
      if ('error' in loc) {
        // Mandatory at clock-in only; clock-out without a location is still recorded.
        if (today.requireLocation && action === 'check-in') {
          setNotice({
            tone: 'danger',
            title: `Your location is required to ${verb}.`,
            message: locationHelp(loc.error),
            settings: needsSettings(loc.error),
          });
          return false;
        }
        recordedWithoutLocation = {
          tone: 'warning',
          title: `Recorded without location`,
          message: `Location ${loc.error === 'unavailable' ? 'was unavailable' : 'is off'}, so your ${action === 'check-in' ? 'check-in' : 'check-out'} was saved without it.`,
          settings: needsSettings(loc.error),
        };
      } else {
        Object.assign(body, loc);
      }

      // Selfie at clock-in only.
      if (today.requireSelfie && action === 'check-in') {
        setStep('selfie');
        const uri = await requestSelfie('Selfie to check in');
        trace('selfie:', uri ? 'taken' : 'cancelled');
        if (!uri) {
          toast.info(`A selfie is required to ${verb}.`);
          return false;
        }
        setStep('uploading');
        try {
          body.photoId = await uploadSelfie(uri);
          trace('selfie uploaded');
        } catch (err) {
          console.warn('[clock] selfie upload failed', toApiError(err).status, toApiError(err).message);
          setNotice({ tone: 'danger', title: 'Could not upload your photo.', message: toApiError(err).message });
          return false;
        }
      }

      setStep('saving');
      await mutation.mutateAsync({ action, body });
      setNotice(recordedWithoutLocation);
      toast.success(opts.success);
      return true;
    } catch (err) {
      const e = toApiError(err);
      console.warn('[clock]', action, 'failed', e.status, e.code, e.message);
      if (e.status === 401) return false;
      // Settings or state may have changed since they were loaded.
      void qc.invalidateQueries({ queryKey: attendanceKeys.today });
      setNotice(friendlyError(e, verb));
      return false;
    } finally {
      setStep(null);
      setActive(null);
    }
  };

  const selfieModal = (
    <SelfieCapture
      open={!!selfie}
      title={selfie?.title ?? 'Selfie'}
      onCancel={() => finishSelfie(null)}
      onCapture={(uri) => finishSelfie(uri)}
    />
  );

  return {
    run,
    /** Action in progress (for button loading states). */
    active,
    busy: !!active,
    step,
    /** Human-readable progress for a live region. */
    status: step && active ? STEP_LABEL[step](active) : null,
    notice,
    dismissNotice: () => setNotice(null),
    selfieModal,
  };
};
