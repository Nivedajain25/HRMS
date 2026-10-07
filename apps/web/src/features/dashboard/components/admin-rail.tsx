import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, Bell, Cake, ChevronRight, FileWarning, Handshake, Hourglass, Trophy, UserPlus, UserX } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Avatar, Skeleton } from '@/components/ui/display';
import { cn, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useReferralSummary } from '@/features/recruitment/api';
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

/** Candidates referred by employees: totals, the latest few (who referred them, where they are) and the top referrer. */
const ReferralsCard = () => {
  const { can } = usePermissions();
  const allowed = can('recruitment:read');
  const q = useReferralSummary(allowed);
  if (!allowed) return null;
  const d = q.data;
  const stats = d
    ? [
        { label: 'Referred', value: d.total },
        { label: 'In process', value: d.inProcess },
        { label: 'Hired', value: d.hired },
      ]
    : [];
  return (
    <RailCard title="Referrals" icon={<Handshake className="h-4 w-4" />} to="/recruitment/candidates?source=REFERRAL">
      {q.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : q.isError ? (
        <p className="py-3 text-center text-xs text-black/60 dark:text-muted">Couldn't load referrals.</p>
      ) : d && d.total ? (
        <div className="space-y-3">
          <dl className="grid grid-cols-3 gap-2">
            {stats.map((s) => (
              <div key={s.label} className="rounded-xl bg-violet-50 px-2 py-1.5 text-center dark:bg-violet-500/10">
                <dd className="text-lg leading-tight font-bold text-violet-700 tabular-nums dark:text-violet-200">{s.value}</dd>
                <dt className="text-[11px] font-medium text-black/60 dark:text-muted">{s.label}</dt>
              </div>
            ))}
          </dl>
          <ul className="space-y-2">
            {d.recent.slice(0, 4).map((c) => (
              <li key={c._id}>
                <Link to={`/recruitment/candidates/${c._id}`} className="flex items-center gap-3 rounded-lg px-1 py-0.5 hover:bg-violet-50 dark:hover:bg-violet-500/10">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-black dark:text-fg">{fullName(c)}</span>
                    <span className="block truncate text-xs text-black/60 dark:text-muted">
                      {[c.jobId?.title, c.referredBy ? `by ${fullName(c.referredBy)}` : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <StatusBadge status={c.stage} />
                </Link>
              </li>
            ))}
          </ul>
          {d.topReferrer && (
            <Link
              to={`/employees/${d.topReferrer._id}`}
              className="flex items-center gap-2 rounded-lg border-t border-violet-100 px-1 pt-3 text-xs text-black/70 hover:text-black dark:border-violet-500/20 dark:text-muted dark:hover:text-fg"
            >
              <Trophy className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
              <Avatar name={fullName(d.topReferrer)} src={d.topReferrer.profilePhoto ?? undefined} size="xs" />
              <span className="min-w-0 flex-1 truncate">
                Top referrer: <span className="font-semibold text-black dark:text-fg">{fullName(d.topReferrer)}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{d.topReferrer.count}</span>
            </Link>
          )}
        </div>
      ) : (
        <p className="py-3 text-center text-xs text-black/60 dark:text-muted">
          No referrals yet. Add a candidate with source “Referral” and pick who referred them.
        </p>
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
 * Admin dashboard right-hand column: Quick Actions, New Joiners, Referrals, Employee Alerts, Employees — plus Todo and
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
    <ReferralsCard />
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
