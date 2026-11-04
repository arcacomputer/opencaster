import { getFeed, type Cast, type TrendingTimeWindow } from '@opencaster/client-core/api';
import Feather from '@expo/vector-icons/Feather';
import { useScrollToTop } from '@react-navigation/native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { CastCard } from '../components/CastCard';
import { LocalContentNotice } from '../components/LocalContentNotice';
import { SocialStatus } from '../components/SocialStatus';
import { ActionButton, LoadingMessage, ScreenMessage } from '../components/Primitives';
import { useLocalContent } from '../lib/LocalContentProvider';
import { isHiddenTarget } from '../lib/localContent';
import type { MainTabScreenProps } from '../navigation';
import { usePagedCasts } from '../lib/usePagedCasts';
import { palette } from '../theme';
import { SafeAreaView } from 'react-native-safe-area-context';

type Props = MainTabScreenProps<'Feed'>;

const WINDOWS: Array<{ label: string; value: TrendingTimeWindow }> = [
  { label: '1 hour', value: '1h' },
  { label: '24 hours', value: '24h' },
  { label: '7 days', value: '7d' },
];

export function HomeScreen({ navigation }: Props) {
  const list = useRef<FlatList<Cast>>(null);
  useScrollToTop(list);
  const { snapshot: localContentSnapshot } = useLocalContent();
  const [timeWindow, setTimeWindow] = useState<TrendingTimeWindow>('24h');
  const readPage = useCallback((cursor: string | null, signal: AbortSignal) => (
    getFeed({ kind: 'trending', timeWindow, cursor, limit: 20, signal })
  ), [timeWindow]);
  const feed = usePagedCasts(`trending:${timeWindow}`, readPage);
  const visibleCasts = useMemo(() => (
    localContentSnapshot.phase === 'ready'
      ? feed.casts.filter(cast => !isHiddenTarget(localContentSnapshot.data, { fid: cast.author.fid, hash: cast.hash }))
      : []
  ), [feed.casts, localContentSnapshot.data, localContentSnapshot.phase]);
  const allLoadedCastsHidden = feed.casts.length > 0 && visibleCasts.length === 0;

  const listHeader = useMemo(() => (
    <View style={styles.headerContent}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={styles.heading}>Trending</Text>
          <Text style={styles.subheading}>Public conversations · Hypersnap</Text>
        </View>
      </View>
      <SocialStatus compact onDeviceAccess={() => navigation.navigate('DeviceAccess')} onOpenCast={hash => navigation.navigate('Conversation', { hash })} />
      <View accessibilityRole="tablist" style={styles.windows}>
        {WINDOWS.map(option => (
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel={`Trending for ${option.label}`}
            accessibilityState={{ selected: timeWindow === option.value }}
            key={option.value}
            onPress={() => setTimeWindow(option.value)}
            style={[styles.window, timeWindow === option.value && styles.windowSelected]}
          >
            <Text style={[styles.windowText, timeWindow === option.value && styles.windowTextSelected]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      {feed.error && feed.retryKind === 'refresh'
        ? (
          <ScreenMessage
            detail={feed.error}
            title="Could not refresh"
            action={<ActionButton label="Try refresh again" onPress={() => void feed.retry()} secondary />}
          />
        )
        : null}
    </View>
  ), [feed.error, feed.retry, feed.retryKind, navigation, timeWindow]);

  const emptyState = allLoadedCastsHidden
    ? (
      <ScreenMessage
        detail="Only the casts loaded so far are hidden; more may be available."
        title="All loaded casts are hidden on this device."
        action={<ActionButton label="Manage Safety" onPress={() => navigation.navigate('Safety')} secondary />}
      />
    )
    : feed.phase === 'loading'
      ? <LoadingMessage />
      : feed.phase === 'error'
        ? (
          <ScreenMessage
            detail={feed.error ?? undefined}
            title="Trending is unavailable"
            action={<ActionButton label="Try again" onPress={() => void feed.retry()} />}
          />
        )
        : <ScreenMessage detail="Try another time window later." title="No public casts in this window" />;
  const footer = feed.loadingMore
    ? <LoadingMessage label="Loading more casts…" />
    : feed.error && feed.retryKind === 'page'
      ? (
        <ScreenMessage
          detail={feed.error}
          title="Could not load more casts"
          action={<ActionButton label="Retry loading more" onPress={() => void feed.retry()} secondary />}
        />
      )
      : feed.nextCursor
        ? <ActionButton label="Load more casts" onPress={() => void feed.loadMore()} secondary />
      : null;

  if (localContentSnapshot.phase !== 'ready') {
    return (
      <SafeAreaView edges={['left', 'right']} style={styles.screen}>
        <LocalContentNotice onManage={() => navigation.navigate('Safety')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <FlatList<Cast>
        ref={list}
        data={visibleCasts}
        keyExtractor={cast => cast.hash}
        ListEmptyComponent={emptyState}
        ListFooterComponent={footer}
        ListHeaderComponent={listHeader}
        onEndReached={() => {
          if (visibleCasts.length > 0) void feed.loadMore();
        }}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl
            colors={[palette.cyan]}
            onRefresh={() => void feed.refresh()}
            refreshing={feed.refreshing}
            tintColor={palette.cyan}
          />
        }
        renderItem={({ item }) => (
          <CastCard
            cast={item}
            onReport={() => navigation.push('Support', { kind: 'post', fid: item.author.fid, hash: item.hash })}
            onAuthorPress={fid => navigation.navigate('Profile', { fid })}
            onThreadPress={hash => navigation.navigate('Conversation', { hash })}
          />
        )}
        style={styles.list}
        contentContainerStyle={styles.listContent}
      />
      <Pressable accessibilityRole="button" accessibilityLabel="New post" onPress={() => navigation.navigate('Compose')} style={({ pressed }) => [styles.compose, pressed && { opacity: 0.8 }]}>
        <Feather name="edit-3" size={25} color={palette.cyanInk} accessible={false} />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: palette.background, flex: 1 },
  list: { flex: 1 },
  headerContent: { gap: 10, paddingHorizontal: 16, paddingTop: 8, borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth },
  headingRow: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  headingCopy: { flex: 1, gap: 4 },
  heading: { color: palette.text, fontSize: 21, fontWeight: '800' },
  subheading: { color: palette.muted, fontSize: 12, lineHeight: 18 },
  listContent: { paddingBottom: 90 },
  compose: { position: 'absolute', right: 20, bottom: 20, width: 58, height: 58, borderRadius: 29, backgroundColor: palette.cyan, justifyContent: 'center', alignItems: 'center', elevation: 5, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  windows: {
    flexDirection: 'row',
  },
  window: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: 5, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  windowSelected: { borderBottomColor: palette.cyan },
  windowText: { color: palette.muted, fontSize: 13, fontWeight: '600' },
  windowTextSelected: { color: palette.text },
});
