import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { Building2, Check, Megaphone, Search, Users } from 'lucide-react-native';
import { Avatar, Button, Card, EmptyState, ErrorState, Header, Screen, Segmented, SkeletonList, Text, TextField, toast } from '@/components';
import { useAssignable } from '@/features/tasks/api';
import { toApiError } from '@/lib/api';
import { fullName } from '@/lib/format';
import { radius, space, useTheme } from '@/theme';
import { textToHtml, useCreateAnnouncement, useDepartments, type AnnouncementAudience, type AnnouncementPriority } from '../api';

/** A tappable row with a checkbox (departments and people). */
const CheckRow = ({ on, onPress, title, subtitle, left }: { on: boolean; onPress: () => void; title: string; subtitle?: string; left?: React.ReactNode }) => {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={title}
      style={({ pressed }) => [styles.row, { borderBottomColor: c.line, backgroundColor: pressed ? c.surface2 : 'transparent' }]}
    >
      {left}
      <View style={styles.flex}>
        <Text weight="medium" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text size="xs" color="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={[styles.check, { borderColor: on ? c.primary : c.lineStrong, backgroundColor: on ? c.primary : c.surface }]}>
        {on ? <Check size={14} color={c.onPrimary} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
};

/** Anyone can post an announcement to everyone, some departments or chosen people; they get a push and the pop-up. */
export const NewAnnouncementScreen = () => {
  const { c } = useTheme();
  const create = useCreateAnnouncement();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<AnnouncementPriority>('NORMAL');
  const [audience, setAudience] = useState<AnnouncementAudience>('ALL');
  const [pinned, setPinned] = useState(false);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [errors, setErrors] = useState<{ title?: string; message?: string; audience?: string }>({});
  const departments = useDepartments(audience === 'DEPARTMENTS');
  const people = useAssignable();

  const filteredPeople = useMemo(() => {
    const s = search.trim().toLowerCase();
    const all = people.data ?? [];
    if (!s) return all;
    return all.filter((p) => [fullName(p), p.employeeId, p.departmentId?.name].filter(Boolean).join(' ').toLowerCase().includes(s));
  }, [people.data, search]);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
    setErrors((e) => ({ ...e, audience: undefined }));
  };

  const submit = async () => {
    const next = {
      title: title.trim() ? undefined : 'Give the announcement a title',
      message: message.trim() ? undefined : 'Write the announcement',
      audience:
        audience === 'DEPARTMENTS' && !departmentIds.length
          ? 'Choose at least one department'
          : audience === 'EMPLOYEES' && !employeeIds.length
            ? 'Choose at least one person'
            : undefined,
    };
    setErrors(next);
    if (next.title || next.message || next.audience) return;
    try {
      const saved = await create.mutateAsync({
        title: title.trim(),
        content: textToHtml(message),
        priority,
        audience,
        ...(audience === 'DEPARTMENTS' ? { departmentIds } : {}),
        ...(audience === 'EMPLOYEES' ? { employeeIds } : {}),
        pinned,
      });
      toast.success('Announcement posted', 'Everyone you chose has been notified.');
      router.replace({ pathname: '/more/announcements/[id]', params: { id: saved._id } });
    } catch (err) {
      toast.error('Could not post the announcement', toApiError(err).message);
    }
  };

  return (
    <Screen header={<Header title="New announcement" back backTo="/more/announcements" />}>
      <Card style={styles.form}>
        <TextField
          label="Title"
          required
          value={title}
          onChangeText={(t) => {
            setTitle(t);
            setErrors((e) => ({ ...e, title: undefined }));
          }}
          placeholder="Office closed on Friday"
          maxLength={200}
          error={errors.title}
        />
        <TextField
          label="Message"
          required
          value={message}
          onChangeText={(t) => {
            setMessage(t);
            setErrors((e) => ({ ...e, message: undefined }));
          }}
          multiline
          placeholder="What do you want everyone to know?"
          maxLength={5000}
          error={errors.message}
        />
        <View style={styles.gap}>
          <Text size="sm" weight="medium" color="fg2">
            Priority
          </Text>
          <Segmented<AnnouncementPriority>
            value={priority}
            onChange={setPriority}
            accessibilityLabel="Priority"
            options={[
              { value: 'LOW', label: 'Low' },
              { value: 'NORMAL', label: 'Normal' },
              { value: 'HIGH', label: 'High' },
              { value: 'URGENT', label: 'Urgent' },
            ]}
          />
        </View>
        <View style={styles.pinRow}>
          <View style={styles.flex}>
            <Text weight="medium">Pin to top</Text>
            <Text size="xs" color="muted">
              Keeps it at the top of everyone's app until it ends.
            </Text>
          </View>
          <Switch
            value={pinned}
            onValueChange={setPinned}
            accessibilityLabel="Pin to top"
            trackColor={{ false: c.lineStrong, true: c.primary }}
            thumbColor="#ffffff"
            ios_backgroundColor={c.lineStrong}
          />
        </View>
      </Card>

      <Card style={styles.form}>
        <View style={styles.head}>
          <Users size={18} color={c.accent} />
          <Text weight="semibold" style={styles.flex}>
            Who should see it
          </Text>
        </View>
        <Segmented<AnnouncementAudience>
          value={audience}
          onChange={(a) => {
            setAudience(a);
            setErrors((e) => ({ ...e, audience: undefined }));
          }}
          accessibilityLabel="Audience"
          options={[
            { value: 'ALL', label: 'Everyone' },
            { value: 'DEPARTMENTS', label: 'Departments' },
            { value: 'EMPLOYEES', label: 'People' },
          ]}
        />
        {errors.audience ? (
          <Text size="sm" color="danger">
            {errors.audience}
          </Text>
        ) : null}

        {audience === 'ALL' ? (
          <Text size="sm" color="muted">
            Everyone in the company gets a notification.
          </Text>
        ) : audience === 'DEPARTMENTS' ? (
          departments.isLoading ? (
            <SkeletonList rows={3} />
          ) : departments.error ? (
            <ErrorState compact title="Could not load departments" error={departments.error} onRetry={() => void departments.refetch()} />
          ) : !departments.data?.length ? (
            <EmptyState compact icon={Building2} title="No departments yet" />
          ) : (
            <View>
              {departments.data.map((d) => (
                <CheckRow
                  key={d._id}
                  on={departmentIds.includes(d._id)}
                  onPress={() => toggle(departmentIds, setDepartmentIds, d._id)}
                  title={d.name}
                  left={<Building2 size={20} color={c.accent} />}
                />
              ))}
            </View>
          )
        ) : (
          <>
            <TextField value={search} onChangeText={setSearch} placeholder="Search by name, ID or department" leftIcon={Search} accessibilityLabel="Search people" />
            {employeeIds.length ? (
              <Text size="sm" weight="semibold" color="accent">
                {`${employeeIds.length} selected`}
              </Text>
            ) : null}
            {people.isLoading ? (
              <SkeletonList rows={3} />
            ) : people.error ? (
              <ErrorState compact title="Could not load people" error={people.error} onRetry={() => void people.refetch()} />
            ) : !filteredPeople.length ? (
              <EmptyState compact icon={Users} title={search ? 'No one matches' : 'No one to choose'} />
            ) : (
              <View>
                {filteredPeople.map((p) => (
                  <CheckRow
                    key={p._id}
                    on={employeeIds.includes(p._id)}
                    onPress={() => toggle(employeeIds, setEmployeeIds, p._id)}
                    title={fullName(p)}
                    subtitle={[p.employeeId, p.designationId?.name, p.departmentId?.name].filter(Boolean).join(' · ')}
                    left={<Avatar name={fullName(p)} uri={p.profilePhoto} size={36} />}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </Card>

      <Button icon={Megaphone} size="lg" loading={create.isPending} onPress={() => void submit()}>
        Post announcement
      </Button>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space(2) },
  form: { gap: space(3) },
  head: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(2.5), paddingHorizontal: space(1), borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
