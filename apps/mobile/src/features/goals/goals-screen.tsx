import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Target, UserX } from 'lucide-react-native';
import { Appear, Badge, BottomSheet, Button, Card, EmptyState, ErrorState, Header, PressScale, ProgressBar, Screen, SkeletonList, Text, TextField, toast } from '@/components';
import { toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { label } from '@/lib/format';
import { formatDate } from '@/lib/time';
import { radius, space, useTheme, type Tone } from '@/theme';
import { useMyGoals, useUpdateGoalProgress, type Goal, type GoalStatus } from './api';

const STATUS_TONE: Record<GoalStatus, Tone> = { NOT_STARTED: 'gray', IN_PROGRESS: 'blue', COMPLETED: 'green', CANCELLED: 'red' };
const STEPS = [0, 25, 50, 75, 100];

const GoalCard = ({ g, onPress }: { g: Goal; onPress: () => void }) => {
  const { c } = useTheme();
  const editable = g.status !== 'COMPLETED' && g.status !== 'CANCELLED';
  return (
    <PressScale onPress={editable ? onPress : undefined} disabled={!editable} accessibilityRole={editable ? 'button' : undefined} accessibilityHint={editable ? 'Update progress' : undefined}>
      <Card style={styles.card}>
        <View style={styles.row}>
          <Text weight="semibold" numberOfLines={2} style={styles.flex}>
            {g.title}
          </Text>
          <Badge tone={STATUS_TONE[g.status]}>{label(g.status)}</Badge>
        </View>
        <View style={styles.row}>
          <View style={styles.flex}>
            <ProgressBar value={g.progress} color={g.progress >= 100 ? c.success : undefined} accessibilityLabel={`${g.title} progress`} />
          </View>
          <Text size="sm" weight="semibold" tabular>{`${Math.round(g.progress)}%`}</Text>
        </View>
        <Text size="xs" color="muted">
          {[label(g.category), g.dueDate ? `Due ${formatDate(g.dueDate)}` : null, g.target ? `Target: ${g.target}` : null].filter(Boolean).join(' · ')}
        </Text>
        {editable ? (
          <Text size="xs" weight="semibold" style={{ color: c.accent }}>
            Tap to update progress
          </Text>
        ) : null}
      </Card>
    </PressScale>
  );
};

const UpdateSheet = ({ goal, onClose }: { goal: Goal | null; onClose: () => void }) => {
  const { c } = useTheme();
  const update = useUpdateGoalProgress();
  const [progress, setProgress] = useState(goal?.progress ?? 0);
  const [note, setNote] = useState('');
  if (!goal) return null;

  const save = async () => {
    try {
      await update.mutateAsync({ id: goal._id, progress, status: progress >= 100 ? 'COMPLETED' : 'IN_PROGRESS', note: note.trim() || undefined });
      toast.success(progress >= 100 ? 'Goal completed' : 'Progress updated');
      onClose();
    } catch (err) {
      toast.error('Could not update the goal', toApiError(err).message);
    }
  };

  return (
    <BottomSheet open onClose={onClose} title={goal.title} description="How far along are you?">
      <Text size="3xl" weight="bold" align="center" tabular>{`${progress}%`}</Text>
      <View style={styles.steps}>
        {STEPS.map((s) => (
          <Pressable
            key={s}
            onPress={() => setProgress(s)}
            accessibilityRole="radio"
            accessibilityState={{ selected: progress === s }}
            style={[styles.step, { borderColor: progress === s ? c.primary : c.line, backgroundColor: progress === s ? c.surface2 : c.surface }]}
          >
            <Text size="sm" weight="semibold" style={progress === s ? { color: c.primary } : undefined}>{`${s}%`}</Text>
          </Pressable>
        ))}
      </View>
      <TextField
        label="Or enter an exact %"
        keyboardType="number-pad"
        value={String(progress)}
        onChangeText={(t) => setProgress(Math.max(0, Math.min(100, Number(t.replace(/\D/g, '')) || 0)))}
        maxLength={3}
      />
      <TextField label="Note (optional)" value={note} onChangeText={setNote} multiline placeholder="What did you get done?" maxLength={500} />
      <Button loading={update.isPending} onPress={() => void save()}>
        {progress >= 100 ? 'Mark as completed' : 'Save progress'}
      </Button>
      <Button variant="ghost" onPress={onClose}>
        Cancel
      </Button>
    </BottomSheet>
  );
};

/** My goals with progress; tap an active goal to update it (same as the web Goals page, "Mine" tab). */
export const GoalsScreen = () => {
  const { hasEmployee } = useAuth();
  const goals = useMyGoals(hasEmployee);
  const [editing, setEditing] = useState<Goal | null>(null);
  const items = goals.data ?? [];
  const active = items.filter((g) => g.status !== 'COMPLETED' && g.status !== 'CANCELLED');
  const avg = active.length ? Math.round(active.reduce((s, g) => s + g.progress, 0) / active.length) : null;

  return (
    <Screen
      header={<Header title="My goals" subtitle={avg === null ? 'Your targets and progress' : `${active.length} active · ${avg}% average`} back backTo="/more" />}
      onRefresh={hasEmployee ? () => goals.refetch() : undefined}
    >
      {!hasEmployee ? (
        <Card>
          <EmptyState icon={UserX} title="No employee profile" message="Goals belong to employee records." />
        </Card>
      ) : goals.isLoading ? (
        <Card>
          <SkeletonList rows={4} />
        </Card>
      ) : goals.error ? (
        <Card>
          <ErrorState title="Could not load your goals" error={goals.error} onRetry={() => void goals.refetch()} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={Target} title="No goals yet" message="Goals set by you or your manager will appear here." />
        </Card>
      ) : (
        <View style={styles.list}>
          {items.map((g, i) => (
            <Appear key={g._id} index={i}>
              <GoalCard g={g} onPress={() => setEditing(g)} />
            </Appear>
          ))}
        </View>
      )}
      {editing ? <UpdateSheet key={editing._id} goal={editing} onClose={() => setEditing(null)} /> : null}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: space(3) },
  card: { gap: space(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  steps: { flexDirection: 'row', gap: space(2) },
  step: { flex: 1, alignItems: 'center', paddingVertical: space(2), borderRadius: radius.md, borderWidth: 1 },
});
