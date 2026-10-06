import { StyleSheet, View } from 'react-native';
import { Camera, ImagePlus } from 'lucide-react-native';
import { Button, Text } from '@/components';
import { radius, space, useTheme } from '@/theme';
import type { ImageSource } from './files';

/** Red pill with a count (unread badges). Renders nothing for 0. */
export const CountBadge = ({ count, label }: { count: number | undefined; label: string }) => {
  const { c } = useTheme();
  const n = count ?? 0;
  if (n <= 0) return null;
  return (
    <View style={[styles.badge, { backgroundColor: c.danger }]} accessible accessibilityLabel={`${n} ${label}`}>
      <Text size="xs" weight="bold" style={styles.badgeText}>
        {n > 99 ? '99+' : String(n)}
      </Text>
    </View>
  );
};

/** "Take photo" / "Choose" buttons side by side. */
export const ImageSourceButtons = ({
  onPick,
  disabled,
  cameraLabel = 'Take photo',
  libraryLabel = 'Choose',
}: {
  onPick: (source: ImageSource) => void;
  disabled?: boolean;
  cameraLabel?: string;
  libraryLabel?: string;
}) => (
  <View style={styles.pickers}>
    <Button variant="outline" icon={Camera} onPress={() => onPick('camera')} disabled={disabled} style={styles.flex}>
      {cameraLabel}
    </Button>
    <Button variant="outline" icon={ImagePlus} onPress={() => onPick('library')} disabled={disabled} style={styles.flex}>
      {libraryLabel}
    </Button>
  </View>
);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  badge: { minWidth: 22, height: 22, borderRadius: radius.full, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#ffffff', fontSize: 11, lineHeight: 14 },
  pickers: { flexDirection: 'row', gap: space(2) },
});
