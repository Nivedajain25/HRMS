import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlarmClock,
  Briefcase,
  CalendarDays,
  CircleCheck,
  ClipboardList,
  FileWarning,
  Hourglass,
  Plane,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  Wallet,
} from 'lucide-react';
import { Avatar, Badge, StatCard } from '@/components/ui/display';
import { label } from '@/lib/i18n';
import { cn, formatMoney, formatMoneyCompact, formatNumber, timeAgo } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import type { AdminDashboard, PendingApprovalItem, PersonDate } from '../api';
import { formatKey, inDaysLabel, monthName } from '../lib';
import { dateKeyIn, useOrgTimezone } from '@/features/attendance/lib';
import { ViewAllLink, Widget, WidgetEmpty } from './widget';

/*
 * Shared building blocks for the role dashboards (HR overview, Company overview):
 * stat card groups, birthdays / anniversaries, expiring documents, approvals and activity.
 */

/* ------------------------------ Stat cards ----------------------------- */

export const CardGroup = ({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) => (
  <section aria-label={title} className="space-y-2">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      {description && <p className="text-xs text-muted">{description}</p>}
    </div>
    <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3', className)}>{children}</div>
  </section>
);

/** Employees → attendance today → everything else. */
export const StatCards = ({ d }: { d: AdminDashboard }) => {
  const c = d.cards;
  const pa = c.pendingApprovals;
  const share = (n: number, of: number, what: string) => (of ? `${Math.round((n / of) * 100)}% of ${what}` : undefined);
  const breakdown = [
    pa.leave && `${pa.leave} leave`,
    pa.expense && `${pa.expense} expense`,
    pa.regularization && `${pa.regularization} attendance`,
  ]
    .filter(Boolean)
    .join(' · ');
  // Everyone active who is not on leave is expected to clock in today.
  const expected = Math.max(0, c.activeEmployees - c.onLeaveToday);
  // Marked absent + not clocked in yet: nobody has seen them today.
  const absentNow = c.absentToday + c.notCheckedInToday;
  const absentHint =
    [c.absentToday && `${c.absentToday} marked absent`, c.notCheckedInToday && `${c.notCheckedInToday} not clocked in yet`]
      .filter(Boolean)
      .join(' · ') || 'Everyone accounted for';

  const more = [
    <StatCard
      key="new"
      label="New (30 days)"
      value={formatNumber(c.newEmployees)}
      hint="Joined in the last 30 days"
      icon={<UserPlus className="h-5 w-5" />}
      tone="teal"
    />,
    <StatCard
      key="pending"
      label="Pending approvals"
      value={formatNumber(pa.total)}
      hint={breakdown || 'Nothing pending'}
      icon={<Hourglass className="h-5 w-5" />}
      tone="amber"
    />,
    ...(c.payroll
      ? [
          <StatCard
            key="payroll"
            label={`Payroll · ${monthName(c.payroll.month, c.payroll.year, 'MMM yyyy')}`}
            value={formatMoneyCompact(c.payroll.totalNet, c.payroll.currency)}
            hint={`Net ${formatMoney(c.payroll.totalNet, c.payroll.currency)} · ${c.payroll.employeeCount} employees · ${label(c.payroll.status)}`}
            icon={<Wallet className="h-5 w-5" />}
            tone="blue"
            to="/payroll"
          />,
        ]
      : []),
    <StatCard
      key="jobs"
      label="Open jobs"
      value={formatNumber(c.openJobs)}
      hint="Accepting candidates"
      icon={<Briefcase className="h-5 w-5" />}
      tone="gray"
      to="/recruitment/jobs"
    />,
  ];

  return (
    <div className="space-y-5">
      <CardGroup title="Employees">
        <StatCard
          label="Total employees"
          value={formatNumber(c.totalEmployees)}
          hint="All employee records"
          icon={<Users className="h-5 w-5" />}
          tone="brand"
          to="/employees"
        />
        <StatCard
          label="Active employees"
          value={formatNumber(c.activeEmployees)}
          hint={share(c.activeEmployees, c.totalEmployees, 'total')}
          icon={<UserCheck className="h-5 w-5" />}
          tone="green"
          to="/employees"
        />
        <StatCard
          label="On leave today"
          value={formatNumber(c.onLeaveToday)}
          hint={share(c.onLeaveToday, c.activeEmployees, 'active')}
          icon={<Plane className="h-5 w-5" />}
          tone="purple"
          to="/leave/calendar"
        />
      </CardGroup>

      <CardGroup title="Attendance today" description={`Out of ${formatNumber(expected)} expected (active, not on leave)`}>
        <StatCard
          label="On time"
          value={formatNumber(c.onTimeToday)}
          hint={share(c.onTimeToday, expected, 'expected')}
          icon={<CircleCheck className="h-5 w-5" />}
          tone="green"
          to="/attendance?view=board"
        />
        <StatCard
          label="Late"
          value={formatNumber(c.lateToday)}
          hint={share(c.lateToday, expected, 'expected')}
          icon={<AlarmClock className="h-5 w-5" />}
          tone="amber"
          to="/attendance?view=board"
        />
        <StatCard
          label="Absent"
          value={formatNumber(absentNow)}
          hint={absentHint}
          icon={<UserX className="h-5 w-5" />}
          tone="red"
          to="/attendance?view=board"
        />
      </CardGroup>

      <CardGroup title="More" className={more.length % 4 === 0 ? 'xl:grid-cols-4' : undefined}>
        {more}
      </CardGroup>
    </div>
  );
};

/* ------------------------------ People dates --------------------------- */

export const PeopleDates = ({
  title,
  icon,
  accent,
  items,
  kind,
}: {
  title: string;
  icon: ReactNode;
  accent: 'amber' | 'purple';
  items: PersonDate[];
  kind: 'birthday' | 'anniversary';
}) => {
  const { can, isManager } = usePermissions();
  const linkable = can('employee:read') || isManager;
  return (
    <Widget
      title={title}
      description="Next 30 days"
      icon={icon}
      accent={accent}
      empty={!items.length}
      emptyState={
        <WidgetEmpty
          icon={icon}
          title={kind === 'birthday' ? 'No birthdays in the next 30 days' : 'No work anniversaries in the next 30 days'}
        />
      }
    >
      <ul className="scrollbar-thin max-h-80 divide-y divide-line overflow-y-auto px-2 pb-2">
        {items.map((p) => {
          const body = (
            <>
              <Avatar name={p.name} src={p.profilePhoto} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{p.name}</span>
                <span className="block truncate text-xs text-muted">
                  {kind === 'anniversary' && p.years ? `${p.years} year${p.years === 1 ? '' : 's'}` : (p.department ?? p.employeeId)}
                  {kind === 'anniversary' && p.department ? ` · ${p.department}` : ''}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className={cn('block text-xs font-medium', p.inDays === 0 ? 'text-brand-600 dark:text-brand-400' : 'text-fg-2')}>
                  {p.inDays === 0 ? 'Today' : formatKey(p.nextDate, 'dd MMM')}
                </span>
                {p.inDays > 0 && <span className="block text-[11px] text-muted">{inDaysLabel(p.inDays)}</span>}
              </span>
            </>
          );
          return (
            <li key={`${p._id}-${p.nextDate}`}>
              {linkable ? (
                <Link to={`/employees/${p._id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-3 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Widget>
  );
};

/* ---------------------------- Expiring documents ----------------------- */

export const ExpiringDocuments = ({ d }: { d: AdminDashboard }) => {
  const docs = d.widgets.expiringDocuments;
  const daysUntil = (key: string | null) =>
    key ? Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${d.date}T00:00:00Z`)) / 86_400_000) : null;
  return (
    <Widget
      title="Expiring documents"
      description="Next 30 days"
      icon={<FileWarning className="h-4 w-4" />}
      accent="red"
      action={<ViewAllLink to="/documents" />}
      empty={!docs.length}
      emptyState={<WidgetEmpty icon={<FileWarning className="h-4 w-4" />} title="No documents expiring soon" />}
    >
      <ul className="scrollbar-thin max-h-80 divide-y divide-line overflow-y-auto px-2 pb-2">
        {docs.map((doc) => {
          const days = daysUntil(doc.expiryDate);
          return (
            <li key={doc._id}>
              <Link to="/documents" className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{doc.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {doc.employee ?? 'Organization'} · {label(doc.category)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-xs font-medium text-fg-2">{doc.expiryDate ? formatKey(doc.expiryDate, 'dd MMM') : '—'}</span>
                  {days !== null && <Badge tone={days <= 7 ? 'red' : 'amber'}>{inDaysLabel(days)}</Badge>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Widget>
  );
};

/* ---------------------------- Pending approvals ------------------------ */

const APPROVAL_META: Record<PendingApprovalItem['type'], { label: string; tone: 'purple' | 'teal' | 'blue' }> = {
  leave: { label: 'Leave', tone: 'purple' },
  expense: { label: 'Expense', tone: 'teal' },
  regularization: { label: 'Attendance', tone: 'blue' },
};

/** "Today" / date button (same as the Todo card's), opening the browser's date picker. */
const DayPicker = ({ date, today, onChange }: { date: string; today: string; onChange: (d: string) => void }) => {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => input.current?.showPicker?.()}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-fg shadow-sm hover:bg-surface-2"
      >
        <CalendarDays className="h-4 w-4" aria-hidden />
        {date === today ? 'Today' : formatKey(date, 'dd MMM')}
      </button>
      <input
        ref={input}
        type="date"
        value={date}
        max={today}
        onChange={(e) => onChange(e.target.value || today)}
        aria-label="Choose a day"
        className="pointer-events-none absolute right-0 bottom-0 h-0 w-0 opacity-0"
        tabIndex={-1}
      />
    </span>
  );
};

export const PendingApprovals = ({ d, className, titleBox, compact = false }: { d: AdminDashboard; className?: string; titleBox?: string; /** Smaller card: short list, one-line empty state, and a "Today" day filter. */ compact?: boolean }) => {
  const timeZone = useOrgTimezone();
  const today = dateKeyIn(timeZone);
  const [date, setDate] = useState(today);
  const [showAll, setShowAll] = useState(false);
  const all = d.widgets.pendingApprovals;
  // Compact card: requests submitted on the chosen day (default today), or all of them.
  const dayOf = (iso?: string | null) => (iso ? dateKeyIn(timeZone, new Date(iso)) : '');
  const items = compact && !showAll ? all.filter((a) => dayOf(a.submittedAt) === date) : all;
  const others = all.length - items.length;
  const dayLabel = date === today ? 'today' : `on ${formatKey(date, 'dd MMM')}`;
  return (
    <Widget
      className={className}
      titleBox={titleBox}
      title="Awaiting your approval"
      description={compact ? undefined : items.length ? `${items.length} most recent` : undefined}
      icon={<ClipboardList className="h-4 w-4" />}
      accent="amber"
      action={
        compact ? (
          <DayPicker
            date={date}
            today={today}
            onChange={(v) => {
              setDate(v);
              setShowAll(false);
            }}
          />
        ) : undefined
      }
      empty={!items.length}
      emptyState={
        compact ? (
          <div className="flex flex-col items-center justify-center gap-1 px-5 py-4 text-center text-sm text-muted">
            <p className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" aria-hidden />
              {`Nothing submitted ${dayLabel}`}
            </p>
            {others > 0 && (
              <button type="button" onClick={() => setShowAll(true)} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                {`${others} more waiting from other days — show all`}
              </button>
            )}
          </div>
        ) : (
          <WidgetEmpty
            icon={<ClipboardList className="h-4 w-4" />}
            title="Nothing awaiting you"
            description="Requests routed to you will show up here."
          />
        )
      }
    >
      <ul className={cn('scrollbar-thin divide-y divide-line overflow-y-auto px-2 pb-2', compact ? 'max-h-44' : 'max-h-[340px]')}>
        {items.map((a) => {
          const meta = APPROVAL_META[a.type];
          return (
            <li key={`${a.type}-${a.id}`}>
              <Link to={a.url} className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2">
                <Badge tone={meta.tone} className="mt-0.5">
                  {meta.label}
                </Badge>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{a.employee ?? 'Employee'}</span>
                  <span className="line-clamp-2 block text-xs text-muted">{a.summary}</span>
                </span>
                <span className="shrink-0 text-[11px] text-subtle">{a.submittedAt ? timeAgo(a.submittedAt) : ''}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Widget>
  );
};

/* ----------------------------- Recent activity ------------------------- */

export const RecentActivity = ({ d, className }: { d: AdminDashboard; className?: string }) => (
  <Widget title="Recent activity" description="Audit trail" icon={<Activity className="h-4 w-4" />} accent="gray" className={className}>
    <ol className="relative mx-5 mb-5 space-y-4 border-l border-line pl-5">
      {d.widgets.recentActivities.map((a) => (
        <li key={a._id} className="relative">
          <span className="absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full border-2 border-surface bg-brand-500" aria-hidden />
          <p className="text-sm text-fg">
            <span className="font-medium">{a.userName ?? 'System'}</span> <span className="text-fg-2">{label(a.action).toLowerCase()}</span>
            {a.recordLabel && <span className="font-medium"> {a.recordLabel}</span>}
          </p>
          <p className="text-xs text-muted">
            {label(a.module)} · <time dateTime={a.timestamp}>{timeAgo(a.timestamp)}</time>
          </p>
        </li>
      ))}
    </ol>
  </Widget>
);
