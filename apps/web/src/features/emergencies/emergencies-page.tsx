import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Siren } from 'lucide-react';
import { Avatar, Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/display';
import { Tabs } from '@/components/ui/overlay';
import { formatDate, timeAgo } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { CATEGORY_META, useEmergencies, type EmergencyStatus } from './api';
import { personName } from './components/emergency-alerts';

export const STATUS_BADGE: Record<EmergencyStatus, { tone: 'red' | 'amber' | 'green'; label: string }> = {
  OPEN: { tone: 'red', label: 'Waiting for HR' },
  ACKNOWLEDGED: { tone: 'amber', label: 'Seen by HR' },
  RESOLVED: { tone: 'green', label: 'Closed' },
};

/** HR: every emergency, newest first (open ones on top). Employees: their own alerts. */
export const EmergenciesPage = () => {
  const { can } = usePermissions();
  const isHr = can('emergency:manage');
  const [status, setStatus] = useState<string>('');
  const q = useEmergencies({ status: status || undefined, page: 1, limit: 50 });
  const rows = q.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Emergencies"
        description={
          isHr
            ? 'Personal emergencies raised by employees (e.g. having to rush home). New ones pop up on every HR screen.'
            : 'Emergencies you have informed HR about. Use the red Emergency button at the top to raise one.'
        }
      />
      <div className="mb-4">
        <Tabs
          tabs={[
            { key: '', label: 'All' },
            { key: 'OPEN', label: 'Waiting' },
            { key: 'ACKNOWLEDGED', label: 'Seen' },
            { key: 'RESOLVED', label: 'Closed' },
          ]}
          active={status}
          onChange={setStatus}
        />
      </div>
      {q.isLoading ? (
        <div className="space-y-3" role="status" aria-label="Loading emergencies">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : q.error ? (
        <ErrorState className="card" message={q.error.message} onRetry={() => q.refetch()} />
      ) : !rows.length ? (
        <EmptyState className="card" icon={<Siren className="h-5 w-5" />} title="No emergencies" description={status ? 'Nothing with this status.' : 'Nothing has been raised. Stay safe!'} />
      ) : (
        <ul className="space-y-3">
          {rows.map((e) => {
            const CategoryIcon = CATEGORY_META[e.category].icon;
            return (
              <li key={e._id}>
                <Link to={`/emergencies/${e._id}`} className="block">
                  <Card className="flex items-center gap-3 p-4 transition-shadow hover:shadow-pop">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300" aria-hidden>
                      <CategoryIcon className="h-5 w-5" />
                    </span>
                    {isHr && <Avatar name={personName(e)} src={e.employeeId?.profilePhoto} size="md" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-fg">
                        {CATEGORY_META[e.category].title}
                        {isHr ? ` · ${personName(e)}` : ''}
                      </p>
                      <p className="truncate text-sm text-muted">
                        {e.needToLeave ? 'Needed to leave · ' : ''}
                        {e.message || 'No details given'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge tone={STATUS_BADGE[e.status].tone} dot>
                        {STATUS_BADGE[e.status].label}
                      </Badge>
                      <p className="mt-1 text-xs text-muted" title={formatDate(e.createdAt, 'dd MMM yyyy, HH:mm')}>
                        {timeAgo(e.createdAt)}
                      </p>
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
