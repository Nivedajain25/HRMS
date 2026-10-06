import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { BarChart3, ExternalLink, FileSpreadsheet, FileText, FileType2, Lock } from 'lucide-react';
import type { ReportType } from '@stencil/shared';
import { FilterBar } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, PageHeader, Skeleton, type Tone } from '@/components/ui/display';
import { DateRangePicker, Select } from '@/components/ui/input';
import { useListParams } from '@/hooks/use-list-params';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import { useAllOf } from '@/features/employees/api';
import { exportReport, isReportType, REPORT_META, useReport, useReportList, type ExportFormat, type ReportCell, type ReportColumn, type ReportFilters, type ReportResult } from './api';
import { REPORT_ICONS } from './report-icons';

const FILTER_KEYS = ['from', 'to', 'departmentId', 'status'];

/** Keys whose values are enum codes (rendered with human labels). */
const ENUM_KEYS = new Set(['employmentType', 'category', 'condition', 'leaveType', 'workMode']);

/** Clock-in/out place labels from the attendance log report. */
const PLACE_KEYS = new Set(['checkInPlace', 'checkOutPlace']);
const PLACE_TONE: Record<string, Tone> = { 'At office': 'green', 'Outside office': 'amber' };

const keyLabel = (key: string) => label(key.replace(/([a-z0-9])([A-Z])/g, '$1_$2'));
const keyIso = (key: string) => `${key.slice(0, 10)}T00:00:00.000Z`;

const renderCell = (col: ReportColumn, value: ReportCell) => {
  if (value === null || value === undefined || value === '') return <span className="text-subtle">—</span>;
  if (col.type === 'number' && typeof value === 'number') return <span className="block text-right tabular-nums">{formatNumber(value, 2)}</span>;
  if (col.type === 'date' && typeof value === 'string') return formatDate(keyIso(value));
  if (col.key === 'status' && typeof value === 'string') return <StatusBadge status={value} />;
  if (ENUM_KEYS.has(col.key) && typeof value === 'string' && /^[A-Z_]+$/.test(value)) return label(value);
  if (PLACE_KEYS.has(col.key) && typeof value === 'string') return <Badge tone={PLACE_TONE[value] ?? 'gray'}>{value}</Badge>;
  if (typeof value === 'string' && value.startsWith('https://')) {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-brand-600 hover:underline dark:text-brand-400">
        Open map
        <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
    );
  }
  return String(value);
};

/* ------------------------------- Summary ------------------------------- */

const formatScalar = (v: unknown) => (typeof v === 'number' ? formatNumber(v, 2) : v === null || v === undefined ? '—' : String(v));

const SummaryBlock = ({ summary }: { summary: Record<string, unknown> }) => {
  const entries = Object.entries(summary);
  const scalars = entries.filter(([, v]) => v === null || typeof v !== 'object');
  const groups = entries.filter(([, v]) => v !== null && typeof v === 'object' && Object.keys(v as object).length > 0) as [string, Record<string, unknown>][];
  if (!scalars.length && !groups.length) return null;
  return (
    <section aria-label="Report summary" className="card p-4 sm:p-5">
      <h2 className="mb-3 text-sm font-semibold text-fg">Summary</h2>
      {scalars.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {scalars.map(([k, v]) => (
            <div key={k} className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
              <dt className="truncate text-xs font-medium text-muted">{keyLabel(k)}</dt>
              <dd className="mt-0.5 text-lg font-semibold text-fg tabular-nums">{formatScalar(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {groups.length > 0 && (
        <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', scalars.length > 0 && 'mt-4')}>
          {groups.map(([k, group]) => (
            <div key={k} className="min-w-0">
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{keyLabel(k)}</h3>
              <dl className="divide-y divide-line rounded-lg border border-line">
                {Object.entries(group).map(([gk, gv]) => (
                  <div key={gk} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                    <dt className="truncate text-fg-2">{keyLabel(gk)}</dt>
                    <dd className="shrink-0 font-medium text-fg tabular-nums">
                      {gv !== null && typeof gv === 'object'
                        ? Object.entries(gv as Record<string, unknown>)
                            .map(([ik, iv]) => `${keyLabel(ik)} ${formatScalar(iv)}`)
                            .join(' · ')
                        : formatScalar(gv)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

/* ------------------------------- Exports ------------------------------- */

const EXPORTS: { format: ExportFormat; label: string; icon: typeof FileText }[] = [
  { format: 'csv', label: 'CSV', icon: FileText },
  { format: 'xlsx', label: 'Excel', icon: FileSpreadsheet },
  { format: 'pdf', label: 'PDF', icon: FileType2 },
];

const ExportButtons = ({ type, filters, disabled }: { type: ReportType; filters: ReportFilters; disabled?: boolean }) => {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const run = async (format: ExportFormat) => {
    setBusy(format);
    try {
      await exportReport(type, filters, format);
      toast.success(`${format === 'xlsx' ? 'Excel' : format.toUpperCase()} export downloaded`);
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div role="group" aria-label="Export report" className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto">
      {EXPORTS.map(({ format, label: text, icon: Icon }) => (
        <Button
          key={format}
          variant="outline"
          icon={<Icon className="h-4 w-4" />}
          loading={busy === format}
          disabled={disabled || (!!busy && busy !== format)}
          onClick={() => run(format)}
          aria-label={`Export as ${text}`}
        >
          {text}
        </Button>
      ))}
    </div>
  );
};

/* -------------------------------- Page -------------------------------- */

const ReportView = ({ type }: { type: ReportType }) => {
  const reports = useReportList();
  const departments = useAllOf('departments');
  const { params, set, clear, hasFilters } = useListParams({ limit: 50 });
  const meta = REPORT_META[type];
  const info = reports.data?.find((r) => r.type === type);
  const available = !reports.data || !!info;

  const filters: ReportFilters = {
    from: (params.from as string | undefined) || undefined,
    to: (params.to as string | undefined) || undefined,
    departmentId: (params.departmentId as string | undefined) || undefined,
    status: (params.status as string | undefined) || undefined,
  };
  const query = { ...filters, page: params.page, limit: params.limit };
  const report = useReport(type, query, available);
  const data: ReportResult | undefined = report.data;
  const Icon = REPORT_ICONS[type].icon;

  const columns = useMemo<ColumnDef<Record<string, ReportCell>, unknown>[]>(
    () =>
      (data?.columns ?? []).map((col, i) => ({
        id: col.key,
        header: col.label,
        enableHiding: i > 1,
        cell: ({ row }) => renderCell(col, row.original[col.key] ?? null),
      })),
    [data?.columns],
  );

  if (!available) {
    return (
      <EmptyState
        className="card mt-6"
        icon={<Lock className="h-6 w-6" />}
        title="Report not available"
        description="Your role does not include access to this report."
        action={
          <Link to="/reports">
            <Button variant="outline">All reports</Button>
          </Link>
        }
      />
    );
  }

  const title = info?.title ?? data?.title ?? keyLabel(type);
  const rangeText = data?.range ? `${formatDate(keyIso(data.range.from))} – ${formatDate(keyIso(data.range.to))}` : null;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Reports', to: '/reports' }, { label: title }]}
        title={
          <span className="flex items-center gap-3">
            <span className={cn('hidden h-9 w-9 items-center justify-center rounded-lg sm:flex', REPORT_ICONS[type].tone)} aria-hidden>
              <Icon className="h-5 w-5" />
            </span>
            {title}
          </span>
        }
        description={info?.description}
        actions={<ExportButtons type={type} filters={filters} disabled={report.isLoading || !!report.error} />}
      />

      <div className="space-y-4">
        {data && <SummaryBlock summary={data.summary} />}
        {report.isLoading && <Skeleton className="h-28" />}

        <DataTable
          caption={`${title} preview`}
          storageKey={`report-${type}`}
          columns={columns}
          data={data?.rows}
          loading={report.isLoading || report.isFetching}
          error={report.error}
          onRetry={() => report.refetch()}
          pagination={data?.pagination}
          onPageChange={(page) => set({ page })}
          onLimitChange={(limit) => set({ limit })}
          emptyTitle="No rows for these filters"
          emptyDescription={hasFilters(FILTER_KEYS) ? 'Try widening the date range or clearing filters.' : 'There is no data for this report yet.'}
          toolbar={
            <div className="flex w-full flex-col gap-2">
              <FilterBar active={hasFilters(FILTER_KEYS)} onClear={() => clear(['limit'])}>
                {meta.dateLabel && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-muted">{meta.dateLabel}</span>
                    <DateRangePicker from={filters.from} to={filters.to} onChange={(r) => set({ from: r.from, to: r.to })} />
                  </div>
                )}
                <Select
                  aria-label="Department"
                  className="w-full sm:w-48"
                  value={filters.departmentId ?? ''}
                  onChange={(e) => set({ departmentId: e.target.value })}
                  options={(departments.data ?? []).map((d) => ({ value: d._id, label: d.name }))}
                  placeholder="All departments"
                />
                <Select
                  aria-label={meta.statusLabel}
                  className="w-full sm:w-48"
                  value={filters.status ?? ''}
                  onChange={(e) => set({ status: e.target.value })}
                  options={meta.statuses.map((s) => ({ value: s, label: label(s) }))}
                  placeholder={`Any ${meta.statusLabel.toLowerCase()}`}
                />
              </FilterBar>
              {(rangeText || data) && (
                <p className="text-xs text-muted">
                  {rangeText && <>Period {rangeText}{!filters.from && !filters.to ? ' (default range)' : ''} · </>}
                  {data ? `${formatNumber(data.pagination.total)} row${data.pagination.total === 1 ? '' : 's'}` : ''}
                  {data && data.pagination.total > data.rows.length ? ' · exports include every row' : ''}
                </p>
              )}
            </div>
          }
        />
      </div>
    </>
  );
};

export const ReportViewerPage = () => {
  const { type } = useParams<{ type: string }>();
  if (!isReportType(type)) {
    return (
      <EmptyState
        className="card mt-6"
        icon={<BarChart3 className="h-6 w-6" />}
        title="Unknown report"
        description="This report does not exist."
        action={
          <Link to="/reports">
            <Button variant="outline">All reports</Button>
          </Link>
        }
      />
    );
  }
  // Keyed so switching reports resets local state.
  return <ReportView key={type} type={type} />;
};
