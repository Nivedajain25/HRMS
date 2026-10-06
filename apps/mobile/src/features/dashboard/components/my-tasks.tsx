import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { CheckCircle2, Circle, ClipboardList } from 'lucide-react-native';
import { Text, toast } from '@/components';
import { useSetTaskStatus, useTasks, type Task } from '@/features/tasks/api';
import { PRIORITY_META } from '@/features/tasks/components/task-card';
import { toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateKeyIn, formatDate } from '@/lib/time';
import { space, toneColors, TOUCH_TARGET, useTheme } from '@/theme';
import { Widget } from './widgets';

const TaskRow = ({ t, divider }: { t: Task; divider: boolean }) => {
  const { c } = useTheme();
  const { timeZone } = useAuth();
  const setStatus = useSetTaskStatus();
  const overdue = !!t.dueDate && t.dueDate.slice(0, 10) < dateKeyIn(timeZone);
  const p = toneColors(PRIORITY_META[t.priority].tone, c);

  const finish = async () => {
    try {
      await setStatus.mutateAsync({ id: t._id, status: 'DONE' });
      toast.success('Task finished 🎉', 'It has moved to Finished tasks.');
    } catch (err) {
      toast.error('Could not update the task', toApiError(err).message);
    }
  };

  return (
    <View style={[styles.row, divider && { borderTopColor: c.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <Pressable
        onPress={() => void finish()}
        disabled={setStatus.isPending}
        accessibilityRole="button"
        accessibilityLabel={`Mark “${t.title}” as done`}
        hitSlop={6}
        style={styles.check}
      >
        {setStatus.isPending ? <CheckCircle2 size={24} color={c.success} /> : <Circle size={24} color={c.lineStrong} />}
      </Pressable>
      <Pressable onPress={() => router.push({ pathname: '/more/tasks', params: { id: t._id } })} accessibilityRole="button" style={styles.flex}>
        <Text weight="medium" numberOfLines={1}>
          {t.title}
        </Text>
        <View style={styles.meta}>
          <View style={[styles.dot, { backgroundColor: p.solid }]} />
          <Text size="xs" color="muted" numberOfLines={1} style={styles.flex}>
            {[
              `${PRIORITY_META[t.priority].label} priority`,
              t.status === 'IN_PROGRESS' ? 'In progress' : null,
              t.dueDate ? (overdue ? 'Overdue' : `Due ${formatDate(t.dueDate, 'dd MMM')}`) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      </Pressable>
    </View>
  );
};

/** Home: my open tasks; tick the circle to finish one (it moves to Finished tasks). */
export const MyTasks = () => {
  const open = useTasks('mine', 'open');
  return (
    <Widget
      title="My Tasks"
      icon={ClipboardList}
      query={open}
      padding={space(1)}
      isEmpty={(d) => d.length === 0}
      empty={{ icon: CheckCircle2, title: 'No open tasks', message: 'You’re all caught up.' }}
      actionLabel="View all"
      onAction={() => router.push('/more/tasks')}
    >
      {(d) => (
        <View>
          {d.slice(0, 4).map((t, i) => (
            <TaskRow key={t._id} t={t} divider={i > 0} />
          ))}
          {d.length > 4 ? (
            <Text size="xs" color="muted" align="center" style={styles.more}>{`+${d.length - 4} more`}</Text>
          ) : null}
        </View>
      )}
    </Widget>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2), paddingHorizontal: space(2), minHeight: 56 },
  check: { width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  dot: { width: 8, height: 8, borderRadius: 4 },
  more: { paddingVertical: space(2) },
});
