import { describe, expect, it } from 'vitest';
import type { Cast, ConversationNode } from '@opencaster/client-core/api';
import { MAX_CONVERSATION_CASTS, conversationCasts } from './Conversation';
import { castPreviewText } from '../lib/castDisplay';
import { EXPLORE_STORAGE_KEY, THEME_STORAGE_KEY } from '../lib/storageKeys';

const cast = (hash: string, text = hash) => ({ hash, text, timestamp: '2026-01-01T00:00:00Z', author: { fid: 1, username: 'alice' }, mentioned_profiles: [], mentioned_profiles_ranges: [], embeds: [] }) as unknown as Cast;
const node = (hash: string, replies: ConversationNode[] = []) => ({ cast: cast(hash), replies }) as ConversationNode;

describe('conversation helpers', () => {
  it('collects casts breadth-first and stops at the conversation cap', () => {
    expect(conversationCasts(null)).toEqual([]);
    expect(conversationCasts(node('root', [node('a', [node('a1')]), node('b')])).map(item => item.hash)).toEqual(['root', 'a', 'b', 'a1']);
    const wide = node('root', Array.from({ length: MAX_CONVERSATION_CASTS + 20 }, (_, index) => node(`r${index}`)));
    expect(MAX_CONVERSATION_CASTS).toBe(150);
    expect(conversationCasts(wide)).toHaveLength(MAX_CONVERSATION_CASTS);
  });

  it('previews cast text and falls back for attachment-only casts', () => {
    expect(castPreviewText(cast('x', 'hello'))).toBe('hello');
    expect(castPreviewText(cast('x', ''))).toBe('Cast with attachments');
  });

  it('keeps the stable browser storage identifiers', () => {
    expect(THEME_STORAGE_KEY).toBe('quorum.theme');
    expect(EXPLORE_STORAGE_KEY).toBe('opencaster.explore');
  });
});
