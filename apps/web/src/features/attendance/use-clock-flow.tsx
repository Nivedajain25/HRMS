import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { get, toApiError, type ApiError } from '@/lib/api';
import { attendanceKeys, uploadSelfie, useClockAction, type GeoPoint, type TodayState, type WorkMode } from './api';
import { SelfieCapture } from './components/selfie-capture';
import { getBrowserLocation, locationHelp } from './lib';

export type ClockStep = 'locating' | 'selfie' | 'uploading' | 'saving';
type FlowAction = 'check-in' | 'check-out';

const STEP_LABEL: Record<ClockStep, (a: FlowAction) => string> = {
  locating: () => 'Getting your location…',
  selfie: () => 'Waiting for your selfie…',
  uploading: () => 'Uploading photo…',
  saving: (a) => (a === 'check-in' ? 'Clocking in…' : 'Clocking out…'),
};

/** Maps clock-in/out API errors to actionable messages. */
const friendlyError = (e: ApiError, verb: string): { title: string; description?: string } => {
  switch (e.code) {
    case 'SELFIE_REQUIRED':
      return { title: `A selfie is required to ${verb}.`, description: 'Please try again and take a photo when the camera opens.' };
    case 'LOCATION_REQUIRED':
      return { title: `Your location is required to ${verb}.`, description: locationHelp('denied') };
    case 'INVALID_SELFIE':
      return { title: 'That selfie can no longer be used.', description: 'It expired or was already used. Please try again and take a new photo.' };
    case 'REMOTE_CLOCK_IN_DISABLED':
      return { title: 'Remote clock-in is disabled.', description: 'Clock in from the office, or ask HR to enable remote clock-in.' };
    default:
      return { title: e.message };
  }
};

/** Tells the employee where their clock-in/out was recorded relative to the office (HR sees the same). */
const placeNote = (p?: GeoPoint | null) => {
  if (typeof p?.latitude !== 'number') return undefined;
  const where = p.officeName ? `your office (${p.officeName})` : 'your office';
  const far = typeof p.distanceMeters === 'number' ? (p.distanceMeters < 1000 ? `${p.distanceMeters} m` : `${(p.distanceMeters / 1000).toFixed(1)} km`) : null;
  if (p.withinOffice === true) return `Location recorded at ${where}.`;
  if (p.withinOffice === false) return `Location recorded ${far ? `${far} ` : ''}outside ${where}. HR can see this.`;
  return 'Location recorded.';
};

/**
 * Self-service clock in/out flow shared by the attendance clock widget and the
 * dashboard card: optional/required GPS → selfie (when required) → upload →
 * check-in/out. Render `selfieDialog` somewhere in the consumer.
 */
export const useClockFlow = () => {
  const qc = useQueryClient();
  const mutation = useClockAction(true);
  const [active, setActive] = useState<FlowAction | null>(null);
  const [step, setStep] = useState<ClockStep | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<{ title: string; resolve: (photo: Blob | null) => void } | null>(null);

  const requestSelfie = (title: string) => new Promise<Blob | null>((resolve) => setSelfie({ title, resolve }));

  const run = async (action: FlowAction, opts: { workMode?: WorkMode; success: string }): Promise<boolean> => {
    if (active) return false;
    const verb = action === 'check-in' ? 'clock in' : 'clock out';
    setActive(action);
    setNotice(null);
    try {
      const today = await qc.fetchQuery({ queryKey: attendanceKeys.today, queryFn: () => get<TodayState>('/attendance/today'), staleTime: 30_000 });
      const body: Record<string, unknown> = action === 'check-in' ? { workMode: opts.workMode ?? 'OFFICE' } : {};
      let note: string | null = null;

      setStep('locating');
      const loc = await getBrowserLocation();
      if ('error' in loc) {
        // Mandatory at clock-in only; clock-out without a location is still recorded.
        if (today.requireLocation && action === 'check-in') {
          const help = locationHelp(loc.error);
          setNotice(help);
          toast.error(`Your location is required to ${verb}.`, { description: help });
          return false;
        }
        note = `Location ${loc.error === 'denied' ? 'permission is blocked' : 'was unavailable'}, so your ${verb === 'clock in' ? 'clock-in' : 'clock-out'} was recorded without a location.`;
      } else {
        Object.assign(body, loc);
      }

      // Selfie at clock-in only.
      if (today.requireSelfie && action === 'check-in') {
        setStep('selfie');
        const photo = await requestSelfie('Selfie to clock in');
        if (!photo) {
          toast.info(`A selfie is required to ${verb}.`);
          return false;
        }
        setStep('uploading');
        try {
          body.photoId = await uploadSelfie(photo);
        } catch (err) {
          toast.error('Could not upload your photo.', { description: toApiError(err).message });
          return false;
        }
      }

      setStep('saving');
      const res = await mutation.mutateAsync({ action, body });
      setNotice(note);
      toast.success(opts.success, { description: placeNote(action === 'check-in' ? res.data.record?.checkInLocation : res.data.record?.checkOutLocation) });
      return true;
    } catch (err) {
      const e = toApiError(err);
      if (e.status === 401) return false;
      // Settings may have changed since they were loaded.
      if (e.code === 'SELFIE_REQUIRED' || e.code === 'LOCATION_REQUIRED') void qc.invalidateQueries({ queryKey: attendanceKeys.today });
      const msg = friendlyError(e, verb);
      toast.error(msg.title, msg.description ? { description: msg.description } : undefined);
      return false;
    } finally {
      setStep(null);
      setActive(null);
    }
  };

  const closeSelfie = useCallback(() => {
    setSelfie((s) => {
      s?.resolve(null);
      return null;
    });
  }, []);

  const selfieDialog = (
    <SelfieCapture
      open={!!selfie}
      title={selfie?.title}
      onClose={closeSelfie}
      onCapture={(photo) => {
        selfie?.resolve(photo);
        setSelfie(null);
      }}
    />
  );

  return {
    run,
    /** Action in progress (for button loading states). */
    active,
    busy: !!active,
    step,
    /** Human-readable progress for an `aria-live` region. */
    status: step && active ? STEP_LABEL[step](active) : null,
    /** Non-blocking notice from the last attempt (e.g. recorded without location). */
    notice,
    selfieDialog,
  };
};
