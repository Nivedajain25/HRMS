import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Coffee, Home, LogIn, LogOut, MapPin, Palmtree, PartyPopper, Search, UserX } from 'lucide-react';
import { Avatar, Badge, ErrorState, Skeleton, type Tone } from '@/components/ui/display';
import { Input, Select } from '@/components/ui/input';
import { cn, minutesToHours } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { toOptions, useAllOf } from '@/features/employees/api';
import { useAttendanceBoard, type BoardCard, type BoardColumnKey } from '../api';
import { formatTimeIn, useOrgTimezone } from '../lib';

/* ------------------------------ Columns ------------------------------ */

const COLUMN_STYLE: Record<BoardColumnKey, { bar: string; dot: string; tint: string; icon: ReactNode; empty: ReactNode }> = {
  NOT_IN: {
    bar: 'bg-slate-400',
    dot: 'bg-slate-400',
    tint: 'bg-slate-50/70 dark:bg-slate-500/5',
    icon: <UserX className="h-4 w-4" />,
    empty: (
      <span className="inline-flex items-center gap-1">
        Everyone’s in <PartyPopper className="h-3.5 w-3.5" aria-hidden />
      </span>
    ),
  },
  WORKING: { bar: 'bg-emerald-500', dot: 'bg-emerald-500', tint: 'bg-emerald-50/60 dark:bg-emerald-500/5', icon: <LogIn className="h-4 w-4" />, empty: 'Nobody working yet' },
  ON_BREAK: { bar: 'bg-amber-500', dot: 'bg-amber-500', tint: 'bg-amber-50/60 dark:bg-amber-500/5', icon: <Coffee className="h-4 w-4" />, empty: 'No one on a break' },
  DONE: { bar: 'bg-sky-500', dot: 'bg-sky-500', tint: 'bg-sky-50/60 dark:bg-sky-500/5', icon: <LogOut className="h-4 w-4" />, empty: 'Nobody has left yet' },
  AWAY: { bar: 'bg-violet-500', dot: 'bg-violet-500', tint: 'bg-violet-50/60 dark:bg-violet-500/5', icon: <Palmtree className="h-4 w-4" />, empty: 'Nobody on leave today' },
};

/** 85 m · 2.4 km */
const distance = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`);

/** Where they clocked in: At office / Outside office / Remote. */
const PlaceTag = ({ card }: { card: BoardCard }) => {
  if (card.workMode === 'REMOTE') {
    return (
      <Badge tone="blue">
        <Home className="h-3 w-3" aria-hidden /> Remote
      </Badge>
    );
  }
  const p = card.place;
  if (!p) {
    return (
      <Badge tone="gray">
        <Building2 className="h-3 w-3" aria-hidden /> Office · no GPS
      </Badge>
    );
  }
  const far = typeof p.distanceMeters === 'number' ? distance(p.distanceMeters) : null;
  if (p.withinOffice === true) {
    return (
      <Badge tone="green">
        <MapPin className="h-3 w-3" aria-hidden /> At office{far ? ` · ${far}` : ''}
      </Badge>
    );
  }
  if (p.withinOffice === false) {
    return (
      <Badge tone="amber">
        <MapPin className="h-3 w-3" aria-hidden /> Outside office{far ? ` · ${far}` : ''}
      </Badge>
    );
  }
  return (
    <Badge tone="gray">
      <MapPin className="h-3 w-3" aria-hidden /> {far ? `${far} from office` : 'GPS recorded'}
    </Badge>
  );
};

/* -------------------------------- Card ------------------------------- */

const minutesSince = (iso: string | null, now: number) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000)) : 0);

const Line = ({ icon, children, tone }: { icon: ReactNode; children: ReactNode; tone?: 'amber' | 'green' | 'muted' }) => (
  <p className={cn('flex items-center gap-1.5 text-xs', tone === 'amber' ? 'text-amber-700 dark:text-amber-300' : tone === 'green' ? 'text-emerald-700 dark:text-emerald-300' : 'text-fg-2')}>
    <span className="shrink-0 opacity-70">{icon}</span>
    <span className="min-w-0 truncate">{children}</span>
  </p>
);

const PersonCard = ({ card, now, timeZone, delay }: { card: BoardCard; now: number; timeZone: string; delay: number }) => {
  const e = card.employee;
  const name = `${e.firstName} ${e.lastName}`.trim();
  const sub = [e.designation, e.department].filter(Boolean).join(' · ');
  const time = (iso: string | null) => (iso ? formatTimeIn(iso, timeZone) : '—');
  // Live figure while clocked in: time since clock-in minus finished breaks (and the running one).
  const working = card.column === 'WORKING' || card.column === 'ON_BREAK' ? Math.max(0, minutesSince(card.checkIn, now) - card.breakMinutesSoFar - minutesSince(card.breakSince, now)) : 0;
  const lateTone: Tone = card.isLate ? 'amber' : 'green';

  // A colleague on an employee's team board: name and status only, and no link (their profile isn't visible).
  if (card.restricted) {
    const status: Record<BoardColumnKey, string> = { WORKING: 'Working', ON_BREAK: 'On a break', DONE: 'Done for the day', NOT_IN: 'Not in yet', AWAY: card.awayReason ?? 'Away' };
    return (
      <li className="motion-safe:animate-pop-in" style={{ animationDelay: `${delay}ms` } as CSSProperties}>
        <div className="rounded-xl border border-line bg-surface p-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            <Avatar name={name} src={e.profilePhoto} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-fg">{name}</p>
              <p className="truncate text-xs text-muted">{sub || e.employeeId}</p>
            </div>
          </div>
          <p className="mt-2.5 text-xs text-fg-2">{status[card.column]}</p>
        </div>
      </li>
    );
  }

  return (
    <li
      className="group motion-safe:animate-pop-in"
      style={{ animationDelay: `${delay}ms` } as CSSProperties}
    >
      <Link
        to={`/employees/${e._id}?tab=attendance`}
        className="block rounded-xl border border-line bg-surface p-3 shadow-sm motion-safe:transition-[transform,box-shadow] motion-safe:duration-200 hover:shadow-pop focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none motion-safe:hover:-translate-y-0.5"
      >
        <div className="flex items-center gap-2.5">
          <Avatar name={name} src={e.profilePhoto} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-fg group-hover:text-brand-700 dark:group-hover:text-brand-300">{name}</p>
            <p className="truncate text-xs text-muted">{sub || e.employeeId}</p>
          </div>
        </div>

        <div className="mt-2.5 space-y-1.5">
          {card.column === 'NOT_IN' &&
            (card.absent ? (
              <Badge tone="red" dot>
                Marked absent
              </Badge>
            ) : (
              <Line icon={<UserX className="h-3.5 w-3.5" />} tone="muted">
                Not clocked in yet
              </Line>
            ))}

          {(card.column === 'WORKING' || card.column === 'ON_BREAK' || card.column === 'DONE') && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <Line icon={<LogIn className="h-3.5 w-3.5" />}>
                  In <span className="font-semibold tabular-nums">{time(card.checkIn)}</span>
                  {card.column === 'DONE' && (
                    <>
                      {' '}→ Out <span className="font-semibold tabular-nums">{time(card.checkOut)}</span>
                    </>
                  )}
                </Line>
                <Badge tone={lateTone}>{card.isLate ? `Late ${minutesToHours(card.lateMinutes)}` : 'On time'}</Badge>
              </div>
              {card.column === 'WORKING' && (
                <Line icon={<LogIn className="h-3.5 w-3.5" />} tone="green">
                  Working for <span className="font-semibold tabular-nums">{minutesToHours(working)}</span>
                </Line>
              )}
              {card.column === 'ON_BREAK' && (
                <Line icon={<Coffee className="h-3.5 w-3.5" />} tone="amber">
                  Break since {time(card.breakSince)} · {minutesToHours(minutesSince(card.breakSince, now))}
                </Line>
              )}
              {card.column === 'DONE' && (
                <Line icon={<LogOut className="h-3.5 w-3.5" />}>
                  Worked <span className="font-semibold tabular-nums">{minutesToHours(card.workingMinutes)}</span>
                </Line>
              )}
              <PlaceTag card={card} />
            </>
          )}

          {card.column === 'AWAY' && (
            <Badge tone="purple">
              <Palmtree className="h-3 w-3" aria-hidden /> {card.awayReason ?? 'Away'}
            </Badge>
          )}
        </div>
      </Link>
    </li>
  );
};

/* -------------------------------- Board ------------------------------ */

/**
 * Kanban of today's attendance for HR / managers. Columns follow real clock actions (no drag and drop); the board
 * refreshes every 30 s and cards pop into their new column when someone clocks in, starts a break or clocks out.
 */
export const AttendanceBoardView = ({ scope, onChange }: { scope?: string; onChange: (patch: { scope?: string }) => void }) => {
  const { can, isManager } = usePermissions();
  const timeZone = useOrgTimezone();
  const [departmentId, setDepartmentId] = useState('');
  const [search, setSearch] = useState('');
  const departments = useAllOf('departments');
  // A stale `scope=team` (e.g. an admin login without a team) is ignored rather than failing the request.
  if (scope === 'team' && !isManager) scope = undefined;
  const board = useAttendanceBoard({ scope: scope || undefined, departmentId: departmentId || undefined });
  const canChooseScope = can('attendance:read') && isManager;

  // Re-render every 30 s so "working for" / break durations move between refreshes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const d = board.data;
  const columns = d?.columns ?? (['NOT_IN', 'WORKING', 'DONE', 'AWAY'] as BoardColumnKey[]).map((key) => ({ key, label: '', count: 0 }));
  const q = search.trim().toLowerCase();
  const cards = useMemo(
    () =>
      (d?.cards ?? []).filter((c) => {
        if (!q) return true;
        const e = c.employee;
        return `${e.firstName} ${e.lastName} ${e.employeeId} ${e.designation ?? ''} ${e.department ?? ''}`.toLowerCase().includes(q);
      }),
    [d, q],
  );

  if (board.error && !d) return <ErrorState className="card" title="Couldn't load the board" message={board.error.message} onRetry={() => board.refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">{d?.scope === 'team' || d?.scope === 'peers' ? 'Team board' : 'Live attendance board'}</h2>
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 motion-safe:animate-soft-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Live · updates every 30 seconds
            {board.dataUpdatedAt ? ` · ${new Date(board.dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-56">
            <Input aria-label="Search people" placeholder="Search people…" leftIcon={<Search className="h-4 w-4" aria-hidden />} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {d?.scope !== 'peers' && <Select aria-label="Department" className="w-44" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} options={toOptions(departments.data)} placeholder="All departments" />}
          {canChooseScope && (
            <Select aria-label="Scope" className="w-36" value={scope ?? ''} onChange={(e) => onChange({ scope: e.target.value || undefined })} options={[{ value: 'team', label: 'My team' }]} placeholder="Organization" />
          )}
        </div>
      </div>

      <div className="scrollbar-thin -mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {/* As many columns as the board sends (no "On break" while breaks are turned off). */}
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`, minWidth: columns.length * 220 }}>
          {columns.map((col) => {
            const style = COLUMN_STYLE[col.key];
            const items = cards.filter((c) => c.column === col.key);
            return (
              <section key={col.key} aria-label={col.label || col.key} className={cn('flex min-h-[260px] flex-col overflow-hidden rounded-2xl border border-line', style.tint)}>
                <div className={cn('h-1', style.bar)} aria-hidden />
                <header className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                    <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg text-white', style.bar)}>{style.icon}</span>
                    {col.label || <Skeleton className="h-4 w-20" />}
                  </h3>
                  <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-fg-2 tabular-nums shadow-sm ring-1 ring-line">{d ? items.length : '…'}</span>
                </header>
                <ul className="scrollbar-thin flex max-h-[62vh] flex-1 flex-col gap-2 overflow-y-auto px-2.5 pb-3">
                  {!d ? (
                    [0, 1].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)
                  ) : items.length === 0 ? (
                    <li className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-line px-3 py-8 text-center text-xs text-muted">{q ? 'No matches' : style.empty}</li>
                  ) : (
                    items.map((c, i) => (
                      // Keyed by column too, so a card moving to a new column pops in there.
                      <PersonCard key={`${c.column}:${c.employee._id}`} card={c} now={now} timeZone={timeZone} delay={Math.min(i, 8) * 45} />
                    ))
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};
