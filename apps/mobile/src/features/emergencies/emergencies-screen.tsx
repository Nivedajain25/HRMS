import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Siren } from 'lucide-react-native';
import { Appear, Card, EmptyState, ErrorState, Header, Screen, Segmented, SkeletonList } from '@/components';
import { useAuth } from '@/lib/auth';
import { space } from '@/theme';
import { emergencyKeys, useActiveEmergencies, useResolvedEmergencies } from './api';
import { EmergencyCard } from './emergency-card';

type Tab = 'active' | 'resolved';

/** HR / super admin: live emergency alerts (acknowledge / resolve) and the history. */
export const EmergenciesScreen = () => {
  const qc = useQueryClient();
  const { can } = useAuth();
  const allowed = can('emergency:manage');
  const [tab, setTab] = useState<Tab>('active');
  const active = useActiveEmergencies(allowed);
  const resolved = useResolvedEmergencies(allowed && tab === 'resolved');
  const q = tab === 'active' ? active : resolved;
  const items = q.data ?? [];

  return (
    <Screen
      header={<Header title="Emergencies" subtitle={active.data?.length ? `${active.data.length} need attention` : 'No active alerts'} back backTo="/more" />}
      onRefresh={() => qc.invalidateQueries({ queryKey: emergencyKeys.all })}
    >
      {!allowed ? (
        <Card>
          <EmptyState icon={Siren} title="Not available" message="Only HR can see and respond to emergency alerts." />
        </Card>
      ) : (
        <>
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            accessibilityLabel="Which alerts"
            options={[
              { value: 'active', label: `Active${active.data?.length ? ` ${active.data.length}` : ''}`, icon: Siren },
              { value: 'resolved', label: 'Resolved', icon: CheckCircle2 },
            ]}
          />
          {q.isLoading ? (
            <Card>
              <SkeletonList rows={3} />
            </Card>
          ) : q.error ? (
            <Card>
              <ErrorState title="Could not load emergencies" error={q.error} onRetry={() => void q.refetch()} />
            </Card>
          ) : !items.length ? (
            <Card>
              <EmptyState
                icon={tab === 'active' ? CheckCircle2 : Siren}
                title={tab === 'active' ? 'No active emergencies' : 'No resolved emergencies yet'}
                message={tab === 'active' ? 'When an employee raises an emergency it appears here straight away.' : undefined}
              />
            </Card>
          ) : (
            <View style={styles.list}>
              {items.map((e, i) => (
                <Appear key={e._id} index={i}>
                  <EmergencyCard e={e} />
                </Appear>
              ))}
            </View>
          )}
        </>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  list: { gap: space(3) },
});
