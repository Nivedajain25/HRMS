import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Ban, Eye, MoreHorizontal, Plus } from 'lucide-react';
import { loanSchema } from '@stencil/shared';
import { EmployeePicker, FilterBar } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { applyServerErrors, FormError, FormField, FormGrid } from '@/components/forms/form';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { DescriptionList, PersonCell, ProgressBar } from '@/components/ui/display';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Drawer, Dropdown, Modal, useConfirm } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { formatDateTime, formatMoney, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useCloseLoan, useCreateLoan, useLoans, type Loan } from '../api';
import { monthOptions, periodLabel, useOrgCurrency, yearOptions } from '../lib';

type FormIn = z.input<typeof loanSchema>;
type FormOut = z.output<typeof loanSchema>;

const LoanCreateDrawer = ({ onClose }: { onClose: () => void }) => {
  const now = new Date();
  const currency = useOrgCurrency();
  const create = useCreateLoan();
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, control, handleSubmit, formState, setError } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(loanSchema),
    defaultValues: { employeeId: '', type: 'LOAN', principal: 0, monthlyInstallment: 0, startMonth: now.getMonth() + 1, startYear: now.getFullYear(), description: '' },
  });
  const errors = formState.errors;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    if (values.monthlyInstallment > values.principal) {
      setError('monthlyInstallment', { message: 'Installment cannot exceed the principal' });
      return;
    }
    try {
      const res = await create.mutateAsync({ ...values, description: values.description || undefined });
      toast.success(res.message ?? 'Loan created');
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, ['employeeId', 'type', 'principal', 'monthlyInstallment', 'startMonth', 'startYear', 'description']));
    }
  });

  return (
    <Drawer
      open
      onClose={onClose}
      title="New loan or advance"
      description="Installments are recovered automatically from net pay in each payroll run, starting with the selected month."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            Create
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError error={serverError} />
        <FormField label="Employee" required error={errors.employeeId}>
          {({ id, invalid }) => (
            <Controller
              control={control}
              name="employeeId"
              render={({ field }) => <EmployeePicker id={id} invalid={invalid} value={(field.value as string) || null} onChange={(v) => field.onChange((v as string | null) ?? '')} />}
            />
          )}
        </FormField>
        <FormGrid>
          <FormField label="Type" required error={errors.type}>
            {({ id }) => (
              <Select
                id={id}
                options={[
                  { value: 'LOAN', label: 'Loan' },
                  { value: 'ADVANCE', label: 'Salary advance' },
                ]}
                {...register('type')}
              />
            )}
          </FormField>
          <FormField label={`Principal (${currency})`} required error={errors.principal}>
            {({ id, invalid }) => <Input id={id} type="number" inputMode="decimal" min={0} step="any" aria-invalid={invalid} {...register('principal')} />}
          </FormField>
          <FormField label={`Monthly installment (${currency})`} required error={errors.monthlyInstallment}>
            {({ id, invalid }) => <Input id={id} type="number" inputMode="decimal" min={0} step="any" aria-invalid={invalid} {...register('monthlyInstallment')} />}
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Start month" required error={errors.startMonth}>
              {({ id }) => <Select id={id} options={monthOptions} {...register('startMonth')} />}
            </FormField>
            <FormField label="Start year" required error={errors.startYear}>
              {({ id }) => <Select id={id} options={yearOptions(2, 2)} {...register('startYear')} />}
            </FormField>
          </div>
        </FormGrid>
        <FormField label="Description" error={errors.description}>
          {({ id }) => <Textarea id={id} rows={2} maxLength={300} {...register('description')} />}
        </FormField>
      </form>
    </Drawer>
  );
};

const LoanDetailModal = ({ loan, onClose }: { loan: Loan; onClose: () => void }) => {
  const currency = useOrgCurrency();
  const repaid = loan.principal - loan.outstanding;
  return (
    <Modal open onClose={onClose} title={loan.type === 'LOAN' ? 'Loan details' : 'Salary advance details'} description={loan.employeeId ? `${fullName(loan.employeeId)} (${loan.employeeId.employeeId})` : undefined} size="lg">
      <div className="space-y-5">
        <DescriptionList
          items={[
            { label: 'Principal', value: formatMoney(loan.principal, currency) },
            { label: 'Monthly installment', value: formatMoney(loan.monthlyInstallment, currency) },
            { label: 'Outstanding', value: formatMoney(loan.outstanding, currency) },
            { label: 'Starts', value: periodLabel(loan.startMonth, loan.startYear) },
            { label: 'Status', value: <StatusBadge status={loan.status} /> },
            { label: 'Description', value: loan.description },
          ]}
        />
        <div>
          <div className="mb-1.5 flex justify-between text-xs text-muted">
            <span>Repaid {formatMoney(repaid, currency)}</span>
            <span>{loan.principal ? Math.round((repaid / loan.principal) * 100) : 0}%</span>
          </div>
          <ProgressBar value={loan.principal ? (repaid / loan.principal) * 100 : 0} tone="green" />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-fg">Repayments</h3>
          {loan.repayments.length === 0 ? (
            <p className="text-sm text-muted">No repayments yet. Recoveries are recorded when a payroll run is marked as paid.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {loan.repayments.map((r, i) => (
                <li key={`${r.year}-${r.month}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <span>
                    <span className="block font-medium text-fg">{periodLabel(r.month, r.year)}</span>
                    <span className="block text-xs text-muted">{formatDateTime(r.at)}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-medium text-fg tabular-nums">{formatMoney(r.amount, currency)}</span>
                    {r.payrollId && (
                      <Link to={`/payroll/${r.payrollId}`} className="text-xs text-brand-600 hover:underline dark:text-brand-400">
                        Run
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
};

export const LoansPanel = () => {
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'createdAt', sortOrder: 'desc' });
  const { tab: _tab, ...apiQuery } = query;
  void _tab;
  const list = useLoans(apiQuery);
  const { can } = usePermissions();
  const canManage = can('payroll:create');
  const confirm = useConfirm();
  const close = useCloseLoan();
  const currency = useOrgCurrency();
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Loan | null>(null);

  const columns = useMemo<ColumnDef<Loan, unknown>[]>(() => {
    const onClose = async (l: Loan) => {
      const { confirmed } = await confirm({
        title: 'Close this loan?',
        message: `The outstanding ${formatMoney(l.outstanding, currency)} will be written off and no further installments recovered. This cannot be undone.`,
        confirmLabel: 'Close loan',
      });
      if (!confirmed) return;
      const res = await close.mutateAsync(l._id);
      toast.success(res.message ?? 'Loan closed');
    };
    return [
      {
        id: 'employee',
        header: 'Employee',
        enableHiding: false,
        cell: ({ row }) => (row.original.employeeId ? <PersonCell name={fullName(row.original.employeeId)} subtitle={row.original.employeeId.employeeId} photo={row.original.employeeId.profilePhoto} /> : '—'),
      },
      { id: 'type', header: 'Type', cell: ({ row }) => (row.original.type === 'LOAN' ? 'Loan' : 'Salary advance') },
      { id: 'principal', header: 'Principal', enableSorting: true, cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.principal, currency)}</span> },
      { id: 'installment', header: 'Installment', cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.monthlyInstallment, currency)}</span> },
      {
        id: 'outstanding',
        header: 'Outstanding',
        enableSorting: true,
        cell: ({ row }) => {
          const l = row.original;
          const pct = l.principal ? ((l.principal - l.outstanding) / l.principal) * 100 : 0;
          return (
            <div className="w-36">
              <span className="font-medium text-fg tabular-nums">{formatMoney(l.outstanding, currency)}</span>
              <ProgressBar value={pct} tone="green" className="mt-1 h-1.5" />
            </div>
          );
        },
      },
      { id: 'start', header: 'Starts', cell: ({ row }) => periodLabel(row.original.startMonth, row.original.startYear) },
      { id: 'repayments', header: 'Repayments', cell: ({ row }) => row.original.repayments.length },
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      {
        id: 'actions',
        header: '',
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <Dropdown
              label="Loan actions"
              trigger={
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3">
                  <MoreHorizontal className="h-4 w-4" />
                </span>
              }
              items={[
                { label: 'View repayments', icon: <Eye className="h-4 w-4" />, onSelect: () => setViewing(row.original) },
                { label: 'Close loan', icon: <Ban className="h-4 w-4" />, danger: true, hidden: !canManage || row.original.status !== 'ACTIVE', onSelect: () => void onClose(row.original) },
              ]}
            />
          </div>
        ),
      },
    ];
  }, [canManage, confirm, close, currency]);

  const filterKeys = ['employeeId', 'status'];
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Recoveries are deducted in each run and recorded when the run is marked as paid.</p>
        {canManage && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)} className="w-full sm:w-auto">
            New loan / advance
          </Button>
        )}
      </div>
      <DataTable
        caption="Loans and advances"
        storageKey="payroll-loans"
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
        onRowClick={(l) => setViewing(l)}
        emptyTitle="No loans or advances"
        emptyDescription={hasFilters(filterKeys) ? 'Try changing your filters.' : 'Employee loans and salary advances appear here.'}
        toolbar={
          <FilterBar active={hasFilters(filterKeys)} onClear={() => clear(['tab'])}>
            <div className="w-full sm:w-64">
              <EmployeePicker value={(params.employeeId as string | undefined) ?? null} onChange={(v) => set({ employeeId: (v as string | null) ?? undefined })} placeholder="All employees" />
            </div>
            <Select
              aria-label="Status"
              className="w-full sm:w-36"
              value={String(params.status ?? '')}
              onChange={(e) => set({ status: e.target.value })}
              options={['ACTIVE', 'CLOSED'].map((s) => ({ value: s, label: label(s) }))}
              placeholder="Any status"
            />
          </FilterBar>
        }
      />
      {creating && <LoanCreateDrawer onClose={() => setCreating(false)} />}
      {viewing && <LoanDetailModal loan={viewing} onClose={() => setViewing(null)} />}
    </>
  );
};
