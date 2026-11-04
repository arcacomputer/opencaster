import { getProfileFeed, getUser, type Cast, type User } from '@opencaster/client-core/api';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useMemo } from 'react';
import { Alert, FlatList, Image, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { CastCard } from '../components/CastCard';
import { IconButton } from '../components/IconButton';
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

function ProfileSummary({ user, onOptions }: { user: User; onOptions: () => void }) {
  const avatar = user.pfp_url ? safeHttpsUrl(user.pfp_url) : null;
  const name = user.display_name?.trim() || (user.username ? `@${user.username}` : `FID ${user.fid}`);
  const counts = [countLabel(user.follower_count, 'followers'), countLabel(user.following_count, 'following')]
    .filter(Boolean)
    .join('  ·  ');
  const bio = user.profile?.bio?.text;

  return (
    <View style={styles.profileCard}>
      <View style={styles.profileTop}>
        {avatar ? <Image accessibilityLabel={`${name} profile image`} source={{ uri: avatar }} style={styles.avatar} /> : <View style={styles.avatar} />}
        <IconButton icon="more-horizontal" label={`More options for ${name}`} onPress={onOptions} />
      </View>
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
  const hideUser = useCallback(async (targetFid: number) => {
    if (await localContent.hideUser(targetFid)) return;
    Alert.alert('User hide not confirmed', localContent.getSnapshot().error ?? 'The change was not confirmed. Try again or manage filters in Safety and data.');
  }, [localContent]);
  const confirmHideUser = useCallback((targetFid: number) => {
    Alert.alert(
      `Hide FID ${targetFid} on this device?`,
      'This hides the profile and its public casts in this app only. It does not send a report, delete account data, or prevent network interaction.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Hide user', style: 'destructive', onPress: () => { void hideUser(targetFid); } },
      ],
    );
  }, [hideUser]);

  const profileOptions = useCallback(() => Alert.alert('Profile options', 'Hiding affects this device only. Reporting opens an email draft.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Hide user', onPress: () => confirmHideUser(profileTargetFid) },
    { text: 'Report user by email', onPress: () => navigation.push('Support', { kind: 'user', fid: profileTargetFid }) },
  ]), [confirmHideUser, navigation, profileTargetFid]);

  const listHeader = useMemo(() => (
    <View style={styles.headerContent}>
      {profile.phase !== 'ready' ? <View style={styles.profileTop}>
        <Text style={styles.handle}>FID {profileTargetFid}</Text>
        <IconButton icon="more-horizontal" label={`More options for FID ${profileTargetFid}`} onPress={profileOptions} />
      </View> : null}
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
            ? <ProfileSummary user={profile.value} onOptions={profileOptions} />
            : null}
      <Text accessibilityRole="header" style={styles.feedHeading}>Posts</Text>
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
  ), [feed.error, feed.retry, feed.retryKind, profile, profileOptions, profileTargetFid]);

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
            onReport={() => navigation.push('Support', { kind: 'post', fid: item.author.fid, hash: item.hash })}
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
  headerContent: { gap: 16, paddingHorizontal: 16, paddingTop: 12, borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth },
  profileCard: {
    gap: 9,
    paddingVertical: 12,
  },
  profileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 },
  avatar: { backgroundColor: palette.raised, borderRadius: 40, height: 80, width: 80 },
  name: { color: palette.text, fontSize: 26, fontWeight: '800' },
  handle: { color: palette.muted, fontSize: 14 },
  bio: { color: palette.text, fontSize: 16, lineHeight: 23 },
  counts: { color: palette.muted, fontSize: 14 },
  feedHeading: { color: palette.text, fontSize: 16, fontWeight: '700', paddingVertical: 14, borderBottomWidth: 3, borderBottomColor: palette.cyan, alignSelf: 'flex-start' },
});
