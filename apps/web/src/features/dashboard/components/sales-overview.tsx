import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { FileSpreadsheet, IndianRupee, Loader2, TrendingDown, TrendingUp, Upload } from 'lucide-react';
import { ChartFrame, chartAxis, chartGrid, chartTooltip } from '@/components/charts/chart-kit';
import { Card } from '@/components/ui/display';
import { formatKey } from '@/features/attendance/lib';
import { get, toApiError, upload } from '@/lib/api';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { TitleIcon } from './widget';

interface SalesMonthly {
  months: { month: string; amount: number | null; target: number | null }[];
  hasData: boolean;
  lastUpdated: string | null;
}

/** ₹ in Indian short form: 85K · 12.5L · 1.2Cr */
const inr = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n);
  const s = a >= 1e7 ? `${(a / 1e7).toFixed(a >= 1e8 ? 0 : 2)}Cr` : a >= 1e5 ? `${(a / 1e5).toFixed(a >= 1e6 ? 1 : 2)}L` : a >= 1e3 ? `${Math.round(a / 1e3)}K` : String(Math.round(a));
  return `${n < 0 ? '-' : ''}₹${s.replace(/\.0+(?=[LCK]|r)/, '').replace(/(\.\d*[1-9])0+(?=[LCK])/, '$1')}`;
};
const inrFull = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** Monthly sales (from an uploaded Excel / CSV) as bars, with the target as a line; upload to add or update months. */
export const SalesOverview = ({ className }: { className?: string }) => {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canUpload = can('settings:manage');
  const [range, setRange] = useState<6 | 12>(12);
  const fileInput = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['sales', 'monthly', range], queryFn: () => get<SalesMonthly>('/sales/monthly', { months: range }) });
  const importer = useMutation({
    mutationFn: (file: File) => upload<{ imported: number; from: string; to: string; skippedRows: number[] }>('/sales/import', file),
    meta: { silent: true },
    onSuccess: (res) => {
      const r = res.data;
      toast.success(`Imported ${r.imported} month${r.imported === 1 ? '' : 's'}`, {
        description: `${formatKey(`${r.from}-01`, 'MMM yyyy')} – ${formatKey(`${r.to}-01`, 'MMM yyyy')}${r.skippedRows.length ? ` · skipped row${r.skippedRows.length === 1 ? '' : 's'} ${r.skippedRows.join(', ')}` : ''}`,
      });
      void qc.invalidateQueries({ queryKey: ['sales'] });
    },
    onError: (err) => toast.error('Could not import the sheet', { description: toApiError(err).message }),
  });

  const rows = (q.data?.months ?? []).map((m) => ({ ...m, label: formatKey(`${m.month}-01`, 'MMM yy') }));
  const withData = rows.filter((r) => r.amount !== null);
  const total = withData.reduce((a, r) => a + (r.amount ?? 0), 0);
  const last = withData.at(-1);
  const prev = withData.at(-2);
  const change = last && prev && prev.amount ? ((last.amount! - prev.amount) / Math.abs(prev.amount)) * 100 : null;
  const hasTarget = rows.some((r) => r.target !== null);

  return (
    <Card className={cn('flex flex-col overflow-hidden motion-safe:animate-fade-up', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 min-h-16 border-b border-line px-5 py-3.5">
        <h3 className="rounded-lg bg-indigo-200 px-2.5 py-0.5 text-base font-semibold text-black shadow-sm">
          <TitleIcon icon={IndianRupee} />
          Sales Overview
        </h3>
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="Range" className="flex rounded-lg border border-line p-0.5">
            {([6, 12] as const).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={range === n}
                onClick={() => setRange(n)}
                className={cn('rounded-md px-2.5 py-1 text-xs font-semibold', range === n ? 'bg-brand-600 text-white' : 'text-muted hover:text-fg')}
              >
                {n}M
              </button>
            ))}
          </div>
          {canUpload ? (
            <>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importer.mutate(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={importer.isPending}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
              >
                {importer.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Upload className="h-3.5 w-3.5" aria-hidden />}
                Upload sheet
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col px-5 pt-4 pb-4">
        {q.data?.hasData ? (
          <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-1">
            <div>
              <p className="text-xs text-muted">{`Total · last ${range} months`}</p>
              <p className="text-2xl font-bold text-fg tabular-nums">{inr(total)}</p>
            </div>
            {last ? (
              <div>
                <p className="text-xs text-muted">{formatKey(`${last.month}-01`, 'MMMM')}</p>
                <p className="flex items-center gap-1.5 text-sm font-semibold text-fg tabular-nums">
                  {inr(last.amount)}
                  {change !== null ? (
                    <span className={cn('inline-flex items-center gap-0.5 text-xs', change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                      {change >= 0 ? <TrendingUp className="h-3.5 w-3.5" aria-hidden /> : <TrendingDown className="h-3.5 w-3.5" aria-hidden />}
                      {`${Math.abs(change).toFixed(1)}%`}
                    </span>
                  ) : null}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {!q.isLoading && !q.error && !q.data?.hasData ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
            <FileSpreadsheet className="h-9 w-9 text-muted" aria-hidden />
            <p className="text-sm font-medium text-fg">No sales figures yet</p>
            <p className="max-w-xs text-xs text-muted">
              {canUpload
                ? 'Upload an Excel (.xlsx) or CSV sheet with a “Month” column and a “Sales” column (a “Target” column is optional).'
                : 'An admin can upload the monthly sales sheet.'}
            </p>
            {canUpload ? (
              <button type="button" onClick={() => fileInput.current?.click()} className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-2">
                <Upload className="h-3.5 w-3.5" aria-hidden />
                Upload sheet
              </button>
            ) : null}
          </div>
        ) : (
          <ChartFrame label={`Bar chart of monthly sales for the last ${range} months${hasTarget ? ', with target line' : ''}`} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} height={240}>
            <ComposedChart data={rows} margin={{ top: 8, right: 4, left: -4, bottom: 0 }}>
              <defs>
                <linearGradient id="sales-bar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="100%" stopColor="#818cf8" stopOpacity={0.55} />
                </linearGradient>
              </defs>
              <CartesianGrid {...chartGrid} />
              <XAxis dataKey="label" {...chartAxis} interval={range === 12 ? 1 : 0} />
              <YAxis {...chartAxis} width={52} tickFormatter={(v: number) => inr(v)} />
              <Tooltip {...chartTooltip} cursor={{ fill: 'var(--surface-2)' }} formatter={(v: number, name: string) => [v === null || v === undefined ? '—' : inrFull(v), name]} />
              <Bar dataKey="amount" name="Sales" fill="url(#sales-bar)" radius={[6, 6, 0, 0]} maxBarSize={28} />
              {hasTarget ? <Line type="monotone" dataKey="target" name="Target" stroke="#0e4b5f" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2.5 }} connectNulls /> : null}
            </ComposedChart>
          </ChartFrame>
        )}
        {q.data?.lastUpdated ? <p className="mt-2 text-right text-[11px] text-muted">{`Updated ${new Date(q.data.lastUpdated).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}</p> : null}
      </div>
    </Card>
  );
};
