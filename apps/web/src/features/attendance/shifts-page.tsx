import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Moon, MoreHorizontal, Pencil, Plus, Star, Trash2, UserPlus, Users } from 'lucide-react';
import { FilterBar, SearchInput } from '@/components/common/controls';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Badge, PageHeader } from '@/components/ui/display';
import { Dropdown, Tabs, useConfirm } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { usePermissions } from '@/store/auth';
import { useDeleteShift, useMakeDefaultShift, useShiftList, type Shift } from './api';
import { AssignShiftModal, ShiftFormDrawer } from './components/shift-forms';
import { ShiftAssignmentHistory, ShiftScheduleGrid } from './components/shift-schedule';
import { hoursLabel } from './lib';
import { shiftRange } from '@/lib/utils';

const ShiftsTable = ({ canManage, onEdit, onCreate, onAssign }: { canManage: boolean; onEdit: (s: Shift) => void; onCreate: () => void; onAssign: (s: Shift) => void }) => {
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'name', sortOrder: 'asc' });
  const apiQuery = useMemo(() => {
    const { tab: _tab, ...rest } = query as Record<string, unknown>;
    void _tab;
    return rest;
  }, [query]);
  const list = useShiftList(apiQuery);
  const remove = useDeleteShift();
  const makeDefault = useMakeDefaultShift();
  const confirm = useConfirm();

  const onDelete = async (s: Shift) => {
    const { confirmed } = await confirm({
      title: `Delete ${s.name}?`,
      message: 'Shifts that are the default, assigned to employees, or have active assignments cannot be deleted.',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    const res = await remove.mutateAsync(s._id);
    toast.success(res.message ?? 'Shift deleted');
  };

  const columns = useMemo<ColumnDef<Shift, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Shift',
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <span className="flex items-center gap-2.5">
            <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: row.original.color }} aria-hidden />
            <span>
              <span className="flex items-center gap-2 font-medium text-fg">
                {row.original.name}
                {row.original.isDefault && (
                  <Badge tone="brand">
                    <Star className="h-3 w-3" aria-hidden />
                    Default
                  </Badge>
                )}
              </span>
              <span className="font-mono text-xs text-muted">{row.original.code}</span>
            </span>
          </span>
        ),
      },
      {
        id: 'startTime',
        header: 'Timing',
        enableSorting: true,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            {shiftRange(row.original.startTime, row.original.endTime)}
            {row.original.nightShift && <Moon className="h-3.5 w-3.5 text-violet-500" aria-label="Night shift" />}
          </span>
        ),
      },
      { id: 'hours', header: 'Hours', cell: ({ row }) => `${hoursLabel(row.original.workingHours)} (half day ${hoursLabel(row.original.halfDayHours)})` },
      { id: 'grace', header: 'Grace', cell: ({ row }) => `${row.original.gracePeriodMinutes} min` },
      { id: 'break', header: 'Break', cell: ({ row }) => `${row.original.breakDurationMinutes} min` },
      {
        id: 'type',
        header: 'Type',
        cell: ({ row }) => (
          <span className="flex gap-1">
            {row.original.flexible ? <Badge tone="teal">Flexible</Badge> : <Badge>Fixed</Badge>}
            {row.original.nightShift && <Badge tone="purple">Night</Badge>}
          </span>
        ),
      },
      {
        id: 'employees',
        header: 'Employees',
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 text-fg-2">
            <Users className="h-3.5 w-3.5 text-muted" aria-hidden />
            {row.original.employeeCount ?? 0}
          </span>
        ),
      },
      ...(canManage
        ? [
            {
              id: 'actions',
              header: '',
              enableHiding: false,
              cell: ({ row }: { row: { original: Shift } }) => (
                <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                  <Dropdown
                    label={`Actions for ${row.original.name}`}
                    trigger={
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3">
                        <MoreHorizontal className="h-4 w-4" />
                      </span>
                    }
                    items={[
                      { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => onEdit(row.original) },
                      { label: 'Assign to employees', icon: <UserPlus className="h-4 w-4" />, onSelect: () => onAssign(row.original) },
                      {
                        label: 'Make default',
                        icon: <Star className="h-4 w-4" />,
                        hidden: row.original.isDefault,
                        onSelect: () =>
                          void makeDefault
                            .mutateAsync(row.original._id)
                            .then(() => toast.success(`${row.original.name} is now the default shift`))
                            .catch(() => undefined),
                      },
                      { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, hidden: row.original.isDefault, onSelect: () => void onDelete(row.original).catch(() => undefined) },
                    ]}
                  />
                </div>
              ),
            } as ColumnDef<Shift, unknown>,
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManage],
  );

  return (
    <DataTable
      caption="Shifts"
      storageKey="shifts"
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
      onRowClick={canManage ? onEdit : undefined}
      emptyTitle="No shifts found"
      emptyDescription={hasFilters(['search']) ? 'Try changing your search.' : canManage ? 'Create your first shift to define working hours.' : undefined}
      emptyAction={
        canManage && !hasFilters(['search']) ? (
          <Button icon={<Plus className="h-4 w-4" />} onClick={onCreate}>
            Add shift
          </Button>
        ) : undefined
      }
      toolbar={
        <FilterBar active={hasFilters(['search'])} onClear={() => clear(['tab'])}>
          <SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder="Search shifts…" />
        </FilterBar>
      }
    />
  );
};

export const ShiftsPage = () => {
  const { can } = usePermissions();
  const canManage = can('shift:manage');
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Shift | null | 'new'>(null);
  const [assigning, setAssigning] = useState<{ shiftId?: string } | null>(null);
  const tabs = [
    { key: 'shifts', label: 'Shifts' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'history', label: 'Assignment history' },
  ];
  const active = tabs.some((t) => t.key === params.get('tab')) ? params.get('tab')! : 'shifts';

  return (
    <>
      <PageHeader
        title="Shifts"
        description="Working hours, rosters and shift assignments."
        breadcrumb={[{ label: 'Attendance', to: '/attendance' }, { label: 'Shifts' }]}
        actions={
          canManage ? (
            <>
              <Button variant="outline" icon={<UserPlus className="h-4 w-4" />} onClick={() => setAssigning({})}>
                Assign shift
              </Button>
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
                Add shift
              </Button>
            </>
          ) : undefined
        }
      />
      <div className="space-y-4">
        <Tabs tabs={tabs} active={active} onChange={(key) => setParams(key === 'shifts' ? {} : { tab: key }, { replace: true })} />
        <div role="tabpanel" aria-labelledby={`tab-${active}`}>
          {active === 'shifts' && (
            <ShiftsTable canManage={canManage} onEdit={(s) => setEditing(s)} onCreate={() => setEditing('new')} onAssign={(s) => setAssigning({ shiftId: s._id })} />
          )}
          {active === 'schedule' && <ShiftScheduleGrid />}
          {active === 'history' && <ShiftAssignmentHistory />}
        </div>
      </div>
      <ShiftFormDrawer open={editing !== null} shift={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      <AssignShiftModal open={assigning !== null} initialShiftId={assigning?.shiftId} onClose={() => setAssigning(null)} />
    </>
  );
};
