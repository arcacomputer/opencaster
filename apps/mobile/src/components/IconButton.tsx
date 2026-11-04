import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { palette } from '../theme';

export type IconName = ComponentProps<typeof Feather>['name'];

export function IconButton({ icon, label, onPress, disabled = false }: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}>
    <Feather name={icon} size={22} color={palette.text} accessible={false} />
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  pressed: { backgroundColor: palette.raised },
  disabled: { opacity: 0.4 },
});
