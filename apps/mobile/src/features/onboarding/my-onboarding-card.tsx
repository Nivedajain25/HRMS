import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardCheck, Circle, PartyPopper } from 'lucide-react-native';
import { Card, ListItem, ProgressBar, SectionHeader, Text, toast } from '@/components';
import { getPaged, patch, toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/time';
import { space, useTheme } from '@/theme';

interface OnboardingTask {
  _id: string;
  title: string;
  description?: string | null;
  assignee: 'EMPLOYEE' | 'HR' | 'MANAGER' | 'IT';
  dueDate?: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
}

interface Onboarding {
  _id: string;
  employeeId: { _id: string } | null;
  templateId?: { name: string } | null;
  status: string;
  progress: number;
  tasks: OnboardingTask[];
}

const KEY = ['onboarding', 'mine', 'mobile'] as const;

/**
 * Home card for a new joiner's onboarding checklist: the tasks assigned to them, tick to complete.
 * Hidden when there is no onboarding in progress (same as the web "My onboarding" card).
 */
export const MyOnboardingCard = () => {
  const { c } = useTheme();
  const { user, hasEmployee } = useAuth();
  const qc = useQueryClient();
  const employeeId = user?.employeeId ?? null;
  const q = useQuery({
    queryKey: KEY,
    queryFn: async () => (await getPaged<Onboarding>('/onboarding', { limit: 10 })).data.find((o) => o.employeeId?._id === employeeId) ?? null,
    enabled: hasEmployee && !!employeeId,
  });
  const complete = useMutation({
    mutationFn: (v: { onboardingId: string; taskId: string }) => patch<Onboarding>(`/onboarding/${v.onboardingId}/tasks/${v.taskId}`, { status: 'COMPLETED' }),
    onSuccess: () => {
      toast.success('Task done');
      return Promise.all([qc.invalidateQueries({ queryKey: KEY }), qc.invalidateQueries({ queryKey: ['dashboard'] })]);
    },
    onError: (err) => toast.error('Could not update the task', toApiError(err).message),
  });

  const o = q.data;
  if (!o || o.status === 'COMPLETED') return null;
  const mine = o.tasks.filter((t) => t.assignee === 'EMPLOYEE');
  const open = mine.filter((t) => t.status !== 'COMPLETED' && t.status !== 'SKIPPED');
  if (!mine.length) return null;

  return (
    <View style={styles.wrap}>
      <SectionHeader title="My onboarding" icon={ClipboardCheck} tone="blue" />
      <Card padding={0}>
        <View style={styles.head}>
          <View style={styles.line}>
            <Text size="sm" color="fg2" style={styles.shrink}>
              {open.length ? `${open.length} task${open.length === 1 ? '' : 's'} left for you` : 'All your tasks are done'}
            </Text>
            {open.length ? null : <PartyPopper size={14} color={c.success} />}
          </View>
          <ProgressBar value={o.progress} accessibilityLabel="Onboarding progress" />
        </View>
        {mine.map((t) => {
          const done = t.status === 'COMPLETED' || t.status === 'SKIPPED';
          return (
            <ListItem
              key={t._id}
              divider
              title={t.title}
              subtitle={done ? 'Done' : t.dueDate ? `Due ${formatDate(t.dueDate)}` : t.description ?? undefined}
              left={done ? <CheckCircle2 size={22} color={c.success} /> : <Circle size={22} color={c.muted} />}
              onPress={done || complete.isPending ? undefined : () => complete.mutate({ onboardingId: o._id, taskId: t._id })}
              accessibilityHint={done ? undefined : 'Marks this task as done'}
            />
          );
        })}
      </Card>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: space(2) },
  head: { gap: space(2), padding: space(4) },
  line: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  shrink: { flexShrink: 1 },
});
