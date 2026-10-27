import 'fake-indexeddb/auto';
import * as React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Message, Space } from '@quilibrium/quorum-shared';
import { MessageDB } from '../../../db/messages';

/**
 * Wall-clock of one NavRail badge recount (mentions + replies) against a REAL
 * MessageDB on fake-indexeddb, seeded with a large unread history.
 *
 * Companion to spaceMentionCounts.bench, which counts round-trips with a stub.
 * This one measures the cost INSIDE each round-trip: the badges used to walk
 * (and deserialize) every message after lastReadTimestamp looking for the rare
 * mention or reply; with the sparse indexes they read only the candidates.
 *
 * fake-indexeddb is an in-memory JS implementation, so the absolute ms are not
 * a browser prediction — only the before/after ratio on the same data is.
 * Uses only the hooks' public surface, so it runs unchanged on older revisions.
 * Run with `yarn bench spaceBadgeCountsIdb`.
 */

const USER = 'QmPeerAEgVKpYZKYuFu2J49zHXnA8vZtEqHMtpB4imzzzz';
const OTHER = 'QmPeerBEgVKpYZKYuFu2J49zHXnA8vZtEqHMtpB4imzzzz';
const SPACES = 5;
const CHANNELS = 10;
const MESSAGES_PER_CHANNEL = Number(process.env.BADGE_BENCH_MESSAGES) || 1000;
// One mention of USER and one reply to USER every 250 messages: 4 of each per
// channel, so the badges never reach their 10-per-space early exit after the
// first few channels and must look at every channel's history.
const EVERY = 250;

let messageDB: MessageDB;

vi.mock('@quilibrium/quilibrium-js-sdk-channels', () => ({
  usePasskeysContext: () => ({ currentPasskeyInfo: { address: USER } }),
}));

vi.mock('../../../components/context/useMessageDB', () => ({
  useMessageDB: () => ({ messageDB }),
}));

import { useSpaceMentionCounts } from '../../../hooks/business/mentions/useSpaceMentionCounts';
import { useSpaceReplyCounts } from '../../../hooks/business/replies/useSpaceReplyCounts';

const channelId = (s: number, c: number) => `space-${s}-channel-${c}`;

const makeSpace = (s: number): Space =>
  ({
    spaceId: `space-${s}`,
    spaceName: `Space ${s}`,
    roles: [],
    groups: [
      {
        groupName: 'group',
        channels: Array.from({ length: CHANNELS }, (_, c) => ({
          channelId: channelId(s, c),
          channelName: `channel-${c}`,
        })),
      },
    ],
  }) as unknown as Space;

const makeMessage = (s: number, c: number, i: number): Message => {
  const base = {
    messageId: `m-${s}-${c}-${i}`,
    spaceId: `space-${s}`,
    channelId: channelId(s, c),
    createdDate: 1_000 + i,
    modifiedDate: 1_000 + i,
    digestAlgorithm: 'SHA-256',
    nonce: `n-${s}-${c}-${i}`,
    lastModifiedHash: '',
    reactions: [],
    content: { type: 'post', senderId: OTHER, text: 'x'.repeat(200) },
  } as Record<string, unknown>;
  if (i % EVERY === 1) {
    base.mentions = { memberIds: [USER], roleIds: [], channelIds: [] };
  }
  if (i % EVERY === 2) {
    base.replyMetadata = { parentAuthor: USER, parentChannelId: channelId(s, c) };
  }
  return base as unknown as Message;
};

const seed = () =>
  new Promise<void>((resolve, reject) => {
    const idb = (messageDB as unknown as { db: IDBDatabase }).db;
    const tx = idb.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    for (let s = 0; s < SPACES; s++)
      for (let c = 0; c < CHANNELS; c++)
        for (let i = 0; i < MESSAGES_PER_CHANNEL; i++)
          store.put(makeMessage(s, c, i));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

const spaces = Array.from({ length: SPACES }, (_, s) => makeSpace(s));

const recount = async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const started = performance.now();
  const { result } = renderHook(
    () => ({
      mentions: useSpaceMentionCounts({ spaces }),
      replies: useSpaceReplyCounts({ spaces }),
    }),
    { wrapper: Wrapper }
  );
  await waitFor(() => expect(client.isFetching()).toBe(0), { timeout: 600_000 });
  const elapsedMs = performance.now() - started;
  const counts = result.current;
  client.clear();
  return { elapsedMs, counts };
};

describe('NavRail badge recount against fake-indexeddb (perf instrument)', () => {
  beforeAll(async () => {
    messageDB = new MessageDB();
    await messageDB.init();
    await seed();
  }, 300_000);

  it('recounts mentions + replies for every space', async () => {
    await recount(); // warm-up
    const runs: number[] = [];
    let counts: Awaited<ReturnType<typeof recount>>['counts'] | undefined;
    for (let i = 0; i < 5; i++) {
      const r = await recount();
      runs.push(r.elapsedMs);
      counts = r.counts;
    }
    runs.sort((a, b) => a - b);

    // Behaviour check: every space saturates the 10-per-space badge.
    for (const space of spaces) {
      expect(counts!.mentions[space.spaceId]).toBe(10);
      expect(counts!.replies[space.spaceId]).toBe(10);
    }

    // console is silenced by the harness setup; write straight to stdout.
    process.stdout.write(
      `\n[badge recount, ${SPACES} spaces x ${CHANNELS} ch x ${MESSAGES_PER_CHANNEL} msgs]\n` +
        `median ${runs[2].toFixed(0)}ms (min ${runs[0].toFixed(0)}, max ${runs[4].toFixed(0)}) on fake-indexeddb\n`
    );
  }, 1_800_000);
});
