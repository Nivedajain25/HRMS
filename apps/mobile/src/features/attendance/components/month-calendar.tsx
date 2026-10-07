import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Card, Text } from '@/components';
import { get, getPaged } from '@/lib/api';
import { radius, space, useTheme } from '@/theme';
import type { AttendanceRow } from '../api';
import type { LeaveRequest } from '../../leave/api';

type DayKind = 'PRESENT' | 'LATE' | 'ABSENT' | 'HALF_DAY' | 'LEAVE' | 'HOLIDAY' | 'WEEK_OFF';

/** Present navy, late light blue, leave aqua, absent dark red (maroon). */
const KIND: Record<DayKind, { label: string; bg: string; fg: string }> = {
  PRESENT: { label: 'Present', bg: '#1e3a8a', fg: '#ffffff' },
  LATE: { label: 'Late', bg: '#60a5fa', fg: '#ffffff' },
  ABSENT: { label: 'Absent', bg: '#9f1239', fg: '#ffffff' },
  HALF_DAY: { label: 'Half day', bg: '#8b5cf6', fg: '#ffffff' },
  LEAVE: { label: 'Leave', bg: '#22d3ee', fg: '#ffffff' },
  HOLIDAY: { label: 'Holiday', bg: '#dbeafe', fg: '#1d4ed8' },
  WEEK_OFF: { label: 'Week off', bg: '', fg: '' },
};
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const pad = (n: number) => String(n).padStart(2, '0');
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

const kindOf = (r: AttendanceRow): DayKind | undefined => {
  const st = r.status as string;
  if (st === 'PRESENT' || st === 'WORK_FROM_HOME') return r.isLate ? 'LATE' : 'PRESENT';
  return (['LATE', 'ABSENT', 'HALF_DAY', 'LEAVE', 'HOLIDAY', 'WEEK_OFF'] as string[]).includes(st) ? (st as DayKind) : undefined;
};

/**
 * Month grid (Monday first): each day coloured by attendance, approved leave or holiday; today outlined.
 * Tapping a day with a record opens its details.
 */
export const MonthCalendar = ({
  month,
  today,
  records,
  onOpen,
}: {
  /** `YYYY-MM` */
  month: string;
  /** `YYYY-MM-DD` */
  today: string;
  records: AttendanceRow[];
  onOpen: (record: AttendanceRow) => void;
}) => {
  const { c } = useTheme();
  const dark = c.scheme === 'dark';
  const year = Number(month.slice(0, 4));
  const days = new Date(Date.UTC(year, Number(month.slice(5, 7)), 0)).getUTCDate();
  const from = `${month}-01`;
  const to = `${month}-${pad(days)}`;

  // Same cache keys as the Holidays screen / leave lists, so these are usually already loaded.
  const holidays = useQuery({ queryKey: ['holidays', 'list', { year }], queryFn: () => get<{ date: string }[]>('/holidays', { year }) });
  const leaves = useQuery({
    // Under the leave keys' 'leaves' root, so applying / cancelling leave refreshes the calendar too.
    queryKey: ['leaves', 'my-approved', from, to],
    queryFn: () => getPaged<LeaveRequest>('/leaves', { scope: 'me', status: 'APPROVED', from, to, limit: 50 }),
  });

  const byDay = useMemo(() => {
    const kinds = new Map<string, DayKind>();
    for (const h of holidays.data ?? []) if (h.date.startsWith(month)) kinds.set(h.date.slice(0, 10), 'HOLIDAY');
    for (const l of leaves.data?.data ?? []) {
      for (let d = l.startDate.slice(0, 10); d <= l.endDate.slice(0, 10) && d <= to; d = nextDay(d)) if (d >= from) kinds.set(d, 'LEAVE');
    }
    const rec = new Map<string, AttendanceRow>();
    for (const r of records) {
      const key = r.date.slice(0, 10);
      rec.set(key, r);
      const k = kindOf(r);
      if (k) kinds.set(key, k);
    }
    return { kinds, rec };
  }, [holidays.data, leaves.data, records, month, from, to]);

  const lead = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => `${month}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);

  const colours = (kind: DayKind | undefined) => {
    if (!kind) return { bg: 'transparent', fg: c.fg };
    if (kind === 'WEEK_OFF') return { bg: c.surface2, fg: c.muted };
    if (kind === 'HOLIDAY' && dark) return { bg: 'rgba(29,78,216,0.3)', fg: '#dbeafe' };
    return KIND[kind];
  };

  return (
    <Card>
      <View style={styles.row}>
        {WEEKDAYS.map((w, i) => (
          <Text key={i} size="xs" weight="semibold" color="muted" align="center" style={styles.cell}>
            {w}
          </Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, week) => (
        <View key={week} style={styles.row}>
          {cells.slice(week * 7, week * 7 + 7).map((key, i) => {
            if (!key) return <View key={`b${i}`} style={styles.cell} />;
            const kind = byDay.kinds.get(key);
            const record = byDay.rec.get(key);
            const { bg, fg } = colours(kind);
            const isToday = key === today;
            const future = key > today;
            return (
              <View key={key} style={styles.cell}>
                <Pressable
                  disabled={!record}
                  onPress={record ? () => onOpen(record) : undefined}
                  accessibilityRole={record ? 'button' : 'text'}
                  accessibilityLabel={`${Number(key.slice(8))}${kind ? `, ${KIND[kind].label}` : ''}${isToday ? ', today' : ''}`}
                  style={[
                    styles.day,
                    { backgroundColor: bg },
                    isToday && { borderWidth: 2, borderColor: c.accent },
                    future && !kind && { opacity: 0.45 },
                  ]}
                >
                  <Text size="sm" weight={isToday || kind ? 'semibold' : 'regular'} tabular style={{ color: fg }}>
                    {Number(key.slice(8))}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
      <View style={styles.legend}>
        {(Object.keys(KIND) as DayKind[]).map((k) => (
          <View key={k} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: k === 'WEEK_OFF' ? c.lineStrong : k === 'HOLIDAY' ? '#93c5fd' : KIND[k].bg }]} />
            <Text size="xs" color="muted">
              {KIND[k].label}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', paddingVertical: space(0.75) },
  day: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space(3), rowGap: space(1.5), marginTop: space(3) },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
});
