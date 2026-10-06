import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import { storage, StorageKeys } from '@/lib/storage';
import { darkPalette, lightPalette, type Palette } from './tokens';

export type ThemePreference = 'system' | 'light' | 'dark';
const PREFERENCES: ThemePreference[] = ['system', 'light', 'dark'];

interface ThemeContextValue {
  /** Active palette. */
  c: Palette;
  scheme: 'light' | 'dark';
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  /** True once the stored preference has been read (avoids a light→dark flash). */
  ready: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const applyToNative = (p: ThemePreference) => {
  // Drives native UI (date pickers, alerts, keyboards) and `useColorScheme`.
  Appearance.setColorScheme(p === 'system' ? 'unspecified' : p);
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [preference, setPref] = useState<ThemePreference>('system');
  const [ready, setReady] = useState(false);
  const system = useColorScheme();

  useEffect(() => {
    let active = true;
    void storage.get(StorageKeys.themePreference).then((stored) => {
      if (!active) return;
      if (stored && (PREFERENCES as string[]).includes(stored)) {
        setPref(stored as ThemePreference);
        applyToNative(stored as ThemePreference);
      }
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    setPref(p);
    applyToNative(p);
    void storage.set(StorageKeys.themePreference, p);
  }, []);

  const scheme: 'light' | 'dark' = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  const value = useMemo<ThemeContextValue>(
    () => ({ c: scheme === 'dark' ? darkPalette : lightPalette, scheme, preference, setPreference, ready }),
    [scheme, preference, setPreference, ready],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
};
