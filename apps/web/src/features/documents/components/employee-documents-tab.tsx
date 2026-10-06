import { useMemo, useState } from 'react';
import { FileUp } from 'lucide-react';
import { DOCUMENT_CATEGORIES } from '@stencil/shared';
import { SearchInput } from '@/components/common/controls';
import { useEmployee } from '@/features/employees/api';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { label } from '@/lib/i18n';
import { fullName } from '@/lib/utils';
import { useDocuments } from '../api';
import { DocumentTable } from './document-table';
import { useDocumentPermissions } from './document-ui';
import { DocumentUploadDrawer } from './document-upload-drawer';

/** Documents tab on the employee profile. */
const EmployeeDocumentsTab = ({ employeeId }: { employeeId: string }) => {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<{ sortBy?: string; sortOrder: 'asc' | 'desc' }>({ sortBy: 'createdAt', sortOrder: 'desc' });
  const [uploading, setUploading] = useState(false);
  const perms = useDocumentPermissions();
  const employee = useEmployee(employeeId);
  const canUpload = perms.canUploadFor(employeeId);
  const ownerName = employee.data ? fullName(employee.data) : 'this employee';
  const owner = useMemo(() => ({ id: employeeId, name: ownerName }), [employeeId, ownerName]);

  const list = useDocuments({ employeeId, page, limit, search: search || undefined, category: category || undefined, ...sort });
  const filtered = !!search || !!category;

  return (
    <>
      <DocumentTable
        caption="Employee documents"
        storageKey="employee-documents"
        showEmployee={false}
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
        emptyTitle={filtered ? 'No documents match your filters' : 'No documents yet'}
        emptyDescription={filtered ? 'Try a different search or category.' : 'ID proofs, contracts and certificates for this employee appear here.'}
        emptyAction={
          canUpload && !filtered ? (
            <Button icon={<FileUp className="h-4 w-4" />} onClick={() => setUploading(true)}>
              Upload document
            </Button>
          ) : undefined
        }
        toolbar={
          <div className="flex w-full flex-wrap items-center gap-2">
            <SearchInput
              value={search}
              onSearch={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Search documents…"
            />
            <Select
              aria-label="Category"
              className="w-full sm:w-44"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
              options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: label(c) }))}
              placeholder="All categories"
            />
            {canUpload && (
              <Button className="w-full sm:ml-auto sm:w-auto" icon={<FileUp className="h-4 w-4" />} onClick={() => setUploading(true)}>
                Upload
              </Button>
            )}
          </div>
        }
      />
      <DocumentUploadDrawer
        open={uploading}
        employee={owner}
        onClose={() => setUploading(false)}
      />
    </>
  );
};

export default EmployeeDocumentsTab;
