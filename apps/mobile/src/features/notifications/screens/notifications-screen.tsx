import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import {
  Bell,
  BellOff,
  Briefcase,
  CheckCheck,
  Clock,
  ExternalLink,
  FileText,
  Megaphone,
  Package,
  Plane,
  Receipt,
  Settings,
  Target,
  Trash2,
  UserPlus,
  Wallet,
} from 'lucide-react-native';
import type { NotificationType } from '@stencil/shared';
import { Button, Card, EmptyState, ErrorState, Header, IconButton, ListItem, Screen, SkeletonList, Text, toast, type IconComponent } from '@/components';
import { FilterChips } from '@/features/profile/kit/filter-chips';
import { flattenPages, LoadMore, totalOf } from '@/features/profile/kit/infinite';
import { toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { openWebApp, resolveLink } from '@/lib/links';
import { timeAgo } from '@/lib/time';
import { radius, space, TOUCH_TARGET, useTheme } from '@/theme';
import { useDeleteNotification, useMarkAllRead, useMarkRead, useNotifications, useUnreadCount, type NotificationItem } from '../api';

const ICONS: Partial<Record<NotificationType, IconComponent>> = {
  LEAVE_SUBMITTED: Plane,
  LEAVE_APPROVED: Plane,
  LEAVE_REJECTED: Plane,
  ATTENDANCE_CORRECTION: Clock,
  PAYROLL_GENERATED: Wallet,
  DOCUMENT_EXPIRY: FileText,
  PERFORMANCE_REVIEW: Target,
  GOAL: Target,
  ANNOUNCEMENT: Megaphone,
  EXPENSE_APPROVAL: Receipt,
  INTERVIEW_SCHEDULED: Briefcase,
  ONBOARDING: UserPlus,
  OFFBOARDING: Briefcase,
  ASSET: Package,
};

const NotificationRow = ({
  n,
  divider,
  onOpen,
  onDelete,
  deleting,
}: {
  n: NotificationItem;
  divider: boolean;
  onOpen: (n: NotificationItem) => void;
  onDelete: (n: NotificationItem) => void;
  deleting: boolean;
}) => {
  const { c } = useTheme();
  const unread = !n.readAt;
  const Icon = ICONS[n.type] ?? Bell;
  const target = resolveLink(n.link);
  return (
    <View style={[styles.row, divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }, unread && { backgroundColor: c.accentSoft }]}>
      <Pressable
        onPress={() => onOpen(n)}
        accessibilityRole="button"
        accessibilityLabel={`${unread ? 'Unread. ' : ''}${n.title}. ${n.message}. ${timeAgo(n.createdAt)}`}
        accessibilityHint={target?.kind === 'web' ? 'Opens Stencil on the web' : n.link ? 'Opens the related item' : 'Marks as read'}
        style={({ pressed }) => [styles.main, pressed && { opacity: 0.7 }]}
      >
        <View style={[styles.icon, { backgroundColor: unread ? c.surface : c.surface3 }]}>
          <Icon size={18} color={unread ? c.accent : c.muted} />
        </View>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            {unread ? <View style={[styles.dot, { backgroundColor: c.primary }]} /> : null}
            <Text weight={unread ? 'semibold' : 'medium'} style={styles.flex} numberOfLines={2}>
              {n.title}
            </Text>
          </View>
          <Text size="sm" color="fg2" numberOfLines={3}>
            {n.message}
          </Text>
          <View style={styles.metaRow}>
            <Text size="xs" color="subtle">
              {timeAgo(n.createdAt)}
            </Text>
            {target?.kind === 'web' ? <ExternalLink size={12} color={c.subtle} accessibilityLabel="Opens on the web" /> : null}
          </View>
        </View>
      </Pressable>
      <IconButton icon={Trash2} onPress={() => onDelete(n)} disabled={deleting} accessibilityLabel={`Delete notification: ${n.title}`} color={c.muted} />
    </View>
  );
};

type Filter = 'all' | 'unread';

export const NotificationsScreen = () => {
  const { c } = useTheme();
  const { isApprover } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const list = useNotifications(filter === 'unread');
  const unread = useUnreadCount();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const remove = useDeleteNotification();
  const items = flattenPages(list.data);
  const unreadCount = unread.data ?? 0;

  const open = (n: NotificationItem) => {
    if (!n.readAt) markRead.mutate(n._id);
    const target = resolveLink(n.link, { approval: isApprover && /awaiting/i.test(n.title) });
    if (!target) return;
    if (target.kind === 'web') void openWebApp(target.url);
    else router.push(target.href);
  };

  const onDelete = async (n: NotificationItem) => {
    try {
      await remove.mutateAsync(n._id);
      toast.success('Notification deleted');
    } catch (err) {
      toast.error('Could not delete the notification', toApiError(err).message);
    }
  };

  const onMarkAll = async () => {
    try {
      await markAll.mutateAsync();
      toast.success('All notifications marked as read');
    } catch (err) {
      toast.error('Could not mark notifications as read', toApiError(err).message);
    }
  };

  return (
    <Screen
      header={
        <Header
          title="Notifications"
          subtitle={unreadCount ? `${unreadCount} unread` : 'You are all caught up'}
          back
          backTo="/more"
          right={
            <IconButton
              icon={CheckCheck}
              color={c.fg}
              onPress={() => void onMarkAll()}
              disabled={!unreadCount || markAll.isPending}
              accessibilityLabel="Mark all as read"
            />
          }
        />
      }
      onRefresh={() => Promise.all([list.refetch(), unread.refetch()])}
    >
      <FilterChips
        accessibilityLabel="Show"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'unread', label: 'Unread', count: unreadCount || undefined },
        ]}
      />
      {list.isLoading ? (
        <Card>
          <SkeletonList rows={4} />
        </Card>
      ) : list.error ? (
        <Card>
          <ErrorState title="Could not load notifications" error={list.error} onRetry={() => void list.refetch()} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={BellOff}
            title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            message={filter === 'unread' ? 'You are all caught up.' : 'Approvals, payslips, announcements and reminders will show up here.'}
          />
        </Card>
      ) : (
        <>
          <Card padding={0} style={styles.card}>
            {items.map((n, i) => (
              <NotificationRow
                key={n._id}
                n={n}
                divider={i > 0}
                onOpen={open}
                onDelete={(x) => void onDelete(x)}
                deleting={remove.isPending && remove.variables === n._id}
              />
            ))}
          </Card>
          <LoadMore
            hasNextPage={list.hasNextPage}
            isFetchingNextPage={list.isFetchingNextPage}
            onLoadMore={() => void list.fetchNextPage()}
            shown={items.length}
            total={totalOf(list.data)}
            noun="notifications"
          />
        </>
      )}
      <Card padding={0}>
        <ListItem
          title="Notification settings"
          subtitle="Choose what reaches you in the app and by email"
          left={<Settings size={20} color={c.accent} />}
          onPress={() => router.push('/more/settings')}
        />
      </Card>
      {unreadCount > 0 && filter === 'unread' && items.length > 0 ? (
        <Button variant="ghost" onPress={() => void onMarkAll()} loading={markAll.isPending}>
          Mark all as read
        </Button>
      ) : null}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingRight: space(1) },
  main: { flex: 1, flexDirection: 'row', gap: space(3), paddingVertical: space(3), paddingLeft: space(4), minHeight: TOUCH_TARGET },
  icon: { width: 36, height: 36, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  dot: { width: 8, height: 8, borderRadius: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
});
