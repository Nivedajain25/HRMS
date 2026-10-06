import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Paperclip } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { PersonCell } from '@/components/ui/display';
import { label } from '@/lib/i18n';
import { formatDate, formatMoney, fullName } from '@/lib/utils';
import type { ExpenseRecord } from '../api';

const STEP_LABEL: Record<string, string> = { MANAGER: 'Manager', HR: 'HR', FINANCE: 'Finance', PAYROLL: 'Payroll' };

/** Shared expense table columns; `actions` renders the trailing cell. */
export const expenseColumns = (opts: { showEmployee?: boolean; showStep?: boolean; actions?: (e: ExpenseRecord) => ReactNode }): ColumnDef<ExpenseRecord, unknown>[] => [
  ...(opts.showEmployee
    ? [
        {
          id: 'employee',
          header: 'Employee',
          enableHiding: false,
          cell: ({ row }: { row: { original: ExpenseRecord } }) => (
            <PersonCell name={fullName(row.original.employeeId)} subtitle={row.original.employeeId.employeeId} photo={row.original.employeeId.profilePhoto} />
          ),
        } satisfies ColumnDef<ExpenseRecord, unknown>,
      ]
    : []),
  {
    id: 'expenseNumber',
    header: 'Expense',
    enableSorting: true,
    enableHiding: false,
    cell: ({ row }) => (
      <span className="block min-w-0">
        <span className="flex items-center gap-1.5 font-medium text-fg">
          <span className="font-mono text-xs">{row.original.expenseNumber}</span>
          {row.original.receiptFileId && <Paperclip className="h-3.5 w-3.5 text-muted" aria-label="Receipt attached" />}
        </span>
        <span className="block max-w-[18rem] truncate text-xs text-muted">{row.original.description}</span>
      </span>
    ),
  },
  { id: 'date', header: 'Date', enableSorting: true, cell: ({ row }) => formatDate(row.original.date) },
  { id: 'category', header: 'Category', cell: ({ row }) => label(row.original.category) },
  { id: 'merchant', header: 'Merchant', cell: ({ row }) => row.original.merchant || <span className="text-muted">—</span> },
  {
    id: 'amount',
    header: 'Amount',
    enableSorting: true,
    cell: ({ row }) => <span className="font-medium text-fg tabular-nums">{formatMoney(row.original.amount, row.original.currency)}</span>,
  },
  {
    id: 'status',
    header: 'Status',
    enableSorting: true,
    cell: ({ row }) => (
      <span className="flex flex-col items-start gap-0.5">
        <StatusBadge status={row.original.status} />
        {opts.showStep && row.original.currentApproverType && (row.original.status === 'SUBMITTED' || row.original.status === 'PENDING_APPROVAL') && (
          <span className="text-xs text-muted">With {STEP_LABEL[row.original.currentApproverType] ?? label(row.original.currentApproverType)}</span>
        )}
      </span>
    ),
  },
  ...(opts.actions
    ? [
        {
          id: 'actions',
          header: '',
          enableHiding: false,
          cell: ({ row }: { row: { original: ExpenseRecord } }) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              {opts.actions!(row.original)}
            </div>
          ),
        } satisfies ColumnDef<ExpenseRecord, unknown>,
      ]
    : []),
];
