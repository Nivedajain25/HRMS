import { Pressable, StyleSheet, View } from 'react-native';
import { Text, type IconComponent } from '@/components';
import { radius, space, TOUCH_TARGET, useTheme } from '@/theme';

export interface InboxTab<V extends string> {
  value: V;
  label: string;
  icon: IconComponent;
  /** Items waiting; `undefined` while loading. */
  count?: number;
}

/** Wrapping segmented tabs with counts (no horizontal scrolling at 360 dp). */
export const InboxTabs = <V extends string>({
  value,
  tabs,
  onChange,
}: {
  value: V;
  tabs: InboxTab<V>[];
  onChange: (v: V) => void;
}) => {
  const { c } = useTheme();
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {tabs.map((t) => {
        const selected = t.value === value;
        const countLabel = t.count === undefined ? '' : `, ${t.count} waiting`;
        return (
          <Pressable
            key={t.value}
            onPress={() => onChange(t.value)}
            accessibilityRole="tab"
            accessibilityLabel={`${t.label}${countLabel}`}
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.tab,
              {
                borderColor: selected ? c.primary : c.lineStrong,
                borderWidth: selected ? 2 : 1,
                backgroundColor: selected ? c.accentSoft : pressed ? c.surface2 : c.surface,
              },
            ]}
          >
            <t.icon size={16} color={selected ? c.accent : c.fg2} />
            <Text size="sm" weight={selected ? 'semibold' : 'medium'} style={{ color: selected ? c.accent : c.fg2 }} numberOfLines={1}>
              {t.label}
            </Text>
            {t.count !== undefined ? (
              <View style={[styles.count, { backgroundColor: t.count > 0 ? (selected ? c.primary : c.fg2) : c.surface3 }]}>
                <Text size="xs" weight="semibold" style={{ color: t.count > 0 ? (selected ? c.onPrimary : c.surface) : c.muted }} tabular>
                  {t.count > 99 ? '99+' : String(t.count)}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  tab: {
    flexGrow: 1,
    minHeight: TOUCH_TARGET,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(1.5),
    paddingHorizontal: space(3),
  },
  count: { minWidth: 22, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
});
