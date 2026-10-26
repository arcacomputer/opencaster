import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadShareData } from './shareData';
import type { AppRoute } from '../src/lib/navigation';
import { encodeFeed, type FeedDefinition } from '../src/lib/customFeeds';
import { ORIGIN_TOKEN_HEADER } from './upstream';

const PREFIX = '0xcfd6d3c3';
const HASH = `${PREFIX}${'1'.repeat(32)}`;
const HASH2 = `${PREFIX}${'2'.repeat(32)}`;
const OTHER_HASH = `0x${'a'.repeat(40)}`;
const user = { fid: 10, username: 'alice', display_name: 'Alice Example', pfp_url: 'https://images.example/alice.png', profile: { bio: { text: 'A public profile.' } }, follower_count: 12, following_count: 7, custody_address: 'must-never-return', verified_addresses: { eth_addresses: ['must-never-return'] }, viewer_context: { following: true } };
const cast = { hash: HASH, author: user, text: 'A synthetic public cast.', timestamp: '2026-10-25T10:00:00Z', embeds: [] };
const profileRoute: AppRoute = { kind: 'profile', identifier: '10' };
const castRoute: AppRoute = { kind: 'cast', hash: HASH };
const aliasRoute: AppRoute = { kind: 'cast-alias', authorIdentifier: 'alice', hashPrefix: PREFIX };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const feedDefinition = (extra: Partial<FeedDefinition> = {}): FeedDefinition => ({ version: 1, name: 'Builders', sources: [{ kind: 'trending', timeWindow: '24h' }], order: 'source', filters: { includeWords: [], excludeWords: [], hideReplies: false, imagesOnly: false }, ...extra });
const rawFeedToken = (value: unknown) => btoa(Array.from(new TextEncoder().encode(JSON.stringify(value)), byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const receipt = (n: number, hash = HASH, fid = 10) => ({ hash, data: { fid, timestamp: 180000000 - n, network: 'FARCASTER_NETWORK_MAINNET', type: 'MESSAGE_TYPE_CAST_ADD', castAddBody: { text: 'Historical text must not become card text.' } } });
function tokenFor(message: ReturnType<typeof receipt>, overrides: { root?: number; fid?: number; postfix?: number } = {}) {
  const bytes = new Uint8Array(30); const view = new DataView(bytes.buffer);
  bytes[0] = overrides.root ?? 3; view.setUint32(1, overrides.fid ?? message.data.fid); bytes[5] = overrides.postfix ?? 1; view.setUint32(6, message.data.timestamp);
  bytes.set(Uint8Array.from(message.hash.slice(2).match(/../g)!, hex => parseInt(hex, 16)), 10);
  return btoa(String.fromCharCode(...bytes));
}
function install(history: unknown[] = [], hydrated: unknown = cast, author: unknown = user) {
  const pages = [...history];
  const fetch = vi.fn(async (destination: string, init: RequestInit) => {
    const url = new URL(destination);
    expect(url.origin).toBe('https://haatz.quilibrium.com'); expect(init.method).toBe('GET'); expect(init.body).toBeUndefined();
    expect(init.redirect).toBe('manual'); expect(init.credentials).toBe('omit'); expect(init.cache).toBe('no-store');
    if (url.pathname.includes('/user')) return json({ user: author });
    if (url.pathname === '/v1/fidByName') return json({ fid: 10 });
    if (url.pathname === '/v1/castsByFid') {
      expect(url.searchParams.get('fid')).toBe('10'); expect(url.searchParams.get('pageSize')).toBe('250'); expect(url.searchParams.get('reverse')).toBe('true');
      if (!pages.length) throw new Error('Unexpected history page');
      return json(pages.shift());
    }
    if (url.pathname === '/v2/farcaster/cast') return json({ cast: hydrated });
    throw new Error(`Unexpected public read ${url.pathname}`);
  });
  vi.stubGlobal('fetch', fetch); return fetch;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('public sharing profile data', () => {
  it('does not contact upstream for nonpublic routes, own-profile route or malformed identifiers', async () => {
    const fetch = install();
    for (const route of [{ kind: 'discover' }, { kind: 'search', query: 'alice', searchKind: 'users' }, { kind: 'connect' }, { kind: 'profile' },
      ...['0', '4294967296', '../alice', 'a%2fb', '.', '..', 'https://evil.example', 'a@evil.example'].map(identifier => ({ kind: 'profile', identifier }))] as AppRoute[]) {
      expect(await loadShareData(route, {})).toBeUndefined();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns only sanitized public display fields for the exact stable FID', async () => {
    const fetch = install([], cast, { ...user, display_name: ' Alice\u202e\u0000 Example ', profile: { bio: { text: ' A\npublic\tprofile. ' } } });
    expect(await loadShareData(profileRoute, {})).toEqual({ kind: 'profile', profile: { fid: 10, username: 'alice', displayName: 'Alice Example', bio: 'A public profile.', avatarUrl: user.pfp_url, followers: 12, following: 7 } });
    expect(fetch.mock.calls[0][0]).toBe('https://haatz.quilibrium.com/v2/farcaster/user?fid=10');
    expect(JSON.stringify(await loadShareData(profileRoute, {}))).not.toContain('must-never-return');
  });
  it('supports exact username aliases and rejects a different profile returned by the node', async () => {
    const fetch = install();
    expect(await loadShareData({ kind: 'profile', identifier: 'ALICE' }, {})).toMatchObject({ kind: 'profile', profile: { fid: 10, username: 'alice' } });
    expect(fetch.mock.calls[0][0]).toContain('/by-username?username=alice');
    install([], cast, { ...user, username: 'bob' });
    expect(await loadShareData({ kind: 'profile', identifier: 'alice' }, {})).toBeUndefined();
    install([], cast, { ...user, fid: 11 });
    expect(await loadShareData(profileRoute, {})).toBeUndefined();
  });
  it.each([['DWR.ETH', 'dwr.eth', 'ens'], ['jesse.base.eth', 'jesse.base.eth', 'basename']])('resolves native name proof %s and validates its exact FID', async (identifier, name, type) => {
    const fetch = install();
    expect(await loadShareData({ kind: 'profile', identifier }, {})).toMatchObject({ kind: 'profile', profile: { fid: 10, username: 'alice' } });
    expect(fetch.mock.calls.map(call => call[0])).toEqual([`https://haatz.quilibrium.com/v1/fidByName?name=${name}&type=${type}`, 'https://haatz.quilibrium.com/v2/farcaster/user?fid=10']);
  });
  it.each([0, -1, 4294967296, '10', null])('rejects an invalid name proof FID %j', async fid => {
    const fetch = vi.fn().mockResolvedValue(json({ fid })); vi.stubGlobal('fetch', fetch);
    expect(await loadShareData({ kind: 'profile', identifier: 'alice.eth' }, {})).toBeUndefined(); expect(fetch).toHaveBeenCalledOnce();
  });
  it('rejects an unrelated profile after name-proof resolution and unsupported ENS forms before reads', async () => {
    install([], cast, { ...user, fid: 11 });
    expect(await loadShareData({ kind: 'profile', identifier: 'alice.eth' }, {})).toBeUndefined();
    const fetch = install();
    for (const identifier of ['sub.alice.eth', 'al_ice.eth', 'a'.repeat(17) + '.eth']) expect(await loadShareData({ kind: 'profile', identifier }, {})).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('provides honest display defaults and drops malformed counters, unsafe avatar URLs and optional fields', async () => {
    install([], cast, { fid: 10, username: '', follower_count: -1, following_count: Infinity, pfp_url: 'https://user:pass@images.example/p.png' });
    expect(await loadShareData(profileRoute, {})).toEqual({ kind: 'profile', profile: { fid: 10, username: '', displayName: 'FID 10', bio: '' } });
    for (const pfp_url of ['javascript:alert(1)', 'http://images.example/p.png', 'https://images.example/a\\b', 'https://images.example/a b']) {
      install([], cast, { ...user, pfp_url });
      const result = await loadShareData(profileRoute, {});
      expect(result?.kind === 'profile' ? result.profile.avatarUrl : undefined).toBeUndefined();
    }
  });
  it('bounds text by Unicode characters without splitting a surrogate pair', async () => {
    install([], cast, { ...user, display_name: '🙂'.repeat(100), profile: { bio: { text: '🙂'.repeat(600) } } });
    const result = await loadShareData(profileRoute, {});
    if (result?.kind !== 'profile') throw new Error('Expected public profile data');
    expect(result.profile.displayName).toBe('🙂'.repeat(80)); expect(result.profile.bio).toBe('🙂'.repeat(500));
  });
  it('normalizes only an exact FID-bound native username sentinel', async () => {
    install([], cast, { ...user, username: 'fid:10', display_name: undefined });
    expect(await loadShareData(profileRoute, {})).toMatchObject({ kind: 'profile', profile: { fid: 10, username: '', displayName: 'FID 10' } });
    for (const username of ['fid:11', 'fid:010', 'FID:10']) {
      install([], cast, { ...user, username }); expect(await loadShareData(profileRoute, {})).toBeUndefined();
    }
  });
});

describe('public sharing channel data', () => {
  const channel = { id: 'builders', name: 'Builders', description: 'A channel for public projects.', image_url: 'https://images.example/builders.png', member_count: 17, follower_count: 999,
    url: 'https://untrusted.example/channel/builders', viewer_context: { following: true }, privateKey: 'must-never-return' };
  const route: AppRoute = { kind: 'channel', channel: 'builders' };
  function installChannel(value: unknown = channel, status = 200) {
    const fetch = vi.fn().mockResolvedValue(json({ channel: value }, status));
    vi.stubGlobal('fetch', fetch); return fetch;
  }
  it('reads the fixed public channel endpoint and returns only exact-bound sanitized display fields', async () => {
    const fetch = installChannel({ ...channel, name: ' Builders\u202e\u0000 Club ', description: ' Public\nprojects\tand\r\npeople. ' });
    expect(await loadShareData(route, {})).toEqual({ kind: 'channel', channel: { id: 'builders', name: 'Builders Club', description: 'Public projects and people.', imageUrl: channel.image_url, members: 17 } });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe('https://haatz.quilibrium.com/v2/farcaster/channel?id=builders&type=id');
    const init = fetch.mock.calls[0][1];
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'manual', cache: 'no-store' });
    expect(init.headers.get('Cookie')).toBeNull(); expect(init.headers.get('Authorization')).toBeNull();
  });
  it.each([null, {}, { ...channel, id: 'other' }, { ...channel, id: 'BUILDERS' }, { ...channel, name: null }, { ...channel, name: { value: 'Builders' } }])('rejects unrelated or malformed channel identity %j without a backup read', async value => {
    const fetch = installChannel(value);
    expect(await loadShareData(route, { HYPERSNAP_READ_FALLBACK: 'haatz-v1' })).toBeUndefined(); expect(fetch).toHaveBeenCalledOnce();
  });
  it('does not normalize channel case into a different identity', async () => {
    const fetch = installChannel({ ...channel, id: 'BuIlDeRs' });
    expect(await loadShareData({ kind: 'channel', channel: 'BuIlDeRs' }, {})).toMatchObject({ kind: 'channel', channel: { id: 'BuIlDeRs' } });
    expect(fetch.mock.calls[0][0]).toContain('id=BuIlDeRs&type=id');
  });
  it('drops malformed optional text, counters and unsafe images without promoting follower counts to participants', async () => {
    for (const member_count of [undefined, null, -1, '17', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      installChannel({ ...channel, name: '', description: { text: 'Unvalidated text' }, image_url: 'https://user:pass@images.example/builders.png', member_count });
      expect(await loadShareData(route, {})).toEqual({ kind: 'channel', channel: { id: 'builders', name: 'builders', description: '' } });
    }
    installChannel({ ...channel, member_count: 0 });
    expect(await loadShareData(route, {})).toMatchObject({ kind: 'channel', channel: { members: 0 } });
    for (const image_url of ['javascript:alert(1)', 'http://images.example/builders.png', 'https://images.example/a\\b', 'https://images.example/a b']) {
      installChannel({ ...channel, image_url });
      const result = await loadShareData(route, {});
      expect(result?.kind === 'channel' ? result.channel.imageUrl : undefined).toBeUndefined();
    }
  });
  it('bounds Unicode text and falls back when the channel is unavailable', async () => {
    installChannel({ ...channel, name: '🙂'.repeat(100), description: '🙂'.repeat(600) });
    const result = await loadShareData(route, {});
    if (result?.kind !== 'channel') throw new Error('Expected public channel data');
    expect(result.channel.name).toBe('🙂'.repeat(80)); expect(result.channel.description).toBe('🙂'.repeat(500));
    const fetch = installChannel(channel, 404);
    expect(await loadShareData(route, {})).toBeUndefined(); expect(fetch).toHaveBeenCalledOnce();
  });
  it('rejects malformed channel identifiers before a public read', async () => {
    const fetch = installChannel();
    for (const channel of ['', '../builders', 'builders%2fother', 'a.b', 'https://evil.example', 'a'.repeat(65)]) {
      expect(await loadShareData({ kind: 'channel', channel }, {})).toBeUndefined();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('public sharing custom feed data', () => {
  it('describes all public source kinds and rules without network calls or browser storage', async () => {
    const fetch = vi.fn(() => { throw new Error('Feed descriptions must not contact upstream'); }); vi.stubGlobal('fetch', fetch);
    const getItem = vi.fn(() => { throw new Error('Feed descriptions must not read saved browser data'); }); vi.stubGlobal('localStorage', { getItem });
    const definition = feedDefinition({ sources: [{ kind: 'user', fid: 10 }, { kind: 'following', fid: 20 }, { kind: 'channel', channel: 'build' }, { kind: 'trending', timeWindow: '7d' }], order: 'newest', filters: { includeWords: ['open source', 'art'], excludeWords: ['spoilers', 'giveaways'], imagesOnly: true, hideReplies: true } });
    expect(await loadShareData({ kind: 'feed', token: encodeFeed(definition) }, { HYPERSNAP_ORIGIN: 'invalid-private-configuration' })).toEqual({ kind: 'feed', feed: {
      name: 'Builders', sources: ['Account FID 10', 'Public following of FID 20', 'Channel /build', 'Trending · 7d'],
      rules: ['Newest loaded first', 'Includes any phrase: “open source”, “art”', 'Excludes any phrase: “spoilers”, “giveaways”', 'Images only', 'Replies hidden'], sourceCount: 4, definition,
    } });
    expect(fetch).not.toHaveBeenCalled(); expect(getItem).not.toHaveBeenCalled();
  });
  it('rebuilds a canonical public definition, deduplicating sources and phrases without retaining local state', async () => {
    const input = { ...feedDefinition({ name: '  Café 東京  ', sources: [{ kind: 'channel', channel: 'art' }, { kind: 'user', fid: 10 }, { kind: 'channel', channel: 'art' }] }),
      filters: { includeWords: [' Café ', 'CAFE\u0301'], excludeWords: [], imagesOnly: false, hideReplies: false, privateFilter: 'must-never-return' },
      id: 'local-feed-id', pinned: true, privateKey: 'must-never-return', session: { fid: 999 } };
    const token = rawFeedToken(input);
    const result = await loadShareData({ kind: 'feed', token }, {});
    if (result?.kind !== 'feed') throw new Error('Expected public feed data');
    const definition = feedDefinition({ name: 'Café 東京', sources: [{ kind: 'channel', channel: 'art' }, { kind: 'user', fid: 10 }], filters: { includeWords: ['Café'], excludeWords: [], imagesOnly: false, hideReplies: false } });
    expect(result.feed).toEqual({ name: 'Café 東京', sources: ['Channel /art', 'Account FID 10'], rules: ['Source order (as loaded)', 'Includes any phrase: “Café”'], sourceCount: 2, definition });
    expect(encodeFeed(result.feed.definition)).toBe(encodeFeed(definition)); expect(encodeFeed(result.feed.definition)).not.toBe(token);
    expect(JSON.stringify(result)).not.toMatch(/must-never-return|local-feed-id|pinned|session/);
  });
  it('keeps every phrase rule while sanitizing hostile public display text', async () => {
    const includeWords = Array.from({ length: 10 }, (_, n) => `<include${n}>&`);
    const excludeWords = Array.from({ length: 10 }, (_, n) => `<exclude${n}>&`);
    includeWords[0] = '<script>\u202ealert(1)</script>';
    const definition = feedDefinition({ name: '  <Feed> & \u202e art  ', filters: { includeWords, excludeWords, imagesOnly: false, hideReplies: false } });
    const result = await loadShareData({ kind: 'feed', token: encodeFeed(definition) }, {});
    if (result?.kind !== 'feed') throw new Error('Expected public feed data');
    expect(result.feed.name).toBe('<Feed> & art');
    expect(result.feed.rules).toHaveLength(3); expect(result.feed.rules.join(' ')).not.toContain('\u202e');
    expect(result.feed.rules[1]).toBe(`Includes any phrase: ${includeWords.map(phrase => `“${phrase.replace('\u202e', ' ')}”`).join(', ')}`);
    for (const phrase of excludeWords) expect(result.feed.rules[2]).toContain(phrase);
    expect(result.feed.definition.filters.includeWords).toEqual(includeWords);
  });
  it('preserves ordinary internal spaces in literal phrase rules', async () => {
    const definition = feedDefinition({ filters: { includeWords: ['hello  world'], excludeWords: ['three   spaces'], imagesOnly: false, hideReplies: false } });
    const result = await loadShareData({ kind: 'feed', token: encodeFeed(definition) }, {});
    expect(result).toMatchObject({ kind: 'feed', feed: { rules: ['Source order (as loaded)', 'Includes any phrase: “hello  world”', 'Excludes any phrase: “three   spaces”'] } });
  });
  it('rejects malformed, noncanonical and invalid feed tokens before any upstream read', async () => {
    const fetch = install();
    const token = encodeFeed(feedDefinition());
    for (const value of ['', 'A', '!!!!', `${token}=`, `${token}\n`, 'x'.repeat(6001), rawFeedToken({ ...feedDefinition(), version: 2 }), rawFeedToken({ ...feedDefinition(), sources: [] }), rawFeedToken({ ...feedDefinition(), name: '\u0000bad' })]) {
      expect(await loadShareData({ kind: 'feed', token: value }, {})).toBeUndefined();
    }
    const padded = token.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - token.length % 4) % 4);
    const withWhitespace = btoa(` ${atob(padded)}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await loadShareData({ kind: 'feed', token: withWhitespace }, {})).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('honors caller cancellation for a local public feed definition', async () => {
    const fetch = install(); const controller = new AbortController(); controller.abort();
    expect(await loadShareData({ kind: 'feed', token: encodeFeed(feedDefinition()) }, {}, controller.signal)).toBeUndefined(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe('public sharing cast data', () => {
  it('uses the exact full hash and returns the current cast, never historical text', async () => {
    const fetch = install();
    expect(await loadShareData(castRoute, {})).toMatchObject({ kind: 'cast', hash: HASH, text: cast.text, timestamp: '2026-10-25T10:00:00.000Z', profile: { fid: 10 } });
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][0]).toBe(`https://haatz.quilibrium.com/v2/farcaster/cast?identifier=${HASH.slice(2)}&type=hash`);
  });
  it('resolves full-hash author aliases independently without using history', async () => {
    const fetch = install();
    expect(await loadShareData({ ...aliasRoute, hashPrefix: HASH }, {})).toMatchObject({ kind: 'cast', hash: HASH });
    expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls[1][0]).toContain(`identifier=${HASH.slice(2)}&type=hash&fid=10`);
  });
  it('uses one exact cast read for a known numeric FID/full-hash alias without a separate profile lookup', async () => {
    const fetch = install();
    expect(await loadShareData({ kind: 'cast-alias', authorIdentifier: '10', hashPrefix: HASH }, {})).toMatchObject({ kind: 'cast', hash: HASH, text: cast.text, profile: { fid: 10, username: 'alice', displayName: user.display_name } });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe(`https://haatz.quilibrium.com/v2/farcaster/cast?identifier=${HASH.slice(2)}&type=hash&fid=10`);
  });
  it('independently rejects a different returned author for a numeric FID/full-hash alias', async () => {
    const fetch = install([], { ...cast, author: { ...user, fid: 11 } });
    expect(await loadShareData({ kind: 'cast-alias', authorIdentifier: '10', hashPrefix: HASH }, {})).toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][0]).toContain('&fid=10');
  });
  it('rejects invalid numeric full-hash alias FIDs before any read', async () => {
    const fetch = install();
    for (const authorIdentifier of ['0', '4294967296', '99999999999999999999']) {
      expect(await loadShareData({ kind: 'cast-alias', authorIdentifier, hashPrefix: HASH }, {})).toBeUndefined();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps at most two sanitized HTTPS embed URLs without fetching those URLs', async () => {
    const fetch = install([], { ...cast, embeds: [{ url: 'javascript:alert(1)' }, { url: 'https://images.example/a.png' }, { cast_id: { fid: 11, hash: HASH2 } }, { url: 'https://images.example/b.png' }, { url: 'https://images.example/c.png' }] });
    expect(await loadShareData(castRoute, {})).toMatchObject({ kind: 'cast', imageUrls: ['https://images.example/a.png', 'https://images.example/b.png'] }); expect(fetch).toHaveBeenCalledOnce();
  });
  it('reconstructs validated protocol mentions at UTF-8 byte boundaries before sanitizing text', async () => {
    install([], { ...cast, text: '🌈 , 你好 !', mentioned_profiles: [{ fid: 123, username: 'alice' }, { fid: 456, username: 'bob.eth' }], mentioned_profiles_ranges: [{ start: 5, end: 5 }, { start: 14, end: 14 }] });
    expect(await loadShareData(castRoute, {})).toMatchObject({ kind: 'cast', text: '🌈 @alice, 你好 @bob.eth!' });
  });
  it('preserves mention-only casts and mentions without available usernames', async () => {
    install([], { ...cast, text: '', mentioned_profiles: [{ fid: 123, username: '' }], mentioned_profiles_ranges: [{ start: 0, end: 0 }] });
    expect(await loadShareData(castRoute, {})).toMatchObject({ kind: 'cast', text: '@123' });
  });
  it.each([
    { mentioned_profiles: [{ fid: 123, username: 'alice' }], mentioned_profiles_ranges: [{ start: 1, end: 1 }] },
    { mentioned_profiles: [{ fid: 123, username: '<forged>' }], mentioned_profiles_ranges: [{ start: 0, end: 0 }] },
    { mentioned_profiles: [{ fid: 123, username: 'alice' }], mentioned_profiles_ranges: [{ start: 99, end: 99 }] },
    { mentioned_profiles: [{ fid: 123, username: 'alice' }], mentioned_profiles_ranges: [] },
  ])('falls back to complete raw text for invalid mention metadata %j', async mentions => {
    install([], { ...cast, text: '🌈 hi!', ...mentions });
    expect(await loadShareData(castRoute, {})).toMatchObject({ kind: 'cast', text: '🌈 hi!' });
  });
  it('preserves paragraph breaks and emoji joiners while removing controls in cast text', async () => {
    install([], { ...cast, text: ' First\u0000 paragraph\r\n\r\nSecond\tparagraph 👨‍👩‍👧‍👦.\u202e ' });
    expect(await loadShareData(castRoute, {})).toMatchObject({ kind: 'cast', text: 'First paragraph\n\nSecond paragraph 👨‍👩‍👧‍👦.' });
  });
  it('bounds raw protocol text before building mention UTF-8 index maps', async () => {
    install([], { ...cast, text: 'x'.repeat(16_385), mentioned_profiles: [{ fid: 123, username: 'alice' }], mentioned_profiles_ranges: [{ start: 0, end: 0 }] });
    expect(await loadShareData(castRoute, {})).toBeUndefined();
  });
  it('supports casts from authors with an exact FID-bound unavailable username', async () => {
    install([], { ...cast, author: { ...user, username: 'fid:10', display_name: undefined } });
    expect(await loadShareData(castRoute, {})).toMatchObject({ kind: 'cast', profile: { fid: 10, username: '', displayName: 'FID 10' } });
  });
  it.each([{ hash: HASH2 }, { text: null }, { timestamp: 'bad' }, { embeds: null }, { author: { ...user, fid: 0 } }])('rejects malformed or mismatched canonical cast data %j', async changes => {
    install([], { ...cast, ...changes }); expect(await loadShareData(castRoute, {})).toBeUndefined();
  });
  it('rejects an author/hash mismatch after independently resolving an alias', async () => {
    install([], { ...cast, author: { ...user, fid: 11 } });
    expect(await loadShareData({ ...aliasRoute, hashPrefix: HASH }, {})).toBeUndefined();
  });
  it('rejects short hashes in a full-hash route and malformed aliases before reads', async () => {
    const fetch = install();
    for (const route of [{ kind: 'cast', hash: PREFIX }, { ...aliasRoute, hashPrefix: '0x1234' }, { ...aliasRoute, hashPrefix: '0x123456789' }, { ...aliasRoute, authorIdentifier: '../alice' }] as AppRoute[]) expect(await loadShareData(route, {})).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('verifies a unique observed short-link match by exact author and full hash', async () => {
    const fetch = install([{ messages: [receipt(1), receipt(2, OTHER_HASH)] }]);
    expect(await loadShareData(aliasRoute, {})).toMatchObject({ kind: 'cast', hash: HASH, text: cast.text });
    expect(fetch).toHaveBeenCalledTimes(3); expect(fetch.mock.calls[2][0]).toContain(`identifier=${HASH.slice(2)}&type=hash&fid=10`);
  });
  it('checks both bounded pages before using a match and sends only a validated native cursor', async () => {
    const first = receipt(1); const token = tokenFor(first);
    const fetch = install([{ messages: [first], nextPageToken: token }, { messages: [receipt(2, OTHER_HASH)] }]);
    expect(await loadShareData(aliasRoute, {})).toMatchObject({ kind: 'cast', hash: HASH });
    expect(fetch).toHaveBeenCalledTimes(4); expect(fetch.mock.calls[2][0]).toContain(`pageToken=${encodeURIComponent(token)}`);
  });
  it('limits short links to two pages even when available history continues, without claiming exhaustiveness', async () => {
    const first = receipt(1); const second = receipt(2, OTHER_HASH);
    const fetch = install([{ messages: [first], nextPageToken: tokenFor(first) }, { messages: [second], nextPageToken: tokenFor(second) }]);
    expect(await loadShareData(aliasRoute, {})).toMatchObject({ kind: 'cast', hash: HASH });
    expect(fetch.mock.calls.filter(([url]) => url.includes('/castsByFid?'))).toHaveLength(2);
  });
  it('falls back on an observed prefix collision, unavailable exact cast or no observed candidate', async () => {
    for (const pages of [[{ messages: [receipt(1), receipt(2, HASH2)] }], [{ messages: [receipt(1)], nextPageToken: tokenFor(receipt(1)) }, { messages: [receipt(2, HASH2)] }], [{ messages: [receipt(1, OTHER_HASH)] }]]) {
      const fetch = install(pages); expect(await loadShareData(aliasRoute, {})).toBeUndefined(); expect(fetch.mock.calls.some(([url]) => url.includes('/cast?'))).toBe(false);
    }
    const fetch = install([{ messages: [receipt(1)] }], { ...cast, author: { ...user, fid: 11 } });
    expect(await loadShareData(aliasRoute, {})).toBeUndefined(); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it.each([
    { messages: null }, { messages: Array.from({ length: 251 }, (_, n) => receipt(n)) },
    { messages: [{ ...receipt(1), data: { ...receipt(1).data, fid: 11 } }] },
    { messages: [{ ...receipt(1), data: { ...receipt(1).data, network: 'FARCASTER_NETWORK_TESTNET' } }] },
    { messages: [{ ...receipt(1), data: { ...receipt(1).data, timestamp: -1 } }] },
    { messages: [{ ...receipt(1), data: { ...receipt(1).data, castAddBody: null } }] },
    { messages: [receipt(2), receipt(1)] }, { messages: [receipt(1), receipt(1)] },
    { messages: [receipt(1)], nextPageToken: null }, { messages: [receipt(1)], nextPageToken: 'Zh==' },
    { messages: [receipt(1)], nextPageToken: tokenFor(receipt(1), { root: 30 }) },
    { messages: [receipt(1)], nextPageToken: tokenFor(receipt(1), { fid: 11 }) },
    { messages: [receipt(1)], nextPageToken: tokenFor(receipt(1), { postfix: 2 }) },
    { messages: [receipt(1)], nextPageToken: tokenFor(receipt(2)) },
    { messages: [], nextPageToken: tokenFor(receipt(1)) },
  ])('rejects malformed, unrelated or unordered native history %j', async page => {
    const fetch = install([page]); expect(await loadShareData(aliasRoute, {})).toBeUndefined(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects a page that does not descend below the exclusive incoming cursor', async () => {
    install([{ messages: [receipt(1)], nextPageToken: tokenFor(receipt(1)) }, { messages: [receipt(1)] }]);
    expect(await loadShareData(aliasRoute, {})).toBeUndefined();
  });
  it('accepts valid remove receipts without treating the remove message hash as a cast', async () => {
    const remove = { hash: HASH2, data: { fid: 10, timestamp: receipt(2).data.timestamp, network: 'FARCASTER_NETWORK_MAINNET', type: 'MESSAGE_TYPE_CAST_REMOVE', castRemoveBody: { targetHash: HASH } } };
    install([{ messages: [receipt(1), remove] }]); expect(await loadShareData(aliasRoute, {})).toMatchObject({ kind: 'cast', hash: HASH });
  });
});

describe('bounded sharing upstream reads', () => {
  const token = 'synthetic_private_origin_token_1234567890';
  const env = { HYPERSNAP_ORIGIN: 'https://node.example', HYPERSNAP_ORIGIN_TOKEN: token, HYPERSNAP_READ_FALLBACK: 'haatz-v1' };
  it('uses only configured fixed hosts and strips the private credential on backup', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({ user })); vi.stubGlobal('fetch', fetch);
    expect(await loadShareData(profileRoute, env)).toMatchObject({ kind: 'profile' }); expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe('https://node.example/v2/farcaster/user?fid=10'); expect(fetch.mock.calls[0][1].headers.get(ORIGIN_TOKEN_HEADER)).toBe(token);
    expect(fetch.mock.calls[1][0]).toBe('https://haatz.quilibrium.com/v2/farcaster/user?fid=10'); expect(fetch.mock.calls[1][1].headers.get(ORIGIN_TOKEN_HEADER)).toBeNull();
    for (const [, init] of fetch.mock.calls) { expect(init.credentials).toBe('omit'); expect(init.redirect).toBe('manual'); expect(init.headers.get('Cookie')).toBeNull(); expect(init.headers.get('Authorization')).toBeNull(); }
  });
  it('retries a transport failure once but never enables an unconfigured backup', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Unavailable')).mockResolvedValueOnce(json({ user })); vi.stubGlobal('fetch', fetch);
    expect(await loadShareData(profileRoute, env)).toMatchObject({ kind: 'profile' }); expect(fetch).toHaveBeenCalledTimes(2);
    const noBackup = vi.fn().mockResolvedValue(json({}, 503)); vi.stubGlobal('fetch', noBackup);
    expect(await loadShareData(profileRoute, { ...env, HYPERSNAP_READ_FALLBACK: 'https://attacker.example' })).toBeUndefined(); expect(noBackup).toHaveBeenCalledOnce();
  });
  it.each([301, 302, 400, 401, 403, 404, 429])('does not replay HTTP %i failures against backup or follow redirects', async status => {
    const fetch = vi.fn().mockResolvedValue(json({}, status)); vi.stubGlobal('fetch', fetch);
    expect(await loadShareData(profileRoute, env)).toBeUndefined(); expect(fetch).toHaveBeenCalledOnce();
  });
  it('fails closed on incomplete or invalid private configuration before any fetch', async () => {
    const fetch = install();
    for (const invalid of [{ ...env, HYPERSNAP_ORIGIN_TOKEN: undefined }, { ...env, HYPERSNAP_ORIGIN: 'https://user:pass@evil.example' }, { ...env, HYPERSNAP_ORIGIN: 'https://node.example/path' }]) expect(await loadShareData(profileRoute, invalid)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects reflected credentials, malformed JSON and incorrect successful bodies without backup', async () => {
    for (const body of [{ user, debug: token }, [], null, { user: { ...user, fid: 0 } }]) {
      const fetch = vi.fn().mockResolvedValue(json(body)); vi.stubGlobal('fetch', fetch);
      expect(await loadShareData(profileRoute, env)).toBeUndefined(); expect(fetch).toHaveBeenCalledOnce();
    }
    const fetch = vi.fn().mockResolvedValue(new Response('{broken', { headers: { 'Content-Type': 'application/json' } })); vi.stubGlobal('fetch', fetch);
    expect(await loadShareData(profileRoute, env)).toBeUndefined(); expect(fetch).toHaveBeenCalledOnce();
  });
  it('bounds declared and streamed JSON to one MiB, without reading HTML responses', async () => {
    for (const response of [new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(1024 * 1024 + 1) } }),
      new Response(JSON.stringify({ user, oversized: 'x'.repeat(1024 * 1024) }), { headers: { 'Content-Type': 'application/json' } }),
      new Response('<html>not JSON</html>', { headers: { 'Content-Type': 'text/html' } })]) {
      const fetch = vi.fn().mockResolvedValue(response); vi.stubGlobal('fetch', fetch);
      expect(await loadShareData(profileRoute, env)).toBeUndefined(); expect(fetch).toHaveBeenCalledOnce();
    }
  });
  it('stops immediately for caller cancellation even when fetch ignores abort, and cancels late bodies', async () => {
    let deliver!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(resolve => { deliver = resolve; })); vi.stubGlobal('fetch', fetch);
    const controller = new AbortController(); const pending = loadShareData(profileRoute, env, controller.signal);
    controller.abort(); expect(await pending).toBeUndefined(); expect(fetch).toHaveBeenCalledOnce();
    const cancel = vi.fn(); deliver(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'application/json' } }));
    await Promise.resolve(); await Promise.resolve(); expect(cancel).toHaveBeenCalledOnce();
    expect(await loadShareData(profileRoute, env, controller.signal)).toBeUndefined(); expect(fetch).toHaveBeenCalledOnce();
  });
  it('bounds an abort-ignoring fetch attempt and can try the fixed read backup', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(json({ user })); vi.stubGlobal('fetch', fetch);
    const pending = loadShareData(profileRoute, env); await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toMatchObject({ kind: 'profile' }); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('bounds an abort-ignoring response stream and cancels its reader', async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel }), { headers: { 'Content-Type': 'application/json' } })); vi.stubGlobal('fetch', fetch);
    const pending = loadShareData(profileRoute, {}); await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toBeUndefined(); expect(cancel).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
  });
  it('shares one four-second deadline across author, both history pages and exact cast hydration', async () => {
    vi.useFakeTimers(); const first = receipt(1); const second = receipt(2, OTHER_HASH);
    const responses = [json({ user }), json({ messages: [first], nextPageToken: tokenFor(first) }), json({ messages: [second], nextPageToken: tokenFor(second) }), json({ cast })];
    const fetch = vi.fn(() => new Promise<Response>(resolve => { const response = responses.shift()!; setTimeout(() => resolve(response), 1100); })); vi.stubGlobal('fetch', fetch);
    const settled = vi.fn(); const pending = loadShareData(aliasRoute, {}); void pending.then(settled);
    await vi.advanceTimersByTimeAsync(3999); expect(settled).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1); expect(await pending).toBeUndefined(); await vi.advanceTimersByTimeAsync(500); expect(fetch).toHaveBeenCalledTimes(4);
  });
});
