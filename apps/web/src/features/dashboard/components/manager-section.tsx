import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { CalendarClock, Check, ClipboardCheck, Receipt, Target, UserCheck, Users, X } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, ErrorState, ProgressBar, Skeleton, StatCard } from '@/components/ui/display';
import { useConfirm } from '@/components/ui/overlay';
import { ApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { cn, formatMoney, formatNumber } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useDashboardLeaveDecision, useManagerDashboard, type DaySummary, type ManagerDashboard, type ManagerPendingLeave } from '../api';
import { dashboardKind, formatCount, formatKey } from '../lib';
import { ViewAllLink, Widget, WidgetBoundary, WidgetEmpty } from './widget';

/* --------------------------- Team attendance --------------------------- */

const SEGMENTS: { key: keyof Pick<DaySummary, 'present' | 'onLeave' | 'absent' | 'notCheckedIn'>; label: string; color: string }[] = [
  { key: 'present', label: 'Present', color: 'bg-emerald-500' },
  { key: 'onLeave', label: 'On leave', color: 'bg-violet-500' },
  { key: 'absent', label: 'Absent', color: 'bg-red-500' },
  { key: 'notCheckedIn', label: 'Not checked in', color: 'bg-slate-400 dark:bg-slate-500' },
];

const TeamAttendance = ({ data }: { data: ManagerDashboard }) => {
  const a = data.attendanceToday;
  const total = a ? SEGMENTS.reduce((s, seg) => s + a[seg.key], 0) : 0;
  const summary = a ? SEGMENTS.map((s) => `${s.label} ${a[s.key]}`).join(', ') : '';
  return (
    <Widget
      title="Team attendance today"
      description={a && !a.isWorkingDay ? 'Not a working day' : `${data.teamSize} people`}
      icon={<UserCheck className="h-4 w-4" />}
      accent="green"
      action={<ViewAllLink to="/attendance" label="Details" />}
      empty={!a || total === 0}
      emptyState={<WidgetEmpty icon={<Users className="h-4 w-4" />} title="No attendance data for your team today" />}
    >
      {a && (
        <div className="space-y-4 px-5 pb-5">
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-surface-3"
            role="img"
            aria-label={`Team attendance today: ${summary}`}
          >
            {SEGMENTS.map((s) =>
              a[s.key] > 0 ? <div key={s.key} className={s.color} style={{ width: `${(a[s.key] / total) * 100}%` }} /> : null,
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {SEGMENTS.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-2 text-sm text-fg-2">
                  <span className={cn('h-2.5 w-2.5 rounded-full', s.color)} aria-hidden />
                  {s.label}
                </dt>
                <dd className="text-sm font-semibold text-fg tabular-nums">{a[s.key]}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2 border-t border-line pt-3 text-xs text-muted">
            <span>
              <span className="font-semibold text-fg">{a.late}</span> late
            </span>
            <span aria-hidden>·</span>
            <span>
              <span className="font-semibold text-fg">{a.workFromHome}</span> working remotely
            </span>
          </div>
        </div>
      )}
    </Widget>
  );
};

/* ---------------------------- Pending leave ---------------------------- */

const LeaveRow = ({ item, canApprove, canReject }: { item: ManagerPendingLeave; canApprove: boolean; canReject: boolean }) => {
  const decide = useDashboardLeaveDecision();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const range =
    item.startDate === item.endDate
      ? formatKey(item.startDate, 'dd MMM')
      : `${formatKey(item.startDate, 'dd MMM')} – ${formatKey(item.endDate, 'dd MMM')}`;
  const who = item.employee ?? 'Employee';
  const canAct = item.awaiting === 'MANAGER' || !item.awaiting;

  const run = async (action: 'approve' | 'reject') => {
    let reason: string | undefined;
    if (action === 'reject') {
      const res = await confirm({
        title: `Reject ${who}'s leave?`,
        message: `${item.leaveType?.name ?? 'Leave'} · ${range} (${formatCount(item.days)} day${item.days === 1 ? '' : 's'})`,
        confirmLabel: 'Reject',
        requireReason: true,
        reasonLabel: 'Reason for rejection',
      });
      if (!res.confirmed) return;
      reason = res.reason;
    }
    setBusy(action);
    try {
      await decide.mutateAsync({ id: item._id, action, reason });
      toast.success(action === 'approve' ? `Approved ${who}'s leave` : `Rejected ${who}'s leave`);
    } catch (err) {
      if (!(err instanceof ApiError)) toast.error('Could not update the request');
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
      <Link to={`/leave/requests/${item._id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-md hover:opacity-80">
        <Avatar name={who} size="sm" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-fg">{who}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.leaveType?.color ?? 'var(--subtle)' }} aria-hidden />
            <span className="truncate">
              {item.leaveType?.name ?? 'Leave'} · {range} · {formatCount(item.days)}d
            </span>
          </span>
        </span>
      </Link>
      <div className="flex items-center gap-2 pl-11 sm:pl-0">
        {canAct && (canApprove || canReject) ? (
          <>
            {canReject && (
              <Button
                variant="outline"
                size="xs"
                icon={<X className="h-3.5 w-3.5" />}
                loading={busy === 'reject'}
                disabled={!!busy}
                onClick={() => run('reject')}
                aria-label={`Reject ${who}'s leave`}
              >
                Reject
              </Button>
            )}
            {canApprove && (
              <Button
                variant="success"
                size="xs"
                icon={<Check className="h-3.5 w-3.5" />}
                loading={busy === 'approve'}
                disabled={!!busy}
                onClick={() => run('approve')}
                aria-label={`Approve ${who}'s leave`}
              >
                Approve
              </Button>
            )}
          </>
        ) : (
          <Badge tone="amber">Awaiting {label(item.awaiting)}</Badge>
        )}
      </div>
    </li>
  );
};

const PendingLeave = ({ data }: { data: ManagerDashboard }) => {
  const { can } = usePermissions();
  return (
    <Widget
      title="Pending leave requests"
      description={data.pendingLeave.count ? `${data.pendingLeave.count} awaiting a decision` : undefined}
      icon={<CalendarClock className="h-4 w-4" />}
      accent="purple"
      action={<ViewAllLink to="/leave?tab=approvals" />}
      empty={!data.pendingLeave.items.length}
      emptyState={
        <WidgetEmpty icon={<Check className="h-4 w-4" />} title="No pending leave requests" description="You're all caught up." />
      }
    >
      <ul className="divide-y divide-line pb-1">
        {data.pendingLeave.items.map((l) => (
          <LeaveRow key={l._id} item={l} canApprove={can('leave:approve')} canReject={can('leave:reject')} />
        ))}
      </ul>
    </Widget>
  );
};

/* ------------------------------ Team goals ----------------------------- */

const TeamGoals = ({ data }: { data: ManagerDashboard }) => {
  const g = data.goals;
  const statuses = g ? Object.entries(g.byStatus).sort((a, b) => b[1] - a[1]) : [];
  return (
    <Widget
      title="Team goals"
      icon={<Target className="h-4 w-4" />}
      accent="amber"
      action={<ViewAllLink to="/performance/goals" />}
      empty={!g || g.total === 0}
      emptyState={<WidgetEmpty icon={<Target className="h-4 w-4" />} title="No team goals yet" />}
    >
      {g && (
        <div className="space-y-4 px-5 pb-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-3xl font-semibold tracking-tight text-fg tabular-nums">{g.averageProgress}%</p>
              <p className="text-xs text-muted">Average progress across {g.total} goals</p>
            </div>
          </div>
          <ProgressBar value={g.averageProgress} tone={g.averageProgress >= 75 ? 'green' : 'brand'} />
          <div className="flex flex-wrap gap-1.5">
            {statuses.map(([status, count]) => (
              <span key={status} className="inline-flex items-center gap-1">
                <StatusBadge status={status} />
                <span className="text-xs font-semibold text-fg-2 tabular-nums">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Widget>
  );
};

/* ------------------------------- Reviews ------------------------------- */

const Reviews = ({ data }: { data: ManagerDashboard }) => (
  <Widget
    title="Reviews awaiting you"
    description={data.reviews.count ? `${data.reviews.count} pending` : undefined}
    icon={<ClipboardCheck className="h-4 w-4" />}
    accent="blue"
    action={<ViewAllLink to="/performance/reviews" />}
    empty={!data.reviews.items.length}
    emptyState={<WidgetEmpty icon={<ClipboardCheck className="h-4 w-4" />} title="No reviews waiting on you" />}
  >
    <ul className="divide-y divide-line px-2 pb-2">
      {data.reviews.items.map((r) => (
        <li key={r._id}>
          <Link to={`/performance/reviews/${r._id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2">
            <Avatar name={r.employee ?? 'Employee'} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-fg">{r.employee ?? 'Employee'}</span>
              <span className="block truncate text-xs text-muted">{r.cycle ?? 'Review cycle'}</span>
            </span>
            <StatusBadge status={r.status} />
          </Link>
        </li>
      ))}
    </ul>
  </Widget>
);

/* ---------------------------- Pending expenses ------------------------- */

const Expenses = ({ data }: { data: ManagerDashboard }) => {
  const totals = data.pendingExpenses.totals ?? [];
  return (
    <Widget
      title="Pending expenses"
      description={totals.length ? totals.map((t) => formatMoney(t.amount, t.currency)).join(' · ') : undefined}
      icon={<Receipt className="h-4 w-4" />}
      accent="teal"
      action={<ViewAllLink to="/expenses/approvals" />}
      empty={!data.pendingExpenses.items.length}
      emptyState={<WidgetEmpty icon={<Receipt className="h-4 w-4" />} title="No pending expense claims" />}
    >
      <ul className="divide-y divide-line px-2 pb-2">
        {data.pendingExpenses.items.map((x) => (
          <li key={x._id}>
            <Link to={`/expenses/${x._id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{x.employee ?? 'Employee'}</span>
                <span className="block truncate text-xs text-muted">
                  {x.expenseNumber} · {label(x.category)} · {formatKey(x.date, 'dd MMM')}
                </span>
              </span>
              <span className="text-right">
                <span className="block text-sm font-semibold text-fg tabular-nums">{formatMoney(x.amount, x.currency)}</span>
                {x.awaiting && <span className="block text-[11px] text-muted">Awaiting {label(x.awaiting)}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Widget>
  );
};

/* ------------------------------- Section ------------------------------- */

export const ManagerSection = () => {
  const dash = useManagerDashboard(true);
  const { user } = usePermissions();
  const d = dash.data;

  if (dash.isLoading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading team dashboard">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64" />
          <Skeleton className="h-64 lg:col-span-2" />
        </div>
      </div>
    );
  }
  if (dash.error || !d) {
    const forbidden = dash.error instanceof ApiError && dash.error.status === 403;
    return (
      <ErrorState
        className="card"
        title={forbidden ? 'Team dashboard unavailable' : "Couldn't load your team"}
        message={
          forbidden ? 'Your role does not include team visibility. Ask HR to grant the "View own team" permission.' : dash.error?.message
        }
        onRetry={forbidden ? undefined : () => dash.refetch()}
      />
    );
  }

  const a = d.attendanceToday;
  // New card names are for the super admin and HR dashboards; managers keep the originals.
  const isAdmin = ['head', 'hr'].includes(dashboardKind(user?.roles));
  const expenseTotals = (d.pendingExpenses.totals ?? []).map((t) => formatMoney(t.amount, t.currency)).join(' · ');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={isAdmin ? 'My Team' : 'Team size'}
          value={formatNumber(d.teamSize)}
          hint={`${d.directReports} direct report${d.directReports === 1 ? '' : 's'}`}
          icon={<Users className="h-5 w-5" />}
          tone="brand"
          to="/employees"
        />
        <StatCard
          label={isAdmin ? 'Present Today' : 'Present today'}
          value={a ? formatNumber(a.present) : '—'}
          hint={a ? `of ${d.teamSize} · ${a.late} late` : undefined}
          icon={<UserCheck className="h-5 w-5" />}
          tone="green"
          to="/attendance"
        />
        <StatCard
          {...(isAdmin
            ? {
                label: 'On Leave',
                value: a ? formatNumber(a.onLeave) : '—',
                hint: d.pendingLeave.count ? `${d.pendingLeave.count} request${d.pendingLeave.count === 1 ? '' : 's'} to review` : 'No requests pending',
              }
            : { label: 'Leave to review', value: formatNumber(d.pendingLeave.count), hint: 'Awaiting decision' })}
          icon={<CalendarClock className="h-5 w-5" />}
          tone="purple"
          to="/leave?tab=approvals"
        />
        <StatCard
          label={isAdmin ? 'Expenses to Review' : 'Expenses to review'}
          value={formatNumber(d.pendingExpenses.count)}
          hint={expenseTotals || 'Nothing pending'}
          icon={<Receipt className="h-5 w-5" />}
          tone="teal"
          to="/expenses/approvals"
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <WidgetBoundary title="Team attendance">
          <TeamAttendance data={d} />
        </WidgetBoundary>
        <div className="md:col-span-1 lg:col-span-2">
          <WidgetBoundary title="Pending leave">
            <PendingLeave data={d} />
          </WidgetBoundary>
        </div>
        <WidgetBoundary title="Team goals">
          <TeamGoals data={d} />
        </WidgetBoundary>
        <WidgetBoundary title="Reviews">
          <Reviews data={d} />
        </WidgetBoundary>
        <WidgetBoundary title="Expenses">
          <Expenses data={d} />
        </WidgetBoundary>
      </div>
    </div>
  );
};
