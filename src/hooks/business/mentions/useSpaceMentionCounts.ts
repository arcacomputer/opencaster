import { useCallback } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { usePasskeysContext } from '@quilibrium/quilibrium-js-sdk-channels';
import { useMessageDB } from '../../../components/context/useMessageDB';
import { isMentionedWithSettings, getDefaultNotificationSettings, getUserRoles } from '@quilibrium/quorum-shared';
import type { Space } from '@quilibrium/quorum-shared';

interface UseSpaceMentionCountsProps {
  spaces: Space[];
}

// Early-exit threshold: Stop counting after 10 mentions
// (UI shows "9+" for counts > 9, so exact count beyond 10 is unnecessary)
const DISPLAY_THRESHOLD = 10;

/**
 * Hook to calculate unread mention counts for entire spaces
 *
 * Returns a map of spaceId -> total mention count across all channels in that space.
 * Only spaces with mentions > 0 are included in the result.
 *
 * One query per space, keyed ['mention-counts', 'space', spaceId, userAddress],
 * so an incoming mention invalidates only its own space. Each query reads every
 * channel's last-read time and its first unread mention candidates (sparse
 * mention index) in a single IndexedDB transaction.
 *
 * Uses React Query with 90s stale time for performance while maintaining
 * reasonable real-time updates when invalidated.
 */
export function useSpaceMentionCounts({
  spaces,
}: UseSpaceMentionCountsProps): Record<string, number> {
  const user = usePasskeysContext();
  const { messageDB } = useMessageDB();
  const userAddress = user.currentPasskeyInfo?.address;

  const combine = useCallback(
    (results: UseQueryResult<number>[]) => {
      const spaceCounts: Record<string, number> = {};
      results.forEach((result, i) => {
        if (result.data && result.data > 0) {
          spaceCounts[spaces[i].spaceId] = result.data;
        }
      });
      return spaceCounts;
    },
    [spaces]
  );

  return useQueries({
    queries: spaces.map((space) => ({
      // Invalidate one space with ['mention-counts', 'space', spaceId], or all
      // spaces with ['mention-counts', 'space'].
      queryKey: ['mention-counts', 'space', space.spaceId, userAddress],
      queryFn: async (): Promise<number> => {
        if (!userAddress) return 0;

        try {
          // Load user's notification settings
          const config = await messageDB.getUserConfig({ address: userAddress });
          const settings = config?.notificationSettings?.[space.spaceId];

          // Check if entire space is muted (takes precedence over individual settings)
          if (settings?.isMuted) return 0;

          const enabledTypes = settings?.enabledNotificationTypes ||
            getDefaultNotificationSettings(space.spaceId).enabledNotificationTypes;

          // Filter to only mention types
          const mentionTypes = enabledTypes.filter(t => t.startsWith('mention-'));
          if (mentionTypes.length === 0) return 0;

          const userRoleIds = getUserRoles(userAddress, space).map(r => r.roleId);

          // Get all channel IDs from all groups in this space
          const channelIds = space.groups.flatMap((group) =>
            group.channels.map((channel) => channel.channelId)
          );

          const channels = await messageDB.getSpaceUnreadCandidates({
            spaceId: space.spaceId,
            channelIds,
            kind: 'mentions',
            limitPerChannel: DISPLAY_THRESHOLD,
          });

          let spaceTotal = 0;
          for (const { messages, threadReadTimes } of channels) {
            // Early exit: no need to count beyond display threshold
            if (spaceTotal >= DISPLAY_THRESHOLD) break;

            // Only the first `remaining` candidates of a channel are considered,
            // as when each channel was queried with that limit.
            const remaining = DISPLAY_THRESHOLD - spaceTotal;
            for (const message of messages.slice(0, remaining)) {
              // Thread replies: check against thread read time
              if (message.isThreadReply && message.threadId) {
                const threadReadTime = threadReadTimes[message.threadId];
                if (threadReadTime !== undefined && message.createdDate <= threadReadTime) {
                  continue;
                }
              }

              if (isMentionedWithSettings(message, {
                userAddress,
                enabledTypes: mentionTypes,
                userRoles: userRoleIds,
                space,
              })) {
                spaceTotal++;
                if (spaceTotal >= DISPLAY_THRESHOLD) break;
              }
            }
          }

          return spaceTotal;
        } catch (error) {
          console.error('[SpaceMentionCounts] Error calculating mention counts:', error);
          // Graceful degradation: no badge for this space
          return 0;
        }
      },
      enabled: !!userAddress,
      staleTime: 90000, // 90 seconds (1.5 minutes) - reduces query frequency while maintaining reasonable UX
      refetchOnWindowFocus: true, // Immediate updates when user returns to app
    })),
    combine,
  });
}
