import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlarmClock,
  BadgeCheck,
  CalendarDays,
  Camera,
  CameraOff,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Download,
  FileBarChart,
  Flame,
  Hand,
  LogIn,
  LogOut,
  MapPin,
  MapPinOff,
  Navigation,
  PartyPopper,
  Settings,
  ShieldCheck,
  TriangleAlert,
  UserCog,
  Zap,
} from 'lucide-react';
import { Avatar, Card, Skeleton } from '@/components/ui/display';
import { downloadFile, getPaged, toApiError } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import { useAttendanceDashboard, useHolidays, type AttendanceRow } from '../api';
import { dateKeyIn, formatKey, formatTimeIn, useOrgTimezone } from '../lib';

/* --------------------------------- Data --------------------------------- */

const pad = (n: number) => String(n).padStart(2, '0');
const monthRange = (dateKey: string) => {
  const [y, m] = dateKey.split('-').map(Number) as [number, number];
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` };
};

/** Every attendance record in the organization for a month (all pages). */
const useOrgMonth = (month: string) => {
  const { from, to } = monthRange(`${month}-01`);
  return useQuery({
    queryKey: ['attendance', 'org-month', from, to],
    queryFn: async () => {
      const all: AttendanceRow[] = [];
      for (let page = 1; page <= 30; page++) {
        const res = await getPaged<AttendanceRow>('/attendance', { scope: 'all', from, to, page, limit: 100 });
        all.push(...res.data);
        if (page >= res.pagination.totalPages) break;
      }
      return all;
    },
    refetchInterval: 60_000,
  });
};

const personName = (r: AttendanceRow) => `${r.employeeId?.firstName ?? ''} ${r.employeeId?.lastName ?? ''}`.trim() || 'Employee';
const deptName = (r: AttendanceRow) => r.employeeId?.departmentId?.name ?? r.employeeId?.department?.name ?? '—';
const placeName = (r: AttendanceRow) => {
  if (r.workMode === 'REMOTE') return 'Remote';
  const g = r.checkInLocation;
  if (!g) return 'No location';
  return g.withinOffice && g.officeName ? g.officeName : (g.address ?? g.officeName ?? 'GPS recorded');
};
const hasSelfie = (r: AttendanceRow) => !!r.checkInPhotoId;
const hasGps = (r: AttendanceRow) => r.checkInLocation?.latitude != null && r.checkInLocation?.longitude != null;

/* ------------------------------- Shared UI ------------------------------- */

const BoxTitle = ({ icon, title, right }: { icon?: ReactNode; title: string; right?: ReactNode }) => (
  <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-5 py-3">
    <h3 className="flex items-center gap-2 text-lg font-semibold text-fg">
      {icon}
      {title}
    </h3>
    {right}
  </div>
);
const ViewAll = ({ to }: { to: string }) => (
  <Link to={to} className="text-xs font-semibold text-orange-600 hover:underline dark:text-orange-400">
    View All →
  </Link>
);

/* ------------------------------- Calendar ------------------------------- */

type DayKind = 'PRESENT' | 'LATE' | 'ABSENT' | 'LEAVE' | 'HALF' | 'OFF';
const DAY_STYLE: Record<DayKind, { label: string; cell: string; dot: string }> = {
  PRESENT: { label: 'Present', cell: 'bg-emerald-600 text-white', dot: 'bg-emerald-600' },
  LATE: { label: 'Late', cell: 'bg-amber-500 text-white', dot: 'bg-amber-500' },
  ABSENT: { label: 'Absent', cell: 'bg-rose-500 text-white', dot: 'bg-rose-500' },
  LEAVE: { label: 'Leave', cell: 'bg-blue-500 text-white', dot: 'bg-blue-500' },
  HALF: { label: 'Half Day', cell: 'bg-violet-500 text-white', dot: 'bg-violet-500' },
  OFF: { label: 'Weekend/Holiday', cell: 'bg-slate-200 text-slate-500 dark:bg-white/10 dark:text-slate-400', dot: 'bg-slate-300' },
};

/** Month grid coloured by the day's main status across the organization; click a day to view it. */
const CalendarCard = ({ day, today, onDate }: { day: string; today: string; onDate: (d: string | undefined) => void }) => {
  const [month, setMonth] = useState(day.slice(0, 7));
  const q = useOrgMonth(month);
  const holidays = useHolidays({ year: Number(month.slice(0, 4)) });
  const { from, to } = monthRange(`${month}-01`);

  const kinds = useMemo(() => {
    const tally = new Map<string, Record<Exclude<DayKind, 'OFF'>, number>>();
    for (const r of q.data ?? []) {
      const k = r.date.slice(0, 10);
      const t = tally.get(k) ?? { PRESENT: 0, LATE: 0, ABSENT: 0, LEAVE: 0, HALF: 0 };
      const st = r.status as string;
      if (st === 'HALF_DAY') t.HALF++;
      else if (st === 'ABSENT') t.ABSENT++;
      else if (st === 'LEAVE' || st === 'ON_LEAVE') t.LEAVE++;
      else if (r.checkIn) r.isLate ? t.LATE++ : t.PRESENT++;
      tally.set(k, t);
    }
    const out = new Map<string, DayKind>();
    for (const [k, t] of tally) {
      const top = (Object.entries(t) as [Exclude<DayKind, 'OFF'>, number][]).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] > 0) out.set(k, top[0]);
    }
    for (const h of holidays.data ?? []) if (h.date.startsWith(month) && !out.has(h.date)) out.set(h.date, 'OFF');
    return out;
  }, [q.data, holidays.data, month]);

  const lead = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: Number(to.slice(8)) }, (_, i) => `${month}-${pad(i + 1)}`)];
  const shiftMonth = (by: number) => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const t = y * 12 + (m - 1) + by;
    setMonth(`${Math.floor(t / 12)}-${pad((t % 12) + 1)}`);
  };
  return (
    <Card className="overflow-hidden">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div>
          <h3 className="text-lg leading-tight font-semibold text-fg">Attendance Calendar</h3>
          <p className="text-sm text-muted">{formatKey(`${month}-01`, 'MMMM yyyy')}</p>
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-fg">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => shiftMonth(1)} disabled={month >= today.slice(0, 7)} aria-label="Next month" className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex gap-4 p-4">
        <div className="grid flex-1 grid-cols-7 gap-y-1.5 text-center">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => (
            <span key={w} className="text-[11px] font-semibold text-muted">
              {w}
            </span>
          ))}
          {cells.map((d, i) => {
            if (!d) return <span key={`b${i}`} />;
            const sunday = new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
            const k = kinds.get(d) ?? (sunday && d <= today ? 'OFF' : undefined);
            return (
              <button
                key={d}
                type="button"
                disabled={d > today}
                onClick={() => onDate(d === today ? undefined : d)}
                title={k ? DAY_STYLE[k].label : undefined}
                className={cn(
                  'mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums transition-transform hover:scale-110 disabled:hover:scale-100',
                  k ? DAY_STYLE[k].cell : d > today ? 'bg-surface-2 text-subtle' : 'bg-surface-2 text-fg-2',
                  d === day && 'ring-2 ring-fg/60 ring-offset-1 ring-offset-surface',
                )}
              >
                {Number(d.slice(8))}
              </button>
            );
          })}
        </div>
        <ul className="hidden shrink-0 space-y-2 pt-6 text-xs text-fg-2 sm:block">
          {(Object.keys(DAY_STYLE) as DayKind[]).map((k) => (
            <li key={k} className="flex items-center gap-2">
              <span className={cn('h-2.5 w-2.5 rounded-full', DAY_STYLE[k].dot)} aria-hidden />
              {DAY_STYLE[k].label}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
};

/* -------------------------------- Trend -------------------------------- */

type Range = 'week' | '2weeks' | '3m' | '6m';

/** Attendance rate (present ÷ present + absent) over time. */
const TrendCard = ({ date }: { date: string | undefined }) => {
  const [range, setRange] = useState<Range>('week');
  const dash = useAttendanceDashboard({ date });
  const data = useMemo(() => {
    const d = dash.data;
    if (!d) return [];
    const rate = (p: { present: number; absent: number }) => (p.present + p.absent ? Math.round((p.present / (p.present + p.absent)) * 100) : null);
    if (range === 'week' || range === '2weeks') {
      return d.trend.slice(range === 'week' ? -7 : -14).map((p) => ({ label: formatKey(p.date, range === 'week' ? 'EEE' : 'dd MMM'), rate: rate(p) }));
    }
    return d.monthly.slice(range === '3m' ? -3 : -6).map((p) => ({ label: formatKey(`${p.month}-01`, 'MMM'), rate: rate(p) }));
  }, [dash.data, range]);
  return (
    <Card className="flex flex-col overflow-hidden">
      <BoxTitle
        title="Attendance Trend"
        right={
          <div role="radiogroup" aria-label="Range" className="flex rounded-lg bg-surface-2 p-0.5 text-[11px] font-medium whitespace-nowrap">
            {(
              [
                ['week', 'Week'],
                ['2weeks', '2 Weeks'],
                ['3m', '3 Months'],
                ['6m', '6 Months'],
              ] as [Range, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={range === k}
                onClick={() => setRange(k)}
                className={cn('rounded-md px-2 py-1', range === k ? 'bg-surface text-blue-700 shadow-sm dark:text-blue-300' : 'text-muted hover:text-fg')}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />
      <div className="h-52 flex-1 px-3 py-3">
        {!dash.data ? (
          <Skeleton className="h-full" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
              <defs>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-line" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} stroke="currentColor" className="text-muted" />
              <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} stroke="currentColor" className="text-muted" />
              <Tooltip formatter={(v: number) => [`${v}%`, 'Attendance']} />
              <Area type="monotone" dataKey="rate" stroke="#10b981" strokeWidth={2.5} fill="url(#trendFill)" connectNulls dot={{ r: 3.5, fill: '#10b981' }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
};

/* ----------------------------- Verification ----------------------------- */

const VerificationCard = ({ records, loading }: { records: AttendanceRow[]; loading: boolean }) => {
  const clocked = records.filter((r) => r.checkIn);
  const total = clocked.length;
  const selfie = clocked.filter(hasSelfie).length;
  const gps = clocked.filter(hasGps).length;
  const verified = clocked.filter((r) => hasSelfie(r) && hasGps(r)).length;
  const pct = total ? Math.round((verified / total) * 100) : 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  const rows = [
    { icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />, label: 'Selfie verified', value: selfie, tone: 'text-emerald-600' },
    { icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />, label: 'Location verified', value: gps, tone: 'text-emerald-600' },
    { icon: <TriangleAlert className="h-4 w-4 text-amber-500" />, label: 'Location missing', value: total - gps, tone: 'text-amber-600' },
    { icon: <TriangleAlert className="h-4 w-4 text-rose-500" />, label: 'Selfie missing', value: total - selfie, tone: 'text-rose-600' },
  ];
  return (
    <Card className="flex flex-col overflow-hidden">
      <BoxTitle icon={<ShieldCheck className="h-5 w-5 text-emerald-600" />} title="Attendance Verification" />
      {loading ? (
        <div className="p-5">
          <Skeleton className="h-40" />
        </div>
      ) : (
        <div className="flex flex-1 items-center gap-4 p-4">
          <div className="flex shrink-0 flex-col items-center">
            <div className="relative h-32 w-32">
              <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
                <circle cx="60" cy="60" r={r} fill="none" strokeWidth="11" className="stroke-surface-3" />
                <circle cx="60" cy="60" r={r} fill="none" stroke="#059669" strokeWidth="11" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-fg tabular-nums">{`${pct}%`}</span>
            </div>
            <p className="mt-1 text-xs font-medium text-fg-2">Verified records</p>
            <p className="text-sm font-semibold text-fg tabular-nums">{`${verified} / ${total}`}</p>
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <ul className="divide-y divide-line">
              {rows.map((row) => (
                <li key={row.label} className="flex items-center gap-2 py-1.5 text-sm">
                  {row.icon}
                  <span className="min-w-0 flex-1 truncate text-fg-2">{row.label}</span>
                  <span className={cn('font-semibold tabular-nums', row.tone)}>{row.value}</span>
                </li>
              ))}
            </ul>
            <a href="#attendance-exceptions" className="mt-1 inline-flex w-full items-center justify-center rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-surface-2 dark:text-blue-300">
              Review Exceptions ↓
            </a>
          </div>
        </div>
      )}
    </Card>
  );
};

/* ----------------------------- Recent activity ----------------------------- */

const VerifyTag = ({ r }: { r: AttendanceRow }) => {
  const ok = hasSelfie(r) && (hasGps(r) || r.workMode === 'REMOTE');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
      )}
    >
      {ok ? <BadgeCheck className="h-3 w-3" aria-hidden /> : <TriangleAlert className="h-3 w-3" aria-hidden />}
      {ok ? 'Verified' : !hasSelfie(r) ? 'No selfie' : 'No GPS'}
    </span>
  );
};

const ActivityCard = ({ records, loading }: { records: AttendanceRow[]; loading: boolean }) => {
  const timeZone = useOrgTimezone();
  const events = records
    .flatMap((r) => [
      ...(r.checkIn ? [{ at: r.checkIn, action: 'Check In', r }] : []),
      ...(r.checkOut ? [{ at: r.checkOut, action: 'Check Out', r }] : []),
    ])
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 6);
  return (
    <Card className="overflow-hidden">
      <BoxTitle title="Recent Attendance Activity" right={<ViewAll to="/attendance?view=records" />} />
      {loading ? (
        <div className="p-5">
          <Skeleton className="h-40" />
        </div>
      ) : !events.length ? (
        <p className="p-8 text-center text-sm text-muted">No check-ins on this day.</p>
      ) : (
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-14" />
            <col />
            <col className="w-24" />
            <col />
          </colgroup>
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-semibold">Time</th>
              <th scope="col" className="px-2 py-2 text-left font-semibold">Employee</th>
              <th scope="col" className="px-2 py-2 text-left font-semibold">Action</th>
              <th scope="col" className="py-2 pr-4 pl-2 text-left font-semibold">Location</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {events.map((e, i) => (
              <tr key={i} className="hover:bg-surface-2">
                <td className="px-4 py-2.5 text-xs font-semibold text-fg-2 tabular-nums">{formatTimeIn(e.at, timeZone)}</td>
                <td className="px-2 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar name={personName(e.r)} src={e.r.employeeId?.profilePhoto} size="sm" />
                    <span className="truncate font-medium text-fg" title={personName(e.r)}>
                      {personName(e.r)}
                    </span>
                  </span>
                </td>
                <td className="px-2 py-2.5">
                  <span className="flex flex-col items-start gap-1">
                    <span className={cn('inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap', e.action === 'Check In' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300')}>
                      {e.action === 'Check In' ? <LogIn className="h-3.5 w-3.5" aria-hidden /> : <LogOut className="h-3.5 w-3.5" aria-hidden />}
                      {e.action}
                    </span>
                    <VerifyTag r={e.r} />
                  </span>
                </td>
                <td className="py-2.5 pr-4 pl-2">
                  <span className="flex min-w-0 items-center gap-1 text-xs text-fg-2" title={placeName(e.r)}>
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                    <span className="truncate">{placeName(e.r)}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
};

/* ----------------------------- Late arrivals ----------------------------- */

const LateCard = ({ month, loading }: { month: AttendanceRow[]; loading: boolean }) => {
  const timeZone = useOrgTimezone();
  const rows = useMemo(() => {
    const by = new Map<string, { r: AttendanceRow; days: number; minutes: number[] }>();
    for (const r of month) {
      if (!r.isLate || !r.checkIn) continue;
      const id = r.employeeId?._id ?? '';
      const cur = by.get(id) ?? { r, days: 0, minutes: [] };
      cur.days += 1;
      const [h, m] = formatTimeIn(r.checkIn, timeZone).split(':').map(Number) as [number, number];
      cur.minutes.push(h * 60 + m);
      by.set(id, cur);
    }
    return [...by.values()]
      .map((v) => {
        const avg = Math.round(v.minutes.reduce((a, b) => a + b, 0) / v.minutes.length);
        const h24 = Math.floor(avg / 60);
        return { ...v, avg: `${pad(((h24 + 11) % 12) + 1)}:${pad(avg % 60)} ${h24 < 12 ? 'AM' : 'PM'}` };
      })
      .sort((a, b) => b.days - a.days)
      .slice(0, 5);
  }, [month, timeZone]);
  return (
    <Card className="overflow-hidden">
      <BoxTitle icon={<Flame className="h-5 w-5 text-orange-500" />} title="Late Arrival Analysis" right={<ViewAll to="/attendance?view=records" />} />
      {loading ? (
        <div className="p-5">
          <Skeleton className="h-40" />
        </div>
      ) : !rows.length ? (
        <p className="flex items-center justify-center gap-1.5 p-8 text-sm text-muted">
          No late arrivals this month
          <PartyPopper className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-semibold">Employee</th>
              <th scope="col" className="px-4 py-2 text-left font-semibold">Department</th>
              <th scope="col" className="px-4 py-2 text-center font-semibold">Late days</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">Avg. arrival</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((v) => (
              <tr key={v.r.employeeId?._id} className="hover:bg-surface-2">
                <td className="px-4 py-2">
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <Avatar name={personName(v.r)} src={v.r.employeeId?.profilePhoto} size="sm" />
                    <span className="font-medium text-fg">{personName(v.r)}</span>
                  </span>
                </td>
                <td className="px-4 py-2 text-fg-2">{deptName(v.r)}</td>
                <td className="px-4 py-2 text-center font-semibold text-rose-600 tabular-nums dark:text-rose-400">{v.days}</td>
                <td className="px-4 py-2 text-right text-fg-2 tabular-nums">{v.avg}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
};

/* ----------------------------- Quick actions ----------------------------- */

const QuickActionsCard = ({ month }: { month: string }) => {
  const { from, to } = monthRange(`${month}-01`);
  const exportMonth = async () => {
    try {
      await downloadFile('/reports/attendance_log', { format: 'xlsx', from, to }, `attendance-${month}.xlsx`);
    } catch (err) {
      toast.error('Could not export the report', { description: toApiError(err).message });
    }
  };
  const tile = 'flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5 text-left text-sm font-medium text-fg hover:bg-surface-2';
  const icon = (node: ReactNode, tone: string) => (
    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', tone)} aria-hidden>
      {node}
    </span>
  );
  return (
    <Card className="overflow-hidden">
      <BoxTitle icon={<Zap className="h-5 w-5 text-orange-500" />} title="Quick Actions" />
      <div className="grid grid-cols-2 gap-2 p-4">
        <Link to="/attendance?view=records" className={tile}>
          {icon(<Hand className="h-4 w-4" />, 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300')}
          Mark Manual Attendance
        </Link>
        <Link to="/reports/attendance" className={tile}>
          {icon(<FileBarChart className="h-4 w-4" />, 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300')}
          View Attendance Report
        </Link>
        <Link to="/regularization" className={tile}>
          {icon(<ClipboardCheck className="h-4 w-4" />, 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300')}
          Approve Corrections
        </Link>
        <button type="button" onClick={() => void exportMonth()} className={tile}>
          {icon(<Download className="h-4 w-4" />, 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300')}
          Export Report
        </button>
        <Link to="/shifts" className={tile}>
          {icon(<UserCog className="h-4 w-4" />, 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300')}
          Manage Shifts
        </Link>
        <Link to="/settings" className={tile}>
          {icon(<Settings className="h-4 w-4" />, 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300')}
          Attendance Settings
        </Link>
      </div>
    </Card>
  );
};

/* ------------------------------- Exceptions ------------------------------- */

const ExceptionsCard = ({ records, day, today, loading }: { records: AttendanceRow[]; day: string; today: string; loading: boolean }) => {
  const clocked = records.filter((r) => r.checkIn);
  const items = [
    { label: 'Missing Check-out', value: day < today ? clocked.filter((r) => !r.checkOut).length : 0, icon: <CalendarDays className="h-5 w-5" />, tone: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300', num: 'text-rose-600' },
    { label: 'Late Check-in', value: clocked.filter((r) => r.isLate).length, icon: <AlarmClock className="h-5 w-5" />, tone: 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300', num: 'text-orange-600' },
    { label: 'Missing Selfie', value: clocked.filter((r) => !hasSelfie(r)).length, icon: <CameraOff className="h-5 w-5" />, tone: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300', num: 'text-amber-600' },
    {
      label: 'Location Mismatch',
      value: clocked.filter((r) => r.workMode !== 'REMOTE' && r.checkInLocation?.withinOffice === false).length,
      icon: <Navigation className="h-5 w-5" />,
      tone: 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
      num: 'text-blue-600',
    },
    { label: 'No Location', value: clocked.filter((r) => r.workMode !== 'REMOTE' && !hasGps(r)).length, icon: <MapPinOff className="h-5 w-5" />, tone: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300', num: 'text-violet-600' },
    {
      label: 'Manual Attendance',
      value: records.filter((r) => r.regularized || r.source === 'ADMIN' || r.source === 'REGULARIZATION').length,
      icon: <Camera className="h-5 w-5" />,
      tone: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300',
      num: 'text-fg',
    },
  ];
  return (
    <Card id="attendance-exceptions" className="flex h-full scroll-mt-24 flex-col overflow-hidden">
      <BoxTitle icon={<TriangleAlert className="h-5 w-5 text-rose-500" />} title="Attendance Exceptions" right={<ViewAll to="/attendance?view=records" />} />
      {loading ? (
        <div className="p-5">
          <Skeleton className="h-20" />
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-2 gap-3 p-4 sm:grid-cols-3">
          {items.map((it) => (
            <div key={it.label} className="flex items-center gap-3 rounded-xl border border-line px-3 py-3">
              <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', it.tone)} aria-hidden>
                {it.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-xs leading-snug font-medium text-fg-2">{it.label}</span>
                <span className={cn('block text-xl font-bold tabular-nums', it.value ? it.num : 'text-fg')}>{it.value}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

/* ---------------------------- Location overview ---------------------------- */

const W = 400;
const H = 190;
const lonPx = (lon: number, z: number) => ((lon + 180) / 360) * 256 * 2 ** z;
const latPx = (lat: number, z: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** z;
};
const MARKER: Record<string, string> = { office: '#059669', remote: '#2563eb', field: '#f59e0b', other: '#8b5cf6' };
const kindOf = (r: AttendanceRow) => (r.workMode === 'REMOTE' ? 'remote' : r.checkInLocation?.withinOffice === true ? 'office' : r.checkInLocation?.withinOffice === false ? 'field' : 'other');

/** Map of where people clocked in (OpenStreetMap tiles) with counts by kind of place. */
const LocationCard = ({ records, loading }: { records: AttendanceRow[]; loading: boolean }) => {
  const clocked = records.filter((r) => r.checkIn);
  const counts = { office: 0, remote: 0, field: 0, other: 0 } as Record<string, number>;
  for (const r of clocked) counts[kindOf(r)]! += 1;
  const pts = clocked.filter(hasGps).map((r) => ({ lat: r.checkInLocation!.latitude!, lon: r.checkInLocation!.longitude!, kind: kindOf(r), name: personName(r) }));

  const map = useMemo(() => {
    if (!pts.length) return null;
    let z = 16;
    for (; z > 3; z--) {
      const xs = pts.map((p) => lonPx(p.lon, z));
      const ys = pts.map((p) => latPx(p.lat, z));
      if (Math.max(...xs) - Math.min(...xs) < W - 60 && Math.max(...ys) - Math.min(...ys) < H - 50) break;
    }
    const xs = pts.map((p) => lonPx(p.lon, z));
    const ys = pts.map((p) => latPx(p.lat, z));
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const left = cx - W / 2;
    const top = cy - H / 2;
    const tiles: { x: number; y: number; px: number; py: number }[] = [];
    for (let tx = Math.floor(left / 256); tx <= Math.floor((left + W) / 256); tx++) {
      for (let ty = Math.floor(top / 256); ty <= Math.floor((top + H) / 256); ty++) tiles.push({ x: tx, y: ty, px: tx * 256 - left, py: ty * 256 - top });
    }
    return { z, tiles, markers: pts.map((p, i) => ({ ...p, x: xs[i]! - left, y: ys[i]! - top })) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(pts)]);

  return (
    <Card className="overflow-hidden">
      <BoxTitle title="Location Overview" />
      {loading ? (
        <div className="p-5">
          <Skeleton className="h-40" />
        </div>
      ) : (
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-surface-2">
            {map ? (
              <>
                <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Map of check-in locations">
                  {map.tiles.map((t) => (
                    <image key={`${t.x}-${t.y}`} href={`https://tile.openstreetmap.org/${map.z}/${t.x}/${t.y}.png`} x={t.px} y={t.py} width={256} height={256} />
                  ))}
                  {map.markers.map((m, i) => (
                    <g key={i} transform={`translate(${m.x} ${m.y})`}>
                      <title>{m.name}</title>
                      <path d="M0 0 C -7 -9 -9 -13 -9 -17 A 9 9 0 1 1 9 -17 C 9 -13 7 -9 0 0 Z" fill={MARKER[m.kind]} stroke="#fff" strokeWidth="1.5" />
                      <circle cy={-17} r={3.2} fill="#fff" />
                    </g>
                  ))}
                </svg>
                <span className="absolute right-1 bottom-0.5 text-[9px] text-slate-600">&copy; OpenStreetMap</span>
              </>
            ) : (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted">
                <MapPinOff className="h-6 w-6" aria-hidden />
                No locations recorded on this day
              </div>
            )}
          </div>
          <ul className="shrink-0 space-y-2.5 text-sm sm:w-32">
            {(
              [
                ['office', 'Office'],
                ['remote', 'Remote'],
                ['field', 'Field'],
                ['other', 'Other'],
              ] as [string, string][]
            ).map(([k, label]) => (
              <li key={k} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: MARKER[k] }} aria-hidden />
                <span className="flex-1 text-fg-2">{label}</span>
                <span className="font-semibold text-fg tabular-nums">{counts[k]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
};

/* --------------------------------- Page --------------------------------- */

/** Super admin Attendance: calendar, trend, verification, activity, late arrivals, actions, exceptions, locations. */
export const AdminAttendanceInsights = ({ date, onDate }: { date: string | undefined; onDate: (d: string | undefined) => void }) => {
  const timeZone = useOrgTimezone();
  const today = dateKeyIn(timeZone);
  const day = date ?? today;
  const monthQ = useOrgMonth(day.slice(0, 7));
  const month = monthQ.data ?? [];
  const dayRecords = month.filter((r) => r.date.slice(0, 10) === day);
  const loading = monthQ.isLoading;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <CalendarCard key={day.slice(0, 7)} day={day} today={today} onDate={onDate} />
        <TrendCard date={date} />
        <VerificationCard records={dayRecords} loading={loading} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <ActivityCard records={dayRecords} loading={loading} />
        <LateCard month={month} loading={loading} />
        <QuickActionsCard month={day.slice(0, 7)} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex xl:col-span-2 [&>*]:flex-1">
          <ExceptionsCard records={dayRecords} day={day} today={today} loading={loading} />
        </div>
        <LocationCard records={dayRecords} loading={loading} />
      </div>
      <p className="text-right text-xs text-muted">{`Showing ${date ? formatDate(`${day}T00:00:00Z`, 'dd MMM yyyy') : 'today'} · late arrivals for ${formatKey(`${day.slice(0, 7)}-01`, 'MMMM yyyy')}`}</p>
    </div>
  );
};
