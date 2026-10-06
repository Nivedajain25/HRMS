import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Camera, ImagePlus, Pencil, UserX } from 'lucide-react-native';
import { BottomSheet, Button, Card, EmptyState, ErrorState, Header, IconButton, ListItem, Screen, Skeleton, Text, toast } from '@/components';
import { toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { radius, space, useTheme } from '@/theme';
import { useMyEmployee, useUploadPhoto } from '../api';
import { EmployeeSections, ProfileHeaderCard } from '../components/employee-sections';
import { pickImage, type ImageSource } from '../kit/files';

/** `tab`: shown as the Profile tab in the bottom bar (large coloured header, no back button). */
export const ProfileScreen = ({ tab }: { tab?: boolean }) => {
  const { c } = useTheme();
  const { hasEmployee } = useAuth();
  const me = useMyEmployee();
  const photo = useUploadPhoto();
  const [sheet, setSheet] = useState(false);
  const e = me.data;

  const changePhoto = async (source: ImageSource) => {
    setSheet(false);
    if (!e) return;
    // Let the sheet's modal finish closing: iOS cannot present the picker over a dismissing modal.
    if (Platform.OS === 'ios') await new Promise((resolve) => setTimeout(resolve, 400));
    const file = await pickImage(source, { maxMb: 5, square: true, prefix: 'profile' });
    if (!file) return;
    try {
      await photo.mutateAsync({ employeeId: e._id, file });
      toast.success('Photo updated');
    } catch (err) {
      toast.error('Could not update your photo', toApiError(err).message);
    }
  };

  const photoAction = (
    <Pressable
      onPress={() => setSheet(true)}
      disabled={photo.isPending}
      accessibilityRole="button"
      accessibilityLabel="Change profile photo"
      accessibilityState={{ busy: photo.isPending }}
      hitSlop={6}
      style={({ pressed }) => [styles.photoButton, { backgroundColor: pressed ? c.primaryPressed : c.primary, borderColor: c.surface }]}
    >
      {photo.isPending ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Camera size={18} color={c.onPrimary} />}
    </Pressable>
  );

  return (
    <Screen
      inTabs={tab}
      header={
        <Header
          title="My Profile"
          back={!tab}
          backTo="/more"
          large={tab}
          tone={tab ? 'blue' : undefined}
          right={e ? <IconButton icon={Pencil} color={c.fg} onPress={() => router.push('/more/profile/edit')} accessibilityLabel="Edit my details" /> : undefined}
        />
      }
      onRefresh={hasEmployee ? () => me.refetch() : undefined}
    >
      {!hasEmployee ? (
        <Card>
          <EmptyState icon={UserX} title="No employee profile" message="Your account is not linked to an employee record. Contact HR if this is unexpected." />
        </Card>
      ) : me.isLoading ? (
        <Card style={styles.skeleton}>
          <Skeleton width={88} height={88} rounded />
          <Skeleton width={180} height={20} />
          <Skeleton width={220} height={14} />
        </Card>
      ) : me.error ? (
        <Card>
          <ErrorState title="Could not load your profile" error={me.error} onRetry={() => void me.refetch()} />
        </Card>
      ) : !e ? (
        <Card>
          <EmptyState icon={UserX} title="No employee profile" message="Your account is not linked to an employee record." />
        </Card>
      ) : (
        <>
          <ProfileHeaderCard e={e} photoAction={photoAction} />
          <Card padding={0}>
            <ListItem
              title="Edit contact & emergency details"
              subtitle="Employment details are maintained by HR"
              left={<Pencil size={20} color={c.accent} />}
              onPress={() => router.push('/more/profile/edit')}
            />
          </Card>
          <EmployeeSections e={e} self />
        </>
      )}
      <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Profile photo" description="Square JPG, PNG or WebP, up to 5 MB.">
        <Button variant="outline" icon={Camera} onPress={() => void changePhoto('camera')}>
          Take photo
        </Button>
        <Button variant="outline" icon={ImagePlus} onPress={() => void changePhoto('library')}>
          Choose from library
        </Button>
        <Text size="xs" color="muted" align="center">
          Your photo is visible to colleagues across the organization.
        </Text>
      </BottomSheet>
    </Screen>
  );
};

const styles = StyleSheet.create({
  skeleton: { alignItems: 'center', gap: space(3) },
  photoButton: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 36,
    height: 36,
    borderRadius: radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
