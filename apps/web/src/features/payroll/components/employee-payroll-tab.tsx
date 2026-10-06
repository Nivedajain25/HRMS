import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Pagination } from '@/components/tables/data-table';
import { Card, CardHeader, EmptyState, Skeleton } from '@/components/ui/display';
import { formatDate, formatMoney } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { usePayslips } from '../api';
import { EmployeeSalaryPanel } from '../salary-pages';
import { formatDays, periodLabel } from '../lib';
import { PayslipDrawer, PdfButton, QueryError } from './payroll-ui';
import { SalaryRevisionDrawer } from './salary-revision-drawer';

const EmployeePayslips = ({ employeeId }: { employeeId: string }) => {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const list = usePayslips({ employeeId, page, limit: 12 });
  return (
    <Card>
      <CardHeader title="Payslips" />
      {list.isLoading ? (
        <div className="space-y-2 p-5">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : list.error ? (
        <QueryError error={list.error} onRetry={() => list.refetch()} restrictedText="Payslips are only visible to the employee and payroll staff." />
      ) : !list.data?.data.length ? (
        <EmptyState icon={<FileText className="h-6 w-6" />} title="No payslips yet" description="Payslips appear here once payroll is processed and approved." />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {list.data.data.map((s) => (
              <li key={s._id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpen(s._id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), setOpen(s._id))}
                  className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
                  aria-label={`View payslip for ${periodLabel(s.month, s.year)}`}
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-fg">
                      {periodLabel(s.month, s.year)} <StatusBadge status={s.status} />
                    </p>
                    <p className="text-xs text-muted">
                      {formatDays(s.payableDays)} payable days{s.lopDays ? ` · ${formatDays(s.lopDays)} LOP` : ''}
                      {s.paymentDate ? ` · paid ${formatDate(s.paymentDate)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-fg tabular-nums">{formatMoney(s.netPay, s.currency)}</p>
                      <p className="text-xs text-muted tabular-nums">of {formatMoney(s.grossEarnings, s.currency)} gross</p>
                    </div>
                    <PdfButton slip={s} size="xs" variant="ghost" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {list.data.pagination.totalPages > 1 && <Pagination pagination={list.data.pagination} onPageChange={setPage} loading={list.isFetching} />}
        </>
      )}
      <PayslipDrawer id={open} onClose={() => setOpen(null)} />
    </Card>
  );
};

/** Payroll tab of the employee profile: salary (if permitted) and payslips. */
const EmployeePayrollTab = ({ employeeId }: { employeeId: string }) => {
  const { can, user } = usePermissions();
  const isSelf = user?.employeeId === employeeId;
  const [revising, setRevising] = useState(false);
  return (
    <div className="space-y-6">
      <EmployeeSalaryPanel employeeId={employeeId} onRevise={can('salary:update') ? () => setRevising(true) : undefined} />
      <EmployeePayslips employeeId={employeeId} />
      {isSelf && (
        <p className="text-center text-sm text-muted">
          See all your payslips on the{' '}
          <Link to="/payslips" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Payslips
          </Link>{' '}
          page.
        </p>
      )}
      {revising && <SalaryRevisionDrawer open onClose={() => setRevising(false)} employeeId={employeeId} />}
    </div>
  );
};

export default EmployeePayrollTab;
