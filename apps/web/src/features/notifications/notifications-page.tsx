import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Bell,
  BellOff,
  Briefcase,
  CalendarCheck,
  CalendarDays,
  CheckCheck,
  ClipboardCheck,
  ClipboardList,
  FileWarning,
  Megaphone,
  Package,
  Receipt,
  Settings2,
  Siren,
  Star,
  Target,
  Trash2,
  UserMinus,
  UserPlus,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { NotificationType } from '@stencil/shared';
import { Pagination } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/display';
import { Tabs, useConfirm } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';
import { keepLabel, READ_NOTIFICATION_TTL_HOURS, useDeleteNotification, useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications, type NotificationItem } from './api';
import { StarButton } from './star-button';

const TYPE_META: Record<NotificationType, { icon: LucideIcon; tone: string }> = {
  LEAVE_SUBMITTED: { icon: CalendarDays, tone: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300' },
  LEAVE_APPROVED: { icon: CalendarDays, tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  LEAVE_REJECTED: { icon: CalendarDays, tone: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300' },
  ATTENDANCE_CORRECTION: { icon: CalendarCheck, tone: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' },
  PAYROLL_GENERATED: { icon: Wallet, tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  DOCUMENT_EXPIRY: { icon: FileWarning, tone: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300' },
  PERFORMANCE_REVIEW: { icon: ClipboardCheck, tone: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' },
  ANNOUNCEMENT: { icon: Megaphone, tone: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300' },
  EXPENSE_APPROVAL: { icon: Receipt, tone: 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300' },
  INTERVIEW_SCHEDULED: { icon: Briefcase, tone: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300' },
  ONBOARDING: { icon: UserPlus, tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  OFFBOARDING: { icon: UserMinus, tone: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300' },
  ASSET: { icon: Package, tone: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' },
  GOAL: { icon: Target, tone: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300' },
  GENERAL: { icon: Bell, tone: 'bg-surface-3 text-fg-2' },
  EMERGENCY: { icon: Siren, tone: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300' },
  TASK: { icon: ClipboardList, tone: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300' },
};

const NotificationRow = ({ n }: { n: NotificationItem }) => {
  const navigate = useNavigate();
  const markRead = useMarkNotificationRead();
  const remove = useDeleteNotification();
  const confirm = useConfirm();
  const meta = TYPE_META[n.type] ?? TYPE_META.GENERAL;
  const Icon = meta.icon;
  const unread = !n.readAt;

  const open = () => {
    if (unread) markRead.mutate(n._id);
    if (n.link) navigate(n.link);
  };

  return (
    <li className={cn('group relative flex gap-3 px-4 py-3.5 transition-colors sm:px-5', unread ? 'bg-brand-50/40 dark:bg-brand-500/5' : 'hover:bg-surface-2')}>
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', meta.tone)} aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
      <button type="button" onClick={open} className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-offset-4" aria-label={`${unread ? 'Unread: ' : ''}${n.title}${n.link ? ', open' : ''}`}>
        <span className="flex items-start gap-2">
          <span className={cn('min-w-0 flex-1 text-sm text-fg', unread ? 'font-semibold' : 'font-medium')}>{n.title}</span>
          {unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-hidden />}
        </span>
        <span className="mt-0.5 block text-sm leading-relaxed text-muted">{n.message}</span>
        <span className="mt-1 block text-xs text-subtle">
          <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)}>
            {timeAgo(n.createdAt)}
          </time>
          {/* Read notifications are deleted 12 hours after they're read, unless starred. */}
          {keepLabel(n) ? ` · ${keepLabel(n)}` : ''}
        </span>
      </button>
      {/* The star stays visible (filled when starred); the other actions appear on hover. */}
      <StarButton n={n} className="shrink-0" />
      <div className="flex shrink-0 items-start gap-1 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        {unread && (
          <Button variant="ghost" size="icon-sm" aria-label={`Mark "${n.title}" as read`} title="Mark as read" onClick={() => markRead.mutate(n._id)} disabled={markRead.isPending}>
            <CheckCheck className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete "${n.title}"`}
          title="Delete"
          className="hover:text-red-600 dark:hover:text-red-400"
          disabled={remove.isPending}
          onClick={async () => {
            const { confirmed } = await confirm({ title: 'Delete notification?', message: `"${n.title}" will be removed from your notifications.`, confirmLabel: 'Delete' });
            if (confirmed) remove.mutate(n._id, { onSuccess: () => toast.success('Notification deleted') });
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
};

export const NotificationsPage = () => {
  const { params, set } = useListParams({ limit: 20 });
  const filter = params.filter === 'unread' ? 'unread' : params.filter === 'starred' ? 'starred' : 'all';
  const list = useNotifications({
    page: params.page,
    limit: params.limit,
    ...(filter === 'unread' ? { unread: true } : filter === 'starred' ? { starred: true } : {}),
  });
  const unreadCount = useNotifications({ page: 1, limit: 1, unread: true });
  const markAll = useMarkAllNotificationsRead();
  const navigate = useNavigate();
  const unread = unreadCount.data?.pagination.total ?? 0;
  const rows = list.data?.data ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        description={`${unread ? `You have ${unread} unread notification${unread === 1 ? '' : 's'}` : 'You are all caught up'} · read notifications are deleted after ${READ_NOTIFICATION_TTL_HOURS} hours unless you star them`}
        actions={
          <>
            <Button variant="outline" icon={<Settings2 className="h-4 w-4" />} onClick={() => navigate('/settings/notifications')}>
              Preferences
            </Button>
            <Button
              icon={<CheckCheck className="h-4 w-4" />}
              disabled={!unread}
              loading={markAll.isPending}
              onClick={() => markAll.mutate(undefined, { onSuccess: (res) => toast.success(res.message ?? 'All notifications marked as read') })}
            >
              Mark all read
            </Button>
          </>
        }
      />
      <div className="card overflow-hidden">
        <Tabs
          className="px-3"
          tabs={[
            { key: 'all', label: 'All' },
            { key: 'unread', label: 'Unread', count: unread || undefined },
            { key: 'starred', label: 'Starred' },
          ]}
          active={filter}
          onChange={(key) => set({ filter: key === 'unread' || key === 'starred' ? key : undefined })}
        />
        <div role="tabpanel" aria-labelledby={`tab-${filter}`}>
          {list.isLoading ? (
            <ul className="divide-y divide-line" aria-busy>
              {Array.from({ length: 6 }).map((_, i) => (
                <li key={i} className="flex gap-3 px-5 py-4">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                </li>
              ))}
            </ul>
          ) : list.error ? (
            <ErrorState message={list.error.message} onRetry={() => list.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={filter === 'unread' ? <CheckCheck className="h-6 w-6" /> : filter === 'starred' ? <Star className="h-6 w-6" /> : <BellOff className="h-6 w-6" />}
              title={filter === 'unread' ? 'No unread notifications' : filter === 'starred' ? 'No starred notifications' : 'No notifications yet'}
              description={
                filter === 'unread'
                  ? "You've read everything. Nice work."
                  : filter === 'starred'
                    ? `Star an important notification to keep it; others are deleted ${READ_NOTIFICATION_TTL_HOURS} hours after you read them.`
                    : 'Approvals, reminders and updates will appear here.'
              }
              action={
                filter !== 'all' ? (
                  <Button variant="outline" onClick={() => set({ filter: undefined })}>
                    View all
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className={cn('divide-y divide-line', list.isFetching && 'opacity-70 transition-opacity')}>
              {rows.map((n) => (
                <NotificationRow key={n._id} n={n} />
              ))}
            </ul>
          )}
        </div>
        {list.data && rows.length > 0 && <Pagination pagination={list.data.pagination} onPageChange={(page) => set({ page })} onLimitChange={(limit) => set({ limit })} loading={list.isFetching} />}
      </div>
    </div>
  );
};
