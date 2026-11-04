import { describe, expect, it } from 'vitest';
import { filterModeratedContent, resolveModeration, type ModerationPolicy } from './moderation';

const config = (value: unknown) => ({ OPENCASTER_MODERATION: JSON.stringify(value) });
const policy = (value: unknown) => {
  const result = resolveModeration(config(value));
  if (result.status !== 'enabled') throw new Error('Expected a moderation policy');
  return result.policy;
};

describe('operator visibility policy', () => {
  it('distinguishes an absent binding from an enabled empty policy', () => {
    expect(resolveModeration({})).toEqual({ status: 'disabled' });
    expect(resolveModeration(config({ version: 1, blockedFids: [], blockedCasts: [], blockedMedia: [] })).status).toBe('enabled');
  });

  it('rejects empty, oversized, malformed, unknown and invalid configuration', () => {
    const invalid = [
      '', ' ', '{', JSON.stringify({ version: 1, blockedFids: [], blockedCasts: [], blockedMedia: [], extra: true }),
      JSON.stringify({ version: 2, blockedFids: [], blockedCasts: [], blockedMedia: [] }),
      JSON.stringify({ version: 1, blockedFids: [0], blockedCasts: [], blockedMedia: [] }),
      JSON.stringify({ version: 1, blockedFids: [], blockedCasts: ['bad'], blockedMedia: [] }),
      JSON.stringify({ version: 1, blockedFids: [], blockedCasts: [], blockedMedia: ['f'.repeat(63)] }),
      JSON.stringify({ version: 1, blockedFids: Array(501).fill(1), blockedCasts: [], blockedMedia: [] }),
      ' '.repeat(65_537),
    ];
    for (const OPENCASTER_MODERATION of invalid) expect(resolveModeration({ OPENCASTER_MODERATION }).status).toBe('invalid');
  });

  it('normalizes references, prunes array items, propagates blocked object children and preserves metadata', () => {
    const blocked: ModerationPolicy = policy({ version: 1, blockedFids: [7], blockedCasts: [`0x${'AB'.repeat(20)}`], blockedMedia: [] });
    const input = {
      casts: [{ hash: 'c'.repeat(40), author: { fid: '8' }, replies: [{ author_fid: 7 }, { fid: 9 }] }],
      users: [{ fid: 7, display_name: 'hidden' }, { fid: 8 }],
      next: { cursor: 'unchanged' }, total: 2,
      objects: [{ child: { targetHash: '0X' + 'ab'.repeat(20), text: 'removed with parent' }, value: 'discard with child' }, { value: 'kept' }],
      safe: { ['__proto__']: { fid: 8 }, value: 'safe' },
    };
    const result = filterModeratedContent(input, blocked);
    expect(result.rootRemoved).toBe(false);
    expect(result.value).toMatchObject({ casts: [{ replies: [{ fid: 9 }] }], users: [{ fid: 8 }], next: { cursor: 'unchanged' }, total: 2, objects: [{ value: 'kept' }] });
    expect(Object.getPrototypeOf(result.value!.safe)).toBeNull();
  });

  it('keeps allowed native messages intact, removes a blocked message whole, and enforces traversal bounds', () => {
    const blocked = policy({ version: 1, blockedFids: [7], blockedCasts: [], blockedMedia: [] });
    const allowed = { hash: 'a'.repeat(40), data: { fid: 8, type: 'MESSAGE_TYPE_CAST_ADD', dataBytes: 'same', signature: 'same' } };
    const removed = { hash: 'b'.repeat(40), data: { fid: 8, type: 'MESSAGE_TYPE_CAST_ADD', parentCastId: { fid: 7, hash: 'c'.repeat(40) }, dataBytes: 'same', signature: 'same' } };
    const result = filterModeratedContent({ messages: [allowed, removed], nextPageToken: 'cursor' }, blocked);
    expect(result.value).toEqual({ messages: [allowed], nextPageToken: 'cursor' });
    expect(result.removedNativeMessages).toBe(1);
    expect(() => filterModeratedContent({ deep: JSON.parse(`${'{"x":'.repeat(66)}0${'}'.repeat(66)}`) }, blocked)).toThrow();
    expect(() => filterModeratedContent({ items: Array(100_001).fill(null) }, blocked)).toThrow();
  });
});
