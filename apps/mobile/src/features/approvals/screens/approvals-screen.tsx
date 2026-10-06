import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Banknote, CalendarDays, ClipboardCheck, FileClock, Receipt } from 'lucide-react-native';
import { Card, EmptyState, ErrorState, Header, Screen, SkeletonList, type IconComponent } from '@/components';
import { regularizationKeys, type Regularization } from '@/features/attendance/api';
import { leaveKeys, type LeaveRequest } from '@/features/leave/api';
import { LeaveCard } from '@/features/leave/components/leave-card';
import { ListFooter, usePullToRefresh } from '@/features/leave/components/list-helpers';
import { useAuth } from '@/lib/auth';
import { space } from '@/theme';
import { expenseKeys, useExpenseInbox, useLeaveInbox, useRegularizationInbox, type ExpenseRecord, type Segment } from '../api';
import { ExpenseApprovalCard, RegularizationApprovalCard } from '../components/approval-cards';
import { InboxTabs, type InboxTab } from '../components/inbox-tabs';

type Row =
  | { kind: 'leave'; item: LeaveRequest }
  | { kind: 'attendance'; item: Regularization }
  | { kind: 'expenses' | 'payable'; item: ExpenseRecord };

/** The parts of an infinite query the inbox needs (independent of the row type). */
interface InboxQuery {
  isLoading: boolean;
  error: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  refetch: () => Promise<unknown>;
  fetchNextPage: () => Promise<unknown>;
}

const SEGMENTS: Segment[] = ['leave', 'attendance', 'expenses', 'payable'];
const isSegment = (v: unknown): v is Segment => typeof v === 'string' && (SEGMENTS as string[]).includes(v);

const COPY: Record<Segment, { label: string; icon: IconComponent; emptyTitle: string; emptyMessage: string; error: string }> = {
  leave: {
    label: 'Leave',
    icon: CalendarDays,
    emptyTitle: 'You are all caught up',
    emptyMessage: 'Leave requests awaiting your decision appear here.',
    error: 'Could not load leave requests',
  },
  attendance: {
    label: 'Attendance',
    icon: FileClock,
    emptyTitle: 'No regularizations to review',
    emptyMessage: 'Attendance regularization requests awaiting your decision appear here.',
    error: 'Could not load regularization requests',
  },
  expenses: {
    label: 'Expenses',
    icon: Receipt,
    emptyTitle: 'You are all caught up',
    emptyMessage: 'Expense claims that need your decision appear here.',
    error: 'Could not load expense claims',
  },
  payable: {
    label: 'To pay',
    icon: Banknote,
    emptyTitle: 'Nothing waiting for payment',
    emptyMessage: 'Fully approved claims appear here until they are marked as paid.',
    error: 'Could not load claims to pay',
  },
};

export const ApprovalsScreen = () => {
  const qc = useQueryClient();
  const { can, timeZone } = useAuth();
  const params = useLocalSearchParams<{ segment?: string }>();

  const allowed: Record<Segment, boolean> = {
    leave: can('leave:approve'),
    attendance: can('attendance:approve'),
    expenses: can('expense:approve'),
    payable: can('expense:pay'),
  };
  const leave = useLeaveInbox(allowed.leave);
  const attendance = useRegularizationInbox(allowed.attendance);
  const expenses = useExpenseInbox('approvals', allowed.expenses);
  const payable = useExpenseInbox('payable', allowed.payable);

  const totals: Record<Segment, number | undefined> = {
    leave: leave.data?.pages[0]?.pagination.total,
    attendance: attendance.data?.pages[0]?.pagination.total,
    expenses: expenses.data?.pages[0]?.pagination.total,
    payable: payable.data?.pages[0]?.pagination.total,
  };

  const tabs: InboxTab<Segment>[] = SEGMENTS.filter((s) => allowed[s]).map((s) => ({
    value: s,
    label: COPY[s].label,
    icon: COPY[s].icon,
    count: totals[s],
  }));

  const [selected, setSelected] = useState<Segment | null>(null);
  const requested = selected ?? (isSegment(params.segment) ? params.segment : null);
  const segment = tabs.find((t) => t.value === requested)?.value ?? tabs[0]?.value;

  const rows: Row[] =
    segment === 'leave'
      ? (leave.data?.pages.flatMap((p) => p.data) ?? []).map((item) => ({ kind: 'leave', item }))
      : segment === 'attendance'
        ? (attendance.data?.pages.flatMap((p) => p.data) ?? []).map((item) => ({ kind: 'attendance', item }))
        : segment === 'expenses'
          ? (expenses.data?.pages.flatMap((p) => p.data) ?? []).map((item) => ({ kind: 'expenses', item }))
          : segment === 'payable'
            ? (payable.data?.pages.flatMap((p) => p.data) ?? []).map((item) => ({ kind: 'payable', item }))
            : [];

  const active: InboxQuery | null =
    segment === 'leave' ? leave : segment === 'attendance' ? attendance : segment === 'expenses' ? expenses : segment === 'payable' ? payable : null;

  const refreshControl = usePullToRefresh(() =>
    Promise.all([
      qc.invalidateQueries({ queryKey: leaveKeys.all }),
      qc.invalidateQueries({ queryKey: regularizationKeys.all }),
      qc.invalidateQueries({ queryKey: expenseKeys.all }),
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
    ]),
  );

  const waiting = SEGMENTS.filter((s) => allowed[s] && s !== 'payable').reduce((sum, s) => sum + (totals[s] ?? 0), 0);

  const renderRow = ({ item: row }: { item: Row }) => {
    switch (row.kind) {
      case 'leave':
        return (
          <LeaveCard
            l={row.item}
            showEmployee
            onPress={() => router.push({ pathname: '/approvals/leave/[id]', params: { id: row.item._id } })}
          />
        );
      case 'attendance':
        return (
          <RegularizationApprovalCard
            r={row.item}
            timeZone={timeZone}
            onPress={() => router.push({ pathname: '/approvals/regularization/[id]', params: { id: row.item._id } })}
          />
        );
      default:
        return (
          <ExpenseApprovalCard e={row.item} onPress={() => router.push({ pathname: '/approvals/expense/[id]', params: { id: row.item._id } })} />
        );
    }
  };

  const empty = !segment || !active ? (
    <Card>
      <EmptyState icon={ClipboardCheck} title="Nothing to approve" message="You do not have approval permissions." />
    </Card>
  ) : active.isLoading ? (
    <Card>
      <SkeletonList rows={3} />
    </Card>
  ) : active.error ? (
    <Card>
      <ErrorState title={COPY[segment].error} error={active.error} onRetry={() => void active.refetch()} />
    </Card>
  ) : (
    <Card>
      <EmptyState icon={COPY[segment].icon} title={COPY[segment].emptyTitle} message={COPY[segment].emptyMessage} />
    </Card>
  );

  return (
    <Screen
      inTabs
      scroll={false}
      header={
        <Header
          title="Approvals"
          tone="amber"
          large
          subtitle={
            totals.leave === undefined && totals.attendance === undefined && totals.expenses === undefined
              ? undefined
              : waiting > 0
                ? `${waiting} ${waiting === 1 ? 'request awaits' : 'requests await'} your decision`
                : 'Nothing awaits your decision'
          }
        />
      }
    >
      <FlatList
        data={rows}
        keyExtractor={(row) => `${row.kind}-${row.item._id}`}
        renderItem={renderRow}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          tabs.length > 1 && segment ? (
            <View style={styles.header}>
              <InboxTabs value={segment} tabs={tabs} onChange={setSelected} />
            </View>
          ) : null
        }
        ListEmptyComponent={empty}
        ListFooterComponent={
          active ? (
            <ListFooter
              loading={active.isFetchingNextPage}
              error={active.isFetchNextPageError}
              onRetry={() => void active.fetchNextPage()}
              done={!active.hasNextPage}
              count={rows.length}
            />
          ) : null
        }
        onEndReached={() => {
          if (active?.hasNextPage && !active.isFetchingNextPage && !active.isFetchNextPageError) void active.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={refreshControl}
        contentContainerStyle={styles.content}
      />
    </Screen>
  );
};

const Separator = () => <View style={styles.separator} />;

const styles = StyleSheet.create({
  content: { padding: space(4), paddingBottom: space(8) },
  header: { marginBottom: space(3) },
  separator: { height: space(3) },
});
