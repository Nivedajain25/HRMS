import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Archive, CalendarCog, Home, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { GENDERS, leaveTypeSchema } from '@stencil/shared';
import { FilterBar, SearchInput } from '@/components/common/controls';
import { applyServerErrors, FormError, FormField, FormGrid, FormSection } from '@/components/forms/form';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Badge, PageHeader } from '@/components/ui/display';
import { Checkbox, Input, Select, Switch, Textarea } from '@/components/ui/input';
import { Drawer, Dropdown, useConfirm } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { usePermissions } from '@/store/auth';
import { formatNum, useArchiveLeaveType, useLeaveTypesPage, useSaveLeaveType, type LeaveType } from './api';

type FormIn = z.input<typeof leaveTypeSchema>;
type FormOut = z.output<typeof leaveTypeSchema>;

const PRESET_COLORS = ['#0ea5e9', '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#64748b'];

const toForm = (t?: LeaveType | null): FormIn => ({
  name: t?.name ?? '',
  code: t?.code ?? '',
  description: t?.description ?? '',
  color: t?.color ?? '#0ea5e9',
  paid: t?.paid ?? true,
  annualAllowance: t?.annualAllowance ?? 12,
  accrual: t?.accrual ?? 'ANNUAL',
  carryForward: t?.carryForward ?? false,
  maximumCarryForward: t?.maximumCarryForward ?? 0,
  encashment: t?.encashment ?? false,
  halfDayAllowed: t?.halfDayAllowed ?? true,
  documentRequired: t?.documentRequired ?? false,
  documentRequiredAfterDays: t?.documentRequiredAfterDays ?? 0,
  maxConsecutiveDays: t?.maxConsecutiveDays ?? 0,
  minNoticeDays: t?.minNoticeDays ?? 0,
  applicableGenders: (t?.applicableGenders ?? []) as FormIn['applicableGenders'],
  isWorkFromHome: t?.isWorkFromHome ?? false,
  active: t?.active ?? true,
});

/** Label + description on the left, switch on the right. */
const SwitchRow = ({ control, name, title, description, children }: { control: Control<FormIn, unknown, FormOut>; name: keyof FormIn; title: string; description?: string; children?: ReactNode }) => {
  const id = `lt-${name}`;
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-4">
        <label htmlFor={id} className="min-w-0 text-sm">
          <span className="block font-medium text-fg">{title}</span>
          {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
        </label>
        <Controller control={control} name={name} render={({ field }) => <Switch id={id} checked={!!field.value} onChange={field.onChange} label={title} />} />
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
};

const LeaveTypeDrawer = ({ open, type, onClose }: { open: boolean; type: LeaveType | null; onClose: () => void }) => {
  const editing = !!type;
  const save = useSaveLeaveType(type?._id);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FormIn, unknown, FormOut>({ resolver: zodResolver(leaveTypeSchema), defaultValues: toForm(type) });
  const { register, control, handleSubmit, reset, setError, formState } = form;
  const errors = formState.errors;
  const v = useWatch({ control });

  useEffect(() => {
    if (open) {
      reset(toForm(type));
      setServerError(null);
    }
  }, [open, type, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const payload = {
        ...values,
        description: values.description || undefined,
        maximumCarryForward: values.carryForward ? values.maximumCarryForward : 0,
        documentRequiredAfterDays: values.documentRequired ? values.documentRequiredAfterDays : 0,
      };
      const res = await save.mutateAsync(payload);
      toast.success(res.message ?? (editing ? 'Leave type updated' : 'Leave type created'));
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, Object.keys(toForm())));
    }
  });

  const num = (name: keyof FormIn, lbl: string, hint?: string, step = '1') => (
    <FormField label={lbl} error={errors[name] as { message?: string } | undefined} hint={hint}>
      {({ id, invalid }) => <Input id={id} type="number" inputMode="decimal" min={0} max={365} step={step} aria-invalid={invalid} {...register(name)} />}
    </FormField>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${type?.name}` : 'New leave type'}
      description="Policies apply to new requests. Existing balances are recalculated on the next accrual run."
      width="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            {editing ? 'Save changes' : 'Create leave type'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-8">
        <FormError error={serverError} />

        <FormSection title="Basics">
          <FormGrid>
            <FormField label="Name" required error={errors.name}>
              {({ id, invalid }) => <Input id={id} aria-invalid={invalid} placeholder="e.g. Casual Leave" {...register('name')} />}
            </FormField>
            <FormField label="Code" required error={errors.code ? 'Use 1–10 letters, digits, - or _' : undefined} hint="Short unique code, e.g. CL">
              {({ id, invalid }) => <Input id={id} aria-invalid={invalid} className="font-mono uppercase" maxLength={10} {...register('code')} />}
            </FormField>
          </FormGrid>
          <FormField label="Description" error={errors.description}>
            {({ id }) => <Textarea id={id} rows={2} maxLength={500} {...register('description')} />}
          </FormField>
          <FormField label="Color" error={errors.color} hint="Used on balance cards and the leave calendar.">
            {({ id }) => (
              <div className="flex flex-wrap items-center gap-2">
                <Controller
                  control={control}
                  name="color"
                  render={({ field }) => (
                    <>
                      <div role="radiogroup" aria-label="Preset colors" className="flex flex-wrap gap-1.5">
                        {PRESET_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            role="radio"
                            aria-checked={field.value === c}
                            aria-label={c}
                            onClick={() => field.onChange(c)}
                            className="h-7 w-7 rounded-full ring-offset-2 ring-offset-surface transition-shadow aria-checked:ring-2 aria-checked:ring-fg"
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                      <input id={id} type="color" aria-label="Custom color" value={field.value ?? '#0ea5e9'} onChange={(e) => field.onChange(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-line-strong bg-surface p-0.5" />
                    </>
                  )}
                />
              </div>
            )}
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <SwitchRow control={control} name="active" title="Active" description="Inactive types cannot be applied for." />
            <SwitchRow control={control} name="isWorkFromHome" title="Work from home" description="Marks days as WFH instead of absence." />
          </div>
        </FormSection>

        <FormSection title="Entitlement">
          <FormGrid cols={3}>
            {num('annualAllowance', 'Days per year', undefined, '0.5')}
            <FormField label="Accrual" error={errors.accrual}>
              {({ id }) => (
                <Select
                  id={id}
                  options={[
                    { value: 'ANNUAL', label: 'Annual (credited upfront)' },
                    { value: 'MONTHLY', label: 'Monthly (1/12 each month)' },
                  ]}
                  {...register('accrual')}
                />
              )}
            </FormField>
          </FormGrid>
          <SwitchRow control={control} name="paid" title="Paid leave" description="Unpaid leave is not limited by balance and is deducted in payroll." />
        </FormSection>

        <FormSection title="Year end">
          <SwitchRow control={control} name="carryForward" title="Carry forward unused days" description="Moves unused balance into the next leave year.">
            {v.carryForward && <div className="max-w-48">{num('maximumCarryForward', 'Maximum days to carry', '0 = no limit', '0.5')}</div>}
          </SwitchRow>
          <SwitchRow control={control} name="encashment" title="Encashment" description="Unused days can be paid out." />
        </FormSection>

        <FormSection title="Rules">
          <SwitchRow control={control} name="halfDayAllowed" title="Allow half days" description="Employees can request a first or second half." />
          <SwitchRow control={control} name="documentRequired" title="Require a supporting document" description="e.g. a medical certificate.">
            {v.documentRequired && <div className="max-w-56">{num('documentRequiredAfterDays', 'Only when longer than (days)', '0 = always required')}</div>}
          </SwitchRow>
          <FormGrid>
            {num('maxConsecutiveDays', 'Max consecutive days', '0 = no limit')}
            {num('minNoticeDays', 'Minimum notice (days)', '0 = can apply same day')}
          </FormGrid>
        </FormSection>

        <FormSection title="Eligibility" description="Leave empty to make this type available to everyone.">
          <Controller
            control={control}
            name="applicableGenders"
            render={({ field }) => {
              const selected = (field.value ?? []) as string[];
              return (
                <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <legend className="sr-only">Applicable genders</legend>
                  {GENDERS.map((g) => (
                    <Checkbox
                      key={g}
                      label={label(g)}
                      checked={selected.includes(g)}
                      onChange={(e) => field.onChange(e.target.checked ? [...selected, g] : selected.filter((s) => s !== g))}
                    />
                  ))}
                </fieldset>
              );
            }}
          />
        </FormSection>
      </form>
    </Drawer>
  );
};

const rules = (t: LeaveType) => {
  const out: string[] = [];
  if (t.halfDayAllowed) out.push('Half day');
  if (t.minNoticeDays) out.push(`${t.minNoticeDays}d notice`);
  if (t.maxConsecutiveDays) out.push(`Max ${t.maxConsecutiveDays}d`);
  if (t.documentRequired) out.push(t.documentRequiredAfterDays ? `Doc > ${t.documentRequiredAfterDays}d` : 'Doc required');
  if (t.applicableGenders?.length) out.push(t.applicableGenders.map(label).join('/'));
  return out;
};

export const LeaveTypesPage = () => {
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'name', sortOrder: 'asc' });
  const list = useLeaveTypesPage(query);
  const { can } = usePermissions();
  const canManage = can('leave_type:manage');
  const confirm = useConfirm();
  const archive = useArchiveLeaveType();
  const [editing, setEditing] = useState<LeaveType | null | 'new'>(null);

  const onArchive = async (t: LeaveType) => {
    const { confirmed } = await confirm({
      title: `Archive ${t.name}?`,
      message: 'Employees can no longer apply for this type. Existing requests and balances are kept. Archiving is blocked while requests of this type await approval.',
      confirmLabel: 'Archive',
    });
    if (!confirmed) return;
    try {
      const res = await archive.mutateAsync(t._id);
      toast.success(res.message ?? 'Leave type archived');
    } catch {
      // Toasted globally.
    }
  };

  const columns = useMemo<ColumnDef<LeaveType, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Leave type',
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <span className="flex items-center gap-3">
            <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: row.original.color }} aria-hidden />
            <span className="min-w-0">
              <span className="block truncate font-medium text-fg">{row.original.name}</span>
              <span className="block font-mono text-xs text-muted">{row.original.code}</span>
            </span>
          </span>
        ),
      },
      {
        id: 'annualAllowance',
        header: 'Allowance',
        enableSorting: true,
        cell: ({ row }) => (
          <span>
            <span className="font-medium text-fg tabular-nums">{formatNum(row.original.annualAllowance)}</span> days/yr
            <span className="block text-xs text-muted">{row.original.accrual === 'MONTHLY' ? 'Accrues monthly' : 'Credited annually'}</span>
          </span>
        ),
      },
      {
        id: 'paid',
        header: 'Pay',
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            <Badge tone={row.original.paid ? 'green' : 'gray'}>{row.original.paid ? 'Paid' : 'Unpaid'}</Badge>
            {row.original.isWorkFromHome && (
              <Badge tone="blue">
                <Home className="h-3 w-3" aria-hidden />
                WFH
              </Badge>
            )}
          </span>
        ),
      },
      {
        id: 'carryForward',
        header: 'Carry forward',
        cell: ({ row }) =>
          row.original.carryForward ? `Up to ${row.original.maximumCarryForward ? `${formatNum(row.original.maximumCarryForward)} days` : 'full balance'}` : <span className="text-muted">No</span>,
      },
      {
        id: 'rules',
        header: 'Rules',
        cell: ({ row }) => {
          const r = rules(row.original);
          return r.length ? (
            <span className="flex max-w-72 flex-wrap gap-1">
              {r.map((x) => (
                <Badge key={x}>{x}</Badge>
              ))}
            </span>
          ) : (
            <span className="text-muted">—</span>
          );
        },
      },
      { id: 'active', header: 'Status', cell: ({ row }) => <Badge tone={row.original.active ? 'green' : 'gray'} dot>{row.original.active ? 'Active' : 'Inactive'}</Badge> },
      ...(canManage
        ? [
            {
              id: 'actions',
              header: '',
              enableHiding: false,
              cell: ({ row }: { row: { original: LeaveType } }) => (
                <div className="flex justify-end" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <Dropdown
                    label={`Actions for ${row.original.name}`}
                    trigger={
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3">
                        <MoreHorizontal className="h-4 w-4" />
                      </span>
                    }
                    items={[
                      { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(row.original) },
                      { label: 'Archive', icon: <Archive className="h-4 w-4" />, danger: true, onSelect: () => void onArchive(row.original) },
                    ]}
                  />
                </div>
              ),
            } as ColumnDef<LeaveType, unknown>,
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManage],
  );

  const filterKeys = ['search', 'active'];

  return (
    <>
      <PageHeader
        title="Leave types"
        description="Policies that control entitlement, accrual, carry forward and approval rules."
        breadcrumb={[{ label: 'Leave', to: '/leave' }, { label: 'Leave types' }]}
        actions={
          canManage && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Add leave type
            </Button>
          )
        }
      />
      <DataTable
        caption="Leave types"
        storageKey="leave-types"
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
        onRowClick={canManage ? (row) => setEditing(row) : undefined}
        emptyTitle={hasFilters(filterKeys) ? 'No matching leave types' : 'No leave types yet'}
        emptyDescription={hasFilters(filterKeys) ? 'Try changing your filters.' : 'Create leave types such as Casual, Sick and Earned leave so employees can apply.'}
        emptyAction={
          canManage && !hasFilters(filterKeys) ? (
            <Button icon={<CalendarCog className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Add leave type
            </Button>
          ) : undefined
        }
        toolbar={
          <FilterBar active={hasFilters(filterKeys)} onClear={() => clear(['sortBy', 'sortOrder'])}>
            <SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder="Search name or code…" />
            <Select
              aria-label="Status"
              className="w-full min-w-0 sm:w-36"
              value={String(params.active ?? '')}
              onChange={(e) => set({ active: e.target.value })}
              options={[
                { value: 'true', label: 'Active' },
                { value: 'false', label: 'Inactive' },
              ]}
              placeholder="All statuses"
            />
          </FilterBar>
        }
      />
      <LeaveTypeDrawer open={editing !== null} type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
    </>
  );
};
