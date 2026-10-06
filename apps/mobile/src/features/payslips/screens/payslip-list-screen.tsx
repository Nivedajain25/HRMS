import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { FileText, UserX } from 'lucide-react-native';
import { Card, EmptyState, ErrorState, Header, Screen, Skeleton, StatusBadge, Text } from '@/components';
import { FilterChips } from '@/features/profile/kit/filter-chips';
import { flattenPages, LoadMore, totalOf } from '@/features/profile/kit/infinite';
import { monthName } from '@/features/dashboard/lib';
import { useAuth } from '@/lib/auth';
import { formatMoney, label } from '@/lib/format';
import { dateKeyIn, formatDate } from '@/lib/time';
import { radius, space, useTheme } from '@/theme';
import { formatDays, useMyPayslips, type Payslip } from '../api';

const Figure = ({ title, value }: { title: string; value: string }) => (
  <View style={styles.figure}>
    <Text size="xs" color="muted" numberOfLines={1}>
      {title}
    </Text>
    <Text size="sm" weight="medium" tabular numberOfLines={1} adjustsFontSizeToFit>
      {value}
    </Text>
  </View>
);

const PayslipCard = ({ slip }: { slip: Payslip }) => {
  const { c } = useTheme();
  const period = monthName(slip.month, slip.year);
  const net = formatMoney(slip.netPay, slip.currency);
  return (
    <Card
      onPress={() => router.push({ pathname: '/more/payslips/[id]', params: { id: slip._id } })}
      accessibilityLabel={`Payslip ${period}, net pay ${net}, ${label(slip.status)}`}
      accessibilityHint="Opens the payslip breakdown"
      style={styles.card}
    >
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text weight="semibold">{period}</Text>
          <Text size="xs" color="muted">
            {slip.paymentDate ? `Paid ${formatDate(slip.paymentDate)}` : 'Awaiting payment'}
          </Text>
        </View>
        <StatusBadge status={slip.status} />
      </View>
      <View style={[styles.net, { backgroundColor: c.accentSoft }]}>
        <Text size="xs" color="accent" weight="medium">
          Net pay
        </Text>
        <Text size="2xl" weight="bold" tabular numberOfLines={1} adjustsFontSizeToFit>
          {net}
        </Text>
      </View>
      <View style={styles.figures}>
        <Figure title="Gross" value={formatMoney(slip.grossEarnings, slip.currency)} />
        <Figure title="Deductions" value={formatMoney(slip.totalDeductions, slip.currency)} />
        <Figure title="Paid days" value={formatDays(slip.payableDays)} />
      </View>
    </Card>
  );
};

export const PayslipListScreen = () => {
  const { hasEmployee, timeZone } = useAuth();
  const thisYear = Number(dateKeyIn(timeZone).slice(0, 4));
  const [year, setYear] = useState<string>('ALL');
  const list = useMyPayslips(year === 'ALL' ? undefined : Number(year));
  const items = flattenPages(list.data);
  const yearOptions = useMemo(
    () => [{ value: 'ALL', label: 'All years' }, ...Array.from({ length: 5 }, (_, i) => ({ value: String(thisYear - i), label: String(thisYear - i) }))],
    [thisYear],
  );

  return (
    <Screen header={<Header title="Payslips" back backTo="/more" />} onRefresh={hasEmployee ? () => list.refetch() : undefined}>
      {!hasEmployee ? (
        <Card>
          <EmptyState icon={UserX} title="No employee profile" message="Payslips are available to users linked to an employee record." />
        </Card>
      ) : (
        <>
          <Text size="sm" color="muted">
            Payslips appear once payroll is approved.
          </Text>
          <FilterChips accessibilityLabel="Year" value={year} options={yearOptions} onChange={setYear} />
          {list.isLoading ? (
            <View style={styles.list}>
              {[0, 1].map((i) => (
                <Card key={i} style={styles.card}>
                  <Skeleton width={140} height={18} />
                  <Skeleton height={56} />
                  <Skeleton height={32} />
                </Card>
              ))}
            </View>
          ) : list.error ? (
            <Card>
              <ErrorState title="Could not load your payslips" error={list.error} onRetry={() => void list.refetch()} />
            </Card>
          ) : items.length === 0 ? (
            <Card>
              <EmptyState
                icon={FileText}
                title={year === 'ALL' ? 'No payslips yet' : `No payslips for ${year}`}
                message={year === 'ALL' ? 'Your payslips will appear here after your first payroll is approved.' : 'Try another year.'}
              />
            </Card>
          ) : (
            <View style={styles.list}>
              {items.map((s) => (
                <PayslipCard key={s._id} slip={s} />
              ))}
              <LoadMore
                hasNextPage={list.hasNextPage}
                isFetchingNextPage={list.isFetchingNextPage}
                onLoadMore={() => void list.fetchNextPage()}
                shown={items.length}
                total={totalOf(list.data)}
                noun="payslips"
              />
            </View>
          )}
        </>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: space(3) },
  card: { gap: space(3) },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space(2) },
  net: { borderRadius: radius.md, paddingHorizontal: space(3), paddingVertical: space(2) },
  figures: { flexDirection: 'row', gap: space(2) },
  figure: { flex: 1, gap: 2 },
});
