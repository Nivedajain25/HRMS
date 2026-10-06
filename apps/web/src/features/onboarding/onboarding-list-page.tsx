import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Archive, MoreHorizontal, Pencil, Plus, Star, UserPlus } from 'lucide-react';
import { TASK_STATUS } from '@stencil/shared';
import { FilterBar, SearchInput } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Badge, IconTitle, PageHeader, PersonCell, ProgressBar } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { Dropdown, Tabs, useConfirm } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { label } from '@/lib/i18n';
import { formatDate, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useArchiveTemplate, useOnboardings, useTemplates, type Onboarding, type OnboardingTemplate } from './api';
import { StartOnboardingDialog } from './components/start-onboarding-dialog';
import { TemplateEditorDrawer } from './components/template-editor';

/** The `tab` URL param is UI state, not an API filter. */
const withoutTab = (query: Record<string, unknown>) => Object.fromEntries(Object.entries(query).filter(([k]) => k !== 'tab'));

const OnboardingsTable = ({ onStart, canManage }: { onStart: () => void; canManage: boolean }) => {
  const { params, query, set, clear, hasFilters } = useListParams();
  const apiQuery = useMemo(() => withoutTab(query), [query]);
  const list = useOnboardings(apiQuery);
  const navigate = useNavigate();
  const filterKeys = ['search', 'status'];

  const columns = useMemo<ColumnDef<Onboarding, unknown>[]>(
    () => [
      {
        id: 'employee',
        header: 'Employee',
        enableHiding: false,
        cell: ({ row }) => {
          const e = row.original.employeeId;
          return e ? (
            <PersonCell name={fullName(e)} subtitle={[e.employeeId, e.designationId?.name].filter(Boolean).join(' · ')} photo={e.profilePhoto} />
          ) : (
            <span className="text-muted">Removed employee</span>
          );
        },
      },
      { id: 'department', header: 'Department', cell: ({ row }) => row.original.employeeId?.departmentId?.name ?? '—' },
      { id: 'template', header: 'Template', cell: ({ row }) => row.original.templateId?.name ?? '—' },
      { id: 'startDate', header: 'Start date', cell: ({ row }) => formatDate(row.original.startDate) },
      {
        id: 'progress',
        header: 'Progress',
        enableHiding: false,
        cell: ({ row }) => {
          const o = row.original;
          const done = o.tasks.filter((t) => t.status === 'COMPLETED').length;
          return (
            <div className="flex min-w-40 items-center gap-3">
              <ProgressBar value={o.progress} tone={o.status === 'COMPLETED' ? 'green' : 'brand'} className="w-24" />
              <span className="text-xs text-muted tabular-nums">
                {done}/{o.tasks.length}
              </span>
            </div>
          );
        },
      },
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ],
    [],
  );

  return (
    <DataTable
      caption="Onboardings"
      storageKey="onboardings"
      columns={columns}
      data={list.data?.data}
      loading={list.isLoading || list.isFetching}
      error={list.error}
      onRetry={() => list.refetch()}
      pagination={list.data?.pagination}
      onPageChange={(page) => set({ page })}
      onLimitChange={(limit) => set({ limit })}
      onRowClick={(o) => navigate(`/onboarding/${o._id}`)}
      emptyTitle={hasFilters(filterKeys) ? 'No onboardings match' : 'No onboardings yet'}
      emptyDescription={
        hasFilters(filterKeys)
          ? 'Try changing your filters.'
          : canManage
            ? 'Start an onboarding checklist for a new joiner.'
            : 'Onboarding checklists for you and your team will appear here.'
      }
      emptyAction={
        canManage && !hasFilters(filterKeys) ? (
          <Button icon={<UserPlus className="h-4 w-4" />} onClick={onStart}>
            Start onboarding
          </Button>
        ) : undefined
      }
      toolbar={
        <FilterBar active={hasFilters(filterKeys)} onClear={() => clear(['tab'])}>
          <SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder="Search employee name or ID…" />
          <Select
            aria-label="Status"
            className="w-full sm:w-40"
            value={String(params.status ?? '')}
            onChange={(e) => set({ status: e.target.value })}
            options={TASK_STATUS.map((s) => ({ value: s, label: label(s) }))}
            placeholder="All statuses"
          />
        </FilterBar>
      }
    />
  );
};

const TemplatesTable = ({ onEdit, onCreate }: { onEdit: (id: string) => void; onCreate: () => void }) => {
  const { params, query, set, clear, hasFilters } = useListParams({ sortBy: 'name', sortOrder: 'asc' });
  const apiQuery = useMemo(() => withoutTab(query), [query]);
  const list = useTemplates(apiQuery);
  const archive = useArchiveTemplate();
  const confirm = useConfirm();

  const onArchive = async (t: OnboardingTemplate) => {
    const { confirmed } = await confirm({
      title: `Archive “${t.name}”?`,
      message: 'The template will no longer be available for new onboardings. Existing checklists are not affected.',
      confirmLabel: 'Archive',
    });
    if (!confirmed) return;
    const res = await archive.mutateAsync(t._id);
    toast.success(res.message ?? 'Template archived');
  };

  const columns = useMemo<ColumnDef<OnboardingTemplate, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Template',
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium text-fg">
              {row.original.name}
              {row.original.isDefault && (
                <Badge tone="brand">
                  <Star className="h-3 w-3" aria-hidden /> Default
                </Badge>
              )}
            </p>
            {row.original.description && <p className="max-w-md truncate text-xs text-muted">{row.original.description}</p>}
          </div>
        ),
      },
      { id: 'department', header: 'Department', cell: ({ row }) => row.original.departmentId?.name ?? 'All departments' },
      { id: 'tasks', header: 'Tasks', cell: ({ row }) => <span className="tabular-nums">{row.original.tasks.length}</span> },
      {
        id: 'required',
        header: 'Required',
        cell: ({ row }) => <span className="tabular-nums">{row.original.tasks.filter((t) => t.required).length}</span>,
      },
      { id: 'createdAt', header: 'Created', enableSorting: true, cell: ({ row }) => formatDate(row.original.createdAt) },
      {
        id: 'actions',
        header: '',
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <Dropdown
              label={`Actions for ${row.original.name}`}
              trigger={
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-fg">
                  <MoreHorizontal className="h-4 w-4" />
                </span>
              }
              items={[
                { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => onEdit(row.original._id) },
                { label: 'Archive', icon: <Archive className="h-4 w-4" />, danger: true, onSelect: () => void onArchive(row.original) },
              ]}
            />
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <DataTable
      caption="Onboarding templates"
      storageKey="onboarding-templates"
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
      onRowClick={(t) => onEdit(t._id)}
      emptyTitle={hasFilters(['search']) ? 'No templates match' : 'No templates yet'}
      emptyDescription={hasFilters(['search']) ? 'Try a different search.' : 'Templates define the checklist every new joiner goes through.'}
      emptyAction={
        !hasFilters(['search']) ? (
          <Button icon={<Plus className="h-4 w-4" />} onClick={onCreate}>
            New template
          </Button>
        ) : undefined
      }
      toolbar={
        <FilterBar active={hasFilters(['search'])} onClear={() => clear(['tab'])}>
          <SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder="Search templates…" />
        </FilterBar>
      }
    />
  );
};

export const OnboardingListPage = () => {
  const { can } = usePermissions();
  const canManage = can('onboarding:manage');
  const { params, clear } = useListParams();
  const tab = canManage && params.tab === 'templates' ? 'templates' : 'onboardings';
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [editor, setEditor] = useState<{ open: boolean; id?: string }>({ open: false });

  return (
    <>
      <PageHeader
        title={<IconTitle icon={<UserPlus />}>Onboarding</IconTitle>}
        description={tab === 'templates' ? 'Reusable checklists for new joiners' : 'Track every new joiner’s checklist from offer to first week'}
        actions={
          canManage ? (
            tab === 'templates' ? (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditor({ open: true })}>
                New template
              </Button>
            ) : (
              <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setStarting(true)}>
                Start onboarding
              </Button>
            )
          ) : undefined
        }
      />
      {canManage && (
        <Tabs
          className="mb-4"
          tabs={[
            { key: 'onboardings', label: 'Onboardings' },
            { key: 'templates', label: 'Templates' },
          ]}
          active={tab}
          onChange={(key) => {
            // Switching tabs resets list filters, which belong to a single tab.
            if (key === 'templates') navigate('/onboarding?tab=templates', { replace: true });
            else clear();
          }}
        />
      )}
      <div role={canManage ? 'tabpanel' : undefined} aria-labelledby={canManage ? `tab-${tab}` : undefined}>
        {tab === 'templates' ? (
          <TemplatesTable onEdit={(id) => setEditor({ open: true, id })} onCreate={() => setEditor({ open: true })} />
        ) : (
          <OnboardingsTable onStart={() => setStarting(true)} canManage={canManage} />
        )}
      </div>
      {canManage && (
        <>
          <StartOnboardingDialog
            open={starting}
            onClose={(created) => {
              setStarting(false);
              if (created) navigate(`/onboarding/${created._id}`);
            }}
          />
          <TemplateEditorDrawer open={editor.open} templateId={editor.id} onClose={() => setEditor({ open: false })} />
        </>
      )}
    </>
  );
};
