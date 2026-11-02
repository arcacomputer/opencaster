import { getProfileFeed, getUser, type Cast, type User } from '@opencaster/client-core/api';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useMemo } from 'react';
import { Alert, FlatList, Image, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { CastCard } from '../components/CastCard';
import { LocalContentNotice } from '../components/LocalContentNotice';
import { ActionButton, LoadingMessage, ScreenMessage } from '../components/Primitives';
import { useLocalContent } from '../lib/LocalContentProvider';
import { isHiddenTarget } from '../lib/localContent';
import type { RootStackParamList } from '../navigation';
import { safeHttpsUrl } from '../lib/urls';
import { usePagedCasts } from '../lib/usePagedCasts';
import { usePublicRead } from '../lib/usePublicRead';
import { palette } from '../theme';
import { SafeAreaView } from 'react-native-safe-area-context';

type Props = NativeStackScreenProps<RootStackParamList, 'Profile'>;

function countLabel(value: number, noun: string): string | null {
  return Number.isFinite(value) && value >= 0 ? `${new Intl.NumberFormat().format(value)} ${noun}` : null;
}

function ProfileSummary({ user }: { user: User }) {
  const avatar = user.pfp_url ? safeHttpsUrl(user.pfp_url) : null;
  const name = user.display_name?.trim() || (user.username ? `@${user.username}` : `FID ${user.fid}`);
  const counts = [countLabel(user.follower_count, 'followers'), countLabel(user.following_count, 'following')]
    .filter(Boolean)
    .join('  ·  ');
  const bio = user.profile?.bio?.text;

  return (
    <View style={styles.profileCard}>
      {avatar ? <Image accessibilityLabel={`${name} profile image`} source={{ uri: avatar }} style={styles.avatar} /> : null}
      <Text accessibilityRole="header" style={styles.name}>{name}</Text>
      <Text style={styles.handle}>{user.username ? `@${user.username}  ·  ` : ''}FID {user.fid}</Text>
      {bio ? <Text style={styles.bio}>{bio}</Text> : null}
      {counts ? <Text style={styles.counts}>{counts}</Text> : null}
    </View>
  );
}

export function ProfileScreen({ navigation, route }: Props) {
  const { localContent, snapshot } = useLocalContent();
  const { fid } = route.params;
  const readProfile = useCallback((signal: AbortSignal) => getUser({ fid }, signal), [fid]);
  const profile = usePublicRead(`profile:${fid}`, readProfile);
  const readPage = useCallback((cursor: string | null, signal: AbortSignal) => (
    getProfileFeed({ fid, tab: 'casts', cursor, limit: 20, signal })
  ), [fid]);
  const feed = usePagedCasts(`profile-casts:${fid}`, readPage);
  const visibleCasts = useMemo(() => (
    snapshot.phase === 'ready'
      ? feed.casts.filter(cast => !isHiddenTarget(snapshot.data, { fid: cast.author.fid, hash: cast.hash }))
      : []
  ), [feed.casts, snapshot.data, snapshot.phase]);
  const profileTargetFid = profile.phase === 'ready' ? profile.value.fid : fid;
  const hiddenProfile = snapshot.phase === 'ready'
    && (snapshot.data.users.includes(fid)
      || (profile.phase === 'ready' && snapshot.data.users.includes(profile.value.fid)));
  const confirmHideUser = useCallback((targetFid: number) => {
    Alert.alert(
      `Hide FID ${targetFid} on this device?`,
      'This hides the profile and its public casts in this app only. It does not send a report, delete account data, or prevent network interaction.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Hide user', style: 'destructive', onPress: () => void localContent.hideUser(targetFid) },
      ],
    );
  }, [localContent]);

  const listHeader = useMemo(() => (
    <View style={styles.headerContent}>
      {profile.phase === 'loading'
        ? <LoadingMessage label="Loading public profile…" />
        : profile.phase === 'error'
          ? (
            <ScreenMessage
              detail={profile.error}
              title="Profile details unavailable"
              action={<ActionButton label="Retry profile" onPress={profile.retry} secondary />}
            />
          )
          : profile.phase === 'ready'
            ? <ProfileSummary user={profile.value} />
            : null}
      <ActionButton
        label={`Hide user FID ${profileTargetFid} on this device`}
        onPress={() => confirmHideUser(profileTargetFid)}
        disabled={snapshot.busy}
        secondary
      />
      <Text accessibilityRole="header" style={styles.feedHeading}>Public casts</Text>
      {feed.error && feed.retryKind === 'refresh'
        ? (
          <ScreenMessage
            detail={feed.error}
            title="Could not refresh casts"
            action={<ActionButton label="Try refresh again" onPress={() => void feed.retry()} secondary />}
          />
        )
        : null}
    </View>
  ), [confirmHideUser, feed.error, feed.retry, feed.retryKind, profile, profileTargetFid, snapshot.busy]);

  const allLoadedCastsHidden = feed.casts.length > 0 && visibleCasts.length === 0;
  const emptyState = allLoadedCastsHidden
    ? (
      <ScreenMessage
        detail="Only the casts loaded so far are hidden; more may be available."
        title="All loaded casts are hidden on this device."
        action={<ActionButton label="Manage Safety" onPress={() => navigation.navigate('Safety')} secondary />}
      />
    )
    : feed.phase === 'loading'
      ? <LoadingMessage label="Loading public casts…" />
      : feed.phase === 'error'
        ? (
          <ScreenMessage
            detail={feed.error ?? undefined}
            title="Casts unavailable"
            action={<ActionButton label="Retry casts" onPress={() => void feed.retry()} />}
          />
        )
        : <ScreenMessage title="No public casts are available." />;
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

  if (snapshot.phase !== 'ready') {
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
        <LocalContentNotice onManage={() => navigation.navigate('Safety')} />
      </SafeAreaView>
    );
  }
  if (hiddenProfile) {
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
        <LocalContentNotice hidden onManage={() => navigation.navigate('Safety')} />
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
            onAuthorPress={authorFid => navigation.push('Profile', { fid: authorFid })}
            onThreadPress={hash => navigation.push('Conversation', { hash })}
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
  headerContent: { gap: 16, paddingBottom: 12, paddingHorizontal: 16, paddingTop: 12 },
  profileCard: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 9,
    padding: 20,
  },
  avatar: { backgroundColor: palette.raised, borderRadius: 36, height: 72, width: 72 },
  name: { color: palette.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  handle: { color: palette.muted, fontSize: 14, textAlign: 'center' },
  bio: { color: palette.text, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  counts: { color: palette.muted, fontSize: 14 },
  feedHeading: { color: palette.text, fontSize: 19, fontWeight: '700', paddingTop: 6 },
});
