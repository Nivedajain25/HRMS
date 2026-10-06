import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Lock, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { payrollAdjustmentSchema } from '@stencil/shared';
import { EmployeePicker, FilterBar } from '@/components/common/controls';
import { applyServerErrors, FormError, FormField, FormGrid } from '@/components/forms/form';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Badge, PersonCell } from '@/components/ui/display';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Drawer, Dropdown, useConfirm } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { formatMoney, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useAdjustments, useDeleteAdjustment, useSaveAdjustment, type Adjustment } from '../api';
import { ADJUSTMENT_CATEGORIES, monthOptions, periodLabel, useOrgCurrency, yearOptions } from '../lib';

type FormIn = z.input<typeof payrollAdjustmentSchema>;
type FormOut = z.output<typeof payrollAdjustmentSchema>;

const AdjustmentDrawer = ({ adjustment, onClose }: { adjustment?: Adjustment; onClose: () => void }) => {
  const now = new Date();
  const currency = useOrgCurrency();
  const save = useSaveAdjustment(adjustment?._id);
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, control, handleSubmit, formState, setError } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(payrollAdjustmentSchema),
    defaultValues: {
      employeeId: adjustment?.employeeId?._id ?? '',
      month: adjustment?.month ?? now.getMonth() + 1,
      year: adjustment?.year ?? now.getFullYear(),
      kind: adjustment?.kind ?? 'EARNING',
      category: adjustment?.category ?? 'BONUS',
      amount: adjustment?.amount ?? 0,
      description: adjustment?.description ?? '',
    },
  });
  const errors = formState.errors;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const { employeeId, ...rest } = values;
    try {
      const res = await save.mutateAsync(adjustment ? rest : { employeeId, ...rest });
      toast.success(res.message ?? 'Adjustment saved');
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, ['employeeId', 'month', 'year', 'kind', 'category', 'amount', 'description']));
    }
  });

  return (
    <Drawer
      open
      onClose={onClose}
      title={adjustment ? 'Edit adjustment' : 'New adjustment'}
      description="One-time earning or deduction included in the payroll run of the selected month."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError error={serverError} />
        <FormField label="Employee" required error={errors.employeeId}>
          {({ id, invalid }) =>
            adjustment ? (
              <Input id={id} value={adjustment.employeeId ? `${fullName(adjustment.employeeId)} (${adjustment.employeeId.employeeId})` : ''} readOnly disabled />
            ) : (
              <Controller
                control={control}
                name="employeeId"
                render={({ field }) => <EmployeePicker id={id} invalid={invalid} value={(field.value as string) || null} onChange={(v) => field.onChange((v as string | null) ?? '')} />}
              />
            )
          }
        </FormField>
        <FormGrid>
          <FormField label="Month" required error={errors.month}>
            {({ id }) => <Select id={id} options={monthOptions} {...register('month')} />}
          </FormField>
          <FormField label="Year" required error={errors.year}>
            {({ id }) => <Select id={id} options={yearOptions(3, 1)} {...register('year')} />}
          </FormField>
          <FormField label="Kind" required error={errors.kind}>
            {({ id }) => (
              <Select
                id={id}
                options={[
                  { value: 'EARNING', label: 'Earning (adds to pay)' },
                  { value: 'DEDUCTION', label: 'Deduction (reduces pay)' },
                ]}
                {...register('kind')}
              />
            )}
          </FormField>
          <FormField label="Category" required error={errors.category}>
            {({ id }) => <Select id={id} options={ADJUSTMENT_CATEGORIES.map((c) => ({ value: c, label: label(c) }))} {...register('category')} />}
          </FormField>
          <FormField label={`Amount (${currency})`} required error={errors.amount}>
            {({ id, invalid }) => <Input id={id} type="number" inputMode="decimal" min={0} step="any" aria-invalid={invalid} {...register('amount')} />}
          </FormField>
        </FormGrid>
        <FormField label="Description" required error={errors.description} hint="Shown as the line name on the payslip.">
          {({ id, invalid }) => <Textarea id={id} rows={2} maxLength={200} aria-invalid={invalid} {...register('description')} />}
        </FormField>
      </form>
    </Drawer>
  );
};

export const AdjustmentsPanel = () => {
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'createdAt', sortOrder: 'desc' });
  const { tab: _tab, ...apiQuery } = query;
  void _tab;
  const list = useAdjustments(apiQuery);
  const { can } = usePermissions();
  const canManage = can('payroll:create');
  const confirm = useConfirm();
  const remove = useDeleteAdjustment();
  const currency = useOrgCurrency();
  const [editing, setEditing] = useState<Adjustment | 'new' | null>(null);

  const columns = useMemo<ColumnDef<Adjustment, unknown>[]>(() => {
    const onDelete = async (a: Adjustment) => {
      const { confirmed } = await confirm({ title: 'Delete adjustment?', message: `${label(a.category)} of ${formatMoney(a.amount, currency)} for ${periodLabel(a.month, a.year)} will be removed.`, confirmLabel: 'Delete' });
      if (!confirmed) return;
      const res = await remove.mutateAsync(a._id);
      toast.success(res.message ?? 'Adjustment deleted');
    };
    return [
      {
        id: 'employee',
        header: 'Employee',
        enableHiding: false,
        cell: ({ row }) => (row.original.employeeId ? <PersonCell name={fullName(row.original.employeeId)} subtitle={row.original.employeeId.employeeId} photo={row.original.employeeId.profilePhoto} /> : '—'),
      },
      { id: 'month', header: 'Period', enableSorting: true, cell: ({ row }) => periodLabel(row.original.month, row.original.year) },
      { id: 'kind', header: 'Kind', cell: ({ row }) => <Badge tone={row.original.kind === 'EARNING' ? 'green' : 'red'}>{label(row.original.kind)}</Badge> },
      { id: 'category', header: 'Category', cell: ({ row }) => label(row.original.category) },
      {
        id: 'amount',
        header: 'Amount',
        enableSorting: true,
        cell: ({ row }) => (
          <span className="font-medium text-fg tabular-nums">
            {row.original.kind === 'DEDUCTION' ? '−' : '+'}
            {formatMoney(row.original.amount, currency)}
          </span>
        ),
      },
      { id: 'description', header: 'Description', cell: ({ row }) => <span className="block max-w-64 truncate">{row.original.description ?? '—'}</span> },
      {
        id: 'payroll',
        header: 'Payroll',
        cell: ({ row }) =>
          row.original.payrollId ? (
            <Link to={`/payroll/${row.original.payrollId}`} onClick={(e) => e.stopPropagation()} className="text-brand-600 hover:underline dark:text-brand-400">
              Included in run
            </Link>
          ) : (
            <span className="text-muted">Pending</span>
          ),
      },
      ...(canManage
        ? [
            {
              id: 'actions',
              header: '',
              enableHiding: false,
              cell: ({ row }: { row: { original: Adjustment } }) => (
                <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                  <Dropdown
                    label="Adjustment actions"
                    trigger={
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3">
                        <MoreHorizontal className="h-4 w-4" />
                      </span>
                    }
                    items={[
                      { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(row.original) },
                      { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => void onDelete(row.original) },
                    ]}
                  />
                </div>
              ),
            } as ColumnDef<Adjustment, unknown>,
          ]
        : []),
    ];
  }, [canManage, confirm, remove, currency]);

  const filterKeys = ['employeeId', 'month', 'year'];
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <Lock className="h-3.5 w-3.5" aria-hidden /> Adjustments in approved or paid runs are locked.
        </p>
        {canManage && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')} className="w-full sm:w-auto">
            New adjustment
          </Button>
        )}
      </div>
      <DataTable
        caption="Payroll adjustments"
        storageKey="payroll-adjustments"
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
        onRowClick={canManage ? (a) => setEditing(a) : undefined}
        emptyTitle="No adjustments"
        emptyDescription={hasFilters(filterKeys) ? 'Try changing your filters.' : 'Bonuses, reimbursements and one-off deductions appear here.'}
        toolbar={
          <FilterBar active={hasFilters(filterKeys)} onClear={() => clear(['tab'])}>
            <div className="w-full sm:w-64">
              <EmployeePicker value={(params.employeeId as string | undefined) ?? null} onChange={(v) => set({ employeeId: (v as string | null) ?? undefined })} placeholder="All employees" />
            </div>
            <Select aria-label="Month" className="w-full sm:w-36" value={String(params.month ?? '')} onChange={(e) => set({ month: e.target.value })} options={monthOptions} placeholder="All months" />
            <Select aria-label="Year" className="w-full sm:w-28" value={String(params.year ?? '')} onChange={(e) => set({ year: e.target.value })} options={yearOptions()} placeholder="All years" />
          </FilterBar>
        }
      />
      {editing && <AdjustmentDrawer key={editing === 'new' ? 'new' : editing._id} adjustment={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
};
