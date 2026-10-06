import { CalendarPlus, Home, ShieldAlert, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui/display';
import { cn } from '@/lib/utils';
import { DEFAULT_TYPE_COLOR, formatNum, isForbidden, useLeaveBalances, type LeaveBalance } from '../api';

const Stat = ({ label, value }: { label: string; value: number }) => (
  <div className="min-w-0">
    <dt className="truncate text-[11px] font-medium tracking-wide text-muted uppercase">{label}</dt>
    <dd className="mt-0.5 text-sm font-semibold text-fg tabular-nums">{formatNum(value)}</dd>
  </div>
);

export const BalanceCard = ({ balance: b, onApply }: { balance: LeaveBalance; onApply?: (leaveTypeId: string) => void }) => {
  const color = b.leaveType.color ?? DEFAULT_TYPE_COLOR;
  const unpaid = b.leaveType.paid === false;
  const entitlement = Math.max(0, b.opening + b.allocated + b.carryForward + b.adjusted - b.encashed);
  const usedPct = entitlement > 0 ? Math.min(100, (b.used / entitlement) * 100) : 0;
  const pendingPct = entitlement > 0 ? Math.min(100 - usedPct, (b.pending / entitlement) * 100) : 0;
  const low = !unpaid && (b.remaining < 0 || (b.remaining === 0 && entitlement > 0));

  return (
    <article className="card relative flex h-full min-w-[78%] snap-start flex-col overflow-hidden p-4 sm:min-w-0" aria-label={`${b.leaveType.name} balance`}>
      <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color }} aria-hidden />
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-fg">{b.leaveType.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] text-muted">{b.leaveType.code}</span>
            {unpaid && <Badge tone="gray">Unpaid</Badge>}
            {b.leaveType.isWorkFromHome && (
              <Badge tone="blue">
                <Home className="h-3 w-3" aria-hidden />
                WFH
              </Badge>
            )}
          </div>
        </div>
        {onApply && (
          <Button variant="ghost" size="xs" icon={<CalendarPlus className="h-3.5 w-3.5" />} onClick={() => onApply(b.leaveType._id)} aria-label={`Apply for ${b.leaveType.name}`}>
            Apply
          </Button>
        )}
      </header>

      <div className="mt-4 flex items-baseline gap-1.5">
        <span className={cn('text-3xl font-semibold tracking-tight tabular-nums', low ? 'text-red-600 dark:text-red-400' : 'text-fg')}>
          {formatNum(unpaid ? b.used : b.remaining)}
        </span>
        <span className="text-sm text-muted">{unpaid ? 'days taken' : 'days left'}</span>
      </div>

      {!unpaid && (
        <div
          className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
          role="img"
          aria-label={`${formatNum(b.used)} used and ${formatNum(b.pending)} pending of ${formatNum(entitlement)} days`}
        >
          <span className="h-full" style={{ width: `${usedPct}%`, backgroundColor: color }} />
          <span className="h-full opacity-40" style={{ width: `${pendingPct}%`, backgroundColor: color }} />
        </div>
      )}

      <dl className="mt-4 grid grid-cols-4 gap-2 border-t border-line pt-3">
        <Stat label="Allotted" value={b.allocated + b.opening + b.adjusted} />
        <Stat label="Used" value={b.used} />
        <Stat label="Pending" value={b.pending} />
        <Stat label="Carried" value={b.carryForward} />
      </dl>
    </article>
  );
};

/** Balance cards for the signed-in employee (or another employee when permitted). */
export const BalanceCards = ({ employeeId, year, onApply }: { employeeId?: string; year: number; onApply?: (leaveTypeId: string) => void }) => {
  const balances = useLeaveBalances({ employeeId, year });

  if (balances.isLoading) {
    return (
      <div className="flex gap-4 overflow-hidden sm:grid sm:grid-cols-2 xl:grid-cols-4" role="status" aria-label="Loading balances">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-44 min-w-[78%] sm:min-w-0" />
        ))}
      </div>
    );
  }
  if (balances.error) {
    if (isForbidden(balances.error)) {
      return <EmptyState className="card" icon={<ShieldAlert className="h-6 w-6" />} title="Balances not available" description="You do not have access to this employee's leave balances." />;
    }
    return <ErrorState className="card" message={balances.error.message} onRetry={() => balances.refetch()} />;
  }
  if (!balances.data?.length) {
    return <EmptyState className="card" icon={<Wallet className="h-6 w-6" />} title="No leave balances" description={`No leave types apply for ${year}. Ask HR to configure leave policies.`} />;
  }
  return (
    <div className="scrollbar-thin flex snap-x gap-4 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 xl:grid-cols-4">
      {balances.data.map((b) => (
        <BalanceCard key={b._id} balance={b} onApply={onApply} />
      ))}
    </div>
  );
};
