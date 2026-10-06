import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, ChevronRight, Inbox, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchObjectUrl } from '@/lib/api';
import { t } from '@/lib/i18n';
import { cn, initials } from '@/lib/utils';
import { Button } from './button';

/* -------------------------------- Card -------------------------------- */

export const Card = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cn('card', className)} {...props} />;

export const CardHeader = ({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) => (
  <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
    <div className="min-w-0">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

export const CardBody = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div className={cn('p-5', className)} {...props} />;

/* -------------------------------- Badge ------------------------------- */

export type Tone = 'gray' | 'brand' | 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'teal';
const tones: Record<Tone, string> = {
  gray: 'bg-surface-3 text-fg-2 ring-line-strong/60',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/30',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  red: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  teal: 'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/30',
};

export const Badge = ({ tone = 'gray', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) => (
  <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', tones[tone], className)}>
    {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
    {children}
  </span>
);

/* ------------------------------- Avatar ------------------------------- */

const avatarPalette = ['bg-indigo-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-violet-500', 'bg-teal-500', 'bg-orange-500'];

/** Avatar that loads protected images through the authenticated API. */
export const Avatar = ({ name, src, size = 'md', className }: { name: string; src?: string | null; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; className?: string }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!src) return;
    let revoked = false;
    let objectUrl: string | null = null;
    fetchObjectUrl(src)
      .then((u) => {
        objectUrl = u;
        if (!revoked) setUrl(u);
      })
      .catch(() => setUrl(null));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);
  const dims = { xs: 'h-6 w-6 text-[10px]', sm: 'h-8 w-8 text-xs', md: 'h-9 w-9 text-sm', lg: 'h-12 w-12 text-base', xl: 'h-20 w-20 text-2xl' }[size];
  const color = avatarPalette[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % avatarPalette.length];
  return url ? (
    <img src={url} alt={name} className={cn('shrink-0 rounded-full object-cover', dims, className)} />
  ) : (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white', dims, color, className)}>
      {initials(name) || '?'}
    </span>
  );
};

export const PersonCell = ({ name, subtitle, photo, to }: { name: string; subtitle?: ReactNode; photo?: string | null; to?: string }) => {
  const content = (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar name={name} src={photo} size="sm" />
      <span className="min-w-0">
        <span className="block truncate font-medium text-fg">{name}</span>
        {subtitle && <span className="block truncate text-xs text-muted">{subtitle}</span>}
      </span>
    </span>
  );
  return to ? (
    <Link to={to} className="rounded-md hover:opacity-80">
      {content}
    </Link>
  ) : (
    content
  );
};

/* ------------------------------ Skeleton ------------------------------ */

export const Skeleton = ({ className }: { className?: string }) => <div className={cn('animate-pulse rounded-md bg-surface-3', className)} aria-hidden />;

export const PageSkeleton = () => (
  <div className="space-y-6" role="status" aria-label={t('common.loading')}>
    <Skeleton className="h-8 w-64" />
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </div>
    <Skeleton className="h-80" />
  </div>
);

/* ---------------------------- Empty / Error --------------------------- */

export const EmptyState = ({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) => (
  <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-3 text-muted">{icon ?? <Inbox className="h-6 w-6" />}</div>
    <h3 className="text-sm font-semibold text-fg">{title}</h3>
    {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

export const ErrorState = ({ title = t('errors.generic'), message, onRetry, className }: { title?: string; message?: string; onRetry?: () => void; className?: string }) => (
  <div role="alert" className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400">
      <AlertTriangle className="h-6 w-6" />
    </div>
    <h3 className="text-sm font-semibold text-fg">{title}</h3>
    {message && <p className="mt-1 max-w-md text-sm text-muted">{message}</p>}
    {onRetry && (
      <Button variant="outline" size="sm" className="mt-5" onClick={onRetry} icon={<RefreshCw className="h-4 w-4" />}>
        {t('common.retry')}
      </Button>
    )}
  </div>
);

/* ----------------------------- Breadcrumb ----------------------------- */

export const Breadcrumb = ({ items }: { items: { label: string; to?: string }[] }) => (
  <nav aria-label="Breadcrumb" className="mb-1">
    <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
      {items.map((item, i) => (
        <li key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden />}
          {item.to ? (
            <Link to={item.to} className="hover:text-fg">
              {item.label}
            </Link>
          ) : (
            <span aria-current="page">{item.label}</span>
          )}
        </li>
      ))}
    </ol>
  </nav>
);

/* ------------------------------ Page head ----------------------------- */

/** A page title with a small violet icon tile in front (People pages). */
export const IconTitle = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
  <span className="flex items-center gap-2.5">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300 [&_svg]:h-5 [&_svg]:w-5" aria-hidden>
      {icon}
    </span>
    {children}
  </span>
);

export const PageHeader = ({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: { label: string; to?: string }[];
}) => (
  <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0">
      {breadcrumb && <Breadcrumb items={breadcrumb} />}
      <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

/* ------------------------------ Stat card ----------------------------- */

export const StatCard = ({
  label,
  value,
  icon,
  hint,
  tone = 'brand',
  to,
  loading,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  tone?: 'brand' | 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'teal' | 'gray';
  to?: string;
  loading?: boolean;
}) => {
  const iconTone = {
    brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300',
    green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
    red: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
    blue: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
    purple: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
    teal: 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300',
    gray: 'bg-surface-3 text-fg-2',
  }[tone];
  const body = (
    <div className="card flex h-full items-start justify-between gap-3 p-4 transition-shadow hover:shadow-pop">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-xs font-medium tracking-wide text-muted uppercase sm:truncate" title={label}>
          {label}
        </p>
        {loading ? (
          <Skeleton className="mt-2 h-7 w-16" />
        ) : (
          <p
            className="mt-1.5 truncate text-xl font-semibold tracking-tight text-fg tabular-nums 2xl:text-2xl"
            title={typeof value === 'string' || typeof value === 'number' ? String(value) : undefined}
          >
            {value}
          </p>
        )}
        {hint && <p className="mt-1 line-clamp-2 text-xs text-muted sm:truncate">{hint}</p>}
      </div>
      {/* Icons are decorative; on phones the two-column grid needs the room for the numbers. */}
      {icon && <div className={cn('hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg sm:flex', iconTone)}>{icon}</div>}
    </div>
  );
  return to ? (
    <Link to={to} className="block rounded-xl">
      {body}
    </Link>
  ) : (
    body
  );
};

/* --------------------------- Key/value list --------------------------- */

export const DescriptionList = ({ items, columns = 2 }: { items: { label: string; value: ReactNode }[]; columns?: 1 | 2 | 3 }) => (
  <dl className={cn('grid gap-x-6 gap-y-4', columns === 1 ? 'grid-cols-1' : columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
    {items.map((item) => (
      <div key={item.label} className="min-w-0">
        <dt className="text-xs font-medium text-muted">{item.label}</dt>
        <dd className="mt-1 text-sm break-words text-fg">{item.value === null || item.value === undefined || item.value === '' ? '—' : item.value}</dd>
      </div>
    ))}
  </dl>
);

export const ProgressBar = ({ value, className, tone = 'brand' }: { value: number; className?: string; tone?: 'brand' | 'green' | 'amber' }) => (
  <div className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-3', className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
    <div
      className={cn('h-full rounded-full transition-all', tone === 'green' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-brand-600')}
      style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
    />
  </div>
);
