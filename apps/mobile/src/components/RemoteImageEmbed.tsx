import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text } from 'react-native';
import { openHttpsUrl } from '../lib/openHttpsUrl';
import { palette } from '../theme';

const INITIAL_ASPECT_RATIO = 16 / 9;

export function RemoteImageEmbed({ index, uri }: { index: number; uri: string }) {
  const [aspectRatio, setAspectRatio] = useState(INITIAL_ASPECT_RATIO);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <Pressable
        accessibilityHint="Opens this HTTPS link with an available app."
        accessibilityLabel={`Open HTTPS link for cast media ${index}`}
        accessibilityRole="link"
        onPress={() => void openHttpsUrl(uri)}
        style={[styles.frame, styles.fallback, { aspectRatio }]}
      >
        <Text style={styles.fallbackText}>Image unavailable · Open link</Text>
      </Pressable>
    );
  }

  return (
    <Image
      accessibilityLabel={`Cast media ${index}`}
      onError={() => setFailed(true)}
      onLoad={({ nativeEvent }) => {
        const { width, height } = nativeEvent.source;
        if (width > 0 && height > 0) setAspectRatio(width / height);
      }}
      resizeMode="contain"
      source={{ uri }}
      style={[styles.frame, { aspectRatio }]}
    />
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
