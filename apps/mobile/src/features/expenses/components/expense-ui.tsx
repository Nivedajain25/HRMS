import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Banknote, CircleCheck, FilePen, Hourglass, Paperclip } from 'lucide-react-native';
import type { ExpenseStatus } from '@stencil/shared';
import { Badge, Card, ErrorState, Skeleton, StatusBadge, Text, type IconComponent } from '@/components';
import { formatMoney, label } from '@/lib/format';
import { formatDate } from '@/lib/time';
import { radius, space, toneColors, useTheme, type Tone } from '@/theme';
import { APPROVER_LABEL, PENDING_STATUSES, type ExpenseRecord, type ExpenseSummary } from '../api';

interface Group {
  key: string;
  label: string;
  statuses: ExpenseStatus[];
  icon: IconComponent;
  tone: Tone;
}

const GROUPS: Group[] = [
  { key: 'pending', label: 'Awaiting approval', statuses: ['SUBMITTED', 'PENDING_APPROVAL'], icon: Hourglass, tone: 'amber' },
  { key: 'approved', label: 'Approved · unpaid', statuses: ['APPROVED'], icon: CircleCheck, tone: 'green' },
  { key: 'paid', label: 'Reimbursed', statuses: ['PAID'], icon: Banknote, tone: 'teal' },
  { key: 'draft', label: 'Drafts', statuses: ['DRAFT'], icon: FilePen, tone: 'gray' },
];

/** Totals per status group and currency (organization currency first) — same grouping as the web. */
export const ExpenseSummaryGrid = ({
  summary,
  loading,
  error,
  onRetry,
  currency,
}: {
  summary: ExpenseSummary | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  currency: string;
}) => {
  const { c } = useTheme();
  if (error && !summary) {
    return (
      <Card>
        <ErrorState compact title="Could not load your totals" error={error} onRetry={onRetry} />
      </Card>
    );
  }
  return (
    <View style={styles.grid}>
      {GROUPS.map((g) => {
        const t = toneColors(g.tone, c);
        const byCurrency = new Map<string, { total: number; count: number }>();
        for (const r of summary?.byStatus ?? []) {
          if (!g.statuses.includes(r.status)) continue;
          const cur = byCurrency.get(r.currency) ?? { total: 0, count: 0 };
          cur.total += r.total;
          cur.count += r.count;
          byCurrency.set(r.currency, cur);
        }
        const primary = byCurrency.get(currency) ?? { total: 0, count: 0 };
        const others = [...byCurrency.entries()].filter(([cur]) => cur !== currency);
        const count = [...byCurrency.values()].reduce((n, v) => n + v.count, 0);
        const hint = [`${count} ${count === 1 ? 'claim' : 'claims'}`, ...others.map(([cur, v]) => `+ ${formatMoney(v.total, cur)}`)].join(' · ');
        const Icon = g.icon;
        return (
          <View
            key={g.key}
            style={[styles.tile, { backgroundColor: c.surface, borderColor: c.line }]}
            accessible
            accessibilityLabel={loading ? `${g.label}: loading` : `${g.label}: ${formatMoney(primary.total, currency)}, ${hint}`}
          >
            <View style={styles.tileHead}>
              <View style={[styles.tileIcon, { backgroundColor: t.bg }]}>
                <Icon size={16} color={t.fg} />
              </View>
              <Text size="xs" color="muted" numberOfLines={2} style={styles.flex}>
                {g.label}
              </Text>
            </View>
            {loading ? (
              <Skeleton height={22} width="70%" />
            ) : (
              <>
                <Text size="lg" weight="bold" tabular numberOfLines={1} adjustsFontSizeToFit>
                  {formatMoney(primary.total, currency)}
                </Text>
                <Text size="xs" color="muted" numberOfLines={2}>
                  {hint}
                </Text>
              </>
            )}
          </View>
        );
      })}
    </View>
  );
};

export const ExpenseCard = ({ e }: { e: ExpenseRecord }) => {
  const { c } = useTheme();
  const amount = formatMoney(e.amount, e.currency);
  const pending = PENDING_STATUSES.includes(e.status);
  return (
    <Card
      onPress={() => router.push({ pathname: '/more/expenses/[id]', params: { id: e._id } })}
      accessibilityLabel={`${e.expenseNumber}, ${label(e.category)}, ${amount}, ${label(e.status)}`}
      accessibilityHint="Opens the expense details"
      style={styles.card}
    >
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text weight="semibold" numberOfLines={1}>
            {e.merchant || label(e.category)}
          </Text>
          <Text size="xs" color="muted" numberOfLines={1}>
            {`${e.expenseNumber} · ${label(e.category)} · ${formatDate(e.date)}`}
          </Text>
        </View>
        <Text weight="bold" tabular>
          {amount}
        </Text>
      </View>
      <Text size="sm" color="fg2" numberOfLines={2}>
        {e.description}
      </Text>
      <View style={styles.foot}>
        <StatusBadge status={e.status} />
        {pending && e.currentApproverType ? <Badge tone="gray">{`Awaiting ${APPROVER_LABEL[e.currentApproverType]}`}</Badge> : null}
        {e.receiptFileId ? <Paperclip size={14} color={c.muted} accessibilityLabel="Receipt attached" /> : null}
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  tile: { flexGrow: 1, flexBasis: '45%', minWidth: 140, borderWidth: 1, borderRadius: radius.lg, padding: space(3), gap: space(1) },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  tileIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  card: { gap: space(2) },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space(3) },
  foot: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space(2) },
});
