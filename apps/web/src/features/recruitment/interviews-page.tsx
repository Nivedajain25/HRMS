import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { CalendarClock, CalendarPlus, CheckCircle2, LayoutList, ListTree, MessageSquarePlus, MoreHorizontal, Pencil, UserX, Video, XCircle } from 'lucide-react';
import { INTERVIEW_STATUS } from '@stencil/shared';
import { FilterBar } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { DataTable, Pagination } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/display';
import { DateRangePicker, Select, Switch } from '@/components/ui/input';
import { Dropdown, type DropdownItem } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { label } from '@/lib/i18n';
import { cn, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useInterviews, type Interview } from './api';
import {
  durationLabel,
  FeedbackModal,
  InterviewDetailDrawer,
  InterviewFormModal,
  interviewCandidate,
  interviewJob,
  useInterviewAbilities,
  useInterviewActions,
} from './components/interviews';
import { formatInTz, interviewWhen, RatingStars, todayInTz } from './components/shared';

type When = 'upcoming' | 'past' | 'all';

const InterviewerStack = ({ people }: { people: Interview['interviewerIds'] }) => (
  <span className="flex items-center" title={people.map(fullName).join(', ')}>
    <span className="flex -space-x-2">
      {people.slice(0, 3).map((p) => (
        <Avatar key={p._id} name={fullName(p)} src={p.profilePhoto} size="xs" className="ring-2 ring-surface" />
      ))}
    </span>
    <span className="ml-2 max-w-40 truncate text-xs text-fg-2">
      {people.length === 1 ? fullName(people[0]) : `${people.length} interviewers`}
    </span>
  </span>
);

/** Per-row actions (hooks live here so each row knows what the viewer may do). */
const InterviewRowActions = ({ interview }: { interview: Interview }) => {
  const { canManage, canFeedback, scheduled } = useInterviewAbilities(interview);
  const actions = useInterviewActions();
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const items: DropdownItem[] = [
    { label: 'Give feedback', icon: <MessageSquarePlus className="h-4 w-4" />, hidden: !canFeedback, onSelect: () => setFeedback(true) },
    { label: 'Reschedule', icon: <Pencil className="h-4 w-4" />, hidden: !canManage || !scheduled, onSelect: () => setEditing(true) },
    { label: 'Mark completed', icon: <CheckCircle2 className="h-4 w-4" />, hidden: !canManage || !scheduled, onSelect: () => void actions.complete(interview) },
    { label: 'Mark no-show', icon: <UserX className="h-4 w-4" />, hidden: !canManage || !scheduled, onSelect: () => void actions.noShow(interview) },
    { label: 'Cancel interview', icon: <XCircle className="h-4 w-4" />, danger: true, hidden: !canManage || !scheduled, onSelect: () => void actions.cancel(interview) },
  ];
  return (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="flex justify-end">
      <Dropdown
        label="Interview actions"
        items={items}
        trigger={
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-fg">
            <MoreHorizontal className="h-4 w-4" />
          </span>
        }
      />
      <InterviewFormModal open={editing} onClose={() => setEditing(false)} interview={interview} />
      <FeedbackModal open={feedback} onClose={() => setFeedback(false)} interview={interview} />
    </div>
  );
};

/** Interviews grouped by day in the organization timezone. */
const Agenda = ({ rows, tz, onOpen }: { rows: Interview[]; tz: string; onOpen: (i: Interview) => void }) => {
  const groups = useMemo(() => {
    const map = new Map<string, Interview[]>();
    for (const i of rows) {
      const key = formatInTz(i.scheduledAt, tz, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      map.set(key, [...(map.get(key) ?? []), i]);
    }
    return [...map.entries()];
  }, [rows, tz]);
  return (
    <div className="divide-y divide-line">
      {groups.map(([day, items]) => (
        <section key={day} aria-label={day} className="px-4 py-4">
          <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">{day}</h3>
          <ul className="space-y-2">
            {items.map((i) => {
              const c = interviewCandidate(i);
              const job = interviewJob(i);
              const when = interviewWhen(i.scheduledAt, tz);
              return (
                <li key={i._id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(i)}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        onOpen(i);
                      }
                    }}
                    className={cn(
                      'flex cursor-pointer flex-col gap-3 rounded-lg border border-line p-3 transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none sm:flex-row sm:items-center',
                      i.status === 'CANCELLED' && 'opacity-60',
                    )}
                  >
                    <div className="w-24 shrink-0">
                      <p className="text-sm font-semibold text-fg tabular-nums">{when.time}</p>
                      <p className="text-xs text-muted">{durationLabel(i.durationMinutes)}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{c ? fullName(c) : 'Candidate'}</p>
                      <p className="truncate text-xs text-muted">
                        {job ? job.title : '—'} · Round {i.round} · {label(i.type)}
                      </p>
                    </div>
                    <InterviewerStack people={i.interviewerIds} />
                    <div className="flex items-center gap-2">
                      <StatusBadge status={i.status} />
                      {i.meetingLink && i.status === 'SCHEDULED' && (
                        <a
                          href={i.meetingLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-brand-600 px-2 text-xs font-medium text-white hover:bg-brand-700"
                        >
                          <Video className="h-3.5 w-3.5" aria-hidden /> Join
                        </a>
                      )}
                      <InterviewRowActions interview={i} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
};

export const InterviewsPage = () => {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { params, set, clear, hasFilters } = useListParams({ sortBy: 'scheduledAt' });
  const { can, user } = usePermissions();
  const tz = user?.organization.timezone ?? 'UTC';
  const [scheduling, setScheduling] = useState(false);
  const canManage = can('recruitment:update');

  const when = (['upcoming', 'past', 'all'].includes(String(params.when)) ? params.when : 'upcoming') as When;
  const view = params.view === 'agenda' ? 'agenda' : 'list';
  const customRange = !!(params.from || params.to);
  const explicitSort = hasFilters(['sortOrder']);

  const apiQuery = useMemo(() => {
    const today = todayInTz(tz);
    const q: Record<string, string | number | undefined> = {
      page: params.page,
      limit: params.limit,
      status: params.status as string | undefined,
      interviewerId: params.mine === '1' ? 'me' : undefined,
      sortBy: params.sortBy ?? 'scheduledAt',
      sortOrder: explicitSort ? params.sortOrder : when === 'past' ? 'desc' : 'asc',
    };
    if (customRange) {
      q.from = params.from as string | undefined;
      q.to = params.to as string | undefined;
    } else if (when === 'upcoming') q.from = today;
    else if (when === 'past') q.to = today;
    return Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ''));
  }, [params, tz, when, customRange, explicitSort]);

  const list = useInterviews(apiQuery);
  const rows = list.data?.data;
  const openInterview = (i: Interview) => navigate({ pathname: `/recruitment/interviews/${i._id}`, search: location.search });
  const closeInterview = () => navigate({ pathname: '/recruitment/interviews', search: location.search }, { replace: true });
  const filterKeys = ['status', 'mine', 'from', 'to'];

  const columns = useMemo<ColumnDef<Interview, unknown>[]>(
    () => [
      {
        id: 'scheduledAt',
        header: 'When',
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => {
          const w = interviewWhen(row.original.scheduledAt, tz);
          return (
            <div>
              <p className="font-medium text-fg">{w.day}</p>
              <p className="text-xs text-muted">
                {w.time} · {durationLabel(row.original.durationMinutes)}
              </p>
            </div>
          );
        },
      },
      {
        id: 'candidate',
        header: 'Candidate',
        enableHiding: false,
        cell: ({ row }) => {
          const c = interviewCandidate(row.original);
          return c ? (
            <div className="min-w-0">
              <p className="font-medium text-fg">{fullName(c)}</p>
              <p className="text-xs text-muted">{label(c.stage)}</p>
            </div>
          ) : (
            '—'
          );
        },
      },
      { id: 'job', header: 'Job', cell: ({ row }) => interviewJob(row.original)?.title ?? '—' },
      {
        id: 'round',
        header: 'Round',
        enableSorting: true,
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5">
            <Badge tone="gray">R{row.original.round}</Badge>
            {label(row.original.type)}
          </span>
        ),
      },
      { id: 'interviewers', header: 'Interviewers', cell: ({ row }) => <InterviewerStack people={row.original.interviewerIds} /> },
      { id: 'status', header: 'Status', enableSorting: true, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      {
        id: 'rating',
        header: 'Avg rating',
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <RatingStars value={row.original.rating} />
            {row.original.feedback.length > 0 && <span className="text-xs text-muted">({row.original.feedback.length})</span>}
          </span>
        ),
      },
      { id: 'actions', header: () => <span className="sr-only">Actions</span>, enableHiding: false, cell: ({ row }) => <InterviewRowActions interview={row.original} /> },
    ],
    [tz],
  );

  const toolbar = (
    <FilterBar active={hasFilters(filterKeys)} onClear={() => clear(['view', 'when'])}>
      <div role="group" aria-label="Time period" className="inline-flex rounded-lg border border-line-strong p-0.5">
        {(['upcoming', 'past', 'all'] as When[]).map((w) => (
          <button
            key={w}
            type="button"
            aria-pressed={!customRange && when === w}
            onClick={() => set({ when: w === 'upcoming' ? undefined : w, from: undefined, to: undefined, sortOrder: undefined })}
            className={cn(
              'rounded-md px-3 py-1 text-sm font-medium transition-colors',
              !customRange && when === w ? 'bg-brand-600 text-white' : 'text-fg-2 hover:bg-surface-3',
            )}
          >
            {label(w)}
          </button>
        ))}
      </div>
      <DateRangePicker from={params.from as string | undefined} to={params.to as string | undefined} onChange={(r) => set({ from: r.from, to: r.to })} />
      <Select
        aria-label="Status"
        className="w-full sm:w-36"
        value={String(params.status ?? '')}
        onChange={(e) => set({ status: e.target.value })}
        options={INTERVIEW_STATUS.map((s) => ({ value: s, label: label(s) }))}
        placeholder="All statuses"
      />
      {user?.employeeId && (
        <label className="flex items-center gap-2 text-sm text-fg-2">
          <Switch checked={params.mine === '1'} onChange={(v) => set({ mine: v ? '1' : undefined })} label="Only interviews I'm on" />
          <span aria-hidden>Mine</span>
        </label>
      )}
      <div role="group" aria-label="View" className="ml-auto inline-flex rounded-lg border border-line-strong p-0.5">
        {[
          { key: 'list', icon: LayoutList, text: 'List' },
          { key: 'agenda', icon: ListTree, text: 'Agenda' },
        ].map((v) => (
          <button
            key={v.key}
            type="button"
            aria-pressed={view === v.key}
            onClick={() => set({ view: v.key === 'list' ? undefined : v.key, page: params.page })}
            className={cn('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium', view === v.key ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg')}
          >
            <v.icon className="h-4 w-4" aria-hidden /> {v.text}
          </button>
        ))}
      </div>
    </FilterBar>
  );

  const emptyTitle = when === 'upcoming' && !customRange ? 'No upcoming interviews' : 'No interviews found';
  const emptyDescription = hasFilters(filterKeys) ? 'Try changing your filters.' : canManage ? 'Schedule an interview from here or from a candidate profile.' : 'Interviews you are part of will appear here.';
  const emptyAction = canManage ? (
    <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setScheduling(true)}>
      Schedule interview
    </Button>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Interviews"
        description={`Times shown in ${tz}`}
        actions={
          canManage && (
            <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setScheduling(true)} className="w-full sm:w-auto">
              Schedule interview
            </Button>
          )
        }
      />
      {view === 'list' ? (
        <DataTable
          caption="Interviews"
          storageKey="recruitment-interviews"
          columns={columns}
          data={rows}
          loading={list.isLoading || list.isFetching}
          error={list.error}
          onRetry={() => list.refetch()}
          pagination={list.data?.pagination}
          onPageChange={(page) => set({ page })}
          onLimitChange={(limit) => set({ limit })}
          sorting={{ sortBy: String(apiQuery.sortBy), sortOrder: apiQuery.sortOrder === 'desc' ? 'desc' : 'asc' }}
          onSortingChange={(s) => set({ sortBy: s.sortBy, sortOrder: s.sortOrder })}
          onRowClick={openInterview}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          emptyAction={emptyAction}
          toolbar={toolbar}
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">{toolbar}</div>
          {list.error ? (
            <ErrorState message={list.error.message} onRetry={() => list.refetch()} />
          ) : list.isLoading ? (
            <div className="space-y-3 p-4" role="status" aria-label="Loading interviews">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : !rows?.length ? (
            <EmptyState icon={<CalendarClock className="h-6 w-6" />} title={emptyTitle} description={emptyDescription} action={emptyAction} />
          ) : (
            <>
              <Agenda rows={rows} tz={tz} onOpen={openInterview} />
              {list.data && <Pagination pagination={list.data.pagination} onPageChange={(page) => set({ page })} onLimitChange={(limit) => set({ limit })} loading={list.isFetching} />}
            </>
          )}
        </div>
      )}
      <InterviewDetailDrawer interviewId={id ?? null} onClose={closeInterview} />
      <InterviewFormModal open={scheduling} onClose={() => setScheduling(false)} />
    </>
  );
};
