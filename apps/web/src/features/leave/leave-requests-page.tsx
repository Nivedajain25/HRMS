import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CalendarDays, CalendarPlus, ChevronDown, RotateCcw, SlidersHorizontal, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/ui/display';
import { Select } from '@/components/ui/input';
import { Dropdown, Tabs } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { usePermissions } from '@/store/auth';
import { useLeaves, type LeaveRequest, type LeaveScope } from './api';
import { ApplyLeaveDrawer } from './components/apply-leave-drawer';
import { BalanceCards } from './components/balance-cards';
import { AdjustBalanceModal, CarryForwardModal } from './components/hr-tools';
import { LeaveDetailDrawer } from './components/leave-detail-drawer';
import { LeaveTable } from './components/leave-table';

const PAGE_KEYS = ['tab', 'id'];

const TAB_COPY: Record<LeaveScope, { title: string; description: string }> = {
  me: { title: 'No leave requests yet', description: 'Requests you apply for or save as drafts appear here.' },
  team: { title: 'No team leave', description: 'Leave requested by your direct and indirect reports appears here.' },
  approvals: { title: 'You are all caught up', description: 'Leave requests awaiting your decision appear here.' },
  all: { title: 'No leave requests', description: 'Leave requests across the organization appear here.' },
};

export const LeaveRequestsPage = () => {
  const { can, isManager, hasEmployee, user } = usePermissions();
  const navigate = useNavigate();
  const { id: routeId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const list = useListParams({ sortBy: 'startDate', sortOrder: 'desc' });

  const canApprove = can('leave:approve');
  const canReadAll = can('leave:read');
  const canApplyOthers = can('leave:create');
  const hrTools = can('leave:update');

  const tabs: { key: LeaveScope; label: string; hidden: boolean }[] = [
    { key: 'me', label: 'My requests', hidden: !hasEmployee },
    { key: 'team', label: 'Team', hidden: !isManager },
    { key: 'approvals', label: 'Approvals', hidden: !canApprove },
    { key: 'all', label: 'All requests', hidden: !canReadAll },
  ];
  const visible = tabs.filter((t) => !t.hidden);
  const requested = searchParams.get('tab') as LeaveScope | null;
  const tab: LeaveScope | undefined = visible.find((t) => t.key === requested)?.key ?? visible[0]?.key;

  const approvalsCount = useLeaves({ scope: 'approvals', page: 1, limit: 1 }, canApprove);

  const [year, setYear] = useState(new Date().getFullYear());
  const [applying, setApplying] = useState<{ typeId?: string; draft?: LeaveRequest } | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [carrying, setCarrying] = useState(false);

  const detailId = routeId ?? searchParams.get('id');
  const openDetail = (l: LeaveRequest) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('id', l._id);
        return next;
      },
      { replace: false },
    );
  const closeDetail = () => {
    if (routeId) {
      navigate('/leave', { replace: true });
      return;
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('id');
        return next;
      },
      { replace: true },
    );
  };
  const changeTab = (key: string) => setSearchParams({ tab: key }, { replace: true });

  const thisYear = new Date().getFullYear();
  const canApply = hasEmployee || canApplyOthers;

  return (
    <>
      <PageHeader
        title="Leave"
        description="Plan time off, track requests and act on approvals."
        actions={
          <>
            {hrTools && (
              <Dropdown
                label="HR tools"
                trigger={
                  <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium text-fg shadow-sm hover:bg-surface-2">
                    <Wrench className="h-4 w-4" aria-hidden />
                    HR tools
                    <ChevronDown className="h-3.5 w-3.5 text-muted" aria-hidden />
                  </span>
                }
                items={[
                  { label: 'Adjust a balance', icon: <SlidersHorizontal className="h-4 w-4" />, onSelect: () => setAdjusting(true) },
                  { label: 'Run carry forward', icon: <RotateCcw className="h-4 w-4" />, onSelect: () => setCarrying(true) },
                ]}
              />
            )}
            <Button variant="outline" icon={<CalendarDays className="h-4 w-4" />} onClick={() => navigate('/leave/calendar')}>
              Calendar
            </Button>
            {canApply && (
              <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setApplying({})}>
                Apply leave
              </Button>
            )}
          </>
        }
      />

      {hasEmployee && (
        <section aria-labelledby="leave-balances-heading" className="mb-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="leave-balances-heading" className="text-sm font-semibold text-fg">
              My balances
            </h2>
            <Select
              aria-label="Balance year"
              className="h-8 w-24"
              value={String(year)}
              onChange={(e) => setYear(Number(e.target.value))}
              options={[thisYear - 1, thisYear, thisYear + 1].map((y) => ({ value: String(y), label: String(y) }))}
            />
          </div>
          <BalanceCards year={year} onApply={(typeId) => setApplying({ typeId })} />
        </section>
      )}

      {tab ? (
        <section aria-label="Leave requests" className="space-y-4">
          <Tabs
            tabs={visible.map((t) => ({
              key: t.key,
              label: t.label,
              count: t.key === 'approvals' && approvalsCount.data ? approvalsCount.data.pagination.total : undefined,
            }))}
            active={tab}
            onChange={changeTab}
          />
          <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
            <LeaveTable
              key={tab}
              scope={tab}
              list={list}
              ignoreKeys={PAGE_KEYS}
              storageKey={`leave-${tab}`}
              onOpen={openDetail}
              onEdit={(draft) => setApplying({ draft })}
              filters={
                tab === 'approvals'
                  ? { type: true }
                  : tab === 'me'
                    ? { type: true, status: true, dates: true }
                    : { employee: true, type: true, status: true, dates: true }
              }
              emptyTitle={TAB_COPY[tab].title}
              emptyDescription={TAB_COPY[tab].description}
              emptyAction={
                tab === 'me' ? (
                  <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setApplying({})}>
                    Apply leave
                  </Button>
                ) : undefined
              }
            />
          </div>
        </section>
      ) : (
        <EmptyState
          className="card"
          icon={<CalendarDays className="h-6 w-6" />}
          title="No leave requests to show"
          description="Your account is not linked to an employee profile. Ask an administrator to link it to apply for leave."
        />
      )}

      {/* Mobile quick action (with room so it never covers the pagination). */}
      {canApply && <div className="h-16 sm:hidden" aria-hidden />}
      {canApply && !applying && !detailId && (
        <Button
          className="fixed right-4 bottom-4 z-30 h-12 rounded-full px-5 shadow-pop sm:hidden"
          icon={<CalendarPlus className="h-5 w-5" />}
          onClick={() => setApplying({})}
        >
          Apply
        </Button>
      )}

      <ApplyLeaveDrawer
        open={!!applying}
        draft={applying?.draft}
        initialTypeId={applying?.typeId}
        onClose={(saved) => {
          setApplying(null);
          // Show the new request where the applicant expects it.
          if (saved && tab !== 'me' && user?.employeeId && saved.employeeId?._id === user.employeeId) changeTab('me');
        }}
      />
      <LeaveDetailDrawer
        id={detailId}
        onClose={closeDetail}
        onEdit={(draft) => {
          closeDetail();
          setApplying({ draft });
        }}
      />
      {hrTools && (
        <>
          <AdjustBalanceModal open={adjusting} onClose={() => setAdjusting(false)} />
          <CarryForwardModal open={carrying} onClose={() => setCarrying(false)} />
        </>
      )}
    </>
  );
};
