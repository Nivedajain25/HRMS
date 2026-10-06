import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Download, Lock } from 'lucide-react-native';
import { Button, Card, EmptyState, ErrorState, Header, Screen, Skeleton, StatusBadge, Text } from '@/components';
import { monthName } from '@/features/dashboard/lib';
import { DetailCard } from '@/features/profile/kit/detail-list';
import { openProtectedFile } from '@/features/profile/kit/files';
import { ApiError } from '@/lib/api';
import { formatMoney, label } from '@/lib/format';
import { formatDate } from '@/lib/time';
import { radius, space, useTheme } from '@/theme';
import { formatDays, payslipFileName, usePayslip, type Payslip, type PayslipLine } from '../api';

const lineHint = (l: PayslipLine) =>
  l.category === 'ADJUSTMENT'
    ? 'One-time adjustment'
    : l.category === 'LOAN'
      ? 'Loan recovery'
      : l.category === 'ADVANCE'
        ? 'Advance recovery'
        : l.category === 'OVERTIME'
          ? 'Overtime'
          : undefined;

const LineSection = ({
  title,
  lines,
  total,
  totalLabel,
  currency,
  tone = 'default',
  empty,
}: {
  title: string;
  lines: PayslipLine[];
  total: number;
  totalLabel: string;
  currency: string;
  tone?: 'default' | 'negative' | 'muted';
  empty: string;
}) => {
  const { c } = useTheme();
  const amountColor = tone === 'negative' ? c.danger : tone === 'muted' ? c.fg2 : c.fg;
  return (
    <Card padding={0}>
      <View style={styles.sectionHead}>
        <Text size="lg" weight="semibold" accessibilityRole="header">
          {title}
        </Text>
      </View>
      {lines.length === 0 ? (
        <Text size="sm" color="muted" style={styles.emptyLine}>
          {empty}
        </Text>
      ) : (
        lines.map((l, i) => {
          const hint = lineHint(l);
          const name = l.name || label(l.code);
          const amount = formatMoney(l.amount, currency);
          return (
            <View
              key={`${l.code}-${i}`}
              style={[styles.line, { borderTopColor: c.line }]}
              accessible
              accessibilityLabel={`${name}${hint ? `, ${hint}` : ''}: ${amount}`}
            >
              <View style={styles.flex}>
                <Text size="sm">{name}</Text>
                {hint ? (
                  <Text size="xs" color="muted">
                    {hint}
                  </Text>
                ) : null}
              </View>
              <Text size="sm" weight="medium" tabular style={{ color: amountColor }}>
                {amount}
              </Text>
            </View>
          );
        })
      )}
      <View
        style={[styles.line, styles.total, { borderTopColor: c.line, backgroundColor: c.surface2 }]}
        accessible
        accessibilityLabel={`${totalLabel}: ${formatMoney(total, currency)}`}
      >
        <Text size="sm" weight="semibold" style={styles.flex}>
          {totalLabel}
        </Text>
        <Text size="sm" weight="semibold" tabular>
          {formatMoney(total, currency)}
        </Text>
      </View>
    </Card>
  );
};

const DaysGrid = ({ slip }: { slip: Payslip }) => {
  const { c } = useTheme();
  const days: { label: string; value: string }[] = [
    { label: 'Days in period', value: formatDays(slip.daysInPeriod) },
    { label: 'Working days', value: formatDays(slip.workingDays) },
    { label: 'Payable days', value: formatDays(slip.payableDays) },
    { label: 'LOP days', value: formatDays(slip.lopDays) },
    { label: 'Present', value: formatDays(slip.presentDays) },
    { label: 'Paid leave', value: formatDays(slip.paidLeaveDays) },
    { label: 'Unpaid leave', value: formatDays(slip.unpaidLeaveDays) },
    { label: 'Absent', value: formatDays(slip.absentDays) },
    { label: 'Holidays', value: formatDays(slip.holidays) },
    { label: 'Week-offs', value: formatDays(slip.weekOffs) },
    ...(slip.notEmployedDays ? [{ label: 'Not employed', value: formatDays(slip.notEmployedDays) }] : []),
    ...(slip.overtimeHours ? [{ label: 'Overtime (h)', value: formatDays(slip.overtimeHours) }] : []),
  ];
  return (
    <Card style={styles.gap}>
      <Text size="lg" weight="semibold" accessibilityRole="header">
        Days
      </Text>
      <View style={styles.days}>
        {days.map((d) => (
          <View
            key={d.label}
            style={[styles.day, { backgroundColor: c.surface2, borderColor: c.line }]}
            accessible
            accessibilityLabel={`${d.label}: ${d.value}`}
          >
            <Text size="xs" color="muted" numberOfLines={1}>
              {d.label}
            </Text>
            <Text weight="semibold" tabular>
              {d.value}
            </Text>
          </View>
        ))}
      </View>
      {slip.prorationFactor !== undefined && slip.prorationFactor < 1 ? (
        <Text size="xs" color="muted">
          {`Salary prorated at ${(slip.prorationFactor * 100).toFixed(2)}% for this period.`}
        </Text>
      ) : null}
    </Card>
  );
};

export const PayslipDetailScreen = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const query = usePayslip(id);
  const slip = query.data;
  const [downloading, setDownloading] = useState(false);
  const restricted = query.error instanceof ApiError && (query.error.status === 403 || query.error.status === 404);

  const download = async () => {
    if (!slip) return;
    setDownloading(true);
    await openProtectedFile(`/payslips/${slip._id}/pdf`, { fileName: payslipFileName(slip), mimeType: 'application/pdf' });
    setDownloading(false);
  };

  return (
    <Screen
      header={<Header title="Payslip" subtitle={slip ? monthName(slip.month, slip.year) : undefined} back backTo="/more/payslips" />}
      onRefresh={() => query.refetch()}
      footer={
        slip ? (
          <Button icon={Download} fullWidth loading={downloading} onPress={() => void download()}>
            Download PDF
          </Button>
        ) : undefined
      }
    >
      {query.isLoading ? (
        <Card style={styles.gap}>
          <Skeleton width={160} height={20} />
          <Skeleton height={72} />
          <Skeleton height={120} />
        </Card>
      ) : restricted ? (
        <Card>
          <EmptyState icon={Lock} title="Payslip unavailable" message="This payslip does not exist or you do not have access to it." />
        </Card>
      ) : query.error || !slip ? (
        <Card>
          <ErrorState title="Could not load this payslip" error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      ) : (
        <>
          <Card style={styles.gap}>
            <View style={styles.head}>
              <View style={styles.flex}>
                <Text size="xs" color="muted" weight="medium">
                  {`${monthName(slip.month, slip.year).toUpperCase()}${slip.payroll?.isOffCycle ? ' · OFF-CYCLE' : ''}`}
                </Text>
                <Text size="lg" weight="semibold" accessibilityRole="header">
                  {slip.employeeSnapshot.name ?? 'Payslip'}
                </Text>
                <Text size="sm" color="muted">
                  {[slip.employeeSnapshot.employeeId, slip.employeeSnapshot.designation, slip.employeeSnapshot.department].filter(Boolean).join(' · ')}
                </Text>
                {slip.payroll?.periodStart ? (
                  <Text size="xs" color="muted">
                    {`Pay period ${formatDate(slip.payroll.periodStart)} – ${formatDate(slip.payroll.periodEnd)}`}
                  </Text>
                ) : null}
              </View>
              <StatusBadge status={slip.status} />
            </View>
            <View
              style={[styles.net, { backgroundColor: c.accentSoft }]}
              accessible
              accessibilityLabel={`Net pay ${formatMoney(slip.netPay, slip.currency)}`}
            >
              <Text size="xs" color="accent" weight="medium">
                Net pay
              </Text>
              <Text size="3xl" weight="bold" tabular numberOfLines={1} adjustsFontSizeToFit>
                {formatMoney(slip.netPay, slip.currency)}
              </Text>
              <Text size="sm" color="fg2" tabular>
                {`${formatMoney(slip.grossEarnings, slip.currency)} gross − ${formatMoney(slip.totalDeductions, slip.currency)} deductions`}
              </Text>
            </View>
          </Card>

          <LineSection
            title="Earnings"
            lines={slip.earnings}
            total={slip.grossEarnings}
            totalLabel="Gross earnings"
            currency={slip.currency}
            empty="No earnings"
          />
          <LineSection
            title="Deductions"
            lines={slip.deductions}
            total={slip.totalDeductions}
            totalLabel="Total deductions"
            currency={slip.currency}
            tone="negative"
            empty="No deductions"
          />
          {slip.employerContributions?.length ? (
            <LineSection
              title="Employer contributions"
              lines={slip.employerContributions}
              total={slip.employerContributions.reduce((s, l) => s + l.amount, 0)}
              totalLabel="Total (not deducted from your pay)"
              currency={slip.currency}
              tone="muted"
              empty="None"
            />
          ) : null}

          <DaysGrid slip={slip} />

          <DetailCard
            title="Payment"
            items={[
              { label: 'Status', value: label(slip.status) },
              { label: 'Payment date', value: slip.paymentDate ? formatDate(slip.paymentDate) : null },
              { label: 'Mode', value: slip.paymentMode ? label(slip.paymentMode) : null },
              { label: 'Reference', value: slip.paymentReference },
              { label: 'Bank', value: slip.employeeSnapshot.bankName },
              { label: 'Account', value: slip.employeeSnapshot.accountNumberMasked, tabular: true },
            ]}
          />
        </>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space(3) },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space(2) },
  net: { borderRadius: radius.md, padding: space(3), gap: 2 },
  sectionHead: { paddingHorizontal: space(4), paddingTop: space(3), paddingBottom: space(2) },
  emptyLine: { paddingHorizontal: space(4), paddingBottom: space(3) },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space(3),
    paddingHorizontal: space(4),
    paddingVertical: space(2.5),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  total: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  day: { flexGrow: 1, flexBasis: '45%', minWidth: 130, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space(3), paddingVertical: space(2) },
});
