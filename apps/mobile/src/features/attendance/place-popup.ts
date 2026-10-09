import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { MapPin, MapPinCheckInside, MapPinXInside } from 'lucide-react-native';
import { toast } from '@/components';
import { useAuth } from '@/lib/auth';
import { useToday, type TodayState } from './api';
import { getDeviceLocation } from './location';

/** GPS accuracy (m) credited towards the office area, capped — the same rule the server uses at check-in. */
const MAX_ACCURACY_ALLOWANCE_M = 100;
/** The same screen doesn't pop up again within a minute (switching tabs back and forth). */
const AGAIN_AFTER_MS = 60_000;
const lastShown: Partial<Record<string, number>> = {};

const haversineMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
};

const distanceText = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`);

/** "Andheri East, Mumbai" for a point (best-effort: null when the phone can't look it up in time). */
const areaName = async (latitude: number, longitude: number): Promise<string | null> => {
  try {
    const places = await Promise.race([
      Location.reverseGeocodeAsync({ latitude, longitude }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    const p = places?.[0];
    if (!p) return null;
    const parts = [p.district || p.subregion || p.street || p.name, p.city].filter((x): x is string => !!x);
    return [...new Set(parts)].join(', ') || null;
  } catch {
    return null;
  }
};

/** What to tell the employee about where they are, relative to their office. */
const describe = (office: TodayState['office'], point: { latitude: number; longitude: number; accuracy?: number }, area: string | null) => {
  const rough = (point.accuracy ?? 0) > 150 ? ' (approximate)' : '';
  if (!office) {
    return area
      ? { type: 'info' as const, icon: MapPin, title: `You’re near ${area}`, description: 'Your office location isn’t set yet, so the app can’t tell if you’re at the office.' }
      : null;
  }
  const distance = haversineMeters(point.latitude, point.longitude, office.latitude, office.longitude);
  const allowance = Math.min(Math.max(point.accuracy ?? 0, 0), MAX_ACCURACY_ALLOWANCE_M);
  const near = area ? ` · near ${area}` : '';
  if (office.radiusMeters > 0 && distance - allowance <= office.radiusMeters) {
    return { type: 'success' as const, icon: MapPinCheckInside, title: `You’re at ${office.name}`, description: `Inside the office check-in area${near}${rough}` };
  }
  if (office.radiusMeters > 0) {
    return { type: 'warning' as const, icon: MapPinXInside, title: 'You’re outside the office area', description: `${distanceText(distance)} from ${office.name}${near}${rough}` };
  }
  return { type: 'info' as const, icon: MapPin, title: area ? `You’re near ${area}` : `You’re ${distanceText(distance)} from ${office.name}`, description: `${distanceText(distance)} from ${office.name}${rough}` };
};

/**
 * On Home and Attendance: a pop-up saying where the employee is — at their office, or outside the office area and how
 * far away. Uses the phone's location only when it's already allowed (never asks here) and sends it nowhere; the
 * location is only recorded when they check in or out. Shown to everyone with an employee profile.
 */
export const usePlacePopup = (screen: 'home' | 'attendance') => {
  const { hasEmployee } = useAuth();
  const clocksIn = hasEmployee;
  const today = useToday();
  const loaded = clocksIn && !!today.data;
  const office = today.data?.office;

  useFocusEffect(
    useCallback(() => {
      if (!loaded) return;
      const last = lastShown[screen];
      if (last && Date.now() - last < AGAIN_AFTER_MS) return;
      let cancelled = false;
      void (async () => {
        const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
        if (!perm?.granted || cancelled) return;
        const fix = await getDeviceLocation();
        if (cancelled || 'error' in fix) return;
        const area = await areaName(fix.latitude, fix.longitude);
        const message = describe(office ?? null, fix, area);
        if (cancelled || !message) return;
        lastShown[screen] = Date.now();
        toast.show({ ...message, durationMs: 6000 });
      })();
      return () => {
        cancelled = true;
      };
    }, [loaded, screen, office]),
  );
};
