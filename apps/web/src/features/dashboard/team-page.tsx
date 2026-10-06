import type { CSSProperties } from 'react';
import { Mail, Users } from 'lucide-react';
import { Avatar, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/display';
import { usePermissions } from '@/store/auth';
import { useTeammates, type Teammate } from '@/features/employees/api';
import { ManagerSection } from './components/manager-section';

const PersonCard = ({ p, tag, index }: { p: Teammate; tag?: string; index: number }) => {
  const name = `${p.firstName} ${p.lastName}`.trim();
  return (
    <li className="motion-safe:animate-pop-in" style={{ animationDelay: `${Math.min(index, 12) * 40}ms` } as CSSProperties}>
      <Card className="flex h-full items-center gap-3 p-4">
        <Avatar name={name} src={p.profilePhoto} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate font-semibold text-fg">
            <span className="truncate">{name}</span>
            {tag && <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-brand-700 uppercase dark:bg-brand-500/15 dark:text-brand-300">{tag}</span>}
          </p>
          <p className="truncate text-sm text-muted">{[p.designationId?.name, p.departmentId?.name].filter(Boolean).join(' · ') || p.employeeId}</p>
          {p.workEmail && (
            <a href={`mailto:${p.workEmail}`} className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-brand-700 hover:underline dark:text-brand-300">
              <Mail className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{p.workEmail}</span>
            </a>
          )}
        </div>
      </Card>
    </li>
  );
};

/** For employees without reports: their manager and the colleagues who share that manager. */
const Teammates = () => {
  const q = useTeammates();
  if (q.isLoading)
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading your team">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  if (q.error || !q.data) return <ErrorState className="card" title="Couldn't load your team" message={q.error?.message} onRetry={() => q.refetch()} />;
  const { manager, teammates } = q.data;
  if (!manager && !teammates.length)
    return <EmptyState className="card" icon={<Users className="h-5 w-5" />} title="No team yet" description="Once HR assigns your reporting manager, your team will show up here." />;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {manager && <PersonCard p={manager} tag="Manager" index={0} />}
      {teammates.map((p, i) => (
        <PersonCard key={p._id} p={p} index={i + 1} />
      ))}
    </ul>
  );
};

/** "My team": the team dashboard for people with reports; everyone else sees their manager and teammates. */
export const TeamPage = () => {
  const { isManager, canAny } = usePermissions();
  // Mirrors the API: the team dashboard requires `team:view` (direct reports alone aren't enough).
  const leadsTeam = isManager && canAny('team:view');
  return (
    <div>
      <PageHeader
        title="My team"
        description={leadsTeam ? 'Attendance, approvals and goals for the people who report to you.' : 'Your manager and the colleagues you work with.'}
      />
      {leadsTeam ? <ManagerSection /> : <Teammates />}
    </div>
  );
};
