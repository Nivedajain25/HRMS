import { cn } from '@/lib/utils';
import logoDark from '@/assets/brand/stencil-logo-dark.png';
import logoLight from '@/assets/brand/stencil-logo.png';
import mark from '@/assets/brand/stencil-mark.png';

/** Stencil logomark: the "S" from the company logo on a navy tile (collapsed sidebar, loaders). */
export const Logomark = ({ className }: { className?: string }) => (
  <img src={mark} alt="" aria-hidden className={cn('h-8 w-8 shrink-0 select-none', className)} draggable={false} />
);

/** The company wordmark ("Stencil — Interior & Exterior Products"), with a light variant for dark mode. */
const Wordmark = ({ className }: { className?: string }) => (
  <span className={cn('block shrink-0', className)}>
    <img src={logoLight} alt="Stencil" className="h-full w-auto select-none dark:hidden" draggable={false} />
    <img src={logoDark} alt="Stencil" className="hidden h-full w-auto select-none dark:block" draggable={false} />
  </span>
);

export const Logo = ({ className, collapsed, size = 'md' }: { className?: string; collapsed?: boolean; size?: 'sm' | 'md' | 'lg' }) =>
  collapsed ? (
    <Logomark className={className} />
  ) : (
    <span className={cn('flex items-center', size === 'sm' ? 'gap-2.5' : 'gap-3', className)}>
      <Wordmark className={{ sm: 'h-9', md: 'h-11', lg: 'h-14' }[size]} />
      <span className={cn('border-l border-line font-semibold tracking-[0.2em] text-muted uppercase', size === 'sm' ? 'pl-2.5 text-[10px]' : 'pl-3 text-[11px]')}>HRMS</span>
    </span>
  );
