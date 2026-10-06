import { StyleSheet, View } from 'react-native';
import { Keyboard, Laptop, Monitor, Mouse, Package, Smartphone, Tablet, Car, UserX } from 'lucide-react-native';
import { Badge, Card, EmptyState, ErrorState, Header, Screen, SkeletonList, Text, type IconComponent } from '@/components';
import { DetailList } from '@/features/profile/kit/detail-list';
import { useAuth } from '@/lib/auth';
import { fullName, label } from '@/lib/format';
import { formatDate } from '@/lib/time';
import { radius, space, useTheme, type Tone } from '@/theme';
import { useMyAssets, type MyAssetAssignment } from '../api';

const CATEGORY_ICONS: Record<string, IconComponent> = {
  LAPTOP: Laptop,
  DESKTOP: Monitor,
  MONITOR: Monitor,
  PHONE: Smartphone,
  TABLET: Tablet,
  KEYBOARD: Keyboard,
  MOUSE: Mouse,
  VEHICLE: Car,
};

const CONDITION_TONE: Record<string, Tone> = { NEW: 'green', GOOD: 'blue', FAIR: 'amber', DAMAGED: 'red' };

const AssetCard = ({ a }: { a: MyAssetAssignment }) => {
  const { c } = useTheme();
  const asset = typeof a.assetId === 'object' ? a.assetId : null;
  const Icon = (asset && CATEGORY_ICONS[asset.category]) || Package;
  const condition = a.conditionAtAssignment ?? asset?.condition;
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: c.accentSoft }]}>
          <Icon size={22} color={c.accent} />
        </View>
        <View style={styles.flex}>
          <Text weight="semibold" numberOfLines={2}>
            {asset?.name ?? 'Asset'}
          </Text>
          <Text size="xs" color="muted" numberOfLines={1}>
            {[asset?.assetTag, asset ? label(asset.category) : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {condition ? <Badge tone={CONDITION_TONE[condition] ?? 'gray'}>{label(condition)}</Badge> : null}
      </View>
      <DetailList
        items={[
          { label: 'Brand / model', value: [asset?.brand, asset?.model].filter(Boolean).join(' ') || null },
          { label: 'Serial number', value: asset?.serialNumber, tabular: true },
          { label: 'Assigned on', value: formatDate(a.assignedDate) },
          { label: 'Expected return', value: a.expectedReturnDate ? formatDate(a.expectedReturnDate) : null },
          { label: 'Assigned by', value: a.assignedBy ? fullName(a.assignedBy) : null },
          { label: 'Notes', value: a.notes },
        ]}
      />
    </Card>
  );
};

export const MyAssetsScreen = () => {
  const { hasEmployee } = useAuth();
  const query = useMyAssets();
  const items = query.data ?? [];
  return (
    <Screen
      header={<Header title="My assets" subtitle="Equipment assigned to you" back backTo="/more" />}
      onRefresh={hasEmployee ? () => query.refetch() : undefined}
    >
      {!hasEmployee ? (
        <Card>
          <EmptyState icon={UserX} title="No employee profile" message="Assets are assigned to employee records." />
        </Card>
      ) : query.isLoading ? (
        <Card>
          <SkeletonList rows={3} />
        </Card>
      ) : query.error ? (
        <Card>
          <ErrorState title="Could not load your assets" error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={Package} title="No assets assigned" message="Laptops, phones and other equipment issued to you will appear here." />
        </Card>
      ) : (
        <>
          <Text size="sm" color="muted">
            {`${items.length} ${items.length === 1 ? 'item' : 'items'} assigned. Contact IT or HR to return or report damage.`}
          </Text>
          <View style={styles.list}>
            {items.map((a) => (
              <AssetCard key={a._id} a={a} />
            ))}
          </View>
        </>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: space(3) },
  card: { gap: space(2) },
  head: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  icon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
