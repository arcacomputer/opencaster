import { describe, expect, it } from 'vitest';
import type { Cast } from './api';
import { CUSTOM_FEED_TOKEN_LIMIT, SAVED_FEED_LIMIT, SAVED_FEED_STORAGE_KEY, decodeFeed, encodeFeed, feedMatches, newSavedFeed, normalizeFeedDefinition, orderFeedCasts, readSavedFeeds, sourceKey, writeSavedFeeds, type FeedDefinition } from './customFeeds';

const definition = (extra: Partial<FeedDefinition> = {}): FeedDefinition => ({ version: 1, name: 'My feed', sources: [{ kind: 'trending', timeWindow: '24h' }], order: 'source', filters: { includeWords: [], excludeWords: [], hideReplies: false, imagesOnly: false }, ...extra });
const cast = (id: number, extra: Partial<Cast> = {}): Cast => ({ hash: `0x${id.toString(16).padStart(40, '0')}`, author: { fid: id, username: `person${id}`, custody_address: '', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 }, text: `Text ${id}`, timestamp: `2026-10-26T${String(id).padStart(2, '0')}:00:00Z`, embeds: [], reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 }, ...extra });
const storage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; };
const rawToken = (value: unknown) => btoa(Array.from(new TextEncoder().encode(JSON.stringify(value)), byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('public custom feed recipes', () => {
  it('normalizes public fields and deduplicates sources and Unicode-equivalent phrases without mutating the input', () => {
    const input = { ...definition({ name: '  Café 東京  ', sources: [{ kind: 'user', fid: 7 }, { kind: 'channel', channel: 'art' }, { kind: 'user', fid: 7 }] }), filters: { includeWords: [' Café ', 'CAFE\u0301'], excludeWords: [], hideReplies: false, imagesOnly: false, secret: 'private-filter-data' }, privateKey: 'never-retain', sourcesExtra: 'no' };
    const before = JSON.stringify(input);
    const normalized = normalizeFeedDefinition(input)!;
    expect(normalized).toEqual(definition({ name: 'Café 東京', sources: [{ kind: 'user', fid: 7 }, { kind: 'channel', channel: 'art' }], filters: { includeWords: ['Café'], excludeWords: [], hideReplies: false, imagesOnly: false } }));
    expect(JSON.stringify(normalized)).not.toContain('private'); expect(JSON.stringify(input)).toBe(before);
    expect(normalized.sources.map(sourceKey)).toEqual(['user:7', 'channel:art']);
  });

  it.each([
    null, {}, { ...definition(), version: 2 }, { ...definition(), name: '' }, { ...definition(), name: 'x'.repeat(65) }, { ...definition(), name: 'line\nbreak' },
    { ...definition(), sources: [] }, { ...definition(), sources: Array.from({ length: 9 }, (_, fid) => ({ kind: 'user', fid: fid + 1 })) },
    { ...definition(), sources: [{ kind: 'user', fid: 0 }] }, { ...definition(), sources: [{ kind: 'following', fid: Number.MAX_SAFE_INTEGER + 1 }] },
    { ...definition(), sources: [{ kind: 'trending', timeWindow: '30d' }] }, { ...definition(), sources: [{ kind: 'channel', channel: 'one,two' }] },
    { ...definition(), order: 'popular' }, { ...definition(), filters: { ...definition().filters, includeWords: [''] } },
    { ...definition(), filters: { ...definition().filters, excludeWords: ['x'.repeat(65)] } },
    { ...definition(), filters: { ...definition().filters, includeWords: Array(11).fill('phrase') } },
    { ...definition(), filters: { ...definition().filters, hideReplies: 'true' } },
  ])('rejects malformed or out-of-budget definitions: %#', input => { expect(normalizeFeedDefinition(input)).toBeUndefined(); });

  it('rejects every ASCII control character in names and phrases before trimming', () => {
    const codes = [...Array.from({ length: 32 }, (_, code) => code), 127];
    for (const code of codes) {
      const character = String.fromCharCode(code);
      for (const text of [`${character}label`, `label${character}`, `left${character}right`]) {
        expect(normalizeFeedDefinition(definition({ name: text }))).toBeUndefined();
        expect(normalizeFeedDefinition(definition({ filters: { ...definition().filters, includeWords: [text] } }))).toBeUndefined();
        expect(normalizeFeedDefinition(definition({ filters: { ...definition().filters, excludeWords: [text] } }))).toBeUndefined();
      }
    }
  });

  it('accepts printable ASCII boundaries and Unicode outside the ASCII control range', () => {
    const text = ' ~\u0080\u009fCafé 東京 🙂 ';
    const feed = definition({ name: text, filters: { includeWords: [text], excludeWords: [text], hideReplies: false, imagesOnly: false } });
    expect(normalizeFeedDefinition(feed)).toEqual(definition({ name: text.trim(), filters: { ...feed.filters, includeWords: [text.trim()], excludeWords: [text.trim()] } }));
  });

  it('round-trips Unicode recipes as bounded canonical UTF-8 base64url and shares only allowed fields', () => {
    const feed = definition({ name: 'Café 東京 🙂', sources: [{ kind: 'following', fid: 99 }, { kind: 'channel', channel: 'art' }], filters: { includeWords: ['日本語', 'café'], excludeWords: ['spam'], hideReplies: true, imagesOnly: false } });
    const token = encodeFeed({ ...feed, privateKey: 'secret' } as FeedDefinition);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); expect(token.length).toBeLessThanOrEqual(CUSTOM_FEED_TOKEN_LIMIT); expect(decodeFeed(token)).toEqual(feed);
    expect(JSON.stringify(decodeFeed(token))).not.toContain('secret');
  });

  it('rejects corrupt, noncanonical, non-UTF8 and oversized tokens or unsupported versions', () => {
    const token = encodeFeed(definition());
    for (const invalid of ['', 'a', token + '=', token + '!', 'x'.repeat(CUSTOM_FEED_TOKEN_LIMIT + 1), '_w', rawToken({ ...definition(), version: 2 }), btoa('not json')]) expect(decodeFeed(invalid)).toBeUndefined();
    const oversized = definition({ name: '界'.repeat(64), sources: Array.from({ length: 8 }, (_, index) => ({ kind: 'channel', channel: `${index}${'a'.repeat(63)}` })), filters: { includeWords: Array.from({ length: 10 }, (_, index) => `${index}${'界'.repeat(63)}`), excludeWords: Array.from({ length: 10 }, (_, index) => `${index}${'字'.repeat(63)}`), hideReplies: false, imagesOnly: false } });
    expect(normalizeFeedDefinition(oversized)).toBeUndefined();
    expect(() => encodeFeed(oversized)).toThrow('valid feed');
  });

  it('matches any included phrase and rejects any excluded phrase literally, case-insensitively and with Unicode normalization', () => {
    const feed = definition({ filters: { includeWords: ['café', 'a+b'], excludeWords: ['blocked'], hideReplies: false, imagesOnly: false } });
    expect(feedMatches(cast(1, { text: 'Enjoy CAFE\u0301' }), feed)).toBe(true);
    expect(feedMatches(cast(1, { text: 'a+b is literal' }), feed)).toBe(true);
    expect(feedMatches(cast(1, { text: 'aaab' }), feed)).toBe(false);
    expect(feedMatches(cast(1, { text: 'Café BLOCKED' }), feed)).toBe(false);
    expect(feedMatches(cast(1, { text: '', author: { ...cast(1).author, username: 'café' } }), feed)).toBe(false);
  });

  it('can remove replies while retaining channel roots, and images-only uses supported image embeds rather than quote contents', () => {
    const feed = definition({ filters: { includeWords: [], excludeWords: [], hideReplies: true, imagesOnly: true } });
    const image = cast(1, { embeds: [{ url: 'https://example.com/photo.PNG?size=large' }], parent_url: 'https://example.com/channel' });
    expect(feedMatches(image, feed)).toBe(true);
    expect(feedMatches({ ...image, parent_hash: cast(2).hash }, feed)).toBe(false);
    expect(feedMatches(cast(1, { embeds: [{ cast_id: { fid: 2, hash: cast(2).hash } }] }), feed)).toBe(false);
    expect(feedMatches(cast(1, { embeds: [{ url: 'http://example.com/photo.png' }] }), feed)).toBe(false);
    expect(feedMatches(cast(1, { embeds: [{ url: `https://opencaster.org/media/${'a'.repeat(64)}` }] }), feed)).toBe(true);
  });

  it('deduplicates normalized hashes in first-source order and sorts only loaded timestamps without changing inputs', () => {
    const first = cast(1), second = cast(2), duplicate = { ...first, hash: first.hash.slice(2).toUpperCase() };
    const loaded = [first, second, duplicate];
    expect(orderFeedCasts(loaded, definition())).toEqual([first, second]);
    expect(orderFeedCasts(loaded, definition({ order: 'newest' }))).toEqual([second, first]);
    expect(loaded).toEqual([first, second, duplicate]);
  });
});

describe('browser-local saved feeds', () => {
  it('creates separate stable IDs, defaults unpinned and writes only whitelisted versioned recipes', () => {
    const store = storage(), first = newSavedFeed(definition()), second = newSavedFeed(definition());
    expect(first.id).not.toBe(second.id); expect(first.pinned).toBe(false);
    expect(writeSavedFeeds([{ ...first, pinned: true, privateKey: 'never-save' } as typeof first, second], store)).toBe(true);
    expect(readSavedFeeds(store)).toEqual([{ ...first, pinned: true }, second]);
    expect(store.getItem(SAVED_FEED_STORAGE_KEY)).not.toContain('never-save');
  });

  it('preserves saved data on invalid writes, duplicate IDs, limits and storage failure', () => {
    const store = storage(), first = newSavedFeed(definition()); writeSavedFeeds([first], store);
    const before = store.getItem(SAVED_FEED_STORAGE_KEY);
    expect(writeSavedFeeds([first, first], store)).toBe(false);
    expect(writeSavedFeeds([{ ...first, definition: { ...first.definition, sources: [] } }], store)).toBe(false);
    expect(writeSavedFeeds(Array.from({ length: SAVED_FEED_LIMIT + 1 }, () => newSavedFeed(definition())), store)).toBe(false);
    expect(writeSavedFeeds([], { setItem: () => { throw new Error('quota'); } })).toBe(false);
    expect(store.getItem(SAVED_FEED_STORAGE_KEY)).toBe(before);
    expect(writeSavedFeeds([], store)).toBe(true); expect(readSavedFeeds(store)).toEqual([]);
  });

  it('ignores malformed, oversized and unknown-version storage, and retains valid independent records', () => {
    const store = storage(), first = newSavedFeed(definition());
    for (const raw of ['{broken', 'null', ' '.repeat(256 * 1024 + 1), JSON.stringify({ version: 2, feeds: [first] })]) { store.setItem(SAVED_FEED_STORAGE_KEY, raw); expect(readSavedFeeds(store)).toEqual([]); }
    store.setItem(SAVED_FEED_STORAGE_KEY, JSON.stringify({ version: 1, feeds: [{}, first, first, { ...first, id: 'invalid/id' }] }));
    expect(readSavedFeeds(store)).toEqual([first]);
    expect(readSavedFeeds({ getItem: () => { throw new Error('denied'); } })).toEqual([]);
  });
});
