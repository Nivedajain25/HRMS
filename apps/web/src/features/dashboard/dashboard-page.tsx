import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs } from '@/components/ui/overlay';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { AdminRail } from './components/admin-rail';
import { EmployeeRail, EmployeeSection } from './components/employee-section';
import { GreetingHero } from './components/greeting-hero';
import { ActivityCell, HeadSection, SalesRow, ScheduleRow } from './components/head-section';
import { HrSection } from './components/hr-section';
import { KpiStrip } from './components/kpi-strip';
import { ManagerSection } from './components/manager-section';
import { EMPLOYEE_TILES, PlainTitlesContext, TitleBoxContext } from './components/widget';

const NO_PLAIN_TITLES: ReadonlySet<string> = new Set();
import { dashboardKind } from './lib';

type View = 'overview' | 'hr' | 'me' | 'team';
const STORAGE_KEY = 'dashboard:view';

const readStored = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

export const DashboardPage = () => {
  const { user, isManager, canAny, hasEmployee } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();

  const kind = dashboardKind(user?.roles);
  // HR gets exactly the super admin's dashboard (plus its own "HR overview" tab).
  const isAdmin = kind === 'head' || kind === 'hr';

  // The first tab opens by default: super admin and HR start on the company overview.
  const myDay = { key: 'me' as const, label: 'My day', hidden: kind !== 'employee' && !hasEmployee };
  const views: { key: View; label: string; hidden: boolean }[] = [
    { key: 'overview', label: 'Company overview', hidden: !isAdmin },
    myDay,
    { key: 'hr', label: 'HR overview', hidden: kind !== 'hr' },
    // Mirrors the API: the team dashboard requires `team:view` (direct reports alone aren't enough).
    // Employees (managers) open their team from the banner's "My team" action (/team) instead of a tab.
    { key: 'team', label: 'My team', hidden: kind === 'employee' || !isManager || !canAny('team:view') },
  ];
  const visible = views.filter((v) => !v.hidden);
  const requested = searchParams.get('view') ?? readStored();
  const active: View = visible.find((v) => v.key === requested)?.key ?? visible[0]?.key ?? 'me';

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, active);
    } catch {
      /* storage unavailable (private mode) */
    }
  }, [active]);

  const changeView = (key: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('view', key);
        return next;
      },
      { replace: true },
    );

  const main = (
    <div className="min-w-0 space-y-5">
      {/* Admin / employee: no separate title or breadcrumb — the greeting hero (with the name) heads the page. */}
      <GreetingHero />
      {/* Company stat cards (Total employees, Present, On leave, Absent, Remote, New joiners): super admin and HR. */}
      {isAdmin && <KpiStrip />}

      {visible.length > 1 && <Tabs tabs={visible} active={active} onChange={changeView} />}

      <div role={visible.length > 1 ? 'tabpanel' : undefined} aria-labelledby={visible.length > 1 ? `tab-${active}` : undefined}>
        {active === 'overview' && <HeadSection />}
        {active === 'hr' && <HrSection />}
        {active === 'me' && <EmployeeSection />}
        {active === 'team' && <ManagerSection />}
      </div>

    </div>
  );

  // Admin Company overview: the right-hand column runs down beside the main content and the Schedules |
  // Announcements row, with Todo stretching to the bottom of that row (no gap); then Sales | Tasks | Recent activity.
  if (isAdmin && active === 'overview') {
    return (
      // Rows size to the main column's content (Schedules | Announcements keep their natural height). The right-hand
      // column doesn't set the row heights (h-0 + min-h-full): it fills the same height and scrolls if it's longer.
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 xl:col-start-1 xl:row-start-1">{main}</div>
        <div className="scrollbar-thin flex flex-col gap-4 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:h-0 xl:min-h-full xl:overflow-y-auto [&>*]:shrink-0">
          {/* Cards keep their own height (no squashing); Todo still grows into any spare space. */}
          {/* Todo now sits under "Awaiting your approval" in the main column. */}
          <AdminRail withRows />
        </div>
        <div className="min-w-0 xl:col-start-1 xl:row-start-2">
          <ScheduleRow />
        </div>
        <div className="min-w-0 xl:col-start-1 xl:row-start-3">
          {/* HR: Todo in place of Sales overview (beside Tasks). */}
          <SalesRow todoInsteadOfSales={kind === 'hr'} />
        </div>
        <div className="min-w-0 xl:col-start-2 xl:row-start-3">
          <ActivityCell />
        </div>
      </div>
    );
  }

  // Employee: plain black titles, colour only on a soft-blue tile behind each emoji. Super admin / HR: the cards'
  // own admin styles.
  const titleBox = kind === 'employee' ? EMPLOYEE_TILES : false;

  // Everyone else (and the admin's other tabs): main column (title included) + a right-hand column from the
  // very top — the admin's shortcuts and alerts, or for everyone else the Quick Actions list.
  return (
    <TitleBoxContext.Provider value={titleBox}>
      <PlainTitlesContext.Provider value={NO_PLAIN_TITLES}>
      {/* Employees: both columns stretch to the same height so they end on one line (the rail's last card grows). */}
      <div className={cn('grid gap-5', isAdmin ? 'items-start xl:grid-cols-[minmax(0,1fr)_20rem]' : 'xl:grid-cols-[minmax(0,1fr)_15rem]')}>
        <div className="min-w-0 space-y-5">
          {main}
        </div>
        {isAdmin ? <AdminRail /> : <EmployeeRail />}
      </div>
      </PlainTitlesContext.Provider>
    </TitleBoxContext.Provider>
  );
};
