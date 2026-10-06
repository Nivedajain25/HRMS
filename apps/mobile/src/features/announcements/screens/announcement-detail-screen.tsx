import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { FileText, Megaphone, Paperclip, Pin } from 'lucide-react-native';
import { Avatar, Badge, Card, EmptyState, ErrorState, Header, ListItem, Screen, SectionHeader, Skeleton, StatusBadge, Text } from '@/components';
import { formatBytes, openProtectedFile } from '@/features/profile/kit/files';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fullName } from '@/lib/format';
import { formatDateTimeIn } from '@/lib/time';
import { space, useTheme } from '@/theme';
import { attachmentName, useAnnouncement, useMarkAnnouncementRead, type AnnouncementAttachment } from '../api';
import { RichText } from '../components/rich-text';

const AttachmentRow = ({ a, divider }: { a: AnnouncementAttachment; divider: boolean }) => {
  const { c } = useTheme();
  const [busy, setBusy] = useState(false);
  const name = attachmentName(a);
  const open = async () => {
    if (busy) return;
    setBusy(true);
    await openProtectedFile(`/files/${a._id}`, { fileName: a.originalName ?? name, mimeType: a.mimeType });
    setBusy(false);
  };
  return (
    <ListItem
      divider={divider}
      title={name}
      subtitle={busy ? 'Downloading…' : formatBytes(a.size) || undefined}
      left={<FileText size={20} color={c.accent} />}
      onPress={() => void open()}
      accessibilityLabel={`Attachment ${name}`}
      accessibilityHint="Downloads the file and opens the share sheet"
    />
  );
};

export const AnnouncementDetailScreen = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { timeZone } = useAuth();
  const query = useAnnouncement(id);
  const { mutate: markRead } = useMarkAnnouncementRead();
  const marked = useRef<string | null>(null);
  const a = query.data;
  const notFound = query.error instanceof ApiError && (query.error.status === 403 || query.error.status === 404);

  // Opening an announcement marks it as read (best effort, idempotent on the server).
  useEffect(() => {
    if (a && !a.read && marked.current !== a._id) {
      marked.current = a._id;
      markRead(a._id);
    }
  }, [a, markRead]);

  const author = a?.createdBy ? fullName(a.createdBy) : null;

  return (
    <Screen header={<Header title="Announcement" back backTo="/more/announcements" />} onRefresh={() => query.refetch()}>
      {query.isLoading ? (
        <Card style={styles.gap}>
          <Skeleton width="80%" height={24} />
          <Skeleton width={160} height={14} />
          <Skeleton height={140} />
        </Card>
      ) : notFound ? (
        <Card>
          <EmptyState icon={Megaphone} title="Announcement unavailable" message="It may have expired or is not addressed to you." />
        </Card>
      ) : query.error || !a ? (
        <Card>
          <ErrorState title="Could not load this announcement" error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      ) : (
        <>
          <Card style={styles.gap}>
            {a.pinned || a.priority !== 'NORMAL' ? (
              <View style={styles.badges}>
                {a.pinned ? (
                  <Badge tone="brand" icon={Pin}>
                    Pinned
                  </Badge>
                ) : null}
                {a.priority !== 'NORMAL' ? <StatusBadge status={a.priority} /> : null}
              </View>
            ) : null}
            <Text size="lg" weight="semibold" accessibilityRole="header">
              {a.title}
            </Text>
            <View style={styles.author}>
              {a.createdBy ? <Avatar name={author ?? ''} uri={a.createdBy.avatar} size={32} /> : null}
              <View style={styles.flex}>
                {author ? (
                  <Text size="sm" weight="medium">
                    {author}
                  </Text>
                ) : null}
                <Text size="xs" color="muted">
                  {formatDateTimeIn(a.publishAt, timeZone)}
                  {a.expiresAt ? ` · until ${formatDateTimeIn(a.expiresAt, timeZone)}` : ''}
                </Text>
              </View>
            </View>
            <View style={[styles.divider, { backgroundColor: c.line }]} />
            <RichText html={a.content} />
          </Card>
          {a.attachmentIds.length ? (
            <>
              <SectionHeader title="Attachments" icon={Paperclip} count={a.attachmentIds.length} />
              <Card padding={0}>
                {a.attachmentIds.map((att, i) => (
                  <AttachmentRow key={att._id} a={att} divider={i > 0} />
                ))}
              </Card>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space(3) },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  author: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  divider: { height: StyleSheet.hairlineWidth },
});
