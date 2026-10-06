import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { CalendarDays, ChevronLeft, ChevronRight, PartyPopper } from 'lucide-react-native';
import { Avatar, Badge, Button, Card, Checkbox, EmptyState, ErrorState, Header, IconButton, Screen, Skeleton, Text } from '@/components';
import { useAuth } from '@/lib/auth';
import { fullName } from '@/lib/format';
import { addDaysToKey, dateKeyIn, formatDate, formatKey, monthBounds, shiftMonth } from '@/lib/time';
import { radius, space, toneColors, TOUCH_TARGET, useTheme } from '@/theme';
import { useLeaveCalendar, type CalendarHoliday, type CalendarLeave } from '../api';
import { dateKeyOf, isCalendarPending, sessionLabel, typeColor, typeOf } from '../lib';

/** `YYYY-MM-DD` keys between two keys (inclusive). */
const keysBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let k = from; k <= to && out.length < 400; k = addDaysToKey(k, 1)) out.push(k);
  return out;
};

const colorOf = (l: CalendarLeave) => (l.restricted ? typeColor(null) : typeColor(typeOf(l)));

const describe = (l: CalendarLeave) => {
  const multi = dateKeyOf(l.startDate) !== dateKeyOf(l.endDate);
  return [
    l.restricted ? 'On leave' : (typeOf(l)?.name ?? 'Leave'),
    l.halfDay ? sessionLabel(l.halfDaySession) : null,
    multi ? `${formatDate(l.startDate, 'dd MMM')} – ${formatDate(l.endDate, 'dd MMM')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
};

const AgendaRow = ({ l }: { l: CalendarLeave }) => {
  const { c } = useTheme();
  const color = colorOf(l);
  const pending = isCalendarPending(l);
  const name = fullName(l.employeeId);
  const detail = describe(l);
  const body = (
    <>
      <View
        style={[
          styles.bar,
          pending ? { borderColor: color, borderWidth: 2, backgroundColor: 'transparent' } : { backgroundColor: color },
        ]}
      />
      <Avatar name={name} uri={l.employeeId?.profilePhoto} size={36} />
      <View style={styles.flex}>
        <Text size="sm" weight="medium" numberOfLines={1}>
          {name}
        </Text>
        <Text size="xs" color="muted" numberOfLines={2}>
          {detail}
        </Text>
      </View>
      {pending ? <Badge tone="amber">Pending</Badge> : null}
    </>
  );
  const a11y = `${name}, ${detail}, ${pending ? 'pending approval' : 'approved'}`;
  if (l.restricted) {
    return (
      <View style={styles.agendaRow} accessible accessibilityLabel={a11y}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/leave/[id]', params: { id: l._id } })}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint="Opens the leave request"
      style={({ pressed }) => [styles.agendaRow, pressed && { backgroundColor: c.surface2 }]}
    >
      {body}
    </Pressable>
  );
};

const LegendItem = ({ pending, children }: { pending?: boolean; children: string }) => {
  const { c } = useTheme();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendBar, pending ? { borderWidth: 2, borderColor: c.accent } : { backgroundColor: c.accent }]} />
      <Text size="xs" color="fg2">
        {children}
      </Text>
    </View>
  );
};

/** Team leave calendar as an agenda: who is away each day of the month, approved vs pending, and holidays. */
export const LeaveCalendarScreen = () => {
  const { c } = useTheme();
  const { timeZone } = useAuth();
  const today = dateKeyIn(timeZone);
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [showPending, setShowPending] = useState(true);
  const { from, to } = monthBounds(month);
  const calendar = useLeaveCalendar(from, to);

  const { agenda, counts } = useMemo(() => {
    const byDay = new Map<string, CalendarLeave[]>();
    const holidays = new Map<string, CalendarHoliday[]>();
    let approved = 0;
    let pending = 0;
    for (const l of calendar.data?.leaves ?? []) {
      const isPending = isCalendarPending(l);
      if (!showPending && isPending) continue;
      if (isPending) pending++;
      else approved++;
      for (const key of keysBetween(dateKeyOf(l.startDate), dateKeyOf(l.endDate))) {
        if (key < from || key > to) continue;
        byDay.set(key, [...(byDay.get(key) ?? []), l]);
      }
    }
    for (const list of byDay.values()) {
      list.sort((a, b) => Number(isCalendarPending(a)) - Number(isCalendarPending(b)) || fullName(a.employeeId).localeCompare(fullName(b.employeeId)));
    }
    for (const h of calendar.data?.holidays ?? []) {
      const key = dateKeyOf(h.date);
      holidays.set(key, [...(holidays.get(key) ?? []), h]);
    }
    const days = keysBetween(from, to)
      .filter((k) => byDay.has(k) || holidays.has(k))
      .map((k) => ({ key: k, leaves: byDay.get(k) ?? [], holidays: holidays.get(k) ?? [] }));
    return { agenda: days, counts: { approved, pending } };
  }, [calendar.data, showPending, from, to]);

  const monthLabel = formatKey(`${month}-01`, 'MMMM yyyy');
  const purple = toneColors('purple', c);

  return (
    <Screen header={<Header title="Leave calendar" subtitle="Who is away, alongside holidays" back backTo="/leave" />} onRefresh={() => calendar.refetch()}>
      <Card style={styles.controls}>
        <View style={styles.monthRow}>
          <IconButton icon={ChevronLeft} color={c.fg} onPress={() => setMonth((m) => shiftMonth(m, -1))} accessibilityLabel="Previous month" />
          <Text size="lg" weight="semibold" align="center" style={styles.flex} accessibilityRole="header" accessibilityLiveRegion="polite">
            {monthLabel}
          </Text>
          <IconButton icon={ChevronRight} color={c.fg} onPress={() => setMonth((m) => shiftMonth(m, 1))} accessibilityLabel="Next month" />
        </View>
        <View style={styles.optionsRow}>
          <Checkbox label="Show pending" checked={showPending} onChange={setShowPending} />
          <Button variant="ghost" onPress={() => setMonth(thisMonth)} disabled={month === thisMonth} accessibilityLabel="Go to the current month">
            This month
          </Button>
        </View>
        <View style={[styles.legend, { borderTopColor: c.line }]}>
          <LegendItem>{`Approved${calendar.data ? ` (${counts.approved})` : ''}`}</LegendItem>
          <LegendItem pending>{`Pending${calendar.data ? ` (${counts.pending})` : ''}`}</LegendItem>
          <View style={styles.legendItem}>
            <PartyPopper size={14} color={c.muted} />
            <Text size="xs" color="fg2">
              Holiday
            </Text>
          </View>
        </View>
      </Card>

      {calendar.isLoading ? (
        <Card style={styles.controls}>
          <Skeleton width={140} height={16} />
          <Skeleton height={44} />
          <Skeleton height={44} />
        </Card>
      ) : calendar.error ? (
        <Card>
          <ErrorState title="Could not load the calendar" error={calendar.error} onRetry={() => void calendar.refetch()} />
        </Card>
      ) : agenda.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="Nobody is away"
            message={`No ${showPending ? '' : 'approved '}leave or holidays in ${formatKey(`${month}-01`, 'MMMM')}.`}
          />
        </Card>
      ) : (
        <View style={[styles.agenda, calendar.isFetching && styles.fetching]}>
          {agenda.map((day) => (
            <Card key={day.key} padding={0}>
              <View style={[styles.dayHead, { borderBottomColor: c.line }]}>
                <Text size="lg" weight="semibold" color={day.key === today ? 'accent' : 'fg'} accessibilityRole="header">
                  {`${formatKey(day.key, 'EEE, dd MMM')}${day.key === today ? ' · Today' : ''}`}
                </Text>
                {day.leaves.length ? (
                  <Text size="xs" color="muted">
                    {`${day.leaves.length} away`}
                  </Text>
                ) : null}
              </View>
              {day.holidays.length ? (
                <View style={styles.holidays}>
                  {day.holidays.map((h) => (
                    <View key={h.name} style={[styles.holiday, { backgroundColor: purple.bg, borderColor: purple.border }]}>
                      <PartyPopper size={14} color={purple.fg} />
                      <Text size="sm" weight="medium" style={[styles.flex, { color: purple.fg }]}>
                        {`${h.name}${h.optional ? ' (optional)' : ''}${h.locations?.length ? ` · ${h.locations.join(', ')}` : ''}`}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {day.leaves.map((l, i) => (
                <View key={`${day.key}-${l._id}`} style={i > 0 || day.holidays.length ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line } : undefined}>
                  <AgendaRow l={l} />
                </View>
              ))}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  controls: { gap: space(3) },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  optionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: space(2) },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space(4), borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space(3) },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  legendBar: { width: 16, height: 10, borderRadius: 3 },
  agenda: { gap: space(3) },
  fetching: { opacity: 0.7 },
  dayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(2),
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  holidays: { gap: space(1.5), paddingHorizontal: space(4), paddingVertical: space(3) },
  holiday: { flexDirection: 'row', alignItems: 'center', gap: space(2), borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space(2.5), paddingVertical: space(1.5) },
  agendaRow: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: TOUCH_TARGET + 12, paddingHorizontal: space(4), paddingVertical: space(2.5) },
  bar: { width: 4, alignSelf: 'stretch', borderRadius: radius.sm },
});
