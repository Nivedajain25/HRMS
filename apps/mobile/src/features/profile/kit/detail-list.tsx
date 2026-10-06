import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Text } from '@/components';
import { space, useTheme } from '@/theme';

export interface DetailItem {
  label: string;
  /** Empty values (`null`, `undefined`, `''`) are skipped. */
  value: ReactNode;
  /** Monospace-like tabular digits (IDs, account numbers). */
  tabular?: boolean;
  /** Accessible text when `value` is not a string. */
  accessibilityValue?: string;
}

const isEmpty = (v: ReactNode) => v === null || v === undefined || v === '' || v === false;

/** Label / value rows (the web `DescriptionList`). Stacks on narrow screens. */
export const DetailList = ({ items }: { items: DetailItem[] }) => {
  const { c } = useTheme();
  const rows = items.filter((i) => !isEmpty(i.value));
  return (
    <View>
      {rows.map((item, i) => (
        <View
          key={item.label}
          style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}
          accessible
          accessibilityLabel={`${item.label}: ${typeof item.value === 'string' || typeof item.value === 'number' ? String(item.value) : (item.accessibilityValue ?? '')}`}
        >
          <Text size="sm" color="muted" style={styles.label}>
            {item.label}
          </Text>
          <View style={styles.value}>
            {typeof item.value === 'string' || typeof item.value === 'number' ? (
              <Text size="sm" weight="medium" align="right" tabular={item.tabular}>
                {String(item.value)}
              </Text>
            ) : (
              item.value
            )}
          </View>
        </View>
      ))}
    </View>
  );
};

/** Titled card with a detail list; renders nothing (or `empty`) when every value is empty. */
export const DetailCard = ({ title, items, empty, footer }: { title: string; items: DetailItem[]; empty?: string; footer?: ReactNode }) => {
  const hasRows = items.some((i) => !isEmpty(i.value));
  if (!hasRows && !empty) return null;
  return (
    <Card style={styles.card}>
      <Text size="lg" weight="semibold" accessibilityRole="header">
        {title}
      </Text>
      {hasRows ? (
        <DetailList items={items} />
      ) : (
        <Text size="sm" color="muted">
          {empty}
        </Text>
      )}
      {footer}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: { gap: space(2) },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: space(2), paddingVertical: space(2.5) },
  label: { flexGrow: 1, flexShrink: 1, flexBasis: 110 },
  value: { flexGrow: 1, flexShrink: 1, flexBasis: 140, alignItems: 'flex-end' },
});
