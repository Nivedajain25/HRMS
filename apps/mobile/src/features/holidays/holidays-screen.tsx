import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, PartyPopper } from 'lucide-react-native';
import { Appear, Badge, Card, EmptyState, ErrorState, Header, IconButton, Screen, SkeletonList, Text } from '@/components';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { label } from '@/lib/format';
import { dateKeyIn, formatKey } from '@/lib/time';
import { radius, space, useTheme } from '@/theme';

interface HolidayOccurrence {
  _id: string;
  name: string;
  /** `YYYY-MM-DD` */
  date: string;
  weekday: string;
  type: string;
  description?: string | null;
}

/** The company holiday calendar for a year (same data as the web Holidays page). */
export const HolidaysScreen = () => {
  const { c } = useTheme();
  const { timeZone } = useAuth();
  const today = dateKeyIn(timeZone);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const q = useQuery({ queryKey: ['holidays', 'list', { year }], queryFn: () => get<HolidayOccurrence[]>('/holidays', { year }) });
  const items = q.data ?? [];
  const nextId = items.find((h) => h.date >= today)?._id;

  return (
    <Screen
      header={
        <Header
          title="Holidays"
          subtitle={q.data ? `${items.length} in ${year}` : 'Company holiday calendar'}
          back
          backTo="/more"
          right={
            <View style={styles.year}>
              <IconButton icon={ChevronLeft} onPress={() => setYear((y) => y - 1)} accessibilityLabel="Previous year" />
              <Text weight="semibold" tabular>
                {String(year)}
              </Text>
              <IconButton icon={ChevronRight} onPress={() => setYear((y) => y + 1)} accessibilityLabel="Next year" />
            </View>
          }
        />
      }
      onRefresh={() => q.refetch()}
    >
      {q.isLoading ? (
        <Card>
          <SkeletonList rows={6} />
        </Card>
      ) : q.error ? (
        <Card>
          <ErrorState title="Could not load holidays" error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={PartyPopper} title={`No holidays in ${year}`} message="HR adds company holidays on the web." />
        </Card>
      ) : (
        <Card padding={0}>
          {items.map((h, i) => {
            const past = h.date < today;
            const next = h._id === nextId;
            return (
              <Appear key={`${h._id}-${h.date}`} index={i} style={[styles.item, i > 0 && { borderTopWidth: 1, borderTopColor: c.line }, past && styles.past]}>
                <View style={[styles.date, { backgroundColor: next ? c.primary : c.surface2 }]}>
                  <Text size="xs" weight="semibold" style={{ color: next ? c.onPrimary : c.accent }}>
                    {formatKey(h.date, 'MMM').toUpperCase()}
                  </Text>
                  <Text size="lg" weight="bold" style={next ? { color: c.onPrimary } : undefined}>
                    {formatKey(h.date, 'd')}
                  </Text>
                </View>
                <View style={styles.flex}>
                  <Text weight="semibold" numberOfLines={2}>
                    {h.name}
                  </Text>
                  <Text size="xs" color="muted">
                    {h.weekday}
                    {h.description ? ` · ${h.description}` : ''}
                  </Text>
                </View>
                {next ? <Badge tone="blue">Next</Badge> : h.type !== 'PUBLIC' ? <Badge tone="gray">{label(h.type)}</Badge> : null}
              </Appear>
            );
          })}
        </Card>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  year: { flexDirection: 'row', alignItems: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(4), paddingVertical: space(3) },
  past: { opacity: 0.55 },
  date: { width: 48, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
