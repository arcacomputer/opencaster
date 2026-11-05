import { getCast } from '@opencaster/client-core/api';
import { useHeaderHeight } from '@react-navigation/elements';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionButton, LoadingMessage, ScreenMessage } from '../components/Primitives';
import { CastCard } from '../components/CastCard';
import { LocalContentNotice } from '../components/LocalContentNotice';
import { SocialStatus } from '../components/SocialStatus';
import { useAuthorization } from '../lib/AuthorizationProvider';
import { useLocalContent } from '../lib/LocalContentProvider';
import { isHiddenTarget } from '../lib/localContent';
import { castTarget, MAX_CAST_BYTES } from '../lib/socialAction';
import { usePublicRead } from '../lib/usePublicRead';
import type { RootStackParamList } from '../navigation';
import { palette } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Compose'>;

export function ComposerScreen({ navigation, route }: Props) {
  const headerHeight = useHeaderHeight();
  const { snapshot: localContentSnapshot } = useLocalContent();
  const parent = route.params?.parent;
  const { authorization, snapshot } = useAuthorization();
  const [text, setText] = useState('');
  const [attemptHash, setAttemptHash] = useState<string>();
  const readParent = useCallback(async (signal: AbortSignal) => {
    if (!parent) throw new Error('Choose a reply target.');
    const expected = castTarget(parent);
    const cast = await getCast(expected.hash, signal);
    if (cast.author?.fid !== expected.fid || castTarget({ fid: expected.fid, hash: cast.hash }).hash !== expected.hash) throw new Error('The reply target changed.');
    return cast;
  }, [parent?.fid, parent?.hash]);
  const parentState = usePublicRead(`reply:${parent?.fid}:${parent?.hash}`, parent ? readParent : null);
  const byteLength = new TextEncoder().encode(text.trim()).length;
  const parentHidden = Boolean(parent && localContentSnapshot.phase === 'ready'
    && isHiddenTarget(localContentSnapshot.data, { fid: parent.fid, hash: parent.hash }));
  const canPublish = localContentSnapshot.phase === 'ready' && !parentHidden
    && snapshot.authorized && !snapshot.busy && snapshot.action?.status !== 'pending'
    && byteLength > 0 && byteLength <= MAX_CAST_BYTES && (!parent || parentState.phase === 'ready');
  useEffect(() => {
    if (attemptHash && snapshot.action?.hash === attemptHash && snapshot.action.status === 'confirmed') {
      setText('');
      setAttemptHash(undefined);
    }
  }, [attemptHash, snapshot.action?.hash, snapshot.action?.status]);

  const publish = () => {
    if (!canPublish) return;
    const content = text.trim();
    Alert.alert(parent ? 'Publish this reply?' : 'Publish this post?',
      `Publish publicly as FID ${snapshot.request?.fid}${parent ? ` in reply to FID ${parent.fid}'s cast ${parent.hash}` : ''}?\n\n${content}`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Publish', onPress: () => {
        const before = authorization.getSnapshot().action?.hash;
        void authorization.publishCast(content, parent).then(() => {
          const action = authorization.getSnapshot().action;
          if (action?.kind === 'cast' && action.hash !== before) setAttemptHash(action.hash);
        });
      } }]);
  };

  if (localContentSnapshot.phase !== 'ready') {
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
        <LocalContentNotice onManage={() => navigation.navigate('Safety')} />
      </SafeAreaView>
    );
  }
  if (parentHidden) {
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
        <LocalContentNotice hidden onManage={() => navigation.navigate('Safety')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <KeyboardAvoidingView style={styles.screen} behavior="padding" keyboardVerticalOffset={headerHeight}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <SocialStatus onDeviceAccess={() => navigation.navigate('DeviceAccess')} onOpenCast={hash => navigation.navigate('Conversation', { hash })} />
          <Text accessibilityRole="header" style={styles.title}>{parent ? 'Reply' : 'New post'}</Text>
          <Text style={styles.detail}>Public Hypersnap text, up to {MAX_CAST_BYTES} UTF-8 bytes. No attachments or tagged mentions in this increment. Drafts stay on this screen only; leaving it may discard them.</Text>
          {parentState.phase === 'loading' ? <LoadingMessage label="Loading reply target…" /> : null}
          {parentState.phase === 'error' ? <ScreenMessage title="Reply target unavailable" detail={parentState.error} action={<ActionButton label="Retry reply target" onPress={parentState.retry} />} /> : null}
          {parentState.phase === 'ready' ? <CastCard cast={parentState.value} onAuthorPress={fid => navigation.navigate('Profile', { fid })} onThreadPress={hash => navigation.navigate('Conversation', { hash })} /> : null}
          <TextInput accessibilityLabel={parent ? 'Reply text' : 'Post text'} multiline value={text} onChangeText={setText}
            editable={!snapshot.busy && snapshot.action?.status !== 'pending'} placeholder="What would you like to share?" placeholderTextColor={palette.muted}
            style={styles.input} textAlignVertical="top" />
          <Text accessibilityLiveRegion="polite" style={styles.detail}>{byteLength} / {MAX_CAST_BYTES} bytes{byteLength > MAX_CAST_BYTES ? ' — shorten your text' : ''}</Text>
          <ActionButton label={parent ? 'Review reply' : 'Review post'} onPress={publish} disabled={!canPublish} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  content: { padding: 18, gap: 14, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '700', color: palette.text },
  detail: { fontSize: 14, lineHeight: 21, color: palette.muted },
  input: { minHeight: 150, borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 14, color: palette.text, fontSize: 16 },
});
