import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Award, CalendarRange, IndianRupee, Target, TrendingUp } from 'lucide-react';
import { Card, IconTitle, PageHeader, Skeleton } from '@/components/ui/display';
import { Tabs } from '@/components/ui/overlay';
import { SalesOverview } from '@/features/dashboard/components/sales-overview';
import { formatKey } from '@/features/attendance/lib';
import { get } from '@/lib/api';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { inr, inrFull, MySales, TeamSales } from './individual-sales';

interface SalesMonthly {
  months: { month: string; amount: number | null; target: number | null }[];
  hasData: boolean;
  lastUpdated: string | null;
}

const Stat = ({ icon, tone, label, value, sub }: { icon: ReactNode; tone: string; label: string; value: string; sub?: ReactNode }) => (
  <Card className="flex items-center gap-4 p-4">
    <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', tone)} aria-hidden>
      {icon}
    </span>
    <span className="min-w-0">
      <span className="block text-xs font-medium text-muted">{label}</span>
      <span className="block text-2xl font-bold text-fg tabular-nums">{value}</span>
      {sub ? <span className="block text-xs text-muted">{sub}</span> : null}
    </span>
  </Card>
);

type Range = 12 | 24 | 36;

/**
 * Sales. Employees see their own logged sales (My sales); HR / admin see the company figures plus everyone's
 * logged sales (Team sales), and — when they're an employee too — a My sales tab.
 */
export const SalesPage = () => {
  const { canAny, hasEmployee } = usePermissions();
  const seesCompany = canAny('report:read', 'employee:read');
  const [tab, setTab] = useState<'company' | 'mine'>('company');
  if (!seesCompany)
    return (
      <>
        <PageHeader title={<IconTitle icon={<TrendingUp />}>My sales</IconTitle>} description="Log the sales you close, track your monthly totals and download your sales report." />
        <MySales />
      </>
    );
  return (
    <>
      <PageHeader title={<IconTitle icon={<TrendingUp />}>Sales</IconTitle>} description="Company sales from the uploaded sheet, and the sales each employee logs." />
      {hasEmployee && (
        <Tabs
          className="mb-4"
          tabs={[
            { key: 'company', label: 'Company & team' },
            { key: 'mine', label: 'My sales' },
          ]}
          active={tab}
          onChange={(k) => setTab(k as 'company' | 'mine')}
        />
      )}
      {hasEmployee && tab === 'mine' ? (
        <MySales />
      ) : (
        <div className="space-y-8">
          <CompanySales />
          <TeamSales />
        </div>
      )}
    </>
  );
};

/** Company sales: headline numbers, the monthly chart (with upload) and a month-by-month table. */
const CompanySales = () => {
  const [range, setRange] = useState<Range>(12);
  const q = useQuery({ queryKey: ['sales', 'monthly', range], queryFn: () => get<SalesMonthly>('/sales/monthly', { months: range }) });
  const months = q.data?.months ?? [];
  const withData = months.filter((m) => m.amount !== null);
  const total = withData.reduce((a, m) => a + (m.amount ?? 0), 0);
  const last = withData.at(-1);
  const prev = withData.at(-2);
  const lastChange = last && prev?.amount ? ((last.amount! - prev.amount) / Math.abs(prev.amount)) * 100 : null;
  const best = withData.reduce<(typeof withData)[number] | null>((b, m) => (!b || (m.amount ?? 0) > (b.amount ?? 0) ? m : b), null);
  const targeted = withData.filter((m) => m.target);
  const targetSum = targeted.reduce((a, m) => a + (m.target ?? 0), 0);
  const achieved = targetSum ? Math.round((targeted.reduce((a, m) => a + (m.amount ?? 0), 0) / targetSum) * 100) : null;

  // Table newest first, with the change vs the month before.
  const rows = [...months]
    .map((m, i) => {
      const before = months.slice(0, i).reverse().find((p) => p.amount !== null);
      const change = m.amount !== null && before?.amount ? ((m.amount - before.amount) / Math.abs(before.amount)) * 100 : null;
      const ach = m.amount !== null && m.target ? Math.round((m.amount / m.target) * 100) : null;
      return { ...m, change, ach };
    })
    .reverse();

  return (
    <>
      <div className="space-y-4">
        {/* Headline numbers */}
        {q.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : q.data?.hasData ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat icon={<IndianRupee className="h-5 w-5" />} tone="bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300" label={`Total · last ${range} months`} value={inr(total)} sub={inrFull(total)} />
            <Stat
              icon={<CalendarRange className="h-5 w-5" />}
              tone="bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300"
              label={last ? formatKey(`${last.month}-01`, 'MMMM yyyy') : 'Latest month'}
              value={inr(last?.amount)}
              sub={
                lastChange !== null ? (
                  <span className={cn('inline-flex items-center gap-0.5 font-semibold', lastChange >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                    {lastChange >= 0 ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />}
                    {`${Math.abs(lastChange).toFixed(1)}% vs previous month`}
                  </span>
                ) : undefined
              }
            />
            <Stat icon={<Award className="h-5 w-5" />} tone="bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300" label="Best month" value={inr(best?.amount)} sub={best ? formatKey(`${best.month}-01`, 'MMMM yyyy') : undefined} />
            <Stat
              icon={<Target className="h-5 w-5" />}
              tone="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
              label="Target achieved"
              value={achieved !== null ? `${achieved}%` : '—'}
              sub={achieved !== null ? `of ${inr(targetSum)} target` : 'No targets in the sheet'}
            />
          </div>
        ) : null}

        {/* Chart (with the upload button) */}
        <SalesOverview />

        {/* Month by month */}
        {q.data?.hasData && (
          <Card className="overflow-hidden">
            <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-5 py-3">
              <h3 className="text-lg font-semibold text-fg">Month by month</h3>
              <div role="radiogroup" aria-label="Months" className="flex rounded-lg border border-line p-0.5">
                {([12, 24, 36] as Range[]).map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={range === n}
                    onClick={() => setRange(n)}
                    className={cn('rounded-md px-2.5 py-1 text-xs font-semibold', range === n ? 'bg-brand-600 text-white' : 'text-muted hover:text-fg')}
                  >
                    {`${n}M`}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs text-muted">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 text-left font-semibold">Month</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Sales</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Target</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Achievement</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-semibold">vs previous month</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.month} className="hover:bg-surface-2">
                      <td className="px-5 py-2.5 font-medium text-fg">{formatKey(`${r.month}-01`, 'MMMM yyyy')}</td>
                      <td className="px-4 py-2.5 text-right text-fg tabular-nums">{inrFull(r.amount)}</td>
                      <td className="px-4 py-2.5 text-right text-fg-2 tabular-nums">{inrFull(r.target)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {r.ach !== null ? (
                          <span
                            className={cn(
                              'inline-flex min-w-14 justify-center rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums',
                              r.ach >= 100
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                                : r.ach >= 80
                                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                                  : 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
                            )}
                          >
                            {`${r.ach}%`}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        {r.change !== null ? (
                          <span className={cn('inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums', r.change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                            {r.change >= 0 ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />}
                            {`${Math.abs(r.change).toFixed(1)}%`}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
};
