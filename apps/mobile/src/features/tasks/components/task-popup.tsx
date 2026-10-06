import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { CalendarClock, ClipboardList } from 'lucide-react-native';
import { Badge, BottomSheet, Button, Text } from '@/components';
import { useAuth } from '@/lib/auth';
import { fullName } from '@/lib/format';
import { useAnnouncementHighlights } from '@/features/announcements/api';
import { pendingPopupAnnouncements } from '@/features/announcements/components/announcement-popup';
import { useOverlayStore } from '@/lib/overlays';
import { formatDate, timeAgo } from '@/lib/time';
import { radius, space, useTheme } from '@/theme';
import { useMarkTasksSeen, useUnseenTasks } from '../api';
import { PRIORITY_META } from './task-card';

/**
 * Pops up each new task assigned to me (right after sign-in, and within ~15 s of a manager assigning one).
 * "Got it" marks it seen; "View task" opens it. Waits for the permissions sheet and announcement pop-up so only
 * one sheet shows at a time.
 */
export const TaskPopup = () => {
  const { c } = useTheme();
  const { user, hasEmployee } = useAuth();
  const unseen = useUnseenTasks(hasEmployee);
  const announcements = useAnnouncementHighlights(!!user);
  const markSeen = useMarkTasksSeen();
  const permissionsOpen = useOverlayStore((s) => s.permissionsOpen);
  const permissionsSettled = useOverlayStore((s) => s.permissionsSettled);
  const setTaskOpen = useOverlayStore((s) => s.setTaskOpen);
  const [handled, setHandled] = useState<string[]>([]);

  const queue = useMemo(() => (unseen.data ?? []).filter((t) => !handled.includes(t._id)), [unseen.data, handled]);
  const current = queue[0];
  // Announcements pop up first; a task waits until they're all dealt with.
  const announcementPending = !announcements.isFetched || pendingPopupAnnouncements(announcements.data?.popup).length > 0;
  const [open, setOpen] = useState(false);
  const showing = !!current && !permissionsOpen && permissionsSettled && (open || !announcementPending);
  useEffect(() => setOpen(showing), [showing]);
  useEffect(() => setTaskOpen(showing), [showing, setTaskOpen]);
  if (!showing || !current) return null;

  const done = () => {
    markSeen.mutate(current._id);
    setHandled((h) => [...h, current._id]);
  };
  const view = () => {
    done();
    router.push({ pathname: '/more/tasks', params: { id: current._id } });
  };
  const from = current.assignedBy ? fullName(current.assignedBy) : current.assignedByName;
  const priority = PRIORITY_META[current.priority];

  return (
    <BottomSheet open onClose={done} title={current.title} description={[from ? `From ${from}` : null, timeAgo(current.createdAt)].filter(Boolean).join(' · ')}>
      <View style={styles.tags}>
        <View style={[styles.icon, { backgroundColor: c.surface2 }]}>
          <ClipboardList size={16} color={c.primary} />
        </View>
        <Text size="sm" weight="semibold" color="fg2">
          New task for you
        </Text>
        <Badge tone={priority.tone} dot>{`${priority.label} priority`}</Badge>
      </View>
      {current.description ? (
        <Text size="md" color="fg2" numberOfLines={8}>
          {current.description}
        </Text>
      ) : null}
      {current.dueDate ? (
        <View style={styles.tags}>
          <CalendarClock size={16} color={c.muted} />
          <Text size="sm" color="fg2">{`Due ${formatDate(current.dueDate, 'EEE, dd MMM yyyy')}`}</Text>
        </View>
      ) : null}
      {queue.length > 1 ? <Text size="xs" color="muted">{`1 of ${queue.length} new tasks`}</Text> : null}
      <Button onPress={view}>View task</Button>
      <Button variant="outline" onPress={done}>
        {queue.length > 1 ? 'Got it, next' : 'Got it'}
      </Button>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space(2) },
  icon: { width: 28, height: 28, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});
