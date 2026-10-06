import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Search, Users, X } from 'lucide-react-native';
import { Avatar, Badge, Card, EmptyState, ErrorState, Header, IconButton, ListItem, Screen, SkeletonList, StatusBadge, Text, TextField } from '@/components';
import { useAttendanceBoard, type BoardCard } from '@/features/dashboard/api';
import { flattenPages, LoadMore, totalOf } from '@/features/profile/kit/infinite';
import { useAuth } from '@/lib/auth';
import { fullName } from '@/lib/format';
import { formatTimeIn } from '@/lib/time';
import { radius, space, useTheme, type Tone } from '@/theme';
import { useAllEmployees, useDepartments, useMyTeam, useTeammates } from '../api';

/** Employees without reports: their reporting manager and teammates (read-only: colleagues' profiles are private). */
const Teammates = () => {
  const q = useTeammates(true);
  const { manager, teammates } = q.data ?? { manager: null, teammates: [] };
  const rows = [...(manager ? [{ p: manager, tag: 'Reporting manager' }] : []), ...teammates.map((p) => ({ p, tag: undefined }))];
  return (
    <Screen
      header={<Header title="My team" subtitle="Your reporting manager and teammates" back backTo="/more" />}
      onRefresh={() => q.refetch()}
    >
      {q.isLoading ? (
        <Card>
          <SkeletonList rows={4} />
        </Card>
      ) : q.error ? (
        <Card>
          <ErrorState title="Could not load your team" error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title="No team yet" message="Once HR sets your reporting manager, your manager and teammates will appear here." />
        </Card>
      ) : (
        <Card padding={0}>
          {rows.map(({ p, tag }, i) => {
            const name = fullName(p);
            return (
              <ListItem
                key={p._id}
                divider={i > 0}
                title={name}
                subtitle={[p.designationId?.name, p.departmentId?.name].filter(Boolean).join(' · ') || p.workEmail}
                meta={tag}
                left={<Avatar name={name} uri={p.profilePhoto} size={40} />}
                onPress={p.workEmail ? () => void Linking.openURL(`mailto:${p.workEmail}`) : undefined}
                accessibilityHint={p.workEmail ? `Email ${name}` : undefined}
              />
            );
          })}
        </Card>
      )}
    </Screen>
  );
};

export const TeamListScreen = () => {
  const { isManager, can } = useAuth();
  if (can('employee:read')) return <Directory />;
  if (!isManager) return <Teammates />;
  return <ReportsList />;
};

/** Today's state from the live board, as a small coloured chip. */
const TodayChip = ({ card }: { card: BoardCard | undefined }) => {
  const { timeZone } = useAuth();
  if (!card) return null;
  const meta: Record<BoardCard['column'], { tone: Tone; text: string }> = {
    WORKING: { tone: 'green', text: `In ${formatTimeIn(card.checkIn, timeZone)}` },
    ON_BREAK: { tone: 'amber', text: 'On break' },
    DONE: { tone: 'blue', text: `Left ${formatTimeIn(card.checkOut, timeZone)}` },
    AWAY: { tone: 'purple', text: card.awayReason ?? 'Away' },
    NOT_IN: { tone: card.absent ? 'red' : 'gray', text: card.absent ? 'Absent' : 'Not in' },
  };
  const m = meta[card.column];
  return (
    <Badge tone={m.tone} dot>
      {m.text}
    </Badge>
  );
};

/** HR / super admin: every employee, searchable and filterable by department, with today's status. */
const Directory = () => {
  const { c } = useTheme();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setSearch(input.trim()), 350);
    return () => clearTimeout(t);
  }, [input]);
  const list = useAllEmployees(search, department, true);
  const departments = useDepartments(true);
  const board = useAttendanceBoard(true);
  const today = new Map((board.data?.cards ?? []).map((b) => [b.employee._id, b]));
  const items = flattenPages(list.data);
  const total = totalOf(list.data);
  const chips = [{ _id: null as string | null, name: 'All' }, ...(departments.data ?? [])];

  return (
    <Screen
      header={<Header title="Employees" subtitle={list.data ? `${total} ${total === 1 ? 'person' : 'people'}` : 'Everyone in the organization'} back backTo="/more" />}
      onRefresh={() => Promise.all([list.refetch(), board.refetch()])}
    >
      <View style={styles.search}>
        <View style={styles.flex}>
          <TextField
            leftIcon={Search}
            placeholder="Search name, ID or email"
            accessibilityLabel="Search employees"
            value={input}
            onChangeText={setInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => setSearch(input.trim())}
          />
        </View>
        {input ? <IconButton icon={X} onPress={() => setInput('')} accessibilityLabel="Clear search" /> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {chips.map((d) => {
          const on = department === d._id;
          return (
            <Pressable
              key={d._id ?? 'all'}
              onPress={() => setDepartment(d._id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[styles.chip, { borderColor: on ? c.primary : c.line, backgroundColor: on ? c.primary : c.surface }]}
            >
              <Text size="sm" weight="semibold" style={{ color: on ? c.onPrimary : c.fg2 }}>
                {d.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {list.isLoading ? (
        <Card>
          <SkeletonList rows={6} />
        </Card>
      ) : list.error ? (
        <Card>
          <ErrorState title="Could not load employees" error={list.error} onRetry={() => void list.refetch()} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title={search || department ? 'No one matches' : 'No employees yet'} message={search ? 'Try a different name, employee ID or email.' : undefined} />
        </Card>
      ) : (
        <>
          <Card padding={0}>
            {items.map((e, i) => {
              const name = fullName(e);
              return (
                <ListItem
                  key={e._id}
                  divider={i > 0}
                  title={name}
                  subtitle={[e.employeeId, e.designationId?.name, e.departmentId?.name].filter(Boolean).join(' · ') || e.workEmail}
                  left={<Avatar name={name} uri={e.profilePhoto} size={40} />}
                  right={e.employmentStatus !== 'ACTIVE' ? <StatusBadge status={e.employmentStatus} /> : <TodayChip card={today.get(e._id)} />}
                  onPress={() => router.push({ pathname: '/more/team/[id]', params: { id: e._id } })}
                  accessibilityHint="Opens the profile"
                />
              );
            })}
          </Card>
          <LoadMore
            hasNextPage={list.hasNextPage}
            isFetchingNextPage={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
            shown={items.length}
            total={total}
            noun="people"
          />
        </>
      )}
    </Screen>
  );
};

/** Managers: their direct and indirect reports. */
const ReportsList = () => {
  const { isManager } = useAuth();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearch(input.trim()), 350);
    return () => clearTimeout(t);
  }, [input]);
  const list = useMyTeam(search);
  const items = flattenPages(list.data);
  const total = totalOf(list.data);

  return (
    <Screen
      header={<Header title="My team" subtitle={list.data ? `${total} ${total === 1 ? 'person' : 'people'}` : 'People who report to you'} back backTo="/more" />}
      onRefresh={isManager ? () => list.refetch() : undefined}
    >
      {!isManager ? (
        <Card>
          <EmptyState icon={Users} title="No team" message="People who report to you will appear here." />
        </Card>
      ) : (
        <>
          <View style={styles.search}>
            <View style={styles.flex}>
              <TextField
                leftIcon={Search}
                placeholder="Search name, ID or email"
                accessibilityLabel="Search your team"
                value={input}
                onChangeText={setInput}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={() => setSearch(input.trim())}
              />
            </View>
            {input ? <IconButton icon={X} onPress={() => setInput('')} accessibilityLabel="Clear search" /> : null}
          </View>
          {list.isLoading ? (
            <Card>
              <SkeletonList rows={5} />
            </Card>
          ) : list.error ? (
            <Card>
              <ErrorState title="Could not load your team" error={list.error} onRetry={() => void list.refetch()} />
            </Card>
          ) : items.length === 0 ? (
            <Card>
              <EmptyState
                icon={Users}
                title={search ? 'No one matches your search' : 'No team members'}
                message={search ? 'Try a different name, employee ID or email.' : 'People who report to you will appear here.'}
              />
            </Card>
          ) : (
            <>
              <Card padding={0}>
                {items.map((e, i) => {
                  const name = fullName(e);
                  return (
                    <ListItem
                      key={e._id}
                      divider={i > 0}
                      title={name}
                      subtitle={[e.designationId?.name, e.departmentId?.name].filter(Boolean).join(' · ') || e.workEmail}
                      meta={e.employeeId}
                      left={<Avatar name={name} uri={e.profilePhoto} size={40} />}
                      right={e.employmentStatus !== 'ACTIVE' ? <StatusBadge status={e.employmentStatus} /> : undefined}
                      onPress={() => router.push({ pathname: '/more/team/[id]', params: { id: e._id } })}
                      accessibilityHint="Opens the profile"
                    />
                  );
                })}
              </Card>
              <LoadMore
                hasNextPage={list.hasNextPage}
                isFetchingNextPage={list.isFetchingNextPage}
                onLoadMore={() => void list.fetchNextPage()}
                shown={items.length}
                total={total}
                noun="people"
              />
            </>
          )}
        </>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chips: { gap: space(2), paddingVertical: 2 },
  chip: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: space(3.5), paddingVertical: space(1.5) },
});
