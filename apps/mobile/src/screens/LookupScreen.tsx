import { getUser, type User } from '@opencaster/client-core/api';
import Feather from '@expo/vector-icons/Feather';
import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { LocalContentNotice } from '../components/LocalContentNotice';
import { ActionButton, LoadingMessage, ScreenMessage } from '../components/Primitives';
import { useLocalContent } from '../lib/LocalContentProvider';
import type { MainTabScreenProps } from '../navigation';
import { safeHttpsUrl } from '../lib/urls';
import { usePublicRead } from '../lib/usePublicRead';
import { palette } from '../theme';
import { SafeAreaView } from 'react-native-safe-area-context';

type Props = MainTabScreenProps<'Search'>;

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
  const { snapshot } = useLocalContent();
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

  if (snapshot.phase !== 'ready') {
    return (
      <SafeAreaView edges={['left', 'right']} style={styles.screen}>
        <LocalContentNotice onManage={() => navigation.navigate('Safety')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.searchField}>
        <Feather name="search" size={21} color={palette.muted} accessible={false} />
        <TextInput
          accessibilityLabel="Username or FID"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setInput}
          onSubmitEditing={onSearch}
          placeholder="Search by username or FID"
          placeholderTextColor={palette.muted}
          returnKeyType="search"
          style={styles.input}
          value={input}
        />
        </View>
        <ActionButton label="Search" onPress={onSearch} />
        {!submitted ? <View style={styles.empty}><Feather name="users" size={40} color={palette.muted} accessible={false} /><Text accessibilityRole="header" style={styles.heading}>Find your people</Text><Text style={styles.detail}>Enter an exact username or FID to discover their public profile and posts on Hypersnap.</Text></View> : null}
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
          ? snapshot.data.users.includes(state.value.fid)
            ? <LocalContentNotice hidden onManage={() => navigation.navigate('Safety')} />
            : (
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
  content: { gap: 16, padding: 16 },
  searchField: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 26, backgroundColor: palette.raised, paddingHorizontal: 16 },
  empty: { paddingVertical: 48, gap: 16 },
  heading: { color: palette.text, fontSize: 24, fontWeight: '800' },
  detail: { color: palette.muted, fontSize: 15, lineHeight: 22 },
  input: {
    flex: 1,
    color: palette.text,
    fontSize: 16,
    minHeight: 50,
    paddingVertical: 12,
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
