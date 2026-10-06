import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Banknote, CheckCircle2, XCircle } from 'lucide-react';
import { EXPENSE_CATEGORIES, EXPENSE_STATUS } from '@stencil/shared';
import { EmployeePicker, FilterBar, SearchInput } from '@/components/common/controls';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/display';
import { DateRangePicker, Select } from '@/components/ui/input';
import { Tabs, useConfirm } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { post } from '@/lib/api';
import { label } from '@/lib/i18n';
import { formatMoney, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { expenseKeys, useExpenses, type ExpenseRecord, type ExpenseScope } from './api';
import { useExpenseActions } from './components/expense-actions';
import { expenseColumns } from './components/expense-columns';
import { ExpenseDetailDrawer } from './components/expense-detail-drawer';

type TabKey = 'approvals' | 'payable' | 'team' | 'all';
const SCOPE: Record<TabKey, ExpenseScope> = { approvals: 'approvals', payable: 'payable', team: 'team', all: 'all' };
const FILTER_KEYS = ['search', 'status', 'category', 'from', 'to', 'employeeId'];

/** Sums amounts per currency for bulk confirmations. */
const totalsLabel = (rows: ExpenseRecord[]) => {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.currency, (map.get(r.currency) ?? 0) + r.amount);
  return [...map.entries()].map(([c, v]) => formatMoney(v, c)).join(' + ');
};

export const ExpenseApprovalsPage = () => {
  const { can, isManager } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const { params, query, set, clear, hasFilters } = useListParams();
  const navigate = useNavigate();
  const actions = useExpenseActions();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const tabs = [
    { key: 'approvals', label: 'Awaiting my approval', hidden: !can('expense:approve') },
    { key: 'payable', label: 'Ready to pay', hidden: !can('expense:pay') },
    { key: 'team', label: 'Team', hidden: !isManager },
    { key: 'all', label: 'All expenses', hidden: !can('expense:read') },
  ];
  const visible = tabs.filter((t) => !t.hidden).map((t) => t.key as TabKey);
  const requested = searchParams.get('tab') as TabKey | null;
  const tab: TabKey = requested && visible.includes(requested) ? requested : (visible[0] ?? 'approvals');
  const queue = tab === 'approvals' || tab === 'payable';

  const { tab: _tab, ...filters } = query;
  void _tab;
  // Queues default to oldest first; history tabs to newest first.
  const sort: { sortBy?: string; sortOrder: 'asc' | 'desc' } = searchParams.has('sortBy')
    ? { sortBy: params.sortBy, sortOrder: params.sortOrder }
    : queue
      ? { sortBy: 'submittedAt', sortOrder: 'asc' }
      : { sortBy: 'createdAt', sortOrder: 'desc' };
  const list = useExpenses({ ...filters, ...sort, scope: SCOPE[tab] }, visible.length > 0);
  const filtered = hasFilters(FILTER_KEYS);
  const selectedEmployee = list.data?.data.find((e) => e.employeeId._id === params.employeeId)?.employeeId;

  const changeTab = (key: string) => setSearchParams(key === visible[0] ? {} : { tab: key }, { replace: true });

  const bulkApprove = async (rows: ExpenseRecord[], clearSelection: () => void) => {
    const { confirmed } = await confirm({
      title: `Approve ${rows.length} ${rows.length === 1 ? 'expense' : 'expenses'}?`,
      message: `Total ${totalsLabel(rows)}. Each claim moves to its next approval step or to payment.`,
      confirmLabel: 'Approve all',
      tone: 'primary',
    });
    if (!confirmed) return;
    setBulkBusy(true);
    const results = await Promise.allSettled(rows.map((r) => post(`/expenses/${r._id}/approve`, {})));
    setBulkBusy(false);
    clearSelection();
    await qc.invalidateQueries({ queryKey: expenseKeys.all });
    const failed = results.filter((r) => r.status === 'rejected').length;
    const ok = rows.length - failed;
    if (ok) toast.success(`${ok} ${ok === 1 ? 'expense' : 'expenses'} approved`);
    if (failed) toast.error(`${failed} could not be approved — they may have been handled by someone else. Refreshed the list.`);
  };

  const rowActions = (e: ExpenseRecord) => {
    const busy = actions.pendingId === e._id;
    if (tab === 'approvals') {
      return (
        <>
          {can('expense:reject') && (
            <Button variant="ghost" size="sm" icon={<XCircle className="h-4 w-4" />} onClick={() => void actions.reject(e)} disabled={busy} aria-label={`Reject ${e.expenseNumber}`}>
              <span className="hidden md:inline">Reject</span>
            </Button>
          )}
          <Button variant="success" size="sm" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => void actions.approve(e)} loading={busy} aria-label={`Approve ${e.expenseNumber}`}>
            <span className="hidden md:inline">Approve</span>
          </Button>
        </>
      );
    }
    if (tab === 'payable') {
      return (
        <Button variant="success" size="sm" icon={<Banknote className="h-4 w-4" />} onClick={() => actions.pay(e)}>
          Mark paid
        </Button>
      );
    }
    return null;
  };

  const columns = expenseColumns({ showEmployee: true, showStep: true, actions: queue ? rowActions : undefined });

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Expenses', to: '/expenses' }, { label: 'Approvals' }]}
        title="Expense approvals"
        description="Review claims, approve or reject them, and record reimbursements."
      />
      <Tabs className="mb-4" tabs={tabs} active={tab} onChange={changeTab} />
      <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <DataTable
          caption={tabs.find((t) => t.key === tab)?.label}
          storageKey={`expense-${tab}`}
          columns={columns}
          getRowId={(e) => e._id}
          data={list.data?.data}
          loading={list.isLoading || list.isFetching || bulkBusy}
          error={list.error}
          onRetry={() => list.refetch()}
          pagination={list.data?.pagination}
          onPageChange={(page) => set({ page })}
          onLimitChange={(limit) => set({ limit })}
          sorting={sort}
          onSortingChange={(s) => set({ sortBy: s.sortBy, sortOrder: s.sortOrder })}
          onRowClick={(e) => setOpenId(e._id)}
          bulkActions={
            tab === 'approvals'
              ? (rows, clearSelection) => (
                  <Button size="sm" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} loading={bulkBusy} onClick={() => void bulkApprove(rows, clearSelection)}>
                    Approve {rows.length}
                  </Button>
                )
              : undefined
          }
          emptyTitle={filtered ? 'No expenses match your filters' : tab === 'approvals' ? 'You’re all caught up' : tab === 'payable' ? 'Nothing waiting for payment' : 'No expenses yet'}
          emptyDescription={
            filtered
              ? 'Try changing or clearing the filters.'
              : tab === 'approvals'
                ? 'Claims that need your decision will appear here.'
                : tab === 'payable'
                  ? 'Fully approved claims appear here until they are marked as paid.'
                  : 'Claims submitted by employees appear here.'
          }
          toolbar={
            <FilterBar active={filtered} onClear={() => clear(['tab'])}>
              <SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder="Search number, merchant, description…" />
              {!queue && (
                <Select aria-label="Status" className="w-full sm:w-44" value={String(params.status ?? '')} onChange={(e) => set({ status: e.target.value })} options={EXPENSE_STATUS.map((s) => ({ value: s, label: label(s) }))} placeholder="All statuses" />
              )}
              <Select aria-label="Category" className="w-full sm:w-44" value={String(params.category ?? '')} onChange={(e) => set({ category: e.target.value })} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: label(c) }))} placeholder="All categories" />
              <DateRangePicker from={params.from ? String(params.from) : undefined} to={params.to ? String(params.to) : undefined} onChange={(r) => set({ from: r.from, to: r.to })} />
              <div className="w-full sm:w-60">
                <EmployeePicker
                  value={params.employeeId ? String(params.employeeId) : null}
                  onChange={(v) => set({ employeeId: typeof v === 'string' ? v : undefined })}
                  selectedLabels={selectedEmployee ? { [selectedEmployee._id]: fullName(selectedEmployee) } : undefined}
                  placeholder="All employees"
                />
              </div>
            </FilterBar>
          }
        />
      </div>
      <ExpenseDetailDrawer id={openId} onClose={() => setOpenId(null)} onEdit={(e) => navigate(`/expenses/${e._id}`)} />
      {actions.element}
    </>
  );
};
