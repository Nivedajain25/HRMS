import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, ClipboardCheck } from 'lucide-react';
import { ProgressBar, Skeleton } from '@/components/ui/display';
import { getPaged } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useMyEmployee } from '@/features/employees/api';
import { onboardingKeys, type Onboarding } from '../api';
import { isPastDue } from './lifecycle-ui';

/**
 * Dashboard card for the signed-in employee's in-progress onboarding. Renders
 * nothing when there is no active checklist.
 */
const MyOnboardingCard = () => {
  const { user, can, isManager } = usePermissions();
  const employeeId = user?.employeeId ?? null;
  // Plain employees are scoped to themselves by the API; wider scopes narrow by their own employee code.
  const wideScope = can('onboarding:manage') || isManager;
  const me = useMyEmployee();
  const code = wideScope ? me.data?.employeeId : undefined;
  const query = wideScope ? { search: code, limit: 10 } : { limit: 1 };

  const mine = useQuery({
    queryKey: onboardingKeys.mine(query),
    queryFn: async () => (await getPaged<Onboarding>('/onboarding', query)).data.find((o) => o.employeeId?._id === employeeId) ?? null,
    enabled: !!employeeId && (!wideScope || !!code),
  });

  if (!employeeId) return null;
  if (mine.isLoading || (wideScope && me.isLoading)) {
    return (
      <div className="card p-5" role="status" aria-label="Loading onboarding">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-3 h-2 w-full" />
      </div>
    );
  }
  const o = mine.data;
  if (!o || o.status === 'COMPLETED') return null;

  const myOpen = o.tasks.filter((t) => t.assignee === 'EMPLOYEE' && t.status !== 'COMPLETED');
  const overdue = myOpen.filter((t) => isPastDue(t.dueDate)).length;
  const next = [...myOpen].filter((t) => t.dueDate).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0];

  return (
    <Link
      to={`/onboarding/${o._id}`}
      className="card group block p-5 transition-shadow hover:shadow-pop focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
            <ClipboardCheck className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-fg">My onboarding</p>
            <p className="truncate text-xs text-muted">{o.templateId?.name ?? 'Checklist'} · started {formatDate(o.startDate)}</p>
          </div>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
      </div>
      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-xs">
          <span className="font-medium text-fg">{o.progress}% complete</span>
          <span className="text-muted">
            {myOpen.length ? `${myOpen.length} task${myOpen.length === 1 ? '' : 's'} for you` : 'Nothing pending from you'}
          </span>
        </div>
        <ProgressBar value={o.progress} />
      </div>
      {(overdue > 0 || next) && (
        <p className={overdue ? 'mt-3 flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400' : 'mt-3 text-xs text-muted'}>
          {overdue > 0 && <AlertCircle className="h-3.5 w-3.5" aria-hidden />}
          {overdue > 0 ? `${overdue} overdue task${overdue === 1 ? '' : 's'}` : next ? `Next: ${next.title} · due ${formatDate(next.dueDate)}` : null}
        </p>
      )}
    </Link>
  );
};

export default MyOnboardingCard;
