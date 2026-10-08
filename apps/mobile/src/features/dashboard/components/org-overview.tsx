import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Activity, Award, Building2, Cake, ClipboardCheck, ClipboardList, Coffee, LogIn, Plus, Radio, Users } from 'lucide-react-native';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, ListItem, ProgressBar, SectionHeader, Segmented, SkeletonList, Text } from '@/components';
import { useTasks } from '@/features/tasks/api';
import { useAuth } from '@/lib/auth';
import { formatKey, formatTimeIn, timeAgo } from '@/lib/time';
import { radius, space, toneColors, useTheme, type Tone } from '@/theme';
import { useAdminDashboard, useAttendanceBoard, useOrgActivity, type BoardCard, type BoardColumn } from '../api';
import { activityIcon } from '../lib';

/* ------------------------------ Shared bits ----------------------------- */

const Section = ({ title, icon, tone, action, onAction, children }: { title: string; icon: typeof Users; tone: Tone; action?: string; onAction?: () => void; children: React.ReactNode }) => (
  <View style={styles.section}>
    <SectionHeader title={title} icon={icon} tone={tone} actionLabel={action} onAction={onAction} />
    {children}
  </View>
);

const Stat = ({ label, value, tone, onPress }: { label: string; value: number | string; tone: Tone; onPress?: () => void }) => {
  const { c } = useTheme();
  const t = toneColors(tone, c);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => [styles.stat, { backgroundColor: t.bg, borderColor: t.border, opacity: pressed ? 0.8 : 1 }]}
    >
      <Text size="2xl" weight="bold" tabular style={{ color: t.fg }}>
        {value}
      </Text>
      <Text size="xs" weight="semibold" numberOfLines={1} style={{ color: t.fg }}>
        {label}
      </Text>
    </Pressable>
  );
};

/* --------------------------- Organization today -------------------------- */

/** Headline numbers for the whole company today, plus approvals waiting. */
export const OrgToday = () => {
  const { c } = useTheme();
  const { isApprover } = useAuth();
  const q = useAdminDashboard(true);
  const k = q.data?.cards;
  const inNow = k ? k.presentToday : 0;
  const pct = k && k.activeEmployees ? Math.round((inNow / k.activeEmployees) * 100) : 0;

  return (
    <Section title="Organization Today" icon={Building2} tone="brand" action="Attendance" onAction={() => router.push('/attendance')}>
      <Card style={styles.gap}>
        {q.isLoading ? (
          <SkeletonList rows={3} />
        ) : q.error || !k ? (
          <ErrorState compact title="Could not load today’s numbers" error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <View style={styles.headline}>
              <Text size="3xl" weight="bold" tabular>
                {inNow}
              </Text>
              <Text size="md" color="fg2" style={styles.flex}>{`of ${k.activeEmployees} employees are in today`}</Text>
              <Text size="lg" weight="bold" color="accent" tabular>{`${pct}%`}</Text>
            </View>
            <ProgressBar value={pct} accessibilityLabel="Share of employees in today" />
            <View style={styles.stats}>
              <Stat label="Present" value={k.presentToday} tone="green" />
              <Stat label="Late" value={k.lateToday} tone="amber" />
              <Stat label="Not in yet" value={k.notCheckedInToday} tone="gray" />
              <Stat label="Absent" value={k.absentToday} tone="red" />
              <Stat label="On leave" value={k.onLeaveToday} tone="purple" />
              <Stat label="Employees" value={k.totalEmployees} tone="blue" onPress={() => router.push('/more/team')} />
            </View>
            <View style={[styles.approvals, { borderTopColor: c.line }]}>
              <ClipboardCheck size={18} color={toneColors('amber', c).solid} />
              <Text size="sm" weight="semibold" style={styles.flex}>
                {k.pendingApprovals.total ? `${k.pendingApprovals.total} approvals waiting` : 'No approvals waiting'}
              </Text>
              {k.pendingApprovals.total ? (
                <Text size="xs" color="muted">
                  {[
                    k.pendingApprovals.leave ? `${k.pendingApprovals.leave} leave` : null,
                    k.pendingApprovals.regularization ? `${k.pendingApprovals.regularization} regularization` : null,
                    k.pendingApprovals.expense ? `${k.pendingApprovals.expense} expense` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              ) : null}
              {isApprover && k.pendingApprovals.total ? (
                <Button variant="ghost" onPress={() => router.push('/approvals')}>
                  Review
                </Button>
              ) : null}
            </View>
          </>
        )}
      </Card>
    </Section>
  );
};

/* ------------------------------ Who's in now ----------------------------- */

const COLUMN_META: Record<BoardColumn, { label: string; short: string }> = {
  WORKING: { label: 'Working', short: 'In' },
  ON_BREAK: { label: 'On break', short: 'Break' },
  NOT_IN: { label: 'Not in yet', short: 'Not in' },
  DONE: { label: 'Gone home', short: 'Left' },
  AWAY: { label: 'Away', short: 'Away' },
};
const COLUMN_ORDER: BoardColumn[] = ['WORKING', 'ON_BREAK', 'NOT_IN', 'DONE', 'AWAY'];

const PersonRow = ({ p, divider }: { p: BoardCard; divider: boolean }) => {
  const { c } = useTheme();
  const { timeZone } = useAuth();
  const name = `${p.employee.firstName} ${p.employee.lastName}`.trim();
  const right =
    p.column === 'WORKING' || p.column === 'ON_BREAK'
      ? `In ${formatTimeIn(p.checkIn, timeZone)}`
      : p.column === 'DONE'
        ? `Out ${formatTimeIn(p.checkOut, timeZone)}`
        : p.column === 'AWAY'
          ? (p.awayReason ?? 'Away')
          : p.absent
            ? 'Absent'
            : '—';
  return (
    <ListItem
      divider={divider}
      title={name}
      subtitle={[p.employee.department, p.workMode === 'REMOTE' ? 'Remote' : null].filter(Boolean).join(' · ') || p.employee.employeeId}
      left={<Avatar name={name} uri={p.employee.profilePhoto} size={36} />}
      right={
        <View style={styles.rowRight}>
          <Text size="sm" weight="semibold" tabular style={p.absent ? { color: c.danger } : undefined}>
            {right}
          </Text>
          {p.isLate ? <Badge tone="amber">{`Late ${p.lateMinutes}m`}</Badge> : null}
        </View>
      }
      onPress={() => router.push({ pathname: '/more/team/[id]', params: { id: p.employee._id } })}
    />
  );
};

/** Live board: who is working, on a break, not in yet, gone home or away — right now. */
export const WhosIn = () => {
  const q = useAttendanceBoard(true);
  const [column, setColumn] = useState<BoardColumn>('WORKING');
  const [all, setAll] = useState(false);
  const cols = q.data?.columns ?? [];
  const people = (q.data?.cards ?? []).filter((p) => p.column === column);
  const shown = all ? people : people.slice(0, 6);

  return (
    <Section title="Who’s In Now" icon={Radio} tone="green">
      <Card padding={0}>
        {q.isLoading ? (
          <View style={styles.pad}>
            <SkeletonList rows={3} />
          </View>
        ) : q.error ? (
          <ErrorState compact title="Could not load the live board" error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <View style={styles.pad}>
              <Segmented<BoardColumn>
                value={column}
                onChange={(v) => {
                  setColumn(v);
                  setAll(false);
                }}
                accessibilityLabel="Show people who are"
                options={COLUMN_ORDER.map((key) => ({ key, count: cols.find((x) => x.key === key)?.count ?? 0 }))
                  .filter((x) => x.key !== 'AWAY' || x.count)
                  .map((x) => ({ value: x.key, label: `${COLUMN_META[x.key].short} ${x.count}` }))}
              />
            </View>
            {shown.length ? (
              shown.map((p, i) => <PersonRow key={p.employee._id} p={p} divider={i > 0} />)
            ) : (
              <EmptyState compact icon={column === 'ON_BREAK' ? Coffee : LogIn} title={`No one is ${COLUMN_META[column].label.toLowerCase()} right now`} />
            )}
            {people.length > 6 ? (
              <Button variant="ghost" onPress={() => setAll((v) => !v)}>
                {all ? 'Show less' : `Show all ${people.length}`}
              </Button>
            ) : null}
          </>
        )}
      </Card>
    </Section>
  );
};

/* -------------------------------- Tasks --------------------------------- */

/** Tasks I've given out: how many are still open vs finished, plus a quick "Assign". */
export const TasksOverview = () => {
  const q = useTasks('assigned');
  const items = q.data ?? [];
  const open = items.filter((t) => t.status !== 'DONE');
  const done = items.length - open.length;
  const overdue = open.filter((t) => t.dueDate && t.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10)).length;

  return (
    <Section title="Team Tasks" icon={ClipboardList} tone="amber" action="View all" onAction={() => router.push('/more/tasks')}>
      <Card style={styles.gap}>
        {q.isLoading ? (
          <SkeletonList rows={2} />
        ) : q.error ? (
          <ErrorState compact title="Could not load tasks" error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <View style={styles.stats}>
              <Stat label="Open" value={open.length} tone="amber" onPress={() => router.push('/more/tasks')} />
              <Stat label="Finished" value={done} tone="green" onPress={() => router.push('/more/tasks')} />
              <Stat label="Overdue" value={overdue} tone={overdue ? 'red' : 'gray'} />
            </View>
            <Button icon={Plus} onPress={() => router.push('/more/tasks/new')}>
              Assign a task
            </Button>
          </>
        )}
      </Card>
    </Section>
  );
};

/* ------------------------------ Departments ----------------------------- */

export const Departments = () => {
  const { c } = useTheme();
  const q = useAdminDashboard(true);
  const rows = q.data?.charts.departmentDistribution ?? [];
  const max = Math.max(1, ...rows.map((r) => r.count));
  const tones: Tone[] = ['brand', 'green', 'amber', 'purple', 'teal', 'blue', 'red'];
  if (!q.isLoading && !rows.length) return null;
  return (
    <Section title="Departments" icon={Users} tone="blue">
      <Card style={styles.gap}>
        {q.isLoading ? (
          <SkeletonList rows={3} />
        ) : (
          rows.map((r, i) => {
            const t = toneColors(tones[i % tones.length]!, c);
            return (
              <View key={r.name} style={styles.deptRow} accessible accessibilityLabel={`${r.name}: ${r.count}`}>
                <Text size="sm" numberOfLines={1} style={styles.deptName}>
                  {r.name}
                </Text>
                <View style={[styles.deptTrack, { backgroundColor: c.surface2 }]}>
                  <View style={[styles.deptFill, { width: `${(r.count / max) * 100}%`, backgroundColor: t.solid }]} />
                </View>
                <Text size="sm" weight="bold" tabular style={styles.deptCount}>
                  {r.count}
                </Text>
              </View>
            );
          })
        )}
      </Card>
    </Section>
  );
};

/* ---------------------------- Team activity ----------------------------- */

/** Everyone's latest actions (clock-ins, leave, expenses, tasks…). */
export const TeamActivity = () => {
  const { c } = useTheme();
  const q = useOrgActivity(true);
  const items = q.data ?? [];
  return (
    <Section title="Team Activity" icon={Activity} tone="purple">
      <Card padding={0}>
        {q.isLoading ? (
          <View style={styles.pad}>
            <SkeletonList rows={3} />
          </View>
        ) : q.error ? (
          <ErrorState compact title="Could not load activity" error={q.error} onRetry={() => void q.refetch()} />
        ) : !items.length ? (
          <EmptyState compact icon={Activity} title="No activity yet today" message="Clock-ins, leave and finished tasks show up here." />
        ) : (
          items.map((a, i) => {
            const kind = activityIcon(a.type);
            return (
              <ListItem
                key={a.id}
                divider={i > 0}
                title={`${a.employee?.name ?? 'Someone'} ${a.title}`}
                subtitle={a.detail}
                meta={timeAgo(a.at)}
                left={
                  <View>
                    <Avatar name={a.employee?.name ?? '?'} uri={a.employee?.profilePhoto} size={36} />
                    <View style={[styles.badge, { backgroundColor: toneColors(kind.tone, c).solid, borderColor: c.surface }]}>
                      <kind.icon size={11} color="#ffffff" strokeWidth={2.5} />
                    </View>
                  </View>
                }
              />
            );
          })
        )}
      </Card>
    </Section>
  );
};

/* ----------------------------- Celebrations ----------------------------- */

/** Birthdays and work anniversaries in the next 30 days (hidden when there are none). */
export const Celebrations = () => {
  const { c } = useTheme();
  const q = useAdminDashboard(true);
  const w = q.data?.widgets;
  const rows = [
    ...(w?.upcomingBirthdays ?? []).map((p) => ({ ...p, kind: 'Birthday' as const })),
    ...(w?.workAnniversaries ?? []).map((p) => ({ ...p, kind: 'Anniversary' as const })),
  ]
    .sort((a, b) => a.inDays - b.inDays)
    .slice(0, 6);
  if (!rows.length) return null;
  return (
    <Section title="Celebrations" icon={Cake} tone="red">
      <Card padding={0}>
        {rows.map((p, i) => (
          <ListItem
            key={`${p.kind}-${p._id}`}
            divider={i > 0}
            title={p.name}
            subtitle={p.kind === 'Birthday' ? `Birthday · ${formatKey(p.nextDate, 'dd MMM')}` : `${p.years ?? ''} year${p.years === 1 ? '' : 's'} at work · ${formatKey(p.nextDate, 'dd MMM')}`}
            meta={p.inDays === 0 ? 'Today' : p.inDays === 1 ? 'Tomorrow' : `In ${p.inDays} days`}
            left={
              <View>
                <Avatar name={p.name} uri={p.profilePhoto} size={36} />
                <View style={[styles.badge, { backgroundColor: toneColors(p.kind === 'Birthday' ? 'red' : 'amber', c).solid, borderColor: c.surface }]}>
                  {p.kind === 'Birthday' ? <Cake size={11} color="#ffffff" strokeWidth={2.5} /> : <Award size={11} color="#ffffff" strokeWidth={2.5} />}
                </View>
              </View>
            }
          />
        ))}
      </Card>
    </Section>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space(3) },
  pad: { padding: space(3) },
  section: { gap: space(2) },
  headline: { flexDirection: 'row', alignItems: 'baseline', gap: space(2) },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  stat: { flexGrow: 1, flexBasis: '30%', minWidth: 90, borderWidth: 1, borderRadius: radius.md, paddingVertical: space(2.5), paddingHorizontal: space(3), gap: 2 },
  approvals: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space(2), borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space(3) },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  deptRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  deptName: { width: 104 },
  deptTrack: { flex: 1, height: 10, borderRadius: 5, overflow: 'hidden' },
  deptFill: { height: 10, borderRadius: 5 },
  deptCount: { width: 24, textAlign: 'right' },
  badge: { position: 'absolute', right: -4, bottom: -4, width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
