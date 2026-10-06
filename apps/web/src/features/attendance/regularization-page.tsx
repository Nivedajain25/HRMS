import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { Check, FilePlus2, Paperclip, X } from 'lucide-react';
import { LEAVE_STATUS } from '@stencil/shared';
import { EmployeePicker, FilterBar } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Badge, PageHeader, PersonCell } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { Tabs } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { label } from '@/lib/i18n';
import { formatDateTime, fullName, timeAgo } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useRegularizations, type Regularization } from './api';
import { RegularizationDrawer, TimeComparison, useRegularizationActions } from './components/regularization-detail';
import { RegularizationFormModal } from './components/regularization-form';
import { formatKey, useOrgTimezone } from './lib';

const PENDING = ['SUBMITTED', 'PENDING_APPROVAL'];
const statusOptions = LEAVE_STATUS.filter((s) => s !== 'DRAFT').map((s) => ({ value: s, label: label(s) }));

const RequestsTable = ({ mode, onOpen, onCreate }: { mode: 'me' | 'approvals'; onOpen: (id: string) => void; onCreate?: () => void }) => {
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'createdAt', sortOrder: 'desc' });
  const timeZone = useOrgTimezone();
  const actions = useRegularizationActions();
  const apiQuery = useMemo(() => {
    const { tab: _tab, date: _date, request: _request, ...rest } = query as Record<string, unknown>;
    void _tab;
    void _date;
    void _request;
    return { ...rest, scope: mode };
  }, [query, mode]);
  const list = useRegularizations(apiQuery);
  const run = (fn: (r: Regularization) => Promise<boolean>, r: Regularization) => () => {
    fn(r).catch(() => undefined);
  };

  const columns = useMemo<ColumnDef<Regularization, unknown>[]>(() => {
    const cols: ColumnDef<Regularization, unknown>[] = [];
    if (mode === 'approvals') {
      cols.push({
        id: 'employee',
        header: 'Employee',
        enableHiding: false,
        cell: ({ row }) => {
          const e = row.original.employeeId;
          return <PersonCell name={fullName(e)} subtitle={[e.employeeId, e.departmentId?.name].filter(Boolean).join(' · ')} photo={e.profilePhoto} />;
        },
      });
    }
    cols.push(
      { id: 'date', header: 'Date', enableSorting: true, cell: ({ row }) => <span className="font-medium text-fg">{formatKey(row.original.date, 'EEE, dd MMM yyyy')}</span> },
      { id: 'times', header: 'Recorded → Requested', cell: ({ row }) => <TimeComparison r={row.original} timeZone={timeZone} /> },
      {
        id: 'reason',
        header: 'Reason',
        cell: ({ row }) => (
          <span className="flex max-w-64 items-center gap-1.5">
            <span className="truncate" title={row.original.reason}>
              {row.original.reason}
            </span>
            {row.original.attachmentId && <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted" aria-label="Has attachment" />}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        enableSorting: true,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <StatusBadge status={row.original.status} />
            {PENDING.includes(row.original.status) && row.original.currentApproverType && <Badge tone="gray">{label(row.original.currentApproverType)}</Badge>}
          </span>
        ),
      },
      { id: 'createdAt', header: 'Submitted', enableSorting: true, cell: ({ row }) => <span title={formatDateTime(row.original.createdAt)}>{timeAgo(row.original.createdAt)}</span> },
      {
        id: 'actions',
        header: '',
        enableHiding: false,
        cell: ({ row }) => {
          const r = row.original;
          if (!PENDING.includes(r.status)) return null;
          return (
            <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
              {mode === 'approvals' ? (
                <>
                  <Button size="xs" variant="success" icon={<Check className="h-3.5 w-3.5" />} disabled={actions.pending} onClick={run(actions.approve, r)} aria-label={`Approve request of ${fullName(r.employeeId)} for ${formatKey(r.date)}`}>
                    Approve
                  </Button>
                  <Button size="xs" variant="outline" icon={<X className="h-3.5 w-3.5" />} disabled={actions.pending} onClick={run(actions.reject, r)} aria-label={`Reject request of ${fullName(r.employeeId)} for ${formatKey(r.date)}`}>
                    Reject
                  </Button>
                </>
              ) : (
                <Button size="xs" variant="outline" disabled={actions.pending} onClick={run(actions.cancel, r)} aria-label={`Cancel request for ${formatKey(r.date)}`}>
                  Cancel
                </Button>
              )}
            </div>
          );
        },
      },
    );
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, timeZone, actions.pending]);

  const filterKeys = ['status', 'employeeId'];
  return (
    <DataTable
      caption={mode === 'me' ? 'My correction requests' : 'Correction requests awaiting approval'}
      storageKey={`regularizations-${mode}`}
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
      onRowClick={(r) => onOpen(r._id)}
      emptyTitle={mode === 'me' ? 'No correction requests' : 'Nothing awaiting your approval'}
      emptyDescription={
        hasFilters(filterKeys) ? 'Try changing your filters.' : mode === 'me' ? 'Missed a clock-in or clock-out? Request a correction.' : 'New requests show up here when they reach your step.'
      }
      emptyAction={
        mode === 'me' && onCreate && !hasFilters(filterKeys) ? (
          <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={onCreate}>
            Request correction
          </Button>
        ) : undefined
      }
      toolbar={
        <FilterBar active={hasFilters(filterKeys)} onClear={() => clear(['tab', 'sortBy', 'sortOrder'])}>
          <Select
            aria-label="Status"
            className="w-44"
            value={String(params.status ?? '')}
            onChange={(e) => set({ status: e.target.value })}
            options={statusOptions}
            placeholder={mode === 'approvals' ? 'Pending' : 'All statuses'}
          />
          {mode === 'approvals' && (
            <div className="w-full sm:w-56">
              <EmployeePicker value={(params.employeeId as string | undefined) ?? null} onChange={(v) => set({ employeeId: (v as string | null) ?? undefined })} placeholder="All employees" />
            </div>
          )}
        </FilterBar>
      }
    />
  );
};

export const RegularizationPage = () => {
  const { can, hasEmployee } = usePermissions();
  const [params, setParams] = useSearchParams();
  const canApprove = can('attendance:approve');
  const tabs = [
    { key: 'me', label: 'My requests', hidden: !hasEmployee },
    { key: 'approvals', label: 'Approvals', hidden: !canApprove },
  ];
  const visible = tabs.filter((t) => !t.hidden);
  const active = (visible.find((t) => t.key === params.get('tab')) ?? visible[0])?.key as 'me' | 'approvals' | undefined;
  const prefillDate = params.get('date') ?? undefined;
  const [creating, setCreating] = useState(false);
  const openId = params.get('request');

  useEffect(() => {
    if (prefillDate && hasEmployee) setCreating(true);
  }, [prefillDate, hasEmployee]);

  const update = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );

  return (
    <>
      <PageHeader
        title="Regularization"
        description="Correct missed or wrong clock-ins and clock-outs."
        breadcrumb={[{ label: 'Attendance', to: '/attendance' }, { label: 'Regularization' }]}
        actions={
          hasEmployee ? (
            <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Request correction
            </Button>
          ) : undefined
        }
      />
      {!active ? (
        <div className="card p-10 text-center text-sm text-muted">Your account is not linked to an employee profile, so you cannot request corrections.</div>
      ) : (
        <div className="space-y-4">
          {visible.length > 1 && <Tabs tabs={tabs} active={active} onChange={(key) => setParams(key === 'me' ? {} : { tab: key }, { replace: true })} />}
          <div role={visible.length > 1 ? 'tabpanel' : undefined} aria-labelledby={visible.length > 1 ? `tab-${active}` : undefined}>
            <RequestsTable key={active} mode={active} onOpen={(id) => update({ request: id })} onCreate={() => setCreating(true)} />
          </div>
        </div>
      )}
      <RegularizationFormModal
        open={creating}
        initialDate={prefillDate}
        onClose={() => {
          setCreating(false);
          if (prefillDate) update({ date: null });
        }}
      />
      <RegularizationDrawer id={openId} onClose={() => update({ request: null })} />
    </>
  );
};

/** Deep link used by notifications: `/attendance/regularizations/:id`. */
export const RegularizationRedirect = () => {
  const { id } = useParams();
  return <Navigate to={id ? `/regularization?request=${id}` : '/regularization'} replace />;
};
