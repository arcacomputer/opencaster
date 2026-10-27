import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { MessageDB } from '../../../db/messages';
import type { Conversation, Message } from '@quilibrium/quorum-shared';

// The batched reads must return exactly what the per-channel methods they
// replace return, so the notification hooks keep identical results.

const SPACE = 'space-1';
const ME = 'QmMe';
const CHANNELS = ['chan-a', 'chan-b', 'chan-c', 'chan-empty', 'chan-missing'];

function putRaw(db: MessageDB, store: string, values: unknown[]): Promise<void> {
  const idb = (db as unknown as { db: IDBDatabase }).db;
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(store, 'readwrite');
    for (const v of values) tx.objectStore(store).put(v);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function makeMessage(channelId: string, i: number): Message {
  return {
    messageId: `${channelId}-m${i}`,
    spaceId: SPACE,
    channelId,
    createdDate: 1000 + i * 10,
    content: { senderId: 'QmOther', type: 'post', text: `msg ${i}` },
    ...(i % 3 === 0 ? { mentions: { memberIds: [ME], roleIds: [], channelIds: [] } } : {}),
    ...(i % 4 === 0 ? { replyMetadata: { parentAuthor: ME, parentChannelId: channelId } } : {}),
    ...(i % 5 === 0 ? { replyMetadata: { parentAuthor: 'QmOther', parentChannelId: channelId } } : {}),
    ...(i % 7 === 0 ? { isThreadReply: true, threadId: `${channelId}-t1` } : {}),
  } as unknown as Message;
}

describe('MessageDB batched notification reads', () => {
  let db: MessageDB;

  beforeEach(async () => {
    const FDBFactory = (await import('fake-indexeddb/lib/FDBFactory')).default;
    globalThis.indexedDB = new FDBFactory();
    db = new MessageDB();
    await db.init();

    const lastRead: Record<string, number> = { 'chan-a': 0, 'chan-b': 1095, 'chan-c': 1400 };
    await putRaw(
      db,
      'conversations',
      [...Object.entries(lastRead), ['chan-empty', 0] as const].map(([channelId, lastReadTimestamp]) => ({
        conversationId: `${SPACE}/${channelId}`,
        type: 'group',
        timestamp: 2000,
        address: SPACE,
        icon: '',
        displayName: channelId,
        lastReadTimestamp,
      })),
    );
    await putRaw(
      db,
      'messages',
      ['chan-a', 'chan-b', 'chan-c'].flatMap((c) => Array.from({ length: 60 }, (_, i) => makeMessage(c, i))),
    );
    // A message in another space must never leak into SPACE's results.
    await putRaw(db, 'messages', [{ ...makeMessage('chan-a', 999), messageId: 'other', spaceId: 'space-2' }]);
    await putRaw(db, 'thread_read_times', [
      { threadId: 'chan-a-t1', spaceId: SPACE, channelId: 'chan-a', lastReadTimestamp: 1300 },
      { threadId: 'chan-b-t1', spaceId: SPACE, channelId: 'chan-b', lastReadTimestamp: 1500 },
    ]);
  });

  async function expected(channelId: string, kind: 'mentions' | 'replies', limit: number) {
    const { conversation } = await db.getConversation({ conversationId: `${SPACE}/${channelId}` });
    const lastReadTimestamp = conversation?.lastReadTimestamp || 0;
    const messages = kind === 'mentions'
      ? await db.getUnreadMentions({ spaceId: SPACE, channelId, afterTimestamp: lastReadTimestamp, limit })
      : await db.getUnreadReplies({ spaceId: SPACE, channelId, userAddress: ME, afterTimestamp: lastReadTimestamp, limit });
    return {
      channelId,
      lastReadTimestamp,
      threadReadTimes: messages.some((m) => m.isThreadReply && m.threadId)
        ? await db.getThreadReadTimesForChannel({ spaceId: SPACE, channelId })
        : {},
      messages,
    };
  }

  it.each([
    ['mentions', 0], ['mentions', 3], ['mentions', 10], ['mentions', 1000],
    ['replies', 0], ['replies', 3], ['replies', 10], ['replies', 1000],
  ] as const)('matches per-channel reads (kind=%s, limit=%i)', async (kind, limitPerChannel) => {
    const result = await db.getSpaceUnreadCandidates({
      spaceId: SPACE,
      channelIds: CHANNELS,
      userAddress: ME,
      kind,
      limitPerChannel,
    });
    expect(result.map((entry) => entry.channelId)).toEqual(CHANNELS);
    for (const [index, channelId] of CHANNELS.entries()) {
      expect(result[index]).toEqual(await expected(channelId, kind, limitPerChannel));
    }
  });

  it('returns an empty result for no channels', async () => {
    const result = await db.getSpaceUnreadCandidates({
      spaceId: SPACE, channelIds: [], kind: 'mentions', limitPerChannel: 10,
    });
    expect(result).toEqual([]);
  });

  it('getConversationsByIds matches getConversation and omits missing ids', async () => {
    const ids = CHANNELS.map((c) => `${SPACE}/${c}`);
    const result = await db.getConversationsByIds(ids);
    for (const id of ids) {
      const { conversation } = await db.getConversation({ conversationId: id });
      expect(result.get(id) as Conversation | undefined).toEqual(conversation);
    }
    expect(result.has(`${SPACE}/chan-missing`)).toBe(false);
    expect((await db.getConversationsByIds([])).size).toBe(0);
  });
});
