import { Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { toast } from '@/components';
import { shareDownload, toApiError, type UploadFile } from '@/lib/api';

export type ImageSource = 'camera' | 'library';

/** Image types every upload endpoint accepts (validated by magic bytes on the server). */
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

const extensionOf = (mime: string) => (mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg');

/**
 * Takes a photo or picks one from the library (asking for permission first).
 * Returns `null` when the user cancels or the image is not acceptable (a toast explains why).
 */
export const pickImage = async (
  source: ImageSource,
  { maxMb = 10, square = false, prefix = 'photo' }: { maxMb?: number; square?: boolean; prefix?: string } = {},
): Promise<UploadFile | null> => {
  try {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        toast.error('Camera access is off', 'Allow camera access in Settings to take a photo.');
        if (!perm.canAskAgain) void Linking.openSettings();
        return null;
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        toast.error('Photo access is off', 'Allow photo library access in Settings to choose a picture.');
        if (!perm.canAskAgain) void Linking.openSettings();
        return null;
      }
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: square,
      aspect: square ? [1, 1] : undefined,
    };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return null;
    if (asset.fileSize && asset.fileSize > maxMb * 1024 * 1024) {
      toast.error('That file is too large', `Pictures can be up to ${maxMb} MB.`);
      return null;
    }
    const type = asset.mimeType ?? 'image/jpeg';
    if (!ACCEPTED.includes(type)) {
      toast.error('Unsupported picture format', 'Use a JPG, PNG or WebP image. On iPhone, set Camera › Formats to "Most Compatible".');
      return null;
    }
    return { uri: asset.uri, name: asset.fileName ?? `${prefix}-${Date.now()}.${extensionOf(type)}`, type };
  } catch (err) {
    toast.error('Could not attach the picture', toApiError(err).message);
    return null;
  }
};

/** Downloads a protected file and opens the share / open-with sheet; errors become toasts. */
export const openProtectedFile = async (path: string, { fileName, mimeType }: { fileName?: string; mimeType?: string } = {}) => {
  try {
    await shareDownload(path, { fileName, mimeType, dialogTitle: fileName });
    return true;
  } catch (err) {
    toast.error('Could not open the file', toApiError(err).message);
    return false;
  }
};

export const formatBytes = (bytes: number | null | undefined) => {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / (1024 * 104.857)) / 10} MB`;
};
