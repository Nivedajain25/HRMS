import { useCallback, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { space, useTheme } from '@/theme';

export interface ScreenProps {
  children: ReactNode;
  /** Fixed header above the scrolling content (e.g. `<Header />`). */
  header?: ReactNode;
  /** Fixed footer below the content (e.g. a form's submit button). */
  footer?: ReactNode;
  /** Pull-to-refresh handler; the spinner shows until the promise settles. */
  onRefresh?: () => Promise<unknown>;
  /** Wrap content in a ScrollView (default true). */
  scroll?: boolean;
  /** Avoid the keyboard (forms). */
  keyboard?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Whether the screen sits above the bottom tab bar (no bottom inset needed). */
  inTabs?: boolean;
}

/** Screen scaffold: safe areas, canvas background, optional pull-to-refresh and keyboard avoidance. */
export const Screen = ({ children, header, footer, onRefresh, scroll = true, keyboard, contentStyle, inTabs }: ScreenProps) => {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } catch {
      /* each widget renders its own error state */
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const bottomPad = inTabs || footer ? space(6) : insets.bottom + space(6);
  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.content, { paddingBottom: bottomPad }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={c.accent}
            colors={[c.primary]}
            progressBackgroundColor={c.surface}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, contentStyle]}>{children}</View>
  );

  const inner = (
    <>
      {header}
      {body}
      {footer ? (
        <View
          style={[
            styles.footer,
            { backgroundColor: c.surface, borderTopColor: c.line, paddingBottom: (inTabs ? 0 : insets.bottom) + space(3) },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </>
  );

  return (
    <View style={[styles.flex, { backgroundColor: c.canvas, paddingTop: insets.top }]}>
      {keyboard ? (
        // Android runs edge-to-edge, so the window no longer resizes for the keyboard: pad on both platforms.
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          {inner}
        </KeyboardAvoidingView>
      ) : (
        inner
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: space(4), gap: space(4) },
  footer: { paddingHorizontal: space(4), paddingTop: space(3), borderTopWidth: StyleSheet.hairlineWidth },
});
