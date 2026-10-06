import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronLeft, ChevronRight, Users } from 'lucide-react-native';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, IconButton, ListItem, SkeletonList, Text } from '@/components';
import { useAttendanceBoard, type BoardCard, type BoardColumn } from '@/features/dashboard/api';
import { useDepartments } from '@/features/team/api';
import { useAuth } from '@/lib/auth';
import { addDaysKey, dateKeyIn, formatKey, formatTimeIn } from '@/lib/time';
import { radius, space, toneColors, useTheme, type Tone } from '@/theme';

const COLUMNS: { key: BoardColumn | 'ALL'; label: string; tone: Tone }[] = [
  { key: 'ALL', label: 'All', tone: 'brand' },
  { key: 'WORKING', label: 'In', tone: 'green' },
  { key: 'ON_BREAK', label: 'Break', tone: 'amber' },
  { key: 'NOT_IN', label: 'Not in', tone: 'gray' },
  { key: 'DONE', label: 'Left', tone: 'blue' },
  { key: 'AWAY', label: 'Away', tone: 'purple' },
];

const Chip = ({ label, on, tone, onPress }: { label: string; on: boolean; tone: Tone; onPress: () => void }) => {
  const { c } = useTheme();
  const t = toneColors(tone, c);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      style={[styles.chip, { borderColor: on ? t.solid : c.line, backgroundColor: on ? t.bg : c.surface }]}
    >
      <Text size="sm" weight="semibold" style={{ color: on ? t.fg : c.fg2 }}>
        {label}
      </Text>
    </Pressable>
  );
};

const Row = ({ p, divider }: { p: BoardCard; divider: boolean }) => {
  const { c } = useTheme();
  const { timeZone } = useAuth();
  const name = `${p.employee.firstName} ${p.employee.lastName}`.trim();
  const times = p.checkIn ? `In ${formatTimeIn(p.checkIn, timeZone)}${p.checkOut ? ` · Out ${formatTimeIn(p.checkOut, timeZone)}` : ''}` : null;
  const status =
    p.column === 'AWAY' ? (p.awayReason ?? 'Away') : p.column === 'NOT_IN' ? (p.absent ? 'Absent' : 'Not in') : p.column === 'ON_BREAK' ? 'On break' : p.column === 'DONE' ? 'Left' : 'Working';
  const tone: Tone = p.column === 'AWAY' ? 'purple' : p.column === 'NOT_IN' ? (p.absent ? 'red' : 'gray') : p.column === 'ON_BREAK' ? 'amber' : p.column === 'DONE' ? 'blue' : 'green';
  return (
    <ListItem
      divider={divider}
      title={name}
      subtitle={[times, p.employee.department, p.workMode === 'REMOTE' ? 'Remote' : null].filter(Boolean).join(' · ') || p.employee.employeeId}
      left={<Avatar name={name} uri={p.employee.profilePhoto} size={36} />}
      right={
        <View style={styles.right}>
          <Badge tone={tone} dot>
            {status}
          </Badge>
          {p.isLate ? (
            <Text size="xs" weight="semibold" style={{ color: c.warning }}>
              {`Late ${p.lateMinutes}m`}
            </Text>
          ) : null}
        </View>
      }
      onPress={() => router.push({ pathname: '/more/team/[id]', params: { id: p.employee._id } })}
      accessibilityHint="Opens their profile with selfies and locations"
    />
  );
};

/** HR / super admin: everyone's attendance for any day — status, times, lateness; tap for selfie and location. */
export const EveryoneAttendance = () => {
  const { timeZone } = useAuth();
  const today = dateKeyIn(timeZone);
  const [date, setDate] = useState(today);
  const [department, setDepartment] = useState<string | null>(null);
  const [column, setColumn] = useState<BoardColumn | 'ALL'>('ALL');
  const board = useAttendanceBoard(true, { date, departmentId: department });
  const departments = useDepartments(true);
  const cards = board.data?.cards ?? [];
  const count = (k: BoardColumn | 'ALL') => (k === 'ALL' ? cards.length : cards.filter((x) => x.column === k).length);
  const shown = column === 'ALL' ? cards : cards.filter((x) => x.column === column);
  const late = cards.filter((x) => x.isLate).length;

  return (
    <View style={styles.gap}>
      <View style={styles.dayNav}>
        <IconButton icon={ChevronLeft} onPress={() => setDate((d) => addDaysKey(d, -1))} accessibilityLabel="Previous day" />
        <View style={styles.dayTitle}>
          <Text weight="semibold" accessibilityLiveRegion="polite">
            {date === today ? `Today · ${formatKey(date, 'EEE, dd MMM')}` : formatKey(date, 'EEE, dd MMM yyyy')}
          </Text>
          {date !== today ? (
            <Button variant="ghost" onPress={() => setDate(today)}>
              Today
            </Button>
          ) : null}
        </View>
        <IconButton icon={ChevronRight} onPress={() => setDate((d) => addDaysKey(d, 1))} disabled={date >= today} accessibilityLabel="Next day" />
      </View>

      {board.data ? (
        <Card style={styles.summary}>
          {[
            { label: 'Present', value: count('WORKING') + count('ON_BREAK') + count('DONE'), tone: 'green' as Tone },
            { label: 'Late', value: late, tone: 'amber' as Tone },
            { label: 'Not in', value: count('NOT_IN'), tone: 'gray' as Tone },
            { label: 'Away', value: count('AWAY'), tone: 'purple' as Tone },
          ].map((s) => (
            <SummaryTile key={s.label} {...s} />
          ))}
        </Card>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {COLUMNS.filter((k) => k.key === 'ALL' || count(k.key) > 0 || k.key === 'WORKING' || k.key === 'NOT_IN').map((k) => (
          <Chip key={k.key} label={`${k.label} ${count(k.key)}`} tone={k.tone} on={column === k.key} onPress={() => setColumn(k.key)} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {[{ _id: null as string | null, name: 'All departments' }, ...(departments.data ?? [])].map((d) => (
          <Chip key={d._id ?? 'all'} label={d.name} tone="blue" on={department === d._id} onPress={() => setDepartment(d._id)} />
        ))}
      </ScrollView>

      <Card padding={0}>
        {board.isLoading ? (
          <View style={styles.pad}>
            <SkeletonList rows={5} />
          </View>
        ) : board.error ? (
          <ErrorState compact title="Could not load attendance" error={board.error} onRetry={() => void board.refetch()} />
        ) : !shown.length ? (
          <EmptyState compact icon={Users} title="No one here" message="Try another day, status or department." />
        ) : (
          shown.map((p, i) => <Row key={p.employee._id} p={p} divider={i > 0} />)
        )}
      </Card>
    </View>
  );
};

const SummaryTile = ({ label, value, tone }: { label: string; value: number; tone: Tone }) => {
  const { c } = useTheme();
  const t = toneColors(tone, c);
  return (
    <View style={[styles.tile, { backgroundColor: t.bg }]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text size="xl" weight="bold" tabular style={{ color: t.fg }}>
        {value}
      </Text>
      <Text size="xs" weight="semibold" style={{ color: t.fg }}>
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  gap: { gap: space(3) },
  pad: { padding: space(3) },
  dayNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayTitle: { flexDirection: 'row', alignItems: 'center', gap: space(1), flexShrink: 1 },
  summary: { flexDirection: 'row', gap: space(2) },
  tile: { flex: 1, borderRadius: radius.md, paddingVertical: space(2), alignItems: 'center' },
  chips: { gap: space(2), paddingVertical: 2 },
  chip: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: space(3.5), paddingVertical: space(1.5) },
  right: { alignItems: 'flex-end', gap: 4 },
});
