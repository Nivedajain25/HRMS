import { createContext, useContext, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';
import { ErrorBoundary } from '@/app/error-boundary';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/display';
import { cn } from '@/lib/utils';

type Accent = 'brand' | 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'teal' | 'gray' | 'warm';

const accents: Record<Accent, string> = {
  /** Employee dashboard: light blue tile, deep blue icon. */
  warm: 'bg-[#dbeafe] text-[#1d4ed8] dark:bg-[#1d4ed8]/25 dark:text-[#dbeafe]',
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300',
  green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  red: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
  blue: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
  purple: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
  teal: 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300',
  gray: 'bg-surface-3 text-fg-2',
};

export const ViewAllLink = ({ to, label = 'View all' }: { to: string; label?: string }) => (
  <Link
    to={to}
    className="group inline-flex items-center gap-1 rounded-md text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
  >
    {label}
    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
  </Link>
);

/** Compact inline error for a single widget. */
export const WidgetError = ({ message, onRetry }: { message?: string; onRetry?: () => void }) => (
  <div role="alert" className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
    <AlertTriangle className="h-5 w-5 text-red-500" aria-hidden />
    <p className="text-sm font-medium text-fg">Couldn't load this widget</p>
    {message && <p className="max-w-xs text-xs text-muted">{message}</p>}
    {onRetry && (
      <Button variant="outline" size="xs" onClick={onRetry} icon={<RefreshCw className="h-3.5 w-3.5" />}>
        Retry
      </Button>
    )}
  </div>
);

export const WidgetEmpty = ({ icon, title, description }: { icon?: ReactNode; title: string; description?: string }) => (
  <div className="flex h-full min-h-32 flex-col items-center justify-center px-4 py-6 text-center">
    {icon && <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-surface-3 text-muted">{icon}</div>}
    <p className="text-sm font-medium text-fg-2">{title}</p>
    {description && <p className="mt-0.5 max-w-xs text-xs text-muted">{description}</p>}
  </div>
);

export const ListSkeleton = ({ rows = 4 }: { rows?: number }) => (
  <div className="space-y-3 p-5" aria-hidden>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
    ))}
  </div>
);

/**
 * Boxed card titles for a whole dashboard (HR / employee), exactly like the super admin's ("✅ Tasks"): an emoji and
 * the title in a violet / purple / pink pill with black text, a violet card border and a line under the header.
 * A card's own `titleBox` still wins.
 */
export const TitleBoxContext = createContext<boolean | Readonly<Record<string, string>>>(false);

/** Cards whose admin-style title shows without the coloured pill (emoji + plain black title). */
export const PlainTitlesContext = createContext<ReadonlySet<string>>(new Set());

/** HR dashboard: these cards drop the pill colour. */
export const HR_PLAIN_TITLES: ReadonlySet<string> = new Set(['Quick Actions', 'Latest announcements', 'Upcoming holidays', 'My goals']);

/**
 * Employee dashboard: plain black titles; the colour sits only on a small soft-blue tile behind each card's emoji
 * (a different light blue per card). Any other card gets the default tile.
 */
export const EMPLOYEE_TILES: Readonly<Record<string, string>> = {
  Today: 'bg-blue-200 dark:bg-blue-500/30',
  Attendance: 'bg-sky-200 dark:bg-sky-500/30',
  'My tasks': 'bg-indigo-200 dark:bg-indigo-500/30',
  Notifications: 'bg-sky-200 dark:bg-sky-500/30',
  'My recent activity': 'bg-cyan-200 dark:bg-cyan-500/30',
  'Quick Actions': 'bg-blue-200 dark:bg-blue-500/30',
  'Latest announcements': 'bg-indigo-200 dark:bg-indigo-500/30',
  'Upcoming holidays': 'bg-sky-200 dark:bg-sky-500/30',
  'My goals': 'bg-cyan-200 dark:bg-cyan-500/30',
};
const DEFAULT_TILE = 'bg-blue-200 dark:bg-blue-500/30';

/** Emoji on a soft tile + plain black title (employee dashboard headers). */
export const EmojiTitle = ({ title, emoji, tile, as: Tag = 'h3', id }: { title: string; emoji: string; tile?: string; as?: 'h2' | 'h3'; id?: string }) => (
  <Tag id={id} className="flex min-w-0 items-center gap-2.5 text-base font-semibold text-black dark:text-fg">
    {emoji ? (
      <span aria-hidden className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base leading-none', tile ?? DEFAULT_TILE)}>
        {emoji}
      </span>
    ) : null}
    <span className="truncate">{title}</span>
  </Tag>
);

/** The employee dashboard's tile for a card title. */
export const employeeTile = (title: string) => EMPLOYEE_TILES[title] ?? DEFAULT_TILE;

/** The super admin's emoji + pill colour for each card (same card → same look on every dashboard). */
const ADMIN_STYLE: Record<string, { emoji: string; box: string }> = {
  Today: { emoji: '⏰', box: 'bg-blue-400' },
  Attendance: { emoji: '📊', box: 'bg-violet-300' },
  'Attendance overview': { emoji: '📊', box: 'bg-violet-300' },
  'My tasks': { emoji: '📋', box: 'bg-fuchsia-200' },
  Notifications: { emoji: '🔔', box: 'bg-violet-200' },
  'My recent activity': { emoji: '🕒', box: 'bg-purple-300' },
  'Recent activity': { emoji: '🕒', box: 'bg-purple-300' },
  'Quick Actions': { emoji: '⚡', box: 'bg-violet-200' },
  'Latest announcements': { emoji: '📢', box: 'bg-fuchsia-300' },
  Announcements: { emoji: '📢', box: 'bg-fuchsia-300' },
  'Upcoming holidays': { emoji: '🎉', box: 'bg-purple-200' },
  'My goals': { emoji: '🎯', box: 'bg-violet-300' },
  'Awaiting your approval': { emoji: '⏳', box: 'bg-violet-200' },
  Schedules: { emoji: '🗓️', box: 'bg-purple-300' },
};
const ADMIN_FALLBACK = ['bg-violet-200', 'bg-purple-200', 'bg-fuchsia-200', 'bg-violet-300', 'bg-purple-300', 'bg-indigo-200'];

/** The admin-style pill (emoji + colour) for a card title; unknown cards get a colour from the same family. */
export const adminTitleStyle = (title: string) => {
  const known = ADMIN_STYLE[title];
  if (known) return known;
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { emoji: '', box: ADMIN_FALLBACK[h % ADMIN_FALLBACK.length]! };
};

/** Card border + header line that go with boxed titles. */
export const boxedCard = 'border-violet-200 dark:border-violet-500/20 [&>header]:border-b [&>header]:border-line';

/** The pill classes shared by boxed titles. */
export const titlePill = 'rounded-lg px-2.5 py-0.5 text-base text-black shadow-sm';

/**
 * Dashboard card: icon + title header, optional action, and a body that
 * swaps in loading / error / empty states so each widget fails on its own.
 */
export const Widget = ({
  title,
  description,
  icon,
  accent = 'brand',
  action,
  loading,
  error,
  onRetry,
  empty,
  emptyState,
  skeleton,
  className,
  bodyClassName,
  titleBox,
  children,
}: {
  title: string;
  /** Background classes to show the title in a coloured box with black text (admin dashboard). */
  titleBox?: string;
  description?: ReactNode;
  icon?: ReactNode;
  accent?: Accent;
  action?: ReactNode;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  empty?: boolean;
  emptyState?: ReactNode;
  skeleton?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}) => {
  // Dashboard-wide admin style (HR / employee): emoji + title in the admin's pill colour; no icon tile.
  // The context may also carry per-card pill colours (employee blues) that replace the admin colour.
  const dashboardStyle = useContext(TitleBoxContext);
  const auto = dashboardStyle && !titleBox ? adminTitleStyle(title) : null;
  // Employee dashboard (tiles map in the context): emoji on a soft-blue tile, plain black title.
  const tiles = typeof dashboardStyle === 'object' && !titleBox && auto?.emoji ? dashboardStyle : null;
  // Plain (no pill) for cards listed in PlainTitlesContext.
  const plainTitles = useContext(PlainTitlesContext);
  const plain = !titleBox && !tiles && !!auto && plainTitles.has(title);
  const box = titleBox ?? (tiles || plain ? undefined : auto?.box);
  // Unknown cards (no emoji) keep their icon, inside the pill.
  const pillIcon = auto && !auto.emoji ? icon : null;
  return (
  <section aria-label={title} aria-busy={loading || undefined} className={cn('card flex h-full min-w-0 flex-col', auto && (tiles ? '[&>header]:border-b [&>header]:border-line' : boxedCard), className)}>
    <header className="flex min-h-16 items-center justify-between gap-3 px-5 py-3.5">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && !auto && <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', accents[accent])}>{icon}</span>}
        {/* Note sits beside the title (not under it), so every box header has the same height. */}
        <div className="flex min-w-0 items-baseline gap-2">
          {tiles ? (
            <EmojiTitle title={title} emoji={auto!.emoji} tile={tiles[title]} />
          ) : (
            <h3 className={cn('truncate text-lg font-semibold', box ? cn(titlePill, box, pillIcon && 'inline-flex items-center gap-1.5 [&_svg]:h-4 [&_svg]:w-4') : plain ? 'text-base text-black dark:text-fg' : 'text-fg')}>
              {pillIcon ? <span aria-hidden className="inline-flex">{pillIcon}</span> : null}
              {auto?.emoji ? <span aria-hidden className="mr-1.5">{auto.emoji}</span> : null}
              {title}
            </h3>
          )}
          {description && <p className="truncate text-xs text-muted">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
    <div className={cn('flex-1', bodyClassName)}>
      {loading ? (
        (skeleton ?? <ListSkeleton />)
      ) : error ? (
        <WidgetError message={error.message} onRetry={onRetry} />
      ) : empty ? (
        emptyState
      ) : (
        children
      )}
    </div>
  </section>
  );
};

/** Keeps a crashing widget from taking down the rest of the dashboard. */
export const WidgetBoundary = ({ children, title = 'Widget' }: { children: ReactNode; title?: string }) => (
  <ErrorBoundary
    fallback={
      <div className="card">
        <WidgetError message={`${title} failed to render.`} />
      </div>
    }
  >
    {children}
  </ErrorBoundary>
);

export type { Accent };
