import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadShareData } from './shareData';
import type { AppRoute } from '../src/lib/navigation';
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
      expect((await loadShareData(profileRoute, {}))?.profile.avatarUrl).toBeUndefined();
    }
  });
  it('bounds text by Unicode characters without splitting a surrogate pair', async () => {
    install([], cast, { ...user, display_name: '🙂'.repeat(100), profile: { bio: { text: '🙂'.repeat(600) } } });
    const result = await loadShareData(profileRoute, {});
    expect(result?.profile.displayName).toBe('🙂'.repeat(80)); expect(result?.profile.bio).toBe('🙂'.repeat(500));
  });
  it('normalizes only an exact FID-bound native username sentinel', async () => {
    install([], cast, { ...user, username: 'fid:10', display_name: undefined });
    expect(await loadShareData(profileRoute, {})).toMatchObject({ kind: 'profile', profile: { fid: 10, username: '', displayName: 'FID 10' } });
    for (const username of ['fid:11', 'fid:010', 'FID:10']) {
      install([], cast, { ...user, username }); expect(await loadShareData(profileRoute, {})).toBeUndefined();
    }
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
