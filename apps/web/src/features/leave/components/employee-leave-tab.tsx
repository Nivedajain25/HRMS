import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { useListParams } from '@/hooks/use-list-params';
import { usePermissions } from '@/store/auth';
import type { LeaveRequest, LeaveScope } from '../api';
import { ApplyLeaveDrawer } from './apply-leave-drawer';
import { BalanceCards } from './balance-cards';
import { LeaveDetailDrawer } from './leave-detail-drawer';
import { LeaveTable } from './leave-table';

/** Leave tab on the employee profile: balances + that employee's requests. */
const EmployeeLeaveTab = ({ employeeId }: { employeeId: string }) => {
  const { user, can, isManager } = usePermissions();
  const self = user?.employeeId === employeeId;
  const scope: LeaveScope | null = self ? 'me' : can('leave:read') ? 'all' : isManager ? 'team' : null;
  const list = useListParams({ sortBy: 'startDate', sortOrder: 'desc' });
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<LeaveRequest | null>(null);

  return (
    <div className="space-y-6">
      <section aria-labelledby="emp-leave-balances">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="emp-leave-balances" className="text-sm font-semibold text-fg">
            Leave balances
          </h2>
          <Select
            aria-label="Balance year"
            className="h-8 w-24"
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value))}
            options={[thisYear - 1, thisYear, thisYear + 1].map((y) => ({ value: String(y), label: String(y) }))}
          />
        </div>
        <BalanceCards employeeId={self ? undefined : employeeId} year={year} />
      </section>

      <section aria-labelledby="emp-leave-requests" className="space-y-3">
        <h2 id="emp-leave-requests" className="text-sm font-semibold text-fg">
          Leave requests
        </h2>
        {scope ? (
          <LeaveTable
            scope={scope}
            list={list}
            employeeId={self ? undefined : employeeId}
            ignoreKeys={['tab']}
            storageKey="employee-leave"
            onOpen={(l) => setOpenId(l._id)}
            onEdit={self ? (l) => setEditing(l) : undefined}
            filters={{ type: true, status: true, dates: true }}
            emptyTitle="No leave requests"
            emptyDescription={self ? 'Requests you apply for appear here.' : 'This employee has not requested any leave.'}
          />
        ) : (
          <EmptyState className="card" icon={<ShieldAlert className="h-6 w-6" />} title="Leave requests not available" description="You do not have access to this employee's leave requests." />
        )}
      </section>

      <LeaveDetailDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        onEdit={(l) => {
          setOpenId(null);
          setEditing(l);
        }}
      />
      {self && <ApplyLeaveDrawer open={!!editing} draft={editing} onClose={() => setEditing(null)} />}
    </div>
  );
};

export default EmployeeLeaveTab;
