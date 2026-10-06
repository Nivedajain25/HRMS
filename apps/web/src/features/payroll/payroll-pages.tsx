import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import type { z } from 'zod';
import {
  AlertTriangle,
  Ban,
  Banknote,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  Landmark,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Users,
  Wallet,
} from 'lucide-react';
import { PAYROLL_STATUS, PAYROLL_WORKFLOW, payrollCreateSchema, payrollPaySchema, type PayrollStatus } from '@stencil/shared';
import { EmployeePicker, FilterBar, SearchInput } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { applyServerErrors, FormError, FormField, FormGrid } from '@/components/forms/form';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DescriptionList, EmptyState, ErrorState, PageHeader, PageSkeleton, StatCard } from '@/components/ui/display';
import { Checkbox, Input, Select, Switch, Textarea } from '@/components/ui/input';
import { Dropdown, Modal, Tabs, useConfirm } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { downloadFile, toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { cn, formatDate, formatDateTime, formatMoney, fullName, toDateKey } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useCreatePayroll, usePayRun, usePayrollRun, usePayrollRuns, useRunAction, useRunPayslips, type Payslip, type PayrollRun, type PayrollRunDetail, type RunAction, type UserRef } from './api';
import { AdjustmentsPanel } from './components/adjustments-panel';
import { LoansPanel } from './components/loans-panel';
import { PayrollSummaryChart } from './components/payroll-summary-chart';
import { OffCycleBadge, PayslipDrawer } from './components/payroll-ui';
import { formatDays, monthOptions, PAYMENT_MODES, periodLabel, yearOptions } from './lib';

/* ------------------------------ New run modal ----------------------------- */

type CreateIn = z.input<typeof payrollCreateSchema>;
type CreateOut = z.output<typeof payrollCreateSchema>;

const NewRunModal = ({ onClose }: { onClose: () => void }) => {
  const navigate = useNavigate();
  const create = useCreatePayroll();
  const now = new Date();
  const [offCycle, setOffCycle] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, control, handleSubmit, formState, setError } = useForm<CreateIn, unknown, CreateOut>({
    resolver: zodResolver(payrollCreateSchema),
    defaultValues: { month: now.getMonth() + 1, year: now.getFullYear(), employeeIds: [], notes: '' },
  });
  const errors = formState.errors;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    if (offCycle && !values.employeeIds?.length) {
      setError('employeeIds', { message: 'Select at least one employee for an off-cycle run' });
      return;
    }
    try {
      const res = await create.mutateAsync({ month: values.month, year: values.year, notes: values.notes || undefined, employeeIds: offCycle ? values.employeeIds : undefined });
      toast.success(res.message ?? 'Payroll created');
      onClose();
      navigate(`/payroll/${res.data._id}`);
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, ['month', 'year', 'employeeIds', 'notes']));
    }
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="New payroll run"
      description="Creates a draft run. Process it to calculate payslips from salary structures, attendance and leave."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            Create draft
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError error={serverError} />
        <FormGrid>
          <FormField label="Month" required error={errors.month}>
            {({ id }) => <Select id={id} options={monthOptions} {...register('month')} />}
          </FormField>
          <FormField label="Year" required error={errors.year}>
            {({ id }) => <Select id={id} options={yearOptions(3, 1)} {...register('year')} />}
          </FormField>
        </FormGrid>
        <div className="flex items-start justify-between gap-4 rounded-lg border border-line p-3">
          <div>
            <p className="text-sm font-medium text-fg" id="offcycle-label">
              Off-cycle run
            </p>
            <p className="text-sm text-muted">Only for selected employees (e.g. final settlement). Regular runs include everyone and are limited to one per month.</p>
          </div>
          <Switch checked={offCycle} onChange={setOffCycle} label="Off-cycle run" />
        </div>
        {offCycle && (
          <FormField label="Employees" required error={errors.employeeIds as { message?: string } | undefined}>
            {({ id, invalid }) => (
              <Controller
                control={control}
                name="employeeIds"
                render={({ field }) => <EmployeePicker id={id} multiple invalid={invalid} value={(field.value as string[] | undefined) ?? []} onChange={(v) => field.onChange((v as string[] | null) ?? [])} placeholder="Select employees…" />}
              />
            )}
          </FormField>
        )}
        <FormField label="Notes" error={errors.notes}>
          {({ id }) => <Textarea id={id} rows={2} maxLength={500} {...register('notes')} />}
        </FormField>
      </form>
    </Modal>
  );
};

/* ------------------------------ Runs list page ---------------------------- */

const RunsPanel = () => {
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'year', sortOrder: 'desc' });
  const { tab: _tab, ...apiQuery } = query;
  void _tab;
  const list = usePayrollRuns(apiQuery);
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [creating, setCreating] = useState(false);
  const chartYear = Number(params.year) || new Date().getFullYear();

  const columns = useMemo<ColumnDef<PayrollRun, unknown>[]>(
    () => [
      {
        id: 'year',
        header: 'Period',
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <span className="font-medium text-fg">{periodLabel(row.original.month, row.original.year)}</span>
            {row.original.isOffCycle && <OffCycleBadge />}
          </span>
        ),
      },
      { id: 'status', header: 'Status', enableSorting: true, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { id: 'employees', header: 'Employees', cell: ({ row }) => row.original.employeeCount },
      { id: 'gross', header: 'Gross', cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.totalGross, row.original.currency)}</span> },
      { id: 'deductions', header: 'Deductions', cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.totalDeductions, row.original.currency)}</span> },
      { id: 'totalNet', header: 'Net pay', enableSorting: true, cell: ({ row }) => <span className="font-medium text-fg tabular-nums">{formatMoney(row.original.totalNet, row.original.currency)}</span> },
      {
        id: 'warnings',
        header: 'Warnings',
        cell: ({ row }) =>
          row.original.warnings?.length ? (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              {row.original.warnings.length}
            </span>
          ) : (
            '—'
          ),
      },
      { id: 'createdAt', header: 'Created', enableSorting: true, cell: ({ row }) => formatDate(row.original.createdAt) },
    ],
    [],
  );

  const filterKeys = ['year', 'status'];
  return (
    <>
      <PayrollSummaryChart year={chartYear} />
      {can('payroll:create') && (
        <div className="mb-4 flex justify-end">
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)} className="w-full sm:w-auto">
            New payroll run
          </Button>
        </div>
      )}
      <DataTable
        caption="Payroll runs"
        storageKey="payroll-runs"
        columns={columns}
        data={list.data?.data}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => list.refetch()}
        pagination={list.data?.pagination}
        onPageChange={(page) => set({ page })}
        onLimitChange={(limit) => set({ limit })}
        sorting={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
        onSortingChange={(s) => set({ sortBy: s.sortBy, sortOrder: s.sortOrder })}
        onRowClick={(r) => navigate(`/payroll/${r._id}`)}
        emptyTitle="No payroll runs"
        emptyDescription={hasFilters(filterKeys) ? 'Try changing your filters.' : 'Create a run for a month to calculate payslips.'}
        emptyAction={
          can('payroll:create') && !hasFilters(filterKeys) ? (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New payroll run
            </Button>
          ) : undefined
        }
        toolbar={
          <FilterBar active={hasFilters(filterKeys)} onClear={() => clear(['sortBy', 'sortOrder'])}>
            <Select aria-label="Year" className="w-full sm:w-32" value={String(params.year ?? '')} onChange={(e) => set({ year: e.target.value })} options={yearOptions()} placeholder="All years" />
            <Select
              aria-label="Status"
              className="w-full sm:w-40"
              value={String(params.status ?? '')}
              onChange={(e) => set({ status: e.target.value })}
              options={PAYROLL_STATUS.map((s) => ({ value: s, label: label(s) }))}
              placeholder="All statuses"
            />
          </FilterBar>
        }
      />
      {creating && <NewRunModal onClose={() => setCreating(false)} />}
    </>
  );
};

export const PayrollListPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = searchParams.get('tab') ?? 'runs';
  return (
    <>
      <PageHeader title="Payroll" description="Monthly payroll runs, one-time adjustments and employee loans." />
      <Tabs
        className="mb-6"
        tabs={[
          { key: 'runs', label: 'Payroll runs' },
          { key: 'adjustments', label: 'Adjustments' },
          { key: 'loans', label: 'Loans & advances' },
        ]}
        active={tab}
        onChange={(key) => navigate(key === 'runs' ? '/payroll' : `/payroll?tab=${key}`, { replace: true })}
      />
      <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'adjustments' ? <AdjustmentsPanel /> : tab === 'loans' ? <LoansPanel /> : <RunsPanel />}
      </div>
    </>
  );
};

/* ------------------------------- Run detail ------------------------------- */

const STEPS: PayrollStatus[] = ['DRAFT', 'PROCESSING', 'REVIEW', 'APPROVED', 'PAID'];

const lastAt = (run: PayrollRun, status: PayrollStatus) => [...(run.statusHistory ?? [])].reverse().find((h) => h.status === status)?.at;

const byLine = (user: UserRef | null | undefined, at: string | null | undefined) => [user ? fullName(user) : null, at ? formatDateTime(at) : null].filter(Boolean).join(' · ');

const StatusStepper = ({ run }: { run: PayrollRun }) => {
  const current = STEPS.indexOf(run.status);
  const detail: Record<string, string> = {
    DRAFT: byLine(run.createdBy, run.createdAt),
    PROCESSING: run.status === 'PROCESSING' ? 'Calculating payslips…' : run.processedAt ? `Computed ${formatDateTime(run.processedAt)}` : '',
    REVIEW: byLine(run.processedBy, lastAt(run, 'REVIEW') ?? run.processedAt),
    APPROVED: byLine(run.approvedBy, run.approvedAt),
    PAID: byLine(run.paidBy, run.paidAt),
  };
  return (
    <nav aria-label="Payroll progress" className="card mb-6 p-4">
      <ol className="flex flex-col gap-3 sm:flex-row sm:gap-0">
        {STEPS.map((s, i) => {
          const done = current > i || run.status === 'PAID';
          const active = current === i && run.status !== 'PAID';
          return (
            <li key={s} className="flex flex-1 items-start gap-3 sm:flex-col sm:items-stretch sm:gap-2" aria-current={active ? 'step' : undefined}>
              <div className="flex items-center sm:w-full">
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-2',
                    done ? 'bg-brand-600 text-white ring-brand-600' : active ? 'bg-surface text-brand-700 ring-brand-600 dark:text-brand-300' : 'bg-surface text-muted ring-line-strong',
                  )}
                >
                  {done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
                </span>
                {i < STEPS.length - 1 && <span className={cn('mx-2 hidden h-0.5 flex-1 rounded sm:block', current > i ? 'bg-brand-600' : 'bg-line')} aria-hidden />}
              </div>
              <div className="min-w-0 sm:pr-3">
                <p className={cn('text-sm font-medium', done || active ? 'text-fg' : 'text-muted')}>{label(s)}</p>
                {(done || active) && detail[s] && <p className="truncate text-xs text-muted">{detail[s]}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

type PayIn = z.input<typeof payrollPaySchema>;
type PayOut = z.output<typeof payrollPaySchema>;

const PayModal = ({ run, onClose }: { run: PayrollRunDetail; onClose: () => void }) => {
  const pay = usePayRun(run._id);
  const [ack, setAck] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState, setError, control } = useForm<PayIn, unknown, PayOut>({
    resolver: zodResolver(payrollPaySchema),
    defaultValues: { paymentDate: toDateKey(new Date()), paymentMode: 'BANK_TRANSFER', paymentReference: '' },
  });
  const errors = formState.errors;
  const mode = useWatch({ control, name: 'paymentMode' });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await pay.mutateAsync({ paymentDate: values.paymentDate, paymentMode: values.paymentMode, paymentReference: values.paymentReference || undefined });
      toast.success(res.message ?? 'Payroll marked as paid');
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, ['paymentDate', 'paymentMode', 'paymentReference']));
    }
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Mark payroll as paid"
      description={`${periodLabel(run.month, run.year)} · ${run.employeeCount} employees · ${formatMoney(run.totalNet, run.currency)} net`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="success" icon={<Banknote className="h-4 w-4" />} onClick={onSubmit} loading={formState.isSubmitting} disabled={!ack}>
            Mark as paid
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError error={serverError} />
        <FormGrid>
          <FormField label="Payment date" required error={errors.paymentDate}>
            {({ id, invalid }) => <Input id={id} type="date" aria-invalid={invalid} {...register('paymentDate')} />}
          </FormField>
          <FormField label="Payment mode" required error={errors.paymentMode}>
            {({ id }) => <Select id={id} options={PAYMENT_MODES.map((m) => ({ value: m, label: label(m) }))} {...register('paymentMode')} />}
          </FormField>
        </FormGrid>
        <FormField label="Payment reference" error={errors.paymentReference} hint={mode === 'BANK_TRANSFER' ? 'Bank batch or transaction reference.' : mode === 'CHEQUE' ? 'Cheque number(s).' : undefined}>
          {({ id, invalid }) => <Input id={id} maxLength={100} aria-invalid={invalid} {...register('paymentReference')} />}
        </FormField>
        <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="font-medium">This is irreversible.</p>
          <p className="mt-0.5">Payslips become visible as paid, loan recoveries are recorded, and every employee is notified. A paid payroll cannot be reopened or cancelled.</p>
          <Checkbox className="mt-3" checked={ack} onChange={(e) => setAck(e.target.checked)} label="I confirm the salaries have been paid" />
        </div>
      </form>
    </Modal>
  );
};

const PayslipsTable = ({ run, onOpen }: { run: PayrollRunDetail; onOpen: (id: string) => void }) => {
  const { params, query, set } = useListParams({ sortOrder: 'asc' });
  const payslips = useRunPayslips(run._id, query);
  const c = run.currency;
  const columns = useMemo<ColumnDef<Payslip, unknown>[]>(
    () => [
      {
        id: 'employee',
        header: 'Employee',
        enableHiding: false,
        cell: ({ row }) => (
          <span className="block">
            <span className="font-medium text-fg">{row.original.employeeSnapshot.name}</span>
            <span className="block text-xs text-muted">{[row.original.employeeSnapshot.employeeId, row.original.employeeSnapshot.department].filter(Boolean).join(' · ')}</span>
          </span>
        ),
      },
      { id: 'payable', header: 'Payable days', cell: ({ row }) => <span className="tabular-nums">{formatDays(row.original.payableDays)}</span> },
      {
        id: 'lop',
        header: 'LOP days',
        cell: ({ row }) => <span className={cn('tabular-nums', row.original.lopDays > 0 && 'font-medium text-amber-700 dark:text-amber-300')}>{formatDays(row.original.lopDays)}</span>,
      },
      { id: 'grossEarnings', header: 'Gross', enableSorting: true, cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.grossEarnings, c)}</span> },
      { id: 'deductions', header: 'Deductions', cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.totalDeductions, c)}</span> },
      {
        id: 'netPay',
        header: 'Net pay',
        enableSorting: true,
        cell: ({ row }) => <span className={cn('font-semibold tabular-nums', row.original.netPay < 0 ? 'text-red-600 dark:text-red-400' : 'text-fg')}>{formatMoney(row.original.netPay, c)}</span>,
      },
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ],
    [c],
  );
  return (
    <DataTable
      caption="Payslips in this run"
      storageKey="payroll-run-payslips"
      columns={columns}
      data={payslips.data?.data}
      loading={payslips.isLoading || payslips.isFetching}
      error={payslips.error}
      onRetry={() => payslips.refetch()}
      pagination={payslips.data?.pagination}
      onPageChange={(page) => set({ page })}
      onLimitChange={(limit) => set({ limit })}
      sorting={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
      onSortingChange={(s) => set({ sortBy: s.sortBy, sortOrder: s.sortOrder })}
      onRowClick={(p) => onOpen(p._id)}
      emptyTitle={params.search ? 'No matching payslips' : 'No payslips'}
      emptyDescription={params.search ? 'Try a different search.' : 'No employees were paid in this run. Check the warnings above.'}
      toolbar={<SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder="Search employee, ID, department…" />}
    />
  );
};

export const PayrollRunPage = () => {
  const { id = '' } = useParams();
  const run = usePayrollRun(id);
  const action = useRunAction(id);
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [paying, setPaying] = useState(false);
  const [selfApproval, setSelfApproval] = useState<string | null>(null);
  const [slipId, setSlipId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [pending, setPending] = useState<RunAction | null>(null);

  if (run.isLoading) return <PageSkeleton />;
  if (run.error || !run.data) return <ErrorState className="card" message={run.error?.message} onRetry={() => run.refetch()} />;
  const r = run.data;
  const c = r.currency;
  const title = periodLabel(r.month, r.year);
  const allowed = (to: PayrollStatus) => PAYROLL_WORKFLOW.can(r.status, to);

  const perform = async (act: RunAction, opts: { title: string; message: string; confirmLabel: string; tone?: 'danger' | 'primary' }) => {
    const { confirmed } = await confirm(opts);
    if (!confirmed) return;
    setSelfApproval(null);
    setPending(act);
    try {
      const res = await action.mutateAsync(act);
      toast.success(res.message ?? 'Payroll updated');
    } catch (err) {
      const e = toApiError(err);
      if (e.code === 'SELF_APPROVAL') setSelfApproval(e.message);
      else toast.error(e.message);
    } finally {
      setPending(null);
    }
  };

  const onExport = async (format: 'csv' | 'xlsx') => {
    setExporting(true);
    try {
      await downloadFile(`/payroll/${r._id}/export`, { format }, `payroll-${r.year}-${String(r.month).padStart(2, '0')}.${format}`);
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setExporting(false);
    }
  };

  const canProcess = can('payroll:process') && allowed('PROCESSING');
  const canApprove = can('payroll:approve') && allowed('APPROVED');
  const canReopen = can('payroll:approve') && r.status === 'APPROVED' && allowed('REVIEW');
  const canPay = can('payroll:approve') && allowed('PAID');
  const canCancel = can('payroll:create') && allowed('CANCELLED');
  const busy = action.isPending;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Payroll', to: '/payroll' }, { label: title }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {title} payroll
            <StatusBadge status={r.status} />
            {r.isOffCycle && <OffCycleBadge />}
          </span>
        }
        description={`${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}${r.notes ? ` · ${r.notes}` : ''}`}
        actions={
          <>
            {r.status !== 'CANCELLED' && (
              <Dropdown
                label="Export payroll register"
                trigger={
                  <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium text-fg shadow-sm hover:bg-surface-2">
                    {exporting ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
                    Export
                    <ChevronDown className="h-4 w-4 text-muted" aria-hidden />
                  </span>
                }
                items={[
                  { label: 'CSV', onSelect: () => void onExport('csv') },
                  { label: 'Excel (XLSX)', onSelect: () => void onExport('xlsx') },
                ]}
              />
            )}
            {canCancel && (
              <Button
                variant="outline"
                icon={<Ban className="h-4 w-4" />}
                disabled={busy}
                loading={pending === 'cancel'}
                onClick={() =>
                  perform('cancel', {
                    title: `Cancel ${title} payroll?`,
                    message: 'All calculated payslips are discarded and linked adjustments are released for another run. This cannot be undone.',
                    confirmLabel: 'Cancel payroll',
                  })
                }
              >
                Cancel run
              </Button>
            )}
            {canReopen && (
              <Button
                variant="outline"
                icon={<RotateCcw className="h-4 w-4" />}
                disabled={busy}
                loading={pending === 'reopen'}
                onClick={() =>
                  perform('reopen', {
                    title: 'Reopen for review?',
                    message: 'The approval is withdrawn and payslips return to draft so the run can be re-processed or corrected.',
                    confirmLabel: 'Reopen',
                    tone: 'primary',
                  })
                }
              >
                Reopen
              </Button>
            )}
            {canProcess && (
              <Button
                variant={r.status === 'DRAFT' ? 'primary' : 'outline'}
                icon={<Calculator className="h-4 w-4" />}
                disabled={busy}
                loading={pending === 'process'}
                onClick={() =>
                  perform('process', {
                    title: r.status === 'DRAFT' ? 'Process payroll?' : 'Re-process payroll?',
                    message:
                      r.status === 'DRAFT'
                        ? 'Payslips are calculated from salary structures, attendance, approved leave, adjustments and loans.'
                        : 'All payslips of this run are recalculated with the latest salary, attendance, leave, adjustment and loan data.',
                    confirmLabel: r.status === 'DRAFT' ? 'Process' : 'Re-process',
                    tone: 'primary',
                  })
                }
              >
                {r.status === 'DRAFT' ? 'Process' : 'Re-process'}
              </Button>
            )}
            {canApprove && (
              <Button
                variant="success"
                icon={<CheckCircle2 className="h-4 w-4" />}
                disabled={busy}
                loading={pending === 'approve'}
                onClick={() =>
                  perform('approve', {
                    title: `Approve ${title} payroll?`,
                    message: `${r.employeeCount} payslips totalling ${formatMoney(r.totalNet, c)} net become final and visible to employees.`,
                    confirmLabel: 'Approve',
                    tone: 'primary',
                  })
                }
              >
                Approve
              </Button>
            )}
            {canPay && (
              <Button variant="success" icon={<Banknote className="h-4 w-4" />} disabled={busy} onClick={() => setPaying(true)}>
                Mark as paid
              </Button>
            )}
          </>
        }
      />

      {selfApproval && (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Approval needs a second person</p>
            <p className="mt-0.5">{selfApproval}. Ask another user with payroll approval rights to review and approve this run (four-eyes principle).</p>
          </div>
        </div>
      )}

      {r.status === 'CANCELLED' ? (
        <div className="card mb-6 flex items-center gap-3 p-4 text-sm text-fg-2">
          <Ban className="h-5 w-5 text-muted" />
          This payroll run was cancelled{lastAt(r, 'CANCELLED') ? ` on ${formatDateTime(lastAt(r, 'CANCELLED'))}` : ''}. It is kept for audit purposes only.
        </div>
      ) : (
        <StatusStepper run={r} />
      )}

      {r.status === 'PROCESSING' && (
        <div role="status" className="mb-6 flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
          <RefreshCw className="h-4 w-4 animate-spin" /> Payslips are being calculated. This page refreshes automatically.
        </div>
      )}

      {r.warnings?.length > 0 && (
        <Card className="mb-6 border-amber-200 dark:border-amber-500/30">
          <CardHeader
            title={
              <span className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" /> {r.warnings.length} warning{r.warnings.length === 1 ? '' : 's'}
              </span>
            }
            description="Review before approving. Employees without a salary structure are skipped."
            actions={
              can('salary:read') ? (
                <Link to="/salary" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
                  Manage salaries
                </Link>
              ) : undefined
            }
          />
          <ul className="scrollbar-thin max-h-64 divide-y divide-line overflow-y-auto">
            {r.warnings.map((w, i) => (
              <li key={i} className="px-5 py-2.5 text-sm text-fg-2">
                {w}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <StatCard label="Employees" value={r.employeeCount} icon={<Users className="h-5 w-5" />} tone="gray" />
        <StatCard label="Gross earnings" value={formatMoney(r.totalGross, c)} icon={<Wallet className="h-5 w-5" />} tone="blue" />
        <StatCard label="Deductions" value={formatMoney(r.totalDeductions, c)} icon={<Calculator className="h-5 w-5" />} tone="amber" />
        <StatCard label="Net pay" value={formatMoney(r.totalNet, c)} icon={<Banknote className="h-5 w-5" />} tone="brand" />
        <StatCard
          label="Employer cost"
          value={formatMoney(r.totalGross + r.totalEmployerContributions, c)}
          hint={`incl. ${formatMoney(r.totalEmployerContributions, c)} contributions`}
          icon={<Landmark className="h-5 w-5" />}
          tone="teal"
        />
      </div>

      {r.status === 'PAID' && (
        <Card className="mb-6">
          <CardHeader title="Payment" />
          <CardBody>
            <DescriptionList
              columns={3}
              items={[
                { label: 'Payment date', value: r.paymentDate ? formatDate(r.paymentDate) : null },
                { label: 'Mode', value: r.paymentMode ? label(r.paymentMode) : null },
                { label: 'Reference', value: r.paymentReference },
              ]}
            />
          </CardBody>
        </Card>
      )}

      <h2 className="mb-3 text-base font-semibold text-fg">Payslips</h2>
      {r.status === 'DRAFT' ? (
        <EmptyState
          className="card"
          icon={<Calculator className="h-6 w-6" />}
          title="Not processed yet"
          description="Process this payroll to calculate a payslip for every eligible employee."
          action={
            canProcess ? (
              <Button
                icon={<Calculator className="h-4 w-4" />}
                loading={pending === 'process'}
                onClick={() =>
                  perform('process', {
                    title: 'Process payroll?',
                    message: 'Payslips are calculated from salary structures, attendance, approved leave, adjustments and loans.',
                    confirmLabel: 'Process',
                    tone: 'primary',
                  })
                }
              >
                Process payroll
              </Button>
            ) : undefined
          }
        />
      ) : r.status === 'CANCELLED' ? (
        <EmptyState className="card" title="No payslips" description="Payslips of cancelled runs are discarded." />
      ) : (
        <PayslipsTable run={r} onOpen={setSlipId} />
      )}

      {paying && <PayModal run={r} onClose={() => setPaying(false)} />}
      <PayslipDrawer id={slipId} onClose={() => setSlipId(null)} />
    </>
  );
};
