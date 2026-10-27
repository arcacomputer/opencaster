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

  async function expected(channelId: string, mentionLimit: number, replyLimit: number) {
    const { conversation } = await db.getConversation({ conversationId: `${SPACE}/${channelId}` });
    const lastReadTimestamp = conversation?.lastReadTimestamp || 0;
    return {
      lastReadTimestamp,
      threadReadTimes: await db.getThreadReadTimesForChannel({ spaceId: SPACE, channelId }),
      mentions:
        mentionLimit > 0
          ? await db.getUnreadMentions({ spaceId: SPACE, channelId, afterTimestamp: lastReadTimestamp, limit: mentionLimit })
          : [],
      replies:
        replyLimit > 0
          ? await db.getUnreadReplies({
              spaceId: SPACE,
              channelId,
              userAddress: ME,
              afterTimestamp: lastReadTimestamp,
              limit: replyLimit,
            })
          : [],
    };
  }

  it.each([
    [10, 0],
    [0, 10],
    [10, 10],
    [3, 1000],
    [1000, 1000],
    [0, 0],
  ])('matches per-channel reads (mentionLimit=%i, replyLimit=%i)', async (mentionLimit, replyLimit) => {
    const result = await db.getUnreadNotificationCandidates({
      spaceId: SPACE,
      channelIds: CHANNELS,
      userAddress: ME,
      mentionLimit,
      replyLimit,
    });
    expect([...result.keys()]).toEqual(CHANNELS);
    for (const channelId of CHANNELS) {
      expect(result.get(channelId)).toEqual(await expected(channelId, mentionLimit, replyLimit));
    }
  });

  it('returns an empty map for no channels', async () => {
    const result = await db.getUnreadNotificationCandidates({ spaceId: SPACE, channelIds: [], mentionLimit: 10 });
    expect(result.size).toBe(0);
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
