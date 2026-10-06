import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Camera, ImagePlus } from 'lucide-react-native';
import { Avatar, BottomSheet, Button, Text, toast } from '@/components';
import { toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fullName } from '@/lib/format';
import { radius, useTheme } from '@/theme';
import { useUploadPhoto } from '../api';
import { pickImage, type ImageSource } from '../kit/files';

/**
 * The signed-in user's avatar with a small camera badge: tap to take or choose a new profile photo.
 * Accounts without an employee profile just get the plain avatar (there is no photo to update).
 */
export const AvatarPhotoButton = ({ size = 40 }: { size?: number }) => {
  const { c } = useTheme();
  const { user } = useAuth();
  const photo = useUploadPhoto();
  const [sheet, setSheet] = useState(false);
  const name = user ? fullName(user) : '';
  const employeeId = user?.employeeId ?? null;

  if (!employeeId) return <Avatar name={name} uri={user?.avatar} size={size} />;

  const changePhoto = async (source: ImageSource) => {
    setSheet(false);
    // Let the sheet's modal finish closing: iOS cannot present the picker over a dismissing modal.
    if (Platform.OS === 'ios') await new Promise((resolve) => setTimeout(resolve, 400));
    const file = await pickImage(source, { maxMb: 5, square: true, prefix: 'profile' });
    if (!file) return;
    try {
      await photo.mutateAsync({ employeeId, file });
      toast.success('Photo updated');
    } catch (err) {
      toast.error('Could not update your photo', toApiError(err).message);
    }
  };

  const badge = Math.max(18, Math.round(size * 0.45));
  return (
    <>
      <Pressable
        onPress={() => setSheet(true)}
        disabled={photo.isPending}
        accessibilityRole="button"
        accessibilityLabel="Change profile photo"
        accessibilityState={{ busy: photo.isPending }}
        hitSlop={6}
      >
        <Avatar name={name} uri={user?.avatar} size={size} />
        <View
          style={[
            styles.badge,
            { width: badge, height: badge, backgroundColor: c.primary, borderColor: c.canvas },
          ]}
        >
          {photo.isPending ? <ActivityIndicator size="small" color={c.onPrimary} /> : <Camera size={Math.round(badge * 0.55)} color={c.onPrimary} />}
        </View>
      </Pressable>
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
    </>
  );
};

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    borderRadius: radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
