import { getConversation } from '@opencaster/client-core/api';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useMemo } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SocialStatus } from '../components/SocialStatus';
import { CastActions } from '../components/CastActions';
import { CastCard } from '../components/CastCard';
import { LocalContentNotice } from '../components/LocalContentNotice';
import { ActionButton, LoadingMessage, ScreenMessage } from '../components/Primitives';
import { useLocalContent } from '../lib/LocalContentProvider';
import { visibleConversationRows, type ConversationRow } from '../lib/conversation';
import { isHiddenTarget } from '../lib/localContent';
import type { RootStackParamList } from '../navigation';
import { usePublicRead } from '../lib/usePublicRead';
import { palette } from '../theme';
import { SafeAreaView } from 'react-native-safe-area-context';

type Props = NativeStackScreenProps<RootStackParamList, 'Conversation'>;

export function ConversationScreen({ navigation, route }: Props) {
  const { snapshot: localContentSnapshot } = useLocalContent();
  const { hash } = route.params;
  const read = useCallback((signal: AbortSignal) => getConversation(hash, signal), [hash]);
  const state = usePublicRead(`conversation:${hash}`, read);
  const rows = useMemo(() => (
    state.phase === 'ready' && localContentSnapshot.phase === 'ready'
      ? visibleConversationRows(state.value, localContentSnapshot.data)
      : []
  ), [localContentSnapshot.data, localContentSnapshot.phase, state]);
  const hiddenRoot = state.phase === 'ready' && localContentSnapshot.phase === 'ready'
    && isHiddenTarget(localContentSnapshot.data, { fid: state.value.cast.author.fid, hash: state.value.cast.hash });

  if (localContentSnapshot.phase !== 'ready') {
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
        <LocalContentNotice onManage={() => navigation.navigate('Safety')} />
      </SafeAreaView>
    );
  }
  if (hiddenRoot) {
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
        <LocalContentNotice hidden onManage={() => navigation.navigate('Safety')} />
      </SafeAreaView>
    );
  }

  const header = (
    <View>
    <Text style={styles.description}>
      Showing the selected public cast and replies returned by Hypersnap. The available thread may be incomplete.
    </Text>
    <SocialStatus onDeviceAccess={() => navigation.navigate('DeviceAccess')} onOpenCast={nextHash => navigation.push('Conversation', { hash: nextHash })} />
    {state.phase === 'ready' ? <CastActions
      target={{ fid: state.value.cast.author.fid, hash: state.value.cast.hash }}
      onReply={() => navigation.navigate('Compose', { parent: { fid: state.value.cast.author.fid, hash: state.value.cast.hash } })}
    /> : null}
    </View>
  );
  const empty = state.phase === 'loading'
    ? <LoadingMessage label="Loading conversation…" />
    : state.phase === 'error'
      ? (
        <ScreenMessage
          detail={state.error}
          title="Conversation unavailable"
          action={<ActionButton label="Try again" onPress={state.retry} />}
        />
      )
      : state.phase === 'ready'
        ? <ScreenMessage title="No conversation data is available." />
        : null;

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <FlatList<ConversationRow>
        data={rows}
        keyExtractor={item => item.cast.hash}
        ListEmptyComponent={empty}
        ListHeaderComponent={header}
        refreshControl={
          <RefreshControl
            colors={[palette.cyan]}
            onRefresh={state.retry}
            refreshing={state.phase === 'loading'}
            tintColor={palette.cyan}
          />
        }
        renderItem={({ item }) => (
          <CastCard
            cast={item.cast}
            depth={item.depth}
            onAuthorPress={fid => navigation.push('Profile', { fid })}
            onThreadPress={nextHash => navigation.push('Conversation', { hash: nextHash })}
          />
        )}
        style={styles.list}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: palette.background, flex: 1 },
  list: { flex: 1 },
  description: { color: palette.muted, fontSize: 14, lineHeight: 21, paddingHorizontal: 18, paddingVertical: 14 },
});
