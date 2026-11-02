import { getUser, type User } from '@opencaster/client-core/api';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActionButton, LoadingMessage, ScreenMessage } from '../components/Primitives';
import type { RootStackParamList } from '../navigation';
import { safeHttpsUrl } from '../lib/urls';
import { usePublicRead } from '../lib/usePublicRead';
import { palette } from '../theme';
import { SafeAreaView } from 'react-native-safe-area-context';

type Props = NativeStackScreenProps<RootStackParamList, 'Lookup'>;

function UserResult({ user, onPress }: { user: User; onPress: () => void }) {
  const avatar = user.pfp_url ? safeHttpsUrl(user.pfp_url) : null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open profile for ${user.username || `FID ${user.fid}`}`} onPress={onPress} style={styles.result}>
      {avatar ? <Image accessibilityLabel="Profile image" source={{ uri: avatar }} style={styles.avatar} /> : null}
      <View style={styles.resultText}>
        <Text style={styles.name}>{user.display_name?.trim() || (user.username ? `@${user.username}` : `FID ${user.fid}`)}</Text>
        <Text style={styles.handle}>{user.username ? `@${user.username}  ·  ` : ''}FID {user.fid}</Text>
      </View>
      <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.chevron}>›</Text>
    </Pressable>
  );
}

export function LookupScreen({ navigation }: Props) {
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const read = useCallback((signal: AbortSignal) => {
    if (!submitted) return Promise.reject(new Error('Enter a username or FID.'));
    return /^\d+$/.test(submitted)
      ? getUser({ fid: Number(submitted) }, signal)
      : getUser({ username: submitted }, signal);
  }, [submitted]);
  const state = usePublicRead(`lookup:${submitted ?? ''}`, submitted ? read : null);

  const normalized = useMemo(() => input.trim().replace(/^@/, ''), [input]);
  const onSearch = useCallback(() => {
    if (!normalized) {
      setValidationError('Enter a username or FID.');
      return;
    }
    if (/^\d+$/.test(normalized) && (!Number.isSafeInteger(Number(normalized)) || Number(normalized) < 1)) {
      setValidationError('Enter a valid positive FID.');
      return;
    }
    setValidationError(null);
    if (submitted === normalized) state.retry();
    else setSubmitted(normalized);
  }, [normalized, state.retry, submitted]);

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={styles.heading}>Find a public profile</Text>
        <Text style={styles.detail}>Search by username or numeric FID. Only public profiles available through Hypersnap can be shown.</Text>
        <TextInput
          accessibilityLabel="Username or FID"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setInput}
          onSubmitEditing={onSearch}
          placeholder="Username or FID"
          placeholderTextColor={palette.muted}
          returnKeyType="search"
          style={styles.input}
          value={input}
        />
        <ActionButton label="Search" onPress={onSearch} />
        {validationError ? <Text accessibilityRole="alert" style={styles.error}>{validationError}</Text> : null}
        {state.phase === 'loading' ? <LoadingMessage label="Looking up public profile…" /> : null}
        {state.phase === 'error'
          ? (
            <ScreenMessage
              detail={state.error}
              title="Profile not available"
              action={<ActionButton label="Try again" onPress={state.retry} secondary />}
            />
          )
          : null}
        {state.phase === 'ready'
          ? (
            <UserResult
              onPress={() => navigation.navigate('Profile', { fid: state.value.fid })}
              user={state.value}
            />
          )
          : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: palette.background, flex: 1 },
  content: { gap: 16, padding: 20 },
  heading: { color: palette.text, fontSize: 24, fontWeight: '800' },
  detail: { color: palette.muted, fontSize: 15, lineHeight: 22 },
  input: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 12,
    borderWidth: 1,
    color: palette.text,
    fontSize: 16,
    minHeight: 50,
    paddingHorizontal: 14,
  },
  error: { color: palette.error, fontSize: 14 },
  result: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 72,
    padding: 14,
  },
  avatar: { backgroundColor: palette.raised, borderRadius: 22, height: 44, width: 44 },
  resultText: { flex: 1, gap: 4 },
  name: { color: palette.text, fontSize: 16, fontWeight: '700' },
  handle: { color: palette.muted, fontSize: 13 },
  chevron: { color: palette.cyan, fontSize: 27 },
});
