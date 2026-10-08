import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import {
  AlarmClock,
  BadgeCheck,
  Building2,
  CalendarCheck,
  CalendarDays,
  Camera,
  CircleSlash,
  Clock3,
  Coffee,
  Hourglass,
  LogIn,
  LogOut,
  MapPin,
  MapPinOff,
  Monitor,
  Play,
  Smartphone,
  Timer,
  TrendingDown,
  TrendingUp,
  Umbrella,
  UserCheck,
  UserX,
  CircleDashed,
  Activity,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  History,
  LineChart as LineChartIcon,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/display';
import { useConfirm } from '@/components/ui/overlay';
import { fetchObjectUrl, openFile } from '@/lib/api';
import { cn, formatDate, minutesToHours } from '@/lib/utils';
import { useActivityFeed, useEmployeeDashboard } from '@/features/dashboard/api';
import { useLeaves } from '@/features/leave/api';
import { useAttendanceList, useAttendanceSummary, useClockAction, useHolidays, useToday, type AttendanceBase, type GeoPoint, type SummaryRow, type TodayState } from '../api';
import { dateKeyIn, formatKey, formatTimeIn, useNow, useOrgTimezone } from '../lib';
import { useClockFlow } from '../use-clock-flow';

/* Warm brown palette (the employee theme). */
const RUST = '#2563eb';
const TILE = 'bg-[#dbeafe] text-[#1d4ed8] dark:bg-[#1d4ed8]/25 dark:text-[#dbeafe]';
const PRIMARY = 'bg-[#2563eb] text-white hover:bg-[#1d4ed8]';

const pad = (n: number) => String(n).padStart(2, '0');
const monthBounds = (dateKey: string, shift = 0) => {
  const [y, m] = dateKey.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + shift;
  const yy = Math.floor(t / 12);
  const mm = (t % 12) + 1;
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return { from: `${yy}-${pad(mm)}-01`, to: shift === 0 ? dateKey : `${yy}-${pad(mm)}-${pad(last)}` };
};
const rate = (r?: SummaryRow) => {
  if (!r) return null;
  const counted = r.present + r.halfDay + r.absent;
  return counted ? Math.round(((r.present + r.halfDay * 0.5) / counted) * 100) : null;
};
const hm = (minutes: number) => {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
};

/** Live worked minutes from today's record. */
const liveWorked = (t: TodayState, now: Date) => {
  const r = t.record;
  if (!r?.checkIn) return 0;
  if (r.checkOut) return r.workingMinutes;
  let breakMs = 0;
  for (const b of r.breaks) {
    const s = new Date(b.start).getTime();
    const e = b.end ? new Date(b.end).getTime() : now.getTime();
    if (e > s) breakMs += e - s;
  }
  return Math.max(0, (now.getTime() - new Date(r.checkIn).getTime() - breakMs) / 60_000);
};

const place = (g?: GeoPoint | null) => (g ? (g.withinOffice && g.officeName ? g.officeName : (g.address ?? g.officeName ?? null)) : null);

/* ------------------------------- Pieces -------------------------------- */

const Ring = ({ pct, size = 76, stroke = 8 }: { pct: number; size?: number; stroke?: number }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1e2d3" strokeWidth={stroke} className="dark:opacity-30" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={RUST} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (p / 100) * c} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-base font-bold text-fg tabular-nums">{`${p}%`}</span>
    </div>
  );
};

const BigStat = ({ icon, iconTone, label, value, sub, extra, className }: { icon: ReactNode; iconTone: string; label: string; value: ReactNode; sub?: ReactNode; extra?: ReactNode; className?: string }) => (
  <Card className={cn('flex items-center gap-4 p-4', className)}>
    <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', iconTone)} aria-hidden>
      {icon}
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-0.5 text-2xl font-bold text-fg tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted">{sub}</p> : null}
    </div>
    {extra}
  </Card>
);

const SmallStat = ({ icon, tone, label, value }: { icon: ReactNode; tone: string; label: string; value: string }) => (
  <Card className="flex items-center gap-2.5 px-3 py-2">
    <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md [&_svg]:h-3.5 [&_svg]:w-3.5', tone)} aria-hidden>
      {icon}
    </span>
    <span className="min-w-0">
      <span className="block text-[11px] font-medium text-muted">{label}</span>
      <span className="block text-sm font-semibold text-fg tabular-nums">{value}</span>
    </span>
  </Card>
);

const days = (n: number | undefined) => `${n ?? 0} day${n === 1 ? '' : 's'}`;

/**
 * Card titles: the icon on a small soft-blue tile (a different light blue per card, the icon in a deeper shade of
 * it) and a plain black title. The month calendar's title changes, so it's matched by pattern.
 */
const TITLE_ICON: Record<string, { icon?: LucideIcon; tile: string }> = {
  "Today's Attendance": { icon: AlarmClock, tile: 'bg-blue-200 text-blue-700 dark:bg-blue-500/30 dark:text-blue-200' },
  "Today's Timeline": { icon: Clock3, tile: 'bg-sky-200 text-sky-700 dark:bg-sky-500/30 dark:text-sky-200' },
  'Attendance Verification': { icon: BadgeCheck, tile: 'bg-indigo-200 text-indigo-700 dark:bg-indigo-500/30 dark:text-indigo-200' },
  Statistics: { icon: BarChart3, tile: 'bg-sky-200 text-sky-700 dark:bg-sky-500/30 dark:text-sky-200' },
  "Today's Selfie": { icon: Camera, tile: 'bg-indigo-200 text-indigo-700 dark:bg-indigo-500/30 dark:text-indigo-200' },
  'Attendance Trend': { icon: TrendingUp, tile: 'bg-blue-200 text-blue-700 dark:bg-blue-500/30 dark:text-blue-200' },
  'Recent Activity': { icon: History, tile: 'bg-cyan-200 text-cyan-700 dark:bg-cyan-500/30 dark:text-cyan-200' },
};
const CALENDAR_ICON = { icon: CalendarDays, tile: 'bg-blue-200 text-blue-700 dark:bg-blue-500/30 dark:text-blue-200' };

const CardTitle = ({ title, right }: { icon?: ReactNode; title: string; right?: ReactNode }) => {
  const style = TITLE_ICON[title] ?? (/\d{4}$/.test(title) ? CALENDAR_ICON : { tile: '' });
  const Icon = style.icon;
  return (
    // Same header height as the dashboard cards (64px), with a line underneath.
    <div className="flex min-h-16 items-center justify-between gap-3 border-b border-line px-5 py-3.5">
      {/* Icon on a soft-blue tile + plain black title (no coloured pill behind the text). */}
      <h3 className="flex min-w-0 items-center gap-2.5 text-base font-semibold text-black dark:text-fg">
        {Icon ? (
          <span aria-hidden className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', style.tile)}>
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
        <span className="truncate">{title}</span>
      </h3>
      {right}
    </div>
  );
};

/** The clock-in selfie, fetched with auth (the file endpoint needs the session). */
const Selfie = ({ fileId, name, small = false }: { fileId: string | null | undefined; name: string; small?: boolean }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!fileId) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    setFailed(false);
    fetchObjectUrl(`/api/v1/files/${fileId}`)
      .then((u) => {
        objectUrl = u;
        if (!cancelled) setUrl(u);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);
  const box = cn('shrink-0 overflow-hidden ring-[#dbeafe] dark:ring-[#1d4ed8]/40', small ? 'h-14 w-14 rounded-xl ring-2' : 'h-24 w-24 rounded-2xl ring-4');
  if (!fileId || failed || !url) {
    return (
      <span className={cn(box, 'flex items-center justify-center bg-surface-2 text-muted')} aria-label={fileId ? 'Selfie loading' : 'No selfie'}>
        <Camera className="h-7 w-7" aria-hidden />
      </span>
    );
  }
  return (
    <button type="button" onClick={() => void openFile(`/files/${fileId}`)} className={box} aria-label={`Open ${name}'s check-in selfie`}>
      <img src={url} alt="" className="h-full w-full object-cover" />
    </button>
  );
};

/* ----------------------------- Main sections ---------------------------- */

const TodayCard = ({ t, worked }: { t: TodayState; worked: number }) => {
  const timeZone = useOrgTimezone();
  const confirm = useConfirm();
  const action = useClockAction();
  const flow = useClockFlow();
  const [pending, setPending] = useState<string | null>(null);
  const r = t.record;
  const expected = (t.shift.workingHours || 8) * 60;
  const pct = Math.min(100, (worked / expected) * 100);
  const busy = action.isPending || flow.busy;
  const status =
    t.state === 'NOT_CHECKED_IN' ? 'Not checked in' : t.state === 'ON_BREAK' ? 'On break' : t.state === 'CHECKED_OUT' ? 'Checked out' : 'Checked in';
  const statusTone =
    t.state === 'NOT_CHECKED_IN'
      ? 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200'
      : t.state === 'ON_BREAK'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200'
        : t.state === 'CHECKED_OUT'
          ? 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200'
          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200';
  const loc = r?.checkInLocation;
  const mapUrl = loc?.latitude != null && loc.longitude != null ? `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}` : null;

  const runBreak = async (key: 'break/start' | 'break/end', success: string) => {
    setPending(key);
    try {
      await action.mutateAsync({ action: key });
      toast.success(success);
    } catch {
      /* toasted globally */
    } finally {
      setPending(null);
    }
  };
  const checkOut = async () => {
    const { confirmed } = await confirm({
      title: 'Check out for today?',
      message: `You have worked ${minutesToHours(Math.floor(worked))} today. You won't be able to check in again today; use regularization for corrections.`,
      confirmLabel: 'Check out',
      tone: 'primary',
    });
    if (confirmed) await flow.run('check-out', { success: 'Checked out. Have a good evening!' });
  };

  return (
    <Card className="flex flex-col overflow-hidden">
      <CardTitle icon={<CalendarCheck className="h-4 w-4" />} title="Today's Attendance" right={<span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', statusTone)}>{status}</span>} />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-center gap-4">
          <Selfie fileId={r?.checkInPhotoId} name="Your" />
          <div className="min-w-0 space-y-1">
            <p className="text-2xl font-bold text-fg tabular-nums">{r?.checkIn ? formatTimeIn(r.checkIn, timeZone) : '--:--'}</p>
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{r?.checkIn ? `Checked in${r.isLate ? ` · ${minutesToHours(r.lateMinutes)} late` : ''}` : 'Not checked in yet'}</p>
            {r?.checkIn && (
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                <span className="inline-flex items-center gap-1">
                  {r.workMode === 'REMOTE' ? <MapPin className="h-3.5 w-3.5" aria-hidden /> : <Building2 className="h-3.5 w-3.5" aria-hidden />}
                  {r.workMode === 'REMOTE' ? 'Remote' : (place(loc) ?? 'Office')}
                </span>
                {mapUrl && (
                  <a href={mapUrl} target="_blank" rel="noreferrer" className="font-medium text-[#2563eb] hover:underline dark:text-[#dbeafe]">
                    View on map
                  </a>
                )}
              </p>
            )}
            {r?.checkInPhotoId && (
              <p className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Selfie verified
              </p>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-medium text-fg-2">Working hours</span>
            <span className="font-semibold text-fg tabular-nums">{`${hm(worked)} / ${t.shift.workingHours}h`}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-[#f1e2d3] dark:bg-white/10" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: RUST }} />
          </div>
        </div>

        <div className="mt-auto space-y-2">
          {/* No Check in button here — employees clock in from the Dashboard's Today card. */}
          {t.state === 'NOT_CHECKED_IN' && (
            <p className="rounded-xl bg-[#eff6ff] px-4 py-3 text-sm text-fg-2 dark:bg-[#1d4ed8]/15">
              Check in from your{' '}
              <Link to="/" className="font-semibold text-[#1d4ed8] hover:underline dark:text-[#dbeafe]">
                Dashboard
              </Link>
              .
            </p>
          )}
          {(t.state === 'CHECKED_IN' || t.state === 'ON_BREAK') && (
            // Breaks are a Super Admin setting; someone already on a break can always end it.
            <div className={cn('grid gap-2', (t.allowBreaks || t.state === 'ON_BREAK') && 'grid-cols-2')}>
              {t.state === 'ON_BREAK' ? (
                <Button variant="success" size="lg" className="h-12 w-full rounded-xl" icon={<Play className="h-5 w-5" />} loading={pending === 'break/end'} disabled={busy} onClick={() => runBreak('break/end', 'Welcome back!')}>
                  End break
                </Button>
              ) : t.allowBreaks ? (
                <Button variant="outline" size="lg" className="h-12 w-full rounded-xl" icon={<Coffee className="h-5 w-5" />} loading={pending === 'break/start'} disabled={busy} onClick={() => runBreak('break/start', 'Break started')}>
                  Break
                </Button>
              ) : null}
              <Button size="lg" className={cn('h-12 w-full rounded-xl', PRIMARY)} icon={<LogOut className="h-5 w-5" />} loading={flow.active === 'check-out'} disabled={busy} onClick={() => void checkOut()}>
                Check out
              </Button>
            </div>
          )}
          {t.state === 'CHECKED_OUT' && r && (
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
              Done for today — worked {minutesToHours(r.workingMinutes)}.
            </p>
          )}
          {flow.status && <p className="text-center text-xs text-muted" role="status">{flow.status}</p>}
          {flow.notice && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300" role="status">
              <MapPinOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {flow.notice}
            </p>
          )}
        </div>
      </div>
      {flow.selfieDialog}
    </Card>
  );
};

const Timeline = ({ r }: { r: AttendanceBase | null }) => {
  const timeZone = useOrgTimezone();
  const events: { at: string | null; title: string; sub: string; icon: ReactNode; tone: string }[] = [];
  if (r?.checkIn) events.push({ at: r.checkIn, title: 'Check in', sub: place(r.checkInLocation) ?? (r.workMode === 'REMOTE' ? 'Remote' : 'Office'), icon: <LogIn className="h-3.5 w-3.5" />, tone: 'bg-emerald-500' });
  for (const b of r?.breaks ?? []) {
    events.push({ at: b.start, title: 'Break start', sub: 'Break', icon: <Coffee className="h-3.5 w-3.5" />, tone: 'bg-amber-500' });
    if (b.end) events.push({ at: b.end, title: 'Break end', sub: 'Back to work', icon: <Play className="h-3.5 w-3.5" />, tone: 'bg-sky-500' });
  }
  events.push(
    r?.checkOut
      ? { at: r.checkOut, title: 'Check out', sub: place(r.checkOutLocation) ?? 'Done for the day', icon: <LogOut className="h-3.5 w-3.5" />, tone: 'bg-rose-500' }
      : { at: null, title: 'Check out', sub: 'Pending', icon: <LogOut className="h-3.5 w-3.5" />, tone: 'bg-slate-300 dark:bg-slate-600' },
  );
  return (
    <Card className="flex flex-col overflow-hidden">
      <CardTitle icon={<Clock3 className="h-4 w-4" />} title="Today's Timeline" />
      {!r?.checkIn ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted">
          <CircleDashed className="h-8 w-8" aria-hidden />
          Your check-in, breaks and check-out will appear here.
        </div>
      ) : (
        <ol className="flex-1 space-y-5 p-5">
          {events.map((e, i) => (
            <li key={i} className="relative flex gap-3">
              {i < events.length - 1 && <span className="absolute top-7 left-[13px] h-[calc(100%-4px)] w-0.5 bg-line" aria-hidden />}
              <span className={cn('relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white', e.tone)} aria-hidden>
                {e.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg">{e.title}</p>
                <p className="truncate text-xs text-muted">{e.sub}</p>
              </div>
              <span className={cn('shrink-0 text-sm tabular-nums', e.at ? 'font-medium text-fg' : 'text-muted')}>{e.at ? formatTimeIn(e.at, timeZone) : '--:--'}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
};

const Verification = ({ r }: { r: AttendanceBase | null }) => {
  const timeZone = useOrgTimezone();
  const loc = r?.checkInLocation;
  const hasMap = loc?.latitude != null && loc.longitude != null;
  const d = 0.004;
  const embed = hasMap
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${loc!.longitude! - d}%2C${loc!.latitude! - d}%2C${loc!.longitude! + d}%2C${loc!.latitude! + d}&layer=mapnik&marker=${loc!.latitude}%2C${loc!.longitude}`
    : null;
  const rows: { icon: ReactNode; label: string; value: string; ok?: boolean }[] = [
    { icon: <Camera className="h-4 w-4" />, label: 'Selfie', value: r?.checkInPhotoId ? 'Verified' : 'Not taken', ok: !!r?.checkInPhotoId },
    { icon: <MapPin className="h-4 w-4" />, label: 'Location', value: place(loc) ?? (r?.checkIn ? 'Not shared' : '—'), ok: !!loc?.latitude },
    { icon: <CalendarDays className="h-4 w-4" />, label: 'Date', value: r ? formatDate(r.date, 'dd MMM yyyy') : formatDate(new Date().toISOString(), 'dd MMM yyyy') },
    { icon: <Clock3 className="h-4 w-4" />, label: 'Time', value: r?.checkIn ? formatTimeIn(r.checkIn, timeZone) : '—' },
    {
      icon: r?.source === 'MOBILE' ? <Smartphone className="h-4 w-4" /> : <Monitor className="h-4 w-4" />,
      label: 'Device',
      value: !r?.checkIn ? '—' : r.source === 'MOBILE' ? 'Mobile app' : r.source === 'WEB' ? 'Web browser' : (r.source ?? '—'),
    },
  ];
  return (
    <Card className="flex flex-col overflow-hidden">
      <CardTitle icon={<BadgeCheck className="h-4 w-4" />} title="Attendance Verification" />
      <ul className="divide-y divide-line px-5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-3 py-2.5">
            <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TILE)} aria-hidden>
              {row.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-muted">{row.label}</span>
              <span className="block truncate text-sm font-medium text-fg">{row.value}</span>
            </span>
            {row.ok !== undefined &&
              (row.ok ? (
                <BadgeCheck className="h-5 w-5 shrink-0 text-emerald-600" aria-label="Verified" />
              ) : (
                <CircleSlash className="h-5 w-5 shrink-0 text-slate-400" aria-label="Not verified" />
              ))}
          </li>
        ))}
      </ul>
      {embed ? (
        <div className="m-4 mt-1 overflow-hidden rounded-xl border border-line">
          <iframe title="Check-in location map" src={embed} className="h-36 w-full" loading="lazy" />
          {loc?.address && <p className="truncate bg-surface-2 px-3 py-1.5 text-xs text-muted">{loc.address}</p>}
        </div>
      ) : null}
    </Card>
  );
};


/* ------------------------------ Insights row ----------------------------- */

type DayKindKey = 'PRESENT' | 'LATE' | 'ABSENT' | 'HALF_DAY' | 'LEAVE' | 'HOLIDAY' | 'WEEK_OFF';
const DAY_TONE: Record<DayKindKey, { label: string; cell: string; dot: string }> = {
  // Same colours as the employee dashboard's Attendance card: present navy, late light blue, leave aqua; absent red.
  PRESENT: { label: 'Present', cell: 'bg-[#1e3a8a] text-white', dot: 'bg-[#1e3a8a]' },
  LATE: { label: 'Late', cell: 'bg-blue-400 text-white', dot: 'bg-blue-400' },
  ABSENT: { label: 'Absent', cell: 'bg-rose-500 text-white', dot: 'bg-rose-500' },
  HALF_DAY: { label: 'Half day', cell: 'bg-violet-500 text-white', dot: 'bg-violet-500' },
  LEAVE: { label: 'Leave', cell: 'bg-cyan-400 text-white', dot: 'bg-cyan-400' },
  HOLIDAY: { label: 'Holiday', cell: 'bg-[#dbeafe] text-[#1d4ed8] dark:bg-[#1d4ed8]/30 dark:text-[#dbeafe]', dot: 'bg-[#bfdbfe]' },
  WEEK_OFF: { label: 'Week off', cell: 'bg-surface-2 text-muted', dot: 'bg-slate-300' },
};
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Month grid: each day coloured by attendance, leave or holiday. */
const MonthCard = ({ today }: { today: string }) => {
  const [month, setMonth] = useState(today.slice(0, 7));
  const from = `${month}-01`;
  const to = `${month}-${pad(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate())}`;
  const list = useAttendanceList({ scope: 'me', from, to, page: 1, limit: 31 });
  const holidays = useHolidays({ year: Number(month.slice(0, 4)) });
  const leaves = useLeaves({ scope: 'me', from, to, status: 'APPROVED', page: 1, limit: 50 });

  const kinds = useMemo(() => {
    const map = new Map<string, DayKindKey>();
    for (const h of holidays.data ?? []) if (h.date.startsWith(month)) map.set(h.date, 'HOLIDAY');
    for (const l of leaves.data?.data ?? []) {
      for (let d = l.startDate.slice(0, 10); d <= l.endDate.slice(0, 10) && d <= to; d = nextDay(d)) if (d >= from) map.set(d, 'LEAVE');
    }
    for (const r of list.data?.data ?? []) {
      const k = r.date.slice(0, 10);
      const st = r.status as string;
      const kind: DayKindKey | undefined =
        st === 'PRESENT' ? (r.isLate ? 'LATE' : 'PRESENT') : (['LATE', 'ABSENT', 'HALF_DAY', 'LEAVE', 'HOLIDAY', 'WEEK_OFF'] as string[]).includes(st) ? (st as DayKindKey) : st === 'WORK_FROM_HOME' ? 'PRESENT' : undefined;
      if (kind) map.set(k, kind);
    }
    return map;
  }, [list.data, holidays.data, leaves.data, month, from, to]);

  const lead = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7;
  const n = Number(to.slice(8));
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: n }, (_, i) => `${month}-${pad(i + 1)}`)];
  const shiftMonth = (by: number) => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const t = y * 12 + (m - 1) + by;
    setMonth(`${Math.floor(t / 12)}-${pad((t % 12) + 1)}`);
  };

  return (
    <Card className="overflow-hidden">
      <CardTitle
        icon={<CalendarDays className="h-4 w-4" />}
        title={formatKey(`${month}-01`, 'MMMM yyyy')}
        right={
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        }
      />
      <div className="px-4 py-3">
        <div className="grid grid-cols-7 gap-y-1 text-center">
          {WEEKDAYS.map((w, i) => (
            <span key={i} className="text-[11px] font-semibold text-muted">
              {w}
            </span>
          ))}
          {cells.map((d, i) => {
            if (!d) return <span key={`b${i}`} />;
            const k = kinds.get(d);
            return (
              <span
                key={d}
                title={k ? DAY_TONE[k].label : undefined}
                className={cn(
                  'mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                  k ? DAY_TONE[k].cell : d > today ? 'text-muted' : 'text-fg',
                  d === today && 'ring-2 ring-[#2563eb] ring-offset-1 ring-offset-surface',
                )}
              >
                {Number(d.slice(8))}
              </span>
            );
          })}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-2.5 gap-y-1 text-[10px] text-muted">
          {(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE', 'HOLIDAY'] as DayKindKey[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className={cn('h-2 w-2 rounded-full', DAY_TONE[k].dot)} aria-hidden />
              {DAY_TONE[k].label}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
};

const SelfieCard = ({ r }: { r: AttendanceBase | null }) => {
  const timeZone = useOrgTimezone();
  return (
    <Card className="flex flex-col overflow-hidden">
      <CardTitle icon={<Camera className="h-4 w-4" />} title="Today's Selfie" />
      <div className="flex flex-1 items-center gap-3 px-4 py-3">
        <Selfie fileId={r?.checkInPhotoId} name="Your" small />
        <div className="min-w-0 space-y-0.5">
          <p className="text-lg font-bold text-fg tabular-nums">{r?.checkIn ? formatTimeIn(r.checkIn, timeZone) : '--:--'}</p>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{r?.checkIn ? 'Checked in' : 'No selfie yet today'}</p>
          {r?.checkIn && <p className="truncate text-xs text-muted">{place(r.checkInLocation) ?? (r.workMode === 'REMOTE' ? 'Remote' : 'Office')}</p>}
          {r?.checkInPhotoId && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              <BadgeCheck className="h-3 w-3" aria-hidden /> Verified
            </span>
          )}
        </div>
      </div>
    </Card>
  );
};

type Period = 1 | 3 | 6;

/** Coloured bars for the chosen period (this month / last 3 / last 6 months). */
const StatisticsCard = ({ today }: { today: string }) => {
  const [period, setPeriod] = useState<Period>(1);
  const from = monthBounds(today, -(period - 1)).from;
  const q = useAttendanceSummary({ from, to: today, scope: 'me' });
  const r = q.data?.employees[0];
  const counted = r ? r.present + r.absent + r.halfDay + r.leave : 0;
  const pct = (n: number) => (counted ? Math.round((n / counted) * 100) : 0);
  const rows: { label: string; value: number; display: string; color: string; share: number }[] = r
    ? [
        { label: 'Present', value: r.present, display: days(r.present), color: '#1e3a8a', share: pct(r.present) },
        { label: 'Absent', value: r.absent, display: days(r.absent), color: '#f43f5e', share: pct(r.absent) },
        { label: 'Late', value: r.late, display: days(r.late), color: '#60a5fa', share: pct(r.late) },
        { label: 'Half day', value: r.halfDay, display: days(r.halfDay), color: '#8b5cf6', share: pct(r.halfDay) },
        { label: 'Leave', value: r.leave, display: days(r.leave), color: '#22d3ee', share: pct(r.leave) },
        { label: 'Overtime', value: r.overtimeHours, display: `${r.overtimeHours} h`, color: '#a9b0fb', share: Math.min(100, Math.round((r.overtimeHours / Math.max(1, r.totalWorkingHours)) * 100)) },
      ]
    : [];
  return (
    <Card className="overflow-hidden">
      <CardTitle
        icon={<BarChart3 className="h-4 w-4" />}
        title="Statistics"
        right={
          <div role="radiogroup" aria-label="Period" className="flex shrink-0 rounded-lg bg-surface-2 p-0.5 text-[11px] font-medium whitespace-nowrap">
            {([1, 3, 6] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={period === p}
                onClick={() => setPeriod(p)}
                aria-label={p === 1 ? 'This month' : `Last ${p} months`}
                className={cn('rounded-md px-2 py-0.5', period === p ? cn('shadow-sm', TILE) : 'text-muted hover:text-fg')}
              >
                {p === 1 ? 'Month' : `${p}M`}
              </button>
            ))}
          </div>
        }
      />
      <div className="space-y-2 px-4 py-3">
        {q.isLoading ? (
          <Skeleton className="h-32" />
        ) : !rows.length ? (
          <p className="py-6 text-center text-sm text-muted">No attendance in this period yet.</p>
        ) : (
          rows.map((row) => (
            <div key={row.label} className="flex items-center gap-2.5 text-[13px]">
              <span className="flex w-20 shrink-0 items-center gap-1.5 text-fg-2">
                <span className="h-2 w-2 rounded-full" style={{ background: row.color }} aria-hidden />
                {row.label}
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <span className="block h-full rounded-full" style={{ width: `${row.share}%`, background: row.color }} />
              </span>
              <span className="w-14 shrink-0 text-right font-medium text-fg tabular-nums">{row.display}</span>
              <span className="w-9 shrink-0 text-right text-[11px] text-muted tabular-nums">{`${row.share}%`}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
};

/** Average hours worked per week of the month. */
const TrendCard = ({ today }: { today: string }) => {
  const { from, to } = monthBounds(today, 0);
  const q = useAttendanceList({ scope: 'me', from, to, page: 1, limit: 31 });
  const data = useMemo(() => {
    const weeks = new Map<number, { minutes: number; days: number }>();
    for (const r of q.data?.data ?? []) {
      if (!r.workingMinutes) continue;
      const w = Math.ceil(Number(r.date.slice(8, 10)) / 7);
      const cur = weeks.get(w) ?? { minutes: 0, days: 0 };
      weeks.set(w, { minutes: cur.minutes + r.workingMinutes, days: cur.days + 1 });
    }
    const last = Math.ceil(Number(to.slice(8)) / 7);
    return Array.from({ length: Math.max(1, last) }, (_, i) => {
      const v = weeks.get(i + 1);
      return { week: `W${i + 1}`, hours: v ? Math.round((v.minutes / 60 / v.days) * 10) / 10 : 0 };
    });
  }, [q.data, to]);
  return (
    <Card className="flex flex-col overflow-hidden">
      <CardTitle icon={<LineChartIcon className="h-4 w-4" />} title="Attendance Trend" right={<span className="text-xs text-muted">Avg hours / day · this month</span>} />
      <div className="min-h-32 flex-1 px-3 py-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-line" vertical={false} />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} stroke="currentColor" className="text-muted" tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11 }} stroke="currentColor" className="text-muted" tickLine={false} axisLine={false} domain={[0, 'dataMax + 1']} />
            <Tooltip formatter={(v: number) => [`${v} h`, 'Avg hours']} />
            <Line type="monotone" dataKey="hours" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3.5, fill: '#f59e0b' }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
};

const ACT_ICON: Record<string, { icon: ReactNode; tone: string }> = {
  CLOCK_IN: { icon: <LogIn className="h-4 w-4" />, tone: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  CLOCK_OUT: { icon: <LogOut className="h-4 w-4" />, tone: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' },
  LEAVE_APPLIED: { icon: <Umbrella className="h-4 w-4" />, tone: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300' },
  LEAVE_APPROVED: { icon: <BadgeCheck className="h-4 w-4" />, tone: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
};

const RecentActivityCard = ({ r }: { r: AttendanceBase | null }) => {
  const timeZone = useOrgTimezone();
  const feed = useActivityFeed('me', 5);
  // Today's breaks are not in the feed; merge them in.
  const items = [
    ...(feed.data ?? []).map((a) => ({ key: a.id, at: a.at, title: `You ${a.title}`, detail: a.detail, ...(ACT_ICON[a.type] ?? { icon: <Activity className="h-4 w-4" />, tone: TILE }) })),
    ...(r?.breaks ?? []).flatMap((b, i) => [
      { key: `bs${i}`, at: b.start, title: 'Break started', detail: undefined, icon: <Coffee className="h-4 w-4" />, tone: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300' },
      ...(b.end ? [{ key: `be${i}`, at: b.end, title: 'Break ended', detail: undefined, icon: <Play className="h-4 w-4" />, tone: 'bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' }] : []),
    ]),
  ]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 5);
  return (
    <Card className="overflow-hidden">
      <CardTitle icon={<Activity className="h-4 w-4" />} title="Recent Activity" />
      {feed.isLoading ? (
        <div className="p-4">
          <Skeleton className="h-32" />
        </div>
      ) : !items.length ? (
        <p className="p-6 text-center text-sm text-muted">Your check-ins, breaks and leave show up here.</p>
      ) : (
        <ul className="divide-y divide-line px-4">
          {items.map((a) => (
            <li key={a.key} className="flex items-center gap-3 py-2.5">
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', a.tone)} aria-hidden>
                {a.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{a.title}</span>
                {a.detail ? <span className="block truncate text-xs text-muted">{a.detail}</span> : null}
              </span>
              <span className="shrink-0 text-right text-xs text-muted tabular-nums">
                {formatTimeIn(a.at, timeZone)}
                <span className="block">{formatDate(a.at, 'dd MMM')}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

/* ------------------------------- Dashboard ------------------------------ */

/** Employee attendance dashboard: month stats, today's attendance with selfie, timeline and verification. */
export const MyAttendanceDashboard = () => {
  const timeZone = useOrgTimezone();
  const today = dateKeyIn(timeZone);
  const now = useNow(30_000);
  const t = useToday();
  const thisMonth = monthBounds(today, 0);
  const lastMonth = monthBounds(today, -1);
  const cur = useAttendanceSummary({ ...thisMonth, scope: 'me' });
  const prev = useAttendanceSummary({ ...lastMonth, scope: 'me' });
  const dash = useEmployeeDashboard();

  if (t.isLoading || !t.data) {
    return (
      <div className="space-y-4" aria-busy>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  const day = t.data;
  const worked = liveWorked(day, now);
  const c = cur.data?.employees[0];
  const p = prev.data?.employees[0];
  const curRate = rate(c);
  const prevRate = rate(p);
  const delta = curRate != null && prevRate != null ? curRate - prevRate : null;
  const balances = (dash.data?.leaveBalances ?? []).filter((b) => !b.leaveType.isWorkFromHome);
  const leaveLeft = balances.reduce((s, b) => s + b.remaining, 0);
  const leaveTotal = balances.reduce((s, b) => s + b.allocated + b.carryForward, 0);

  return (
    <div className="space-y-4">
      {/* Month at a glance */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="flex items-center gap-4 bg-gradient-to-br from-[#dbeafe] via-[#eff6ff] to-surface p-4 dark:from-[#1d4ed8]/25 dark:via-[#1d4ed8]/10">
          <Ring pct={curRate ?? 0} />
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted">Attendance</p>
            <p className="text-base font-semibold text-fg">This month</p>
            {delta != null ? (
              <p className={cn('mt-0.5 inline-flex items-center gap-1 text-xs font-semibold', delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                {delta >= 0 ? <TrendingUp className="h-3.5 w-3.5" aria-hidden /> : <TrendingDown className="h-3.5 w-3.5" aria-hidden />}
                {`${Math.abs(delta)}% vs last month`}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-muted">{curRate == null ? 'No working days yet' : 'No data for last month'}</p>
            )}
          </div>
        </Card>
        <BigStat
          icon={<Timer className="h-5 w-5" />}
          iconTone="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
          label="Working hours · today"
          value={hm(worked)}
          sub={`Expected ${day.shift.workingHours}h`}
        />
        <BigStat
          icon={<AlarmClock className="h-5 w-5" />}
          iconTone="bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300"
          label="Late days · this month"
          value={c?.late ?? 0}
          sub={`Last month ${p?.late ?? 0}`}
        />
        <BigStat
          icon={<Umbrella className="h-5 w-5" />}
          iconTone="bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"
          label="Leave remaining"
          value={`${leaveLeft} day${leaveLeft === 1 ? '' : 's'}`}
          sub={`Total ${leaveTotal} days`}
        />
      </div>

      {/* Left (3 cols): small stats, then Today + Timeline. Right column: Verification, under Leave remaining. */}
      <div className="grid gap-4 xl:grid-cols-4">
        <div className="space-y-4 xl:col-span-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SmallStat icon={<UserCheck />} tone="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" label="Present" value={days(c?.present)} />
            <SmallStat icon={<UserX />} tone="bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300" label="Absent" value={days(c?.absent)} />
            <SmallStat icon={<Hourglass />} tone="bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300" label="Half days" value={days(c?.halfDay)} />
            <SmallStat
              icon={<Clock3 />}
              tone="bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300"
              label="Overtime"
              value={`${c?.overtimeHours ?? 0} hour${c?.overtimeHours === 1 ? '' : 's'}`}
            />
          </div>
          {/* Today's Attendance | Timeline, with the month calendar | statistics directly below them. */}
          <div className="grid gap-4 md:grid-cols-2">
            <TodayCard t={day} worked={worked} />
            <Timeline r={day.record} />
            <MonthCard today={today} />
            <StatisticsCard today={today} />
          </div>
        </div>
        <Verification r={day.record} />
      </div>

      {/* Selfie · trend · recent activity + quick actions */}
      {/* Same top and bottom line for all three. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SelfieCard r={day.record} />
        <TrendCard today={today} />
        <RecentActivityCard r={day.record} />
      </div>
    </div>
  );
};
