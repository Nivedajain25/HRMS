import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, Bell, Cake, ChevronRight, FileWarning, Hourglass, UserPlus, UserX } from 'lucide-react';
import { Avatar, Skeleton } from '@/components/ui/display';
import { cn } from '@/lib/utils';
import { useAdminDashboard } from '../api';
import { formatKey } from '../lib';
import { ActivityFeed } from './activity-feed';
import { EmployeesCard } from './employees-card';
import { QuickActionsCard } from './greeting-hero';
import { TodoCard } from './todo-card';
import { WidgetBoundary } from './widget';

const RailCard = ({ title, icon, to, children }: { title: string; icon: ReactNode; to?: string; children: ReactNode }) => (
  <section className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-violet-100 motion-safe:animate-fade-up dark:bg-surface dark:ring-violet-500/20">
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-base font-semibold text-black dark:text-fg">
        <span className="text-violet-600 dark:text-violet-300" aria-hidden>
          {icon}
        </span>
        {title}
      </h2>
      {to ? (
        <Link to={to} className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-300">
          View all
        </Link>
      ) : null}
    </div>
    {children}
  </section>
);

/** The latest joiners: photo, name, designation and joining date. */
const NewJoinersCard = () => {
  const admin = useAdminDashboard(true);
  const people = admin.data?.insights.recentJoiners ?? admin.data?.insights.joinersThisMonth ?? [];
  return (
    <RailCard title="New Joiners" icon={<UserPlus className="h-4 w-4" />} to="/employees">
      {admin.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : people.length ? (
        <ul className="space-y-3">
          {people.slice(0, 4).map((p) => (
            <li key={p._id}>
              <Link to={`/employees/${p._id}`} className="flex items-center gap-3 rounded-lg px-1 py-0.5 hover:bg-violet-50 dark:hover:bg-violet-500/10">
                <Avatar name={p.name} src={p.profilePhoto ?? undefined} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-black dark:text-fg">{p.name}</span>
                  <span className="block truncate text-xs text-black/60 dark:text-muted">{[p.designation, p.department].filter(Boolean).join(' · ') || 'New joiner'}</span>
                </span>
                {p.date ? (
                  <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-violet-700 dark:bg-violet-500/20 dark:text-violet-200">
                    {formatKey(p.date, 'dd MMM')}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-3 text-center text-xs text-black/60 dark:text-muted">No recent joiners.</p>
      )}
    </RailCard>
  );
};

const ALERT_TONE = {
  rose: 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300',
  amber: 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300',
  blue: 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300',
  violet: 'bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300',
  pink: 'bg-pink-100 text-pink-600 dark:bg-pink-500/20 dark:text-pink-300',
} as const;

/** Things that need HR's eye today: absences, late arrivals, expiring documents, probation ends, birthdays. */
const EmployeeAlertsCard = () => {
  const admin = useAdminDashboard(true);
  const d = admin.data;
  const birthdays = (d?.widgets.upcomingBirthdays ?? []).filter((b) => b.inDays <= 7).length;
  const alerts: { text: string; count: number; icon: ReactNode; tone: keyof typeof ALERT_TONE; to: string }[] = d
    ? [
        { text: 'Absent today', count: d.cards.absentToday, icon: <UserX className="h-4 w-4" />, tone: 'rose', to: '/attendance?view=board' },
        { text: 'Arrived late', count: d.cards.lateToday, icon: <AlarmClock className="h-4 w-4" />, tone: 'amber', to: '/attendance' },
        { text: 'Documents expiring soon', count: d.widgets.expiringDocuments.length, icon: <FileWarning className="h-4 w-4" />, tone: 'blue', to: '/documents' },
        { text: 'Probation ending soon', count: d.insights.probationEndingSoon ?? 0, icon: <Hourglass className="h-4 w-4" />, tone: 'violet', to: '/employees' },
        { text: 'Birthdays this week', count: birthdays, icon: <Cake className="h-4 w-4" />, tone: 'pink', to: '/employees' },
      ]
    : [];
  return (
    <RailCard title="Employee Alerts" icon={<Bell className="h-4 w-4" />} to="/notifications">
      {admin.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : (
        <ul className="space-y-1">
          {alerts.map((a) => (
            <li key={a.text}>
              <Link to={a.to} className="group flex items-center gap-3 rounded-lg px-1 py-1.5 text-sm text-black hover:bg-violet-50 dark:text-fg dark:hover:bg-violet-500/10">
                <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', ALERT_TONE[a.tone])} aria-hidden>
                  {a.icon}
                </span>
                <span className="min-w-0 flex-1 leading-snug">{a.text}</span>
                <span className={cn('min-w-7 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-bold tabular-nums', ALERT_TONE[a.tone])} aria-label={`${a.count}`}>
                  {a.count}
                </span>
                <ChevronRight className="h-4 w-4 text-black/40 transition-transform group-hover:translate-x-0.5 dark:text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  );
};

/**
 * Admin dashboard right-hand column: Quick Actions, New Joiners, Employee Alerts, Employees — plus Todo and
 * Recent activity unless `withRows` (the Company overview shows those two in its bottom rows instead).
 */
export const AdminRail = ({
  withRows = false,
  todo = true,
  todoUnderEmployees = false,
}: {
  withRows?: boolean;
  /** Include the Todo card (not on the HR dashboard). */
  todo?: boolean;
  /** HR Company overview: Todo right under Employees (even with `withRows`). */
  todoUnderEmployees?: boolean;
}) => (
  <aside aria-label="Shortcuts and alerts" className="space-y-4">
    <QuickActionsCard />
    <NewJoinersCard />
    <EmployeeAlertsCard />
    <WidgetBoundary title="Employees">
      <EmployeesCard />
    </WidgetBoundary>
    {todoUnderEmployees && (
      <WidgetBoundary title="Todo">
        <TodoCard compact />
      </WidgetBoundary>
    )}
    {/* On the Company overview, Todo and Recent activity sit in the rows below (lined up with Announcements and Tasks). */}
    {!withRows && (
      <>
        {todo && (
          <WidgetBoundary title="Todo">
            <TodoCard compact />
          </WidgetBoundary>
        )}
        <WidgetBoundary title="Recent activity">
          <ActivityFeed scope="all" limit={8} />
        </WidgetBoundary>
      </>
    )}
  </aside>
);
