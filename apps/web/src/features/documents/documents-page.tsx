import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, FileUp } from 'lucide-react';
import { DOCUMENT_CATEGORIES, DOCUMENT_VERIFICATION } from '@stencil/shared';
import { EmployeePicker, FilterBar, SearchInput } from '@/components/common/controls';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { Tabs } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { label } from '@/lib/i18n';
import { fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useDocuments, useExpiringDocuments, type LibraryScope } from './api';
import { DocumentTable } from './components/document-table';
import { DocumentUploadDrawer } from './components/document-upload-drawer';

type TabKey = 'mine' | 'team' | 'all' | 'policies';
const SCOPE: Record<TabKey, LibraryScope> = { mine: 'me', team: 'team', all: 'all', policies: 'organization' };
const FILTER_KEYS = ['search', 'category', 'verificationStatus', 'expiringWithinDays', 'employeeId'];
const EXPIRY_WINDOW = 30;

const ExpiringNotice = ({ scope, onShow, onOpen }: { scope: LibraryScope; onShow: () => void; onOpen: (id: string) => void }) => {
  const expiring = useExpiringDocuments({ days: EXPIRY_WINDOW, scope });
  const rows = expiring.data ?? [];
  if (!rows.length) return null;
  const expired = rows.filter((d) => d.expired).length;
  const soon = rows.length - expired;
  return (
    <div role="status" className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <AlertTriangle className="hidden h-5 w-5 shrink-0 sm:block" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {[expired ? `${expired} expired` : null, soon ? `${soon} expiring in the next ${EXPIRY_WINDOW} days` : null].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {rows.slice(0, 4).map((d) => (
            <button key={d._id} type="button" className="underline-offset-2 hover:underline" onClick={() => onOpen(d._id)}>
              {d.title}
              {d.employeeId ? ` (${d.employeeId.firstName} ${d.employeeId.lastName})` : ''}
            </button>
          ))}
          {rows.length > 4 && <span>+{rows.length - 4} more</span>}
        </p>
      </div>
      {soon > 0 && (
        <Button variant="outline" size="sm" onClick={onShow}>
          Show expiring
        </Button>
      )}
    </div>
  );
};

export const DocumentsPage = () => {
  const { can, isManager, hasEmployee } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'createdAt', sortOrder: 'desc' });
  const [uploading, setUploading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(searchParams.get('highlight'));

  const tabs = [
    { key: 'mine', label: 'My documents', hidden: !hasEmployee },
    { key: 'team', label: 'Team', hidden: !isManager },
    { key: 'all', label: 'All documents', hidden: !can('document:read') },
    { key: 'policies', label: 'Company policies' },
  ];
  const visible = tabs.filter((t) => !t.hidden).map((t) => t.key as TabKey);
  const requested = params.tab as TabKey | undefined;
  const tab: TabKey = requested && visible.includes(requested) ? requested : visible[0]!;

  // Global search links to `/documents?highlight=<id>`.
  const highlight = searchParams.get('highlight');
  useEffect(() => {
    if (highlight) setOpenId(highlight);
  }, [highlight]);

  const { tab: _tab, highlight: _hl, ...filters } = query;
  void _tab;
  void _hl;
  const list = useDocuments({ ...filters, scope: SCOPE[tab] });

  const changeTab = (key: string) => setSearchParams(key === visible[0] ? {} : { tab: key }, { replace: true });
  const setOpen = (id: string | null) => {
    setOpenId(id);
    if (!id && highlight) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('highlight');
          return next;
        },
        { replace: true },
      );
    }
  };

  const canUploadHere = tab === 'policies' ? can('document:create') : tab === 'mine' ? hasEmployee : can('document:create');
  const filtered = hasFilters(FILTER_KEYS);
  const selectedEmployee = list.data?.data.find((d) => d.employeeId?._id === params.employeeId)?.employeeId;

  return (
    <>
      <PageHeader
        title="Documents"
        description="Personal records, contracts and company policies — stored privately with version history."
        actions={
          hasEmployee || can('document:create') ? (
            <Button icon={<FileUp className="h-4 w-4" />} onClick={() => setUploading(true)}>
              Upload document
            </Button>
          ) : undefined
        }
      />
      <Tabs className="mb-4" tabs={tabs} active={tab} onChange={changeTab} />

      {tab !== 'policies' && <ExpiringNotice scope={SCOPE[tab]} onShow={() => set({ expiringWithinDays: EXPIRY_WINDOW })} onOpen={setOpen} />}

      <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <DocumentTable
          caption="Documents"
          storageKey={`documents-${tab}`}
          showEmployee={tab === 'team' || tab === 'all'}
          data={list.data?.data}
          loading={list.isLoading || list.isFetching}
          error={list.error}
          onRetry={() => list.refetch()}
          pagination={list.data?.pagination}
          onPageChange={(page) => set({ page })}
          onLimitChange={(limit) => set({ limit })}
          sorting={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
          onSortingChange={(s) => set({ sortBy: s.sortBy, sortOrder: s.sortOrder })}
          openId={openId}
          onOpenChange={setOpen}
          emptyTitle={filtered ? 'No documents match your filters' : tab === 'policies' ? 'No company policies yet' : 'No documents yet'}
          emptyDescription={
            filtered
              ? 'Try changing or clearing the filters.'
              : tab === 'mine'
                ? 'Upload your ID proofs, certificates and other records so HR can verify them.'
                : tab === 'policies'
                  ? 'Handbooks and policies shared with everyone appear here.'
                  : 'Documents uploaded by or for employees appear here.'
          }
          emptyAction={
            !filtered && canUploadHere ? (
              <Button icon={<FileUp className="h-4 w-4" />} onClick={() => setUploading(true)}>
                Upload document
              </Button>
            ) : undefined
          }
          toolbar={
            <FilterBar active={filtered} onClear={() => clear(['tab', 'sortBy', 'sortOrder'])}>
              <SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder="Search title or file name…" />
              <Select
                aria-label="Category"
                className="w-full sm:w-44"
                value={String(params.category ?? '')}
                onChange={(e) => set({ category: e.target.value })}
                options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: label(c) }))}
                placeholder="All categories"
              />
              <Select
                aria-label="Verification status"
                className="w-full sm:w-40"
                value={String(params.verificationStatus ?? '')}
                onChange={(e) => set({ verificationStatus: e.target.value })}
                options={DOCUMENT_VERIFICATION.map((s) => ({ value: s, label: label(s) }))}
                placeholder="Any status"
              />
              <Select
                aria-label="Expiry"
                className="w-full sm:w-44"
                value={String(params.expiringWithinDays ?? '')}
                onChange={(e) => set({ expiringWithinDays: e.target.value })}
                options={[7, 30, 60, 90].map((d) => ({ value: String(d), label: `Expiring in ${d} days` }))}
                placeholder="Any expiry"
              />
              {tab === 'all' && (
                <div className="w-full sm:w-60">
                  <EmployeePicker
                    value={params.employeeId ? String(params.employeeId) : null}
                    onChange={(v) => set({ employeeId: typeof v === 'string' ? v : undefined })}
                    selectedLabels={selectedEmployee ? { [selectedEmployee._id]: fullName(selectedEmployee) } : undefined}
                    placeholder="All employees"
                  />
                </div>
              )}
            </FilterBar>
          }
        />
      </div>

      <DocumentUploadDrawer open={uploading} organization={tab === 'policies'} onClose={() => setUploading(false)} />
    </>
  );
};
