import { ErrorState, Skeleton } from '@/components/ui/display';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useAdminDashboard, useEmployeeDashboard } from '../api';
import { dashboardKind } from '../lib';
import { AdminClockCard } from './admin-clock-card';
import { PendingApprovals } from './admin-section';
import { AnnouncementCards } from './announcement-cards';
import { AttendanceOverview } from './attendance-overview';
import { SalesOverview } from './sales-overview';
import { SchedulesCard } from './schedules-card';
import { ActivityFeed } from './activity-feed';
import { TasksCard } from './tasks-card';
import { TodoCard } from './todo-card';
import { boxedCard, WidgetBoundary } from './widget';

/** Head / MD dashboard: attendance, clock in/out, approvals, birthdays, schedules, announcements, people, sales, todo, tasks, activity. */
export const HeadSection = () => {
  const dash = useAdminDashboard(true);
  const { user, hasEmployee } = usePermissions();
  const isHr = dashboardKind(user?.roles) === 'hr';
  const d = dash.data;
  if (dash.isLoading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading company overview">
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96" />
          <Skeleton className="h-96 lg:col-span-2" />
        </div>
      </div>
    );
  }
  if (dash.error || !d)
    return (
      <ErrorState
        className="card"
        title="Couldn't load the company overview"
        message={dash.error?.message}
        onRetry={() => dash.refetch()}
      />
    );

  return (
    <div className="space-y-4">
      {/*
        12-column grid, one row of equal-height halves: Attendance overview | Pending approvals.
        The super admin is the boss: no clock-in cards (neither his own Today card nor the team Clock-In/Out list).
      */}
      <div className="grid gap-4 lg:grid-cols-12">
        <WidgetBoundary title="Attendance overview">
          <div className="flex flex-col lg:col-span-6 [&>*]:flex-1">
            <AttendanceOverview />
          </div>
        </WidgetBoundary>
        {/* Right half: (HR only) their Today clock card, then "Awaiting your approval" and Todo, equal heights. */}
        <div className="flex flex-col gap-4 lg:col-span-6">
          {isHr && hasEmployee && (
            <WidgetBoundary title="Today">
              {/* HR still clocks in (the super admin doesn't): violet Clock in / Clock out. */}
              <AdminClockCard tone="pink" className="shrink-0" />
            </WidgetBoundary>
          )}
          <WidgetBoundary title="Pending approvals">
            <div className="flex min-h-56 flex-1 basis-0 flex-col [&>*]:flex-1">
              {/* Line under the title (and violet border), like the other boxed cards. */}
              <PendingApprovals d={d} titleBox="bg-violet-200" compact className={boxedCard} />
            </div>
          </WidgetBoundary>
          {/* Super admin: Todo under the approvals (equal heights). HR has it beside Tasks, in place of Sales overview. */}
          {!isHr && (
            <WidgetBoundary title="Todo">
              <div className="flex min-h-56 flex-1 basis-0 flex-col [&>*]:flex-1">
                <TodoCard fill />
              </div>
            </WidgetBoundary>
          )}
        </div>
      </div>
    </div>
  );
};

/* Pieces of the admin overview's lower rows; DashboardPage places them so the right-hand cards line up. */

/** Schedules | Latest announcements. */
export const ScheduleRow = () => {
  const mine = useEmployeeDashboard();
  const { hasEmployee } = usePermissions();
  const announcements = hasEmployee && mine.data;
  return (
    <div className="grid h-full gap-4 lg:grid-cols-2">
      <WidgetBoundary title="Schedules">
        <div className={cn('flex flex-col [&>*]:flex-1', !announcements && 'lg:col-span-2')}>
          <SchedulesCard />
        </div>
      </WidgetBoundary>
      {announcements ? (
        <WidgetBoundary title="Announcements">
          <div className="flex flex-col [&>*]:flex-1">
            <AnnouncementCards data={mine.data!} titleBox="bg-fuchsia-300" className={boxedCard} />
          </div>
        </WidgetBoundary>
      ) : null}
    </div>
  );
};

/** Sales overview | Tasks. */
export const SalesRow = ({ todoInsteadOfSales = false }: { /** HR: Todo in place of Sales overview. */ todoInsteadOfSales?: boolean }) => (
  <div className="grid h-full gap-4 lg:grid-cols-2">
    {todoInsteadOfSales ? (
      <WidgetBoundary title="Todo">
        <div className="flex min-h-72 flex-col [&>*]:flex-1">
          <TodoCard fill />
        </div>
      </WidgetBoundary>
    ) : (
      <WidgetBoundary title="Sales overview">
        <div className="flex flex-col [&>*]:flex-1">
          <SalesOverview />
        </div>
      </WidgetBoundary>
    )}
    <WidgetBoundary title="Tasks">
      <div className="flex min-h-0 flex-col [&>*]:flex-1">
        <TasksCard />
      </div>
    </WidgetBoundary>
  </div>
);

/** HR dashboard: Schedules | Latest announcements, then Tasks — the super admin's cards. */
export const HrBottomRows = () => (
  <div className="space-y-4">
    <ScheduleRow />
    <WidgetBoundary title="Tasks">
      <TasksCard />
    </WidgetBoundary>
  </div>
);

/** Recent activity sized by its row (Sales / Tasks), scrolling inside. */
export const ActivityCell = () => (
  <WidgetBoundary title="Recent activity">
    <div className="relative flex h-full min-h-72 flex-col [&>*]:flex-1">
      <div className="xl:absolute xl:inset-0">
        <ActivityFeed scope="all" limit={8} className="scrollbar-thin xl:h-full xl:overflow-y-auto" />
      </div>
    </div>
  </WidgetBoundary>
);

/** Todo that fills whatever height it's given (scrolls inside). */
export const TodoFill = () => (
  <WidgetBoundary title="Todo">
    <div className="flex min-h-72 flex-1 flex-col [&>*]:flex-1">
      <TodoCard fill />
    </div>
  </WidgetBoundary>
);
