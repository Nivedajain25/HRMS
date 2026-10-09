import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { router, type Href } from 'expo-router';
import { radius, space, useTheme } from '@/theme';
import type { IconComponent } from './Button';
import { Text } from './Text';

export interface RelatedLink {
  label: string;
  icon: IconComponent;
  href: Href;
}

/**
 * "Related" shortcuts at the top of a section (e.g. Attendance → Regularization · Apply leave · Holidays), so the
 * sections that go together are one tap apart. Pills in the role's colour; scrolls sideways on narrow phones.
 */
export const RelatedLinks = ({ links }: { links: RelatedLink[] }) => {
  const { c } = useTheme();
  if (!links.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="list">
      {links.map(({ label, icon: Icon, href }) => (
        <Pressable
          key={label}
          onPress={() => router.push(href)}
          accessibilityRole="link"
          accessibilityLabel={label}
          style={({ pressed }) => [styles.pill, { backgroundColor: pressed ? c.surface3 : c.accentSoft, borderColor: c.line }]}
        >
          <Icon size={16} color={c.accent} />
          <Text size="sm" weight="semibold" style={{ color: c.accent }}>
            {label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  row: { gap: space(2), paddingVertical: 2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.5),
    minHeight: 40,
    paddingHorizontal: space(3.5),
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
