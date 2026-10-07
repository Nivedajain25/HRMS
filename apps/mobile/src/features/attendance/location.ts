import * as Location from 'expo-location';

export type LocationFailure = 'denied' | 'blocked' | 'disabled' | 'unavailable';
export type GeoResult = { latitude: number; longitude: number; accuracy?: number } | { error: LocationFailure };

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

const toResult = (pos: Location.LocationObject): GeoResult => ({
  latitude: Number(pos.coords.latitude.toFixed(6)),
  longitude: Number(pos.coords.longitude.toFixed(6)),
  ...(pos.coords.accuracy !== null && Number.isFinite(pos.coords.accuracy)
    ? { accuracy: Math.min(100_000, Math.round(pos.coords.accuracy)) }
    : {}),
});

/** Never rejects: a fix, or null on error / timeout. */
const tryFix = (accuracy: Location.Accuracy, ms: number) =>
  withTimeout(
    Location.getCurrentPositionAsync({ accuracy }).catch((err: unknown) => {
      console.warn('[location] fix failed', accuracy, err);
      return null;
    }),
    ms,
  );

/**
 * Best-effort device location (never rejects). Tries GPS first; indoors GPS often can't get a fix in time, so it
 * then takes the Wi-Fi / mobile-network position (fast indoors), and finally a recent last-known fix. The
 * accuracy is always reported, so a rough position is recorded as rough.
 * `blocked` = permission denied and the OS will not ask again (settings needed).
 */
export const getDeviceLocation = async (): Promise<GeoResult> => {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { error: perm.canAskAgain ? 'denied' : 'blocked' };
    if (!(await Location.hasServicesEnabledAsync())) return { error: 'disabled' };
    const gps = await tryFix(Location.Accuracy.Highest, 10_000);
    if (gps) return toResult(gps);
    const network = await tryFix(Location.Accuracy.Balanced, 8_000);
    if (network) return toResult(network);
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 1_000 }).catch(() => null);
    if (last) return toResult(last);
    console.warn('[location] no fix from GPS, network or last known position');
    return { error: 'unavailable' };
  } catch (err) {
    console.warn('[location] failed', err);
    return { error: 'unavailable' };
  }
};

/** How to fix a location failure, for error messages. */
export const locationHelp = (error: LocationFailure) => {
  switch (error) {
    case 'denied':
      return 'Location permission was not granted. Allow location access for Stencil HRMS and try again.';
    case 'blocked':
      return 'Location access is turned off for Stencil HRMS. Open Settings → Permissions → Location and choose “Allow while using the app”.';
    case 'disabled':
      return 'Location services are turned off. Turn on location (GPS) in your phone’s quick settings and try again.';
    case 'unavailable':
      return 'Your location could not be determined. Move to an open area or near a window and try again.';
  }
};

/** Failures that are fixed in the system settings. */
export const needsSettings = (error: LocationFailure) => error === 'blocked' || error === 'denied';
