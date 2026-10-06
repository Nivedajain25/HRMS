import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, Award, Briefcase, Cake, CircleCheck, Coffee, LayoutGrid, LogOut, Plane, UserMinus, UserPlus, UserX } from 'lucide-react';
import { Avatar, ErrorState, Skeleton, StatCard } from '@/components/ui/display';
import { cn, formatNumber } from '@/lib/utils';
import { useAttendanceBoard, type BoardColumnKey } from '@/features/attendance/api';
import { useAdminDashboard, type AdminDashboard, type MovementPerson } from '../api';
import { formatKey } from '../lib';
import { ActivityFeed } from './activity-feed';
import { CardGroup, ExpiringDocuments, PeopleDates, PendingApprovals } from './admin-section';
import { ViewAllLink, Widget, WidgetBoundary } from './widget';

/* ------------------------------ Attendance ------------------------------ */

const AttendanceToday = ({ d }: { d: AdminDashboard }) => {
  const c = d.cards;
  const expected = Math.max(0, c.activeEmployees - c.onLeaveToday);
  const share = (n: number) => (expected ? `${Math.round((n / expected) * 100)}% of ${expected} expected` : undefined);
  return (
    <CardGroup title="Attendance today" className="md:grid-cols-4">
      <StatCard
        label="On time"
        value={formatNumber(c.onTimeToday)}
        hint={share(c.onTimeToday)}
        icon={<CircleCheck className="h-5 w-5" />}
        tone="green"
        to="/attendance?view=board"
      />
      <StatCard
        label="Late"
        value={formatNumber(c.lateToday)}
        hint={share(c.lateToday)}
        icon={<AlarmClock className="h-5 w-5" />}
        tone="amber"
        to="/attendance?view=board"
      />
      <StatCard
        label="Absent / not in"
        value={formatNumber(c.absentToday + c.notCheckedInToday)}
        hint={c.notCheckedInToday ? `${c.notCheckedInToday} not clocked in yet` : 'Everyone accounted for'}
        icon={<UserX className="h-5 w-5" />}
        tone="red"
        to="/attendance?view=board"
      />
      <StatCard
        label="On leave"
        value={formatNumber(c.onLeaveToday)}
        hint="Approved leave today"
        icon={<Plane className="h-5 w-5" />}
        tone="purple"
        to="/leave/calendar"
      />
    </CardGroup>
  );
};

/* ------------------------------ Live board ------------------------------ */

const COLUMN_META: Record<BoardColumnKey, { label: string; icon: ReactNode; bar: string; tile: string; text: string }> = {
  WORKING: { label: 'Working', icon: <Briefcase className="h-4 w-4" />, bar: 'bg-emerald-500', tile: 'bg-emerald-50 ring-emerald-100 dark:bg-emerald-500/10 dark:ring-emerald-500/20', text: 'text-emerald-700 dark:text-emerald-300' },
  ON_BREAK: { label: 'On break', icon: <Coffee className="h-4 w-4" />, bar: 'bg-amber-400', tile: 'bg-amber-50 ring-amber-100 dark:bg-amber-500/10 dark:ring-amber-500/20', text: 'text-amber-700 dark:text-amber-300' },
  DONE: { label: 'Clocked out', icon: <LogOut className="h-4 w-4" />, bar: 'bg-sky-500', tile: 'bg-sky-50 ring-sky-100 dark:bg-sky-500/10 dark:ring-sky-500/20', text: 'text-sky-700 dark:text-sky-300' },
  AWAY: { label: 'On leave / off', icon: <Plane className="h-4 w-4" />, bar: 'bg-violet-500', tile: 'bg-violet-50 ring-violet-100 dark:bg-violet-500/10 dark:ring-violet-500/20', text: 'text-violet-700 dark:text-violet-300' },
  NOT_IN: { label: 'Not in yet', icon: <UserX className="h-4 w-4" />, bar: 'bg-slate-300 dark:bg-slate-600', tile: 'bg-slate-50 ring-slate-200 dark:bg-slate-500/10 dark:ring-slate-500/20', text: 'text-slate-700 dark:text-slate-300' },
};
const COLUMN_ORDER: BoardColumnKey[] = ['WORKING', 'ON_BREAK', 'DONE', 'AWAY', 'NOT_IN'];

/** Who's where right now — a headline, a status bar, status tiles — plus the people still missing. */
const LiveBoardPreview = () => {
  const board = useAttendanceBoard({});
  const cards = board.data?.cards ?? [];
  const missing = cards.filter((c) => c.column === 'NOT_IN');
  const count = (k: BoardColumnKey) => cards.filter((c) => c.column === k).length;
  const total = cards.length;
  const inNow = count('WORKING') + count('ON_BREAK') + count('DONE');
  const expected = total - count('AWAY');
  return (
    <Widget
      title="Live board"
      description="Updates every 30 seconds"
      icon={<LayoutGrid className="h-4 w-4" />}
      accent="green"
      action={<ViewAllLink to="/attendance?view=board" label="Open board" />}
      loading={board.isLoading}
      error={board.error}
      onRetry={() => board.refetch()}
    >
      <div className="space-y-5 px-5 pt-1 pb-5">
        {/* Headline + one bar split by status. */}
        <div>
          <div className="flex items-end justify-between gap-3">
            <p className="text-fg">
              <span className="text-3xl font-bold tabular-nums">{inNow}</span>
              <span className="ml-1.5 text-sm text-muted">{`of ${expected} in today`}</span>
            </p>
            {expected > 0 && <span className="text-sm font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">{`${Math.round((inNow / expected) * 100)}%`}</span>}
          </div>
          <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={COLUMN_ORDER.map((k) => `${COLUMN_META[k].label} ${count(k)}`).join(', ')}>
            {total > 0 &&
              COLUMN_ORDER.map((k) =>
                count(k) ? <span key={k} className={cn('h-full transition-[width] duration-700', COLUMN_META[k].bar)} style={{ width: `${(count(k) / total) * 100}%` }} /> : null,
              )}
          </div>
        </div>

        {/* Status tiles. */}
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {COLUMN_ORDER.map((k, i) => (
            <li key={k} className="motion-safe:animate-pop-in" style={{ animationDelay: `${i * 60}ms` } as CSSProperties}>
              <Link to="/attendance?view=board" className={cn('flex h-full flex-col gap-1 rounded-xl p-3 ring-1 transition-shadow hover:shadow-card', COLUMN_META[k].tile)}>
                <span className={cn('flex items-center gap-1.5 text-xs font-medium', COLUMN_META[k].text)}>
                  {COLUMN_META[k].icon}
                  {COLUMN_META[k].label}
                </span>
                <span className="text-2xl font-bold text-fg tabular-nums">{count(k)}</span>
              </Link>
            </li>
          ))}
        </ul>

        {/* Still missing. */}
        <div className="rounded-xl border border-line">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold text-fg">
              Not clocked in yet
              <span className="ml-2 rounded-full bg-surface-3 px-2 py-0.5 text-xs font-semibold text-fg-2 tabular-nums">{missing.length}</span>
            </p>
            {missing.length > 8 && (
              <Link to="/attendance?view=board" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                See all on the board
              </Link>
            )}
          </div>
          {missing.length === 0 ? (
            <p className="px-4 py-4 text-sm text-emerald-700 dark:text-emerald-300">Everyone expected today is in 🎉</p>
          ) : (
            <ul className="grid gap-x-2 p-2 sm:grid-cols-2">
              {missing.slice(0, 8).map((c) => {
                const name = `${c.employee.firstName} ${c.employee.lastName}`.trim();
                const team = c.employee.department ?? c.employee.designation;
                return (
                  <li key={c.employee._id}>
                    <Link to={`/employees/${c.employee._id}?tab=attendance`} className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-surface-2">
                      <Avatar name={name} src={c.employee.profilePhoto} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{name}</span>
                      {c.absent ? (
                        <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">Absent</span>
                      ) : team ? (
                        <span className="max-w-[45%] shrink-0 truncate rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-fg-2">{team}</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Widget>
  );
};

/* ---------------------------- People movement --------------------------- */

const PersonLine = ({ p, verb }: { p: MovementPerson; verb: string }) => (
  <li className="flex items-center gap-2.5 py-1.5">
    <Avatar name={p.name} src={p.profilePhoto} size="sm" />
    <span className="min-w-0 flex-1">
      <Link to={`/employees/${p._id}`} className="block truncate text-sm font-medium text-fg hover:underline">
        {p.name}
      </Link>
      <span className="block truncate text-xs text-muted">{[p.designation, p.department].filter(Boolean).join(' · ')}</span>
    </span>
    {p.date && (
      <span className="shrink-0 text-xs text-muted">
        {verb} {formatKey(p.date, 'd MMM')}
      </span>
    )}
  </li>
);

const MiniCount = ({ icon, label, value, to }: { icon: ReactNode; label: string; value: number; to: string }) => (
  <Link to={to} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 ring-1 ring-line hover:bg-surface-3">
    <span className="text-muted">{icon}</span>
    <span className="text-sm text-fg-2">{label}</span>
    <span className="ml-auto text-base font-bold text-fg tabular-nums">{value}</span>
  </Link>
);

/** Joiners and leavers this month, plus onboarding / offboarding in progress. */
const PeopleMovement = ({ d }: { d: AdminDashboard }) => {
  const { joinersThisMonth: joiners, exitsThisMonth: exits, onboardingInProgress, offboardingInProgress } = d.insights;
  return (
    <Widget
      title="People this month"
      description={formatKey(`${d.date.slice(0, 7)}-01`, 'MMMM yyyy')}
      icon={<UserPlus className="h-4 w-4" />}
      accent="teal"
      action={<ViewAllLink to="/employees" />}
    >
      <div className="space-y-4 px-5 pb-5">
        <div className="grid grid-cols-2 gap-2">
          <MiniCount icon={<UserPlus className="h-4 w-4" />} label="Onboarding" value={onboardingInProgress} to="/onboarding" />
          <MiniCount icon={<LogOut className="h-4 w-4" />} label="Offboarding" value={offboardingInProgress} to="/offboarding" />
        </div>
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Joined ({joiners.length})</p>
          {joiners.length ? (
            <ul className="divide-y divide-line">
              {joiners.map((p) => (
                <PersonLine key={p._id} p={p} verb="Joined" />
              ))}
            </ul>
          ) : (
            <p className="py-2 text-sm text-muted">No new joiners this month.</p>
          )}
        </div>
        <div>
          <p className="flex items-center gap-1 text-xs font-semibold tracking-wide text-muted uppercase">
            <UserMinus className="h-3 w-3" aria-hidden /> Leaving ({exits.length})
          </p>
          {exits.length ? (
            <ul className="divide-y divide-line">
              {exits.map((p) => (
                <PersonLine key={p._id} p={p} verb="Last day" />
              ))}
            </ul>
          ) : (
            <p className="py-2 text-sm text-muted">No exits this month.</p>
          )}
        </div>
      </div>
    </Widget>
  );
};

/* -------------------------------- Section ------------------------------- */

/** HR dashboard: today's attendance, the live board, approvals, people movement and reminders. */
export const HrSection = () => {
  const dash = useAdminDashboard(true);
  const d = dash.data;
  if (dash.isLoading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading HR dashboard">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }
  if (dash.error || !d)
    return (
      <ErrorState className="card" title="Couldn't load the HR dashboard" message={dash.error?.message} onRetry={() => dash.refetch()} />
    );

  return (
    <div className="space-y-4">
      <AttendanceToday d={d} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <WidgetBoundary title="Live board">
            <LiveBoardPreview />
          </WidgetBoundary>
        </div>
        <WidgetBoundary title="Pending approvals">
          <PendingApprovals d={d} />
        </WidgetBoundary>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <WidgetBoundary title="Recent activity">
          <ActivityFeed scope="all" className="lg:col-span-2" />
        </WidgetBoundary>
        <WidgetBoundary title="People this month">
          <PeopleMovement d={d} />
        </WidgetBoundary>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <WidgetBoundary title="Birthdays">
          <PeopleDates
            title="Upcoming birthdays"
            icon={<Cake className="h-4 w-4" />}
            accent="amber"
            items={d.widgets.upcomingBirthdays}
            kind="birthday"
          />
        </WidgetBoundary>
        <WidgetBoundary title="Anniversaries">
          <PeopleDates
            title="Work anniversaries"
            icon={<Award className="h-4 w-4" />}
            accent="purple"
            items={d.widgets.workAnniversaries}
            kind="anniversary"
          />
        </WidgetBoundary>
        <WidgetBoundary title="Expiring documents">
          <ExpiringDocuments d={d} />
        </WidgetBoundary>
      </div>
    </div>
  );
};
