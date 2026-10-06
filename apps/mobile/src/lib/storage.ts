import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Small wrapper around the platform keychain / keystore. Every call is
 * best-effort: storage failures (e.g. keystore reset after a device restore)
 * must never crash the app — they behave like an empty store.
 *
 * The browser preview (Expo web) has no keychain, so it falls back to the tab's
 * sessionStorage: sign-in survives a refresh but ends when the tab is closed.
 */
export const StorageKeys = {
  refreshToken: 'stencil.refreshToken',
  themePreference: 'stencil.themePreference',
  lastEmail: 'stencil.lastEmail',
  pushToken: 'stencil.pushToken',
  /** Emergency decisions the employee has already seen (JSON array of emergency ids). */
  emergencyDecisionsSeen: 'stencil.emergencyDecisionsSeen',
} as const;
type Key = (typeof StorageKeys)[keyof typeof StorageKeys];

const web = Platform.OS === 'web';
const session = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
};

export const storage = {
  async get(key: Key): Promise<string | null> {
    try {
      return web ? (session()?.getItem(key) ?? null) : await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: Key, value: string): Promise<void> {
    try {
      if (web) session()?.setItem(key, value);
      else await SecureStore.setItemAsync(key, value);
    } catch (err) {
      console.warn(`[storage] could not save ${key}`, err);
    }
  },
  async remove(key: Key): Promise<void> {
    try {
      if (web) session()?.removeItem(key);
      else await SecureStore.deleteItemAsync(key);
    } catch {
      /* already gone */
    }
  },
};
