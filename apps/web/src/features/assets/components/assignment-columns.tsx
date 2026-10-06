import type { ColumnDef } from '@tanstack/react-table';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge, PersonCell } from '@/components/ui/display';
import { label } from '@/lib/i18n';
import { apiDateKey, formatDate, fullName, toDateKey } from '@/lib/utils';
import type { AssetAssignment, AssetRef } from '../api';

export type AssignmentRow = AssetAssignment<AssetRef>;

/** Columns for assignment tables (assignments page and employee profile tab). */
export const assignmentColumns = (opts: { showEmployee: boolean }): ColumnDef<AssignmentRow, unknown>[] => [
  {
    id: 'asset',
    header: 'Asset',
    enableHiding: false,
    cell: ({ row }) => {
      const a = row.original.assetId;
      return a ? (
        <span className="block min-w-0">
          <span className="block font-medium text-fg">{a.name}</span>
          <span className="block text-xs text-muted">
            <span className="font-mono">{a.assetTag}</span> · {label(a.category)}
            {a.serialNumber ? ` · SN ${a.serialNumber}` : ''}
          </span>
        </span>
      ) : (
        <span className="text-muted">Deleted asset</span>
      );
    },
  },
  ...(opts.showEmployee
    ? [
        {
          id: 'employee',
          header: 'Employee',
          cell: ({ row }: { row: { original: AssignmentRow } }) => (
            <PersonCell name={fullName(row.original.employeeId)} subtitle={row.original.employeeId.employeeId} photo={row.original.employeeId.profilePhoto} />
          ),
        } satisfies ColumnDef<AssignmentRow, unknown>,
      ]
    : []),
  { id: 'assignedDate', header: 'Assigned', enableSorting: true, cell: ({ row }) => formatDate(row.original.assignedDate) },
  {
    id: 'expectedReturnDate',
    header: 'Expected return',
    cell: ({ row }) => {
      const r = row.original;
      if (!r.expectedReturnDate) return <span className="text-muted">—</span>;
      const overdue = r.status === 'ACTIVE' && apiDateKey(r.expectedReturnDate) < toDateKey(new Date());
      return (
        <span className="flex items-center gap-2">
          {formatDate(r.expectedReturnDate)}
          {overdue && <Badge tone="red">Overdue</Badge>}
        </span>
      );
    },
  },
  {
    id: 'returnedDate',
    header: 'Returned',
    enableSorting: true,
    cell: ({ row }) => (row.original.returnedDate ? formatDate(row.original.returnedDate) : <span className="text-muted">—</span>),
  },
  {
    id: 'condition',
    header: 'Condition',
    cell: ({ row }) => (
      <span className="text-xs">
        {label(row.original.conditionAtAssignment)}
        {row.original.conditionAtReturn ? ` → ${label(row.original.conditionAtReturn)}` : ''}
      </span>
    ),
  },
  { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status === 'ACTIVE' ? 'ASSIGNED' : 'RETURNED'} /> },
];
