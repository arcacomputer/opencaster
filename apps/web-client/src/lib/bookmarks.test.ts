import { describe, expect, it } from 'vitest';
import { BOOKMARK_LIMIT, BOOKMARK_STORAGE_KEY, LEGACY_BOOKMARK_STORAGE_KEY, bookmarkHash, filterBookmarks, normalizeBookmarks, readBookmarks, saveBookmarks, toggleBookmark } from './bookmarks';
import type { Cast } from '@opencaster/client-core/api';

function cast(id = 1, extra: Partial<Cast> = {}): Cast { return { hash: `0x${id.toString(16).padStart(40, '0')}`, author: { fid: id, username: `person${id}`, display_name: `Person ${id}`, custody_address: 'private-do-not-retain', profile: { bio: { text: '' } }, follower_count: 2, following_count: 3 }, text: `Saved text ${id}`, timestamp: '2026-10-21T10:00:00.000Z', embeds: [], reactions: { likes_count: 1, recasts_count: 0 }, replies: { count: 0 }, ...extra }; }
function storage() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; }

describe('bounded local bookmark snapshots', () => {
  it('retains published canonical and legacy URLs verbatim under the existing storage schema', () => {
    const store = storage();
    const embeds = [{ url: `https://quorum.arca.computer/media/${'a'.repeat(64)}` }, { url: 'https://opencaster.org/profile/3' }];
    expect(saveBookmarks([cast(1, { embeds })], store)).toBe(true);
    expect(readBookmarks(store)[0].embeds).toEqual(embeds);
    expect(BOOKMARK_STORAGE_KEY).toBe('arca.hypersnap.bookmarks.v1');
  });
  it('reads legacy raw arrays safely, normalizes hashes and deduplicates in saved order without changing the legacy record', () => {
    const store = storage(); const raw = JSON.stringify([cast(2), { ...cast(2), hash: cast(2).hash.slice(2).toUpperCase() }, cast(1)]); store.setItem(LEGACY_BOOKMARK_STORAGE_KEY, raw);
    expect(readBookmarks(store).map(item => item.author.fid)).toEqual([2, 1]); expect(store.getItem(LEGACY_BOOKMARK_STORAGE_KEY)).toBe(raw); expect(store.getItem(BOOKMARK_STORAGE_KEY)).toBeNull();
  });
  it('writes a versioned allowlist snapshot preserving safe quotes, images and protocol mentions while dropping account state and arbitrary metadata', () => {
    const store = storage(); const original = { ...cast(1), embeds: [{ cast_id: { fid: 2, hash: cast(2).hash.slice(2) } }, { url: 'https://example.com/image.png' }], text: '🙂 hello', mentioned_profiles: [cast(2).author], mentioned_profiles_ranges: [{ start: 4, end: 4 }], viewer_context: { liked: true, recasted: true }, reaction_context: { fid: 9, type: 'like', timestamp: '2026-10-21T12:00:00Z' }, privateKey: 'forbidden-extra-secret' } as Cast;
    expect(saveBookmarks([original], store)).toBe(true);
    const raw = store.getItem(BOOKMARK_STORAGE_KEY)!; expect(JSON.parse(raw).version).toBe(1); expect(raw).not.toContain('forbidden-extra-secret'); expect(raw).not.toContain('private-do-not-retain'); expect(raw).not.toContain('viewer_context'); expect(raw).not.toContain('reaction_context');
    const [saved] = readBookmarks(store); expect(saved.embeds).toEqual([{ cast_id: { fid: 2, hash: cast(2).hash } }, { url: 'https://example.com/image.png' }]); expect(saved.mentioned_profiles?.[0].fid).toBe(2); expect(saved.mentioned_profiles_ranges).toEqual([{ start: 4, end: 4 }]);
    expect(original.author.custody_address).toBe('private-do-not-retain');
  });
  it('gives a new-format empty collection precedence so clearing cannot resurrect legacy bookmarks', () => {
    const store = storage(); store.setItem(LEGACY_BOOKMARK_STORAGE_KEY, JSON.stringify([cast(1)])); expect(saveBookmarks([], store)).toBe(true); expect(readBookmarks(store)).toEqual([]); expect(store.getItem(LEGACY_BOOKMARK_STORAGE_KEY)).not.toBeNull();
  });
  it('rejects corrupt/oversized/unknown-version storage and malformed records without breaking the rest of the collection', () => {
    const store = storage();
    for (const raw of ['{broken', 'null', JSON.stringify({ version: 99, casts: [cast()] }), ' '.repeat(2 * 1024 * 1024 + 1)]) { store.setItem(BOOKMARK_STORAGE_KEY, raw); expect(readBookmarks(store)).toEqual([]); }
    store.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify({ version: 1, casts: [null, {}, cast(1, { timestamp: 'not-a-date' }), { ...cast(2), author: { fid: 0 } }, cast(3)] })); expect(readBookmarks(store).map(item => item.author.fid)).toEqual([3]);
  });
  it('filters unsafe optional URLs and invalid UTF-8 mention positions while retaining readable cast text', () => {
    const [saved] = normalizeBookmarks([{ ...cast(), text: '🙂 hello', embeds: [{ url: 'javascript:alert(1)' }, { url: 'https://name:password@example.com/image.png' }], author: { ...cast().author, pfp_url: 'data:text/html,bad' }, mentioned_profiles: [cast(2).author], mentioned_profiles_ranges: [{ start: 1, end: 1 }] }]);
    expect(saved.text).toBe('🙂 hello'); expect(saved.embeds).toEqual([]); expect(saved.author.pfp_url).toBeUndefined(); expect(saved.mentioned_profiles).toBeUndefined(); expect(saved.mentioned_profiles_ranges).toBeUndefined();
  });
  it('bounds the collection and toggles normalized identities without mutating the source array', () => {
    const many = Array.from({ length: BOOKMARK_LIMIT + 10 }, (_, index) => cast(index + 1)); const snapshot = JSON.stringify(many);
    expect(normalizeBookmarks(many)).toHaveLength(BOOKMARK_LIMIT);
    const removed = toggleBookmark(many, { ...cast(1), hash: cast(1).hash.slice(2).toUpperCase() }); expect(removed).toHaveLength(BOOKMARK_LIMIT - 1); expect(removed.some(item => item.author.fid === 1)).toBe(false);
    const added = toggleBookmark(many, cast(999)); expect(added).toHaveLength(BOOKMARK_LIMIT); expect(added[0].author.fid).toBe(999); expect(JSON.stringify(many)).toBe(snapshot); expect(bookmarkHash('not-a-hash')).toBeUndefined();
  });
  it('reports denied/quota storage without throwing and leaves existing bytes unchanged', () => {
    const store = storage(); saveBookmarks([cast()], store); const before = store.getItem(BOOKMARK_STORAGE_KEY);
    expect(saveBookmarks([cast(2)], { setItem: () => { throw new Error('Quota exceeded'); } })).toBe(false);
    expect(readBookmarks({ getItem: () => { throw new Error('Access denied'); } })).toEqual([]); expect(store.getItem(BOOKMARK_STORAGE_KEY)).toBe(before);
    const tooLarge = Array.from({ length: 200 }, (_, index) => cast(index + 1, { text: '界'.repeat(16_384) })); expect(saveBookmarks(tooLarge, store)).toBe(false); expect(store.getItem(BOOKMARK_STORAGE_KEY)).toBe(before);
  });
  it('searches Unicode-normalized text, authors, channel names and explicit mentions using all query terms', () => {
    const one = cast(1, { text: 'Café and 東京', channel: { id: 'art', name: 'Creative Studio', url: '' } }); one.author.display_name = 'ÁLICE';
    const two = cast(2, { text: 'A different conversation', mentioned_profiles: [cast(9).author] });
    expect(filterBookmarks([one, two], 'cafe\u0301 東京')).toEqual([one]); expect(filterBookmarks([one, two], 'álICE /art')).toEqual([one]); expect(filterBookmarks([one, two], 'creative')).toEqual([one]); expect(filterBookmarks([one, two], '@person9')).toEqual([two]); expect(filterBookmarks([one, two], 'unknown')).toEqual([]);
  });
  it('sorts by saved insertion order rather than publication timestamps, without mutating caller data', () => {
    const newestSaved = cast(1, { timestamp: '2020-01-01T00:00:00Z' }); const oldestSaved = cast(2, { timestamp: '2026-10-21T00:00:00Z' }); const items = [newestSaved, oldestSaved];
    expect(filterBookmarks(items, '', 'newest')).toEqual([newestSaved, oldestSaved]); expect(filterBookmarks(items, 'saved', 'oldest')).toEqual([oldestSaved, newestSaved]); expect(items).toEqual([newestSaved, oldestSaved]);
  });
});
