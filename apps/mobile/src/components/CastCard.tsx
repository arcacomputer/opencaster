import Feather from '@expo/vector-icons/Feather';
import type { Cast } from '@opencaster/client-core/api';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalContent } from '../lib/LocalContentProvider';
import { isHiddenTarget } from '../lib/localContent';
import { openHttpsUrl } from '../lib/openHttpsUrl';
import { postTime, socialCount } from '../lib/presentation';
import { safeHttpsUrl, safeMediaEmbedUrls, splitSafeLinks } from '../lib/urls';
import type { RootStackParamList } from '../navigation';
import { palette } from '../theme';
import { CastActions } from './CastActions';
import { IconButton, type IconName } from './IconButton';
import { RemoteImageEmbed } from './RemoteImageEmbed';

function CastBody({ text, collapsed }: { text: string; collapsed: boolean }) {
  return <Text selectable numberOfLines={collapsed ? 7 : undefined} style={styles.body}>{splitSafeLinks(text).map((part, index) => part.url
    ? <Text accessibilityRole="link" key={`${part.url}-${index}`} onPress={() => void openHttpsUrl(part.url!)} style={styles.link}>{part.text}</Text>
    : <Text key={`text-${index}`}>{part.text}</Text>)}</Text>;
}

function PostAction({ icon, label, count, onPress }: { icon: IconName; label: string; count: number; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}${Number.isFinite(count) && count >= 0 ? `, ${count}` : ''}`} onPress={onPress}
    style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
    <Feather name={icon} size={19} color={palette.muted} accessible={false} />
    <Text style={styles.count}>{socialCount(count)}</Text>
  </Pressable>;
}

export function CastCard({ cast, depth = 0, onAuthorPress, onThreadPress, onReport }: {
  cast: Cast; depth?: number; onAuthorPress: (fid: number) => void; onThreadPress: (hash: string) => void; onReport: () => void;
}) {
  const { localContent, snapshot } = useLocalContent();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState<'options' | 'like' | 'recast' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const afterDismiss = useRef<(() => void) | null>(null);
  if (snapshot.phase !== 'ready' || isHiddenTarget(snapshot.data, { fid: cast.author.fid, hash: cast.hash })) return null;
  const target = { fid: cast.author.fid, hash: cast.hash };
  const name = cast.author.display_name?.trim() || (cast.author.username ? `@${cast.author.username}` : `FID ${cast.author.fid}`);
  const avatar = cast.author.pfp_url ? safeHttpsUrl(cast.author.pfp_url) : null;
  const date = postTime(cast.timestamp);
  const media = safeMediaEmbedUrls(cast.embeds);
  const collapsible = cast.text.length > 280 || cast.text.split('\n').length > 6;
  const closeThen = (action: () => void) => {
    if (sheet && Platform.OS === 'ios') afterDismiss.current = action;
    else action();
    setSheet(null);
  };
  const hide = (kind: 'post' | 'user') => {
    closeThen(() => Alert.alert(kind === 'post' ? 'Hide this post?' : `Hide posts by ${name}?`,
      'This only hides content on this device. It does not report, delete content or prevent network interaction.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Hide', style: 'destructive', onPress: () => {
        void (kind === 'post' ? localContent.hideCast(cast.hash) : localContent.hideUser(cast.author.fid)).then(ok => {
          if (!ok) Alert.alert('Hide not confirmed', localContent.getSnapshot().error ?? 'Try again or manage filters in Safety and data.');
        });
      } }]));
  };
  const reply = () => closeThen(() => navigation.navigate('Compose', { parent: target }));
  return <View style={[styles.card, depth > 0 && styles.reply]}>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open profile for ${name}`} onPress={() => onAuthorPress(cast.author.fid)} style={styles.avatarTarget}>
        {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : <View style={[styles.avatar, styles.fallback]}><Text style={styles.initial}>{name.slice(0, 1).toUpperCase()}</Text></View>}
      </Pressable>
      <View style={styles.content}>
        <View style={styles.authorRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Open profile for ${name}`} onPress={() => onAuthorPress(cast.author.fid)} style={styles.author}>
            <Text numberOfLines={1} style={styles.displayName}>{name}</Text>
            <Text numberOfLines={1} style={styles.handle}>{cast.author.username ? `@${cast.author.username}` : `FID ${cast.author.fid}`}{date ? ` · ${date}` : ''}</Text>
          </Pressable>
          <IconButton icon="more-horizontal" label={`More options for post by ${name}`} disabled={snapshot.busy} onPress={() => setSheet('options')} />
        </View>
        {depth > 0 ? <Text style={styles.replyLabel}>Reply</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Open conversation" onPress={() => onThreadPress(cast.hash)} style={styles.castPressable}><CastBody text={cast.text} collapsed={collapsible && !expanded} /></Pressable>
        {collapsible ? <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.expand}><Text style={styles.link}>{expanded ? 'Show less' : 'Show more'}</Text></Pressable> : null}
        {media.length ? <View style={styles.media}>{media.map((uri, index) => <View key={`${uri}-${index}`} style={media.length > 1 ? styles.thumbnail : styles.singleMedia}><RemoteImageEmbed index={index + 1} uri={uri} thumbnail={media.length > 1} /></View>)}</View> : null}
        <View style={styles.actions}>
          <PostAction icon="message-circle" label={`Reply to ${name}`} count={cast.replies.count} onPress={reply} />
          <PostAction icon="repeat" label={`Recast post by ${name}`} count={cast.reactions.recasts_count} onPress={() => setSheet('recast')} />
          <PostAction icon="heart" label={`Like post by ${name}`} count={cast.reactions.likes_count} onPress={() => setSheet('like')} />
        </View>
      </View>
    </View>
    <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={() => setSheet(null)} onDismiss={() => {
      const action = afterDismiss.current;
      afterDismiss.current = null;
      action?.();
    }}>
      <View style={styles.modal}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss post options" style={StyleSheet.absoluteFill} onPress={() => setSheet(null)} />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.sheetHeading}><Text accessibilityRole="header" style={styles.sheetTitle}>{sheet === 'options' ? 'Post options' : sheet === 'like' ? 'Like' : 'Recast'}</Text><IconButton icon="x" label="Close post options" onPress={() => setSheet(null)} /></View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {sheet === 'options' ? <>
              <Pressable accessibilityRole="button" onPress={() => closeThen(onReport)} style={styles.menuItem}><Feather name="flag" size={22} color={palette.text} /><Text style={styles.menuText}>Report post by email</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={() => hide('post')} style={styles.menuItem}><Feather name="eye-off" size={22} color={palette.text} /><Text style={styles.menuText}>Hide this post</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={() => hide('user')} style={styles.menuItem}><Feather name="user-minus" size={22} color={palette.text} /><Text style={styles.menuText}>Hide this person's posts</Text></Pressable>
              <Text style={styles.sheetDetail}>Hiding affects this device only. Reporting opens an email draft for your review.</Text>
            </> : sheet ? <CastActions target={target} onReply={reply} intent={sheet} onDeviceAccess={() => closeThen(() => navigation.navigate('DeviceAccess'))} /> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 2 },
  reply: { borderLeftWidth: 2, borderLeftColor: palette.border },
  row: { flexDirection: 'row', gap: 10 },
  avatarTarget: { width: 48, minHeight: 48, paddingTop: 4 },
  avatar: { backgroundColor: palette.raised, width: 44, height: 44, borderRadius: 22 },
  fallback: { justifyContent: 'center', alignItems: 'center' },
  initial: { color: palette.text, fontSize: 19, fontWeight: '700' },
  content: { flex: 1, minWidth: 0, gap: 6 },
  authorRow: { flexDirection: 'row', alignItems: 'center' },
  author: { flex: 1, minWidth: 0, minHeight: 48, justifyContent: 'center', gap: 2 },
  displayName: { color: palette.text, fontSize: 15, fontWeight: '700' },
  handle: { color: palette.muted, fontSize: 13 },
  replyLabel: { color: palette.muted, fontSize: 12 },
  castPressable: { minHeight: 30 },
  body: { color: palette.text, fontSize: 16, lineHeight: 23 },
  link: { color: palette.cyan },
  media: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  thumbnail: { width: '48%' },
  singleMedia: { width: '100%' },
  expand: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
  actions: { flexDirection: 'row', justifyContent: 'space-between' },
  action: { flexDirection: 'row', gap: 7, minHeight: 48, minWidth: 56, alignItems: 'center', paddingHorizontal: 4, borderRadius: 24 },
  count: { color: palette.muted, fontSize: 12 },
  pressed: { backgroundColor: palette.raised },
  modal: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000088' },
  sheet: { maxHeight: '80%', backgroundColor: palette.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20 },
  sheetHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 },
  sheetTitle: { color: palette.text, fontSize: 20, fontWeight: '700' },
  menuItem: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 12 },
  menuText: { color: palette.text, fontSize: 16, flex: 1 },
  sheetDetail: { color: palette.muted, fontSize: 13, lineHeight: 20, paddingVertical: 12 },
});
