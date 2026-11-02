import { getFeed, type Cast, type TrendingTimeWindow } from '@opencaster/client-core/api';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { CastCard } from '../components/CastCard';
import { LocalContentNotice } from '../components/LocalContentNotice';
import { SocialStatus } from '../components/SocialStatus';
import { ActionButton, LoadingMessage, PublicPreviewNotice, ScreenMessage } from '../components/Primitives';
import { useLocalContent } from '../lib/LocalContentProvider';
import { isHiddenTarget } from '../lib/localContent';
import type { RootStackParamList } from '../navigation';
import { usePagedCasts } from '../lib/usePagedCasts';
import { palette } from '../theme';
import { SafeAreaView } from 'react-native-safe-area-context';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const WINDOWS: Array<{ label: string; value: TrendingTimeWindow }> = [
  { label: '1 hour', value: '1h' },
  { label: '24 hours', value: '24h' },
  { label: '7 days', value: '7d' },
];

export function HomeScreen({ navigation }: Props) {
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
      <PublicPreviewNotice />
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={styles.heading}>Trending</Text>
          <Text style={styles.subheading}>Public casts available through Hypersnap.</Text>
        </View>
      </View>
      <View style={styles.quickActions}>
        <ActionButton label="Find a person" onPress={() => navigation.navigate('Lookup')} secondary />
        <ActionButton label="Device access" onPress={() => navigation.navigate('DeviceAccess')} secondary />
        <ActionButton label="New post" onPress={() => navigation.navigate('Compose')} />
        <ActionButton label="Safety and data" onPress={() => navigation.navigate('Safety')} secondary />
      </View>
      <SocialStatus onDeviceAccess={() => navigation.navigate('DeviceAccess')} onOpenCast={hash => navigation.navigate('Conversation', { hash })} />
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
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
        <LocalContentNotice onManage={() => navigation.navigate('Safety')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <FlatList<Cast>
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
            onAuthorPress={fid => navigation.navigate('Profile', { fid })}
            onThreadPress={hash => navigation.navigate('Conversation', { hash })}
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
  headerContent: { gap: 20, paddingBottom: 12, paddingHorizontal: 16, paddingTop: 12 },
  headingRow: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  headingCopy: { flex: 1, gap: 4 },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  heading: { color: palette.text, fontSize: 25, fontWeight: '800' },
  subheading: { color: palette.muted, fontSize: 14, lineHeight: 20 },
  windows: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    padding: 4,
  },
  window: { alignItems: 'center', borderRadius: 9, flex: 1, justifyContent: 'center', minHeight: 42, paddingHorizontal: 5 },
  windowSelected: { backgroundColor: palette.cyan },
  windowText: { color: palette.muted, fontSize: 13, fontWeight: '600' },
  windowTextSelected: { color: palette.cyanInk },
});
