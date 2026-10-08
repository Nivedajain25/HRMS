import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { FileClock, Plus } from 'lucide-react-native';
import { LEAVE_STATUS } from '@stencil/shared';
import { Button, Card, EmptyState, ErrorState, Header, Screen, Select, SkeletonList } from '@/components';
import { useAuth } from '@/lib/auth';
import { label } from '@/lib/format';
import { space } from '@/theme';
import { useMyRegularizations } from '../api';
import { RegularizationCard } from '../components/regularization-card';

type StatusFilter = 'ALL' | (typeof LEAVE_STATUS)[number];
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All statuses' },
  ...LEAVE_STATUS.filter((s) => s !== 'DRAFT').map((s) => ({ value: s, label: label(s) })),
];

export const RegularizationListScreen = () => {
  const { timeZone } = useAuth();
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const list = useMyRegularizations(status === 'ALL' ? undefined : status);
  const items = list.data?.data ?? [];

  return (
    <Screen
      header={<Header title="Regularization" back backTo="/attendance" />}
      onRefresh={() => list.refetch()}
      footer={
        <Button icon={Plus} fullWidth onPress={() => router.push('/attendance/regularizations/new')}>
          New request
        </Button>
      }
    >
      <Select label="Status" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
      {list.isLoading ? (
        <Card>
          <SkeletonList rows={3} />
        </Card>
      ) : list.error ? (
        <Card>
          <ErrorState title="Could not load your requests" error={list.error} onRetry={() => void list.refetch()} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileClock}
            title={status === 'ALL' ? 'No regularization requests yet' : `No ${label(status).toLowerCase()} requests`}
            message="Missed a check-in or checked out late? Request regularization and it goes through your approval chain."
          />
        </Card>
      ) : (
        <View style={styles.list}>
          {items.map((r) => (
            <RegularizationCard key={r._id} r={r} timeZone={timeZone} />
          ))}
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  list: { gap: space(3) },
});
