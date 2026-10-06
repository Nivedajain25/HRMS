import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * Street address for a GPS point via OpenStreetMap Nominatim (free; ~1 request/second, a real User-Agent is
 * required by its usage policy). Best-effort: returns null on any failure or after 4 s, never throws, so a slow
 * lookup can't block a clock-in. Turn off with REVERSE_GEOCODING=off.
 */
export const reverseGeocode = async (latitude: number, longitude: number): Promise<string | null> => {
  if (env.REVERSE_GEOCODING === 'off') return null;
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${latitude}&lon=${longitude}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Stencil-HRMS/1.0 (attendance clock-in address)' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      display_name?: string;
      address?: Record<string, string | undefined>;
    };
    const a = body.address ?? {};
    // "12, 5th Cross Road, Rajajinagar, Bengaluru 560010" — short and readable, most specific first.
    const parts = [
      [a.house_number, a.road].filter(Boolean).join(', '),
      a.neighbourhood ?? a.suburb ?? a.quarter,
      a.city ?? a.town ?? a.village ?? a.county,
      a.postcode,
    ].filter((p): p is string => !!p && p.trim().length > 0);
    const short = parts.length >= 2 ? parts.join(', ') : body.display_name;
    return short ? short.slice(0, 300) : null;
  } catch (err) {
    logger.debug({ err }, 'reverse geocoding failed');
    return null;
  }
};
