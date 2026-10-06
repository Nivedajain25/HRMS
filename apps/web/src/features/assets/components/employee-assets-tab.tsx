import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { useEmployee } from '@/features/employees/api';
import { fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useAssignments } from '../api';
import { AssignAssetModal } from './asset-actions';
import { assignmentColumns } from './assignment-columns';

/** Assets tab on the employee profile: current and past assignments. */
const EmployeeAssetsTab = ({ employeeId }: { employeeId: string }) => {
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [status, setStatus] = useState('');
  const [assigning, setAssigning] = useState(false);
  const employee = useEmployee(employeeId);
  const list = useAssignments({ employeeId, page, limit, status: status || undefined, sortBy: 'assignedDate', sortOrder: 'desc' });
  const columns = useMemo(() => assignmentColumns({ showEmployee: false }), []);
  const name = employee.data ? fullName(employee.data) : 'this employee';
  const assignee = useMemo(() => ({ id: employeeId, name }), [employeeId, name]);
  const canAssign = can('asset:assign');
  const isExited = employee.data?.employmentStatus === 'EXITED' || employee.data?.employmentStatus === 'ARCHIVED';

  return (
    <>
      <DataTable
        caption="Assigned assets"
        storageKey="employee-assets"
        columns={columns}
        getRowId={(r) => r._id}
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
        onRowClick={(r) => r.assetId && navigate(`/assets/${r.assetId._id}`)}
        emptyTitle={status ? 'No assignments with this status' : 'No assets assigned'}
        emptyDescription={status ? 'Try another filter.' : 'Equipment issued to this employee will be listed here with its return history.'}
        emptyAction={
          canAssign && !status && !isExited ? (
            <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setAssigning(true)}>
              Assign asset
            </Button>
          ) : undefined
        }
        toolbar={
          <div className="flex w-full flex-wrap items-center gap-2">
            <Select
              aria-label="Assignment status"
              className="w-full sm:w-44"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              options={[
                { value: 'ACTIVE', label: 'Currently assigned' },
                { value: 'RETURNED', label: 'Returned' },
              ]}
              placeholder="All assignments"
            />
            {canAssign && !isExited && (
              <Button className="w-full sm:ml-auto sm:w-auto" icon={<UserPlus className="h-4 w-4" />} onClick={() => setAssigning(true)}>
                Assign asset
              </Button>
            )}
          </div>
        }
      />
      <AssignAssetModal open={assigning} employee={assignee} onClose={() => setAssigning(false)} />
    </>
  );
};

export default EmployeeAssetsTab;
