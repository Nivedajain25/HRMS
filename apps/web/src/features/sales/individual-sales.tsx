import { useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { Building, CalendarRange, Download, Eye, IndianRupee, Pencil, Plus, Receipt, Search, Target, Trash2, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, DescriptionList, EmptyState, Skeleton } from '@/components/ui/display';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Drawer, Modal, useConfirm } from '@/components/ui/overlay';
import { FormError, FormField } from '@/components/forms/form';
import { formatKey } from '@/features/attendance/lib';
import { del, get, getPaged, patch, post, put, toApiError } from '@/lib/api';
import { cn, fullName, toDateKey } from '@/lib/utils';

/* -------------------------------- Types & helpers -------------------------------- */

interface SalePerson {
  _id: string;
  employeeId?: string;
  firstName?: string;
  lastName?: string;
  profilePhoto?: string | null;
  departmentId?: { name?: string } | null;
}
export interface SaleEntry {
  _id: string;
  date: string;
  customer: string;
  amount: number;
  note?: string;
  employeeId: SalePerson | string;
}
const MEETING_TYPES = { OFFICE_VISIT: 'Office visit', SITE_VISIT: 'Site visit', SHOWROOM_VISIT: 'Showroom visit', CALL: 'Phone call', VIDEO_CALL: 'Video call', EVENT: 'Event / exhibition' } as const;
const MEETING_OUTCOMES = {
  INTERESTED: 'Interested',
  QUOTATION_REQUESTED: 'Quotation requested',
  SAMPLE_REQUESTED: 'Sample requested',
  FOLLOW_UP: 'Follow-up needed',
  ORDER_EXPECTED: 'Order expected',
  NOT_INTERESTED: 'Not interested',
} as const;
type MeetingType = keyof typeof MEETING_TYPES;
type MeetingOutcome = keyof typeof MEETING_OUTCOMES;
const OUTCOME_TONE: Record<MeetingOutcome, 'green' | 'blue' | 'purple' | 'amber' | 'teal' | 'gray'> = {
  INTERESTED: 'blue',
  QUOTATION_REQUESTED: 'purple',
  SAMPLE_REQUESTED: 'teal',
  FOLLOW_UP: 'amber',
  ORDER_EXPECTED: 'green',
  NOT_INTERESTED: 'gray',
};

export interface ArchitectMeeting {
  _id: string;
  date: string;
  architectName: string;
  firm?: string;
  phone?: string;
  email?: string;
  meetingType?: MeetingType | null;
  projectName?: string;
  location?: string;
  productsDiscussed?: string;
  outcome?: MeetingOutcome | null;
  followUpDate?: string | null;
  notes?: string;
  createdAt?: string;
  employeeId: SalePerson | string;
}
interface SalesSummary {
  total: number;
  count: number;
  customers: number;
  architects: number;
  months: { month: string; amount: number; count: number; target: number | null; architects: number }[];
  leaderboard: { employee: SalePerson | null; amount: number; count: number; last: string }[];
}
type Scope = 'me' | 'all';

/** ₹ in Indian short form: 85K · 12.5L · 1.2Cr */
export const inr = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n);
  const s = a >= 1e7 ? `${(a / 1e7).toFixed(2)}Cr` : a >= 1e5 ? `${(a / 1e5).toFixed(2)}L` : a >= 1e3 ? `${Math.round(a / 1e3)}K` : String(Math.round(a));
  return `${n < 0 ? '-' : ''}₹${s.replace(/\.00(?=[LC])/, '').replace(/(\.\d)0(?=[LC])/, '$1')}`;
};
export const inrFull = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`);

const person = (e: SaleEntry['employeeId']) => (typeof e === 'object' ? e : null);
const monthKey = (d: Date) => toDateKey(d).slice(0, 7);

/** Date ranges for the period pickers (YYYY-MM-DD keys, inclusive). */
type Period = 'month' | 'last' | 'quarter' | 'year' | 'all';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: 'last', label: 'Last month' },
  { key: 'quarter', label: 'Last 3 months' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
];
const periodRange = (p: Period): { from?: string; to?: string } => {
  const now = new Date();
  const first = (y: number, m: number) => toDateKey(new Date(y, m, 1));
  const last = (y: number, m: number) => toDateKey(new Date(y, m + 1, 0));
  const y = now.getFullYear();
  const m = now.getMonth();
  if (p === 'month') return { from: first(y, m), to: toDateKey(now) };
  if (p === 'last') return { from: first(y, m - 1), to: last(y, m - 1) };
  if (p === 'quarter') return { from: first(y, m - 2), to: toDateKey(now) };
  if (p === 'year') return { from: first(y, 0), to: toDateKey(now) };
  return {};
};

const keys = {
  all: ['sale-entries'] as const,
  list: (scope: Scope, params: object) => ['sale-entries', 'list', scope, params] as const,
  summary: (scope: Scope, params: object) => ['sale-entries', 'summary', scope, params] as const,
};

const useSummary = (scope: Scope, params: { from?: string; to?: string; months?: number }) =>
  useQuery({ queryKey: keys.summary(scope, params), queryFn: () => get<SalesSummary>('/sales/entries/summary', { scope, ...params }), placeholderData: keepPreviousData });

const esc = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Every row of a paged list in the range (500 a page). */
const fetchAll = async <T,>(url: string, params: object) => {
  const rows: T[] = [];
  for (let page = 1; page < 100; page++) {
    const res = await getPaged<T>(url, { ...params, page, limit: 500 });
    rows.push(...res.data);
    if (page >= res.pagination.totalPages) break;
  }
  return rows;
};

const saveCsv = (lines: unknown[][], fileName: string) => {
  const blob = new Blob(['﻿' + lines.map((l) => l.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Architect meetings in the range as a CSV download. */
const downloadMeetingsCsv = async (scope: Scope, range: { from?: string; to?: string }, fileName: string) => {
  const rows = await fetchAll<ArchitectMeeting>('/sales/architects', { scope, ...range });
  const all = scope === 'all';
  const header = [
    ...(all ? ['Employee', 'Employee ID', 'Department'] : []),
    'Date',
    'Meeting type',
    'Architect',
    'Firm',
    'Phone',
    'Email',
    'Project',
    'Site / location',
    'Products discussed',
    'Outcome',
    'Follow-up date',
    'Description',
  ];
  const lines = rows.map((r) => {
    const p = person(r.employeeId);
    return [
      ...(all ? [fullName(p), p?.employeeId, p?.departmentId?.name] : []),
      r.date,
      r.meetingType ? MEETING_TYPES[r.meetingType] : '',
      r.architectName,
      r.firm,
      r.phone,
      r.email,
      r.projectName,
      r.location,
      r.productsDiscussed,
      r.outcome ? MEETING_OUTCOMES[r.outcome] : '',
      r.followUpDate ?? '',
      r.notes,
    ];
  });
  saveCsv([header, ...lines, [], ['Total architects met', rows.length]], fileName);
  return rows.length;
};

/** Every entry in the range (500 a page) as a CSV download. */
const downloadCsv = async (scope: Scope, range: { from?: string; to?: string }, fileName: string) => {
  const rows = await fetchAll<SaleEntry>('/sales/entries', { scope, ...range });
  const header = scope === 'all' ? ['Date', 'Employee', 'Employee ID', 'Department', 'Customer', 'Amount', 'Note'] : ['Date', 'Customer', 'Amount', 'Note'];
  const lines: unknown[][] = rows.map((r) => {
    const p = person(r.employeeId);
    return scope === 'all' ? [r.date, fullName(p), p?.employeeId, p?.departmentId?.name, r.customer, r.amount, r.note] : [r.date, r.customer, r.amount, r.note];
  });
  const total = rows.reduce((a, r) => a + r.amount, 0);
  lines.push([], scope === 'all' ? ['Total', '', '', '', `${rows.length} sales`, total, ''] : ['Total', `${rows.length} sales`, total, '']);
  saveCsv([header, ...lines], fileName);
  return rows.length;
};

/* -------------------------------- Small pieces -------------------------------- */

const Stat = ({ icon, tone, label, value, sub }: { icon: ReactNode; tone: string; label: string; value: string; sub?: ReactNode }) => (
  <Card className="flex items-center gap-4 p-4">
    <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', tone)} aria-hidden>
      {icon}
    </span>
    <span className="min-w-0">
      <span className="block text-xs font-medium text-muted">{label}</span>
      <span className="block text-2xl font-bold text-fg tabular-nums">{value}</span>
      {sub ? <span className="block truncate text-xs text-muted">{sub}</span> : null}
    </span>
  </Card>
);

const CardHead = ({ title, children }: { title: ReactNode; children?: ReactNode }) => (
  <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
    <h3 className="text-lg font-semibold text-fg">{title}</h3>
    {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
  </div>
);

const PeriodPicker = ({ value, onChange }: { value: Period; onChange: (p: Period) => void }) => (
  <div role="radiogroup" aria-label="Period" className="flex flex-wrap rounded-lg border border-line p-0.5">
    {PERIODS.map((p) => (
      <button
        key={p.key}
        type="button"
        role="radio"
        aria-checked={value === p.key}
        onClick={() => onChange(p.key)}
        className={cn('rounded-md px-2.5 py-1 text-xs font-semibold', value === p.key ? 'bg-brand-600 text-white' : 'text-muted hover:text-fg')}
      >
        {p.label}
      </button>
    ))}
  </div>
);

const MonthlyChart = ({ data, loading }: { data: SalesSummary['months']; loading: boolean }) => {
  const hasTarget = data.some((d) => d.target);
  return (
    <Card className="overflow-hidden">
      <CardHead title="Target vs achieved">
        <span className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-brand-500" aria-hidden />
            Achieved
          </span>
          {hasTarget && (
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 border-t-2 border-dashed border-amber-500" aria-hidden />
              Target
            </span>
          )}
        </span>
      </CardHead>
      <div className="h-72 px-3 py-4">
        {loading ? (
          <Skeleton className="h-full w-full rounded-lg" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.map((d) => ({ ...d, label: formatKey(`${d.month}-01`, 'MMM yy') }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-line)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--color-muted)' }} />
              <YAxis tickLine={false} axisLine={false} width={56} tick={{ fontSize: 12, fill: 'var(--color-muted)' }} tickFormatter={(v: number) => inr(v)} />
              <ChartTooltip
                cursor={{ fill: 'var(--color-surface-3)' }}
                contentStyle={{ borderRadius: 10, border: '1px solid var(--color-line)', background: 'var(--color-surface)', fontSize: 12 }}
                formatter={(v: number, name, item) => {
                  const p = item.payload as SalesSummary['months'][number];
                  if (name === 'target') return [inrFull(v), 'Target'];
                  return [`${inrFull(v)} · ${p.count} sales${p.target ? ` · ${Math.round((p.amount / p.target) * 100)}%` : ''}`, 'Achieved'];
                }}
              />
              <Bar dataKey="amount" name="amount" radius={[6, 6, 0, 0]} fill="var(--color-brand-500)" maxBarSize={36} />
              {hasTarget && <Line dataKey="target" name="target" type="monotone" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} connectNulls={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
};

/** Achieved vs target as a bar with %. */
export const TargetProgress = ({ achieved, target, className }: { achieved: number; target: number | null; className?: string }) => {
  if (!target) return <span className={cn('text-xs text-muted', className)}>No target</span>;
  const pct = Math.round((achieved / target) * 100);
  const tone = pct >= 100 ? 'bg-emerald-500' : pct >= 75 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <span className={cn('flex min-w-28 items-center gap-2', className)}>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
        <span className={cn('block h-full rounded-full', tone)} style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className={cn('w-10 text-right text-xs font-semibold tabular-nums', pct >= 100 ? 'text-emerald-600 dark:text-emerald-400' : pct >= 75 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400')}>{`${pct}%`}</span>
    </span>
  );
};

/* -------------------------------- Add / edit -------------------------------- */

const SaleDialog = ({ open, onClose, entry }: { open: boolean; onClose: () => void; entry?: SaleEntry | null }) => {
  const qc = useQueryClient();
  const [form, setForm] = useState({ date: '', customer: '', amount: '', note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [openedFor, setOpenedFor] = useState<string | null>(null);

  // Reset the form each time the dialog opens (for a new sale or a different entry).
  const marker = open ? (entry?._id ?? 'new') : null;
  if (marker !== openedFor) {
    setOpenedFor(marker);
    if (open) {
      setForm(entry ? { date: entry.date, customer: entry.customer, amount: String(entry.amount), note: entry.note ?? '' } : { date: toDateKey(new Date()), customer: '', amount: '', note: '' });
      setErrors({});
      setBanner(null);
    }
  }

  const save = useMutation({
    mutationFn: () => {
      const body = { date: form.date, customer: form.customer.trim(), amount: Number(form.amount), note: form.note.trim() || undefined };
      return entry ? patch(`/sales/entries/${entry._id}`, body) : post('/sales/entries', body);
    },
    onSuccess: () => {
      toast.success(entry ? 'Sale updated' : 'Sale added');
      qc.invalidateQueries({ queryKey: keys.all });
      onClose();
    },
    onError: (err) => {
      const e = toApiError(err);
      const fe: Record<string, string> = {};
      for (const f of e.fieldErrors) if (f.path) fe[f.path.split('.')[0]!] = f.message;
      setErrors(fe);
      setBanner(Object.keys(fe).length ? null : e.message);
    },
  });

  const submit = () => {
    const fe: Record<string, string> = {};
    if (!form.date) fe.date = 'Pick the sale date';
    else if (form.date > toDateKey(new Date())) fe.date = 'The sale date can’t be in the future';
    if (!form.customer.trim()) fe.customer = 'Enter the customer';
    if (!(Number(form.amount) > 0)) fe.amount = 'Amount must be more than 0';
    setErrors(fe);
    if (!Object.keys(fe).length) save.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={entry ? 'Edit sale' : 'Add a sale'}
      description={entry ? undefined : 'Record a sale you closed — it counts towards your totals and the company report.'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            {entry ? 'Save changes' : 'Add sale'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormError error={banner} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Date" required error={errors.date}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} type="date" max={toDateKey(new Date())} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} aria-describedby={describedBy} aria-invalid={invalid} />
            )}
          </FormField>
          <FormField label="Amount (₹)" required error={errors.amount}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                placeholder="e.g. 25000"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                data-autofocus={entry ? undefined : true}
              />
            )}
          </FormField>
        </div>
        <FormField label="Customer" required error={errors.customer}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} maxLength={150} placeholder="Customer or company name" value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} aria-describedby={describedBy} aria-invalid={invalid} />
          )}
        </FormField>
        <FormField label="Note" error={errors.note} hint="Optional — product, invoice number, anything useful.">
          {({ id, describedBy }) => <Textarea id={id} rows={3} maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} aria-describedby={describedBy} />}
        </FormField>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
};

/* -------------------------------- Entries table -------------------------------- */

const PAGE_SIZE = 20;

const EntriesCard = ({ scope, title, period, onPeriod, onAdd, onEdit, fileName }: { scope: Scope; title: string; period: Period; onPeriod: (p: Period) => void; onAdd?: () => void; onEdit: (e: SaleEntry) => void; fileName: string }) => {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const range = periodRange(period);
  const params = { ...range, search: search.trim() || undefined, page, limit: PAGE_SIZE };
  const q = useQuery({ queryKey: keys.list(scope, params), queryFn: () => getPaged<SaleEntry>('/sales/entries', { scope, ...params }), placeholderData: keepPreviousData });
  const rows = q.data?.data ?? [];
  const pg = q.data?.pagination;
  const showEmployee = scope === 'all';

  const remove = useMutation({
    mutationFn: (id: string) => del(`/sales/entries/${id}`),
    onSuccess: () => {
      toast.success('Sale deleted');
      qc.invalidateQueries({ queryKey: keys.all });
    },
    onError: (e) => toast.error(toApiError(e).message),
  });

  const onDelete = async (e: SaleEntry) => {
    const { confirmed } = await confirm({ title: 'Delete this sale?', message: `${e.customer} · ${inrFull(e.amount)} on ${formatKey(e.date)}`, confirmLabel: 'Delete' });
    if (confirmed) remove.mutate(e._id);
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const n = await downloadCsv(scope, range, `${fileName}-${period}.csv`);
      toast.success(n ? `Report downloaded — ${n} sales` : 'Report downloaded — no sales in this period');
    } catch (e) {
      toast.error(toApiError(e).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHead title={title}>
        <PeriodPicker
          value={period}
          onChange={(p) => {
            onPeriod(p);
            setPage(1);
          }}
        />
        <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" />} loading={exporting} onClick={onExport}>
          Download report
        </Button>
        {onAdd ? (
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={onAdd}>
            Add sale
          </Button>
        ) : null}
      </CardHead>
      <div className="border-b border-line px-5 py-3">
        <Input
          className="max-w-sm"
          leftIcon={<Search className="h-4 w-4" />}
          placeholder="Search customer or note"
          aria-label="Search sales"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {q.isLoading ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          className="py-12"
          icon={<Receipt className="h-6 w-6" />}
          title={search ? 'No sales match your search' : 'No sales in this period'}
          description={onAdd && !search ? 'Add your first sale to start building your report.' : undefined}
          action={
            onAdd && !search ? (
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={onAdd}>
                Add sale
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th scope="col" className="px-5 py-2.5 text-left font-semibold">Date</th>
                {showEmployee && <th scope="col" className="px-4 py-2.5 text-left font-semibold">Employee</th>}
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">Customer</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Amount</th>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">Note</th>
                <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const p = person(r.employeeId);
                return (
                  <tr key={r._id} className="hover:bg-surface-2">
                    <td className="whitespace-nowrap px-5 py-2.5 text-fg">{formatKey(r.date)}</td>
                    {showEmployee && (
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2">
                          <Avatar name={fullName(p)} src={p?.profilePhoto} size="xs" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-fg">{fullName(p) || '—'}</span>
                            {p?.departmentId?.name ? <span className="block truncate text-xs text-muted">{p.departmentId.name}</span> : null}
                          </span>
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-2.5 font-medium text-fg">{r.customer}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-fg tabular-nums">{inrFull(r.amount)}</td>
                    <td className="max-w-xs truncate px-4 py-2.5 text-fg-2" title={r.note}>
                      {r.note || <span className="text-muted">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-5 py-2 text-right">
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit sale to ${r.customer}`} onClick={() => onEdit(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete sale to ${r.customer}`} onClick={() => onDelete(r)}>
                        <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pg && pg.totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-muted">
          <span>{`Page ${pg.page} of ${pg.totalPages} · ${pg.total} sales`}</span>
          <span className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pg.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </span>
        </div>
      )}
    </Card>
  );
};

/* -------------------------------- Architect meetings -------------------------------- */

const MeetingDialog = ({ open, onClose, entry }: { open: boolean; onClose: () => void; entry?: ArchitectMeeting | null }) => {
  const qc = useQueryClient();
  const blank = {
    date: '',
    meetingType: '',
    architectName: '',
    firm: '',
    phone: '',
    email: '',
    projectName: '',
    location: '',
    productsDiscussed: '',
    outcome: '',
    followUpDate: '',
    notes: '',
  };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [openedFor, setOpenedFor] = useState<string | null>(null);

  const marker = open ? (entry?._id ?? 'new') : null;
  if (marker !== openedFor) {
    setOpenedFor(marker);
    if (open) {
      setForm(
        entry
          ? {
              date: entry.date,
              meetingType: entry.meetingType ?? '',
              architectName: entry.architectName,
              firm: entry.firm ?? '',
              phone: entry.phone ?? '',
              email: entry.email ?? '',
              projectName: entry.projectName ?? '',
              location: entry.location ?? '',
              productsDiscussed: entry.productsDiscussed ?? '',
              outcome: entry.outcome ?? '',
              followUpDate: entry.followUpDate ?? '',
              notes: entry.notes ?? '',
            }
          : { ...blank, date: toDateKey(new Date()) },
      );
      setErrors({});
      setBanner(null);
    }
  }

  const save = useMutation({
    mutationFn: () => {
      // Empty text is sent as '' so an edit can clear a field.
      const t = (v: string) => v.trim();
      const body = {
        date: form.date,
        architectName: t(form.architectName),
        meetingType: form.meetingType,
        firm: t(form.firm),
        phone: t(form.phone),
        email: t(form.email),
        projectName: t(form.projectName),
        location: t(form.location),
        productsDiscussed: t(form.productsDiscussed),
        outcome: form.outcome,
        followUpDate: form.followUpDate,
        notes: t(form.notes),
      };
      return entry ? patch(`/sales/architects/${entry._id}`, body) : post('/sales/architects', body);
    },
    onSuccess: () => {
      toast.success(entry ? 'Meeting updated' : 'Meeting added');
      qc.invalidateQueries({ queryKey: keys.all });
      onClose();
    },
    onError: (err) => {
      const e = toApiError(err);
      const fe: Record<string, string> = {};
      for (const f of e.fieldErrors) if (f.path) fe[f.path.split('.')[0]!] = f.message;
      setErrors(fe);
      setBanner(Object.keys(fe).length ? null : e.message);
    },
  });

  const submit = () => {
    const fe: Record<string, string> = {};
    if (!form.date) fe.date = 'Pick the meeting date';
    else if (form.date > toDateKey(new Date())) fe.date = 'The meeting date can’t be in the future';
    if (!form.architectName.trim()) fe.architectName = 'Enter the architect’s name';
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) fe.email = 'Enter a valid email';
    if (form.followUpDate && form.date && form.followUpDate < form.date) fe.followUpDate = 'Follow-up can’t be before the meeting';
    setErrors(fe);
    if (!Object.keys(fe).length) save.mutate();
  };

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const section = 'text-xs font-semibold tracking-wide text-muted uppercase';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={entry ? 'Edit architect meeting' : 'Log an architect meeting'}
      description="Record who you met, about which project, what was discussed and what happens next."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            {entry ? 'Save changes' : 'Add meeting'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormError error={banner} />

        <p className={section}>Meeting</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Date" required error={errors.date}>
            {({ id, invalid }) => <Input id={id} type="date" max={toDateKey(new Date())} aria-invalid={invalid} value={form.date} onChange={set('date')} />}
          </FormField>
          <FormField label="Meeting type" error={errors.meetingType}>
            {({ id }) => <Select id={id} placeholder="Choose type" value={form.meetingType} onChange={set('meetingType')} options={Object.entries(MEETING_TYPES).map(([value, label]) => ({ value, label }))} />}
          </FormField>
        </div>

        <p className={section}>Architect</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Architect name" required error={errors.architectName}>
            {({ id, invalid }) => <Input id={id} aria-invalid={invalid} maxLength={150} placeholder="e.g. Ar. Priya Mehra" value={form.architectName} onChange={set('architectName')} data-autofocus={entry ? undefined : true} />}
          </FormField>
          <FormField label="Firm" error={errors.firm}>
            {({ id }) => <Input id={id} maxLength={150} placeholder="Architecture / interior firm" value={form.firm} onChange={set('firm')} />}
          </FormField>
          <FormField label="Phone" error={errors.phone}>
            {({ id }) => <Input id={id} type="tel" maxLength={30} value={form.phone} onChange={set('phone')} />}
          </FormField>
          <FormField label="Email" error={errors.email}>
            {({ id, invalid }) => <Input id={id} type="email" maxLength={150} aria-invalid={invalid} value={form.email} onChange={set('email')} />}
          </FormField>
        </div>

        <p className={section}>Project</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Project name" error={errors.projectName}>
            {({ id }) => <Input id={id} maxLength={200} placeholder="e.g. Sharma residence, ABC office" value={form.projectName} onChange={set('projectName')} />}
          </FormField>
          <FormField label="Site / location" error={errors.location}>
            {({ id }) => <Input id={id} maxLength={200} placeholder="Area, city" value={form.location} onChange={set('location')} />}
          </FormField>
        </div>
        <FormField label="Products discussed" error={errors.productsDiscussed}>
          {({ id }) => <Input id={id} maxLength={500} placeholder="e.g. facade panels, louvers, ceiling" value={form.productsDiscussed} onChange={set('productsDiscussed')} />}
        </FormField>

        <p className={section}>Result</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Outcome" error={errors.outcome}>
            {({ id }) => <Select id={id} placeholder="Choose outcome" value={form.outcome} onChange={set('outcome')} options={Object.entries(MEETING_OUTCOMES).map(([value, label]) => ({ value, label }))} />}
          </FormField>
          <FormField label="Follow-up date" error={errors.followUpDate}>
            {({ id, invalid }) => <Input id={id} type="date" min={form.date || undefined} aria-invalid={invalid} value={form.followUpDate} onChange={set('followUpDate')} />}
          </FormField>
        </div>
        <FormField label="Description" error={errors.notes} hint="What was discussed, requirements, quantities, budget, timelines, next steps.">
          {({ id }) => <Textarea id={id} rows={5} maxLength={3000} value={form.notes} onChange={set('notes')} />}
        </FormField>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
};

const MeetingsCard = ({ scope, period, onPeriod, fileName }: { scope: Scope; period: Period; onPeriod: (p: Period) => void; fileName: string }) => {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; entry: ArchitectMeeting | null }>({ open: false, entry: null });
  const [viewing, setViewing] = useState<ArchitectMeeting | null>(null);
  const range = periodRange(period);
  const params = { ...range, search: search.trim() || undefined, page, limit: PAGE_SIZE };
  const q = useQuery({ queryKey: ['sale-entries', 'architects', scope, params], queryFn: () => getPaged<ArchitectMeeting>('/sales/architects', { scope, ...params }), placeholderData: keepPreviousData });
  const rows = q.data?.data ?? [];
  const pg = q.data?.pagination;
  const all = scope === 'all';
  const canAdd = scope === 'me';

  const remove = useMutation({
    mutationFn: (id: string) => del(`/sales/architects/${id}`),
    onSuccess: () => {
      toast.success('Meeting deleted');
      qc.invalidateQueries({ queryKey: keys.all });
    },
    onError: (e) => toast.error(toApiError(e).message),
  });

  const onDelete = async (m: ArchitectMeeting) => {
    const { confirmed } = await confirm({ title: 'Delete this meeting?', message: `${m.architectName}${m.firm ? ` (${m.firm})` : ''} on ${formatKey(m.date)}`, confirmLabel: 'Delete' });
    if (confirmed) remove.mutate(m._id);
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const n = await downloadMeetingsCsv(scope, range, `${fileName}-${period}.csv`);
      toast.success(n ? `Report downloaded — ${n} meetings` : 'Report downloaded — no meetings in this period');
    } catch (e) {
      toast.error(toApiError(e).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHead title={<span>{all ? 'Architects met — everyone' : 'Architects met'}<span className="ml-2 text-sm font-normal text-muted tabular-nums">{pg ? pg.total : ''}</span></span>}>
        <PeriodPicker
          value={period}
          onChange={(p) => {
            onPeriod(p);
            setPage(1);
          }}
        />
        <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" />} loading={exporting} onClick={onExport}>
          Download
        </Button>
        {canAdd && (
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setDialog({ open: true, entry: null })}>
            Add meeting
          </Button>
        )}
      </CardHead>
      <div className="border-b border-line px-5 py-3">
        <Input
          className="max-w-sm"
          leftIcon={<Search className="h-4 w-4" />}
          placeholder="Search architect, firm, project, products"
          aria-label="Search architect meetings"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {q.isLoading ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          className="py-12"
          icon={<Building className="h-6 w-6" />}
          title={search ? 'No meetings match your search' : 'No architect meetings in this period'}
          action={
            canAdd && !search ? (
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setDialog({ open: true, entry: null })}>
                Add meeting
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th scope="col" className="px-5 py-2.5 text-left font-semibold">Date</th>
                {all && <th scope="col" className="px-4 py-2.5 text-left font-semibold">Employee</th>}
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">Architect</th>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">Project</th>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">Outcome</th>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">Follow-up</th>
                <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const p = person(r.employeeId);
                const due = r.followUpDate && r.followUpDate <= toDateKey(new Date());
                return (
                  <tr key={r._id} className="cursor-pointer hover:bg-surface-2" onClick={() => setViewing(r)}>
                    <td className="whitespace-nowrap px-5 py-2.5">
                      <span className="block text-fg">{formatKey(r.date)}</span>
                      {r.meetingType ? <span className="block text-xs text-muted">{MEETING_TYPES[r.meetingType]}</span> : null}
                    </td>
                    {all && (
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2">
                          <Avatar name={fullName(p)} src={p?.profilePhoto} size="xs" />
                          <span className="truncate font-medium text-fg">{fullName(p) || '—'}</span>
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <span className="block font-medium text-fg">{r.architectName}</span>
                      {r.firm ? <span className="block truncate text-xs text-muted">{r.firm}</span> : null}
                    </td>
                    <td className="max-w-[14rem] px-4 py-2.5">
                      <span className="block truncate text-fg-2">{r.projectName || <span className="text-muted">—</span>}</span>
                      {r.location ? <span className="block truncate text-xs text-muted">{r.location}</span> : null}
                    </td>
                    <td className="px-4 py-2.5">{r.outcome ? <Badge tone={OUTCOME_TONE[r.outcome]}>{MEETING_OUTCOMES[r.outcome]}</Badge> : <span className="text-muted">—</span>}</td>
                    <td className={cn('whitespace-nowrap px-4 py-2.5', due ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-fg-2')}>{r.followUpDate ? formatKey(r.followUpDate, 'dd MMM') : <span className="font-normal text-muted">—</span>}</td>
                    <td className="whitespace-nowrap px-5 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon-sm" aria-label={`View meeting with ${r.architectName}`} onClick={() => setViewing(r)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit meeting with ${r.architectName}`} onClick={() => setDialog({ open: true, entry: r })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete meeting with ${r.architectName}`} onClick={() => onDelete(r)}>
                        <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pg && pg.totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-muted">
          <span>{`Page ${pg.page} of ${pg.totalPages} · ${pg.total} meetings`}</span>
          <span className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pg.totalPages} onClick={() => setPage((x) => x + 1)}>
              Next
            </Button>
          </span>
        </div>
      )}
      <MeetingDialog open={dialog.open} entry={dialog.entry} onClose={() => setDialog({ open: false, entry: null })} />
      <MeetingDetails
        meeting={viewing}
        showEmployee={all}
        onClose={() => setViewing(null)}
        onEdit={(m) => {
          setViewing(null);
          setDialog({ open: true, entry: m });
        }}
      />
    </Card>
  );
};

/** Everything recorded about one meeting. */
const MeetingDetails = ({ meeting: m, showEmployee, onClose, onEdit }: { meeting: ArchitectMeeting | null; showEmployee: boolean; onClose: () => void; onEdit: (m: ArchitectMeeting) => void }) => {
  const p = m ? person(m.employeeId) : null;
  return (
    <Drawer
      open={!!m}
      onClose={onClose}
      title={m ? `Meeting with ${m.architectName}` : ''}
      description={m ? [formatKey(m.date, 'EEEE, dd MMM yyyy'), m.meetingType ? MEETING_TYPES[m.meetingType] : null].filter(Boolean).join(' · ') : undefined}
      footer={
        m ? (
          <>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(m)}>
              Edit
            </Button>
          </>
        ) : undefined
      }
    >
      {m && (
        <div className="space-y-6">
          {m.outcome || m.followUpDate ? (
            <div className="flex flex-wrap items-center gap-2">
              {m.outcome && <Badge tone={OUTCOME_TONE[m.outcome]}>{MEETING_OUTCOMES[m.outcome]}</Badge>}
              {m.followUpDate && <Badge tone={m.followUpDate <= toDateKey(new Date()) ? 'amber' : 'gray'}>{`Follow up ${formatKey(m.followUpDate)}`}</Badge>}
            </div>
          ) : null}
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Architect</h3>
            <DescriptionList
              items={[
                { label: 'Name', value: m.architectName },
                { label: 'Firm', value: m.firm || '—' },
                { label: 'Phone', value: m.phone ? <a href={`tel:${m.phone}`} className="text-brand-600 hover:underline dark:text-brand-400">{m.phone}</a> : '—' },
                { label: 'Email', value: m.email ? <a href={`mailto:${m.email}`} className="break-all text-brand-600 hover:underline dark:text-brand-400">{m.email}</a> : '—' },
              ]}
            />
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Project</h3>
            <DescriptionList
              items={[
                { label: 'Project', value: m.projectName || '—' },
                { label: 'Site / location', value: m.location || '—' },
                { label: 'Products discussed', value: m.productsDiscussed || '—' },
                ...(showEmployee ? [{ label: 'Met by', value: fullName(p) || '—' }] : []),
              ]}
            />
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Description</h3>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-fg">{m.notes || <span className="text-muted">No description added.</span>}</p>
          </section>
        </div>
      )}
    </Drawer>
  );
};

/* -------------------------------- My sales (employee) -------------------------------- */

/** An employee's own sales: headline numbers, monthly chart, and their entries with add / edit / delete / report. */
export const MySales = () => {
  const [period, setPeriod] = useState<Period>('month');
  const [dialog, setDialog] = useState<{ open: boolean; entry: SaleEntry | null }>({ open: false, entry: null });
  const s = useSummary('me', { months: 12 });
  const months = s.data?.months ?? [];
  const now = new Date();
  const thisM = months.find((m) => m.month === monthKey(now));
  const lastM = months.find((m) => m.month === monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
  const year = months.filter((m) => m.month.startsWith(String(now.getFullYear())));
  const yearTotal = year.reduce((a, m) => a + m.amount, 0);
  const best = months.reduce<(typeof months)[number] | null>((b, m) => (m.amount > 0 && (!b || m.amount > b.amount) ? m : b), null);
  const change = thisM && lastM?.amount ? ((thisM.amount - lastM.amount) / lastM.amount) * 100 : null;
  const [meetPeriod, setMeetPeriod] = useState<Period>('month');
  const pct = thisM?.target ? Math.round((thisM.amount / thisM.target) * 100) : null;

  return (
    <div className="space-y-4">
      {s.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            icon={<Target className="h-5 w-5" />}
            tone="bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
            label="Target · this month"
            value={thisM?.target ? inr(thisM.target) : '—'}
            sub={thisM?.target ? <TargetProgress achieved={thisM.amount} target={thisM.target} className="mt-1" /> : 'No target set yet'}
          />
          <Stat
            icon={<IndianRupee className="h-5 w-5" />}
            tone="bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
            label="Achieved · this month"
            value={inr(thisM?.amount ?? 0)}
            sub={
              pct !== null
                ? `${pct}% of target · ${thisM?.count ?? 0} sales`
                : change !== null
                  ? `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}% vs last month · ${thisM?.count ?? 0} sales`
                  : `${thisM?.count ?? 0} sales`
            }
          />
          <Stat
            icon={<CalendarRange className="h-5 w-5" />}
            tone="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
            label={`This year (${now.getFullYear()})`}
            value={inr(yearTotal)}
            sub={`${year.reduce((a, m) => a + m.count, 0)} sales${best ? ` · best ${formatKey(`${best.month}-01`, 'MMM')}` : ''}`}
          />
          <Stat
            icon={<Building className="h-5 w-5" />}
            tone="bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300"
            label="Architects met · this month"
            value={String(thisM?.architects ?? 0)}
            sub={`${lastM?.architects ?? 0} last month · ${year.reduce((a, m) => a + m.architects, 0)} this year`}
          />
        </div>
      )}

      <MonthlyChart data={months} loading={s.isLoading} />

      <EntriesCard
        scope="me"
        title="My sales"
        period={period}
        onPeriod={setPeriod}
        fileName="my-sales"
        onAdd={() => setDialog({ open: true, entry: null })}
        onEdit={(entry) => setDialog({ open: true, entry })}
      />

      <MeetingsCard scope="me" period={meetPeriod} onPeriod={setMeetPeriod} fileName="my-architect-meetings" />

      <SaleDialog open={dialog.open} entry={dialog.entry} onClose={() => setDialog({ open: false, entry: null })} />
    </div>
  );
};

/* -------------------------------- Targets (HR / admin) -------------------------------- */

interface TargetRow {
  employee: SalePerson & { designationId?: { name?: string } | null };
  target: number | null;
  achieved: number;
  sales: number;
  percent: number | null;
  architects: number;
}
interface TargetBoard {
  month: string;
  rows: TargetRow[];
  targetTotal: number;
  achievedTotal: number;
  architectsTotal: number;
  canEdit: boolean;
}

/** Inline target input: saves on Enter / leaving the field. */
const TargetInput = ({ row, month }: { row: TargetRow; month: string }) => {
  const qc = useQueryClient();
  const [value, setValue] = useState(row.target ? String(row.target) : '');
  const [synced, setSynced] = useState(row.target);
  if (row.target !== synced) {
    setSynced(row.target);
    setValue(row.target ? String(row.target) : '');
  }
  const save = useMutation({
    mutationFn: (amount: number) => put('/sales/targets', { employeeId: row.employee._id, month, amount }),
    onSuccess: () => {
      toast.success(`Target saved for ${fullName(row.employee)}`);
      qc.invalidateQueries({ queryKey: keys.all });
    },
    onError: (e) => toast.error(toApiError(e).message),
  });
  const commit = () => {
    const amount = value.trim() === '' ? 0 : Number(value);
    if (Number.isNaN(amount) || amount < 0) return void toast.error('Enter a valid amount');
    if (amount === (row.target ?? 0)) return;
    save.mutate(amount);
  };
  return (
    <Input
      type="number"
      inputMode="decimal"
      min={0}
      step="any"
      placeholder="Set target"
      aria-label={`Target for ${fullName(row.employee)}`}
      className="h-8 w-32 text-right tabular-nums"
      value={value}
      disabled={save.isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
};

const thisMonthKey = () => toDateKey(new Date()).slice(0, 7);

/** Everyone's target vs achieved (and architects met) for a month; HR / admin type targets inline. */
const TargetsCard = () => {
  const [month, setMonth] = useState(thisMonthKey());
  const [onlyTargeted, setOnlyTargeted] = useState(false);
  const q = useQuery({ queryKey: ['sale-entries', 'targets', month], queryFn: () => get<TargetBoard>('/sales/targets', { month }), placeholderData: keepPreviousData });
  const data = q.data;
  const rows = (data?.rows ?? []).filter((r) => !onlyTargeted || r.target || r.achieved || r.architects).sort((a, b) => b.achieved - a.achieved || (b.target ?? 0) - (a.target ?? 0));
  const pct = data?.targetTotal ? Math.round((data.achievedTotal / data.targetTotal) * 100) : null;

  const exportCsv = () => {
    if (!data) return;
    const lines: unknown[][] = [['Employee', 'Employee ID', 'Department', 'Designation', 'Target', 'Achieved', 'Achieved %', 'Sales', 'Architects met']];
    for (const r of rows) lines.push([fullName(r.employee), r.employee.employeeId, r.employee.departmentId?.name, r.employee.designationId?.name, r.target ?? '', r.achieved, r.percent ?? '', r.sales, r.architects]);
    lines.push([], ['Total', '', '', '', data.targetTotal, data.achievedTotal, pct ?? '', '', data.architectsTotal]);
    saveCsv(lines, `sales-targets-${month}.csv`);
  };

  return (
    <Card className="overflow-hidden">
      <CardHead title="Targets & achievement">
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={onlyTargeted} onChange={(e) => setOnlyTargeted(e.target.checked)} />
          Only with activity
        </label>
        <Input type="month" aria-label="Month" className="h-8 w-40" value={month} max={thisMonthKey()} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!data}>
          Download
        </Button>
      </CardHead>
      {data && (
        <div className="grid gap-4 border-b border-line px-5 py-3 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted">Total target</p>
            <p className="text-lg font-semibold text-fg tabular-nums">{data.targetTotal ? inrFull(data.targetTotal) : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Achieved</p>
            <p className="text-lg font-semibold text-fg tabular-nums">{inrFull(data.achievedTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Achievement</p>
            <TargetProgress achieved={data.achievedTotal} target={data.targetTotal || null} className="mt-2" />
          </div>
          <div>
            <p className="text-xs text-muted">Architects met</p>
            <p className="text-lg font-semibold text-fg tabular-nums">{data.architectsTotal}</p>
          </div>
        </div>
      )}
      {q.isLoading ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState className="py-12" icon={<Target className="h-6 w-6" />} title={onlyTargeted ? 'No targets, sales or meetings this month' : 'No employees'} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th scope="col" className="px-5 py-2.5 text-left font-semibold">Employee</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Target</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Achieved</th>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">Achievement</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Sales</th>
                <th scope="col" className="px-5 py-2.5 text-right font-semibold">Architects met</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.employee._id} className="hover:bg-surface-2">
                  <td className="px-5 py-2">
                    <span className="flex items-center gap-2">
                      <Avatar name={fullName(r.employee)} src={r.employee.profilePhoto} size="xs" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-fg">{fullName(r.employee)}</span>
                        <span className="block truncate text-xs text-muted">{[r.employee.designationId?.name, r.employee.departmentId?.name].filter(Boolean).join(' · ') || r.employee.employeeId}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">{data?.canEdit ? <TargetInput row={r} month={month} /> : <span className="tabular-nums">{r.target ? inrFull(r.target) : '—'}</span>}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-semibold text-fg tabular-nums">{inrFull(r.achieved)}</td>
                  <td className="px-4 py-2">
                    <TargetProgress achieved={r.achieved} target={r.target} />
                  </td>
                  <td className="px-4 py-2 text-right text-fg-2 tabular-nums">{r.sales}</td>
                  <td className="px-5 py-2 text-right text-fg-2 tabular-nums">{r.architects}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data?.canEdit && <p className="border-t border-line px-5 py-2.5 text-xs text-muted">Type a target and press Enter to save. Clear the box to remove a target.</p>}
    </Card>
  );
};

/* -------------------------------- Team sales (HR / admin) -------------------------------- */

const RANK_TONE = ['bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300', 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300', 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300'];

/** Everyone's logged sales: totals, the per-employee leaderboard and every entry. */
export const TeamSales = () => {
  const [period, setPeriod] = useState<Period>('month');
  const [dialog, setDialog] = useState<{ open: boolean; entry: SaleEntry | null }>({ open: false, entry: null });
  const s = useSummary('all', { ...periodRange(period), months: 12 });
  const board = s.data?.leaderboard ?? [];
  const top = board[0]?.amount ?? 0;
  const label = PERIODS.find((p) => p.key === period)?.label ?? '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-fg">Team sales</h2>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<IndianRupee className="h-5 w-5" />} tone="bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300" label={`Logged sales · ${label}`} value={inr(s.data?.total ?? 0)} sub={inrFull(s.data?.total ?? 0)} />
        <Stat icon={<Receipt className="h-5 w-5" />} tone="bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300" label="Sales logged" value={String(s.data?.count ?? 0)} sub={`${s.data?.customers ?? 0} customers`} />
        <Stat icon={<Building className="h-5 w-5" />} tone="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" label={`Architects met · ${label}`} value={String(s.data?.architects ?? 0)} sub={`${board.length} employees selling`} />
        <Stat icon={<Trophy className="h-5 w-5" />} tone="bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300" label="Top seller" value={inr(board[0]?.amount ?? 0)} sub={board[0] ? fullName(board[0].employee) : 'No sales yet'} />
      </div>

      <TargetsCard />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="overflow-hidden">
          <CardHead title="Leaderboard" />
          {s.isLoading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : board.length === 0 ? (
            <EmptyState className="py-12" icon={<Trophy className="h-6 w-6" />} title="No sales logged in this period" />
          ) : (
            <ol className="divide-y divide-line">
              {board.map((r, i) => (
                <li key={r.employee?._id ?? i} className="flex items-center gap-3 px-5 py-3">
                  <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', RANK_TONE[i] ?? 'bg-surface-3 text-muted')}>{i + 1}</span>
                  <Avatar name={fullName(r.employee)} src={r.employee?.profilePhoto} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium text-fg">{fullName(r.employee) || 'Former employee'}</span>
                      <span className="shrink-0 font-semibold text-fg tabular-nums">{inrFull(r.amount)}</span>
                    </span>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-3">
                      <span className="block h-full rounded-full bg-brand-500" style={{ width: `${top ? Math.max(4, (r.amount / top) * 100) : 0}%` }} />
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted">{`${r.count} sales${r.employee?.departmentId?.name ? ` · ${r.employee.departmentId.name}` : ''} · last ${formatKey(r.last, 'dd MMM')}`}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <MonthlyChart data={s.data?.months ?? []} loading={s.isLoading} />
      </div>

      <EntriesCard scope="all" title="All logged sales" period={period} onPeriod={setPeriod} fileName="team-sales" onEdit={(entry) => setDialog({ open: true, entry })} />

      <MeetingsCard scope="all" period={period} onPeriod={setPeriod} fileName="team-architect-meetings" />

      <SaleDialog open={dialog.open} entry={dialog.entry} onClose={() => setDialog({ open: false, entry: null })} />
    </div>
  );
};
