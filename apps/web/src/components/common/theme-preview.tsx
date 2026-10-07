import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import type { ThemeOption } from '@/store/theme';

type Swatch = ThemeOption['swatch'];

/** A miniature app screen in a theme's colours: sidebar, heading and a card. */
export const ThemePreview = ({ swatch, className }: { swatch: Swatch; className?: string }) => (
  <span aria-hidden className={cn('flex overflow-hidden rounded-lg border', className)} style={{ background: swatch.canvas, borderColor: swatch.line }}>
    <span className="w-1/4 border-r" style={{ background: swatch.surface, borderColor: swatch.line }} />
    <span className="flex flex-1 flex-col gap-1.5 p-2">
      <span className="h-1.5 w-2/3 rounded-full" style={{ background: swatch.fg }} />
      <span className="flex flex-1 flex-col gap-1 rounded-md border p-1.5" style={{ background: swatch.surface, borderColor: swatch.line }}>
        <span className="h-1 w-3/4 rounded-full" style={{ background: swatch.muted }} />
        <span className="h-1 w-1/2 rounded-full" style={{ background: swatch.muted }} />
        <span className="mt-auto h-1.5 w-1/3 rounded-full bg-brand-500" />
      </span>
    </span>
  </span>
);

/** Round chip for menus: page colour on one half, card colour on the other. */
export const ThemeDot = ({ swatch, className }: { swatch: Swatch; className?: string }) => {
  const style: CSSProperties = { background: `linear-gradient(135deg, ${swatch.canvas} 50%, ${swatch.surface} 50%)`, borderColor: swatch.line };
  return <span aria-hidden className={cn('inline-block h-4 w-4 shrink-0 rounded-full border', className)} style={style} />;
};
