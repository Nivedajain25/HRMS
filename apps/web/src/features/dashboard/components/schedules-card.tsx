import { Link } from 'react-router-dom';
import { CalendarDays, CalendarPlus, Clock3 } from 'lucide-react';
import { Avatar, Card } from '@/components/ui/display';
import { dateKeyIn, formatKey, formatTimeIn, useOrgTimezone } from '@/features/attendance/lib';
import { useInterviews, type Interview } from '@/features/recruitment/api';
import { clock12, cn } from '@/lib/utils';
import { TitleIcon } from './widget';

/** Dark tag colours for the job badge; a job always gets the same one. */
const TAGS = ['bg-teal-800', 'bg-slate-800', 'bg-indigo-700', 'bg-rose-700', 'bg-amber-700', 'bg-emerald-700', 'bg-sky-700', 'bg-fuchsia-700'];
const tagFor = (s: string) => TAGS[[...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 3) % TAGS.length];

interface Group {
  key: string;
  job: string;
  jobId: string | null;
  day: string;
  start: number;
  end: number;
  people: { id: string; name: string }[];
}

const candidateName = (i: Interview) =>
  i.candidateId && typeof i.candidateId === 'object' ? `${i.candidateId.firstName} ${i.candidateId.lastName}`.trim() : 'Candidate';

/** Upcoming interviews grouped by job and day: "Interview Candidates – <job>", date, time span and who's coming. */
export const SchedulesCard = ({ className }: { className?: string }) => {
  const timeZone = useOrgTimezone();
  const today = dateKeyIn(timeZone);
  const q = useInterviews({ status: 'SCHEDULED', from: today, page: 1, limit: 50, sortBy: 'scheduledAt', sortOrder: 'asc' });
  const t12 = (ms: number) => clock12(formatTimeIn(new Date(ms), timeZone));

  const groups = new Map<string, Group>();
  for (const i of q.data?.data ?? []) {
    const start = new Date(i.scheduledAt).getTime();
    if (start < Date.now() - 60 * 60_000) continue;
    const day = dateKeyIn(timeZone, new Date(start));
    const job = i.jobId && typeof i.jobId === 'object' ? i.jobId : null;
    const key = `${job?._id ?? 'none'}-${day}`;
    const g = groups.get(key) ?? { key, job: job?.title ?? 'Interview', jobId: job?._id ?? null, day, start, end: start, people: [] };
    g.start = Math.min(g.start, start);
    g.end = Math.max(g.end, start + (i.durationMinutes || 60) * 60_000);
    g.people.push({ id: i._id, name: candidateName(i) });
    groups.set(key, g);
  }
  const list = [...groups.values()].sort((a, b) => a.start - b.start).slice(0, 2);

  return (
    <Card className={cn('flex flex-col overflow-hidden motion-safe:animate-fade-up', className)}>
      <div className="flex items-center justify-between gap-3 min-h-16 border-b border-line px-5 py-3.5">
        <h3 className="rounded-lg bg-purple-300 px-2.5 py-0.5 text-base font-semibold text-black shadow-sm">
          <TitleIcon icon={CalendarDays} />
          Schedules
        </h3>
        <Link to="/recruitment/interviews" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">
          View all
        </Link>
      </div>
      <div className="space-y-2 px-5 py-3">
        {q.isLoading ? (
          <div className="h-20 animate-pulse rounded-xl bg-surface-2" />
        ) : q.error ? (
          <p className="py-6 text-center text-sm text-muted">Couldn’t load interview schedules.</p>
        ) : !list.length ? (
          <div className="flex items-center gap-3 py-1">
            <CalendarDays className="h-5 w-5 shrink-0 text-muted" aria-hidden />
            <p className="flex-1 text-sm text-muted">No interviews scheduled</p>
            <Link to="/recruitment/candidates" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-fg hover:bg-surface-2">
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
              Schedule
            </Link>
          </div>
        ) : (
          list.map((g) => (
            <Link key={g.key} to="/recruitment/interviews" className="block rounded-xl bg-surface-2 px-3.5 py-3 transition-colors hover:bg-surface-3">
              <span className={cn('inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold text-white', tagFor(g.job))}>{g.job}</span>
              <p className="mt-1.5 text-sm font-bold text-fg">{`Interview Candidates - ${g.job}`}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                  {g.day === today ? 'Today' : formatKey(g.day, 'EEE, dd MMM yyyy')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5" aria-hidden />
                  {`${t12(g.start)} - ${t12(g.end)}`}
                </span>
              </p>
              <div className="mt-2 flex items-center border-t border-line pt-2">
                <div className="flex -space-x-2">
                  {g.people.slice(0, 4).map((p) => (
                    <div key={p.id} className="rounded-full ring-2 ring-surface-2" title={p.name}>
                      <Avatar name={p.name} size="xs" />
                    </div>
                  ))}
                  {g.people.length > 4 ? (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white ring-2 ring-surface-2">{`+${g.people.length - 4}`}</span>
                  ) : null}
                </div>
                <span className="ml-2 text-xs text-muted">{`${g.people.length} candidate${g.people.length === 1 ? '' : 's'}`}</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </Card>
  );
};
