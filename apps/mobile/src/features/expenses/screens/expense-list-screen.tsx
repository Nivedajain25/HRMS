import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Receipt } from 'lucide-react-native';
import { EXPENSE_STATUS, type ExpenseStatus } from '@stencil/shared';
import { Button, Card, EmptyState, ErrorState, Header, Screen, SkeletonList } from '@/components';
import { FilterChips } from '@/features/profile/kit/filter-chips';
import { flattenPages, LoadMore, totalOf } from '@/features/profile/kit/infinite';
import { useAuth } from '@/lib/auth';
import { label } from '@/lib/format';
import { space } from '@/theme';
import { expenseKeys, useCanClaim, useMyExpenses, useMyExpenseSummary } from '../api';
import { ExpenseCard, ExpenseSummaryGrid } from '../components/expense-ui';

type Filter = 'ALL' | ExpenseStatus;
const FILTERS: { value: Filter; label: string }[] = [{ value: 'ALL', label: 'All' }, ...EXPENSE_STATUS.map((s) => ({ value: s, label: label(s) }))];

export const ExpenseListScreen = () => {
  const { user } = useAuth();
  const canClaim = useCanClaim();
  const qc = useQueryClient();
  const [status, setStatus] = useState<Filter>('ALL');
  const list = useMyExpenses(status === 'ALL' ? undefined : status);
  const summary = useMyExpenseSummary();
  const items = flattenPages(list.data);
  const currency = user?.organization.currency ?? 'USD';

  return (
    <Screen
      header={<Header title="Expenses" subtitle="Your reimbursement claims" back backTo="/more" />}
      onRefresh={() => qc.invalidateQueries({ queryKey: expenseKeys.all })}
      footer={
        canClaim ? (
          <Button icon={Plus} fullWidth onPress={() => router.push('/more/expenses/new')}>
            New expense
          </Button>
        ) : undefined
      }
    >
      <ExpenseSummaryGrid
        summary={summary.data}
        loading={summary.isLoading}
        error={summary.error}
        onRetry={() => void summary.refetch()}
        currency={currency}
      />
      <FilterChips accessibilityLabel="Status" value={status} options={FILTERS} onChange={setStatus} />
      {list.isLoading ? (
        <Card>
          <SkeletonList rows={3} />
        </Card>
      ) : list.error ? (
        <Card>
          <ErrorState title="Could not load your expenses" error={list.error} onRetry={() => void list.refetch()} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={Receipt}
            title={status === 'ALL' ? 'No expenses yet' : `No ${label(status).toLowerCase()} expenses`}
            message={
              status !== 'ALL'
                ? 'Try another status.'
                : canClaim
                  ? 'Snap a photo of your receipt and submit your first claim.'
                  : 'Your account is not linked to an employee profile.'
            }
          />
        </Card>
      ) : (
        <View style={styles.list}>
          {items.map((e) => (
            <ExpenseCard key={e._id} e={e} />
          ))}
          <LoadMore
            hasNextPage={list.hasNextPage}
            isFetchingNextPage={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
            shown={items.length}
            total={totalOf(list.data)}
            noun="expenses"
          />
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  list: { gap: space(3) },
});
