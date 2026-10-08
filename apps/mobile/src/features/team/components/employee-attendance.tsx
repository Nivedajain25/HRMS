import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Camera, ClipboardList, Mail, MapPin, Phone } from 'lucide-react-native';
import { Badge, BottomSheet, Button, Card, EmptyState, ErrorState, SectionHeader, SkeletonList, Text, toast } from '@/components';
import type { EmployeeDetail } from '@/features/profile/api';
import { apiUrl, authHeaders } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatTimeIn, minutesToHours } from '@/lib/time';
import { radius, space, toneColors, useTheme, type Tone } from '@/theme';
import { useEmployeeDays, useEmployeeMonth, type AttendanceDay } from '../api';

const openUrl = (url: string) => Linking.openURL(url).catch(() => toast.error('No app can open this link'));

/** Call / email / give a task — one tap each. */
export const QuickActions = ({ e }: { e: EmployeeDetail }) => (
  <View style={styles.actions}>
    {e.phone ? (
      <Button variant="outline" icon={Phone} onPress={() => void openUrl(`tel:${e.phone!.replace(/\s+/g, '')}`)} style={styles.flex}>
        Call
      </Button>
    ) : null}
    {e.workEmail ? (
      <Button variant="outline" icon={Mail} onPress={() => void openUrl(`mailto:${e.workEmail}`)} style={styles.flex}>
        Email
      </Button>
    ) : null}
    <Button icon={ClipboardList} onPress={() => router.push({ pathname: '/more/tasks/new', params: { to: e._id } })} style={styles.flex}>
      Task
    </Button>
  </View>
);

const Tile = ({ label, value, tone }: { label: string; value: string | number; tone: Tone }) => {
  const { c } = useTheme();
  const t = toneColors(tone, c);
  return (
    <View style={[styles.tile, { backgroundColor: t.bg, borderColor: t.border }]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text size="xl" weight="bold" tabular style={{ color: t.fg }}>
        {value}
      </Text>
      <Text size="xs" weight="semibold" style={{ color: t.fg }}>
        {label}
      </Text>
    </View>
  );
};

const STATUS_TONE: Record<string, Tone> = { PRESENT: 'green', LATE: 'amber', ABSENT: 'red', HALF_DAY: 'amber', LEAVE: 'purple', HOLIDAY: 'blue', WEEK_OFF: 'gray' };

const DayRow = ({ d, divider, onSelfie }: { d: AttendanceDay; divider: boolean; onSelfie: (id: string) => void }) => {
  const { c } = useTheme();
  const { timeZone } = useAuth();
  const loc = d.checkInLocation;
  const hasLoc = typeof loc?.latitude === 'number' && typeof loc?.longitude === 'number';
  const place = loc?.withinOffice === true ? 'In office' : loc?.withinOffice === false ? `${Math.round((loc.distanceMeters ?? 0) / 100) / 10} km away` : 'Location';
  return (
    <View style={[styles.day, divider && { borderTopColor: c.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <View style={styles.dayHead}>
        <Text weight="semibold" style={styles.flex}>
          {formatDate(d.date, 'EEE, dd MMM')}
        </Text>
        <Badge tone={STATUS_TONE[d.status] ?? 'gray'}>{d.status === 'LATE' ? `Late ${d.lateMinutes}m` : d.status.replace('_', ' ').toLowerCase().replace(/^\w/, (x) => x.toUpperCase())}</Badge>
      </View>
      {d.checkIn ? (
        <Text size="sm" color="fg2" tabular>
          {`In ${formatTimeIn(d.checkIn, timeZone)} · Out ${d.checkOut ? formatTimeIn(d.checkOut, timeZone) : '—'}${d.workingMinutes ? ` · ${minutesToHours(d.workingMinutes)}` : ''}${d.workMode === 'REMOTE' ? ' · Remote' : ''}`}
        </Text>
      ) : null}
      {hasLoc && loc?.address ? (
        <View style={styles.address}>
          <MapPin size={12} color={c.fg2} style={styles.addressIcon} />
          <Text size="xs" color="fg2" numberOfLines={2} style={styles.flex}>
            {`${loc.address}${typeof loc.accuracy === 'number' ? ` (±${Math.round(loc.accuracy)} m)` : ''}`}
          </Text>
        </View>
      ) : null}
      {d.checkInPhotoId || hasLoc ? (
        <View style={styles.proof}>
          {d.checkInPhotoId ? (
            <Pressable onPress={() => onSelfie(d.checkInPhotoId!)} accessibilityRole="button" accessibilityLabel="View check-in selfie" style={[styles.proofBtn, { backgroundColor: c.surface2 }]}>
              <Camera size={14} color={c.accent} />
              <Text size="xs" weight="semibold" color="accent">
                Selfie
              </Text>
            </Pressable>
          ) : null}
          {hasLoc ? (
            <Pressable
              onPress={() => void openUrl(`https://www.google.com/maps?q=${loc!.latitude},${loc!.longitude}`)}
              accessibilityRole="link"
              accessibilityLabel="Open check-in location on the map"
              style={[styles.proofBtn, { backgroundColor: c.surface2 }]}
            >
              <MapPin size={14} color={loc?.withinOffice === false ? c.warning : c.accent} />
              <Text size="xs" weight="semibold" color="accent">
                {place}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

/** HR / super admin: this month's totals and the last 7 days with clock-in selfie and location. */
export const EmployeeAttendance = ({ employeeId }: { employeeId: string }) => {
  const month = useEmployeeMonth(employeeId, true);
  const days = useEmployeeDays(employeeId, true);
  const [selfie, setSelfie] = useState<string | null>(null);
  const m = month.data;

  return (
    <View style={styles.gap}>
      <SectionHeader title="Attendance This Month" tone="green" />
      <Card style={styles.gap}>
        {month.isLoading ? (
          <SkeletonList rows={2} />
        ) : month.error ? (
          <ErrorState compact title="Could not load attendance" error={month.error} onRetry={() => void month.refetch()} />
        ) : (
          <View style={styles.tiles}>
            <Tile label="Present" value={m?.present ?? 0} tone="green" />
            <Tile label="Late" value={m?.late ?? 0} tone="amber" />
            <Tile label="Absent" value={m?.absent ?? 0} tone="red" />
            <Tile label="Leave" value={m?.leave ?? 0} tone="purple" />
            <Tile label="WFH" value={m?.workFromHome ?? 0} tone="blue" />
            <Tile label="Hours" value={`${Math.round(m?.totalWorkingHours ?? 0)}h`} tone="teal" />
          </View>
        )}
      </Card>

      <SectionHeader title="Recent Days" tone="blue" />
      <Card padding={0}>
        {days.isLoading ? (
          <View style={styles.pad}>
            <SkeletonList rows={3} />
          </View>
        ) : days.error ? (
          <ErrorState compact title="Could not load recent days" error={days.error} onRetry={() => void days.refetch()} />
        ) : !(days.data ?? []).length ? (
          <EmptyState compact icon={Camera} title="No attendance yet" />
        ) : (
          (days.data ?? []).map((d, i) => <DayRow key={d._id} d={d} divider={i > 0} onSelfie={setSelfie} />)
        )}
      </Card>

      <BottomSheet open={!!selfie} onClose={() => setSelfie(null)} title="Check-in selfie">
        {selfie ? (
          <Image
            source={{ uri: apiUrl(`/api/v1/files/${selfie}`), headers: authHeaders() }}
            style={styles.selfie}
            contentFit="cover"
            accessibilityLabel="Check-in selfie"
          />
        ) : null}
        <Button variant="ghost" onPress={() => setSelfie(null)}>
          Close
        </Button>
      </BottomSheet>
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space(2) },
  pad: { padding: space(3) },
  actions: { flexDirection: 'row', gap: space(2) },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  tile: { flexGrow: 1, flexBasis: '30%', borderWidth: 1, borderRadius: radius.md, paddingVertical: space(2), paddingHorizontal: space(3) },
  day: { padding: space(3), gap: space(1.5) },
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  address: { flexDirection: 'row', alignItems: 'flex-start', gap: space(1) },
  addressIcon: { marginTop: 3 },
  proof: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  proofBtn: { flexDirection: 'row', alignItems: 'center', gap: space(1), borderRadius: radius.full, paddingHorizontal: space(2.5), paddingVertical: space(1) },
  selfie: { width: '100%', maxWidth: 360, alignSelf: 'center', aspectRatio: 3 / 4, borderRadius: radius.lg },
});
