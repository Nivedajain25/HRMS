import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarClock, DoorOpen, LogOut } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card, ErrorState, IconTitle, PageHeader, Skeleton } from '@/components/ui/display';
import { useMyEmployee } from '@/features/employees/api';
import { formatDate } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useMyActiveOffboarding } from './api';
import { daysUntil } from './components/lifecycle-ui';
import { OffboardingFormDrawer } from './components/offboarding-form';
import { OffboardingStepper } from './components/offboarding-stepper';

/**
 * My account → Resignation: submit your own resignation, or follow the one in progress (status, last working day,
 * steps). Withdrawing and the full timeline live on the offboarding page it links to.
 */
export const ResignationPage = () => {
  const { hasEmployee } = usePermissions();
  const mine = useMyActiveOffboarding(hasEmployee);
  const me = useMyEmployee();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const active = mine.data;
  const noticeDays = me.data?.noticePeriodDays;
  const left = active ? daysUntil(active.lastWorkingDate) : null;

  return (
    <>
      <PageHeader
        title={<IconTitle icon={<LogOut />}>Resignation</IconTitle>}
        description="Submit your resignation or follow its progress."
        breadcrumb={[{ label: 'My Account', to: '/account' }, { label: 'Resignation' }]}
      />

      <div className="grid max-w-3xl gap-4">
        {mine.isLoading ? (
          <Skeleton className="h-48" />
        ) : mine.error ? (
          <ErrorState className="card" message={mine.error.message} onRetry={() => mine.refetch()} />
        ) : active ? (
          <Card className="space-y-5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300" aria-hidden>
                  <DoorOpen className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-fg">Your resignation is in progress</h2>
                  <p className="mt-0.5 text-sm text-fg-2">Submitted {formatDate(active.requestDate)}. HR will guide you through the remaining steps.</p>
                </div>
              </div>
              <StatusBadge status={active.status} />
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
              <CalendarClock className="h-5 w-5 shrink-0 text-muted" aria-hidden />
              <p className="text-sm text-fg">
                Last working day <strong>{formatDate(active.lastWorkingDate)}</strong>
                {left !== null && left >= 0 ? <span className="text-muted">{` · ${left === 0 ? 'today' : `in ${left} day${left === 1 ? '' : 's'}`}`}</span> : null}
              </p>
            </div>

            <OffboardingStepper status={active.status} timeline={active.timeline} />

            <div>
              <Button variant="outline" icon={<ArrowRight className="h-4 w-4" />} onClick={() => navigate(`/offboarding/${active._id}`)}>
                View details or withdraw
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="space-y-4 p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300" aria-hidden>
                <LogOut className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-fg">Submit your resignation</h2>
                <p className="mt-0.5 text-sm text-fg-2">
                  HR and your reporting manager are notified as soon as you submit. You can withdraw it while it is still in the early steps.
                </p>
                {noticeDays !== undefined ? (
                  <p className="mt-2 text-sm text-fg-2">
                    Your notice period is <strong>{noticeDays} day{noticeDays === 1 ? '' : 's'}</strong>.
                  </p>
                ) : null}
              </div>
            </div>
            <Button variant="danger" icon={<LogOut className="h-4 w-4" />} onClick={() => setOpen(true)}>
              Submit resignation
            </Button>
          </Card>
        )}
      </div>

      {/* After submitting, the page refreshes into the "in progress" view. */}
      <OffboardingFormDrawer open={open} mode="resign" onClose={() => setOpen(false)} />
    </>
  );
};
