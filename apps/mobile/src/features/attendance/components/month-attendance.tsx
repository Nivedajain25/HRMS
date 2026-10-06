import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { AlarmClock, CalendarX2, ChevronLeft, ChevronRight, FilePenLine, MapPin } from 'lucide-react-native';
import {
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  ListItem,
  SectionHeader,
  Skeleton,
  StatusBadge,
  Text,
  statusTone,
} from '@/components';
import { useAuth } from '@/lib/auth';
import { dateKeyIn, formatKey, formatTimeIn, hoursLabel, minutesToHours, monthBounds, shiftMonth } from '@/lib/time';
import { radius, space, toneColors, useTheme } from '@/theme';
import { useAttendanceList, useAttendanceSummary, type AttendanceRow } from '../api';
import { shiftRange } from '@/lib/format';

const Tile = ({ label, value, dot }: { label: string; value: string | number; dot?: string }) => {
  const { c } = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: c.surface2, borderColor: c.line }]} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={styles.tileLabel}>
        {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
        <Text size="xs" color="muted" numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text size="lg" weight="semibold" tabular>
        {value}
      </Text>
    </View>
  );
};

const DayDetail = ({
  record,
  timeZone,
  today,
  onClose,
}: {
  record: AttendanceRow | null;
  timeZone: string;
  today: string;
  onClose: () => void;
}) => {
  if (!record) return null;
  const key = record.date.slice(0, 10);
  const rows: [string, string][] = [
    ['Clock in', formatTimeIn(record.checkIn, timeZone)],
    ['Clock out', formatTimeIn(record.checkOut, timeZone)],
    ['Worked', minutesToHours(record.workingMinutes)],
    ['Break', minutesToHours(record.breakMinutes)],
    ['Work mode', record.workMode === 'REMOTE' ? 'Remote' : 'Office'],
  ];
  if (record.isLate) rows.push(['Late by', minutesToHours(record.lateMinutes)]);
  if (record.isEarlyDeparture) rows.push(['Left early by', minutesToHours(record.earlyDepartureMinutes)]);
  if (record.overtimeMinutes > 0) rows.push(['Overtime', minutesToHours(record.overtimeMinutes)]);
  if (record.shiftId) rows.push(['Shift', `${record.shiftId.name} (${shiftRange(record.shiftId.startTime, record.shiftId.endTime)})`]);
  if (record.checkInLocation?.latitude != null) rows.push(['Location', 'Captured at clock in']);
  return (
    <BottomSheet
      open
      onClose={onClose}
      title={formatKey(key, 'EEEE, d MMMM yyyy')}
      footer={
        key <= today ? (
          <Button
            variant="outline"
            icon={FilePenLine}
            fullWidth
            onPress={() => {
              onClose();
              router.push({ pathname: '/attendance/regularizations/new', params: { date: key } });
            }}
          >
            Request regularization
          </Button>
        ) : undefined
      }
    >
      <View style={styles.badges}>
        <StatusBadge status={record.status} />
        {record.regularized ? <Badge tone="brand">Regularized</Badge> : null}
      </View>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.detailRow}>
          <Text size="sm" color="muted">
            {k}
          </Text>
          <Text size="sm" weight="medium" tabular style={styles.detailValue}>
            {v}
          </Text>
        </View>
      ))}
      {record.note ? (
        <View style={styles.note}>
          <Text size="sm" color="muted">
            Note
          </Text>
          <Text size="sm">{record.note}</Text>
        </View>
      ) : null}
    </BottomSheet>
  );
};

/**
 * Monthly summary tiles and the day-by-day list of the signed-in user's attendance.
 * `afterSummary` is rendered between the summary and the day list (e.g. the Regularization link).
 */
export const MonthAttendance = ({ afterSummary }: { afterSummary?: ReactNode }) => {
  const { c } = useTheme();
  const { timeZone } = useAuth();
  const today = dateKeyIn(timeZone);
  const currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [selected, setSelected] = useState<AttendanceRow | null>(null);
  const bounds = monthBounds(month);

  const summary = useAttendanceSummary({ from: bounds.from, to: bounds.to });
  const records = useAttendanceList({ from: bounds.from, to: bounds.to });
  const s = summary.data?.employees[0];
  const rows = useMemo(() => [...(records.data?.data ?? [])].sort((a, b) => b.date.localeCompare(a.date)), [records.data]);
  const monthLabel = formatKey(`${month}-01`, 'MMMM yyyy');

  return (
    <View style={styles.gap}>
      <View style={styles.monthNav}>
        <IconButton icon={ChevronLeft} onPress={() => setMonth((m) => shiftMonth(m, -1))} accessibilityLabel="Previous month" />
        <View style={styles.monthTitle}>
          <Text size="lg" weight="semibold" accessibilityLiveRegion="polite" accessibilityRole="header">
            {monthLabel}
          </Text>
          {month !== currentMonth ? (
            <Button variant="ghost" onPress={() => setMonth(currentMonth)}>
              This month
            </Button>
          ) : null}
        </View>
        <IconButton
          icon={ChevronRight}
          onPress={() => setMonth((m) => shiftMonth(m, 1))}
          accessibilityLabel="Next month"
          disabled={month >= currentMonth}
        />
      </View>

      <Card>
        {summary.error ? (
          <ErrorState compact title="Could not load the summary" error={summary.error} onRetry={() => void summary.refetch()} />
        ) : (
          <View style={styles.tiles}>
            {summary.isLoading
              ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={60} style={styles.tileSkeleton} />)
              : [
                  <Tile key="p" label="Present" value={s?.present ?? 0} dot={toneColors('green', c).solid} />,
                  <Tile key="a" label="Absent" value={s?.absent ?? 0} dot={toneColors('red', c).solid} />,
                  <Tile key="l" label="Late" value={s?.late ?? 0} dot={toneColors('amber', c).solid} />,
                  <Tile key="h" label="Half day" value={s?.halfDay ?? 0} dot="#f97316" />,
                  <Tile key="lv" label="Leave" value={s?.leave ?? 0} dot={toneColors('purple', c).solid} />,
                  <Tile key="hd" label="Holiday" value={s?.holiday ?? 0} dot="#d946ef" />,
                  <Tile key="w" label="WFH" value={s?.workFromHome ?? 0} dot={toneColors('blue', c).solid} />,
                  <Tile key="t" label="Total hours" value={hoursLabel(s?.totalWorkingHours)} />,
                  <Tile key="o" label="Overtime" value={hoursLabel(s?.overtimeHours)} />,
                ]}
          </View>
        )}
      </Card>

      {afterSummary}

      <SectionHeader title="Days" count={records.data ? rows.length : undefined} />
      <Card padding={0}>
        {records.isLoading ? (
          <View style={styles.pad}>
            <Skeleton height={48} />
            <Skeleton height={48} />
            <Skeleton height={48} />
          </View>
        ) : records.error ? (
          <ErrorState compact title="Could not load attendance" error={records.error} onRetry={() => void records.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState compact icon={CalendarX2} title="No attendance recorded" message={`Nothing recorded for ${monthLabel}.`} />
        ) : (
          rows.map((r, i) => {
            const key = r.date.slice(0, 10);
            const times = r.checkIn
              ? `${formatTimeIn(r.checkIn, timeZone)} – ${r.checkOut ? formatTimeIn(r.checkOut, timeZone) : 'now'}`
              : 'No clock-in';
            return (
              <ListItem
                key={r._id}
                divider={i > 0}
                title={formatKey(key, 'EEE, dd MMM')}
                subtitle={`${times} · ${minutesToHours(r.workingMinutes)}`}
                left={<View style={[styles.statusBar, { backgroundColor: toneColors(statusTone(r.status), c).solid }]} />}
                right={
                  <View style={styles.rowRight}>
                    <StatusBadge status={r.status} />
                    <View style={styles.icons}>
                      {r.isLate ? <AlarmClock size={14} color={c.warning} accessibilityLabel="Late" /> : null}
                      {r.checkInLocation?.latitude != null ? (
                        <MapPin size={14} color={c.muted} accessibilityLabel="Location captured" />
                      ) : null}
                    </View>
                  </View>
                }
                onPress={() => setSelected(r)}
                accessibilityHint="Shows the day's details"
              />
            );
          })
        )}
      </Card>
      <DayDetail record={selected} timeZone={timeZone} today={today} onClose={() => setSelected(null)} />
    </View>
  );
};

const styles = StyleSheet.create({
  gap: { gap: space(3) },
  pad: { padding: space(4), gap: space(3) },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthTitle: { flexDirection: 'row', alignItems: 'center', gap: space(1), flexShrink: 1 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  tile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 88,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
  },
  tileSkeleton: { flexGrow: 1, flexBasis: '30%' },
  tileLabel: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  rowRight: { alignItems: 'flex-end', gap: space(1) },
  icons: { flexDirection: 'row', gap: space(1) },
  badges: { flexDirection: 'row', gap: space(2) },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space(3), paddingVertical: space(1) },
  detailValue: { flexShrink: 1, textAlign: 'right' },
  note: { gap: space(1) },
});
