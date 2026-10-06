import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { CheckCircle2, Info, XCircle } from 'lucide-react-native';
import { radius, space, useTheme } from '@/theme';
import { Text } from './Text';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  title: string;
  description?: string;
}

const useToastStore = create<{ items: ToastItem[] }>(() => ({ items: [] }));
let nextId = 1;

const push = (type: ToastType, title: string, description?: string) => {
  const item: ToastItem = { id: nextId++, type, title, description };
  useToastStore.setState((s) => ({ items: [...s.items.slice(-2), item] }));
  AccessibilityInfo.announceForAccessibility(description ? `${title}. ${description}` : title);
  setTimeout(() => dismiss(item.id), type === 'error' ? 6000 : 3500);
  return item.id;
};

const dismiss = (id: number) => useToastStore.setState((s) => ({ items: s.items.filter((t) => t.id !== id) }));

/** Lightweight global toasts (`toast.success('Saved')`). */
export const toast = {
  success: (title: string, description?: string) => push('success', title, description),
  error: (title: string, description?: string) => push('error', title, description),
  info: (title: string, description?: string) => push('info', title, description),
  dismiss,
};

const ToastCard = ({ item }: { item: ToastItem }) => {
  const { c } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [anim]);
  const Icon = item.type === 'success' ? CheckCircle2 : item.type === 'error' ? XCircle : Info;
  const color = item.type === 'success' ? c.success : item.type === 'error' ? c.danger : c.accent;
  return (
    <Animated.View style={{ opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }}>
      <Pressable
        onPress={() => dismiss(item.id)}
        accessibilityRole="alert"
        accessibilityHint="Dismisses the message"
        style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]}
      >
        <Icon size={20} color={color} />
        <View style={styles.text}>
          <Text weight="semibold" size="sm">
            {item.title}
          </Text>
          {item.description ? (
            <Text size="sm" color="muted">
              {item.description}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
};

/** Renders active toasts above everything (mount once near the root). */
export const ToastViewport = () => {
  const items = useToastStore((s) => s.items);
  const insets = useSafeAreaInsets();
  if (!items.length) return null;
  return (
    <View pointerEvents="box-none" style={[styles.viewport, { top: insets.top + space(2) }]}>
      {items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  viewport: { position: 'absolute', left: space(4), right: space(4), gap: space(2), zIndex: 1000, elevation: 1000 },
  card: {
    flexDirection: 'row',
    gap: space(3),
    alignItems: 'flex-start',
    padding: space(3),
    borderRadius: radius.md,
    borderWidth: 1,
    shadowColor: '#101828',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  text: { flex: 1, gap: 2 },
});
