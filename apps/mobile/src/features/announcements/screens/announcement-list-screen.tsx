import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Megaphone, Paperclip, Pin } from 'lucide-react-native';
import { Card, EmptyState, ErrorState, Header, Screen, SkeletonList, StatusBadge, Text } from '@/components';
import { flattenPages, LoadMore, totalOf } from '@/features/profile/kit/infinite';
import { fullName } from '@/lib/format';
import { timeAgo } from '@/lib/time';
import { space, useTheme } from '@/theme';
import { useAnnouncementFeed, type Announcement } from '../api';
import { htmlExcerpt } from '../components/rich-text';

const AnnouncementCard = ({ a }: { a: Announcement }) => {
  const { c } = useTheme();
  const important = a.priority === 'HIGH' || a.priority === 'URGENT';
  const excerpt = htmlExcerpt(a.content);
  const author = a.createdBy ? fullName(a.createdBy) : null;
  return (
    <Card
      onPress={() => router.push({ pathname: '/more/announcements/[id]', params: { id: a._id } })}
      accessibilityLabel={[!a.read ? 'Unread' : null, a.pinned ? 'Pinned' : null, important ? `${a.priority} priority` : null, a.title, timeAgo(a.publishAt)]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint="Opens the announcement"
      style={[styles.card, !a.read && { borderColor: c.ring }]}
    >
      <View style={styles.head}>
        {!a.read ? <View style={[styles.dot, { backgroundColor: c.primary }]} /> : null}
        <Text weight={a.read ? 'medium' : 'semibold'} style={styles.flex} numberOfLines={2}>
          {a.title}
        </Text>
        {a.pinned ? <Pin size={16} color={c.accent} /> : null}
      </View>
      {excerpt ? (
        <Text size="sm" color="muted" numberOfLines={3}>
          {excerpt}
        </Text>
      ) : null}
      <View style={styles.foot}>
        <Text size="xs" color="subtle" style={styles.flex} numberOfLines={1}>
          {[author, timeAgo(a.publishAt)].filter(Boolean).join(' · ')}
        </Text>
        {a.attachmentIds.length ? (
          <View style={styles.inline}>
            <Paperclip size={12} color={c.subtle} />
            <Text size="xs" color="subtle">
              {String(a.attachmentIds.length)}
            </Text>
          </View>
        ) : null}
        {important ? <StatusBadge status={a.priority} /> : null}
      </View>
    </Card>
  );
};

export const AnnouncementListScreen = () => {
  const feed = useAnnouncementFeed();
  const items = flattenPages(feed.data);
  return (
    <Screen header={<Header title="Announcements" subtitle="Company news" back backTo="/more" />} onRefresh={() => feed.refetch()}>
      {feed.isLoading ? (
        <Card>
          <SkeletonList rows={4} />
        </Card>
      ) : feed.error ? (
        <Card>
          <ErrorState title="Could not load announcements" error={feed.error} onRetry={() => void feed.refetch()} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={Megaphone} title="No announcements" message="Company news will show up here." />
        </Card>
      ) : (
        <View style={styles.list}>
          {items.map((a) => (
            <AnnouncementCard key={a._id} a={a} />
          ))}
          <LoadMore
            hasNextPage={feed.hasNextPage}
            isFetchingNextPage={feed.isFetchingNextPage}
            onLoadMore={() => void feed.fetchNextPage()}
            shown={items.length}
            total={totalOf(feed.data)}
            noun="announcements"
          />
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: space(3) },
  card: { gap: space(2) },
  head: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  dot: { width: 8, height: 8, borderRadius: 4 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
