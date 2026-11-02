import type { Cast } from '@opencaster/client-core/api';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalContent } from '../lib/LocalContentProvider';
import { isHiddenTarget } from '../lib/localContent';
import { openHttpsUrl } from '../lib/openHttpsUrl';
import { safeHttpsUrl, safeMediaEmbedUrls, splitSafeLinks } from '../lib/urls';
import { palette } from '../theme';
import { ActionButton } from './Primitives';
import { RemoteImageEmbed } from './RemoteImageEmbed';

function displayName(cast: Cast): string {
  return cast.author.display_name?.trim() || (cast.author.username ? `@${cast.author.username}` : `FID ${cast.author.fid}`);
}

function dateLabel(timestamp: string): string | null {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : null;
}

function countLabel(value: number, noun: string): string | null {
  return Number.isFinite(value) && value >= 0
    ? `${new Intl.NumberFormat().format(value)} ${noun}`
    : null;
}

function CastBody({ text }: { text: string }) {
  return (
    <Text selectable style={styles.body}>
      {splitSafeLinks(text).map((part, index) => part.url
        ? (
          <Text
            accessibilityRole="link"
            key={`${part.url}-${index}`}
            onPress={() => void openHttpsUrl(part.url!)}
            style={styles.link}
          >
            {part.text}
          </Text>
        )
        : <Text key={`text-${index}`}>{part.text}</Text>)}
    </Text>
  );
}

export function CastCard({
  cast,
  depth = 0,
  onAuthorPress,
  onThreadPress,
}: {
  cast: Cast;
  depth?: number;
  onAuthorPress: (fid: number) => void;
  onThreadPress: (hash: string) => void;
}) {
  const { localContent, snapshot } = useLocalContent();
  if (snapshot.phase !== 'ready' || isHiddenTarget(snapshot.data, { fid: cast.author.fid, hash: cast.hash })) return null;

  const showContentOptions = () => Alert.alert(
    'Content options',
    `Hide this post or all posts by FID ${cast.author.fid} on this device? This does not report the post or prevent network interaction.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Hide post', style: 'destructive', onPress: () => void localContent.hideCast(cast.hash) },
      { text: `Hide FID ${cast.author.fid}`, style: 'destructive', onPress: () => void localContent.hideUser(cast.author.fid) },
    ],
  );

  const avatar = cast.author.pfp_url ? safeHttpsUrl(cast.author.pfp_url) : null;
  const media = safeMediaEmbedUrls(cast.embeds);
  const date = dateLabel(cast.timestamp);
  const counts = [
    countLabel(cast.reactions.likes_count, 'likes'),
    countLabel(cast.reactions.recasts_count, 'recasts'),
    countLabel(cast.replies.count, 'replies'),
  ].filter(Boolean).join('  ·  ');

  return (
    <View style={[styles.card, depth > 0 && { marginLeft: Math.min(depth, 4) * 12, marginRight: 0 }]}>
      <View style={styles.authorRow}>
        {avatar ? <Image accessibilityLabel={`${displayName(cast)} profile image`} source={{ uri: avatar }} style={styles.avatar} /> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open profile for ${displayName(cast)}`}
          onPress={() => onAuthorPress(cast.author.fid)}
          style={styles.author}
        >
          <Text style={styles.displayName}>{displayName(cast)}</Text>
          <Text style={styles.handle}>
            {cast.author.username ? `@${cast.author.username}` : `FID ${cast.author.fid}`}
            {date ? `  ·  ${date}` : ''}
          </Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open conversation"
        onPress={() => onThreadPress(cast.hash)}
        style={styles.castPressable}
      >
        <CastBody text={cast.text} />
      </Pressable>
      {media.map((uri, index) => (
        <RemoteImageEmbed
          key={`${uri}-${index}`}
          index={index + 1}
          uri={uri}
        />
      ))}
      {counts ? <Text style={styles.counts}>{counts}</Text> : null}
      <ActionButton
        accessibilityLabel={`Content options for FID ${cast.author.fid}, cast ${cast.hash}`}
        disabled={snapshot.busy}
        label="Content options"
        onPress={showContentOptions}
        secondary
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 14,
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 16,
  },
  authorRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
  },
  author: {
    flex: 1,
    gap: 3,
    minHeight: 44,
    justifyContent: 'center',
  },
  avatar: {
    backgroundColor: palette.raised,
    borderRadius: 22,
    height: 44,
    width: 44,
  },
  displayName: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '700',
  },
  handle: {
    color: palette.muted,
    fontSize: 13,
  },
  castPressable: {
    minHeight: 44,
  },
  body: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 24,
  },
  link: {
    color: palette.cyan,
    textDecorationLine: 'underline',
  },
  counts: {
    color: palette.muted,
    fontSize: 13,
  },
});
