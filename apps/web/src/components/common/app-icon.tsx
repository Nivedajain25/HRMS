import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TONE_SHADOW, TONE_SOLID, TONE_TEXT, type ModuleTone } from '@/lib/module-colors';

const SIZES = {
  sm: { tile: 'h-6 w-6 rounded-[7px]', icon: 'h-3.5 w-3.5' },
  md: { tile: 'h-8 w-8 rounded-[9px]', icon: 'h-[17px] w-[17px]' },
  lg: { tile: 'h-12 w-12 rounded-2xl', icon: 'h-6 w-6' },
} as const;

/**
 * A feature's icon on a small tile.
 * - `soft` (menu, search): the module-coloured icon on a plain white tile with a light shadow — quiet and
 *   professional. On the sidebar's current-page pill it turns translucent (`.nav-tile` in styles/index.css).
 * - `solid` (All features grid): a white icon on a tile in the module's colour, like an app launcher.
 */
export const AppIcon = ({
  icon: Icon,
  tone,
  size = 'md',
  variant = 'soft',
  className,
}: {
  icon: LucideIcon;
  tone: ModuleTone;
  size?: keyof typeof SIZES;
  variant?: 'soft' | 'solid';
  className?: string;
}) => (
  <span
    aria-hidden
    className={cn(
      'nav-tile flex shrink-0 items-center justify-center transition-transform group-hover:scale-105',
      SIZES[size].tile,
      variant === 'solid'
        ? cn('shadow-md ring-1 ring-black/5', TONE_SOLID[tone], TONE_SHADOW[tone])
        : 'bg-white shadow-[0_1px_3px_rgb(15_23_42/0.08),0_1px_2px_rgb(15_23_42/0.04)] ring-1 ring-slate-200/70 dark:bg-surface-2 dark:ring-white/10',
      className,
    )}
  >
    <Icon className={cn('nav-icon', SIZES[size].icon, variant === 'solid' ? 'text-white' : TONE_TEXT[tone])} strokeWidth={variant === 'solid' ? 2.2 : 2} />
  </span>
);
