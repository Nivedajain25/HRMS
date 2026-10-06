import { StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { Card, EmptyState, ErrorState, Header, Screen, Skeleton } from '@/components';
import { EmployeeSections, ProfileHeaderCard } from '@/features/profile/components/employee-sections';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EmployeeAttendance, QuickActions } from '../components/employee-attendance';
import { fullName } from '@/lib/format';
import { space } from '@/theme';
import { useTeamMember } from '../api';

export const TeamMemberScreen = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useTeamMember(id);
  const { can } = useAuth();
  const orgWide = can('employee:read') && can('attendance:read');
  const e = query.data;
  const restricted = query.error instanceof ApiError && (query.error.status === 403 || query.error.status === 404);

  return (
    <Screen header={<Header title={e ? fullName(e) : 'Profile'} back backTo="/more/team" />} onRefresh={() => query.refetch()}>
      {query.isLoading ? (
        <Card style={styles.skeleton}>
          <Skeleton width={88} height={88} rounded />
          <Skeleton width={180} height={20} />
          <Skeleton width={220} height={14} />
        </Card>
      ) : restricted ? (
        <Card>
          <EmptyState icon={Lock} title="Profile unavailable" message="This person is not in your team, or you do not have access to their profile." />
        </Card>
      ) : query.error || !e ? (
        <Card>
          <ErrorState title="Could not load this profile" error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      ) : (
        <>
          <ProfileHeaderCard e={e} />
          {orgWide ? <QuickActions e={e} /> : null}
          {orgWide ? <EmployeeAttendance employeeId={e._id} /> : null}
          <EmployeeSections e={e} />
        </>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  skeleton: { alignItems: 'center', gap: space(3) },
});
