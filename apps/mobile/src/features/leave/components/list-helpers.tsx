import { useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, View } from 'react-native';
import { Button, Text } from '@/components';
import { space, useTheme } from '@/theme';

/** Themed pull-to-refresh control for FlatLists; the spinner shows until `onRefresh` settles. */
export const usePullToRefresh = (onRefresh: () => Promise<unknown>) => {
  const { c } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const run = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } catch {
      /* lists render their own error state */
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => void run()}
      tintColor={c.accent}
      colors={[c.primary]}
      progressBackgroundColor={c.surface}
    />
  );
};

/** Footer for infinite lists: spinner while the next page loads, retry when it failed. */
export const ListFooter = ({
  loading,
  error,
  onRetry,
  done,
  count,
}: {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  done: boolean;
  count: number;
}) => {
  const { c } = useTheme();
  if (loading) {
    return (
      <View style={styles.footer} accessibilityLabel="Loading more" accessible>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.footer}>
        <Text size="sm" color="muted" align="center">
          Could not load more.
        </Text>
        <Button variant="outline" onPress={onRetry} accessibilityLabel="Try loading more again">
          Try again
        </Button>
      </View>
    );
  }
  if (done && count > 0) {
    return (
      <View style={styles.footer}>
        <Text size="xs" color="subtle" align="center">
          {`${count} ${count === 1 ? 'item' : 'items'} · end of list`}
        </Text>
      </View>
    );
  }
  return null;
};

/** Value that follows `value` after it stays unchanged for `delayMs`. */
export const useDebouncedValue = <T,>(value: T, delayMs: number) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
};

const styles = StyleSheet.create({
  footer: { paddingVertical: space(4), alignItems: 'center', gap: space(2) },
});
