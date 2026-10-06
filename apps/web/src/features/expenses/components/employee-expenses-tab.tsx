import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EXPENSE_STATUS } from '@stencil/shared';
import { DataTable } from '@/components/tables/data-table';
import { Select } from '@/components/ui/input';
import { label } from '@/lib/i18n';
import { useExpenses } from '../api';
import { expenseColumns } from './expense-columns';
import { ExpenseDetailDrawer } from './expense-detail-drawer';

/** Expenses tab on the employee profile (scoped by the API to what the viewer may see). */
const EmployeeExpensesTab = ({ employeeId }: { employeeId: string }) => {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<{ sortBy?: string; sortOrder: 'asc' | 'desc' }>({ sortBy: 'date', sortOrder: 'desc' });
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useExpenses({ employeeId, page, limit, status: status || undefined, ...sort });
  const columns = useMemo(() => expenseColumns({ showStep: true }), []);

  return (
    <>
      <DataTable
        caption="Expense claims"
        storageKey="employee-expenses"
        columns={columns}
        getRowId={(e) => e._id}
        data={list.data?.data}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => list.refetch()}
        pagination={list.data?.pagination}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
        sorting={sort}
        onSortingChange={(s) => {
          setSort(s);
          setPage(1);
        }}
        onRowClick={(e) => setOpenId(e._id)}
        emptyTitle={status ? 'No expenses with this status' : 'No expense claims'}
        emptyDescription={status ? 'Try another status.' : 'Reimbursement claims submitted by this employee appear here.'}
        toolbar={
          <Select
            aria-label="Status"
            className="w-full sm:w-44"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            options={EXPENSE_STATUS.map((s) => ({ value: s, label: label(s) }))}
            placeholder="All statuses"
          />
        }
      />
      <ExpenseDetailDrawer id={openId} onClose={() => setOpenId(null)} onEdit={(e) => navigate(`/expenses/${e._id}`)} />
    </>
  );
};

export default EmployeeExpensesTab;
