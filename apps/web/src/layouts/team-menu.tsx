import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LayoutGrid, Search, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/display';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useAttendanceBoard, type BoardCard, type BoardColumnKey } from '@/features/attendance/api';
import { formatTimeIn, useOrgTimezone } from '@/features/attendance/lib';

const STATUS: Record<BoardColumnKey, { dot: string; text: string }> = {
  WORKING: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300' },
  ON_BREAK: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
  DONE: { dot: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-300' },
  NOT_IN: { dot: 'bg-slate-400', text: 'text-muted' },
  AWAY: { dot: 'bg-violet-500', text: 'text-violet-700 dark:text-violet-300' },
};

/** Working first, then break, clocked out, not in, away. */
const ORDER: BoardColumnKey[] = ['WORKING', 'ON_BREAK', 'DONE', 'NOT_IN', 'AWAY'];

const statusText = (c: BoardCard, timeZone: string) => {
  switch (c.column) {
    case 'WORKING':
      return `In ${c.checkIn ? formatTimeIn(c.checkIn, timeZone) : ''}${c.isLate ? ' · late' : ''}`;
    case 'ON_BREAK':
      return 'On break';
    case 'DONE':
      return `Out ${c.checkOut ? formatTimeIn(c.checkOut, timeZone) : ''}`;
    case 'AWAY':
      return c.awayReason ?? 'Away';
    default:
      return c.absent ? 'Absent' : 'Not in yet';
  }
};

/**
 * Header icon for people with direct reports: a dropdown of their team with each person's status today
 * (from the live attendance board, team scope), linking to profiles, the team dashboard and the board.
 */
export const TeamMenu = () => {
  const { user, isManager } = usePermissions();
  const timeZone = useOrgTimezone();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const board = useAttendanceBoard({ scope: 'team' }, isManager && open);

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);

  const members = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (board.data?.cards ?? [])
      .filter((c) => c.employee._id !== user?.employeeId)
      .filter((c) => !q || `${c.employee.firstName} ${c.employee.lastName} ${c.employee.designation ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => ORDER.indexOf(a.column) - ORDER.indexOf(b.column) || a.employee.firstName.localeCompare(b.employee.firstName));
  }, [board.data, search, user?.employeeId]);

  if (!isManager) return null;
  const all = (board.data?.cards ?? []).filter((c) => c.employee._id !== user?.employeeId);
  const inNow = all.filter((c) => c.column === 'WORKING' || c.column === 'ON_BREAK').length;
  const away = all.filter((c) => c.column === 'AWAY').length;

  return (
    <div className="relative">
      <Button variant="ghost" size="icon" aria-label="My team" aria-expanded={open} aria-haspopup="dialog" title="My team" onClick={() => setOpen((o) => !o)}>
        <Users className="h-5 w-5" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div role="dialog" aria-label="My team" className="animate-scale-in absolute right-0 z-40 mt-2 w-[min(92vw,360px)] overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
            <div className="border-b border-line px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-fg">
                  My team{board.data ? <span className="ml-1.5 text-muted">({all.length})</span> : null}
                </h2>
                {board.data && (
                  <span className="text-xs text-muted">
                    <span className="font-medium text-emerald-700 dark:text-emerald-300">{inNow} in</span>
                    {away > 0 && <> · {away} away</>}
                  </span>
                )}
              </div>
              {all.length > 6 && (
                <div className="relative mt-2">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
                  <input
                    aria-label="Search team"
                    placeholder="Search team…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-8 w-full rounded-lg border border-line bg-surface-2 pr-2 pl-8 text-sm text-fg outline-none focus:border-brand-500"
                  />
                </div>
              )}
            </div>

            <ul className="scrollbar-thin max-h-80 overflow-y-auto py-1">
              {board.isLoading && <li className="px-4 py-6 text-center text-sm text-muted">Loading…</li>}
              {board.error && <li className="px-4 py-6 text-center text-sm text-muted">Couldn’t load your team.</li>}
              {board.data && members.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-muted">{search ? 'No matches.' : 'No one reports to you yet.'}</li>
              )}
              {members.map((c, i) => {
                const name = `${c.employee.firstName} ${c.employee.lastName}`.trim();
                const s = STATUS[c.column];
                return (
                  <li key={c.employee._id} className="motion-safe:animate-fade-up" style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        navigate(`/employees/${c.employee._id}`);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-2"
                    >
                      <span className="relative shrink-0">
                        <Avatar name={name} src={c.employee.profilePhoto} size="md" />
                        <span className={cn('absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full ring-2 ring-surface', s.dot)} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">{name}</span>
                        <span className="block truncate text-xs text-muted">{c.employee.designation ?? c.employee.department ?? c.employee.employeeId}</span>
                      </span>
                      <span className={cn('shrink-0 text-xs font-medium', s.text)}>{statusText(c, timeZone)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-2 px-4 py-2.5 text-sm">
              <Link to="/team" onClick={() => setOpen(false)} className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline dark:text-brand-300">
                <Users className="h-4 w-4" aria-hidden />
                Team dashboard
              </Link>
              <Link to="/attendance?view=board&scope=team" onClick={() => setOpen(false)} className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline dark:text-brand-300">
                <LayoutGrid className="h-4 w-4" aria-hidden />
                Live board
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
