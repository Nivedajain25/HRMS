import { create } from 'zustand';

export type ThemePreference = 'light' | 'dark' | 'system';
const KEY = 'stencil-theme';

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

export const applyTheme = (pref: ThemePreference) => {
  const dark = pref === 'dark' || (pref === 'system' && systemDark());
  document.documentElement.classList.toggle('dark', dark);
};

const read = (): ThemePreference => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
};

/**
 * Light ⇄ dark as a soft fade (View Transitions API). Falls back to an instant switch
 * where unsupported or when the user prefers reduced motion.
 */
const applyWithWave = (pref: ThemePreference) => {
  const wasDark = document.documentElement.classList.contains('dark');
  const willDark = pref === 'dark' || (pref === 'system' && systemDark());
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  if (wasDark === willDark || !doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
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
