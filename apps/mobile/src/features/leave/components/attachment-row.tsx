import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Paperclip, Share2 } from 'lucide-react-native';
import { Text, toast } from '@/components';
import { shareDownload, toApiError } from '@/lib/api';
import { radius, space, TOUCH_TARGET, useTheme } from '@/theme';

export const formatBytes = (bytes: number | null | undefined) => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** A protected file (`/files/:id`): tap to download and open the system share / open-with sheet. */
export const AttachmentRow = ({
  fileId,
  name,
  size,
  mimeType,
}: {
  fileId: string;
  name?: string | null;
  size?: number | null;
  mimeType?: string | null;
}) => {
  const { c } = useTheme();
  const [busy, setBusy] = useState(false);
  const shown = name || 'Attachment';
  const open = async () => {
    setBusy(true);
    try {
      await shareDownload(`/files/${fileId}`, { fileName: name ?? undefined, mimeType: mimeType ?? undefined, dialogTitle: shown });
    } catch (err) {
      toast.error('Could not open the attachment', toApiError(err).message);
    } finally {
      setBusy(false);
    }
  };
  const bytes = formatBytes(size);
  return (
    <Pressable
      onPress={() => void open()}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`Attachment ${shown}${bytes ? `, ${bytes}` : ''}`}
      accessibilityHint="Downloads the file and opens the share sheet"
      accessibilityState={{ busy, disabled: busy }}
      style={({ pressed }) => [styles.row, { borderColor: c.line, backgroundColor: pressed ? c.surface3 : c.surface2 }]}
    >
      <Paperclip size={18} color={c.accent} />
      <View style={styles.flex}>
        <Text size="sm" weight="medium" numberOfLines={1}>
          {shown}
        </Text>
        {bytes ? (
          <Text size="xs" color="muted">
            {bytes}
          </Text>
        ) : null}
      </View>
      {busy ? <ActivityIndicator color={c.accent} /> : <Share2 size={18} color={c.muted} />}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    minHeight: TOUCH_TARGET + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
  },
});
