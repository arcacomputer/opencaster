import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text } from 'react-native';
import { openHttpsUrl } from '../lib/openHttpsUrl';
import { palette } from '../theme';

const INITIAL_ASPECT_RATIO = 16 / 9;

export function RemoteImageEmbed({ index, uri, thumbnail = false }: { index: number; uri: string; thumbnail?: boolean }) {
  const [aspectRatio, setAspectRatio] = useState(INITIAL_ASPECT_RATIO);
  const [failed, setFailed] = useState(false);
  const frame = [styles.frame, { aspectRatio: thumbnail ? 1 : aspectRatio }];

  if (failed) {
    return (
      <Pressable
        accessibilityHint="Opens this HTTPS link with an available app."
        accessibilityLabel={`Open HTTPS link for cast media ${index}`}
        accessibilityRole="link"
        onPress={() => void openHttpsUrl(uri)}
        style={[...frame, styles.fallback]}
      >
        <Text style={styles.fallbackText}>Image unavailable · Open link</Text>
      </Pressable>
    );
  }

  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`Open cast media ${index}`} accessibilityHint="Opens the full HTTPS image with an available app." onPress={() => void openHttpsUrl(uri)}>
    <Image
      accessibilityLabel={`Cast media ${index}`}
      onError={() => setFailed(true)}
      onLoad={({ nativeEvent }) => {
        const { width, height } = nativeEvent.source;
        if (!thumbnail && width > 0 && height > 0) setAspectRatio(width / height);
      }}
      resizeMode={thumbnail ? 'cover' : 'contain'}
      source={{ uri }}
      style={frame}
    />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: palette.raised,
    borderRadius: 12,
    maxHeight: 360,
    minHeight: 120,
    width: '100%',
  },
  fallback: {
    alignItems: 'center',
    borderColor: palette.border,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  fallbackText: {
    color: palette.cyan,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
});
