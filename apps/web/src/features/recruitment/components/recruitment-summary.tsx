import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Briefcase, CalendarClock, Timer, Users } from 'lucide-react';
import { Card, CardBody, CardHeader, ErrorState, Skeleton, StatCard } from '@/components/ui/display';
import { label } from '@/lib/i18n';
import { cn, formatNumber } from '@/lib/utils';
import { useRecruitmentSummary } from '../api';
import { STAGES, stageColor } from './shared';

/** KPI strip + pipeline funnel + source breakdown (requires `recruitment:read`). */
export const RecruitmentSummaryStrip = () => {
  const summary = useRecruitmentSummary(true);
  const s = summary.data;

  if (summary.error) {
    return <ErrorState className="card mb-6" title="Could not load the recruitment summary" message={summary.error.message} onRetry={() => summary.refetch()} />;
  }

  const activeInPipeline = s ? STAGES.filter((st) => st !== 'HIRED' && st !== 'REJECTED').reduce((n, st) => n + (s.candidatesByStage[st] ?? 0), 0) : 0;
  const maxStage = s ? Math.max(1, ...STAGES.map((st) => s.candidatesByStage[st] ?? 0)) : 1;
  const sources = (s?.sourceBreakdown ?? []).map((row) => ({ name: label(row.source), count: row.count }));

  return (
    <div className="mb-6 space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open jobs" value={formatNumber(s?.openJobs)} loading={summary.isLoading} icon={<Briefcase className="h-5 w-5" />} hint={s ? `${s.openPositions} open position${s.openPositions === 1 ? '' : 's'}` : undefined} />
        <StatCard
          label="Candidates"
          tone="purple"
          value={formatNumber(s?.totalCandidates)}
          loading={summary.isLoading}
          icon={<Users className="h-5 w-5" />}
          hint={s ? `${activeInPipeline} active in pipeline` : undefined}
          to="/recruitment/candidates"
        />
        <StatCard label="Interviews this week" tone="blue" value={formatNumber(s?.interviewsThisWeek)} loading={summary.isLoading} icon={<CalendarClock className="h-5 w-5" />} to="/recruitment/interviews" />
        <StatCard
          label="Avg time to hire"
          tone="green"
          value={s?.timeToHireAvgDays === null || s?.timeToHireAvgDays === undefined ? '—' : `${formatNumber(s.timeToHireAvgDays, 1)} days`}
          loading={summary.isLoading}
          icon={<Timer className="h-5 w-5" />}
          hint={s ? `${s.hires} hire${s.hires === 1 ? '' : 's'} to date` : undefined}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Candidates by stage" description="Across all jobs" />
          <CardBody>
            {summary.isLoading || !s ? (
              <Skeleton className="h-48" />
            ) : (
              <ul className="space-y-2">
                {STAGES.map((stage) => {
                  const count = s.candidatesByStage[stage] ?? 0;
                  return (
                    <li key={stage} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3 text-sm">
                      <span className="truncate text-fg-2">{label(stage)}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                        <span className={cn('block h-full rounded-full', stageColor(stage))} style={{ width: `${(count / maxStage) * 100}%` }} />
                      </span>
                      <span className="text-right font-medium text-fg tabular-nums">{count}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Candidate sources" description="Where applicants come from" />
          <CardBody>
            {summary.isLoading || !s ? (
              <Skeleton className="h-48" />
            ) : sources.length === 0 ? (
              <p className="flex h-48 items-center justify-center text-sm text-muted">No candidates yet.</p>
            ) : (
              <div className="h-56" role="img" aria-label={`Candidate sources: ${sources.map((r) => `${r.name} ${r.count}`).join(', ')}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sources} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid horizontal={false} stroke="var(--line)" />
                    <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={96} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={{ fill: 'var(--surface-3)' }}
                      contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--fg)', fontSize: 12 }}
                      labelStyle={{ color: 'var(--fg)' }}
                      itemStyle={{ color: 'var(--fg-2)' }}
                      formatter={(value) => [value, 'Candidates']}
                    />
                    <Bar dataKey="count" fill="var(--color-brand-500)" radius={[0, 4, 4, 0]} maxBarSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
};
