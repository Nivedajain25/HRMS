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

/**
 * Best-effort device location with high accuracy (never rejects).
 * `blocked` = permission denied and the OS will not ask again (settings needed).
 */
export const getDeviceLocation = async (timeoutMs = 15_000): Promise<GeoResult> => {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { error: perm.canAskAgain ? 'denied' : 'blocked' };
    if (!(await Location.hasServicesEnabledAsync())) return { error: 'disabled' };
    // Highest accuracy (GPS) for the exact spot; only if that times out, a very recent (≤ 1 min, ≤ 100 m) last fix.
    const fresh = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }), timeoutMs);
    if (fresh) return toResult(fresh);
    const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 100 });
    return last ? toResult(last) : { error: 'unavailable' };
  } catch {
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
