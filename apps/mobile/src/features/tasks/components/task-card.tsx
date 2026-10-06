import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CalendarClock, CheckCircle2, Play, RotateCcw, Trash2, UserRound } from 'lucide-react-native';
import { Avatar, Badge, BottomSheet, Button, Card, IconButton, Text, TextField, toast, useConfirm } from '@/components';
import { toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fullName } from '@/lib/format';
import { dateKeyIn, formatDate, timeAgo } from '@/lib/time';
import { space, useTheme, type Tone } from '@/theme';
import { useDeleteTask, useSetTaskStatus, type Task, type TaskPriority, type TaskStatus } from '../api';

export const PRIORITY_META: Record<TaskPriority, { label: string; tone: Tone }> = {
  HIGH: { label: 'High', tone: 'red' },
  MEDIUM: { label: 'Medium', tone: 'amber' },
  LOW: { label: 'Low', tone: 'gray' },
};
export const STATUS_META: Record<TaskStatus, { label: string; tone: Tone }> = {
  TODO: { label: 'To do', tone: 'gray' },
  IN_PROGRESS: { label: 'In progress', tone: 'blue' },
  DONE: { label: 'Done', tone: 'green' },
};

/** "Mark as done" with an optional note on what was done. */
const DoneSheet = ({ task, onClose }: { task: Task; onClose: () => void }) => {
  const setStatus = useSetTaskStatus();
  const [note, setNote] = useState('');
  const save = async () => {
    try {
      await setStatus.mutateAsync({ id: task._id, status: 'DONE', note: note.trim() || undefined });
      toast.success('Task finished 🎉', 'It has moved to Finished tasks.');
      onClose();
    } catch (err) {
      toast.error('Could not update the task', toApiError(err).message);
    }
  };
  return (
    <BottomSheet open onClose={onClose} title="Mark as done?" description={task.title}>
      <TextField label="Note (optional)" value={note} onChangeText={setNote} multiline placeholder="What did you get done?" maxLength={1000} />
      <Button icon={CheckCircle2} variant="success" loading={setStatus.isPending} onPress={() => void save()}>
        Mark as done
      </Button>
      <Button variant="ghost" onPress={onClose}>
        Cancel
      </Button>
    </BottomSheet>
  );
};

/**
 * One task. `mine`: I'm the assignee (Start / Mark as done / Reopen); `assigned`: I gave it out (shows who has it,
 * delete). `highlight` outlines the task opened from a notification.
 */
export const TaskCard = ({ task, mode, highlight }: { task: Task; mode: 'mine' | 'assigned'; highlight?: boolean }) => {
  const { c } = useTheme();
  const { timeZone } = useAuth();
  const setStatus = useSetTaskStatus();
  const remove = useDeleteTask();
  const confirm = useConfirm();
  const [finishing, setFinishing] = useState(false);

  const done = task.status === 'DONE';
  const overdue = !done && !!task.dueDate && task.dueDate.slice(0, 10) < dateKeyIn(timeZone);
  const from = task.assignedBy ? fullName(task.assignedBy) : task.assignedByName;
  const lastNote = task.notes.at(-1);

  const move = async (status: TaskStatus, success: string) => {
    try {
      await setStatus.mutateAsync({ id: task._id, status });
      toast.success(success);
    } catch (err) {
      toast.error('Could not update the task', toApiError(err).message);
    }
  };

  const onDelete = async () => {
    const { confirmed } = await confirm({ title: 'Delete this task?', message: `“${task.title}” will be removed for ${task.assigneeId.firstName}.`, confirmLabel: 'Delete', tone: 'danger' });
    if (!confirmed) return;
    try {
      await remove.mutateAsync(task._id);
      toast.success('Task deleted');
    } catch (err) {
      toast.error('Could not delete the task', toApiError(err).message);
    }
  };

  return (
    <Card style={[styles.card, highlight && { borderColor: c.primary, borderWidth: 2 }]}>
      <View style={styles.row}>
        <Text weight="semibold" numberOfLines={2} style={[styles.flex, done && styles.doneTitle, done && { color: c.muted }]}>
          {task.title}
        </Text>
        {mode === 'assigned' || task.status === 'IN_PROGRESS' ? (
          <Badge tone={STATUS_META[task.status].tone} dot>
            {STATUS_META[task.status].label}
          </Badge>
        ) : null}
        {!done ? <Badge tone={PRIORITY_META[task.priority].tone}>{PRIORITY_META[task.priority].label}</Badge> : null}
      </View>

      {task.description ? (
        <Text size="sm" color="fg2" numberOfLines={done ? 2 : 4}>
          {task.description}
        </Text>
      ) : null}

      {mode === 'assigned' ? (
        <View style={styles.row}>
          <Avatar name={fullName(task.assigneeId)} uri={task.assigneeId.profilePhoto} size={24} />
          <Text size="sm" weight="medium" numberOfLines={1} style={styles.flex}>
            {fullName(task.assigneeId)}
          </Text>
        </View>
      ) : null}

      <View style={styles.meta}>
        {task.dueDate && !done ? (
          <View style={styles.metaItem}>
            <CalendarClock size={13} color={overdue ? c.danger : c.muted} />
            <Text size="xs" weight={overdue ? 'semibold' : 'regular'} style={{ color: overdue ? c.danger : c.muted }}>
              {overdue ? `Overdue · was due ${formatDate(task.dueDate)}` : `Due ${formatDate(task.dueDate)}`}
            </Text>
          </View>
        ) : null}
        {done ? (
          <View style={styles.metaItem}>
            <CheckCircle2 size={13} color={c.success} />
            <Text size="xs" style={{ color: c.success }}>{`Finished ${timeAgo(task.completedAt)}`}</Text>
          </View>
        ) : null}
        {mode === 'mine' && from ? (
          <View style={styles.metaItem}>
            <UserRound size={13} color={c.muted} />
            <Text size="xs" color="muted" numberOfLines={1}>{`From ${from} · ${timeAgo(task.createdAt)}`}</Text>
          </View>
        ) : null}
      </View>

      {lastNote ? (
        <View style={[styles.note, { backgroundColor: c.surface2 }]}>
          <Text size="xs" color="fg2" numberOfLines={3}>{`“${lastNote.text}”${lastNote.byName ? ` — ${lastNote.byName}` : ''}`}</Text>
        </View>
      ) : null}

      {mode === 'mine' && !done ? (
        <View style={styles.actions}>
          {task.status === 'TODO' ? (
            <Button variant="outline" icon={Play} loading={setStatus.isPending} onPress={() => void move('IN_PROGRESS', 'Task started')} style={styles.flex}>
              Start
            </Button>
          ) : null}
          <Button variant="success" icon={CheckCircle2} onPress={() => setFinishing(true)} style={styles.flex}>
            Mark as done
          </Button>
        </View>
      ) : null}
      {mode === 'mine' && done ? (
        <Button variant="ghost" icon={RotateCcw} loading={setStatus.isPending} onPress={() => void move('IN_PROGRESS', 'Task reopened')}>
          Reopen
        </Button>
      ) : null}
      {mode === 'assigned' ? (
        <View style={styles.assignedFoot}>
          <Text size="xs" color="muted">{`Assigned ${timeAgo(task.createdAt)}`}</Text>
          <IconButton icon={Trash2} color={c.danger} onPress={() => void onDelete()} accessibilityLabel={`Delete task ${task.title}`} />
        </View>
      ) : null}

      {finishing ? <DoneSheet task={task} onClose={() => setFinishing(false)} /> : null}
    </Card>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: space(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  doneTitle: { textDecorationLine: 'line-through' },
  meta: { gap: space(1) },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  note: { borderRadius: 10, padding: space(2.5) },
  actions: { flexDirection: 'row', gap: space(2), marginTop: space(1) },
  assignedFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
