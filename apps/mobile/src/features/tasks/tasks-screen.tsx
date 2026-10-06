import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList, Plus, Send } from 'lucide-react-native';
import { Appear, Card, EmptyState, ErrorState, Header, IconButton, Screen, Segmented, SkeletonList } from '@/components';
import { useAuth } from '@/lib/auth';
import { space, useTheme } from '@/theme';
import { taskKeys, useAssignable, useMarkTasksSeen, useTasks, type TaskScope, type TaskState } from './api';
import { TaskCard } from './components/task-card';

type View_ = 'todo' | 'finished' | 'assigned';

const VIEW_QUERY: Record<View_, { scope: TaskScope; state?: TaskState }> = {
  todo: { scope: 'mine', state: 'open' },
  finished: { scope: 'mine', state: 'done' },
  assigned: { scope: 'assigned' },
};

const EMPTY: Record<View_, { title: string; message: string }> = {
  todo: { title: 'No open tasks', message: 'You’re all caught up. Tasks from your manager or head will show up here.' },
  finished: { title: 'Nothing finished yet', message: 'Tasks you mark as done move here.' },
  assigned: { title: 'You haven’t assigned any tasks', message: 'Tap + to give someone in your team a task.' },
};

/** My tasks (to do / finished) and, for managers, heads and HR, the tasks they assigned. */
export const TasksScreen = () => {
  const { c } = useTheme();
  const qc = useQueryClient();
  const { hasEmployee } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const assignable = useAssignable();
  const canAssign = (assignable.data?.length ?? 0) > 0;
  const markSeen = useMarkTasksSeen();

  const views: { value: View_; label: string; icon?: typeof ClipboardList }[] = [
    ...(hasEmployee
      ? [
          { value: 'todo' as const, label: 'To do', icon: ClipboardList },
          { value: 'finished' as const, label: 'Finished', icon: CheckCircle2 },
        ]
      : []),
    ...(canAssign ? [{ value: 'assigned' as const, label: 'Assigned', icon: Send }] : []),
  ];
  const [requested, setView] = useState<View_>('todo');
  const view = views.find((v) => v.value === requested)?.value ?? views[0]?.value ?? 'todo';
  const q = VIEW_QUERY[view];
  const list = useTasks(q.scope, q.state, !!views.length);
  const items = list.data ?? [];

  // Opening the screen (or a task from a notification) counts as having seen my new tasks.
  useEffect(() => {
    if (hasEmployee) markSeen.mutate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened task
  }, [hasEmployee, id]);

  return (
    <Screen
      header={
        <Header
          title="Tasks"
          subtitle={view === 'assigned' ? 'Tasks you gave your team' : 'Work assigned to you'}
          back
          backTo="/more"
          right={canAssign ? <IconButton icon={Plus} color={c.fg} onPress={() => router.push('/more/tasks/new')} accessibilityLabel="Assign a task" /> : undefined}
        />
      }
      onRefresh={() => qc.invalidateQueries({ queryKey: taskKeys.all })}
    >
      {views.length > 1 ? <Segmented value={view} options={views} onChange={setView} accessibilityLabel="Which tasks to show" /> : null}

      {!views.length ? (
        <Card>
          <EmptyState icon={ClipboardList} title="No tasks" message="Your account isn’t linked to an employee profile." />
        </Card>
      ) : list.isLoading ? (
        <Card>
          <SkeletonList rows={3} />
        </Card>
      ) : list.error ? (
        <Card>
          <ErrorState title="Could not load tasks" error={list.error} onRetry={() => void list.refetch()} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={view === 'finished' ? CheckCircle2 : ClipboardList} title={EMPTY[view].title} message={EMPTY[view].message} />
        </Card>
      ) : (
        <View style={styles.list}>
          {items.map((t, i) => (
            <Appear key={t._id} index={i}>
              <TaskCard task={t} mode={view === 'assigned' ? 'assigned' : 'mine'} highlight={t._id === id} />
            </Appear>
          ))}
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  list: { gap: space(3) },
});
