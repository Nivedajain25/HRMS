import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Megaphone, Pin } from 'lucide-react-native';
import { Badge, BottomSheet, Button, Text } from '@/components';
import { useAuth } from '@/lib/auth';
import { fullName } from '@/lib/format';
import { useOverlayStore } from '@/lib/overlays';
import { timeAgo } from '@/lib/time';
import { radius, space, useTheme } from '@/theme';
import { useAnnouncementHighlights, useMarkAnnouncementRead } from '../api';

// "Later" hides an announcement until the app is reopened.
const snoozedThisLaunch = new Set<string>();

/** Announcements still waiting to pop up (the new-task pop-up waits for these, so sheets never stack). */
export const pendingPopupAnnouncements = (popup: { _id: string }[] | undefined) => (popup ?? []).filter((a) => !snoozedThisLaunch.has(a._id));

/**
 * Pops up each new (unread) announcement right after sign-in, and within ~15 s of HR publishing one while the
 * app is open. "Got it" marks it read (it won't pop up again); "Later" brings it back next launch.
 * Waits while the permissions sheet is open so only one pop-up shows at a time.
 */
export const AnnouncementPopup = () => {
  const { c } = useTheme();
  const { user } = useAuth();
  const highlights = useAnnouncementHighlights(!!user);
  const markRead = useMarkAnnouncementRead();
  const permissionsOpen = useOverlayStore((s) => s.permissionsOpen);
  const permissionsSettled = useOverlayStore((s) => s.permissionsSettled);
  // Advance immediately after "Got it" / "Later", without waiting for the refetch.
  const [handled, setHandled] = useState<string[]>([]);

  const queue = useMemo(
    () => (highlights.data?.popup ?? []).filter((a) => !handled.includes(a._id) && !snoozedThisLaunch.has(a._id)),
    [highlights.data, handled],
  );
  const current = queue[0];
  // A new-task pop-up already on screen finishes first.
  const taskOpen = useOverlayStore((s) => s.taskOpen);
  // So does the "update available" sheet.
  const updateOpen = useOverlayStore((s) => s.updateOpen);
  if (!current || permissionsOpen || !permissionsSettled || taskOpen || updateOpen) return null;

  const done = (read: boolean) => {
    if (read) markRead.mutate(current._id);
    else snoozedThisLaunch.add(current._id);
    setHandled((h) => [...h, current._id]);
  };
  const open = () => {
    done(true);
    router.push(`/more/announcements/${current._id}`);
  };
  const author = current.createdBy ? fullName(current.createdBy) : null;

  return (
    <BottomSheet
      open
      onClose={() => done(false)}
      title={current.title}
      description={[author, timeAgo(current.publishAt)].filter(Boolean).join(' · ')}
    >
      <View style={styles.tags}>
        <View style={[styles.icon, { backgroundColor: c.surface2 }]}>
          <Megaphone size={16} color={c.primary} />
        </View>
        <Text size="sm" weight="semibold" color="fg2">
          New announcement
        </Text>
        {current.priority === 'URGENT' ? (
          <Badge tone="red" dot>
            Urgent
          </Badge>
        ) : current.priority === 'HIGH' ? (
          <Badge tone="amber" dot>
            Important
          </Badge>
        ) : null}
        {current.pinned ? (
          <Badge tone="blue" icon={Pin}>
            Pinned
          </Badge>
        ) : null}
      </View>
      <Text size="md" color="fg2" numberOfLines={10}>
        {current.excerpt || 'Open the announcement to read it.'}
      </Text>
      {queue.length > 1 ? (
        <Text size="xs" color="muted">{`1 of ${queue.length} new announcements`}</Text>
      ) : null}
      <Button onPress={() => done(true)}>{queue.length > 1 ? 'Got it, next' : 'Got it'}</Button>
      <Button variant="outline" onPress={open}>
        Read full announcement
      </Button>
      <Button variant="ghost" onPress={() => done(false)}>
        Later
      </Button>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space(2) },
  icon: { width: 28, height: 28, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});
