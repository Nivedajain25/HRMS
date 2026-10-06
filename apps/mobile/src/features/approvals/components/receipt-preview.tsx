import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ImageOff, X } from 'lucide-react-native';
import { IconButton, Skeleton, Text } from '@/components';
import { apiUrl, authHeaders } from '@/lib/api';
import { radius, space, useTheme } from '@/theme';

/** Receipt image loaded with the bearer token (`/files/:id?inline=1`); tap to view full screen. */
export const ReceiptPreview = ({ fileId, name }: { fileId: string; name: string }) => {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [open, setOpen] = useState(false);
  const source = { uri: apiUrl(`/files/${fileId}`, { inline: 1 }), headers: authHeaders(), cacheKey: `receipt-${fileId}` };

  if (state === 'failed') {
    return (
      <View style={[styles.failed, { borderColor: c.line, backgroundColor: c.surface2 }]}>
        <ImageOff size={18} color={c.muted} />
        <Text size="sm" color="muted" style={styles.flex}>
          The receipt preview could not be loaded. Use the file below to open it.
        </Text>
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={state !== 'ready'}
        accessibilityRole="imagebutton"
        accessibilityLabel={`Receipt ${name}`}
        accessibilityHint="Opens the receipt full screen"
        style={[styles.frame, { borderColor: c.line, backgroundColor: c.surface2 }]}
      >
        <Image
          source={source}
          style={styles.image}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={120}
          onLoad={() => setState('ready')}
          onError={() => setState('failed')}
          accessibilityIgnoresInvertColors
        />
        {state === 'loading' ? <Skeleton height={220} style={StyleSheet.absoluteFill} /> : null}
      </Pressable>
      <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent navigationBarTranslucent>
        <View style={[styles.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom }]} accessibilityViewIsModal>
          <View style={styles.viewerBar}>
            <Text weight="semibold" numberOfLines={1} style={[styles.flex, styles.viewerTitle]}>
              {name}
            </Text>
            <IconButton icon={X} color="#ffffff" onPress={() => setOpen(false)} accessibilityLabel="Close receipt" />
          </View>
          <Image source={source} style={styles.flex} contentFit="contain" cachePolicy="memory-disk" accessibilityLabel={`Receipt ${name}`} />
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  frame: { height: 220, borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  failed: { flexDirection: 'row', alignItems: 'center', gap: space(2), borderWidth: 1, borderRadius: radius.md, padding: space(3) },
  viewer: { flex: 1, backgroundColor: '#000000' },
  viewerBar: { flexDirection: 'row', alignItems: 'center', paddingLeft: space(4), paddingRight: space(2), minHeight: 56 },
  viewerTitle: { color: '#ffffff' },
});
