import { useMemo, useState, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, Check, CheckCheck, Eye, MoreHorizontal, Pencil, Send, X } from 'lucide-react';
import { LEAVE_STATUS } from '@stencil/shared';
import { EmployeePicker, FilterBar } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { PersonCell } from '@/components/ui/display';
import { Input, Select } from '@/components/ui/input';
import { Dropdown, useConfirm } from '@/components/ui/overlay';
import type { useListParams } from '@/hooks/use-list-params';
import { label } from '@/lib/i18n';
import { formatDate, fullName, timeAgo } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { formatNum, leaveKeys, typeOf, useActiveLeaveTypes, useLeaves, type LeaveRequest, type LeaveScope } from '../api';
import { canCancelLeave, canDecideLeave, canEditLeave, canRejectLeave, LeaveTypeLabel, leaveRange } from './leave-ui';
import { bulkApprove, useLeaveActions } from './use-leave-actions';

type ListState = ReturnType<typeof useListParams>;

export interface LeaveTableProps {
  scope: LeaveScope;
  list: ListState;
  /** Restrict to one employee (profile tab). */
  employeeId?: string;
  onOpen: (l: LeaveRequest) => void;
  onEdit?: (l: LeaveRequest) => void;
  filters?: { employee?: boolean; type?: boolean; status?: boolean; dates?: boolean };
  storageKey: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  /** Keys that are not API filters (e.g. page tab / drawer id) and must not be sent. */
  ignoreKeys?: string[];
}

const FILTER_KEYS = ['status', 'leaveTypeId', 'employeeId', 'from', 'to'];

export const LeaveTable = ({
  scope,
  list,
  employeeId,
  onOpen,
  onEdit,
  filters = { type: true, status: true, dates: true },
  storageKey,
  emptyTitle = 'No leave requests',
  emptyDescription,
  emptyAction,
  ignoreKeys = [],
}: LeaveTableProps) => {
  const { params, query, set, clear, hasFilters } = list;
  const { user } = usePermissions();
  const actions = useLeaveActions();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const types = useActiveLeaveTypes();
  const [bulkBusy, setBulkBusy] = useState(false);

  const apiQuery = useMemo(() => {
    const out: Record<string, unknown> = { ...query, scope };
    for (const k of ignoreKeys) delete out[k];
    if (employeeId) out.employeeId = employeeId;
    return out;
  }, [query, scope, employeeId, ignoreKeys]);
  const leaves = useLeaves(apiQuery);
  const showEmployee = scope !== 'me' && !employeeId;
  // After a reload the picker only knows the id; label it from the filtered rows.
  const filteredEmployee = params.employeeId ? leaves.data?.data.find((r) => r.employeeId?._id === params.employeeId)?.employeeId : undefined;
  const filteredEmployeeLabel = filteredEmployee ? { [filteredEmployee._id]: fullName(filteredEmployee) } : undefined;
  const approvals = scope === 'approvals';

  const columns = useMemo<ColumnDef<LeaveRequest, unknown>[]>(() => {
    const cols: ColumnDef<LeaveRequest, unknown>[] = [];
    if (showEmployee) {
      cols.push({
        id: 'employee',
        header: 'Employee',
        enableHiding: false,
        cell: ({ row }) => <PersonCell name={fullName(row.original.employeeId)} subtitle={row.original.employeeId?.employeeId} photo={row.original.employeeId?.profilePhoto} />,
      });
    }
    cols.push(
      { id: 'type', header: 'Type', enableHiding: !showEmployee ? false : true, cell: ({ row }) => <LeaveTypeLabel type={typeOf(row.original)} /> },
      {
        id: 'startDate',
        header: 'Dates',
        enableSorting: true,
        cell: ({ row }) => <span className="text-fg">{leaveRange(row.original)}</span>,
      },
      {
        id: 'days',
        header: 'Days',
        enableSorting: true,
        cell: ({ row }) => <span className="tabular-nums">{formatNum(row.original.days)}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        enableSorting: true,
        cell: ({ row }) => (
          <span className="flex flex-col items-start gap-0.5">
            <StatusBadge status={row.original.status} />
            {row.original.currentApproverType && (row.original.status === 'SUBMITTED' || row.original.status === 'PENDING_APPROVAL') && (
              <span className="text-[11px] text-muted">Awaiting {label(row.original.currentApproverType).toLowerCase()}</span>
            )}
          </span>
        ),
      },
      {
        id: 'reason',
        header: 'Reason',
        cell: ({ row }) => <span className="block max-w-56 truncate" title={row.original.reason}>{row.original.reason}</span>,
      },
      {
        id: 'createdAt',
        header: 'Applied',
        enableSorting: true,
        cell: ({ row }) => <span title={formatDate(row.original.submittedAt ?? row.original.createdAt)}>{timeAgo(row.original.submittedAt ?? row.original.createdAt)}</span>,
      },
      {
        id: 'actions',
        header: '',
        enableHiding: false,
        cell: ({ row }) => {
          const l = row.original;
          const decide = canDecideLeave(user, l);
          const busy = actions.pendingId === l._id;
          return (
            <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              {approvals && decide && (
                <>
                  {canRejectLeave(user, l) && (
                    <Button variant="outline" size="xs" icon={<X className="h-3.5 w-3.5" />} disabled={busy} onClick={() => void actions.reject(l)} aria-label={`Reject leave for ${fullName(l.employeeId)}`}>
                      Reject
                    </Button>
                  )}
                  <Button variant="success" size="xs" icon={<Check className="h-3.5 w-3.5" />} loading={busy} onClick={() => void actions.approve(l)} aria-label={`Approve leave for ${fullName(l.employeeId)}`}>
                    Approve
                  </Button>
                </>
              )}
              <Dropdown
                label={`Actions for ${typeOf(l)?.name ?? 'leave'} ${leaveRange(l)}`}
                trigger={
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3">
                    <MoreHorizontal className="h-4 w-4" />
                  </span>
                }
                items={[
                  { label: 'View details', icon: <Eye className="h-4 w-4" />, onSelect: () => onOpen(l) },
                  { label: 'Edit draft', icon: <Pencil className="h-4 w-4" />, onSelect: () => onEdit?.(l), hidden: !onEdit || !canEditLeave(user, l) },
                  { label: 'Submit', icon: <Send className="h-4 w-4" />, onSelect: () => void actions.submit(l), hidden: !canEditLeave(user, l) },
                  { label: 'Approve', icon: <Check className="h-4 w-4" />, onSelect: () => void actions.approve(l), hidden: approvals || !decide },
                  { label: 'Reject', icon: <X className="h-4 w-4" />, onSelect: () => void actions.reject(l), hidden: approvals || !canRejectLeave(user, l), danger: true },
                  {
                    label: l.status === 'DRAFT' ? 'Discard draft' : 'Cancel leave',
                    icon: <Ban className="h-4 w-4" />,
                    onSelect: () => void actions.cancel(l),
                    hidden: !canCancelLeave(user, l),
                    danger: true,
                  },
                ]}
              />
            </div>
          );
        },
      },
    );
    return cols;
  }, [showEmployee, approvals, user, actions, onOpen, onEdit]);

  const onBulkApprove = async (rows: LeaveRequest[], clearSelection: () => void) => {
    const eligible = rows.filter((r) => canDecideLeave(user, r));
    if (!eligible.length) {
      toast.error('None of the selected requests can be approved by you.');
      return;
    }
    const { confirmed } = await confirm({
      title: `Approve ${eligible.length} leave request${eligible.length === 1 ? '' : 's'}?`,
      message: 'Each request is approved at its current step. Employees are notified when their leave is fully approved.',
      confirmLabel: `Approve ${eligible.length}`,
      tone: 'primary',
    });
    if (!confirmed) return;
    setBulkBusy(true);
    const toastId = toast.loading(`Approving 0 of ${eligible.length}…`);
    const { ok, failures } = await bulkApprove(eligible, (done) => toast.loading(`Approving ${done} of ${eligible.length}…`, { id: toastId }));
    setBulkBusy(false);
    clearSelection();
    await qc.invalidateQueries({ queryKey: leaveKeys.all });
    if (!failures.length) toast.success(`Approved ${ok} request${ok === 1 ? '' : 's'}`, { id: toastId });
    else if (!ok) toast.error(`No requests were approved`, { id: toastId, description: failures[0]!.message });
    else
      toast.warning(`Approved ${ok}, ${failures.length} failed`, {
        id: toastId,
        description: failures
          .slice(0, 3)
          .map((f) => `${fullName(f.row.employeeId)}: ${f.message}`)
          .join('\n'),
      });
  };

  const active = hasFilters(FILTER_KEYS.filter((k) => k !== 'employeeId' || !employeeId));
  const showToolbar = filters.employee || filters.type || filters.status || filters.dates;

  return (
    <DataTable
      caption={`Leave requests (${scope})`}
      storageKey={storageKey}
      columns={columns}
      data={leaves.data?.data}
      loading={leaves.isLoading || leaves.isFetching}
      error={leaves.error}
      onRetry={() => leaves.refetch()}
      pagination={leaves.data?.pagination}
      onPageChange={(page) => set({ page })}
      onLimitChange={(limit) => set({ limit })}
      sorting={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
      onSortingChange={(s) => set({ sortBy: s.sortBy, sortOrder: s.sortOrder })}
      onRowClick={onOpen}
      getRowId={(r) => r._id}
      emptyTitle={active ? 'No matching requests' : emptyTitle}
      emptyDescription={active ? 'Try changing or clearing your filters.' : emptyDescription}
      emptyAction={active ? undefined : emptyAction}
      bulkActions={
        approvals
          ? (rows, clearSelection) => (
              <Button size="sm" variant="success" icon={<CheckCheck className="h-4 w-4" />} loading={bulkBusy} onClick={() => void onBulkApprove(rows, clearSelection)}>
                Approve selected
              </Button>
            )
          : undefined
      }
      toolbar={
        showToolbar ? (
          <div className="w-full min-w-0">
          <FilterBar active={active} onClear={() => clear([...ignoreKeys, 'sortBy', 'sortOrder'])}>
            {filters.employee && !employeeId && (
              <div className="w-full min-w-0 sm:w-60">
                <label htmlFor={`${storageKey}-employee`} className="sr-only">
                  Employee
                </label>
                <EmployeePicker
                  id={`${storageKey}-employee`}
                  value={params.employeeId ? String(params.employeeId) : null}
                  selectedLabels={filteredEmployeeLabel}
                  onChange={(v) => set({ employeeId: (v as string | null) ?? undefined })}
                  placeholder="All employees"
                />
              </div>
            )}
            {filters.type && (
              <Select
                aria-label="Leave type"
                className="w-full min-w-0 sm:w-44"
                value={String(params.leaveTypeId ?? '')}
                onChange={(e) => set({ leaveTypeId: e.target.value })}
                options={(types.data ?? []).map((t) => ({ value: t._id, label: t.name }))}
                placeholder="All leave types"
              />
            )}
            {filters.status && (
              <Select
                aria-label="Status"
                className="w-full min-w-0 sm:w-44"
                value={String(params.status ?? '')}
                onChange={(e) => set({ status: e.target.value })}
                options={LEAVE_STATUS.filter((s) => scope === 'me' || s !== 'DRAFT').map((s) => ({ value: s, label: label(s) }))}
                placeholder="All statuses"
              />
            )}
            {filters.dates && (
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <div className="min-w-0 flex-1 sm:w-[9.5rem] sm:flex-none">
                  <Input type="date" aria-label="From date" value={String(params.from ?? '')} max={params.to ? String(params.to) : undefined} onChange={(e) => set({ from: e.target.value })} />
                </div>
                <span className="text-muted" aria-hidden>
                  –
                </span>
                <div className="min-w-0 flex-1 sm:w-[9.5rem] sm:flex-none">
                  <Input type="date" aria-label="To date" value={String(params.to ?? '')} min={params.from ? String(params.from) : undefined} onChange={(e) => set({ to: e.target.value })} />
                </div>
              </div>
            )}
          </FilterBar>
          </div>
        ) : undefined
      }
    />
  );
};
