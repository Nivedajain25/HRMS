import { create } from 'zustand';
import { THEME_PREFERENCES, type ThemePreference } from '@stencil/shared';

export type { ThemePreference };
export type ThemeName = Exclude<ThemePreference, 'system'>;

export interface ThemeOption {
  value: ThemeName;
  label: string;
  mode: 'light' | 'dark';
  /** Preview colours (mirror styles/index.css): page, card, border, text, secondary text. */
  swatch: { canvas: string; surface: string; line: string; fg: string; muted: string };
}

/** The colour themes, light ones first. Tokens live in styles/index.css. */
export const THEMES: ThemeOption[] = [
  { value: 'light', label: 'Light', mode: 'light', swatch: { canvas: '#f6f7f9', surface: '#ffffff', line: '#e5e7eb', fg: '#0f172a', muted: '#94a3b8' } },
  { value: 'sand', label: 'Sand', mode: 'light', swatch: { canvas: '#f4eee4', surface: '#fffcf7', line: '#e7ddcc', fg: '#2a2118', muted: '#a6978a' } },
  { value: 'lavender', label: 'Lavender', mode: 'light', swatch: { canvas: '#f3f1fb', surface: '#ffffff', line: '#e4e0f3', fg: '#1e1b3a', muted: '#9d97bd' } },
  { value: 'dark', label: 'Dark', mode: 'dark', swatch: { canvas: '#161b24', surface: '#1e2430', line: '#364051', fg: '#e6e9ef', muted: '#5d6575' } },
  { value: 'midnight', label: 'Midnight', mode: 'dark', swatch: { canvas: '#0b0d12', surface: '#12151c', line: '#262c38', fg: '#e6e9ef', muted: '#5d6575' } },
  { value: 'navy', label: 'Navy', mode: 'dark', swatch: { canvas: '#0d1a2e', surface: '#13223b', line: '#293e63', fg: '#e6edf8', muted: '#5f6f8f' } },
  { value: 'plum', label: 'Plum', mode: 'dark', swatch: { canvas: '#181120', surface: '#21182c', line: '#3d304f', fg: '#eee7f6', muted: '#6c5f82' } },
  { value: 'graphite', label: 'Graphite', mode: 'dark', swatch: { canvas: '#161618', surface: '#1f1f22', line: '#3a3a40', fg: '#e8e8eb', muted: '#65656d' } },
];

const KEY = 'stencil-theme';

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

/** The theme actually shown: "system" becomes Light or Dark. */
export const resolveTheme = (pref: ThemePreference): ThemeName => (pref === 'system' ? (systemDark() ? 'dark' : 'light') : pref);

/** Light or dark base of a preference (for widgets that only know those two). */
export const themeMode = (pref: ThemePreference) => (THEMES.find((t) => t.value === resolveTheme(pref))?.mode ?? 'light');

export const applyTheme = (pref: ThemePreference) => {
  const root = document.documentElement;
  root.classList.toggle('dark', themeMode(pref) === 'dark');
  root.dataset.theme = resolveTheme(pref);
};

const read = (): ThemePreference => {
  try {
    const v = localStorage.getItem(KEY);
    return (THEME_PREFERENCES as readonly string[]).includes(v ?? '') ? (v as ThemePreference) : 'system';
  } catch {
    return 'system';
  }
};

/**
 * Theme change as a soft fade (View Transitions API). Falls back to an instant switch
 * where unsupported or when the user prefers reduced motion.
 */
const applyWithWave = (pref: ThemePreference) => {
  const unchanged = document.documentElement.dataset.theme === resolveTheme(pref);
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  if (unchanged || !doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    applyTheme(pref);
    return;
  }
  const transition = doc.startViewTransition(() => applyTheme(pref));
  transition.ready
    .then(() => {
      // Soft fade (paired with the sun / moon flip on the theme button): the new theme gently fades in over the old one.
      document.documentElement.animate({ opacity: [0, 1] }, { duration: 700, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' });
    })
    .catch(() => undefined);
};

interface ThemeState {
  theme: ThemePreference;
  setTheme: (t: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: read(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* storage unavailable: preference applies for this session only */
    }
    applyWithWave(theme);
    set({ theme });
  },
}));

/** Keeps "system" in sync with OS changes. */
export const watchSystemTheme = () => {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (useThemeStore.getState().theme === 'system') applyTheme('system');
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
};
