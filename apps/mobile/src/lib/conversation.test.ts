import type { Cast, ConversationNode } from '@opencaster/client-core/api';
import { describe, expect, it } from 'vitest';
import { visibleConversationRows } from './conversation';
import { decodeHiddenContent } from './localContent';

const noFilters = decodeHiddenContent(null);
const hiddenUser = decodeHiddenContent(JSON.stringify({ version: 1, users: [2], casts: [] }));

function cast(id: number, fid = 1): Cast {
  return {
    hash: id.toString(16).padStart(40, '0'),
    author: {
      fid,
      username: `user${fid}`,
      custody_address: '',
      profile: { bio: { text: '' } },
      follower_count: 0,
      following_count: 0,
    },
    text: '',
    timestamp: '2026-01-01T00:00:00Z',
    embeds: [],
    reactions: { likes_count: 0, recasts_count: 0 },
    replies: { count: 0 },
  };
}

function node(id: number, fid = 1, replies: ConversationNode[] = []): ConversationNode {
  return { cast: cast(id, fid), replies };
}

describe('visible conversation traversal', () => {
  it('does not spend the visible-row limit on hidden replies', () => {
    const visibleReply = node(102);
    const root = node(1, 1, [
      ...Array.from({ length: 100 }, (_, index) => node(index + 2, 2)),
      visibleReply,
    ]);

    const rows = visibleConversationRows(root, hiddenUser);

    expect(rows.map(row => row.cast.hash)).toEqual([root.cast.hash, visibleReply.cast.hash]);
  });

  it('limits visible output to 100 rows', () => {
    const root = node(1, 1, Array.from({ length: 120 }, (_, index) => node(index + 2)));

    const rows = visibleConversationRows(root, noFilters);

    expect(rows).toHaveLength(100);
    expect(rows.at(-1)?.cast.hash).toBe(cast(100).hash);
  });

  it('bounds visited nodes separately while traversing hidden nodes', () => {
    const visibleChild = node(3);
    const root = node(1, 2, [
      node(2, 2),
      visibleChild,
      node(4),
    ]);

    const rows = visibleConversationRows(root, hiddenUser, { maxVisitedNodes: 3 });

    expect(rows.map(row => row.cast.hash)).toEqual([visibleChild.cast.hash]);
  });

  it('stops at five reply levels', () => {
    const root = node(1);
    let current = root;
    for (let id = 2; id <= 7; id += 1) {
      const reply = node(id);
      current.replies.push(reply);
      current = reply;
    }

    const rows = visibleConversationRows(root, noFilters);

    expect(rows.map(row => row.depth)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('terminates cycles and duplicate cast hashes', () => {
    const root = node(1);
    const child = node(2);
    root.replies.push(child);
    child.replies.push(root);

    const rows = visibleConversationRows(root, noFilters);

    expect(rows.map(row => row.cast.hash)).toEqual([root.cast.hash, child.cast.hash]);
  });
});
