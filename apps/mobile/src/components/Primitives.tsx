import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { palette } from '../theme';

export function ScreenMessage({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <View style={styles.message}>
      <Text accessibilityRole="header" style={styles.messageTitle}>{title}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      {action}
    </View>
  );
}

export function ActionButton({
  label,
  accessibilityLabel,
  onPress,
  disabled = false,
  secondary = false,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondaryButton,
        disabled && styles.disabledButton,
        pressed && !disabled && styles.pressedButton,
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{label}</Text>
    </Pressable>
  );
}

export function LoadingMessage({ label = 'Loading public data…' }: { label?: string }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.loading}>
      <ActivityIndicator color={palette.cyan} />
      <Text style={styles.detail}>{label}</Text>
    </View>
  );
}

export function PublicPreviewNotice() {
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeEyebrow}>HYPERSNAP MOBILE PREVIEW</Text>
      <Text style={styles.noticeText}>
        Public data from Hypersnap through Opencaster. The index may be incomplete or unavailable.
        Optional device authorization uses a separate offline signer for text posts, replies, likes and recasts.
        The app never imports custody keys or recovery phrases.
        Moderation and store-readiness work is not complete.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  message: {
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
  messageTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: '700',
  },
  detail: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  button: {
    alignItems: 'center',
    backgroundColor: palette.cyan,
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 16,
  },
  secondaryButton: {
    backgroundColor: palette.raised,
    borderColor: palette.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  disabledButton: {
    opacity: 0.5,
  },
  pressedButton: {
    opacity: 0.75,
  },
  buttonText: {
    color: palette.cyanInk,
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButtonText: {
    color: palette.text,
  },
  loading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    padding: 20,
  },
  notice: {
    backgroundColor: palette.raised,
    borderColor: palette.border,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    padding: 16,
  },
  noticeEyebrow: {
    color: palette.cyan,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  noticeText: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 21,
  },
});
