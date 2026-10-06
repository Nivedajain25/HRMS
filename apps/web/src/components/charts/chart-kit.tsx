import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { ResponsiveContainer } from 'recharts';
import { BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorState, Skeleton } from '../ui/display';

/**
 * Theme-aware building blocks for recharts. Colors are CSS variables so
 * charts follow light/dark mode without re-rendering.
 */
export const CHART_COLORS = {
  brand: 'var(--color-brand-500)',
  green: '#10b981',
  red: '#ef4444',
  amber: '#f59e0b',
  blue: '#0ea5e9',
  purple: '#8b5cf6',
  teal: '#14b8a6',
  gray: 'var(--subtle)',
} as const;

/**
 * Categorical palette for multi-series / multi-slice charts, in fixed order
 * (assign by entity, never cycle past the end — fold extras into "Other").
 * Validated for lightness band, CVD separation of adjacent slots and >= 3:1
 * contrast on both the light (#fff) and dark (#12151c) chart surfaces.
 */
export const CHART_PALETTE = ['var(--color-brand-500)', '#059669', '#d97706', '#0284c7', '#e11d48', '#0d9488', '#8b5cf6', '#ea580c'] as const;

/** Neutral used for an "Other" bucket beyond the palette. */
export const CHART_OTHER = 'var(--subtle)';

/** Palette color for the i-th series; beyond the palette falls back to the neutral "Other" color. */
export const paletteColor = (i: number) => CHART_PALETTE[i] ?? CHART_OTHER;

/**
 * Screen-reader data table for a chart (charts themselves are images to
 * assistive tech).
 */
export const ChartDataTable = ({ caption, columns, rows }: { caption: string; columns: string[]; rows: (string | number)[][] }) => (
  <table className="sr-only">
    <caption>{caption}</caption>
    <thead>
      <tr>
        {columns.map((c) => (
          <th key={c} scope="col">
            {c}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((r, i) => (
        <tr key={i}>
          {r.map((v, j) => (j === 0 ? <th key={j} scope="row">{v}</th> : <td key={j}>{v}</td>))}
        </tr>
      ))}
    </tbody>
  </table>
);

export const chartGrid ={ stroke: 'var(--line)', strokeDasharray: '3 3', vertical: false } as const;

export const chartAxis = {
  stroke: 'var(--line-strong)',
  tick: { fill: 'var(--muted)', fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

const tooltipContent: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  boxShadow: '0 12px 32px -8px rgb(16 24 40 / 0.18)',
  color: 'var(--fg)',
  fontSize: 12,
  padding: '8px 10px',
};

export const chartTooltip = {
  contentStyle: tooltipContent,
  labelStyle: { color: 'var(--fg)', fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: 'var(--fg-2)', padding: 0 },
  cursor: { fill: 'var(--surface-3)', opacity: 0.6 },
} as const;

export const chartLegend = {
  iconType: 'circle' as const,
  iconSize: 8,
  wrapperStyle: { fontSize: 12, color: 'var(--muted)', paddingTop: 8 },
};

/**
 * Sized chart frame with loading / error / empty handling. Children must be a
 * single recharts chart element (it is wrapped in a ResponsiveContainer).
 */
export const ChartFrame = ({
  height = 260,
  loading,
  error,
  onRetry,
  empty,
  emptyTitle = 'No data yet',
  label,
  className,
  children,
}: {
  height?: number;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  empty?: boolean;
  emptyTitle?: string;
  /** Accessible description of the chart. */
  label: string;
  className?: string;
  children: ReactNode;
}) => {
  if (loading)
    return (
      <div className={cn('w-full', className)} style={{ height }}>
        <Skeleton className="h-full w-full" />
      </div>
    );
  if (error) return <ErrorState message={error.message} onRetry={onRetry} className="py-8" />;
  if (empty) return <EmptyState icon={<BarChart3 className="h-6 w-6" />} title={emptyTitle} className="py-10" />;
  return (
    <div role="img" aria-label={label} className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children as ReactElement}
      </ResponsiveContainer>
    </div>
  );
};
