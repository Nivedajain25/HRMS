import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Clock, Clock3, LogOut, Timer } from 'lucide-react';
import { Avatar, Card } from '@/components/ui/display';
import { useAttendanceBoard, type BoardCard } from '@/features/attendance/api';
import { dateKeyIn, formatKey, formatTimeIn, useOrgTimezone } from '@/features/attendance/lib';
import { useAllOf } from '@/features/employees/api';
import { clock12, cn } from '@/lib/utils';
import { TitleIcon } from './widget';

/** "30 Min" / "1h 5m" */
const lateLabel = (min: number) => (min < 60 ? `${min} Min` : `${Math.floor(min / 60)}h ${min % 60}m`);

const Row = ({ c, timeZone }: { c: BoardCard; timeZone: string }) => {
  const name = `${c.employee.firstName} ${c.employee.lastName}`.trim();
  const out = c.column === 'DONE';
  return (
    <li className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
      <Avatar name={name} src={c.employee.profilePhoto} size="md" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-black dark:text-fg">
          <span className="truncate">{name}</span>
          {c.isLate ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white">
              <Timer className="h-3 w-3" aria-hidden />
              {lateLabel(c.lateMinutes)}
            </span>
          ) : null}
        </p>
        <p className="truncate text-xs text-black dark:text-fg">{c.employee.designation ?? c.employee.department ?? c.employee.employeeId}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {out ? <LogOut className="h-4 w-4 text-black dark:text-fg" aria-label="Clocked out" /> : <Clock3 className="h-4 w-4 text-black dark:text-fg" aria-hidden />}
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold text-white tabular-nums',
            out ? 'bg-sky-600' : 'bg-emerald-600',
          )}
          title={out ? `In ${clock12(formatTimeIn(c.checkIn, timeZone))} · out ${clock12(formatTimeIn(c.checkOut, timeZone))}` : `Clocked in ${clock12(formatTimeIn(c.checkIn, timeZone))}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden />
          {clock12(formatTimeIn(out ? c.checkOut : c.checkIn, timeZone))}
        </span>
      </div>
    </li>
  );
};

const Group = ({ title, items, timeZone }: { title: string; items: BoardCard[]; timeZone: string }) =>
  items.length ? (
    <section>
      <h4 className="mb-2 text-sm font-semibold text-black dark:text-fg">{`${title} (${items.length})`}</h4>
      <ul className="space-y-2">
        {items.map((c) => (
          <Row key={c.employee._id} c={c} timeZone={timeZone} />
        ))}
      </ul>
    </section>
  ) : null;

/** Who clocked in (late / on time) and who has left, for any day and department. */
export const ClockInOutCard = ({ className }: { className?: string }) => {
  const timeZone = useOrgTimezone();
  const today = dateKeyIn(timeZone);
  const [date, setDate] = useState(today);
  const [departmentId, setDepartmentId] = useState('');
  const dateInput = useRef<HTMLInputElement>(null);
  const isToday = date === today;
  const board = useAttendanceBoard({ date: isToday ? undefined : date, departmentId: departmentId || undefined });
  const departments = useAllOf('departments');

  const cards = (board.data?.cards ?? []).filter((c) => c.checkIn && !c.restricted);
  const byTime = (a: BoardCard, b: BoardCard) => new Date(a.checkIn!).getTime() - new Date(b.checkIn!).getTime();
  const inNow = cards.filter((c) => c.column !== 'DONE');
  const late = inNow.filter((c) => c.isLate).sort(byTime);
  const onTime = inNow.filter((c) => !c.isLate).sort(byTime);
  const left = cards.filter((c) => c.column === 'DONE').sort((a, b) => new Date(b.checkOut!).getTime() - new Date(a.checkOut!).getTime());

  return (
    <Card
      className={cn(
        'flex flex-col overflow-hidden border-blue-200 bg-white motion-safe:animate-fade-up dark:border-blue-500/20 dark:bg-surface',
        className,
      )}
    >
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-2 border-b border-line bg-white px-5 py-3.5 dark:bg-surface">
        <h3 className="rounded-lg bg-fuchsia-200 px-2.5 py-0.5 text-base font-semibold text-black shadow-sm">
          <TitleIcon icon={Clock} />
          Clock-In/Out
        </h3>
        <div className="flex items-center gap-2">
          <select
            aria-label="Department"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="h-9 max-w-[11rem] cursor-pointer truncate rounded-lg border-0 bg-transparent pr-7 pl-2 text-sm font-medium text-black dark:text-fg hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <option value="">All Departments</option>
            {(departments.data ?? []).map((d: { _id: string; name: string }) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
          </select>
          <div className="relative">
            <button
              type="button"
              onClick={() => dateInput.current?.showPicker?.()}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-black dark:text-fg shadow-sm hover:bg-surface-2"
            >
              <CalendarDays className="h-4 w-4" aria-hidden />
              {isToday ? 'Today' : formatKey(date, 'dd MMM')}
            </button>
            <input
              ref={dateInput}
              type="date"
              max={today}
              value={date}
              onChange={(e) => setDate(e.target.value || today)}
              aria-label="Choose a day"
              className="pointer-events-none absolute right-0 bottom-0 h-0 w-0 opacity-0"
              tabIndex={-1}
            />
          </div>
        </div>
      </div>

      <div className="scrollbar-thin max-h-[360px] flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {board.isLoading ? (
          <div className="space-y-2" aria-busy>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-2" />
            ))}
          </div>
        ) : !cards.length ? (
          <p className="py-6 text-center text-sm text-black dark:text-fg">{isToday ? 'No one has clocked in yet today.' : 'No clock-ins on this day.'}</p>
        ) : (
          <>
            <Group title="Late" items={late} timeZone={timeZone} />
            <Group title="On time" items={onTime} timeZone={timeZone} />
            <Group title="Clocked out" items={left} timeZone={timeZone} />
          </>
        )}
      </div>

      <div className="px-5 pb-4">
        <Link
          to="/attendance?view=records"
          className="flex h-10 items-center justify-center rounded-lg border border-line bg-surface-2 text-sm font-medium text-black dark:text-fg hover:bg-surface-3"
        >
          View All Attendance
        </Link>
      </div>
    </Card>
  );
};
