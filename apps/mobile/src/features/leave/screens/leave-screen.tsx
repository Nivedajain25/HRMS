import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CalendarPlus, UserX } from 'lucide-react-native';
import type { LeaveStatus } from '@stencil/shared';
import { Button, Card, EmptyState, ErrorState, Header, IconButton, Screen, Segmented, SkeletonList, Text } from '@/components';
import { useAuth } from '@/lib/auth';
import { label } from '@/lib/format';
import { dateKeyIn } from '@/lib/time';
import { space, useTheme } from '@/theme';
import { leaveKeys, useLeaveBalances, useLeaveList, type LeaveRequest } from '../api';
import { BalanceStrip } from '../components/balance-strip';
import { LeaveCard } from '../components/leave-card';
import { ListFooter, usePullToRefresh } from '../components/list-helpers';

type Scope = 'me' | 'team' | 'all';
type StatusFilter = 'ALL' | 'PENDING' | Extract<LeaveStatus, 'APPROVED' | 'REJECTED'>;

const EMPTY_COPY: Record<Scope, { title: string; message: string }> = {
  me: { title: 'No leave requests yet', message: 'Requests you apply for or save as drafts appear here.' },
  team: { title: 'No team leave', message: 'Leave requested by your direct and indirect reports appears here.' },
  all: { title: 'No leave requests', message: 'Leave requested by anyone in the organization appears here.' },
};

export const LeaveScreen = () => {
  const { c } = useTheme();
  const qc = useQueryClient();
  const { can, hasEmployee, timeZone } = useAuth();
  const canTeam = can('team:view');
  // HR / super admin: every employee's leave.
  const canAll = can('leave:read');

  const scopes: { value: Scope; label: string }[] = [
    ...(hasEmployee ? [{ value: 'me' as const, label: 'My requests' }] : []),
    ...(canAll ? [{ value: 'all' as const, label: 'Everyone' }] : []),
    ...(canTeam && (hasEmployee || !canAll) ? [{ value: 'team' as const, label: 'Team' }] : []),
  ];
  const [requestedScope, setScope] = useState<Scope>('me');
  const scope = scopes.find((s) => s.value === requestedScope)?.value ?? scopes[0]?.value;

  // Simple filter chips instead of a long status dropdown.
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'REJECTED', label: 'Rejected' },
  ];
  const effectiveStatus = status;

  // Balances for the current year (the year picker made the tab feel crowded).
  const year = Number(dateKeyIn(timeZone).slice(0, 4));

  const balances = useLeaveBalances({ year, enabled: hasEmployee });
  const list = useLeaveList({ scope: scope ?? 'me', status: effectiveStatus === 'ALL' ? undefined : effectiveStatus }, !!scope);
  const items = list.data?.pages.flatMap((p) => p.data) ?? [];
  const total = list.data?.pages[0]?.pagination.total ?? 0;

  const refreshControl = usePullToRefresh(() =>
    Promise.all([qc.invalidateQueries({ queryKey: leaveKeys.all }), qc.invalidateQueries({ queryKey: ['dashboard'] })]),
  );

  const openApply = (typeId?: string) => router.push(typeId ? { pathname: '/leave/apply', params: { typeId } } : '/leave/apply');
  const openRequest = (l: LeaveRequest) => router.push({ pathname: '/leave/[id]', params: { id: l._id } });

  const header = (
    <View style={styles.header}>
      {hasEmployee ? (
        <>
          {/* Title + Apply on one line, then the balance cards. */}
          <View style={styles.balanceHead}>
            <Text size="lg" weight="semibold" accessibilityRole="header" style={styles.flex}>
              {`Leave balance ${year}`}
            </Text>
            <Button size="sm" icon={CalendarPlus} onPress={() => openApply()}>
              Apply leave
            </Button>
          </View>
          <BalanceStrip query={balances} year={year} onApply={openApply} />
        </>
      ) : null}
      {scope ? (
        <>
          <View style={styles.listHead}>
            <Text size="lg" weight="semibold" accessibilityRole="header" style={styles.flex}>
              {scopes.length > 1 ? 'Requests' : scopes[0]?.label}
            </Text>
            {list.data && total > 0 ? (
              <Text size="xs" color="muted" accessibilityLiveRegion="polite">
                {`${total} ${total === 1 ? 'request' : 'requests'}`}
              </Text>
            ) : null}
          </View>
          {scopes.length > 1 ? (
            <Segmented value={scope} options={scopes} onChange={setScope} accessibilityLabel="Whose requests to show" />
          ) : null}
          <Segmented value={effectiveStatus} options={statusOptions} onChange={setStatus} accessibilityLabel="Filter by status" />
        </>
      ) : null}
    </View>
  );

  const empty = !scope ? (
    <Card>
      <EmptyState
        icon={UserX}
        title="No employee profile"
        message="Your account is not linked to an employee profile, so you cannot apply for leave. Contact HR if this is unexpected."
      />
    </Card>
  ) : list.isLoading ? (
    <Card>
      <SkeletonList rows={3} />
    </Card>
  ) : list.error ? (
    <Card>
      <ErrorState title="Could not load leave requests" error={list.error} onRetry={() => void list.refetch()} />
    </Card>
  ) : (
    <Card>
      <EmptyState
        icon={CalendarDays}
        title={effectiveStatus === 'ALL' ? EMPTY_COPY[scope].title : `No ${label(effectiveStatus).toLowerCase()} requests`}
        message={effectiveStatus === 'ALL' ? EMPTY_COPY[scope].message : 'Try a different status.'}
      />
    </Card>
  );

  return (
    <Screen
      inTabs
      scroll={false}
      header={
        <Header
          title="Leave"
          tone="teal"
          large
          right={
            <IconButton
              icon={CalendarDays}
              color={c.fg}
              onPress={() => router.push('/leave/calendar')}
              accessibilityLabel="Team leave calendar"
            />
          }
        />
      }
    >
      <FlatList
        data={scope ? items : []}
        keyExtractor={(l) => l._id}
        renderItem={({ item }) => <LeaveCard l={item} showEmployee={scope !== 'me'} onPress={() => openRequest(item)} />}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          <ListFooter
            loading={list.isFetchingNextPage}
            error={list.isFetchNextPageError}
            onRetry={() => void list.fetchNextPage()}
            done={!list.hasNextPage}
            count={items.length}
          />
        }
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError) void list.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={refreshControl}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      />
    </Screen>
  );
};

const Separator = () => <View style={styles.separator} />;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: space(4), paddingBottom: space(8) },
  header: { gap: space(4), marginBottom: space(3) },
  balanceHead: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  listHead: { flexDirection: 'row', alignItems: 'center', gap: space(2), marginTop: space(1) },
  separator: { height: space(3) },
});
