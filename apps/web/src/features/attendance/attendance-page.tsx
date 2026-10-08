import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, CalendarPlus, FilePenLine, LayoutGrid, PartyPopper, TableProperties, UserX } from 'lucide-react';
import { EmptyState, IconTitle, PageHeader } from '@/components/ui/display';
import { Tabs } from '@/components/ui/overlay';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { AttendanceBoardView } from './components/attendance-board';
import { AttendanceDashboardView } from './components/attendance-dashboard';
import { AttendanceRecords } from './components/attendance-records';
import { ClockWidget } from './components/clock-widget';
import { MyAttendanceDashboard } from './components/my-attendance-dashboard';
import { AdminAttendanceBreakdown, AdminAttendanceControls, AdminAttendanceKpis } from './components/admin-attendance-kpis';
import { AdminAttendanceInsights } from './components/admin-attendance-insights';
import { dashboardKind } from '@/features/dashboard/lib';
import { MonthlyAttendance } from './components/monthly-attendance';

export const AttendancePage = () => {
  const { can, isManager, hasEmployee, user } = usePermissions();
  const isEmployeeKind = dashboardKind(user?.roles) === 'employee';
  // HR gets exactly the super admin's attendance page (KPIs, overview, insights, Live Board, Records).
  const isAdmin = ['head', 'hr'].includes(dashboardKind(user?.roles));
  const isHr = dashboardKind(user?.roles) === 'hr';
  const [params, setParams] = useSearchParams();
  const canTeam = can('attendance:read') || isManager;
  const tabs = [
    { key: 'me', label: 'My attendance', hidden: !hasEmployee },
    { key: 'dashboard', label: 'Dashboard', hidden: !canTeam },
    // Employees get a team board too (their manager and teammates, status only).
    { key: 'board', label: 'Live board', hidden: !canTeam && !hasEmployee },
    { key: 'records', label: 'Records', hidden: !canTeam },
  ];
  const visible = tabs.filter((t) => !t.hidden);
  const requested = params.get('view');
  const active = visible.find((t) => t.key === requested)?.key ?? visible[0]?.key;

  const setView = (key: string) => setParams(key === visible[0]?.key ? {} : { view: key }, { replace: true });
  const patchParams = (patch: Record<string, string | undefined>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );

  // Employees and the super admin: "Attendance" or "Live Board", switched beside the title.
  const headingTabs = (isEmployeeKind && hasEmployee) || isAdmin;
  const employeeBoard = headingTabs && active === 'board';
  // Views that get their own heading tab (and the whole page): Live Board, plus Records for the super admin.
  const headingViews: string[] = isAdmin ? ['board', 'records'] : ['board'];
  const boardOnly = isAdmin && headingViews.includes(active ?? '');
  // Employees: "Attendance" and "Live Board" as two heading-style tabs (the one you're on is dark with an underline).
  const headingTab = (key: 'me' | 'board' | 'records', label: string, icon: React.ReactNode) => {
    const on = key === 'me' ? !headingViews.includes(active ?? '') : active === key;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={on}
        onClick={() => setView(key !== 'me' ? key : (visible.find((t) => !headingViews.includes(t.key))?.key ?? 'me'))}
        className={cn(
          'group relative pb-1.5 transition-colors',
          on ? 'text-fg' : 'text-muted hover:text-fg-2',
          "after:absolute after:inset-x-0 after:-bottom-0.5 after:h-[3px] after:rounded-full after:content-['']",
          on ? (isAdmin ? 'after:bg-violet-600' : 'after:bg-[#2563eb]') : 'after:bg-transparent',
        )}
      >
        <IconTitle icon={icon}>{label}</IconTitle>
      </button>
    );
  };

  return (
    <>
      <PageHeader
        title={
          headingTabs ? (
            <span role="tablist" aria-label="Attendance views" className="flex flex-wrap items-center gap-x-10 gap-y-2">
              {headingTab('me', 'Attendance', <CalendarClock />)}
              {headingTab('board', 'Live Board', <LayoutGrid />)}
              {isAdmin && headingTab('records', 'Records', <TableProperties />)}
            </span>
          ) : (
            <IconTitle icon={<CalendarClock />}>Attendance</IconTitle>
          )
        }
        description={
          isAdmin
            ? 'Monitor and manage attendance across your organization.'
            : hasEmployee
              ? 'Check in, track your hours and review your attendance.'
              : 'Attendance across your organization.'
        }
        actions={
          isEmployeeKind && hasEmployee ? (
            // Employees: the quick actions, up here instead of a card at the bottom.
            <nav aria-label="Quick actions" className="flex flex-wrap gap-2">
              {[
                { to: '/leave', label: 'Apply leave', icon: <CalendarPlus className="h-4 w-4" /> },
                { to: '/regularization', label: 'Request regularization', icon: <FilePenLine className="h-4 w-4" /> },
                { to: '/holidays', label: 'Holidays', icon: <PartyPopper className="h-4 w-4" /> },
              ].map((a) => (
                <Link
                  key={a.to}
                  to={a.to}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#eff6ff] pr-3.5 pl-1.5 text-sm font-medium text-fg ring-1 ring-[#ecdccb] hover:bg-[#dbeafe] dark:bg-[#1d4ed8]/15 dark:ring-[#1d4ed8]/30 dark:hover:bg-[#1d4ed8]/25"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#dbeafe] text-[#1d4ed8] dark:bg-[#1d4ed8]/25 dark:text-[#dbeafe]" aria-hidden>
                    {a.icon}
                  </span>
                  {a.label}
                </Link>
              ))}
            </nav>
          ) : isAdmin ? (
            // Super admin: pick the day, quick Today / Yesterday, and export the day's attendance.
            <AdminAttendanceControls date={params.get('date') ?? undefined} onDate={(date) => patchParams({ date })} />
          ) : hasEmployee ? (
            <Link
              to="/regularization"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium text-fg shadow-sm hover:bg-surface-2"
            >
              <FilePenLine className="h-4 w-4" aria-hidden />
              Regularization
            </Link>
          ) : undefined
        }
      />

      {!visible.length ? (
        <EmptyState
          className="card"
          icon={<UserX className="h-6 w-6" />}
          title="No employee profile linked"
          description="Your account is not linked to an employee record, so there is no attendance to show. Contact HR if this is unexpected."
        />
      ) : (
        <div className="space-y-6">
          {/* HR (unlike the super admin) still clocks in: their clock card heads the Attendance view. */}
          {isHr && hasEmployee && !boardOnly && <ClockWidget />}
          {/* Super admin / HR: the day's headline numbers across the organization. */}
          {isAdmin && !boardOnly && <AdminAttendanceKpis date={params.get('date') ?? undefined} />}
          {isAdmin && !boardOnly && <AdminAttendanceBreakdown date={params.get('date') ?? undefined} />}
          {isAdmin && !boardOnly && <AdminAttendanceInsights date={params.get('date') ?? undefined} onDate={(date) => patchParams({ date })} />}
          {/* Employees: the full attendance dashboard (stats, today, timeline, verification). Others: the clock card. */}
          {/* Super admin clocks in from the dashboard's Today card, so no clock card here. */}
          {hasEmployee && (isEmployeeKind ? !employeeBoard && <MyAttendanceDashboard /> : !isAdmin && <ClockWidget />)}
          {/* Lower tabs: HR only (employees and the super admin use the heading tabs; the admin has no My attendance / Dashboard). */}
          {!isEmployeeKind && !isAdmin && visible.length > 1 && <Tabs tabs={tabs} active={active!} onChange={setView} />}
          {(!isAdmin || boardOnly) && (
            <div
              role={!isEmployeeKind && visible.length > 1 ? 'tabpanel' : undefined}
              aria-labelledby={!isEmployeeKind && visible.length > 1 ? `tab-${active}` : undefined}
            >
              {/* Employees: their dashboard covers it, so no "My attendance" month view. */}
              {active === 'me' && !isEmployeeKind && <MonthlyAttendance allowCorrections />}
              {active === 'dashboard' && (
                <AttendanceDashboardView
                  date={params.get('date') ?? undefined}
                  scope={params.get('scope') ?? undefined}
                  onChange={patchParams}
                />
              )}
              {active === 'board' && <AttendanceBoardView scope={params.get('scope') ?? undefined} onChange={patchParams} />}
              {active === 'records' && <AttendanceRecords />}
            </div>
          )}
        </div>
      )}
    </>
  );
};
