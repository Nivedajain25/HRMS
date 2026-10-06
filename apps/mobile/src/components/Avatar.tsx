import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { apiUrl, authHeaders } from '@/lib/api';
import { initials } from '@/lib/format';
import { brand, useTheme } from '@/theme';
import { Text } from './Text';

export interface AvatarProps {
  name: string;
  /** Protected image path such as `/api/v1/files/<id>` (or an absolute URL). */
  uri?: string | null;
  size?: number;
}

/** Profile photo loaded with the bearer token; falls back to initials. */
export const Avatar = ({ name, uri, size = 40 }: AvatarProps) => {
  const { c } = useTheme();
  const [failed, setFailed] = useState<string | null>(null);
  const shape = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View
      style={[styles.base, shape, { backgroundColor: c.scheme === 'dark' ? 'rgba(99,102,241,0.2)' : brand[100] }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={name}
    >
      {uri && failed !== uri ? (
        <Image
          source={{ uri: apiUrl(uri), headers: authHeaders(), cacheKey: uri }}
          style={shape}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={120}
          onError={() => setFailed(uri)}
        />
      ) : (
        <Text
          weight="semibold"
          size={size >= 56 ? 'xl' : size >= 40 ? 'sm' : 'xs'}
          style={{ color: c.scheme === 'dark' ? brand[200] : brand[700] }}
        >
          {initials(name) || '?'}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
