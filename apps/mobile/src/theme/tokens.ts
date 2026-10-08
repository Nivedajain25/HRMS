/**
 * Design tokens mirroring the web app (`apps/web/src/styles/index.css` and
 * `components/ui/display.tsx`). Components read semantic colors from the active
 * palette so light/dark switch by palette only.
 */

export const brand = {
  50: '#eef2ff',
  100: '#e0e7ff',
  200: '#c7d2fe',
  300: '#a5b4fc',
  400: '#818cf8',
  500: '#6366f1',
  600: '#4f46e5',
  700: '#4338ca',
  800: '#3730a3',
  900: '#312e81',
} as const;

export interface Palette {
  scheme: 'light' | 'dark';
  canvas: string;
  surface: string;
  surface2: string;
  surface3: string;
  line: string;
  lineStrong: string;
  fg: string;
  fg2: string;
  muted: string;
  subtle: string;
  ring: string;
  /** Primary action color. */
  primary: string;
  primaryPressed: string;
  onPrimary: string;
  /** Brand-tinted text/icons on surfaces (links, selected states). */
  accent: string;
  accentSoft: string;
  danger: string;
  dangerPressed: string;
  success: string;
  warning: string;
  overlay: string;
  /** Highlight cards (Today's overview, profile banner): a strong gradient in the role's colour, white text on it. */
  hero: [string, string, string];
}

/**
 * Role looks (same split as the web): employees blue / navy, HR and admins purple; `brand` before sign-in.
 * Only the accent-related colours change — neutrals stay calm and slightly tinted to match.
 */
export type RoleLook = 'brand' | 'employee' | 'admin';

type AccentSet = Pick<
  Palette,
  'primary' | 'primaryPressed' | 'accent' | 'accentSoft' | 'ring' | 'hero' | 'canvas' | 'surface2' | 'surface3' | 'line' | 'lineStrong'
>;

const LOOKS: Record<RoleLook, { light: Partial<AccentSet>; dark: Partial<AccentSet> }> = {
  brand: { light: {}, dark: {} },
  employee: {
    light: {
      primary: '#1e3a8a',
      primaryPressed: '#172f70',
      accent: '#1d4ed8',
      accentSoft: '#eff6ff',
      ring: '#2563eb',
      hero: ['#1e3a8a', '#1d4ed8', '#3b82f6'],
      canvas: '#f3f6fc',
      surface2: '#f6f9ff',
      surface3: '#eaf1fb',
      line: '#e2e8f3',
      lineStrong: '#cdd8ea',
    },
    dark: {
      primary: '#2563eb',
      primaryPressed: '#1d4ed8',
      accent: '#93c5fd',
      accentSoft: 'rgba(59, 130, 246, 0.15)',
      ring: '#60a5fa',
      hero: ['#172554', '#1e3a8a', '#1d4ed8'],
    },
  },
  admin: {
    light: {
      primary: '#7c3aed',
      primaryPressed: '#6d28d9',
      accent: '#7c3aed',
      accentSoft: '#f5f3ff',
      ring: '#8b5cf6',
      hero: ['#5b21b6', '#7c3aed', '#a855f7'],
      canvas: '#f6f5fc',
      surface2: '#f9f8fe',
      surface3: '#f0edfa',
      line: '#e9e5f6',
      lineStrong: '#d8d1ee',
    },
    dark: {
      primary: '#7c3aed',
      primaryPressed: '#8b5cf6',
      accent: '#c4b5fd',
      accentSoft: 'rgba(139, 92, 246, 0.15)',
      ring: '#a78bfa',
      hero: ['#2e1065', '#5b21b6', '#7c3aed'],
    },
  },
};

/** The palette for a colour scheme and role look. */
export const paletteFor = (scheme: 'light' | 'dark', look: RoleLook): Palette => {
  const base = scheme === 'dark' ? darkPalette : lightPalette;
  return { ...base, ...LOOKS[look][scheme] };
};

export const lightPalette: Palette = {
  scheme: 'light',
  // Soft lavender-tinted neutrals: calmer and warmer than plain grey.
  canvas: '#f4f4fb',
  surface: '#ffffff',
  surface2: '#f7f7fd',
  surface3: '#efeff8',
  line: '#e6e6f2',
  lineStrong: '#d4d4e6',
  fg: '#0f172a',
  fg2: '#334155',
  muted: '#64748b',
  subtle: '#94a3b8',
  ring: '#6366f1',
  primary: brand[600],
  primaryPressed: brand[700],
  onPrimary: '#ffffff',
  accent: brand[600],
  accentSoft: brand[50],
  danger: '#dc2626',
  dangerPressed: '#b91c1c',
  success: '#059669',
  warning: '#d97706',
  overlay: 'rgba(15, 23, 42, 0.45)',
  hero: ['#3730a3', '#4f46e5', '#6366f1'],
};

export const darkPalette: Palette = {
  scheme: 'dark',
  canvas: '#0b0d12',
  surface: '#12151c',
  surface2: '#171b23',
  surface3: '#1f2430',
  line: '#262c38',
  lineStrong: '#343b4a',
  fg: '#e6e9ef',
  fg2: '#c3c9d4',
  muted: '#8b93a3',
  subtle: '#5d6575',
  ring: '#818cf8',
  primary: brand[600],
  primaryPressed: brand[500],
  onPrimary: '#ffffff',
  accent: brand[400],
  accentSoft: 'rgba(99, 102, 241, 0.15)',
  danger: '#dc2626',
  dangerPressed: '#ef4444',
  success: '#34d399',
  warning: '#fbbf24',
  overlay: 'rgba(0, 0, 0, 0.6)',
  hero: ['#1e1b4b', '#312e81', '#4338ca'],
};

/* --------------------------------- Tones -------------------------------- */

/** Badge tones — identical to the web `Badge` tones. */
export type Tone = 'gray' | 'brand' | 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'teal';

export interface ToneColors {
  bg: string;
  fg: string;
  border: string;
  /** Solid accent (dots, progress, icons). */
  solid: string;
}

/** Tailwind scales used by the web tones (emerald, amber, red, sky, violet, teal). */
const scales = {
  brand: { 50: brand[50], 200: brand[200], 300: brand[300], 500: brand[500], 700: brand[700] },
  green: { 50: '#ecfdf5', 200: '#a7f3d0', 300: '#6ee7b7', 500: '#10b981', 700: '#047857' },
  amber: { 50: '#fffbeb', 200: '#fde68a', 300: '#fcd34d', 500: '#f59e0b', 700: '#92400e' },
  red: { 50: '#fef2f2', 200: '#fecaca', 300: '#fca5a5', 500: '#ef4444', 700: '#b91c1c' },
  blue: { 50: '#f0f9ff', 200: '#bae6fd', 300: '#7dd3fc', 500: '#0ea5e9', 700: '#0369a1' },
  purple: { 50: '#f5f3ff', 200: '#ddd6fe', 300: '#c4b5fd', 500: '#8b5cf6', 700: '#6d28d9' },
  teal: { 50: '#f0fdfa', 200: '#99f6e4', 300: '#5eead4', 500: '#14b8a6', 700: '#0f766e' },
} as const;

/** `#rrggbb` + alpha (0–1) → `#rrggbbaa`. */
export const withAlpha = (hex: string, alpha: number) =>
  `${hex}${Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')}`;

export const toneColors = (tone: Tone, palette: Palette): ToneColors => {
  if (tone === 'gray') {
    return { bg: palette.surface3, fg: palette.fg2, border: palette.lineStrong, solid: palette.subtle };
  }
  const s = scales[tone];
  return palette.scheme === 'dark'
    ? { bg: withAlpha(s[500], 0.15), fg: s[300], border: withAlpha(s[500], 0.3), solid: s[500] }
    : { bg: s[50], fg: s[700], border: s[200], solid: s[500] };
};

/* ------------------------------ Scale tokens ----------------------------- */

/** 4-pt spacing scale: `space(4)` = 16. */
export const space = (n: number) => n * 4;

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, full: 999 } as const;

export const fonts = {
  regular: 'Outfit_400Regular',
  medium: 'Outfit_500Medium',
  semibold: 'Outfit_600SemiBold',
  bold: 'Outfit_700Bold',
} as const;
export type FontWeight = keyof typeof fonts;

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  display: 44,
} as const;
export type FontSize = keyof typeof fontSize;

/** Minimum touch target (pt). */
export const TOUCH_TARGET = 44;
