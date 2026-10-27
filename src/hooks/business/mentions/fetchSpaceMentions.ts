import { isMentionedWithSettings, getDefaultNotificationSettings } from '@quilibrium/quorum-shared';
import type { Message, Space } from '@quilibrium/quorum-shared';
import { getMutedChannelsForSpace } from '../../../utils/channelUtils';
import type { MessageDB, UserConfig } from '../../../db/messages';
import type { MentionNotification } from './useAllMentions';

function getMentionType(message: Message, userAddress: string): 'you' | 'everyone' | 'roles' {
  if (message.mentions?.everyone) return 'everyone';
  if (message.mentions?.roleIds?.length && message.mentions.roleIds.length > 0) return 'roles';
  if (message.mentions?.memberIds?.includes(userAddress)) return 'you';
  return 'you';
}

/**
 * Fetch unread mentions for ONE space (pure; no React).
 * Replicates the per-space gating from `useAllMentions`. Returns rows in
 * channel-iteration order — the CALLER sorts (the global hook sorts after
 * merging across all spaces, so sorting here would be wasted work).
 */
export async function fetchSpaceMentions(
  messageDB: MessageDB,
  space: Space,
  userAddress: string,
  opts: {
    enabledTypes?: ('mention-you' | 'mention-everyone' | 'mention-roles')[];
    userRoleIds?: string[];
    config: UserConfig | undefined;
    perChannelLimit?: number;
  },
): Promise<MentionNotification[]> {
  const { enabledTypes, userRoleIds = [], config, perChannelLimit = 1000 } = opts;
  const settings = config?.notificationSettings?.[space.spaceId];
  if (settings?.isMuted) return [];

  let typesToCheck: string[];
  if (enabledTypes) {
    typesToCheck = enabledTypes;
  } else {
    const allTypes =
      settings?.enabledNotificationTypes ||
      getDefaultNotificationSettings(space.spaceId).enabledNotificationTypes;
    typesToCheck = allTypes.filter((tp: string) => tp.startsWith('mention-'));
  }
  if (typesToCheck.length === 0) return [];

  const mutedChannelIds = getMutedChannelsForSpace(space.spaceId, config?.mutedChannels);
  const allChannels = space.groups.flatMap((g) => g.channels);
  const channelNames = new Map(allChannels.map((c) => [c.channelId, c.channelName]));
  const channelIds = allChannels
    .map((c) => c.channelId)
    .filter((channelId) => !mutedChannelIds.includes(channelId));
  const out: MentionNotification[] = [];

  const candidates = await messageDB.getSpaceUnreadCandidates({
    spaceId: space.spaceId,
    channelIds,
    kind: 'mentions',
    limitPerChannel: perChannelLimit,
  });

  for (const { channelId, lastReadTimestamp, threadReadTimes, messages } of candidates) {
    const unread = messages.filter((message: Message) => {
      if (message.isThreadReply && message.threadId) {
        const trt = threadReadTimes[message.threadId];
        if (trt !== undefined && message.createdDate <= trt) return false;
      } else if (message.createdDate <= lastReadTimestamp) {
        return false;
      }
      return isMentionedWithSettings(message, {
        userAddress,
        enabledTypes: typesToCheck,
        userRoles: userRoleIds,
        space,
      });
    });

    for (const message of unread) {
      out.push({
        message,
        channelId,
        channelName: channelNames.get(channelId) || 'Unknown Channel',
        mentionType: getMentionType(message, userAddress),
        spaceId: space.spaceId,
        spaceName: space.spaceName,
      });
    }
  }
  return out;
}
