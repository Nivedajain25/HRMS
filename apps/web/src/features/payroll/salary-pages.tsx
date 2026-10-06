import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, MoreHorizontal, Pencil, Plus, Trash2, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { SALARY_COMPONENT_TYPES } from '@stencil/shared';
import { FilterBar, SearchInput } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, PageSkeleton, PersonCell } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { Dropdown, Tabs, useConfirm } from '@/components/ui/overlay';
import { toOptions, useAllOf } from '@/features/employees/api';
import { useListParams } from '@/hooks/use-list-params';
import { label } from '@/lib/i18n';
import { cn, formatDate, formatMoney, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useArchiveComponent, useComponentList, useEmployeeSalary, useSalaryList, type SalaryComponent, type SalaryListRow, type SalaryStructure } from './api';
import { ComponentFormDrawer } from './components/component-form-drawer';
import { QueryError, StructureBreakdown } from './components/payroll-ui';
import { SalaryRevisionDrawer } from './components/salary-revision-drawer';
import { CALC_LABELS, isPercent, useOrgCurrency } from './lib';

const SalaryTabs = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <Tabs
      className="mb-6"
      tabs={[
        { key: '/salary', label: 'Employees' },
        { key: '/salary/components', label: 'Salary components' },
      ]}
      active={pathname.startsWith('/salary/components') ? '/salary/components' : '/salary'}
      onChange={(key) => navigate(key)}
    />
  );
};

/* ------------------------------ Salary list ------------------------------ */

export const SalaryListPage = () => {
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'firstName', sortOrder: 'asc' });
  const list = useSalaryList(query);
  const departments = useAllOf('departments');
  const { can } = usePermissions();
  const navigate = useNavigate();
  const orgCurrency = useOrgCurrency();
  const [revising, setRevising] = useState<{ id?: string; label?: string } | null>(null);
  const canUpdate = can('salary:update');

  const columns = useMemo<ColumnDef<SalaryListRow, unknown>[]>(
    () => [
      {
        id: 'firstName',
        header: 'Employee',
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => <PersonCell name={fullName(row.original)} subtitle={[row.original.employeeId, row.original.designationId?.name].filter(Boolean).join(' · ')} photo={row.original.profilePhoto} />,
      },
      { id: 'department', header: 'Department', cell: ({ row }) => row.original.departmentId?.name ?? '—' },
      {
        id: 'ctc',
        header: 'Annual CTC',
        cell: ({ row }) => {
          const s = row.original.currentStructure;
          return s ? <span className="font-medium text-fg tabular-nums">{formatMoney(s.annualCtc, s.currency || orgCurrency)}</span> : <Badge tone="amber">No structure</Badge>;
        },
      },
      { id: 'gross', header: 'Monthly gross', cell: ({ row }) => (row.original.currentStructure ? <span className="tabular-nums">{formatMoney(row.original.currentStructure.monthlyGross, row.original.currentStructure.currency || orgCurrency)}</span> : '—') },
      { id: 'net', header: 'Monthly net', cell: ({ row }) => (row.original.currentStructure ? <span className="tabular-nums">{formatMoney(row.original.currentStructure.monthlyNet, row.original.currentStructure.currency || orgCurrency)}</span> : '—') },
      { id: 'effective', header: 'Effective from', cell: ({ row }) => (row.original.currentStructure ? formatDate(row.original.currentStructure.effectiveFrom) : '—') },
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.employmentStatus} /> },
      ...(canUpdate
        ? [
            {
              id: 'actions',
              header: '',
              enableHiding: false,
              cell: ({ row }: { row: { original: SalaryListRow } }) => (
                <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                  <Button size="xs" variant="outline" icon={<TrendingUp className="h-3.5 w-3.5" />} onClick={() => setRevising({ id: row.original._id, label: `${fullName(row.original)} (${row.original.employeeId})` })}>
                    Revise
                  </Button>
                </div>
              ),
            } as ColumnDef<SalaryListRow, unknown>,
          ]
        : []),
    ],
    [canUpdate, orgCurrency],
  );

  const filterKeys = ['search', 'department'];
  return (
    <>
      <PageHeader
        title="Salary"
        description="Current salary structures. Confidential — visible only to authorized payroll staff."
        actions={
          canUpdate && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setRevising({})}>
              Revise salary
            </Button>
          )
        }
      />
      <SalaryTabs />
      <DataTable
        caption="Employee salaries"
        storageKey="salary"
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
        onRowClick={(r) => navigate(`/salary/${r._id}`)}
        emptyTitle="No employees found"
        emptyDescription={hasFilters(filterKeys) ? 'Try changing your filters.' : 'Active employees appear here with their salary structures.'}
        toolbar={
          <FilterBar active={hasFilters(filterKeys)} onClear={() => clear(['sortBy', 'sortOrder'])}>
            <SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder="Search name, ID, email…" />
            <Select aria-label="Department" className="w-full sm:w-48" value={String(params.department ?? '')} onChange={(e) => set({ department: e.target.value })} options={toOptions(departments.data)} placeholder="All departments" />
          </FilterBar>
        }
      />
      {revising && <SalaryRevisionDrawer key={revising.id ?? 'new'} open onClose={() => setRevising(null)} employeeId={revising.id} employeeLabel={revising.label} />}
    </>
  );
};

/* ----------------------------- Salary detail ----------------------------- */

const ChangeBadge = ({ percent }: { percent: number }) =>
  percent === 0 ? (
    <span className="text-muted">—</span>
  ) : (
    <span className={cn('inline-flex items-center gap-0.5 font-medium tabular-nums', percent > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
      {percent > 0 ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />}
      {percent > 0 ? '+' : ''}
      {percent.toFixed(2)}%
    </span>
  );

/** Current structure, versions and history for one employee (used by the detail page and the profile tab). */
export const EmployeeSalaryPanel = ({ employeeId, onRevise }: { employeeId: string; onRevise?: () => void }) => {
  const salary = useEmployeeSalary(employeeId);
  const orgCurrency = useOrgCurrency();
  if (salary.isLoading) return <PageSkeleton />;
  if (salary.error) return <QueryError className="card" error={salary.error} onRetry={() => salary.refetch()} />;
  if (!salary.data) return null;
  const { current, upcoming, versions, history } = salary.data;
  const display: SalaryStructure | null = current ?? upcoming;

  return (
    <div className="space-y-6">
      {upcoming && current && (
        <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            A revision to {formatMoney(upcoming.annualCtc, upcoming.currency)} annual CTC takes effect on {formatDate(upcoming.effectiveFrom)}.
          </span>
        </div>
      )}
      <Card>
        <CardHeader
          title={current ? 'Current salary structure' : upcoming ? 'Upcoming salary structure' : 'Salary structure'}
          description={display ? `Effective ${formatDate(display.effectiveFrom)}${display.effectiveTo ? ` to ${formatDate(display.effectiveTo)}` : ''}${display.reason ? ` · ${display.reason}` : ''}` : undefined}
          actions={
            onRevise && (
              <Button size="sm" icon={<TrendingUp className="h-4 w-4" />} onClick={onRevise}>
                {display ? 'Revise salary' : 'Set up salary'}
              </Button>
            )
          }
        />
        <CardBody>
          {display ? (
            <StructureBreakdown
              basic={display.basic}
              components={display.components}
              currency={display.currency || orgCurrency}
              gross={display.monthlyGross}
              deductions={display.monthlyDeductions}
              employer={display.monthlyEmployerContributions}
              net={display.monthlyNet}
              ctc={display.annualCtc}
            />
          ) : (
            <EmptyState icon={<AlertTriangle className="h-6 w-6" />} title="No salary structure" description="This employee is skipped by payroll until a salary structure is set up." />
          )}
        </CardBody>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Salary history" description="Every revision with the change in annual CTC." />
          {history.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">No revisions recorded yet.</p>
            </CardBody>
          ) : (
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Salary history</caption>
                <thead className="bg-surface-2 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">Effective</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Previous CTC</th>
                    <th scope="col" className="px-4 py-2.5 text-right">New CTC</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Change</th>
                    <th scope="col" className="px-4 py-2.5">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {history.map((h) => (
                    <tr key={h._id}>
                      <td className="px-4 py-3 whitespace-nowrap text-fg">{formatDate(h.effectiveFrom)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap text-fg-2 tabular-nums">{h.previousCtc ? formatMoney(h.previousCtc, orgCurrency) : '—'}</td>
                      <td className="px-4 py-3 text-right font-medium whitespace-nowrap text-fg tabular-nums">{formatMoney(h.newCtc, orgCurrency)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">{h.previousCtc ? <ChangeBadge percent={h.changePercent} /> : <Badge tone="brand">Initial</Badge>}</td>
                      <td className="min-w-48 px-4 py-3 text-fg-2">
                        {h.reason ?? '—'}
                        {h.changedBy && <span className="block text-xs text-muted">by {fullName(h.changedBy)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Structure versions" description="Salary structures are versioned by effective date and never overwritten." />
          {versions.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">No versions yet.</p>
            </CardBody>
          ) : (
            <ol className="divide-y divide-line">
              {versions.map((v) => {
                const isCurrent = current?._id === v._id;
                const isUpcoming = upcoming?._id === v._id;
                return (
                  <li key={v._id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                        {formatDate(v.effectiveFrom)} – {v.effectiveTo ? formatDate(v.effectiveTo) : 'present'}
                        {isCurrent && <Badge tone="green">Current</Badge>}
                        {isUpcoming && <Badge tone="blue">Upcoming</Badge>}
                      </p>
                      <p className="text-xs text-muted">{v.reason ?? 'No reason recorded'}</p>
                    </div>
                    <dl className="grid grid-cols-3 gap-4 text-right text-xs">
                      <div>
                        <dt className="text-muted">Gross</dt>
                        <dd className="text-sm font-medium text-fg tabular-nums">{formatMoney(v.monthlyGross, v.currency)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">Net</dt>
                        <dd className="text-sm font-medium text-fg tabular-nums">{formatMoney(v.monthlyNet, v.currency)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">CTC</dt>
                        <dd className="text-sm font-medium text-fg tabular-nums">{formatMoney(v.annualCtc, v.currency)}</dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
};

export const SalaryDetailPage = () => {
  const { employeeId = '' } = useParams();
  const salary = useEmployeeSalary(employeeId);
  const { can } = usePermissions();
  const [revising, setRevising] = useState(false);
  const e = salary.data?.employee;
  const name = e ? fullName(e) : 'Employee';

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Salary', to: '/salary' }, { label: name }]}
        title={
          e ? (
            <span className="flex items-center gap-3">
              <Avatar name={name} src={e.profilePhoto} size="lg" />
              <span className="min-w-0">
                <span className="block truncate">{name}</span>
                <span className="block text-sm font-normal text-muted">{[e.employeeId, e.designationId?.name, e.departmentId?.name].filter(Boolean).join(' · ')}</span>
              </span>
            </span>
          ) : (
            'Salary'
          )
        }
        actions={
          e && (
            <Link to={`/employees/${e._id}`} className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
              View profile
            </Link>
          )
        }
      />
      <EmployeeSalaryPanel employeeId={employeeId} onRevise={can('salary:update') ? () => setRevising(true) : undefined} />
      {revising && <SalaryRevisionDrawer open onClose={() => setRevising(false)} employeeId={employeeId} employeeLabel={e ? `${name} (${e.employeeId})` : undefined} />}
    </>
  );
};

/* --------------------------- Salary components --------------------------- */

export const SalaryComponentsPage = () => {
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'order', sortOrder: 'asc' });
  const list = useComponentList(query);
  const { can } = usePermissions();
  const canManage = can('salary:update');
  const confirm = useConfirm();
  const archive = useArchiveComponent();
  const currency = useOrgCurrency();
  const [editing, setEditing] = useState<SalaryComponent | 'new' | null>(null);

  const columns = useMemo<ColumnDef<SalaryComponent, unknown>[]>(() => {
    const onArchive = async (c: SalaryComponent) => {
      const { confirmed } = await confirm({
        title: `Archive ${c.name}?`,
        message: 'Archived components cannot be added to new salary structures. Components used by a current or future structure cannot be archived.',
        confirmLabel: 'Archive',
      });
      if (!confirmed) return;
      const res = await archive.mutateAsync(c._id);
      toast.success(res.message ?? 'Salary component archived');
    };
    const valueText = (c: SalaryComponent) =>
      c.calculationType === 'SLAB' ? `${c.slabs.length} slab${c.slabs.length === 1 ? '' : 's'}` : isPercent(c.calculationType) ? `${c.defaultValue}%` : formatMoney(c.defaultValue, currency);
    return [
      {
        id: 'name',
        header: 'Component',
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <span className="block">
            <span className="font-medium text-fg">{row.original.name}</span>
            <span className="block font-mono text-xs text-muted">{row.original.code}</span>
          </span>
        ),
      },
      {
        id: 'type',
        header: 'Type',
        enableSorting: true,
        cell: ({ row }) =>
          row.original.employerContribution ? <Badge tone="purple">Employer contribution</Badge> : <Badge tone={row.original.type === 'EARNING' ? 'green' : 'red'}>{label(row.original.type)}</Badge>,
      },
      { id: 'calculation', header: 'Calculation', cell: ({ row }) => CALC_LABELS[row.original.calculationType] },
      { id: 'value', header: 'Default', cell: ({ row }) => <span className="tabular-nums">{valueText(row.original)}</span> },
      {
        id: 'limits',
        header: 'Limits',
        cell: ({ row }) => {
          const c = row.original;
          const parts = [
            c.maxAmount > 0 && `max ${formatMoney(c.maxAmount, currency)}`,
            c.baseCap > 0 && `base ≤ ${formatMoney(c.baseCap, currency)}`,
            c.eligibilityMaxGross > 0 && `gross ≤ ${formatMoney(c.eligibilityMaxGross, currency)}`,
          ].filter(Boolean);
          return parts.length ? <span className="text-xs">{parts.join(' · ')}</span> : '—';
        },
      },
      {
        id: 'flags',
        header: 'Flags',
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.isStatutory && <Badge tone="blue">Statutory</Badge>}
            {row.original.taxable && <Badge>Taxable</Badge>}
            {row.original.prorate && <Badge>Prorated</Badge>}
          </span>
        ),
      },
      { id: 'order', header: 'Order', enableSorting: true, cell: ({ row }) => row.original.order },
      { id: 'active', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.active ? 'ACTIVE' : 'INACTIVE'} /> },
      ...(canManage
        ? [
            {
              id: 'actions',
              header: '',
              enableHiding: false,
              cell: ({ row }: { row: { original: SalaryComponent } }) => (
                <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                  <Dropdown
                    label={`Actions for ${row.original.name}`}
                    trigger={
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3">
                        <MoreHorizontal className="h-4 w-4" />
                      </span>
                    }
                    items={[
                      { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(row.original) },
                      { label: 'Archive', icon: <Trash2 className="h-4 w-4" />, danger: true, hidden: row.original.code === 'BASIC', onSelect: () => void onArchive(row.original) },
                    ]}
                  />
                </div>
              ),
            } as ColumnDef<SalaryComponent, unknown>,
          ]
        : []),
    ];
  }, [canManage, confirm, archive, currency]);

  const filterKeys = ['search', 'type', 'active'];
  return (
    <>
      <PageHeader
        title="Salary"
        description="Earnings, deductions and employer contributions used to build salary structures."
        actions={
          canManage && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Add component
            </Button>
          )
        }
      />
      <SalaryTabs />
      <div role="note" className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Component templates (e.g. provident fund, social insurance, professional tax) are starting points only and are <strong>not a guarantee of statutory compliance</strong>. Verify rates, caps and
          slabs against current regulations for each jurisdiction with your payroll or tax advisor.
        </span>
      </div>
      <DataTable
        caption="Salary components"
        storageKey="salary-components"
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
        onRowClick={canManage ? (c) => setEditing(c) : undefined}
        emptyTitle="No salary components"
        emptyDescription={hasFilters(filterKeys) ? 'Try changing your filters.' : canManage ? 'Add earnings and deductions to build salary structures.' : undefined}
        emptyAction={
          canManage && !hasFilters(filterKeys) ? (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Add component
            </Button>
          ) : undefined
        }
        toolbar={
          <FilterBar active={hasFilters(filterKeys)} onClear={() => clear(['sortBy', 'sortOrder'])}>
            <SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder="Search name or code…" />
            <Select aria-label="Type" className="w-full sm:w-36" value={String(params.type ?? '')} onChange={(e) => set({ type: e.target.value })} options={SALARY_COMPONENT_TYPES.map((t) => ({ value: t, label: label(t) }))} placeholder="All types" />
            <Select
              aria-label="Status"
              className="w-full sm:w-36"
              value={String(params.active ?? '')}
              onChange={(e) => set({ active: e.target.value })}
              options={[
                { value: 'true', label: 'Active' },
                { value: 'false', label: 'Inactive' },
              ]}
              placeholder="Any status"
            />
          </FilterBar>
        }
      />
      {editing && <ComponentFormDrawer key={editing === 'new' ? 'new' : editing._id} component={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
};
