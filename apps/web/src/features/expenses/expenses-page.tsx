import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Ban, Eye, MoreHorizontal, Pencil, Plus, Receipt, Send } from 'lucide-react';
import { EXPENSE_CATEGORIES, EXPENSE_STATUS } from '@stencil/shared';
import { FilterBar, SearchInput } from '@/components/common/controls';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/display';
import { DateRangePicker, Select } from '@/components/ui/input';
import { Dropdown } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { label } from '@/lib/i18n';
import { usePermissions } from '@/store/auth';
import { PENDING_STATUSES, useExpense, useExpenses, useExpenseSummary, type ExpenseRecord } from './api';
import { useExpenseActions } from './components/expense-actions';
import { expenseColumns } from './components/expense-columns';
import { ExpenseDetailDrawer } from './components/expense-detail-drawer';
import { ExpenseFormDrawer } from './components/expense-form-drawer';
import { ExpenseSummaryCards } from './components/expense-summary';

const FILTER_KEYS = ['search', 'status', 'category', 'from', 'to'];

export const ExpensesPage = () => {
  const { id: openId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { can, user, hasEmployee } = usePermissions();
  const currency = user?.organization.currency ?? 'USD';
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'createdAt', sortOrder: 'desc' });
  const list = useExpenses({ ...query, scope: 'me' });
  const summary = useExpenseSummary({ scope: 'me', from: params.from ? String(params.from) : undefined, to: params.to ? String(params.to) : undefined });
  const actions = useExpenseActions();
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const editing = useExpense(editId);
  const canCreate = hasEmployee || can('expense:create');
  const filtered = hasFilters(FILTER_KEYS);

  const openDetail = (id: string | null) => navigate({ pathname: id ? `/expenses/${id}` : '/expenses', search: location.search }, { replace: !!openId && !!id });

  const columns = expenseColumns({
    actions: (e: ExpenseRecord) => (
      <Dropdown
        label={`Actions for ${e.expenseNumber}`}
        trigger={
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3">
            <MoreHorizontal className="h-4 w-4" />
          </span>
        }
        items={[
          { label: 'View details', icon: <Eye className="h-4 w-4" />, onSelect: () => openDetail(e._id) },
          { label: 'Edit draft', icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditId(e._id), hidden: e.status !== 'DRAFT' },
          { label: 'Submit for approval', icon: <Send className="h-4 w-4" />, onSelect: () => void actions.submit(e), hidden: e.status !== 'DRAFT' },
          { label: 'Cancel claim', icon: <Ban className="h-4 w-4" />, danger: true, onSelect: () => void actions.cancel(e), hidden: e.status !== 'DRAFT' && !PENDING_STATUSES.includes(e.status) },
        ]}
      />
    ),
  });

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Your reimbursement claims, from receipt to payment."
        actions={
          canCreate ? (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)} className="w-full sm:w-auto">
              New expense
            </Button>
          ) : undefined
        }
      />
      <ExpenseSummaryCards summary={summary.data} loading={summary.isLoading} currency={currency} />
      <DataTable
        caption="My expenses"
        storageKey="my-expenses"
        columns={columns}
        getRowId={(e) => e._id}
        data={list.data?.data}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => list.refetch()}
        pagination={list.data?.pagination}
        onPageChange={(page) => set({ page })}
        onLimitChange={(limit) => set({ limit })}
        sorting={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
        onSortingChange={(s) => set({ sortBy: s.sortBy, sortOrder: s.sortOrder })}
        onRowClick={(e) => openDetail(e._id)}
        emptyTitle={filtered ? 'No expenses match your filters' : 'No expenses yet'}
        emptyDescription={
          filtered ? 'Try changing or clearing the filters.' : canCreate ? 'Snap a photo of your receipt and submit your first claim.' : 'Your account is not linked to an employee profile.'
        }
        emptyAction={
          !filtered && canCreate ? (
            <Button icon={<Receipt className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New expense
            </Button>
          ) : undefined
        }
        toolbar={
          <FilterBar active={filtered} onClear={() => clear(['sortBy', 'sortOrder'])}>
            <SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder="Search number, merchant, description…" />
            <Select aria-label="Status" className="w-full sm:w-44" value={String(params.status ?? '')} onChange={(e) => set({ status: e.target.value })} options={EXPENSE_STATUS.map((s) => ({ value: s, label: label(s) }))} placeholder="All statuses" />
            <Select aria-label="Category" className="w-full sm:w-44" value={String(params.category ?? '')} onChange={(e) => set({ category: e.target.value })} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: label(c) }))} placeholder="All categories" />
            <DateRangePicker from={params.from ? String(params.from) : undefined} to={params.to ? String(params.to) : undefined} onChange={(r) => set({ from: r.from, to: r.to })} />
          </FilterBar>
        }
      />
      <ExpenseDetailDrawer
        id={openId ?? null}
        onClose={() => openDetail(null)}
        onEdit={(e) => {
          openDetail(null);
          setEditId(e._id);
        }}
      />
      <ExpenseFormDrawer
        open={creating || (!!editId && !!editing.data)}
        expense={editId ? editing.data : null}
        onClose={(saved) => {
          setCreating(false);
          setEditId(null);
          if (saved) openDetail(saved._id);
        }}
      />
      {actions.element}
    </>
  );
};
