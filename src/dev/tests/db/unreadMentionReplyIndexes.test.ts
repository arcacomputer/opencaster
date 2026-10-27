import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { MessageDB } from '../../../db/messages';
import { buildMessageFingerprint, computeMessageIdHex } from '@quilibrium/quorum-shared';
import type { Message } from '@quilibrium/quorum-shared';

const ME = 'QmMe';
const OTHER = 'QmOther';
const SPACE = 'space-1';

const msg = (
  id: string,
  channelId: string,
  createdDate: number,
  extra: Partial<Message> = {}
): Message =>
  ({
    messageId: id,
    spaceId: SPACE,
    channelId,
    createdDate,
    modifiedDate: createdDate,
    digestAlgorithm: 'SHA-256',
    nonce: id,
    lastModifiedHash: '',
    content: { type: 'post', senderId: OTHER, text: id },
    reactions: [],
    ...extra,
  }) as unknown as Message;

const mention = (memberIds: string[]) => ({
  mentions: { memberIds, roleIds: [], channelIds: [] },
});
const replyTo = (parentAuthor: string) => ({
  replyMetadata: { parentAuthor, parentChannelId: 'c1' },
});

const putAll = (db: MessageDB, messages: Message[]) =>
  new Promise<void>((resolve, reject) => {
    const idb = (db as unknown as { db: IDBDatabase }).db;
    const tx = idb.transaction('messages', 'readwrite');
    for (const m of messages) tx.objectStore('messages').put(m);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

const ids = (messages: Message[]) => messages.map((m) => m.messageId);

describe('MessageDB - sparse unread mention / reply indexes', () => {
  let db: MessageDB;

  beforeEach(async () => {
    const FDBFactory = (await import('fake-indexeddb/lib/FDBFactory')).default;
    globalThis.indexedDB = new FDBFactory();
    db = new MessageDB();
    await db.init();
    await putAll(db, [
      msg('plain-1', 'c1', 100),
      msg('m-at-read', 'c1', 200, mention([ME])),
      msg('m-1', 'c1', 300, mention([ME])),
      msg('plain-2', 'c1', 350),
      msg('m-role', 'c1', 400, mention([])),
      msg('m-2', 'c1', 500, mention([OTHER])),
      msg('r-at-read', 'c1', 200, replyTo(ME)),
      msg('r-1', 'c1', 600, replyTo(ME)),
      msg('r-other', 'c1', 700, replyTo(OTHER)),
      msg('r-thread', 'c1', 800, {
        ...replyTo(ME),
        isThreadReply: true,
        threadId: 't1',
      } as Partial<Message>),
      msg('m-c2', 'c2', 50, mention([ME])),
      msg('m-other-space', 'c1', 900, { ...mention([ME]), spaceId: 'space-2' }),
    ]);
  });

  it('getUnreadMentions returns mention-bearing messages strictly after the timestamp, oldest first', async () => {
    const result = await db.getUnreadMentions({
      spaceId: SPACE,
      channelId: 'c1',
      afterTimestamp: 200,
    });
    expect(ids(result)).toEqual(['m-1', 'm-role', 'm-2']);
  });

  it('getUnreadMentions honours the limit', async () => {
    const result = await db.getUnreadMentions({
      spaceId: SPACE,
      channelId: 'c1',
      afterTimestamp: 0,
      limit: 2,
    });
    expect(ids(result)).toEqual(['m-at-read', 'm-1']);
  });

  it('getUnreadReplies returns only replies to the user, strictly after the timestamp', async () => {
    const result = await db.getUnreadReplies({
      spaceId: SPACE,
      channelId: 'c1',
      userAddress: ME,
      afterTimestamp: 200,
    });
    expect(ids(result)).toEqual(['r-1', 'r-thread']);
  });

  it.each(['save', 'update', 'import'] as const)(
    '%s keeps everyone/role-only legacy mentions in the sparse index without mutating input',
    async (method) => {
      const legacy = msg(`legacy-${method}`, 'legacy', 1000, {
        mentions: { everyone: true, roleIds: ['role-1'] },
      } as unknown as Partial<Message>);
      const original = structuredClone(legacy);
      const fingerprint = (message: Message) => buildMessageFingerprint({
        nonce: message.nonce,
        content: message.content as Parameters<typeof buildMessageFingerprint>[0]['content'],
        senderId: message.content.senderId,
        spaceId: message.spaceId,
        channelId: message.channelId,
      });
      if (method === 'save') {
        await db.saveMessage(legacy, 1000, SPACE, 'group', '', '');
      } else if (method === 'update') {
        await db.updateMessage(legacy);
      } else {
        await db.importDMData({ messages: [legacy], conversations: [] });
      }
      const candidates = await db.getUnreadMentions({
        spaceId: SPACE, channelId: 'legacy', afterTimestamp: 0,
      });
      expect(ids(candidates)).toEqual([legacy.messageId]);
      expect(candidates[0].mentions).toEqual({ ...original.mentions, memberIds: [] });
      expect(candidates[0].content).toEqual(original.content);
      expect(computeMessageIdHex(fingerprint(candidates[0]))).toBe(
        computeMessageIdHex(fingerprint(original))
      );
      expect(legacy).toEqual(original);
    }
  );

  it('getSpaceUnreadCandidates reads every channel in one call, from each channel last-read time', async () => {
    await db.saveConversation({
      conversationId: `${SPACE}/c1`,
      address: SPACE,
      type: 'group',
      timestamp: 0,
      icon: '',
      displayName: '',
      lastReadTimestamp: 300,
    } as never);
    await db.saveThreadReadTime({
      threadId: 't1',
      spaceId: SPACE,
      channelId: 'c1',
      lastReadTimestamp: 850,
    });

    const mentions = await db.getSpaceUnreadCandidates({
      spaceId: SPACE,
      channelIds: ['c1', 'c2', 'c3'],
      kind: 'mentions',
      limitPerChannel: 10,
    });
    expect(mentions.map((c) => [c.channelId, ids(c.messages)])).toEqual([
      ['c1', ['m-role', 'm-2']],
      ['c2', ['m-c2']],
      ['c3', []],
    ]);
    // No thread-reply candidates, so thread read times are not loaded.
    expect(mentions[0].threadReadTimes).toEqual({});

    const replies = await db.getSpaceUnreadCandidates({
      spaceId: SPACE,
      channelIds: ['c1'],
      kind: 'replies',
      userAddress: ME,
      limitPerChannel: 10,
    });
    expect(ids(replies[0].messages)).toEqual(['r-1', 'r-thread']);
    expect(replies[0].threadReadTimes).toEqual({ t1: 850 });
  });
});

describe('MessageDB - v17 upgrade indexes existing messages', () => {
  it('finds mentions and replies saved before the upgrade', async () => {
    const FDBFactory = (await import('fake-indexeddb/lib/FDBFactory')).default;
    globalThis.indexedDB = new FDBFactory();

    // A v16 database: the messages store exists, the sparse indexes do not.
    // (Opening MessageDB itself at 16 would run every upgrade block, v17's
    // included, since the blocks only check oldVersion.)
    const v16 = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('quorum_db', 16);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('messages', {
          keyPath: 'messageId',
        });
        store.createIndex('by_conversation_time', [
          'spaceId',
          'channelId',
          'createdDate',
        ]);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await putAll({ db: v16 } as unknown as MessageDB, [
      msg('m-1', 'c1', 300, mention([ME])),
      msg('r-1', 'c1', 400, replyTo(ME)),
      msg('plain', 'c1', 500),
      msg('legacy-everyone', 'c1', 600, {
        mentions: { everyone: true },
      } as unknown as Partial<Message>),
      msg('legacy-role', 'c1', 700, {
        mentions: { roleIds: ['role-1'] },
      } as unknown as Partial<Message>),
    ]);
    v16.close();

    const upgraded = new MessageDB();
    await upgraded.init();
    const mentions = await upgraded.getUnreadMentions({
      spaceId: SPACE,
      channelId: 'c1',
      afterTimestamp: 0,
    });
    const replies = await upgraded.getUnreadReplies({
      spaceId: SPACE,
      channelId: 'c1',
      userAddress: ME,
      afterTimestamp: 0,
    });
    expect(ids(mentions)).toEqual(['m-1', 'legacy-everyone', 'legacy-role']);
    expect(ids(replies)).toEqual(['r-1']);
  });
});
