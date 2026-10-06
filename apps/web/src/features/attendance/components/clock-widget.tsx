import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlarmClock, Building2, Camera, Coffee, Home, Hourglass, Loader2, LogIn, LogOut, MapPin, MapPinOff, PartyPopper, Play, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Card, ErrorState, Skeleton, type Tone } from '@/components/ui/display';
import { useConfirm } from '@/components/ui/overlay';
import { minutesToHours, cn } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { dashboardKind } from '@/features/dashboard/lib';
import { useClockAction, useToday, type LiveState, type TodayState, type WorkMode } from '../api';
import { formatClock, formatTimeIn, useNow, useOrgTimezone } from '../lib';
import { useClockFlow } from '../use-clock-flow';

const STATE_META: Record<LiveState, { label: string; tone: Tone }> = {
  NOT_CHECKED_IN: { label: 'Not clocked in', tone: 'gray' },
  CHECKED_IN: { label: 'Working', tone: 'green' },
  ON_BREAK: { label: 'On break', tone: 'amber' },
  CHECKED_OUT: { label: 'Clocked out', tone: 'blue' },
};

/** Live worked / break seconds computed from the record's instants. */
const liveSeconds = (today: TodayState, now: Date) => {
  const r = today.record;
  if (!r?.checkIn) return { worked: 0, onBreak: 0 };
  if (r.checkOut) return { worked: r.workingMinutes * 60, onBreak: r.breakMinutes * 60 };
  const start = new Date(r.checkIn).getTime();
  let breakMs = 0;
  for (const b of r.breaks) {
    const s = new Date(b.start).getTime();
    const e = b.end ? new Date(b.end).getTime() : now.getTime();
    if (e > s) breakMs += e - s;
  }
  return { worked: Math.max(0, (now.getTime() - start - breakMs) / 1000), onBreak: breakMs / 1000 };
};

/** Role colours: brown for employees, violet for the admin, the app's brand for everyone else. */
const ACCENTS = {
  employee: {
    panel: 'from-[#dbeafe] via-[#eff6ff] to-surface dark:from-[#1d4ed8]/25 dark:via-[#1d4ed8]/10',
    ring: '#2563eb',
    track: '#ecdccb',
    tile: 'bg-[#dbeafe] text-[#1d4ed8] dark:bg-[#1d4ed8]/25 dark:text-[#dbeafe]',
    primary: 'bg-[#2563eb] text-white hover:bg-[#1d4ed8]',
  },
  head: {
    panel: 'from-violet-100 via-violet-50 to-surface dark:from-violet-500/20 dark:via-violet-500/5',
    ring: '#7c3aed',
    track: '#ede9fe',
    tile: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200',
    primary: 'bg-violet-600 text-white hover:bg-violet-700',
  },
  hr: {
    panel: 'from-brand-50 via-surface to-surface dark:from-brand-500/10',
    ring: '#4f46e5',
    track: '#e0e7ff',
    tile: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200',
    primary: 'bg-brand-600 text-white hover:bg-brand-700',
  },
} as const;

const Metric = ({ label, value, icon, tile, accent }: { label: string; value: string; icon: ReactNode; tile: string; accent?: string }) => (
  <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tile)} aria-hidden>
      {icon}
    </span>
    <span className="min-w-0">
      <span className="block text-[11px] font-medium tracking-wide text-muted uppercase">{label}</span>
      <span className={cn('block text-base font-semibold tabular-nums text-fg', accent)}>{value}</span>
    </span>
  </div>
);

/** Circular progress toward the shift's working hours, with the worked time in the middle. */
const Ring = ({ pct, color, track, children }: { pct: number; color: string; track: string; children: ReactNode }) => {
  const r = 78;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative h-48 w-48 shrink-0">
      <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="90" cy="90" r={r} fill="none" stroke={track} strokeWidth="12" className="dark:opacity-30" />
        <circle
          cx="90"
          cy="90"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (p / 100) * c}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
};

export const ClockWidget = () => {
  const today = useToday();
  const action = useClockAction();
  const confirm = useConfirm();
  const timeZone = useOrgTimezone();
  const now = useNow(1000);
  const [mode, setMode] = useState<WorkMode>('OFFICE');
  const flow = useClockFlow();
  const [pending, setPending] = useState<string | null>(null);
  const { user } = usePermissions();
  const accent = ACCENTS[dashboardKind(user?.roles)];

  const clockFmt = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(undefined, { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    } catch {
      return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    }
  }, [timeZone]);
  const dateFmt = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'long', day: 'numeric', month: 'long' });
    } catch {
      return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    }
  }, [timeZone]);

  if (today.isLoading) {
    return (
      <Card className="p-5" aria-busy>
        <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-14 w-56" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-14" />
          </div>
        </div>
      </Card>
    );
  }
  if (today.error || !today.data) {
    return <ErrorState className="card" title="Could not load today's attendance" message={today.error?.message} onRetry={() => today.refetch()} />;
  }

  const t = today.data;
  const r = t.record;
  const { worked, onBreak } = liveSeconds(t, now);
  const shiftSeconds = (t.shift.workingHours || 8) * 3600;
  const progress = (worked / shiftSeconds) * 100;
  const meta = STATE_META[t.state];
  const graceEnd = new Date(t.shiftStart).getTime() + t.shift.gracePeriodMinutes * 60_000;
  const runningLate = t.state === 'NOT_CHECKED_IN' && t.dayKind === 'WORKING' && !t.shift.flexible && now.getTime() > graceEnd && now.getTime() < new Date(t.shiftEnd).getTime();
  const busy = action.isPending || flow.busy;

  const runBreak = async (key: 'break/start' | 'break/end', success: string) => {
    setPending(key);
    try {
      await action.mutateAsync({ action: key });
      toast.success(success);
    } catch {
      /* errors are toasted globally */
    } finally {
      setPending(null);
    }
  };

  const onClockIn = () => flow.run('check-in', { workMode: mode, success: 'Clocked in. Have a productive day!' });

  const onClockOut = async () => {
    const { confirmed } = await confirm({
      title: 'Clock out for today?',
      message: `You have worked ${minutesToHours(Math.floor(worked / 60))} today. You won't be able to clock in again today; use regularization for corrections.`,
      confirmLabel: 'Clock out',
      tone: 'primary',
    });
    if (confirmed) await flow.run('check-out', { success: 'Clocked out. Have a good evening!' });
  };

  const captureHint = t.requireSelfie
    ? `Clocking in needs a selfie${t.requireLocation ? ' and your location' : ''}.`
    : t.requireLocation
      ? 'Clocking in needs your location.'
      : '';

  const bigBtn = 'h-12 w-full rounded-xl text-base';
  const remaining = Math.max(0, shiftSeconds - worked);

  return (
    <Card className="overflow-hidden">
      <div className="grid lg:grid-cols-[auto_1fr]">
        {/* Progress ring */}
        <div className={cn('flex flex-col items-center justify-center gap-3 border-b border-line bg-gradient-to-br px-8 py-7 lg:border-r lg:border-b-0', accent.panel)}>
          <Ring pct={progress} color={accent.ring} track={accent.track}>
            <span className="text-[11px] font-medium tracking-wide text-muted uppercase">Worked today</span>
            <span className={cn('mt-1 text-2xl font-bold tabular-nums text-fg', t.state === 'ON_BREAK' && 'text-amber-600 dark:text-amber-400')}>
              {t.state === 'NOT_CHECKED_IN' ? '00:00:00' : formatClock(worked)}
            </span>
            <span className="mt-0.5 text-xs text-muted tabular-nums">{`${Math.min(100, Math.round(progress))}% of ${t.shift.workingHours}h`}</span>
          </Ring>
          <Badge tone={meta.tone} dot>
            {meta.label}
          </Badge>
        </div>

        {/* Live time, shift, stats and actions */}
        <div className="space-y-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-4xl font-bold tracking-tight text-fg tabular-nums sm:text-5xl" aria-live="off">
                <time dateTime={now.toISOString()}>{clockFmt.format(now)}</time>
              </p>
              <p className="mt-1 text-sm text-muted">
                {dateFmt.format(now)} · <span className="whitespace-nowrap">{timeZone}</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {r?.isLate && (
                <Badge tone="amber">
                  <AlarmClock className="h-3 w-3" aria-hidden />
                  Late by {minutesToHours(r.lateMinutes)}
                </Badge>
              )}
              {r?.checkIn && (
                <Badge tone={r.workMode === 'REMOTE' ? 'blue' : 'gray'}>
                  {r.workMode === 'REMOTE' ? <Home className="h-3 w-3" aria-hidden /> : <Building2 className="h-3 w-3" aria-hidden />}
                  {r.workMode === 'REMOTE' ? 'Remote' : 'Office'}
                </Badge>
              )}
            </div>
          </div>

          {/* Shift */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-surface-2 px-4 py-2.5 text-sm text-fg-2">
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.shift.color }} aria-hidden />
              <span className="font-semibold text-fg">{t.shift.name}</span>
            </span>
            <span className="tabular-nums">
              {formatTimeIn(t.shiftStart, timeZone)} – {formatTimeIn(t.shiftEnd, timeZone)}
              {t.shift.nightShift && <span className="text-muted"> (next day)</span>}
            </span>
            {t.shift.gracePeriodMinutes > 0 && !t.shift.flexible && <span className="text-xs text-muted">{t.shift.gracePeriodMinutes} min grace</span>}
            {t.shift.flexible && <Badge tone="teal">Flexible</Badge>}
            {t.dayKind !== 'WORKING' && (
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-300">
                {t.dayKind === 'HOLIDAY' ? <PartyPopper className="h-3.5 w-3.5" aria-hidden /> : <Sun className="h-3.5 w-3.5" aria-hidden />}
                {t.dayKind === 'HOLIDAY' ? `Holiday${t.holiday ? `: ${t.holiday}` : ''}` : 'Week off today'}
              </span>
            )}
          </div>
          {runningLate && (
            <p role="status" className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
              <AlarmClock className="h-4 w-4" aria-hidden />
              Your shift started at {formatTimeIn(t.shiftStart, timeZone)} — clocking in now will be marked late.
            </p>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Metric label="Clock in" icon={<LogIn className="h-4 w-4" />} tile={accent.tile} value={r?.checkIn ? formatTimeIn(r.checkIn, timeZone) : '—'} />
            <Metric label="Clock out" icon={<LogOut className="h-4 w-4" />} tile={accent.tile} value={r?.checkOut ? formatTimeIn(r.checkOut, timeZone) : '—'} />
            <Metric
              label="Break"
              icon={<Coffee className="h-4 w-4" />}
              tile={accent.tile}
              value={formatClock(onBreak)}
              accent={t.state === 'ON_BREAK' ? 'text-amber-600 dark:text-amber-400' : undefined}
            />
            <Metric
              label={worked >= shiftSeconds ? 'Overtime' : 'Time left'}
              icon={<Hourglass className="h-4 w-4" />}
              tile={accent.tile}
              value={t.state === 'NOT_CHECKED_IN' ? `${t.shift.workingHours}h` : worked >= shiftSeconds ? formatClock(worked - shiftSeconds) : formatClock(remaining)}
              accent={worked >= shiftSeconds ? 'text-emerald-600 dark:text-emerald-400' : undefined}
            />
          </div>

          {t.state === 'NOT_CHECKED_IN' && (
            <div className="space-y-3">
              {t.allowRemoteClockIn && (
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-fg">Where are you working today?</legend>
                  <div role="radiogroup" aria-label="Work mode" className="grid grid-cols-2 gap-2">
                    {(['OFFICE', 'REMOTE'] as const).map((m) => {
                      const selected = mode === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setMode(m)}
                          onKeyDown={(e) => {
                            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                              e.preventDefault();
                              setMode(m === 'OFFICE' ? 'REMOTE' : 'OFFICE');
                            }
                          }}
                          tabIndex={selected ? 0 : -1}
                          className={cn(
                            'flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-colors',
                            selected ? cn('border-transparent ring-2 ring-offset-1 ring-offset-surface', accent.tile) : 'border-line-strong bg-surface text-fg-2 hover:bg-surface-2',
                          )}
                        >
                          {m === 'OFFICE' ? <Building2 className="h-4 w-4" aria-hidden /> : <Home className="h-4 w-4" aria-hidden />}
                          {m === 'OFFICE' ? 'Office' : 'Remote'}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              <Button size="lg" className={cn(bigBtn, 'bg-emerald-600 text-white hover:bg-emerald-700')} icon={<LogIn className="h-5 w-5" />} loading={flow.active === 'check-in'} disabled={busy} onClick={onClockIn}>
                Clock in
              </Button>
              <p className="flex items-center gap-1.5 text-xs text-muted">
                {t.requireSelfie ? <Camera className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                {captureHint || 'Your location is requested when you clock in and out (if permitted).'}
              </p>
            </div>
          )}

          {(t.state === 'CHECKED_IN' || t.state === 'ON_BREAK') && (
            <div className="grid gap-2 sm:grid-cols-2">
              {t.state === 'CHECKED_IN' ? (
                <Button variant="outline" size="lg" className={cn(bigBtn, 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200')} icon={<Coffee className="h-5 w-5" />} loading={pending === 'break/start'} disabled={busy} onClick={() => runBreak('break/start', 'Break started')}>
                  Start break
                </Button>
              ) : (
                <Button size="lg" className={cn(bigBtn, 'bg-amber-500 text-white hover:bg-amber-600')} icon={<Play className="h-5 w-5" />} loading={pending === 'break/end'} disabled={busy} onClick={() => runBreak('break/end', 'Welcome back!')}>
                  End break
                </Button>
              )}
              <Button size="lg" className={cn(bigBtn, 'bg-rose-600 text-white hover:bg-rose-700')} icon={<LogOut className="h-5 w-5" />} loading={flow.active === 'check-out'} disabled={busy} onClick={onClockOut}>
                Clock out
              </Button>
            </div>
          )}

          {t.state === 'CHECKED_OUT' && r && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
              <p className="font-medium">You're done for today.</p>
              <p className="mt-0.5">
                Worked {minutesToHours(r.workingMinutes)} · Break {minutesToHours(r.breakMinutes)}
                {r.isEarlyDeparture ? ` · Left ${minutesToHours(r.earlyDepartureMinutes)} early` : ''}
                {r.overtimeMinutes > 0 ? ` · Overtime ${minutesToHours(r.overtimeMinutes)}` : ''}. Something wrong?{' '}
                <Link to={`/regularization?date=${t.date}`} className="font-medium underline">
                  Request a correction
                </Link>
              </p>
            </div>
          )}

          <p role="status" aria-live="polite" className={cn('flex items-center gap-1.5 text-sm text-fg-2', !flow.status && 'sr-only')}>
            {flow.status && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {flow.status}
          </p>

          {flow.notice && (
            <p role="status" className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
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
