import { useNavigate } from 'react-router-dom';
import { EmployeePicker, FilterBar } from '@/components/common/controls';
import { DataTable } from '@/components/tables/data-table';
import { PageHeader } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { useListParams } from '@/hooks/use-list-params';
import { fullName } from '@/lib/utils';
import { useAssignments } from './api';
import { assignmentColumns } from './components/assignment-columns';

const FILTER_KEYS = ['status', 'employeeId'];
const COLUMNS = assignmentColumns({ showEmployee: true });

export const AssetAssignmentsPage = () => {
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'assignedDate', sortOrder: 'desc' });
  const list = useAssignments(query);
  const navigate = useNavigate();
  const filtered = hasFilters(FILTER_KEYS);
  const selectedEmployee = list.data?.data.find((r) => r.employeeId._id === params.employeeId)?.employeeId;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Assets', to: '/assets' }, { label: 'Asset Allocation' }]}
        title="Asset Allocation"
        description="Who has which equipment, with handover and return history."
      />
      <DataTable
        caption="Asset allocation"
        storageKey="asset-assignments"
        columns={COLUMNS}
        getRowId={(r) => r._id}
        data={list.data?.data}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => list.refetch()}
        pagination={list.data?.pagination}
        onPageChange={(page) => set({ page })}
        onLimitChange={(limit) => set({ limit })}
        sorting={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
        onSortingChange={(s) => set({ sortBy: s.sortBy, sortOrder: s.sortOrder })}
        onRowClick={(r) => r.assetId && navigate(`/assets/${r.assetId._id}`)}
        emptyTitle={filtered ? 'No assignments match your filters' : 'No assignments yet'}
        emptyDescription={filtered ? 'Try changing or clearing the filters.' : 'Assign an asset from the inventory to start tracking handovers.'}
        toolbar={
          <FilterBar active={filtered} onClear={() => clear(['sortBy', 'sortOrder'])}>
            <Select
              aria-label="Assignment status"
              className="w-full sm:w-40"
              value={String(params.status ?? '')}
              onChange={(e) => set({ status: e.target.value })}
              options={[
                { value: 'ACTIVE', label: 'Active' },
                { value: 'RETURNED', label: 'Returned' },
              ]}
              placeholder="All assignments"
            />
            <div className="w-full sm:w-64">
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
    </>
  );
};
