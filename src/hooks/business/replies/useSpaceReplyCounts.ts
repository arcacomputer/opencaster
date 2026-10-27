import { useCallback } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { usePasskeysContext } from '@quilibrium/quilibrium-js-sdk-channels';
import { useMessageDB } from '../../../components/context/useMessageDB';
import { isNotificationTypeEnabled } from '@quilibrium/quorum-shared';
import type { Space } from '@quilibrium/quorum-shared';

interface UseSpaceReplyCountsProps {
  spaces: Space[];
}

// Early-exit threshold: Stop counting after 10 replies
// (UI shows "9+" for counts > 9, so exact count beyond 10 is unnecessary)
const DISPLAY_THRESHOLD = 10;

/**
 * Hook to calculate unread reply counts for entire spaces
 *
 * Returns a map of spaceId -> total reply count across all channels in that space.
 * Only spaces with replies > 0 are included in the result.
 *
 * One query per space, keyed ['reply-counts', 'space', spaceId, userAddress],
 * so a reply invalidates only its own space (and, by prefix on the address,
 * only when it is a reply to this user). Each query reads every channel's
 * last-read time and its first unread replies to the user (sparse reply index)
 * in a single IndexedDB transaction.
 *
 * Uses React Query with 90s stale time for performance while maintaining
 * reasonable real-time updates when invalidated.
 */
export function useSpaceReplyCounts({
  spaces,
}: UseSpaceReplyCountsProps): Record<string, number> {
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
      // Invalidate one space with ['reply-counts', 'space', spaceId], or all
      // spaces with ['reply-counts', 'space'].
      queryKey: ['reply-counts', 'space', space.spaceId, userAddress],
      queryFn: async (): Promise<number> => {
        if (!userAddress) return 0;

        try {
          // Load user's notification settings
          const config = await messageDB.getUserConfig({ address: userAddress });
          const settings = config?.notificationSettings?.[space.spaceId];

          // Check if entire space is muted (takes precedence over individual settings)
          if (settings?.isMuted) return 0;
          if (!isNotificationTypeEnabled(settings, 'reply')) return 0;

          // Get all channel IDs from all groups in this space
          const channelIds = space.groups.flatMap((group) =>
            group.channels.map((channel) => channel.channelId)
          );

          const channels = await messageDB.getSpaceUnreadCandidates({
            spaceId: space.spaceId,
            channelIds,
            kind: 'replies',
            userAddress,
            limitPerChannel: DISPLAY_THRESHOLD,
          });

          let spaceTotal = 0;
          for (const { messages, threadReadTimes } of channels) {
            // Early exit: no need to count beyond display threshold
            if (spaceTotal >= DISPLAY_THRESHOLD) break;

            // Only the first `remaining` replies of a channel are considered,
            // as when each channel was queried with that limit.
            const remaining = DISPLAY_THRESHOLD - spaceTotal;
            for (const message of messages.slice(0, remaining)) {
              // Exclude thread replies already read
              if (message.isThreadReply && message.threadId) {
                const threadReadTime = threadReadTimes[message.threadId];
                if (threadReadTime !== undefined && message.createdDate <= threadReadTime) {
                  continue;
                }
              }
              spaceTotal++;
              if (spaceTotal >= DISPLAY_THRESHOLD) break;
            }
          }

          return spaceTotal;
        } catch (error) {
          console.error('[SpaceReplyCounts] Error calculating reply counts:', error);
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
