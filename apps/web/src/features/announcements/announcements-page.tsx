import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Eye, Megaphone, MoreHorizontal, Paperclip, Pencil, Pin, Plus, Trash2 } from 'lucide-react';
import { ANNOUNCEMENT_PRIORITY } from '@stencil/shared';
import { FilterBar, SearchInput } from '@/components/common/controls';
import { DataTable, Pagination } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Avatar, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { Dropdown, Tabs, useConfirm } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { label } from '@/lib/i18n';
import { cn, formatDateTime, fullName, timeAgo } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { htmlExcerpt, useAnnouncements, useDeleteAnnouncement, type Announcement } from './api';
import { AnnouncementFormDrawer } from './components/announcement-form';
import { AnnouncementStatusBadge, audienceLabel, PinnedBadge, PriorityBadge, ReadsDialog } from './components/announcement-ui';

const FILTER_KEYS = ['search', 'priority'];

/* -------------------------------- Feed -------------------------------- */

const FeedCard = ({ a }: { a: Announcement }) => {
  const author = a.createdBy ? fullName(a.createdBy) : null;
  const excerpt = useMemo(() => htmlExcerpt(a.content, 260), [a.content]);
  return (
    <li>
      <Link
        to={`/announcements/${a._id}`}
        className={cn(
          'card group block p-5 transition-shadow hover:shadow-pop focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
          a.pinned && 'border-brand-200 dark:border-brand-500/30',
        )}
      >
        <div className="flex items-start gap-3">
          <span className={cn('mt-2 h-2 w-2 shrink-0 rounded-full', a.read ? 'bg-transparent' : 'bg-brand-600')} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {a.pinned && <PinnedBadge />}
              <PriorityBadge priority={a.priority} hideNormal />
              {!a.read && <span className="text-xs font-medium text-brand-600 dark:text-brand-400">New</span>}
            </div>
            <h2 className={cn('mt-1 text-base text-fg group-hover:text-brand-700 dark:group-hover:text-brand-300', a.read ? 'font-medium' : 'font-semibold')}>{a.title}</h2>
            {excerpt && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">{excerpt}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              {author && (
                <span className="flex items-center gap-1.5">
                  <Avatar name={author} src={a.createdBy?.avatar} size="xs" />
                  {author}
                </span>
              )}
              <time dateTime={a.publishAt} title={formatDateTime(a.publishAt)}>
                {timeAgo(a.publishAt)}
              </time>
              {a.attachmentIds.length > 0 && (
                <span className="flex items-center gap-1">
                  <Paperclip className="h-3.5 w-3.5" aria-hidden />
                  {a.attachmentIds.length} attachment{a.attachmentIds.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
};

const Feed = ({ query, onPage, onLimit, hasFilters, canManage, onCreate }: { query: object; onPage: (p: number) => void; onLimit: (l: number) => void; hasFilters: boolean; canManage: boolean; onCreate: () => void }) => {
  const list = useAnnouncements(query);
  if (list.isLoading)
    return (
      <ul className="space-y-3" aria-busy>
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="card space-y-2 p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </li>
        ))}
      </ul>
    );
  if (list.error) return <ErrorState className="card" message={list.error.message} onRetry={() => list.refetch()} />;
  const rows = list.data?.data ?? [];
  if (!rows.length)
    return (
      <EmptyState
        className="card"
        icon={<Megaphone className="h-6 w-6" />}
        title={hasFilters ? 'No announcements match your filters' : 'No announcements yet'}
        description={hasFilters ? 'Try a different search or priority.' : 'Company news and updates will show up here.'}
        action={
          canManage && !hasFilters ? (
            <Button icon={<Plus className="h-4 w-4" />} onClick={onCreate}>
              New announcement
            </Button>
          ) : undefined
        }
      />
    );
  return (
    <div className={cn('space-y-3', list.isFetching && 'opacity-70 transition-opacity')}>
      <ul className="space-y-3">
        {rows.map((a) => (
          <FeedCard key={a._id} a={a} />
        ))}
      </ul>
      {list.data && list.data.pagination.totalPages > 1 && (
        <div className="card overflow-hidden">
          <Pagination pagination={list.data.pagination} onPageChange={onPage} onLimitChange={onLimit} loading={list.isFetching} />
        </div>
      )}
    </div>
  );
};

/* ------------------------------ Manage view ----------------------------- */

const ManageTable = ({
  query,
  onPage,
  onLimit,
  toolbar,
  onEdit,
  onReads,
}: {
  query: object;
  onPage: (p: number) => void;
  onLimit: (l: number) => void;
  toolbar: ReactNode;
  onEdit: (a: Announcement) => void;
  onReads: (a: Announcement) => void;
}) => {
  const list = useAnnouncements(query);
  const remove = useDeleteAnnouncement();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const columns = useMemo<ColumnDef<Announcement, unknown>[]>(() => {
    const onDelete = async (a: Announcement) => {
      const { confirmed } = await confirm({ title: 'Delete announcement?', message: `"${a.title}" will be removed for everyone. This cannot be undone.`, confirmLabel: 'Delete' });
      if (!confirmed) return;
      await remove.mutateAsync(a._id);
      toast.success('Announcement deleted');
    };
    return [
      {
        id: 'title',
        header: 'Title',
        enableHiding: false,
        cell: ({ row }) => (
          <span className="flex max-w-[22rem] items-center gap-2">
            {row.original.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" aria-label="Pinned" />}
            <span className="truncate font-medium text-fg">{row.original.title}</span>
          </span>
        ),
      },
      { id: 'status', header: 'Status', cell: ({ row }) => <AnnouncementStatusBadge status={row.original.status} /> },
      { id: 'priority', header: 'Priority', cell: ({ row }) => <PriorityBadge priority={row.original.priority} /> },
      { id: 'audience', header: 'Audience', cell: ({ row }) => audienceLabel(row.original.audience, row.original.departmentIds.length, row.original.employeeIds.length) },
      { id: 'publishAt', header: 'Publish', cell: ({ row }) => formatDateTime(row.original.publishAt) },
      { id: 'expiresAt', header: 'Expires', cell: ({ row }) => (row.original.expiresAt ? formatDateTime(row.original.expiresAt) : 'Never') },
      {
        id: 'reads',
        header: 'Reads',
        cell: ({ row }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10"
            onClick={(e) => {
              e.stopPropagation();
              onReads(row.original);
            }}
            aria-label={`${row.original.readCount ?? 0} reads, view read tracking for ${row.original.title}`}
          >
            <Eye className="h-3.5 w-3.5" aria-hidden />
            {row.original.readCount ?? 0}
          </button>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableHiding: false,
        cell: ({ row }) => (
          <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
            <Dropdown
              label={`Actions for ${row.original.title}`}
              trigger={
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-2 hover:bg-surface-3">
                  <MoreHorizontal className="h-4 w-4" />
                </span>
              }
              items={[
                { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => onEdit(row.original) },
                { label: 'Read tracking', icon: <Eye className="h-4 w-4" />, onSelect: () => onReads(row.original) },
                { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => void onDelete(row.original) },
              ]}
            />
          </span>
        ),
      },
    ];
  }, [confirm, remove, onEdit, onReads]);

  return (
    <DataTable
      caption="All announcements"
      storageKey="announcements-all"
      columns={columns}
      data={list.data?.data}
      loading={list.isLoading || list.isFetching}
      error={list.error}
      onRetry={() => list.refetch()}
      pagination={list.data?.pagination}
      onPageChange={onPage}
      onLimitChange={onLimit}
      onRowClick={(a) => navigate(`/announcements/${a._id}`)}
      emptyTitle="No announcements"
      emptyDescription="Create one to share news with your organization."
      toolbar={toolbar}
    />
  );
};

/* -------------------------------- Page -------------------------------- */

export const AnnouncementsPage = () => {
  const { can } = usePermissions();
  // Anyone can post; HR manages every announcement, everyone else their own ("My announcements").
  const canManage = can('announcement:manage');
  const { params, query, set, clear, hasFilters } = useListParams({ limit: 10 });
  const tab = params.tab === 'all' ? 'all' : 'feed';
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [creatingState, setCreating] = useState(false);
  // Dashboard "Announce" quick action: /announcements?new=1 opens the form straight away.
  const creating = creatingState || params.new === '1';
  const [reads, setReads] = useState<Announcement | null>(null);
  const navigate = useNavigate();

  const apiQuery = useMemo(() => {
    const rest = Object.fromEntries(Object.entries(query).filter(([k]) => k !== 'tab' && k !== 'new' && k !== 'sortOrder' && k !== 'sortBy'));
    return tab === 'all' ? { ...rest, scope: 'all' } : rest;
  }, [query, tab]);

  const toolbar = (
    <FilterBar active={hasFilters(FILTER_KEYS)} onClear={() => clear(['tab'])}>
      <SearchInput value={params.search} onSearch={(search) => set({ search })} placeholder="Search announcements…" />
      <Select
        aria-label="Priority"
        className="w-40"
        value={String(params.priority ?? '')}
        onChange={(e) => set({ priority: e.target.value })}
        options={ANNOUNCEMENT_PRIORITY.map((p) => ({ value: p, label: label(p) }))}
        placeholder="All priorities"
      />
    </FilterBar>
  );

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Company news, policies and updates"
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)} className="w-full sm:w-auto">
            New announcement
          </Button>
        }
      />
      <Tabs
        className="mb-5"
        tabs={[
          { key: 'feed', label: 'Feed' },
          { key: 'all', label: canManage ? 'Manage all' : 'My announcements' },
        ]}
        active={tab}
        onChange={(key) => set({ tab: key === 'all' ? 'all' : undefined })}
      />
      <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'all' ? (
          <ManageTable query={apiQuery} onPage={(page) => set({ page })} onLimit={(limit) => set({ limit })} toolbar={toolbar} onEdit={setEditing} onReads={setReads} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="card px-4 py-3">{toolbar}</div>
            <Feed query={apiQuery} onPage={(page) => set({ page })} onLimit={(limit) => set({ limit })} hasFilters={hasFilters(FILTER_KEYS)} canManage onCreate={() => setCreating(true)} />
          </div>
        )}
      </div>
      <AnnouncementFormDrawer
        open={creating || !!editing}
        announcement={editing ?? undefined}
        onClose={(saved) => {
          const wasCreating = creating;
          setCreating(false);
          if (params.new) set({ new: undefined });
          setEditing(null);
          if (saved && wasCreating) navigate(`/announcements/${saved._id}`);
        }}
      />
      <ReadsDialog id={reads?._id ?? null} title={reads?.title} onClose={() => setReads(null)} />
    </>
  );
};
