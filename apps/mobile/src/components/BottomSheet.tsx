import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { radius, space, useTheme } from '@/theme';
import { IconButton } from './Button';
import { Text } from './Text';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  /** Pinned actions below the (scrollable) content. */
  footer?: ReactNode;
  /** Close on backdrop tap / back button (default true). */
  dismissable?: boolean;
}

/** Modal sheet anchored to the bottom of the screen (pickers, confirmations, small forms). */
export const BottomSheet = ({ open, onClose, title, description, children, footer, dismissable = true }: BottomSheetProps) => {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const close = () => {
    if (dismissable) onClose();
  };
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={styles.flex}>
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay }]}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
          <View style={styles.spacer} pointerEvents="none" />
          <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + space(4) }]} accessibilityViewIsModal>
            <View style={[styles.handle, { backgroundColor: c.lineStrong }]} />
            {title ? (
              <View style={styles.header}>
                <View style={styles.flex}>
                  <Text size="lg" weight="semibold" accessibilityRole="header">
                    {title}
                  </Text>
                  {description ? (
                    <Text size="sm" color="muted">
                      {description}
                    </Text>
                  ) : null}
                </View>
                {dismissable ? <IconButton icon={X} onPress={onClose} accessibilityLabel="Close" /> : null}
              </View>
            ) : null}
            <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  spacer: { flex: 1, minHeight: 80 },
  sheet: { borderTopLeftRadius: radius.lg + 4, borderTopRightRadius: radius.lg + 4, maxHeight: '88%', paddingTop: space(2) },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: space(2) },
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingLeft: space(4), paddingRight: space(2), gap: space(2) },
  body: { flexGrow: 0 },
  bodyContent: { paddingHorizontal: space(4), paddingTop: space(2), paddingBottom: space(2), gap: space(3) },
  footer: { paddingHorizontal: space(4), paddingTop: space(2), gap: space(2) },
});
