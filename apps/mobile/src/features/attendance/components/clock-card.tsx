import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import {
  AlarmClock,
  Building2,
  Camera,
  CheckCircle2,
  Coffee,
  Home,
  LogIn,
  LogOut,
  MapPin,
  MapPinOff,
  PartyPopper,
  Play,
  Sun,
  Timer,
} from 'lucide-react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import {
  Badge,
  Blink,
  Button,
  Card,
  ErrorState,
  GradientCard,
  Notice,
  PopIn,
  PulseRing,
  ProgressBar,
  Segmented,
  Skeleton,
  Text,
  toast,
  useConfirm,
  type ButtonColors,
  type IconComponent,
} from '@/components';
import { toApiError } from '@/lib/api';
import { dashboardKind, useAuth, type DashboardKind } from '@/lib/auth';
import { formatClock, formatClockTimeIn, formatKey, formatTimeIn, minutesToHours, useNow } from '@/lib/time';
import { radius, space, toneColors, useTheme, withAlpha, type Tone } from '@/theme';
import { useClockAction, useToday, type LiveState, type TodayState, type WorkMode } from '../api';
import { useClockFlow } from '../use-clock-flow';

const STATE_META: Record<LiveState, { label: string; tone: Tone }> = {
  NOT_CHECKED_IN: { label: 'Not checked in', tone: 'gray' },
  CHECKED_IN: { label: 'Working', tone: 'green' },
  ON_BREAK: { label: 'On break', tone: 'amber' },
  CHECKED_OUT: { label: 'Checked out', tone: 'blue' },
};

/** Soft card background per status (white fading into the status colour). */
const CARD_TINTS: Record<LiveState, Record<'light' | 'dark', [string, string]>> = {
  NOT_CHECKED_IN: { light: ['#ffffff', '#eef0ff'], dark: ['#171a2b', '#1f1a3a'] },
  CHECKED_IN: { light: ['#ffffff', '#e7f8f0'], dark: ['#131f1b', '#0f2a22'] },
  ON_BREAK: { light: ['#ffffff', '#fdf3dc'], dark: ['#1f1b12', '#2e2410'] },
  CHECKED_OUT: { light: ['#ffffff', '#e8f1fd'], dark: ['#131a24', '#10233a'] },
};

/**
 * Clock in / out button colours, the same as the website's Today card for each dashboard:
 * Employee light grey / dark navy, HR lilac / deep purple, Super Admin and Admin green / red.
 * The `Done` sets are the soft look once that step is recorded ("In · 09:30").
 */
const clockColors = (kind: DashboardKind, dark: boolean): Record<'in' | 'inDone' | 'out' | 'outDone', ButtonColors> => {
  // [light bg, light border, light text], then the hue tinted in dark mode with its light text.
  const done = ([bg, border, fg]: [string, string, string], hue: string, darkFg: string): ButtonColors =>
    dark ? { bg: withAlpha(hue, 0.15), border: withAlpha(hue, 0.3), fg: darkFg, solid: true } : { bg, border, fg, solid: true };
  if (kind === 'employee') {
    return {
      in: dark
        ? { bg: withAlpha('#64748b', 0.25), border: withAlpha('#64748b', 0.4), fg: '#f1f5f9', pressed: withAlpha('#64748b', 0.4) }
        : { bg: '#e2e8f0', border: '#cbd5e1', fg: '#0f172a', pressed: '#cbd5e1' },
      inDone: done(['#f1f5f9', '#e2e8f0', '#1e293b'], '#64748b', '#e2e8f0'),
      out: { bg: '#1e3a8a', border: '#1e3a8a', fg: '#ffffff', pressed: '#172f70', solid: true },
      outDone: done(['#eff6ff', '#bfdbfe', '#1e3a8a'], '#3b82f6', '#bfdbfe'),
    };
  }
  if (kind === 'hr') {
    return {
      in: { bg: '#ddd6fe', border: '#c4b5fd', fg: '#000000', pressed: '#c4b5fd' },
      inDone: done(['#f5f3ff', '#ddd6fe', '#4c1d95'], '#8b5cf6', '#ddd6fe'),
      out: { bg: '#7e22ce', border: '#7e22ce', fg: '#ffffff', pressed: '#6b21a8', solid: true },
      outDone: done(['#faf5ff', '#e9d5ff', '#581c87'], '#a855f7', '#e9d5ff'),
    };
  }
  return {
    in: { bg: '#059669', border: '#059669', fg: '#ffffff', pressed: '#047857' },
    inDone: done(['#ecfdf5', '#a7f3d0', '#065f46'], '#10b981', '#a7f3d0'),
    out: { bg: '#e11d48', border: '#e11d48', fg: '#ffffff', pressed: '#be123c' },
    outDone: done(['#fff1f2', '#fecdd3', '#9f1239'], '#f43f5e', '#fecdd3'),
  };
};

/** The coloured part of the day bar: grows in on open, then a light sheen sweeps across it. */
const TimelineFill = ({ to, colors }: { to: number; colors: [string, string, string] }) => {
  const w = useSharedValue(0);
  const sheen = useSharedValue(0);
  useEffect(() => {
    w.value = withTiming(to, { duration: 1100, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System });
  }, [to, w]);
  useEffect(() => {
    sheen.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.quad), reduceMotion: ReduceMotion.System }), -1, false);
  }, [sheen]);
  const fill = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  const sweep = useAnimatedStyle(() => ({ left: `${-40 + sheen.value * 160}%` }));
  return (
    <Animated.View style={[styles.tlFill, fill]}>
      <GradientCard colors={colors} radius={5} style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.tlSheen, sweep]} />
      </GradientCard>
    </Animated.View>
  );
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

const Metric = ({ label, value, icon: Icon, color }: { label: string; value: string; icon: IconComponent; color?: string }) => {
  const { c } = useTheme();
  return (
    <View
      style={[styles.metric, { backgroundColor: c.surface2, borderColor: c.line }]}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <View style={styles.metricLabel}>
        <Icon size={14} color={c.muted} />
        <Text size="xs" weight="medium" color="muted" style={styles.upper}>
          {label}
        </Text>
      </View>
      <Text size="lg" weight="semibold" tabular style={color ? { color } : undefined}>
        {value}
      </Text>
    </View>
  );
};

const ClockSkeleton = () => (
  <Card style={styles.gap}>
    <Skeleton width={120} height={20} />
    <Skeleton width={200} height={44} />
    <Skeleton width={180} height={14} />
    <View style={styles.grid}>
      <Skeleton width="48%" height={64} />
      <Skeleton width="48%" height={64} />
    </View>
    <Skeleton height={52} />
  </Card>
);

/**
 * Today's attendance: live clock in the organization timezone, shift window,
 * status badges, worked/break timers and the clock in → break → clock out actions.
 * `compact` is the Home screen variant.
 */
export const ClockCard = ({ compact, hero }: { compact?: boolean; /** Home: the "Today's Overview" highlight card in the role's colour. */ hero?: boolean }) => {
  const { c, scheme } = useTheme();
  const { timeZone, user } = useAuth();
  const kind = dashboardKind(user?.roles);
  const tones = clockColors(kind, c.scheme === 'dark');
  const today = useToday();
  const breakAction = useClockAction();
  const confirm = useConfirm();
  const flow = useClockFlow();
  const now = useNow(1000);
  const [mode, setMode] = useState<WorkMode>('OFFICE');
  const [pendingBreak, setPendingBreak] = useState<'break/start' | 'break/end' | null>(null);

  if (today.isLoading) return <ClockSkeleton />;
  if (today.error || !today.data) {
    return (
      <Card>
        <ErrorState compact title="Could not load today’s attendance" error={today.error} onRetry={() => void today.refetch()} />
      </Card>
    );
  }

  const t = today.data;
  const r = t.record;
  const { worked, onBreak } = liveSeconds(t, now);
  const shiftSeconds = (t.shift.workingHours || 8) * 3600;
  const progress = (worked / shiftSeconds) * 100;
  const meta = STATE_META[t.state];
  const graceEnd = new Date(t.shiftStart).getTime() + t.shift.gracePeriodMinutes * 60_000;
  const runningLate =
    t.state === 'NOT_CHECKED_IN' &&
    t.dayKind === 'WORKING' &&
    !t.shift.flexible &&
    now.getTime() > graceEnd &&
    now.getTime() < new Date(t.shiftEnd).getTime();
  const busy = breakAction.isPending || flow.busy;
  // Breaks are a Super Admin setting; someone already on a break can always end it.
  const canStartBreak = !!t.allowBreaks && t.state === 'CHECKED_IN';
  const showBreakTime = !!t.allowBreaks || onBreak > 0;
  const captureHint = t.requireSelfie
    ? `Clocking in needs a selfie${t.requireLocation ? ' and your location' : ''}.`
    : t.requireLocation
      ? 'Clocking in needs your location.'
      : '';

  const runBreak = async (key: 'break/start' | 'break/end', success: string) => {
    setPendingBreak(key);
    try {
      await breakAction.mutateAsync({ action: key });
      toast.success(success);
    } catch (err) {
      toast.error(toApiError(err).message);
      void today.refetch();
    } finally {
      setPendingBreak(null);
    }
  };

  const onClockIn = () =>
    void flow.run('check-in', { workMode: t.allowRemoteClockIn ? mode : 'OFFICE', success: 'Checked in. Have a productive day!' });

  const onClockOut = async () => {
    const { confirmed } = await confirm({
      title: 'Check out for today?',
      message: `You have worked ${minutesToHours(Math.floor(worked / 60))} today. You won’t be able to check in again today; use a regularization request for changes.`,
      confirmLabel: 'Check out',
      tone: 'danger',
    });
    if (confirmed) await flow.run('check-out', { success: 'Checked out. Have a good evening!' });
  };

  // Progress / errors from the clock flow (location, selfie, upload) — shown by both variants.
  const feedback = (
    <>
      {flow.status ? (
        <View style={styles.hint} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={c.accent} />
          <Text size="sm" color="fg2">
            {flow.status}
          </Text>
        </View>
      ) : null}
      {flow.notice ? (
        <Notice
          tone={flow.notice.tone}
          icon={flow.notice.tone === 'warning' ? MapPinOff : undefined}
          action={
            flow.notice.settings ? (
              <Button variant="ghost" onPress={() => void Linking.openSettings()}>
                Open settings
              </Button>
            ) : undefined
          }
        >
          <Text size="sm" weight="semibold" style={{ color: flow.notice.tone === 'warning' ? c.warning : c.danger }}>
            {flow.notice.title}
          </Text>
          {flow.notice.message ? (
            <Text size="sm" color="fg2">
              {flow.notice.message}
            </Text>
          ) : null}
        </Notice>
      ) : null}
      {flow.selfieModal}
    </>
  );

  if (hero) {
    // "Today's Overview" (the new Home look): date, status, Clock In / Clock Out times and one big action button,
    // on a gradient in the role's colour (employee navy / blue, HR & admin purple).
    const done = t.state === 'CHECKED_OUT';
    const working = t.state === 'CHECKED_IN' || t.state === 'ON_BREAK';
    const start = new Date(t.shiftStart).getTime();
    const end = new Date(t.shiftEnd).getTime();
    const nowMs = now.getTime();
    const secs = (ms: number) => Math.max(0, ms) / 1000;
    const countdown: { label: string; value: string; icon: IconComponent; warn?: boolean }[] =
      t.state === 'CHECKED_OUT'
        ? [
            { label: 'Worked today', value: formatClock(worked), icon: Timer },
            { label: 'Checked out', value: r?.checkOut ? formatTimeIn(r.checkOut, timeZone) : '—', icon: CheckCircle2 },
          ]
        : working
          ? [
              { label: 'Since check-in', value: formatClock(worked), icon: Timer },
              nowMs < end
                ? { label: 'Check-out in', value: formatClock(secs(end - nowMs)), icon: LogOut }
                : { label: 'Overtime', value: `+${formatClock(secs(nowMs - end))}`, icon: AlarmClock, warn: true },
            ]
          : nowMs < start
            ? [
                { label: 'Check-in in', value: formatClock(secs(start - nowMs)), icon: LogIn },
                { label: 'Shift length', value: formatClock(secs(end - start)), icon: Timer },
              ]
            : nowMs < end
              ? [
                  { label: 'Late by', value: formatClock(secs(nowMs - start)), icon: AlarmClock, warn: true },
                  { label: 'Shift ends in', value: formatClock(secs(end - nowMs)), icon: LogOut },
                ]
              : [{ label: 'Shift ended', value: formatTimeIn(t.shiftEnd, timeZone), icon: LogOut }];
    const onHero = { color: '#ffffff' };
    const soft = { color: 'rgba(255,255,255,0.82)' };
    const glass = { backgroundColor: 'rgba(255,255,255,0.14)', borderColor: 'rgba(255,255,255,0.22)' };
    const timeBox = (label: string, value: string | null | undefined, Icon: IconComponent) => (
      <View style={[styles.heroBox, glass]} accessible accessibilityLabel={`${label}: ${value ? formatTimeIn(value, timeZone) : 'not yet'}`}>
        <View style={styles.heroBoxLabel}>
          <Icon size={14} color="rgba(255,255,255,0.85)" />
          <Text size="xs" weight="medium" style={soft}>
            {label}
          </Text>
        </View>
        <Text size="xl" weight="bold" tabular style={onHero}>
          {value ? formatTimeIn(value, timeZone) : '--:--'}
        </Text>
      </View>
    );
    return (
      <View style={styles.gap}>
        <GradientCard colors={c.hero} radius={radius.xl} style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View style={styles.flex}>
              <Text size="sm" weight="semibold" style={soft}>
                Today’s Overview
              </Text>
              <Text size="xs" style={soft} numberOfLines={1}>
                {`${t.shift.name} · ${formatTimeIn(t.shiftStart, timeZone)} – ${formatTimeIn(t.shiftEnd, timeZone)}`}
              </Text>
            </View>
            <View style={[styles.heroPill, glass]}>
              <Text size="xs" weight="semibold" style={onHero}>
                {formatKey(t.date, 'd MMM yyyy')}
              </Text>
            </View>
          </View>

          <View style={styles.heroChips}>
            <View style={[styles.heroPill, glass]}>
              <View style={[styles.heroDot, { backgroundColor: working ? '#34d399' : done ? '#93c5fd' : '#fbbf24' }]} />
              <Text size="xs" weight="semibold" style={onHero}>
                {meta.label}
              </Text>
            </View>
            {r?.isLate || runningLate ? (
              <View style={[styles.heroPill, { backgroundColor: 'rgba(251,191,36,0.25)', borderColor: 'rgba(251,191,36,0.5)' }]}>
                <AlarmClock size={12} color="#fde68a" />
                <Text size="xs" weight="semibold" style={{ color: '#fde68a' }}>
                  {r?.isLate ? `Late ${minutesToHours(r.lateMinutes)}` : 'Running late'}
                </Text>
              </View>
            ) : null}
            {r?.checkIn ? (
              <View style={[styles.heroPill, glass]}>
                {r.workMode === 'REMOTE' ? <Home size={12} color="#ffffff" /> : <Building2 size={12} color="#ffffff" />}
                <Text size="xs" weight="semibold" style={onHero}>
                  {r.workMode === 'REMOTE' ? 'Remote' : 'Office'}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.heroBoxes}>
            {timeBox('Check In', r?.checkIn, LogIn)}
            {timeBox('Check Out', r?.checkOut, LogOut)}
          </View>

          {/* Live countdown, ticking every second: to the shift start before check-in, time since check-in and
              the countdown to check-out while working (overtime after the shift ends), the day's total once done. */}
          {t.dayKind === 'WORKING' || t.state !== 'NOT_CHECKED_IN' ? (
            <View style={styles.heroBoxes}>
              {countdown.map((cd) => (
                <View key={cd.label} style={[styles.heroCount, glass, cd.warn && styles.heroCountWarn]} accessible accessibilityLabel={`${cd.label}: ${cd.value}`}>
                  <View style={styles.heroBoxLabel}>
                    <cd.icon size={14} color={cd.warn ? '#fde68a' : 'rgba(255,255,255,0.85)'} />
                    <Text size="xs" weight="medium" style={cd.warn ? { color: '#fde68a' } : soft}>
                      {cd.label}
                    </Text>
                  </View>
                  <Text size="xl" weight="bold" tabular style={cd.warn ? { color: '#fde68a' } : onHero}>
                    {cd.value}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {t.dayKind !== 'WORKING' ? (
            <View style={styles.heroBoxLabel}>
              {t.dayKind === 'HOLIDAY' ? <PartyPopper size={16} color="#ffffff" /> : <Sun size={16} color="#ffffff" />}
              <Text size="sm" weight="semibold" style={[onHero, styles.flex]}>
                {t.dayKind === 'HOLIDAY' ? `Holiday${t.holiday ? `: ${t.holiday}` : ''}` : 'Today is a week off'}
              </Text>
            </View>
          ) : null}

          {t.state === 'NOT_CHECKED_IN' && t.allowRemoteClockIn ? (
            <View style={styles.heroModes} accessibilityRole="radiogroup" accessibilityLabel="Where are you working today?">
              {(['OFFICE', 'REMOTE'] as const).map((m) => {
                const selected = mode === m;
                return (
                  <Pressable
                    key={m}
                    onPress={() => setMode(m)}
                    disabled={busy}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={m === 'OFFICE' ? 'Office' : 'Remote'}
                    style={[styles.heroMode, selected ? { backgroundColor: '#ffffff', borderColor: '#ffffff' } : glass]}
                  >
                    {m === 'OFFICE' ? <Building2 size={16} color={selected ? c.hero[0] : '#ffffff'} /> : <Home size={16} color={selected ? c.hero[0] : '#ffffff'} />}
                    <Text size="sm" weight="semibold" style={{ color: selected ? c.hero[0] : '#ffffff' }}>
                      {m === 'OFFICE' ? 'Office' : 'Remote'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {done ? (
            <View style={[styles.heroAction, glass]}>
              <CheckCircle2 size={20} color="#ffffff" />
              <Text weight="bold" style={onHero}>
                Done for today
              </Text>
            </View>
          ) : (
            <Pressable
              onPress={working ? () => void onClockOut() : onClockIn}
              disabled={busy || t.state === 'ON_BREAK'}
              accessibilityRole="button"
              accessibilityLabel={working ? 'Check out' : 'Check in'}
              style={({ pressed }) => [styles.heroAction, { backgroundColor: '#ffffff', opacity: pressed || busy ? 0.85 : 1 }]}
            >
              {flow.active ? (
                <ActivityIndicator size="small" color={c.hero[0]} />
              ) : working ? (
                <LogOut size={20} color={c.hero[0]} />
              ) : (
                <LogIn size={20} color={c.hero[0]} />
              )}
              <Text size="lg" weight="bold" style={{ color: c.hero[0] }}>
                {working ? 'Check out' : 'Check in'}
              </Text>
            </Pressable>
          )}

          {canStartBreak || t.state === 'ON_BREAK' ? (
            <Pressable
              onPress={() => void runBreak(t.state === 'ON_BREAK' ? 'break/end' : 'break/start', t.state === 'ON_BREAK' ? 'Welcome back!' : 'Break started')}
              disabled={busy}
              accessibilityRole="button"
              style={[styles.heroBreak, glass]}
            >
              {pendingBreak ? <ActivityIndicator size="small" color="#ffffff" /> : t.state === 'ON_BREAK' ? <Play size={16} color="#ffffff" /> : <Coffee size={16} color="#ffffff" />}
              <Text size="sm" weight="semibold" style={onHero}>
                {t.state === 'ON_BREAK' ? 'End break' : 'Start break'}
              </Text>
            </Pressable>
          ) : null}
        </GradientCard>

        {t.state === 'NOT_CHECKED_IN' && captureHint ? (
          <View style={styles.hint}>
            {t.requireSelfie ? <Camera size={14} color={c.muted} /> : <MapPin size={14} color={c.muted} />}
            <Text size="xs" color="muted" style={styles.flex}>
              {captureHint}
            </Text>
          </View>
        ) : null}
        {feedback}
      </View>
    );
  }

  if (compact) {
    // Day timeline: shift start ━━━●─── shift end, "now" marker, and dots where you clocked in / out.
    const start = new Date(t.shiftStart).getTime();
    const end = new Date(t.shiftEnd).getTime();
    const at = (ms: number) => Math.max(0, Math.min(1, (ms - start) / Math.max(1, end - start)));
    const nowPos = at(now.getTime());
    const inPos = r?.checkIn ? at(new Date(r.checkIn).getTime()) : null;
    const outPos = r?.checkOut ? at(new Date(r.checkOut).getTime()) : null;
    const fillTo = outPos ?? nowPos;
    const beforeShift = now.getTime() < start;
    const afterShift = now.getTime() > end;
    const nowLabel = beforeShift
      ? `Shift starts at ${formatTimeIn(t.shiftStart, timeZone)}`
      : afterShift
        ? `Shift ended · now ${formatTimeIn(now, timeZone)}`
        : `Now · ${formatTimeIn(now, timeZone)}`;
    const leftLabel = beforeShift
      ? `Starts in ${minutesToHours(Math.ceil((start - now.getTime()) / 60_000))}`
      : afterShift
        ? 'Shift over'
        : `${minutesToHours(Math.ceil((end - now.getTime()) / 60_000))} left`;
    const hourTicks: number[] = [];
    for (let ms = Math.ceil(start / 3_600_000) * 3_600_000; ms < end; ms += 3_600_000) if (ms > start) hourTicks.push(at(ms));
    const working = t.state === 'CHECKED_IN' || t.state === 'ON_BREAK';
    const green = toneColors('green', c);
    const purple = toneColors('purple', c);
    const rose = toneColors('red', c);
    // Employees: the web employee Today card's flat very light blue (#f8fbff; dark: the plain surface).
    // Others: a soft tint of the current status.
    const cardColors: [string, string] =
      kind === 'employee' ? (scheme === 'dark' ? [c.surface, c.surface] : ['#f8fbff', '#f8fbff']) : CARD_TINTS[t.state][scheme];

    return (
      <View style={styles.gap}>
        <GradientCard colors={cardColors} style={[styles.gap, styles.tlCard, { borderColor: c.line }]}>
          <View style={styles.tlHead}>
            <Badge tone={meta.tone} dot>
              {meta.label}
            </Badge>
            {r?.isLate ? (
              <Badge tone="amber" icon={AlarmClock}>
                {`Late ${minutesToHours(r.lateMinutes)}`}
              </Badge>
            ) : null}
            {r?.checkIn ? (
              <Badge tone={r.workMode === 'REMOTE' ? 'blue' : 'gray'} icon={r.workMode === 'REMOTE' ? Home : Building2}>
                {r.workMode === 'REMOTE' ? 'Remote' : 'Office'}
              </Badge>
            ) : null}
            <Text size="xs" color="muted" numberOfLines={1} style={styles.tlShift}>
              {t.shift.name}
            </Text>
          </View>

          {/* The timeline */}
          <View
            accessible
            accessibilityLabel={`Shift ${formatTimeIn(t.shiftStart, timeZone)} to ${formatTimeIn(t.shiftEnd, timeZone)}. ${nowLabel}`}
          >
            <View style={styles.tlEnds}>
              <View>
                <View style={styles.tlEndLabel}>
                  <LogIn size={12} color={green.solid} />
                  <Text size="xs" weight="semibold" style={{ color: green.fg }}>
                    Start
                  </Text>
                </View>
                <Text size="md" weight="bold" tabular>
                  {formatTimeIn(t.shiftStart, timeZone)}
                </Text>
              </View>
              <PopIn>
                <View style={[styles.tlLength, { backgroundColor: purple.bg, borderColor: purple.border }]}>
                  <Timer size={12} color={purple.solid} />
                  <Text size="xs" weight="semibold" style={{ color: purple.fg }}>
                    {`${minutesToHours(Math.round((end - start) / 60_000))} shift`}
                  </Text>
                </View>
              </PopIn>
              <View style={styles.tlEndRight}>
                <View style={styles.tlEndLabel}>
                  <Text size="xs" weight="semibold" style={{ color: rose.fg }}>
                    End
                  </Text>
                  <LogOut size={12} color={rose.solid} />
                </View>
                <Text size="md" weight="bold" tabular>
                  {formatTimeIn(t.shiftEnd, timeZone)}
                </Text>
              </View>
            </View>
            <View style={styles.tlTrackWrap}>
              <View style={[styles.tlTrack, { backgroundColor: c.surface3 }]}>
                <TimelineFill to={fillTo} colors={working ? ['#10b981', '#14b8a6', '#06b6d4'] : ['#6366f1', '#8b5cf6', '#ec4899']} />
              </View>
              {/* Hour ticks so the bar reads like a day ruler. */}
              {hourTicks.map((p) => (
                <View key={p} style={[styles.tlTick, { left: `${p * 100}%`, backgroundColor: c.surface }]} />
              ))}
              {inPos !== null ? (
                <View style={[styles.tlMark, { left: `${inPos * 100}%`, backgroundColor: c.success, borderColor: c.surface }]} />
              ) : null}
              {outPos !== null ? (
                <View style={[styles.tlMark, { left: `${outPos * 100}%`, backgroundColor: '#f43f5e', borderColor: c.surface }]} />
              ) : null}
              {t.state !== 'CHECKED_OUT' ? (
                <View style={[styles.tlNow, { left: `${nowPos * 100}%` }]}>
                  <PulseRing size={22} color={c.primary} />
                  <View style={[styles.tlNowDot, { backgroundColor: c.primary, borderColor: c.surface }]} />
                </View>
              ) : null}
            </View>
            <View style={styles.tlFoot}>
              <View style={[styles.tlNowChip, { backgroundColor: c.primary }]} />
              <Text size="xs" color="fg2" weight="medium" style={styles.flex} numberOfLines={1}>
                {t.state === 'CHECKED_OUT' ? `Done for today · worked ${minutesToHours(Math.floor(worked / 60))}` : nowLabel}
              </Text>
              {t.state === 'CHECKED_OUT' ? null : runningLate ? (
                <Blink>
                  <View style={[styles.tlLeft, { backgroundColor: toneColors('red', c).bg }]}>
                    <AlarmClock size={12} color={c.danger} />
                    <Text size="xs" weight="bold" style={{ color: c.danger }}>
                      Running late
                    </Text>
                  </View>
                </Blink>
              ) : (
                <View style={[styles.tlLeft, { backgroundColor: toneColors('blue', c).bg }]}>
                  <Text size="xs" weight="bold" style={{ color: toneColors('blue', c).fg }} numberOfLines={1}>
                    {leftLabel}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {t.state === 'NOT_CHECKED_IN' && t.allowRemoteClockIn ? (
            <Segmented<WorkMode>
              accessibilityLabel="Working from"
              value={mode}
              onChange={setMode}
              disabled={busy}
              options={[
                { value: 'OFFICE', label: 'Office', icon: Building2 },
                { value: 'REMOTE', label: 'Remote', icon: Home },
              ]}
            />
          ) : null}

          <View style={styles.boxes}>
            <Button
              colors={r?.checkIn ? tones.inDone : tones.in}
              icon={r?.checkIn ? CheckCircle2 : LogIn}
              loading={flow.active === 'check-in'}
              disabled={busy || t.state !== 'NOT_CHECKED_IN'}
              onPress={onClockIn}
              style={styles.flex}
            >
              {r?.checkIn ? `In · ${formatTimeIn(r.checkIn, timeZone)}` : 'Check in'}
            </Button>
            <Button
              colors={r?.checkOut ? tones.outDone : tones.out}
              icon={r?.checkOut ? CheckCircle2 : LogOut}
              loading={flow.active === 'check-out'}
              disabled={busy || !working}
              onPress={() => void onClockOut()}
              style={styles.flex}
            >
              {r?.checkOut ? `Out · ${formatTimeIn(r.checkOut, timeZone)}` : 'Check out'}
            </Button>
          </View>

          <View style={styles.tlStats}>
            <View style={styles.tlStat}>
              <Timer size={14} color={c.success} />
              <Text size="sm" color="fg2">
                Worked{' '}
                <Text size="sm" weight="bold" tabular>
                  {minutesToHours(Math.floor(worked / 60))}
                </Text>
              </Text>
            </View>
            {showBreakTime ? (
              <View style={styles.tlStat}>
                <Coffee size={14} color={c.warning} />
                <Text size="sm" color="fg2">
                  Break{' '}
                  <Text size="sm" weight="bold" tabular>
                    {minutesToHours(Math.floor(onBreak / 60))}
                  </Text>
                </Text>
              </View>
            ) : null}
            {canStartBreak ? (
              <Button
                variant="ghost"
                icon={Coffee}
                loading={pendingBreak === 'break/start'}
                disabled={busy}
                onPress={() => void runBreak('break/start', 'Break started')}
              >
                Start break
              </Button>
            ) : t.state === 'ON_BREAK' ? (
              <Button
                variant="ghost"
                icon={Play}
                loading={pendingBreak === 'break/end'}
                disabled={busy}
                onPress={() => void runBreak('break/end', 'Welcome back!')}
              >
                End break
              </Button>
            ) : null}
          </View>
        </GradientCard>

        {t.dayKind !== 'WORKING' ? (
          <Notice tone="info" icon={t.dayKind === 'HOLIDAY' ? PartyPopper : Sun}>
            {t.dayKind === 'HOLIDAY' ? `Holiday${t.holiday ? `: ${t.holiday}` : ''}` : 'Today is a week off'}
          </Notice>
        ) : null}
        {runningLate ? (
          <Notice tone="warning" icon={AlarmClock}>
            {`Your shift started at ${formatTimeIn(t.shiftStart, timeZone)} — clocking in now will be marked late.`}
          </Notice>
        ) : null}
        {t.state === 'NOT_CHECKED_IN' && captureHint ? (
          <View style={styles.hint}>
            {t.requireSelfie ? <Camera size={14} color={c.muted} /> : <MapPin size={14} color={c.muted} />}
            <Text size="xs" color="muted" style={styles.flex}>
              {captureHint}
            </Text>
          </View>
        ) : null}
        {feedback}
      </View>
    );
  }

  return (
    <Card style={styles.gap} padding={space(5)}>
      <View style={styles.badges}>
        <Badge tone={meta.tone} dot>
          {meta.label}
        </Badge>
        {r?.isLate ? (
          <Badge tone="amber" icon={AlarmClock}>
            {`Late by ${minutesToHours(r.lateMinutes)}`}
          </Badge>
        ) : null}
        {r?.checkIn ? (
          <Badge tone={r.workMode === 'REMOTE' ? 'blue' : 'gray'} icon={r.workMode === 'REMOTE' ? Home : Building2}>
            {r.workMode === 'REMOTE' ? 'Remote' : 'Office'}
          </Badge>
        ) : null}
      </View>

      <View>
        <Text size="display" weight="semibold" tabular accessibilityLabel={`Current time ${formatTimeIn(now, timeZone)}`}>
          {formatClockTimeIn(now, timeZone)}
        </Text>
        <Text size="sm" color="muted">
          {formatKey(t.date, 'EEEE, d MMMM')} · {timeZone}
        </Text>
      </View>

      <View style={styles.shift}>
        <View style={[styles.dot, { backgroundColor: t.shift.color || c.primary }]} />
        <Text size="sm" weight="medium" color="fg2">
          {t.shift.name}
        </Text>
        <Text size="sm" color="fg2" tabular>
          {formatTimeIn(t.shiftStart, timeZone)} – {formatTimeIn(t.shiftEnd, timeZone)}
          {t.shift.nightShift ? ' (next day)' : ''}
        </Text>
        {t.shift.flexible ? (
          <Badge tone="teal">Flexible</Badge>
        ) : t.shift.gracePeriodMinutes > 0 ? (
          <Text size="xs" color="muted">{`${t.shift.gracePeriodMinutes} min grace`}</Text>
        ) : null}
      </View>

      {t.dayKind !== 'WORKING' ? (
        <Notice tone="info" icon={t.dayKind === 'HOLIDAY' ? PartyPopper : Sun}>
          {t.dayKind === 'HOLIDAY' ? `Holiday${t.holiday ? `: ${t.holiday}` : ''}` : 'Today is a week off'}
        </Notice>
      ) : null}
      {runningLate ? (
        <Notice tone="warning" icon={AlarmClock}>
          {`Your shift started at ${formatTimeIn(t.shiftStart, timeZone)} — clocking in now will be marked late.`}
        </Notice>
      ) : null}

      {!compact ? (
        <View style={styles.grid}>
          <Metric
            label="Worked"
            icon={Timer}
            value={t.state === 'NOT_CHECKED_IN' ? '00:00:00' : formatClock(worked)}
            color={t.state === 'CHECKED_IN' ? c.success : undefined}
          />
          {showBreakTime ? <Metric label="Break" icon={Coffee} value={formatClock(onBreak)} color={t.state === 'ON_BREAK' ? c.warning : undefined} /> : null}
          <Metric label="Check in" icon={LogIn} value={r?.checkIn ? formatTimeIn(r.checkIn, timeZone) : '—'} />
          <Metric label="Check out" icon={LogOut} value={r?.checkOut ? formatTimeIn(r.checkOut, timeZone) : '—'} />
        </View>
      ) : null}

      {!compact ? (
        <View style={styles.progress}>
          <View style={styles.progressLabel}>
            <Text size="xs" color="muted">{`Progress toward ${t.shift.workingHours}h shift`}</Text>
            <Text size="xs" color="muted" tabular>{`${Math.min(100, Math.round(progress))}%`}</Text>
          </View>
          <ProgressBar value={progress} color={progress >= 100 ? '#10b981' : undefined} accessibilityLabel="Shift progress" />
          {r?.checkOut && r.overtimeMinutes > 0 ? (
            <Text size="xs" color="success">
              {`Overtime ${minutesToHours(r.overtimeMinutes)}`}
            </Text>
          ) : null}
        </View>
      ) : null}

      {!compact && t.state === 'NOT_CHECKED_IN' ? (
        <View style={styles.gap}>
          {t.allowRemoteClockIn ? (
            <View style={styles.gapSm}>
              <Text size="sm" weight="medium">
                Where are you working today?
              </Text>
              <Segmented<WorkMode>
                accessibilityLabel="Work mode"
                value={mode}
                onChange={setMode}
                disabled={busy}
                options={[
                  { value: 'OFFICE', label: 'Office', icon: Building2 },
                  { value: 'REMOTE', label: 'Remote', icon: Home },
                ]}
              />
            </View>
          ) : null}
          <Button colors={tones.in} size="lg" icon={LogIn} loading={flow.active === 'check-in'} disabled={busy} onPress={onClockIn} fullWidth>
            Check in
          </Button>
          <View style={styles.hint}>
            {t.requireSelfie ? <Camera size={14} color={c.muted} /> : <MapPin size={14} color={c.muted} />}
            <Text size="xs" color="muted" style={styles.flex}>
              {captureHint || 'Your location is recorded when you clock in and out (if permitted).'}
            </Text>
          </View>
        </View>
      ) : null}

      {!compact && (t.state === 'CHECKED_IN' || t.state === 'ON_BREAK') ? (
        <View style={styles.actions}>
          {canStartBreak ? (
            <Button
              variant="outline"
              size="lg"
              icon={Coffee}
              loading={pendingBreak === 'break/start'}
              disabled={busy}
              onPress={() => void runBreak('break/start', 'Break started')}
              style={styles.action}
            >
              Start break
            </Button>
          ) : t.state === 'ON_BREAK' ? (
            <Button
              variant="success"
              size="lg"
              icon={Play}
              loading={pendingBreak === 'break/end'}
              disabled={busy}
              onPress={() => void runBreak('break/end', 'Welcome back!')}
              style={styles.action}
            >
              End break
            </Button>
          ) : null}
          <Button
            colors={tones.out}
            size="lg"
            icon={LogOut}
            loading={flow.active === 'check-out'}
            disabled={busy}
            onPress={() => void onClockOut()}
            style={styles.action}
          >
            Check out
          </Button>
        </View>
      ) : null}

      {t.state === 'CHECKED_OUT' && r ? (
        <Notice
          tone="success"
          action={
            <Button
              variant="ghost"
              onPress={() => router.push({ pathname: '/attendance/regularizations/new', params: { date: t.date } })}
              accessibilityHint="Opens the attendance regularization form for today"
            >
              Request regularization
            </Button>
          }
        >
          <Text size="sm" weight="semibold" color="success">
            You’re done for today.
          </Text>
          <Text size="sm" color="success">
            {`Worked ${minutesToHours(r.workingMinutes)} · Break ${minutesToHours(r.breakMinutes)}${r.isEarlyDeparture ? ` · Left ${minutesToHours(r.earlyDepartureMinutes)} early` : ''}`}
          </Text>
        </Notice>
      ) : null}

      {feedback}
    </Card>
  );
};

const styles = StyleSheet.create({
  // Home "Today's Overview" (hero) card.
  heroCard: { padding: space(4), gap: space(3) },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space(2) },
  heroChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5) },
  heroPill: { flexDirection: 'row', alignItems: 'center', gap: space(1), borderRadius: radius.full, borderWidth: 1, paddingHorizontal: space(2.5), paddingVertical: space(1) },
  heroDot: { width: 7, height: 7, borderRadius: 4 },
  heroBoxes: { flexDirection: 'row', gap: space(2.5) },
  heroBox: { flex: 1, borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: space(3), paddingVertical: space(2.5), gap: space(1) },
  heroBoxLabel: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  heroCount: { flex: 1, borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: space(3), paddingVertical: space(2.5), gap: space(1) },
  heroCountWarn: { backgroundColor: 'rgba(251,191,36,0.18)', borderColor: 'rgba(251,191,36,0.45)' },
  heroModes: { flexDirection: 'row', gap: space(2) },
  heroMode: { flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space(1.5), borderRadius: radius.full, borderWidth: 1 },
  heroAction: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space(2), borderRadius: radius.lg, borderWidth: 0 },
  heroBreak: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space(2), borderRadius: radius.full, borderWidth: 1 },
  tlHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space(2) },
  tlShift: { marginLeft: 'auto' },
  tlEnds: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space(2) },
  tlEndRight: { alignItems: 'flex-end' },
  tlLength: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
  },
  tlTrackWrap: { height: 24, justifyContent: 'center', marginBottom: space(1) },
  tlTrack: { height: 10, borderRadius: 5, overflow: 'hidden' },
  tlFill: { height: 10, borderRadius: 5 },
  tlCard: { padding: space(4), borderWidth: 1 },
  tlEndLabel: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  tlSheen: { position: 'absolute', top: 0, bottom: 0, width: '35%', backgroundColor: 'rgba(255,255,255,0.35)' },
  tlNowChip: { width: 8, height: 8, borderRadius: 4 },
  tlLeft: { flexDirection: 'row', alignItems: 'center', gap: space(1), borderRadius: radius.full, paddingHorizontal: space(2), paddingVertical: 2 },
  tlTick: { position: 'absolute', width: 2, height: 10, marginLeft: -1, opacity: 0.7 },
  tlFoot: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  tlMark: { position: 'absolute', width: 12, height: 12, marginLeft: -6, borderRadius: 6, borderWidth: 2 },
  tlNow: { position: 'absolute', width: 22, height: 22, marginLeft: -11, alignItems: 'center', justifyContent: 'center' },
  tlNowDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
  tlStats: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space(4), rowGap: space(1) },
  tlStat: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  flex: { flex: 1 },
  gap: { gap: space(4) },
  gapSm: { gap: space(2) },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  shift: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space(2), rowGap: space(1) },
  dot: { width: 10, height: 10, borderRadius: 5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  metric: {
    flexGrow: 1,
    flexBasis: '46%',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
    gap: space(1),
  },
  metricLabel: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  bar: { flexDirection: 'row', borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  barCell: { flex: 1, alignItems: 'center', gap: space(1), paddingHorizontal: space(1), paddingVertical: space(2.5) },
  now: { flexDirection: 'row', alignItems: 'center', gap: space(1), marginLeft: 'auto' },
  boxes: { flexDirection: 'row', gap: space(2) },
  boxHost: { flex: 1 },
  boxShadow: {
    borderRadius: radius.md,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  box: {
    flex: 1,
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    paddingHorizontal: space(2.5),
    paddingVertical: space(2),
    gap: space(2.5),
  },
  boxIcon: { width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  upper: { textTransform: 'uppercase', letterSpacing: 0.6 },
  progress: { gap: space(1.5) },
  progressLabel: { flexDirection: 'row', justifyContent: 'space-between' },
  // Side by side on wider phones, stacked on 360-dp screens.
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  action: { flexGrow: 1, flexBasis: 150 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
});
