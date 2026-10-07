import { Link, useNavigate } from 'react-router-dom';
import { Bell, Check, CheckCircle2, PartyPopper, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorState, ProgressBar, Skeleton } from '@/components/ui/display';
import { label } from '@/lib/i18n';
import { cn, timeAgo } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { READ_NOTIFICATION_TTL_HOURS, useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from '@/features/notifications/api';
import { StarButton } from '@/features/notifications/star-button';
import { MyTasksWidget } from '@/features/tasks/components/my-tasks-widget';
import { useEmployeeDashboard, type EmployeeDashboard } from '../api';
import { dashboardKind, formatKey, inDaysLabel } from '../lib';
import { ActivityFeed } from './activity-feed';
import { AnnouncementCards } from './announcement-cards';
import { QuickActionsCard } from './greeting-hero';
import { AdminClockCard } from './admin-clock-card';
import { MyAttendanceOverview } from './my-attendance-overview';
import { MyCalendar } from './my-calendar';
import { ListSkeleton, ViewAllLink, Widget, WidgetBoundary, WidgetEmpty } from './widget';


/* ------------------------------- Holidays ------------------------------ */

/** `box`: admin "My day" style — title in a coloured box (these bg classes), black text. */
const Holidays = ({ data, box }: { data: EmployeeDashboard; box?: string }) => (
  <Widget
    title={box ? '🎉 Upcoming holidays' : 'Upcoming holidays'}
    titleBox={box}
    className={box ? 'border-violet-200 dark:border-violet-500/20 [&>header]:border-b [&>header]:border-line' : undefined}
    icon={box ? undefined : <PartyPopper className="h-4 w-4" />}
    accent="teal"
    action={<ViewAllLink to="/holidays" />}
    empty={!data.upcomingHolidays.length}
    emptyState={<WidgetEmpty icon={<PartyPopper className="h-4 w-4" />} title="No upcoming holidays" />}
  >
    <ul className="divide-y divide-line px-5 pb-1.5">
      {data.upcomingHolidays.slice(0, 3).map((h) => (
        <li key={`${h.date}-${h.name}`} className="flex items-center gap-3 py-2">
          <span className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg border border-line bg-surface-2 leading-none">
            <span className="text-[9px] font-semibold text-brand-600 uppercase dark:text-brand-400">{formatKey(h.date, 'MMM')}</span>
            <span className="mt-0.5 text-sm font-semibold text-fg">{formatKey(h.date, 'd')}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-fg">{h.name}</span>
            <span className="block text-xs text-muted">
              {formatKey(h.date, 'EEEE')}
              {h.optional ? ' · Optional' : ''}
            </span>
          </span>
          <span className={cn('shrink-0 text-xs font-medium', h.inDays <= 7 ? 'text-brand-600 dark:text-brand-400' : 'text-muted')}>
            {inDaysLabel(h.inDays)}
          </span>
        </li>
      ))}
    </ul>
  </Widget>
);

/* -------------------------------- Goals -------------------------------- */

const Goals = ({ data, box }: { data: EmployeeDashboard; box?: string }) => (
  <Widget
    title={box ? '🎯 My goals' : 'My goals'}
    titleBox={box}
    className={box ? 'border-violet-200 dark:border-violet-500/20 [&>header]:border-b [&>header]:border-line' : undefined}
    description={data.goals.length ? `${data.goals.length} active` : undefined}
    icon={box ? undefined : <Target className="h-4 w-4" />}
    accent="amber"
    action={<ViewAllLink to="/performance/goals" />}
    empty={!data.goals.length}
    emptyState={
      <WidgetEmpty icon={<Target className="h-4 w-4" />} title="No active goals" description="Goals you're working on show up here." />
    }
  >
    <ul className="px-2 pb-2">
      {data.goals.slice(0, 3).map((g) => (
        <li key={g._id}>
          <Link to={`/performance/goals/${g._id}`} className="block rounded-lg px-3 py-1.5 hover:bg-surface-2">
            <span className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-fg">{g.title}</span>
              <span className="shrink-0 text-xs font-semibold text-fg-2 tabular-nums">{Math.round(g.progress)}%</span>
            </span>
            <ProgressBar value={g.progress} tone={g.progress >= 100 ? 'green' : 'brand'} className="mt-1.5 h-1.5" />
            <span className="mt-1 block text-[11px] text-muted">
              {label(g.category)}
              {g.dueDate ? ` · due ${formatKey(g.dueDate.slice(0, 10), 'dd MMM')}` : ''}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  </Widget>
);

/* ---------------------------- Notifications ---------------------------- */

/** `boxed`: emoji title in a blue box, a line under the header, blue border (pairs with My tasks). */
const NotificationsWidget = ({ unread, boxed = false, box }: { unread?: number; boxed?: boolean; box?: string }) => {
  const list = useNotifications({ page: 1, limit: 4, unread: true });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const navigate = useNavigate();
  const count = unread ?? list.data?.pagination.total ?? 0;
  return (
    <Widget
      title={box ? '🔔 Notifications' : 'Notifications'}
      titleBox={box}
      className={boxed ? 'bg-[#f8fbff] dark:bg-surface [&>header]:border-b [&>header]:border-line' : box ? 'border-violet-200 dark:border-violet-500/20 [&>header]:border-b [&>header]:border-line' : undefined}
      description={count ? `${count} unread` : 'All caught up'}
      icon={box ? undefined : <Bell className="h-4 w-4" />}
      accent={boxed ? 'warm' : 'red'}
      action={
        <span className="flex items-center gap-3">
          {count > 1 && (
            <button type="button" onClick={() => markAll.mutate()} disabled={markAll.isPending} className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400">
              Mark all read
            </button>
          )}
          <ViewAllLink to="/notifications" />
        </span>
      }
      loading={list.isLoading}
      error={list.error}
      onRetry={() => list.refetch()}
      skeleton={<ListSkeleton rows={3} />}
      empty={!list.data?.data.length}
      emptyState={
        <WidgetEmpty
          icon={<CheckCircle2 className="h-4 w-4" />}
          title="You're all caught up"
          description="New notifications will appear here."
        />
      }
    >
      <ul className="divide-y divide-line px-2 pb-2">
        {list.data?.data.map((n) => (
          <li key={n._id} className="flex items-start gap-1">
            <button
              type="button"
              className="flex min-w-0 flex-1 gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2"
              onClick={() => {
                markRead.mutate(n._id);
                if (n.link) navigate(n.link);
              }}
            >
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-fg">{n.title}</span>
                <span className="line-clamp-1 block text-xs text-muted">{n.message}</span>
                <span className="mt-0.5 block text-[11px] text-subtle">{timeAgo(n.createdAt)}</span>
              </span>
            </button>
            {/* Star to keep it; mark as read without opening it (read ones are deleted 12 hours later unless starred). */}
            <span className="mt-2 flex shrink-0 items-center">
              <StarButton n={n} />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Mark "${n.title}" as read`}
                title={n.starred ? 'Mark as read (starred: kept)' : `Mark as read (deleted after ${READ_NOTIFICATION_TTL_HOURS} hours)`}
                disabled={markRead.isPending}
                onClick={() => markRead.mutate(n._id)}
              >
                <Check className="h-4 w-4" />
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <p className="px-5 pb-3 text-[11px] text-subtle">Read notifications are deleted after {READ_NOTIFICATION_TTL_HOURS} hours. Star one to keep it.</p>
    </Widget>
  );
};

/* ------------------------------- Section ------------------------------- */

const SectionSkeleton = () => (
  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading your dashboard">
    <Skeleton className="h-56 lg:col-span-2" />
    <Skeleton className="h-56" />
    <Skeleton className="h-64" />
    <Skeleton className="h-64" />
    <Skeleton className="h-64" />
  </div>
);

export const EmployeeSection = () => {
  const { hasEmployee, user } = usePermissions();
  // Super admin and HR share the admin "My day" (big calendar with reminders).
  const isAdmin = ['head', 'hr'].includes(dashboardKind(user?.roles));
  const dash = useEmployeeDashboard();
  const d = dash.data;

  return (
    <div className="space-y-4">

      {dash.isLoading ? (
        <SectionSkeleton />
      ) : dash.error || !d ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <ErrorState
            className="card lg:col-span-2"
            title="Couldn't load your day"
            message={dash.error?.message}
            onRetry={() => dash.refetch()}
          />
          <WidgetBoundary title="Notifications">
            <NotificationsWidget />
          </WidgetBoundary>
        </div>
      ) : (
        // Dense flow so the announcements card sits in the right column under Attendance while the rest fill in.
        <div className="grid gap-4 md:grid-flow-row-dense md:grid-cols-2 xl:grid-cols-3">
          {/* Admin (head) gets the big calendar; everyone else keeps Today + Attendance overview for now. */}
          {hasEmployee &&
            (isAdmin ? (
              <div className="md:col-span-2 xl:col-span-3">
                <WidgetBoundary title="My calendar">
                  <MyCalendar />
                </WidgetBoundary>
              </div>
            ) : (
              // Today and Attendance overview side by side, equal width and height.
              <div className="grid gap-4 md:col-span-2 md:grid-cols-2 xl:col-span-3 [&>*]:h-full">
                {/* Same clock card as the super admin dashboard: live time, Clock in / Clock out, In / Out / Break. */}
                <WidgetBoundary title="Today">
                  <AdminClockCard className="h-full" tone="pink" />
                </WidgetBoundary>
                <WidgetBoundary title="Attendance overview">
                  <MyAttendanceOverview date={d.date} />
                </WidgetBoundary>
              </div>
            ))}
          {/*
            Left block. Admin: Goals + Holidays, then My tasks, Notifications and activity.
            Everyone else: My tasks | Notifications side by side (equal, styled like Today | Attendance), then activity;
            Announcements, Holidays and Goals are in the right-hand column (EmployeeRail).
          */}
          <div className={cn('space-y-4 self-start md:col-span-2 xl:col-span-3')}>
            {hasEmployee && isAdmin && (
              <div className="grid items-start gap-4 md:grid-cols-2">
                <WidgetBoundary title="Goals">
                  <Goals data={d} box="bg-violet-300" />
                </WidgetBoundary>
                <WidgetBoundary title="Holidays">
                  <Holidays data={d} box="bg-purple-200" />
                </WidgetBoundary>
              </div>
            )}
            {isAdmin ? (
              // Side by side, same height.
              <div className={cn('grid gap-4', hasEmployee && 'md:grid-cols-2')}>
                {hasEmployee && (
                  <WidgetBoundary title="My tasks">
                    <MyTasksWidget box="bg-fuchsia-200" />
                  </WidgetBoundary>
                )}
                <WidgetBoundary title="Notifications">
                  <NotificationsWidget unread={d.unreadNotifications} box="bg-violet-200" />
                </WidgetBoundary>
              </div>
            ) : (
              <div className={cn('grid gap-4', hasEmployee && 'md:grid-cols-2')}>
                {hasEmployee && (
                  <WidgetBoundary title="My tasks">
                    <MyTasksWidget boxed />
                  </WidgetBoundary>
                )}
                <WidgetBoundary title="Notifications">
                  <NotificationsWidget unread={d.unreadNotifications} boxed />
                </WidgetBoundary>
              </div>
            )}
            {/* My recent activity: employees only (removed from the super admin's "My day"). */}
            {hasEmployee && !isAdmin && (
              <WidgetBoundary title="My recent activity">
                <ActivityFeed scope="me" limit={8} boxed />
              </WidgetBoundary>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/** Employee / HR dashboard right-hand column: Quick Actions, Latest announcements, Upcoming holidays, My goals. */
export const EmployeeRail = () => {
  const { hasEmployee, user } = usePermissions();
  // HR uses the super admin's violet Quick Actions; employees keep the blue ones.
  const isHr = dashboardKind(user?.roles) === 'hr';
  const d = useEmployeeDashboard().data;
  return (
    // Narrow column: smaller card headings (title text, icon tile and header padding) so the titles fit.
    <aside
      aria-label="Shortcuts and updates"
      className="flex flex-col gap-4 [&_section>header]:min-h-12 [&_section>header]:px-4 [&_section>header]:py-2.5 [&_section>header_h3]:text-base [&_section>header>div>span:first-child]:h-7 [&_section>header>div>span:first-child]:w-7 [&_section>header>div>span:first-child]:bg-[#dbeafe] [&_section>header>div>span:first-child]:text-[#1d4ed8]"
    >
      <QuickActionsCard warm={!isHr} />
      {d ? (
        <WidgetBoundary title="Announcements">
          <AnnouncementCards data={d} />
        </WidgetBoundary>
      ) : null}
      {d && hasEmployee ? (
        <>
          <WidgetBoundary title="Holidays">
            <Holidays data={d} />
          </WidgetBoundary>
          {/* Last card grows so this column ends level with the main column. */}
          <div className="flex flex-1 flex-col [&>*]:flex-1">
            <WidgetBoundary title="Goals">
              <Goals data={d} />
            </WidgetBoundary>
          </div>
        </>
      ) : null}
    </aside>
  );
};
