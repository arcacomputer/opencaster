import 'fake-indexeddb/auto';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Message, Space } from '@quilibrium/quorum-shared';
import { MessageDB } from '../../../db/messages';
import { fetchSpaceMentions } from '../../../hooks/business/mentions/fetchSpaceMentions';
import { fetchSpaceReplies } from '../../../hooks/business/replies/fetchSpaceReplies';

const ME = 'QmMe';
const OTHER = 'QmOther';
const SPACE = 'space-1';
let messageDB: MessageDB;
vi.mock('@quilibrium/quilibrium-js-sdk-channels', () => ({
  usePasskeysContext: () => ({ currentPasskeyInfo: { address: ME } }),
}));
vi.mock('../../../components/context/useMessageDB', () => ({
  useMessageDB: () => ({ messageDB }),
}));
import { useChannelMentionCounts } from '../../../hooks/business/mentions/useChannelMentionCounts';
import { useReplyNotificationCounts } from '../../../hooks/business/replies/useReplyNotificationCounts';

const channels = ['valid', 'mention-cap', 'reply-cap', 'muted'];
const space = {
  spaceId: SPACE, spaceName: 'Space',
  roles: [{ roleId: 'role-1', members: [OTHER], permissions: ['mention:everyone'] }],
  groups: [{ channels: channels.map((channelId) => ({ channelId, channelName: channelId })) }],
} as unknown as Space;
const config = {
  notificationSettings: {}, mutedChannels: { [SPACE]: ['muted'] },
} as any;
const mention = (memberIds: string[] = [ME], extra = {}) => ({
  mentions: { memberIds, roleIds: [], channelIds: [], ...extra },
});
function msg(channelId: string, id: string, createdDate: number, extra = {}): Message {
  return {
    messageId: id, spaceId: SPACE, channelId, createdDate,
    content: { type: 'post', senderId: OTHER, text: id }, ...extra,
  } as Message;
}
async function put(store: string, rows: unknown[]) {
  const idb = (messageDB as unknown as { db: IDBDatabase }).db;
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(store, 'readwrite');
    for (const row of rows) tx.objectStore(store).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

beforeEach(async () => {
  const FDBFactory = (await import('fake-indexeddb/lib/FDBFactory')).default;
  globalThis.indexedDB = new FDBFactory();
  messageDB = new MessageDB();
  await messageDB.init();
  vi.spyOn(messageDB, 'getUserConfig').mockResolvedValue(config);
  vi.spyOn(messageDB, 'getSpace').mockResolvedValue(space);
  await put('conversations', channels.map((channelId) => ({
    conversationId: `${SPACE}/${channelId}`, lastReadTimestamp: 100,
  })));
  await put('thread_read_times', [
    { spaceId: SPACE, channelId: 'valid', threadId: 'valid-thread', lastReadTimestamp: 300 },
    { spaceId: SPACE, channelId: 'reply-cap', threadId: 'read-thread', lastReadTimestamp: 300 },
  ]);
  await put('messages', [
    msg('valid', 'at-read', 100, mention()),
    msg('valid', 'personal', 200, mention()),
    msg('valid', 'role', 210, mention([], { roleIds: ['role-1'] })),
    msg('valid', 'everyone', 220, mention([], { everyone: true })),
    msg('valid', 'thread-read', 250, { ...mention(), isThreadReply: true, threadId: 'valid-thread', replyMetadata: { parentAuthor: ME } }),
    msg('valid', 'reply', 350, { replyMetadata: { parentAuthor: ME } }),
    msg('valid', 'reply-other', 360, { replyMetadata: { parentAuthor: OTHER } }),
    msg('muted', 'muted-message', 200, { ...mention(), replyMetadata: { parentAuthor: ME } }),
    ...Array.from({ length: 10 }, (_, i) => msg('mention-cap', `other-${i}`, 200 + i, mention([OTHER]))),
    msg('mention-cap', 'eleventh-mention', 400, mention()),
    ...Array.from({ length: 10 }, (_, i) => msg('reply-cap', `read-reply-${i}`, 200 + i, {
      isThreadReply: true, threadId: 'read-thread', replyMetadata: { parentAuthor: ME },
    })),
    msg('reply-cap', 'eleventh-reply', 400, { replyMetadata: { parentAuthor: ME } }),
  ]);
});

describe('channel notification callers use sparse candidates', () => {
  it('keeps the ten-candidate caps before settings and thread filtering', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => ({
      mentions: useChannelMentionCounts({ spaceId: SPACE, channelIds: [...channels], userRoleIds: ['role-1'] }),
      replies: useReplyNotificationCounts({ spaceId: SPACE, channelIds: [...channels] }),
    }), { wrapper });
    await waitFor(() => {
      expect(result.current.mentions).toEqual({ valid: 3 });
      expect(result.current.replies).toEqual({ valid: 1 });
    });
    unmount();
    client.clear();
  });

  it('keeps inbox candidate limits, settings, channel names and thread-read filtering', async () => {
    const mentions = await fetchSpaceMentions(messageDB, space, ME, {
      enabledTypes: ['mention-you'], config, perChannelLimit: 2,
    });
    expect(mentions.map((row) => [row.message.messageId, row.channelName])).toEqual([['personal', 'valid']]);
    const replies = await fetchSpaceReplies(messageDB, space, ME, {
      enabled: true, config, perChannelLimit: 1,
    });
    expect(replies).toEqual([]);
    // A larger inbox cap reaches later candidates that the badges intentionally omit.
    const allReplies = await fetchSpaceReplies(messageDB, space, ME, { enabled: true, config });
    expect(allReplies.map((row) => row.message.messageId)).toEqual(['reply', 'eleventh-reply']);
  });
});
