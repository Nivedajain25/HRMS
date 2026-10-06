import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3 } from 'lucide-react';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/display';
import { cn } from '@/lib/utils';
import { useReportList } from './api';
import { REPORT_ICONS } from './report-icons';

export const ReportsPage = () => {
  const list = useReportList();

  return (
    <>
      <PageHeader title="Reports" description="Preview organization data and export it as CSV, Excel or PDF." />
      {list.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading reports">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : list.error ? (
        <ErrorState className="card" message={list.error.message} onRetry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <EmptyState className="card" icon={<BarChart3 className="h-6 w-6" />} title="No reports available" description="Your role doesn't include access to any report yet." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.data.map((r) => {
            const meta = REPORT_ICONS[r.type] ?? { icon: BarChart3, tone: 'bg-surface-3 text-fg-2' };
            const Icon = meta.icon;
            return (
              <li key={r.type}>
                <Link
                  to={`/reports/${r.type}`}
                  className="card group flex h-full flex-col p-5 transition-shadow hover:shadow-pop focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                >
                  <span className={cn('flex h-10 w-10 items-center justify-center rounded-lg', meta.tone)} aria-hidden>
                    <Icon className="h-5 w-5" />
                  </span>
                  <h2 className="mt-4 text-sm font-semibold text-fg">{r.title}</h2>
                  <p className="mt-1 flex-1 text-sm leading-relaxed text-muted">{r.description}</p>
                  <span className="mt-4 flex items-center justify-between text-xs">
                    <span className="font-medium tracking-wide text-subtle uppercase">CSV · Excel · PDF</span>
                    <span className="inline-flex items-center gap-1 font-medium text-brand-600 dark:text-brand-400">
                      Open
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
};
