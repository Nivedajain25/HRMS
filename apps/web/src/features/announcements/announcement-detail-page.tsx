import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CalendarClock, Download, Eye, FileText, Megaphone, Pencil, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, Breadcrumb, EmptyState, ErrorState, Skeleton } from '@/components/ui/display';
import { useConfirm } from '@/components/ui/overlay';
import { ApiError, openFile } from '@/lib/api';
import { formatBytes, formatDateTime, fullName, timeAgo } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { attachmentName, useAnnouncement, useDeleteAnnouncement, useMarkAnnouncementRead, type AnnouncementAttachment } from './api';
import { AnnouncementFormDrawer } from './components/announcement-form';
import { AnnouncementStatusBadge, audienceLabel, PinnedBadge, PriorityBadge, ReadsDialog } from './components/announcement-ui';

const AttachmentItem = ({ a }: { a: AnnouncementAttachment }) => {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setOpening(true);
    try {
      await openFile(`/files/${a._id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not open the file');
    } finally {
      setOpening(false);
    }
  };
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
      <span className="flex min-w-0 items-center gap-2.5">
        <FileText className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-fg">{attachmentName(a)}</span>
          {a.size ? <span className="block text-xs text-muted">{formatBytes(a.size)}</span> : null}
        </span>
      </span>
      <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" />} loading={opening} onClick={open} aria-label={`Open ${attachmentName(a)}`}>
        Open
      </Button>
    </li>
  );
};

export const AnnouncementDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const { can } = usePermissions();
  const canManage = can('announcement:manage');
  const q = useAnnouncement(id);
  const markRead = useMarkAnnouncementRead();
  const remove = useDeleteAnnouncement();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [readsOpen, setReadsOpen] = useState(false);
  const marked = useRef<string | null>(null);
  const a = q.data;

  // Record the read once per announcement (only for published ones the viewer hasn't read).
  useEffect(() => {
    if (!a || a.read || a.status !== 'PUBLISHED' || marked.current === a._id) return;
    marked.current = a._id;
    markRead.mutate(a._id);
  }, [a, markRead]);

  if (q.isLoading)
    return (
      <div className="mx-auto max-w-3xl space-y-4" role="status" aria-label="Loading announcement">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-72" />
      </div>
    );
  if (q.error || !a) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return notFound ? (
      <EmptyState
        className="card mx-auto mt-6 max-w-2xl"
        icon={<Megaphone className="h-6 w-6" />}
        title="Announcement not found"
        description="It may have expired, been removed, or isn't addressed to you."
        action={<Button onClick={() => navigate('/announcements')}>Back to announcements</Button>}
      />
    ) : (
      <ErrorState className="card mx-auto max-w-2xl" message={q.error?.message} onRetry={() => q.refetch()} />
    );
  }

  const author = a.createdBy ? fullName(a.createdBy) : null;

  const onDelete = async () => {
    const { confirmed } = await confirm({ title: 'Delete announcement?', message: `"${a.title}" will be removed for everyone. This cannot be undone.`, confirmLabel: 'Delete' });
    if (!confirmed) return;
    await remove.mutateAsync(a._id);
    toast.success('Announcement deleted');
    navigate('/announcements');
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumb items={[{ label: 'Announcements', to: '/announcements' }, { label: a.title }]} />
      <article className="card mt-2 overflow-hidden">
        <header className="space-y-3 border-b border-line px-5 py-5 sm:px-7">
          <div className="flex flex-wrap items-center gap-1.5">
            {a.pinned && <PinnedBadge />}
            <PriorityBadge priority={a.priority} />
            {canManage && <AnnouncementStatusBadge status={a.status} />}
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{a.title}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            {author && (
              <span className="flex items-center gap-2">
                <Avatar name={author} src={a.createdBy?.avatar} size="xs" />
                <span className="text-fg-2">{author}</span>
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <CalendarClock className="h-4 w-4" aria-hidden />
              <time dateTime={a.publishAt} title={formatDateTime(a.publishAt)}>
                {a.status === 'SCHEDULED' ? `Scheduled for ${formatDateTime(a.publishAt)}` : `${formatDateTime(a.publishAt, 'dd MMM yyyy, HH:mm')} · ${timeAgo(a.publishAt)}`}
              </time>
            </span>
            {canManage && (
              <span className="flex items-center gap-1.5">
                <Users className="h-4 w-4" aria-hidden />
                {audienceLabel(a.audience, a.departmentIds.length, a.employeeIds.length)}
              </span>
            )}
          </div>
          {a.expiresAt && <p className="text-xs text-muted">{a.status === 'EXPIRED' ? 'Expired' : 'Expires'} {formatDateTime(a.expiresAt)}</p>}
          {canManage && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="outline" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button variant="outline" size="sm" icon={<Eye className="h-4 w-4" />} onClick={() => setReadsOpen(true)}>
                Read tracking
              </Button>
              <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10" icon={<Trash2 className="h-4 w-4" />} onClick={onDelete} loading={remove.isPending}>
                Delete
              </Button>
            </div>
          )}
        </header>

        {/*
          `content` is sanitized server-side with an allowlist (tags, attributes and
          URL schemes) before it is stored, so it is safe to render as HTML here.
          Never pass any other (unsanitized) field to dangerouslySetInnerHTML.
        */}
        <div className="prose-content px-5 py-6 text-[15px] leading-relaxed break-words text-fg-2 sm:px-7" dangerouslySetInnerHTML={{ __html: a.content }} />

        {a.attachmentIds.length > 0 && (
          <section aria-label="Attachments" className="border-t border-line px-5 py-5 sm:px-7">
            <h2 className="mb-3 text-sm font-semibold text-fg">Attachments ({a.attachmentIds.length})</h2>
            <ul className="space-y-2">
              {a.attachmentIds.map((att) => (
                <AttachmentItem key={att._id} a={att} />
              ))}
            </ul>
          </section>
        )}
      </article>

      {canManage && (
        <>
          <AnnouncementFormDrawer open={editing} announcement={a} onClose={() => setEditing(false)} />
          <ReadsDialog id={readsOpen ? a._id : null} title={a.title} onClose={() => setReadsOpen(false)} />
        </>
      )}
    </div>
  );
};
