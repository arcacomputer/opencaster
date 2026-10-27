import * as React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Space } from '@quilibrium/quorum-shared';

/**
 * Instrument for "notification switches freeze the UI for 0.5-2s".
 * See .agents/issues/2026-08-13-notification-toggle-freeze-is-the-config-encode-chain.md
 *
 * Every mute toggle calls `invalidateNotificationQueries()`, which invalidates
 * the space-wide ['mention-counts','space'] key and re-runs
 * `useSpaceMentionCounts`. The suspected cost is that its queryFn walks EVERY
 * channel of EVERY space doing THREE sequential IndexedDB reads each, on the
 * main thread.
 *
 * WHAT THIS MEASURES, AND WHY IT IS NOT WALL-CLOCK.
 * The MessageDB here is a counting stub, not a real (or faked) IndexedDB, so
 * the elapsed ms below is meaningless as a browser prediction and is printed as
 * context only — never asserted on. What transfers is the SHAPE of the work:
 * how many round-trips the hook issues, and how that scales. Those counts are
 * deterministic. For the cost INSIDE a round-trip (rows walked), see
 * spaceBadgeCountsIdb.bench.test.tsx, which runs against fake-indexeddb.
 *
 * NOT part of the unit suite — `vitest.config.ts` excludes `perf/**` because
 * the load this generates makes timing-sensitive tests elsewhere flake. Run it
 * with `yarn bench`.
 *
 * This drives the REAL hook via renderHook. It deliberately does NOT
 * re-implement the loop: a copy would measure the copy and would keep passing
 * if the real hook changed.
 *
 * History: the hook used to issue THREE sequential reads per channel for every
 * channel of every space (getConversation, getThreadReadTimesForChannel,
 * getUnreadMentions), and getUnreadMentions walked every unread message. It now
 * issues ONE batched read per space (getSpaceUnreadCandidates: one readonly
 * transaction over a sparse mention index), each in its own query so an
 * invalidation can target a single space. `useSpaceReplyCounts` is a
 * structural twin.
 */

const USER = 'QmPeerAEgVKpYZKYuFu2J49zHXnA8vZtEqHMtpB4imzzzz';

// Round-trip counters, incremented by the fake MessageDB below.
const calls = {
  getSpaceUnreadCandidates: 0,
  channelsRead: 0,
};
const resetCalls = () => {
  calls.getSpaceUnreadCandidates = 0;
  calls.channelsRead = 0;
};

// A MessageDB stub that counts round-trips and resolves empty — i.e. the
// NO-UNREAD-MENTIONS case, the worst case for the early exit.
const messageDB = {
  getUserConfig: async () => ({ address: USER, spaceIds: [] }),
  getSpaceUnreadCandidates: async ({ channelIds }: { channelIds: string[] }) => {
    calls.getSpaceUnreadCandidates++;
    calls.channelsRead += channelIds.length;
    return channelIds.map((channelId) => ({
      channelId,
      messages: [],
      threadReadTimes: {},
    }));
  },
};

vi.mock('@quilibrium/quilibrium-js-sdk-channels', () => ({
  usePasskeysContext: () => ({ currentPasskeyInfo: { address: USER } }),
}));

vi.mock('../../../components/context/useMessageDB', () => ({
  useMessageDB: () => ({ messageDB }),
}));

import { useSpaceMentionCounts } from '../../../hooks/business/mentions/useSpaceMentionCounts';

/** A space with `channelCount` channels spread over 3 groups. */
const makeSpace = (i: number, channelCount: number): Space => {
  const channels = Array.from({ length: channelCount }, (_, c) => ({
    channelId: `space-${i}-channel-${c}`,
    channelName: `channel-${c}`,
  }));
  const perGroup = Math.ceil(channelCount / 3) || 1;
  return {
    spaceId: `space-${i}`,
    spaceName: `Space ${i}`,
    groups: [0, 1, 2].map((g) => ({
      groupName: `group-${g}`,
      channels: channels.slice(g * perGroup, (g + 1) * perGroup),
    })),
  } as unknown as Space;
};

const wrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

/** Render the real hook once and report round-trips + elapsed ms. */
const measure = async (spaces: Space[]) => {
  resetCalls();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const started = performance.now();
  renderHook(() => useSpaceMentionCounts({ spaces }), {
    wrapper: wrapper(client),
  });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const elapsedMs = performance.now() - started;
  client.clear();
  return { ...calls, elapsedMs };
};

describe('useSpaceMentionCounts — cost of one recount (perf instrument)', () => {
  beforeEach(() => resetCalls());

  it('issues ONE batched read per space, covering every channel of that space', async () => {
    const grid = [
      { spaces: 1, channels: 5 },
      { spaces: 5, channels: 10 },
      { spaces: 10, channels: 20 },
    ];

    const rows: string[] = [];
    for (const { spaces: s, channels: c } of grid) {
      const list = Array.from({ length: s }, (_, i) => makeSpace(i, c));
      const r = await measure(list);
      const totalChannels = s * c;

      rows.push(
        `${String(s).padStart(3)} spaces x ${String(c).padStart(3)} ch = ` +
          `${String(totalChannels).padStart(4)} channels -> ` +
          `${String(r.getSpaceUnreadCandidates).padStart(3)} round-trips ` +
          `(${r.elapsedMs.toFixed(0)}ms with a stub DB, NOT a browser figure)`
      );

      // One round-trip per space (was 3 per channel), still covering every channel.
      expect(r.getSpaceUnreadCandidates).toBe(s);
      expect(r.channelsRead).toBe(totalChannels);
    }

    console.log(
      '\n[mention-recount cost per toggle]\n' + rows.join('\n') + '\n'
    );
  });

  it('scales with space count, not total channel count', async () => {
    const fewWide = Array.from({ length: 2 }, (_, i) => makeSpace(i, 50));
    const manyNarrow = Array.from({ length: 50 }, (_, i) => makeSpace(i, 2));

    const a = await measure(fewWide);
    const b = await measure(manyNarrow);

    expect(a.channelsRead).toBe(100);
    expect(b.channelsRead).toBe(100);
    expect(a.getSpaceUnreadCandidates).toBe(2);
    expect(b.getSpaceUnreadCandidates).toBe(50);
  });

  it('CONTROL ARM: a muted space is skipped entirely, so it costs zero reads', async () => {
    // `useSpaceMentionCounts` returns 0 for a muted space before reading. This
    // arm proves the instrument can register a DIFFERENCE at all.
    const spaces = Array.from({ length: 4 }, (_, i) => makeSpace(i, 10));
    const before = await measure(spaces);
    expect(before.getSpaceUnreadCandidates).toBe(4);

    messageDB.getUserConfig = async () => ({
      address: USER,
      spaceIds: [],
      notificationSettings: Object.fromEntries(
        spaces.map((s) => [s.spaceId, { spaceId: s.spaceId, isMuted: true }])
      ),
    });

    const after = await measure(spaces);
    expect(after.getSpaceUnreadCandidates).toBe(0);

    // restore for any later test in this file
    messageDB.getUserConfig = async () => ({ address: USER, spaceIds: [] });
  });
});
