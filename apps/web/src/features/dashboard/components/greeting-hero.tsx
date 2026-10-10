import { useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarPlus, LayoutGrid, ListPlus, Megaphone, PartyPopper, Target, Users, Zap } from 'lucide-react';
import { AllFeaturesModal } from './all-features';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useOrgTimezone } from '@/features/attendance/lib';
import { useTasks } from '@/features/tasks/api';
import { useAdminDashboard, useEmployeeDashboard } from '../api';
import { dashboardKind, greetingFor, inDaysLabel } from '../lib';
import { adminTitleStyle, PlainTitlesContext, TileTitle, TitleBoxContext, TitleIcon, titlePill } from './widget';

/** An underlined brand-coloured number that links to where those items are. */
const Count = ({ to, value, loading }: { to: string; value: number | undefined; loading: boolean }) =>
  loading ? (
    <span className="inline-block h-3.5 w-5 animate-pulse rounded bg-white/70 align-middle dark:bg-white/10" aria-hidden />
  ) : (
    <Link to={to} className="font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-700 dark:text-brand-300">
      {value ?? 0}
    </Link>
  );

/** Role-aware quick actions (Apply leave, My Goals, My team, Live board, and for everyone Announce and Assign task). */
const useQuickActions = () => {
  const { user, can, hasEmployee, isManager } = usePermissions();
  const actions: { to: string; icon: ReactNode; label: string }[] = [];
  if (hasEmployee) {
    actions.push({ to: '/leave', icon: <CalendarPlus className="h-4 w-4" />, label: 'Apply leave' });
    actions.push({ to: '/performance/goals', icon: <Target className="h-4 w-4" />, label: 'My Goals' });
  }
  // Employees get "My team" here (their team dashboard, or their manager and teammates); HR and Head don't.
  if (hasEmployee && dashboardKind(user?.roles) === 'employee') actions.push({ to: '/team', icon: <Users className="h-4 w-4" />, label: 'My team' });
  // Live board: the whole company with attendance:read, a manager's reports, or an employee's own team (status only).
  if (can('attendance:read')) actions.push({ to: '/attendance?view=board', icon: <LayoutGrid className="h-4 w-4" />, label: 'Live board' });
  else if (isManager) actions.push({ to: '/attendance?view=board&scope=team', icon: <LayoutGrid className="h-4 w-4" />, label: 'Live board' });
  else if (hasEmployee) actions.push({ to: '/attendance?view=board', icon: <LayoutGrid className="h-4 w-4" />, label: 'Live board' });
  // Anyone can post an announcement or give a colleague a task.
  actions.push({ to: '/announcements?new=1', icon: <Megaphone className="h-4 w-4" />, label: 'Announce' });
  actions.push({ to: '/tasks?assign=1', icon: <ListPlus className="h-4 w-4" />, label: 'Assign task' });
  return actions.slice(0, 6);
};

/** Admin dashboard (right column): the quick actions as a list card. */
/** `warm`: employee dashboard heading format (light blue icon tile + plain black title). */
export const QuickActionsCard = ({ compact = false, warm = false }: { compact?: boolean; warm?: boolean }) => {
  const actions = useQuickActions();
  // HR: the admin-style boxed title (lightning icon + "Quick Actions" in a violet pill).
  // Employee (tiles map in the context): icon on a soft-blue tile, plain black title.
  const dashboardStyle = useContext(TitleBoxContext);
  const employeeTiles = typeof dashboardStyle === 'object' ? dashboardStyle : null;
  const pill = dashboardStyle ? adminTitleStyle('Quick Actions') : null;
  const plainTitles = useContext(PlainTitlesContext);
  const [allOpen, setAllOpen] = useState(false);
  if (!actions.length) return null;
  return (
    <section
      aria-labelledby="quick-actions-title"
      className={cn(
        'rounded-2xl bg-white shadow-card ring-1 ring-violet-100 motion-safe:animate-fade-up dark:bg-surface dark:ring-violet-500/20',
        compact ? 'p-3 [&_h2]:mb-2' : 'p-4',
      )}
    >
      {employeeTiles && pill ? (
        <div className="mb-3">
          <TileTitle as="h2" id="quick-actions-title" title="Quick Actions" icon={pill.icon} tile={employeeTiles['Quick Actions']} />
        </div>
      ) : pill ? (
        <h2 id="quick-actions-title" className={cn('mb-3 font-semibold', plainTitles.has('Quick Actions') ? 'text-base text-black dark:text-fg' : cn('inline-block', titlePill, pill.box))}>
          {pill.icon ? <TitleIcon icon={pill.icon} /> : null}
          Quick Actions
        </h2>
      ) : (
        <h2 id="quick-actions-title" className="mb-3 flex items-center gap-2 text-base font-semibold text-black dark:text-fg">
          {warm ? (
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#dbeafe] text-[#1d4ed8] dark:bg-[#1d4ed8]/25 dark:text-[#dbeafe]" aria-hidden>
              <Zap className="h-4 w-4" />
            </span>
          ) : (
            <Zap className="h-4 w-4 text-violet-600 dark:text-violet-300" aria-hidden />
          )}
          Quick Actions
        </h2>
      )}
      <ul className={compact ? 'grid grid-cols-2 gap-2' : 'space-y-2'}>
        {actions.map((a) => (
          <li key={a.to}>
            <Link
              to={a.to}
              className={cn(
                'group flex items-center gap-3 rounded-xl px-3 text-sm font-medium text-black transition-colors dark:text-fg',
                warm
                  ? 'bg-[#eff6ff] hover:bg-[#dbeafe] dark:bg-[#1d4ed8]/15 dark:hover:bg-[#1d4ed8]/25'
                  : 'bg-violet-50 hover:bg-violet-100 dark:bg-violet-500/10 dark:hover:bg-violet-500/20',
                compact ? 'py-1.5' : 'py-2.5',
              )}
            >
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-lg shadow-sm',
                  warm ? 'bg-[#dbeafe] text-[#1d4ed8] dark:bg-[#1d4ed8]/25 dark:text-[#dbeafe]' : 'bg-white text-violet-600 dark:bg-violet-500/20 dark:text-violet-200',
                )}
                aria-hidden
              >
                {a.icon}
              </span>
              <span className="flex-1">{a.label}</span>
              <ArrowRight className={cn('h-4 w-4 transition-transform group-hover:translate-x-0.5', warm ? 'text-[#1d4ed8] dark:text-[#dbeafe]' : 'text-violet-500')} aria-hidden />
            </Link>
          </li>
        ))}
        {/* More: every feature as app icons, grouped like the menu. */}
        <li>
          <button
            type="button"
            onClick={() => setAllOpen(true)}
            className={cn(
              'group flex w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-black transition-colors dark:text-fg',
              warm
                ? 'bg-[#eff6ff] hover:bg-[#dbeafe] dark:bg-[#1d4ed8]/15 dark:hover:bg-[#1d4ed8]/25'
                : 'bg-violet-50 hover:bg-violet-100 dark:bg-violet-500/10 dark:hover:bg-violet-500/20',
              compact ? 'py-1.5' : 'py-2.5',
            )}
          >
            <span
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-lg shadow-sm',
                warm ? 'bg-[#dbeafe] text-[#1d4ed8] dark:bg-[#1d4ed8]/25 dark:text-[#dbeafe]' : 'bg-white text-violet-600 dark:bg-violet-500/20 dark:text-violet-200',
              )}
              aria-hidden
            >
              <LayoutGrid className="h-4 w-4" />
            </span>
            <span className="flex-1">More — all features</span>
            <ArrowRight className={cn('h-4 w-4 transition-transform group-hover:translate-x-0.5', warm ? 'text-[#1d4ed8] dark:text-[#dbeafe]' : 'text-violet-500')} aria-hidden />
          </button>
        </li>
      </ul>
      <AllFeaturesModal open={allOpen} onClose={() => setAllOpen(false)} />
    </section>
  );
};

/** Dashboard welcome banner: greeting, live clock, quick info chips and role-aware quick actions. */
export const GreetingHero = () => {
  const { user, can, hasEmployee } = usePermissions();
  const timeZone = useOrgTimezone();
  const dash = useEmployeeDashboard();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Only the greeting (morning / afternoon / evening) depends on the time now.
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const greeting = greetingFor(timeZone, now);
  const GreetingIcon = greeting.icon;
  const isEmployeeKind = dashboardKind(user?.roles) === 'employee';
  // Every role gets the same soft "aurora" hero; only the tint differs, matching its sidebar accent:
  // Super Admin and HR lavender, Employee blue.
  const theme = isEmployeeKind
    ? { bg: 'from-blue-100 via-white to-sky-50 dark:from-blue-500/15 dark:via-surface dark:to-sky-500/10', glow: 'bg-blue-200/60 dark:bg-blue-500/20' }
    : { bg: 'from-violet-100 via-white to-sky-50 dark:from-violet-500/15 dark:via-surface dark:to-sky-500/10', glow: 'bg-violet-300/50 dark:bg-violet-500/25' };
  // Aurora glows (three soft colour washes) per role.
  const aurora = isEmployeeKind
    ? ['bg-blue-300/35 dark:bg-blue-500/15', 'bg-sky-200/50 dark:bg-sky-500/10', 'bg-indigo-300/25 dark:bg-indigo-500/15']
    : ['bg-fuchsia-300/40 dark:bg-fuchsia-500/15', 'bg-sky-300/40 dark:bg-sky-500/15', 'bg-violet-400/30 dark:bg-violet-500/20'];
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  const holiday = dash.data?.upcomingHolidays?.[0];
  const unread = dash.data?.unreadNotifications ?? 0;
  // HR / super admin see approvals waiting; everyone else their notifications and open tasks.
  const orgWide = can('employee:read') || can('report:read');
  const org = useAdminDashboard(orgWide);
  const pa = org.data?.cards.pendingApprovals;
  const openTasks = useTasks({ scope: 'mine', state: 'open', page: 1, limit: 1 }, !orgWide && hasEmployee);

  const decoration = (
    <>
      <div className={cn('pointer-events-none absolute -top-16 -right-10 h-48 w-48 rounded-full blur-3xl', theme.glow)} aria-hidden />
      {/* Big faded picture for the part of the day: morning sun, afternoon sun + cloud, evening moon. */}
      <span
        className={cn('pointer-events-none absolute -right-2 -bottom-7 leading-none opacity-15 select-none motion-safe:animate-[float_6s_ease-in-out_infinite] sm:right-6', greeting.tone)}
        aria-hidden
      >
        <GreetingIcon className="h-28 w-28" strokeWidth={1.5} />
      </span>
    </>
  );
  const greetingBlock = (
        <div className="relative min-w-0 motion-safe:animate-fade-up">
          {/* The greeting is the page's heading (no separate title above it). */}
          <h1 className="text-[1.75rem] leading-tight font-bold tracking-tight text-fg sm:whitespace-nowrap">
            {greeting.text}{' '}
            <span aria-hidden className={cn('inline-block align-[-0.125em] motion-safe:animate-[wave_2.2s_ease-in-out_1]', greeting.tone)}>
              <GreetingIcon className="h-7 w-7" />
            </span>
            {name && <> {name}</>}
          </h1>

          {/* What's waiting, each number a link: approvals & leave (HR / admin), else notifications & tasks. */}
          <p className="mt-2 text-base text-fg-2">
            {orgWide ? (
              <>
                You have <Count to="/leave?tab=approvals" value={pa?.total} loading={org.isLoading} /> Pending Approvals &{' '}
                <Count to="/leave?tab=all" value={pa?.leave} loading={org.isLoading} /> Leave Requests
              </>
            ) : (
              <>
                You have <Count to="/notifications" value={unread} loading={dash.isLoading} /> Unread Notifications &{' '}
                <Count to="/tasks" value={openTasks.data?.pagination.total} loading={openTasks.isLoading} /> Open Tasks
              </>
            )}
            {holiday && (
              <Link to="/holidays" className="ml-2 inline-flex items-center gap-1 text-teal-700 hover:underline dark:text-teal-300">
                <PartyPopper className="h-3.5 w-3.5" aria-hidden />
                {holiday.name} · {inDaysLabel(holiday.inDays)}
              </Link>
            )}
          </p>
        </div>
  );

  // Just the greeting; Quick Actions live in the page's right-hand column.
  return (
    <header className={cn('relative overflow-hidden rounded-2xl bg-gradient-to-br px-5 py-6 shadow-sm ring-1 ring-line sm:px-7', theme.bg)}>
      {/* Aurora: three soft colour washes drifting behind the text. */}
      <div className={cn('pointer-events-none absolute -top-20 left-1/4 h-56 w-80 rounded-full blur-3xl motion-safe:animate-[float_9s_ease-in-out_infinite]', aurora[0])} aria-hidden />
      <div className={cn('pointer-events-none absolute -bottom-24 -left-10 h-56 w-64 rounded-full blur-3xl', aurora[1])} aria-hidden />
      <div className={cn('pointer-events-none absolute -right-10 -bottom-16 h-52 w-72 rounded-full blur-3xl motion-safe:animate-[float_11s_ease-in-out_infinite]', aurora[2])} aria-hidden />
      {decoration}
      {greetingBlock}
    </header>
  );
};
