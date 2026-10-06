import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Download, Lock } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Badge, DescriptionList, EmptyState, ErrorState, Skeleton } from '@/components/ui/display';
import { Drawer } from '@/components/ui/overlay';
import { downloadFile, toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { cn, formatDate, formatMoney } from '@/lib/utils';
import { usePayslip, type Payslip, type StructureLine } from '../api';
import { CALC_LABELS, formatDays, isForbidden, isPercent, periodLabel } from '../lib';

/* ------------------------------ Restricted ------------------------------ */

export const RestrictedState = ({ title = 'Restricted', description, className }: { title?: string; description?: string; className?: string }) => (
  <EmptyState
    icon={<Lock className="h-6 w-6" />}
    title={title}
    description={description ?? 'Salary information is confidential and only visible to the employee and authorized payroll staff.'}
    className={className}
  />
);

/** Error state that turns a 403 into a friendly "restricted" message. */
export const QueryError = ({ error, onRetry, restrictedText, className }: { error: Error; onRetry?: () => void; restrictedText?: string; className?: string }) =>
  isForbidden(error) ? <RestrictedState description={restrictedText} className={className} /> : <ErrorState message={error.message} onRetry={onRetry} className={className} />;

/* ------------------------------ Line lists ------------------------------ */

export interface MoneyLine {
  key: string;
  name: ReactNode;
  hint?: ReactNode;
  amount: number;
}

export const LineList = ({
  title,
  lines,
  total,
  totalLabel,
  currency,
  tone = 'default',
  empty = 'None',
}: {
  title: string;
  lines: MoneyLine[];
  total?: number;
  totalLabel?: string;
  currency: string;
  tone?: 'default' | 'negative' | 'muted';
  empty?: string;
}) => (
  <section aria-label={title} className="min-w-0">
    <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{title}</h4>
    {lines.length === 0 ? (
      <p className="rounded-lg border border-dashed border-line px-3 py-3 text-sm text-muted">{empty}</p>
    ) : (
      <dl className="divide-y divide-line rounded-lg border border-line">
        {lines.map((l) => (
          <div key={l.key} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
            <dt className="min-w-0">
              <span className="block break-words text-fg">{l.name}</span>
              {l.hint && <span className="block text-xs text-muted">{l.hint}</span>}
            </dt>
            <dd className={cn('shrink-0 font-medium tabular-nums', tone === 'negative' ? 'text-red-600 dark:text-red-400' : tone === 'muted' ? 'text-fg-2' : 'text-fg')}>
              {formatMoney(l.amount, currency)}
            </dd>
          </div>
        ))}
        {total !== undefined && (
          <div className="flex items-center justify-between gap-3 bg-surface-2 px-3 py-2.5 text-sm font-semibold text-fg">
            <dt>{totalLabel ?? 'Total'}</dt>
            <dd className="tabular-nums">{formatMoney(total, currency)}</dd>
          </div>
        )}
      </dl>
    )}
  </section>
);

const valueHint = (line: Pick<StructureLine, 'calculationType' | 'value'>, currency: string) => {
  if (line.calculationType === 'SLAB') return 'Slab-based';
  if (isPercent(line.calculationType)) return `${line.value}% ${line.calculationType === 'PERCENT_OF_BASIC' ? 'of basic' : 'of gross'}`;
  return `${CALC_LABELS.FIXED} · ${formatMoney(line.value, currency)}`;
};

/* --------------------------- Structure breakdown -------------------------- */

export const StructureBreakdown = ({
  basic,
  components,
  currency,
  gross,
  deductions,
  employer,
  net,
  ctc,
}: {
  basic: number;
  components: StructureLine[];
  currency: string;
  gross: number;
  deductions: number;
  employer: number;
  net: number;
  ctc: number;
}) => {
  const toLine = (c: StructureLine): MoneyLine => ({ key: `${c.componentId}-${c.code}`, name: c.name, hint: valueHint(c, currency), amount: c.monthlyAmount });
  const earningLines = components.filter((c) => c.type === 'EARNING' && !c.employerContribution);
  const hasBasicLine = earningLines.some((c) => c.code === 'BASIC');
  const earnings = [...(hasBasicLine ? [] : [{ key: 'BASIC', name: 'Basic salary', amount: basic }]), ...earningLines.map(toLine)];
  return (
    <div className="space-y-5">
      <SummaryStrip
        items={[
          { label: 'Monthly gross', value: formatMoney(gross, currency) },
          { label: 'Monthly deductions', value: formatMoney(deductions, currency) },
          { label: 'Monthly net', value: formatMoney(net, currency), strong: true },
          { label: 'Annual CTC', value: formatMoney(ctc, currency) },
        ]}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <LineList title="Earnings (monthly)" lines={earnings} total={gross} totalLabel="Gross" currency={currency} />
        <div className="space-y-5">
          <LineList title="Deductions (monthly)" lines={components.filter((c) => c.type === 'DEDUCTION' && !c.employerContribution).map(toLine)} total={deductions} currency={currency} tone="negative" />
          {employer > 0 && (
            <LineList
              title="Employer contributions (part of CTC)"
              lines={components.filter((c) => c.employerContribution).map(toLine)}
              total={employer}
              currency={currency}
              tone="muted"
            />
          )}
        </div>
      </div>
      <p className="text-xs text-muted">Monthly amounts assume a full month. Actual payslips are prorated for loss-of-pay days, joining and exit dates.</p>
    </div>
  );
};

export const SummaryStrip = ({ items }: { items: { label: string; value: ReactNode; strong?: boolean }[] }) => (
  <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
    {items.map((i) => (
      <div key={i.label} className={cn('bg-surface px-3 py-3', i.strong && 'bg-brand-50 dark:bg-brand-500/10')}>
        <dt className="text-xs text-muted">{i.label}</dt>
        <dd className={cn('mt-1 truncate text-sm font-semibold tabular-nums sm:text-base', i.strong ? 'text-brand-700 dark:text-brand-300' : 'text-fg')}>{i.value}</dd>
      </div>
    ))}
  </dl>
);

/* -------------------------------- Payslip -------------------------------- */

export const downloadPayslipPdf = async (slip: Pick<Payslip, '_id'> & Partial<Pick<Payslip, 'month' | 'year'>>) => {
  try {
    await downloadFile(`/payslips/${slip._id}/pdf`, undefined, `payslip-${slip.year ?? ''}-${String(slip.month ?? '').padStart(2, '0')}.pdf`);
  } catch (err) {
    toast.error(toApiError(err).message);
  }
};

export const PdfButton = ({ slip, size = 'sm', variant = 'outline', className, label: text = 'PDF' }: { slip: Pick<Payslip, '_id' | 'month' | 'year'>; size?: 'xs' | 'sm' | 'md'; variant?: 'outline' | 'primary' | 'ghost'; className?: string; label?: string }) => {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      loading={busy}
      icon={<Download className="h-4 w-4" />}
      aria-label={`Download payslip PDF for ${periodLabel(slip.month, slip.year)}`}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        await downloadPayslipPdf(slip);
        setBusy(false);
      }}
    >
      {text}
    </Button>
  );
};

const lineHint = (l: { category?: string }) =>
  l.category === 'ADJUSTMENT' ? 'One-time adjustment' : l.category === 'LOAN' ? 'Loan recovery' : l.category === 'ADVANCE' ? 'Advance recovery' : l.category === 'OVERTIME' ? 'Overtime' : undefined;

const toMoneyLines = (lines: Payslip['earnings'], prefix: string): MoneyLine[] =>
  lines.map((l, i) => ({ key: `${prefix}-${i}-${l.code}`, name: l.name || label(l.code), hint: lineHint(l), amount: l.amount }));

export const PayslipView = ({ slip }: { slip: Payslip }) => {
  const c = slip.currency;
  const employer = slip.employerContributions ?? [];
  const days: { label: string; value: string }[] = [
    { label: 'Days in period', value: formatDays(slip.daysInPeriod) },
    { label: 'Working days', value: formatDays(slip.workingDays) },
    { label: 'Payable days', value: formatDays(slip.payableDays) },
    { label: 'LOP days', value: formatDays(slip.lopDays) },
    { label: 'Present', value: formatDays(slip.presentDays) },
    { label: 'Paid leave', value: formatDays(slip.paidLeaveDays) },
    { label: 'Unpaid leave', value: formatDays(slip.unpaidLeaveDays) },
    { label: 'Absent', value: formatDays(slip.absentDays) },
    { label: 'Holidays', value: formatDays(slip.holidays) },
    { label: 'Week-offs', value: formatDays(slip.weekOffs) },
    ...(slip.notEmployedDays ? [{ label: 'Not employed', value: formatDays(slip.notEmployedDays) }] : []),
    ...(slip.overtimeHours ? [{ label: 'Overtime (h)', value: formatDays(slip.overtimeHours) }] : []),
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            {periodLabel(slip.month, slip.year)}
            {slip.payroll?.isOffCycle ? ' · Off-cycle' : ''}
          </p>
          <h3 className="mt-1 text-lg font-semibold text-fg">{slip.employeeSnapshot.name}</h3>
          <p className="text-sm text-muted">{[slip.employeeSnapshot.employeeId, slip.employeeSnapshot.designation, slip.employeeSnapshot.department].filter(Boolean).join(' · ')}</p>
          {slip.payroll?.periodStart && (
            <p className="mt-0.5 text-xs text-muted">
              Pay period {formatDate(slip.payroll.periodStart)} – {formatDate(slip.payroll.periodEnd)}
            </p>
          )}
        </div>
        <StatusBadge status={slip.status} />
      </div>

      <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-4 dark:border-brand-500/30 dark:bg-brand-500/10">
        <p className="text-xs font-medium text-brand-700 dark:text-brand-300">Net pay</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight text-fg tabular-nums">{formatMoney(slip.netPay, c)}</p>
        <p className="mt-1 text-sm text-fg-2 tabular-nums">
          {formatMoney(slip.grossEarnings, c)} gross − {formatMoney(slip.totalDeductions, c)} deductions
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <LineList title="Earnings" lines={toMoneyLines(slip.earnings, 'e')} total={slip.grossEarnings} totalLabel="Gross earnings" currency={c} />
        <LineList title="Deductions" lines={toMoneyLines(slip.deductions, 'd')} total={slip.totalDeductions} totalLabel="Total deductions" currency={c} tone="negative" empty="No deductions" />
      </div>

      {employer.length > 0 && (
        <LineList
          title="Employer contributions (not deducted from your pay)"
          lines={toMoneyLines(employer, 'c')}
          total={employer.reduce((s, l) => s + l.amount, 0)}
          currency={c}
          tone="muted"
        />
      )}

      <section aria-label="Attendance and days">
        <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Days</h4>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
          {days.map((d) => (
            <div key={d.label} className="bg-surface px-3 py-2.5">
              <dt className="text-xs text-muted">{d.label}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-fg tabular-nums">{d.value}</dd>
            </div>
          ))}
        </dl>
        {slip.prorationFactor !== undefined && slip.prorationFactor < 1 && (
          <p className="mt-2 text-xs text-muted">Salary prorated at {(slip.prorationFactor * 100).toFixed(2)}% for this period.</p>
        )}
      </section>

      <section aria-label="Payment">
        <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Payment</h4>
        <DescriptionList
          items={[
            { label: 'Status', value: <StatusBadge status={slip.status} /> },
            { label: 'Payment date', value: slip.paymentDate ? formatDate(slip.paymentDate) : null },
            { label: 'Mode', value: slip.paymentMode ? label(slip.paymentMode) : null },
            { label: 'Reference', value: slip.paymentReference },
            { label: 'Bank', value: slip.employeeSnapshot.bankName },
            { label: 'Account', value: slip.employeeSnapshot.accountNumberMasked ? <span className="font-mono">{slip.employeeSnapshot.accountNumberMasked}</span> : null },
          ]}
        />
      </section>
    </div>
  );
};

export const PayslipDrawer = ({ id, onClose }: { id: string | null; onClose: () => void }) => {
  const slip = usePayslip(id);
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title="Payslip"
      description={slip.data ? `${slip.data.employeeSnapshot.name} · ${periodLabel(slip.data.month, slip.data.year)}` : undefined}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} className="flex-1 sm:flex-none">
            Close
          </Button>
          {slip.data && <PdfButton slip={slip.data} size="md" variant="primary" label="Download PDF" className="flex-1 sm:flex-none" />}
        </>
      }
    >
      {slip.isLoading ? (
        <div className="space-y-4" role="status" aria-label="Loading payslip">
          <Skeleton className="h-16" />
          <Skeleton className="h-24" />
          <Skeleton className="h-48" />
        </div>
      ) : slip.error ? (
        <QueryError error={slip.error} onRetry={() => slip.refetch()} restrictedText="You do not have access to this payslip." />
      ) : slip.data ? (
        <PayslipView slip={slip.data} />
      ) : null}
    </Drawer>
  );
};

export const OffCycleBadge = () => <Badge tone="purple">Off-cycle</Badge>;
