import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Search, Send, Users } from 'lucide-react-native';
import { Avatar, Button, Card, DateField, EmptyState, ErrorState, Header, Screen, Segmented, SkeletonList, Text, TextField, toast } from '@/components';
import { toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fullName } from '@/lib/format';
import { dateKeyIn } from '@/lib/time';
import { radius, space, useTheme } from '@/theme';
import { useAssignable, useAssignTask, type TaskPriority } from './api';

/** Managers / department heads / HR give one or more people a task; each gets it (and a pop-up) right away. */
export const AssignTaskScreen = () => {
  const { c } = useTheme();
  const { timeZone } = useAuth();
  const people = useAssignable();
  const assign = useAssignTask();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  const [search, setSearch] = useState('');
  // Opened from someone's profile ("Task" button): they're pre-selected.
  const { to } = useLocalSearchParams<{ to?: string }>();
  const [selected, setSelected] = useState<string[]>(to ? [to] : []);
  const [errors, setErrors] = useState<{ title?: string; people?: string }>({});

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const all = people.data ?? [];
    if (!s) return all;
    return all.filter((p) => [fullName(p), p.employeeId, p.departmentId?.name].filter(Boolean).join(' ').toLowerCase().includes(s));
  }, [people.data, search]);

  const toggle = (id: string) => {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    setErrors((e) => ({ ...e, people: undefined }));
  };

  const submit = async () => {
    const next = { title: title.trim() ? undefined : 'Give the task a title', people: selected.length ? undefined : 'Choose at least one person' };
    setErrors(next);
    if (next.title || next.people) return;
    try {
      await assign.mutateAsync({ title: title.trim(), description: description.trim() || undefined, assigneeIds: selected, priority, dueDate: dueDate || undefined });
      toast.success(selected.length > 1 ? `Task assigned to ${selected.length} people` : 'Task assigned', 'They’ve been notified.');
      router.back();
    } catch (err) {
      toast.error('Could not assign the task', toApiError(err).message);
    }
  };

  return (
    <Screen header={<Header title="Assign a task" back backTo="/more/tasks" />}>
      <Card style={styles.form}>
        <TextField
          label="Task"
          required
          value={title}
          onChangeText={(t) => {
            setTitle(t);
            setErrors((e) => ({ ...e, title: undefined }));
          }}
          placeholder="Send the October stock report"
          maxLength={150}
          error={errors.title}
        />
        <TextField label="Details (optional)" value={description} onChangeText={setDescription} multiline placeholder="Anything they need to know" maxLength={2000} />
        <View style={styles.gap}>
          <Text size="sm" weight="medium" color="fg2">
            Priority
          </Text>
          <Segmented<TaskPriority>
            value={priority}
            onChange={setPriority}
            accessibilityLabel="Priority"
            options={[
              { value: 'LOW', label: 'Low' },
              { value: 'MEDIUM', label: 'Medium' },
              { value: 'HIGH', label: 'High' },
            ]}
          />
        </View>
        <DateField label="Due date (optional)" value={dueDate} onChange={setDueDate} minimumDate={dateKeyIn(timeZone)} placeholder="No due date" />
      </Card>

      <Card style={styles.form}>
        <View style={styles.peopleHead}>
          <Users size={18} color={c.accent} />
          <Text weight="semibold" style={styles.flex}>
            Assign to
          </Text>
          {selected.length ? (
            <Text size="sm" weight="semibold" color="accent">
              {`${selected.length} selected`}
            </Text>
          ) : null}
        </View>
        {errors.people ? (
          <Text size="sm" color="danger">
            {errors.people}
          </Text>
        ) : null}
        <TextField value={search} onChangeText={setSearch} placeholder="Search by name, ID or department" leftIcon={Search} accessibilityLabel="Search people" />
        {people.isLoading ? (
          <SkeletonList rows={3} />
        ) : people.error ? (
          <ErrorState compact title="Could not load your team" error={people.error} onRetry={() => void people.refetch()} />
        ) : !filtered.length ? (
          <EmptyState compact icon={Users} title={search ? 'No one matches' : 'No one to assign to'} />
        ) : (
          <View>
            {filtered.map((p) => {
              const on = selected.includes(p._id);
              return (
                <Pressable
                  key={p._id}
                  onPress={() => toggle(p._id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={fullName(p)}
                  style={({ pressed }) => [styles.person, { borderBottomColor: c.line, backgroundColor: pressed ? c.surface2 : 'transparent' }]}
                >
                  <Avatar name={fullName(p)} uri={p.profilePhoto} size={36} />
                  <View style={styles.flex}>
                    <Text weight="medium" numberOfLines={1}>
                      {fullName(p)}
                    </Text>
                    <Text size="xs" color="muted" numberOfLines={1}>
                      {[p.employeeId, p.designationId?.name, p.departmentId?.name].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <View style={[styles.check, { borderColor: on ? c.primary : c.lineStrong, backgroundColor: on ? c.primary : c.surface }]}>
                    {on ? <Check size={14} color={c.onPrimary} strokeWidth={3} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </Card>

      <Button icon={Send} size="lg" loading={assign.isPending} onPress={() => void submit()}>
        {selected.length > 1 ? `Assign to ${selected.length} people` : 'Assign task'}
      </Button>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space(2) },
  form: { gap: space(3) },
  peopleHead: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  person: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(2.5), paddingHorizontal: space(1), borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
