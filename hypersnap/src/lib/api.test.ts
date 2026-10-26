import { afterEach, describe, expect, it, vi } from 'vitest';
import { getChannel, getChannels, getConversation, getFeed, getFollows, getFollowStatus, getNotifications, getProfileFeed, getReactionStatus, getReactionStatuses, getSuggestedUsers, getChannelMembers, getCastQuotes, getCastReactionPeople, getSigners, getUser, hasImageEmbed, searchCasts, searchUsers, submitMessage, type Cast, type User, type FeedOptions } from './api';

const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const user = (fid: number): User => ({ fid, username: `alice${fid}`, custody_address: '', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 });
const cast = (letter: string, extra: Partial<Cast> = {}): Cast => ({ hash: letter.repeat(40), author: user(3), text: 'test', timestamp: '2026-10-19T12:00:00.000Z', embeds: [], reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 }, ...extra });
afterEach(() => vi.unstubAllGlobals());

describe('browser API client', () => {
  it('loads ranked public user search and drops node fid:0 placeholders', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ users: [user(0), user(3)] }));
    vi.stubGlobal('fetch', fetch);
    expect(await searchUsers({ query: ' @ali ', limit: 10 })).toEqual({ users: [user(3)] });
    expect(fetch.mock.calls[0][0]).toBe('/api/v2/farcaster/user/search?limit=10&q=%40ali');
    expect(fetch.mock.calls[0][1].credentials).toBe('omit');
  });

  it('hydrates real search metadata, deduplicates hashes and filters only verified deleted hits', async () => {
    const match = cast('a');
    const hydrated = { ...match, text: 'authoritative body', embeds: [{ cast_id: { fid: 3, hash: 'c'.repeat(40) } }], reactions: { likes_count: 7, recasts_count: 2 } };
    const fetch = vi.fn().mockResolvedValueOnce(response({ result: { casts: [match, { ...match, hash: `0x${match.hash}` }, cast('b', { author: user(0) }), cast('c')], next: { cursor: 'ignored' } } }))
      .mockResolvedValueOnce(response({ cast: hydrated }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'cast_not_found', message: 'Cast deleted' }), { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    expect(await searchCasts({ query: 'hello world', limit: 5 })).toEqual({ casts: [hydrated], next: { cursor: null } });
    expect(fetch.mock.calls[0][0]).toBe('/api/v2/farcaster/cast/search?limit=5&q=hello+world');
    expect(fetch.mock.calls[1][0]).toBe(`/api/v2/farcaster/cast?identifier=${match.hash}&type=hash`);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    { status: 404, code: 'upstream_error' }, { status: 400, code: 'cast_not_found' }, { status: 502, code: 'upstream_error' },
  ])('propagates hydration failures rather than returning misleading empty results: %j', async error => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ result: { casts: [cast('a')], next: {} } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...error, message: 'Unavailable' }), { status: error.status }));
    vi.stubGlobal('fetch', fetch);
    await expect(searchCasts({ query: 'hello' })).rejects.toMatchObject(error);
  });

  it('rejects a hydrated cast whose author or identity differs from the search hit', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ result: { casts: [cast('a')], next: {} } }))
      .mockResolvedValueOnce(response({ cast: cast('a', { author: user(4) }) }));
    vi.stubGlobal('fetch', fetch);
    await expect(searchCasts({ query: 'hello' })).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('bounds hydration to 25 casts and four concurrent reads while preserving ranking', async () => {
    const hits = Array.from({ length: 30 }, (_, index) => cast(index.toString(16).padStart(40, '0').slice(0, 1), { hash: index.toString(16).padStart(40, '0') }));
    let active = 0, maximum = 0;
    const fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/cast/search?')) return response({ result: { casts: hits, next: {} } });
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      const hash = new URL(url, 'https://quorum.arca.computer').searchParams.get('identifier');
      return response({ cast: hits.find(hit => hit.hash === hash) });
    });
    vi.stubGlobal('fetch', fetch);
    const result = await searchCasts({ query: 'hello', limit: 100 });
    expect(result.casts.map(cast => cast.hash)).toEqual(hits.slice(0, 25).map(cast => cast.hash));
    expect(maximum).toBe(4);
    expect(fetch).toHaveBeenCalledTimes(26);
    expect(fetch.mock.calls[0][0]).toContain('limit=25');
  });

  it('cancels in-flight hydration and schedules no later hits after the caller aborts', async () => {
    const hits = ['a', 'b', 'c', 'd', 'e'].map(letter => cast(letter));
    const fetch = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
      if (url.includes('/cast/search?')) return response({ result: { casts: hits, next: {} } });
      return new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    });
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const pending = searchCasts({ query: 'hello', signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
    controller.abort();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(fetch.mock.calls.slice(1).every(call => call[1].signal.aborted)).toBe(true);
  });

  it('bounds the complete search and hydration to one 25-second deadline', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
        if (url.includes('/cast/search?')) return response({ result: { casts: [cast('a')], next: {} } });
        return new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
      });
      vi.stubGlobal('fetch', fetch);
      const pending = searchCasts({ query: 'hello' });
      const assertion = expect(pending).rejects.toMatchObject({ status: 504, code: 'timeout' });
      await vi.advanceTimersByTimeAsync(25_001);
      await assertion;
    } finally { vi.useRealTimers(); }
  });

  it.each([' ', 'a\nb', '\u0000', '🙂'.repeat(65)])('rejects empty, control-containing or oversized search before fetching: %j', async query => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(searchUsers({ query })).rejects.toThrow('search query');
    await expect(searchCasts({ query })).rejects.toThrow('search query');
    await expect(getChannels({ kind: 'search', query })).rejects.toThrow('search query');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves disabled-index failures instead of showing a successful empty search', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'feature_unavailable', message: 'Cast search is not enabled on this Hypersnap node.' }), { status: 503 })));
    await expect(searchCasts({ query: 'hello' })).rejects.toMatchObject({ status: 503, code: 'feature_unavailable' });
  });

  it.each(['casts', 'replies', 'media'] as const)('returns the first %s profile page without waiting for older history', async tab => {
    const root = cast('a', { parent_url: 'https://warpcast.com/~/channel/test' });
    const reply = cast('b', { parent_hash: 'c'.repeat(40) });
    const image = cast('d', { embeds: [{ url: 'https://example.com/photo.png' }] });
    const fetch = vi.fn().mockResolvedValueOnce(response({ casts: [root, reply, image], next: { cursor: 'aa' } }))
      .mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetch);
    const expected = tab === 'casts' ? [root, image] : tab === 'replies' ? [reply] : [image];
    expect(await getProfileFeed({ fid: 3, tab, limit: 3 })).toEqual({ casts: expected, next: { cursor: 'aa' } });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe('/api/v2/farcaster/feed/user/casts?limit=3&fid=3');
  });

  it.each(['casts', 'replies', 'media'] as const)('keeps an empty %s profile page continuable without skipping later matches', async tab => {
    const root = cast('a');
    const reply = cast('b', { parent_hash: 'c'.repeat(40) });
    const image = cast('d', { embeds: [{ url: 'https://example.com/photo.png' }] });
    const match = tab === 'casts' ? root : tab === 'replies' ? reply : image;
    const unmatched = tab === 'casts' ? reply : root;
    const fetch = vi.fn().mockResolvedValueOnce(response({ casts: [unmatched], next: { cursor: 'aa' } }))
      .mockResolvedValueOnce(response({ casts: [match], next: {} }));
    vi.stubGlobal('fetch', fetch);
    expect(await getProfileFeed({ fid: 3, tab, limit: 1 })).toEqual({ casts: [], next: { cursor: 'aa' } });
    expect(fetch).toHaveBeenCalledOnce();
    expect(await getProfileFeed({ fid: 3, tab, cursor: 'aa', limit: 1 })).toEqual({ casts: [match], next: { cursor: null } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe('/api/v2/farcaster/feed/user/casts?limit=1&cursor=aa&fid=3');
  });

  it('rejects malformed profile pages and oversized matches without returning a truncated success', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ casts: {}, next: {} }))
      .mockResolvedValueOnce(response({ casts: [cast('a')], next: { cursor: '?' } }))
      .mockResolvedValueOnce(response({ casts: [cast('a'), cast('b')], next: { cursor: 'aa' } }));
    vi.stubGlobal('fetch', fetch);
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(getProfileFeed({ fid: 3, tab: 'casts', limit: 1 })).rejects.toMatchObject({ status: 502, code: 'invalid_response' });
    }
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('propagates a failed profile read without converting it to a successful empty page or scanning onward', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'upstream_unavailable', message: 'Try again.' }), { status: 502 }));
    vi.stubGlobal('fetch', fetch);
    await expect(getProfileFeed({ fid: 3, tab: 'media' })).rejects.toMatchObject({ status: 502, code: 'upstream_unavailable' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('preserves cancellation of a profile page and cleans its request deadline', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const fetch = vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      }));
      vi.stubGlobal('fetch', fetch);
      const pending = expect(getProfileFeed({ fid: 3, tab: 'replies', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
      controller.abort();
      await pending;
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('recognizes our uploaded images and supported image delivery paths without accepting spoofed hostnames', () => {
    for (const url of ['https://opencaster.org/media/' + 'a'.repeat(64), 'https://quorum.arca.computer/media/' + 'a'.repeat(64), 'https://imagedelivery.net/id/original', 'https://example.com/photo.PNG?size=2']) {
      expect(hasImageEmbed(cast('a', { embeds: [{ url }] }))).toBe(true);
    }
    for (const url of ['https://imagedelivery.net.attacker.test/id/original', 'https://example.com/imagedelivery.net', 'javascript:photo.png', 'https://example.com/page']) {
      expect(hasImageEmbed(cast('a', { embeds: [{ url }] }))).toBe(false);
    }
  });

  it('normalizes activity honestly when the node collapses recasts into likes and mentions into replies', async () => {
    const target = cast('a');
    const reply = cast('b', { parent_hash: target.hash, parent_author: { fid: 7 } });
    const mention = cast('c', { mentioned_profiles: [user(7)] });
    const timestamp = '2026-10-19T12:00:00.000Z';
    const rows = [
      { type: 'likes', user: user(3), cast: target, timestamp },
      { type: 'follows', user: user(4), cast: null, timestamp },
      { type: 'reply', user: user(3), cast: reply, timestamp },
      { type: 'reply', user: user(3), cast: mention, timestamp },
    ];
    const fetch = vi.fn().mockResolvedValue(response({ notifications: [...rows, rows[0]], next: { cursor: 'abc=' } }));
    vi.stubGlobal('fetch', fetch);
    const result = await getNotifications({ fid: 7, limit: 10 });
    expect(result.notifications.map(item => item.type)).toEqual(['reactions', 'follows', 'replies', 'mentions']);
    expect(result.notifications[0].actors).toEqual([user(3)]);
    expect(result.notifications[2].targetHash).toBe(reply.hash);
    expect(result.next.cursor).toBe('abc=');
    expect(fetch.mock.calls[0][0]).toBe('/api/v2/farcaster/notifications?limit=10&fid=7');
  });

  it('loads named channels while keeping the real cursor across non-channel parent namespaces', async () => {
    const channel = { id: 'test', name: 'test', url: 'https://warpcast.com/~/channel/test', member_count: 3 };
    const fetch = vi.fn().mockResolvedValueOnce(response({ channels: [{ id: 'eip155:8453/erc20:foo', name: 'token', url: 'eip155:8453/erc20:foo' }, channel], next: { cursor: 'abcd' } }))
      .mockResolvedValueOnce(response({ channel }));
    vi.stubGlobal('fetch', fetch);
    expect(await getChannels({ kind: 'all', limit: 5 })).toEqual({ channels: [channel], next: { cursor: 'abcd' } });
    expect(await getChannel('test')).toEqual(channel);
    expect(fetch.mock.calls[1][0]).toBe('/api/v2/farcaster/channel?id=test&type=id');
    await expect(getChannels({ kind: 'trending', cursor: 'abc' })).rejects.toThrow('does not support pagination');
    await expect(getChannel('https://attacker.test')).rejects.toThrow('Invalid channel');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a different valid channel ID before a composer can use its destination', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ channel: { id: 'different', name: 'different', url: 'https://warpcast.com/~/channel/different' } })));
    await expect(getChannel('test')).rejects.toMatchObject({ status: 502, code: 'invalid_response' });
  });

  it('rejects malformed search/activity responses and unsafe continuation cursors', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ result: { casts: 'invalid' } }))
      .mockResolvedValueOnce(response({ notifications: [{ type: 'follows', user: user(3), timestamp: 'not-a-date' }], next: {} }))
      .mockResolvedValueOnce(response({ channels: [], next: { cursor: 'https://attacker.test' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(searchCasts({ query: 'hello' })).rejects.toThrow('invalid search');
    await expect(getNotifications({ fid: 3 })).rejects.toThrow('invalid activity');
    await expect(getChannels({ kind: 'all' })).rejects.toThrow('invalid pagination');
  });
  it('loads paginated public follower lists without inventing viewer context', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ users: [{ fid: 3 }], next: { cursor: '10' } }));
    vi.stubGlobal('fetch', fetch);
    expect(await getFollows({ fid: 1234, kind: 'followers', cursor: '5', limit: 10 })).toEqual({ users: [{ fid: 3 }], next: { cursor: '10' } });
    expect(fetch.mock.calls[0][0]).toBe('/api/v2/farcaster/user/followers?limit=10&cursor=5&fid=1234');
    expect(fetch.mock.calls[0][1].credentials).toBe('omit');
    await expect(getFollows({ fid: 0, kind: 'following' })).rejects.toThrow('ID');
    await expect(getFollows({ fid: 3, kind: 'following', cursor: 'abc' })).rejects.toThrow('cursor');
    await expect(getFollows({ fid: 3, kind: 'following', cursor: '18446744073709551616' })).rejects.toThrow('cursor');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('checks actual follow messages and treats only the specific absence code as false', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ data: { type: 'MESSAGE_TYPE_LINK_ADD', fid: 1234, linkBody: { type: 'follow', targetFid: 3 } } }));
    vi.stubGlobal('fetch', fetch);
    expect(await getFollowStatus(1234, 3)).toBe(true);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'follow_not_found', message: 'Absent' }), { status: 404 }));
    fetch.mockResolvedValueOnce(response({ users: [], next: {} }));
    expect(await getFollowStatus(1234, 3)).toBe(false);
    for (const value of [{ code: 'upstream_error', message: 'Not found' }, { code: 'follow_not_found', message: 'Wrong status' }]) {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify(value), { status: value.code === 'upstream_error' ? 404 : 400 }));
      await expect(getFollowStatus(1234, 3)).rejects.toThrow();
    }
    fetch.mockResolvedValueOnce(response({ data: { type: 'MESSAGE_TYPE_LINK_ADD', fid: 1234, linkBody: { type: 'follow', targetFid: 4 } } }));
    await expect(getFollowStatus(1234, 3)).rejects.toThrow('invalid follow relationship');
  });

  it('finds compact-state follows with a single effective-index seek and honors removals', async () => {
    const absent = () => new Response(JSON.stringify({ code: 'follow_not_found' }), { status: 404 });
    const fetch = vi.fn()
      .mockResolvedValueOnce(absent()).mockResolvedValueOnce(response({ users: [{ fid: 3 }], next: { cursor: '3' } }))
      .mockResolvedValueOnce(absent()).mockResolvedValueOnce(response({ users: [{ fid: 8 }], next: {} }))
      .mockResolvedValueOnce(absent()).mockResolvedValueOnce(response({ users: [], next: {} }));
    vi.stubGlobal('fetch', fetch);
    expect(await getFollowStatus(1234, 3)).toBe(true);
    expect(fetch.mock.calls[1][0]).toBe('/api/v2/farcaster/user/following?limit=1&cursor=2&fid=1234');
    expect(await getFollowStatus(1234, 3)).toBe(false);
    expect(await getFollowStatus(1234, 1)).toBe(false);
    expect(fetch.mock.calls[5][0]).toContain('cursor=0');
  });

  it('keeps compact follow state unknown when the effective index fails or violates its seek', async () => {
    const absent = () => new Response(JSON.stringify({ code: 'follow_not_found' }), { status: 404 });
    const fetch = vi.fn()
      .mockResolvedValueOnce(absent()).mockResolvedValueOnce(new Response(JSON.stringify({ code: 'unavailable' }), { status: 503 }))
      .mockResolvedValueOnce(absent()).mockResolvedValueOnce(response({ users: [{ fid: 2 }], next: {} }));
    vi.stubGlobal('fetch', fetch);
    await expect(getFollowStatus(1234, 3)).rejects.toMatchObject({ status: 503 });
    await expect(getFollowStatus(1234, 3)).rejects.toThrow('invalid follow relationship');
  });

  it('rejects malformed follow pages and stops repeated cursors', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ users: [], next: { cursor: '10' } }));
    vi.stubGlobal('fetch', fetch);
    expect((await getFollows({ fid: 3, kind: 'following', cursor: '10' })).next.cursor).toBeNull();
    fetch.mockResolvedValueOnce(response({ users: [{ fid: -1 }], next: {} }));
    await expect(getFollows({ fid: 3, kind: 'following' })).rejects.toThrow('invalid follow list');
    fetch.mockResolvedValueOnce(response({ users: [], next: { cursor: 'https://example.com' } }));
    await expect(getFollows({ fid: 3, kind: 'following' })).rejects.toThrow('invalid follow cursor');
  });
  it('uses same-origin feeds with bounded pagination and no credentials', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ casts: [], next: { cursor: '2' } }));
    vi.stubGlobal('fetch', fetch);
    const result = await getFeed({ kind: 'following', fid: 3, limit: 10, cursor: '1' });
    expect(fetch.mock.calls[0][0]).toBe('/api/v2/farcaster/feed/following?limit=10&cursor=1&fid=3');
    expect(fetch.mock.calls[0][1].credentials).toBe('omit');
    expect(result.next.cursor).toBe('2');
  });

  it('looks up custody addresses without submitting recovery material', async () => {
    const user = { fid: 3, username: 'alice' };
    const fetch = vi.fn().mockResolvedValue(response({ user }));
    vi.stubGlobal('fetch', fetch);
    expect(await getUser({ custodyAddress: `0x${'a'.repeat(40)}` })).toEqual(user);
    expect(fetch.mock.calls[0][0]).toBe(`/api/v2/farcaster/user/custody-address?custody_address=0x${'a'.repeat(40)}`);
  });

  it.each([
    { lookup: { ensName: ' @DWR.ETH ' }, name: 'dwr.eth', type: 'ens' },
    { lookup: { ensName: 'JESSE.BASE.ETH' }, name: 'jesse.base.eth', type: 'basename' },
    { lookup: { username: '@DWR.ETH' }, name: 'dwr.eth', type: 'ens' },
    { lookup: { username: 'jesse.base.eth' }, name: 'jesse.base.eth', type: 'basename' },
  ])('resolves indexed name proof $name and hydrates only its exact FID', async ({ lookup, name, type }) => {
    const canonical = user(3);
    const fetch = vi.fn().mockResolvedValueOnce(response({ fid: 3 })).mockResolvedValueOnce(response({ user: canonical })); vi.stubGlobal('fetch', fetch);
    expect(await getUser(lookup)).toEqual(canonical);
    expect(fetch.mock.calls.map(call => call[0])).toEqual([`/api/v1/fidByName?name=${name}&type=${type}`, '/api/v2/farcaster/user?fid=3']);
    for (const [, options] of fetch.mock.calls) expect(options).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  });

  it('preserves existing non-ENS username API lookups', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ user: user(3) })); vi.stubGlobal('fetch', fetch);
    await getUser({ username: 'legacy.name' });
    expect(fetch.mock.calls[0][0]).toBe('/api/v2/farcaster/user/by-username?username=legacy.name');
  });

  it.each(['sub.alice.eth', 'álîce.eth', 'Key.eth', `${'a'.repeat(17)}.eth`, 'alice.com', 'alice.eth.', 'https://alice.eth'])('rejects an unsupported explicit ENS name before fetching: %j', async ensName => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(getUser({ ensName })).rejects.toThrow('1–16 character ASCII'); expect(fetch).not.toHaveBeenCalled();
  });

  it('requires exactly one public identifier even for name-proof lookups', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(getUser({ ensName: 'alice.eth', fid: 3 })).rejects.toThrow('one profile identifier'); expect(fetch).not.toHaveBeenCalled();
  });

  it.each([undefined, 0, -1, 1.5, '3', 0x1_0000_0000])('rejects an invalid name-proof FID without hydrating another account: %j', async fid => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ fid })); vi.stubGlobal('fetch', fetch);
    await expect(getUser({ ensName: 'alice.eth' })).rejects.toMatchObject({ code: 'invalid_response' }); expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects hydration that disagrees with the resolved name-proof FID', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ fid: 3 })).mockResolvedValueOnce(response({ user: user(4) })); vi.stubGlobal('fetch', fetch);
    await expect(getUser({ ensName: 'alice.eth' })).rejects.toMatchObject({ code: 'invalid_response' }); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    { status: 404, code: 'ens_name_not_found' }, { status: 400, code: 'upstream_error' }, { status: 503, code: 'upstream_error' },
  ])('preserves missing-proof and service failure distinctions without another lookup: %j', async error => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: error.code, message: 'Isolated lookup failure' }), { status: error.status })); vi.stubGlobal('fetch', fetch);
    await expect(getUser({ ensName: 'alice.eth' })).rejects.toMatchObject(error); expect(fetch).toHaveBeenCalledOnce();
  });

  it('makes no request for an ENS lookup that was already cancelled', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const controller = new AbortController(); controller.abort();
    await expect(getUser({ ensName: 'alice.eth' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(fetch).not.toHaveBeenCalled();
  });

  it('does not start hydration when an ignored-abort name proof arrives after cancellation', async () => {
    let resolve!: (value: Response) => void;
    const fetch = vi.fn().mockReturnValue(new Promise<Response>(value => { resolve = value; })); vi.stubGlobal('fetch', fetch);
    const controller = new AbortController(); const pending = getUser({ ensName: 'alice.eth' }, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); resolve(response({ fid: 3 }));
    await assertion; expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('cancels FID hydration and does not expose its late account after the caller leaves', async () => {
    let resolve!: (value: Response) => void;
    const fetch = vi.fn().mockResolvedValueOnce(response({ fid: 3 })).mockImplementationOnce(() => new Promise<Response>(value => { resolve = value; })); vi.stubGlobal('fetch', fetch);
    const controller = new AbortController(); const pending = getUser({ ensName: 'alice.eth' }, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); controller.abort(); resolve(response({ user: user(3) }));
    await assertion; expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
  });

  it('bounds proof resolution and FID hydration together to one 25-second deadline', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
        if (fetch.mock.calls.length === 1) { await new Promise(resolve => setTimeout(resolve, 20_000)); return response({ fid: 3 }); }
        return new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
      }); vi.stubGlobal('fetch', fetch);
      const pending = getUser({ ensName: 'alice.eth' }); const assertion = expect(pending).rejects.toMatchObject({ status: 504, code: 'timeout' });
      await vi.advanceTimersByTimeAsync(20_001); expect(fetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(5_000); await assertion; expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('normalizes the real nested conversation wire shape', async () => {
    const root = { hash: 'a'.repeat(40), text: 'root' } as Cast;
    const reply = { hash: 'b'.repeat(40), text: 'reply' } as Cast;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ conversation: { cast: { ...root, direct_replies: [{ ...reply, direct_replies: [] }] } } })));
    expect(await getConversation(root.hash)).toEqual({ cast: root, replies: [{ cast: reply, replies: [] }] });
  });

  it('continues signer pagination instead of treating an incomplete page as absence', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ signers: [{ key: 'a' }], currentUserNonce: 3, nextPageToken: 'YWJj' }))
      .mockResolvedValueOnce(response({ signers: [{ key: 'b' }], currentUserNonce: 3 }));
    vi.stubGlobal('fetch', fetch);
    expect((await getSigners(3)).signers.map(signer => signer.key)).toEqual(['a', 'b']);
    expect(fetch.mock.calls[0][0]).toContain('requesterFids%5B0%5D=3');
    expect(fetch.mock.calls[1][0]).toContain('pageToken=YWJj');
  });

  it('submits the binary payload once and never retries an uncertain write', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Network connection lost'));
    vi.stubGlobal('fetch', fetch);
    await expect(submitMessage(new Uint8Array([8, 1, 16, 3]))).rejects.toThrow('Submission status is unknown. Check your profile or signer state before trying again.');
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/v1/submitMessage');
    expect(new Uint8Array(options.body)).toEqual(new Uint8Array([8, 1, 16, 3]));
  });

  it.each(['5b6e756c6c5d', '5b6e756c6c2c6e756c6c5d', '5b6e756c6c2c6e756c6c2c6e756c6c5d', 'previous'])('stops exhausted or non-advancing feed cursors: %s', async cursor => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ casts: [], next: { cursor } })));
    const feed = await getFeed({ kind: 'channel', channel: 'quilibrium', cursor: 'previous' });
    expect(feed.next.cursor).toBeNull();
  });

  it('merges and sorts complete channel shard batches without truncating unseen casts', async () => {
    const newer = cast('b', { timestamp: '2026-10-19T13:00:00Z' });
    const older = cast('a');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ casts: [older, newer, { ...newer, hash: `0x${newer.hash}` }], next: { cursor: 'abcd' } })));
    const feed = await getFeed({ kind: 'channel', channel: 'test', limit: 1 });
    expect(feed.casts.map(value => value.hash.replace(/^0x/, ''))).toEqual([newer.hash, older.hash]);
    expect(feed.next.cursor).toBe('abcd');
  });

  it('propagates cancellation to an in-flight read', async () => {
    const fetch = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const pending = getFeed({ kind: 'trending', signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
  });
});

const reaction = (letter: string, type: 'Like' | 'Recast' = 'Like', targetFid = 3, accountFid = 7) => ({
  hash: `0x${letter.repeat(40)}`,
  data: { type: 'MESSAGE_TYPE_REACTION_ADD', fid: accountFid, timestamp: 183000000, network: 'FARCASTER_NETWORK_MAINNET',
    reactionBody: { type: type === 'Like' ? 'REACTION_TYPE_LIKE' : 'REACTION_TYPE_RECAST', targetCastId: { fid: targetFid, hash: `0x${letter.repeat(40)}` } } },
});
const absentReaction = () => new Response(JSON.stringify({ code: 'reaction_not_found', message: 'Absent' }), { status: 404 });

describe('paginated cast reaction people', () => {
  const target = { fid: 3, hash: `0x${'a'.repeat(40)}` };
  it('keeps complete per-shard pages, deduplicates actors and preserves a base64 continuation', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ messages: [reaction('a', 'Like', 3, 7), reaction('a', 'Like', 3, 8), reaction('a', 'Like', 3, 7)], nextPageToken: 'dG9rZW4=' }))
      .mockResolvedValueOnce(response({ user: user(7) })).mockResolvedValueOnce(response({ user: user(8) }));
    vi.stubGlobal('fetch', fetch);
    expect(await getCastReactionPeople({ target, type: 'likes', limit: 1 })).toEqual({ users: [user(7), user(8)], next: { cursor: 'dG9rZW4=' } });
    expect(fetch.mock.calls[0][0]).toBe(`/api/v1/reactionsByCast?target_fid=3&target_hash=${'a'.repeat(40)}&reaction_type=Like&pageSize=1&reverse=true`);
    expect(fetch).toHaveBeenCalledTimes(3);
    fetch.mockResolvedValueOnce(response({ messages: [], nextPageToken: '' }));
    expect(await getCastReactionPeople({ target, type: 'recasts', cursor: 'dG9rZW4=' })).toEqual({ users: [], next: { cursor: null } });
    expect(fetch.mock.calls[3][0]).toContain('reaction_type=Recast&pageSize=25&reverse=true&pageToken=dG9rZW4%3D');
  });
  it('rejects unrelated or malformed receipts before hydrating any profiles', async () => {
    const valid = reaction('a');
    const variants = [reaction('b'), reaction('a', 'Like', 4), reaction('a', 'Recast'), reaction('a', 'Like', 3, 0),
      { ...valid, data: { ...valid.data, type: 'MESSAGE_TYPE_REACTION_REMOVE' } },
      { ...valid, data: { ...valid.data, network: 'FARCASTER_NETWORK_TESTNET' } },
      { ...valid, data: { ...valid.data, reactionBody: { type: 'REACTION_TYPE_LIKE', targetUrl: 'https://example.org' } } }];
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const message of variants) {
      fetch.mockResolvedValueOnce(response({ messages: [message] }));
      await expect(getCastReactionPeople({ target, type: 'likes' })).rejects.toMatchObject({ code: 'invalid_response' });
    }
    expect(fetch).toHaveBeenCalledTimes(variants.length);
  });
  it('rejects bad continuations and oversized pages without silently dropping a page', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const nextPageToken of ['invalid!', 'a===', 'dG9rZW4=']) {
      fetch.mockResolvedValueOnce(response({ messages: [], nextPageToken }));
      await expect(getCastReactionPeople({ target, type: 'likes', cursor: 'dG9rZW4=' })).rejects.toMatchObject({ code: 'invalid_response' });
    }
    fetch.mockResolvedValueOnce(response({ messages: Array(1001).fill(reaction('a')) }));
    await expect(getCastReactionPeople({ target, type: 'likes' })).rejects.toMatchObject({ code: 'invalid_response' });
    const count = fetch.mock.calls.length;
    for (const options of [{ limit: 26 }, { cursor: 'a===' }, { type: 'other' }, { target: { fid: 0, hash: target.hash } }]) {
      await expect(getCastReactionPeople({ target, type: 'likes', ...options } as Parameters<typeof getCastReactionPeople>[0])).rejects.toThrow();
    }
    expect(fetch).toHaveBeenCalledTimes(count);
  });
  it('keeps hydration outages and mismatched profiles distinct from an empty list', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ messages: [reaction('a')] })).mockResolvedValueOnce(response({ user: user(8) }))
      .mockResolvedValueOnce(response({ messages: [reaction('a')] })).mockResolvedValueOnce(new Response(JSON.stringify({ code: 'upstream_error', message: 'Unavailable' }), { status: 502 }));
    vi.stubGlobal('fetch', fetch);
    await expect(getCastReactionPeople({ target, type: 'likes' })).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(getCastReactionPeople({ target, type: 'likes' })).rejects.toMatchObject({ code: 'upstream_error' });
  });
  it('hydrates with at most four concurrent reads and cancels all remaining work', async () => {
    let active = 0, maximum = 0;
    const fetch = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
      if (url.includes('/reactionsByCast?')) return response({ messages: Array.from({ length: 8 }, (_, index) => reaction('a', 'Like', 3, index + 7)) });
      active++; maximum = Math.max(maximum, active);
      return new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => { active--; reject(options.signal?.reason); }, { once: true }));
    });
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const pending = expect(getCastReactionPeople({ target, type: 'likes', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
    expect(maximum).toBe(4); controller.abort(); await pending;
    expect(active).toBe(0); expect(fetch).toHaveBeenCalledTimes(5);
  });
  it('uses one 25-second deadline across receipt loading and profile hydration', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
        if (url.includes('/reactionsByCast?')) { await new Promise(resolve => setTimeout(resolve, 20_000)); return response({ messages: [reaction('a')] }); }
        return new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true }));
      });
      vi.stubGlobal('fetch', fetch);
      const assertion = expect(getCastReactionPeople({ target, type: 'likes' })).rejects.toMatchObject({ status: 504, code: 'timeout' });
      await vi.advanceTimersByTimeAsync(25_001); await assertion;
      expect(fetch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});

describe('Hypersnap trending windows', () => {
  it('passes supported windows only to trending and leaves the node default when omitted', async () => {
    const fetch = vi.fn().mockImplementation(async () => response({ casts: [], next: {} })); vi.stubGlobal('fetch', fetch);
    for (const timeWindow of ['1h', '6h', '12h', '24h', '7d'] as const) {
      await getFeed({ kind: 'trending', timeWindow });
      expect(fetch.mock.lastCall?.[0]).toBe(`/api/v2/farcaster/feed/trending?limit=20&time_window=${timeWindow}`);
    }
    await getFeed({ kind: 'trending' }); expect(fetch.mock.lastCall?.[0]).toBe('/api/v2/farcaster/feed/trending?limit=20');
    const count = fetch.mock.calls.length;
    for (const options of [{ kind: 'following', fid: 3, timeWindow: '1h' }, { kind: 'user', fid: 3, timeWindow: '1h' }, { kind: 'channel', channel: 'art', timeWindow: '1h' }, { kind: 'trending', timeWindow: '30d' }]) await expect(getFeed(options as FeedOptions)).rejects.toThrow('trending time window');
    expect(fetch).toHaveBeenCalledTimes(count);
  });
});

describe('authoritative public reaction reads', () => {
  it('resolves actual viewer state and accepts only its exact normalized absence code', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(reaction('a'))).mockResolvedValueOnce(absentReaction());
    vi.stubGlobal('fetch', fetch);
    expect(await getReactionStatus(7, { fid: 3, hash: 'a'.repeat(40) }, 'like')).toBe(true);
    expect(await getReactionStatus(7, { fid: 3, hash: 'a'.repeat(40) }, 'recast')).toBe(false);
    expect(fetch.mock.calls[0][0]).toBe(`/api/v1/reactionById?fid=7&reaction_type=Like&target_fid=3&target_hash=${'a'.repeat(40)}`);
    for (const [status, code] of [[400, 'reaction_not_found'], [404, 'upstream_error'], [502, 'upstream_error']] as const) {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({ status, code }), { status }));
      await expect(getReactionStatus(7, { fid: 3, hash: 'a'.repeat(40) }, 'like')).rejects.toThrow();
    }
  });

  it('refuses mismatched authors, targets, subtypes and invalid input instead of inventing viewer state', async () => {
    const target = { fid: 3, hash: 'a'.repeat(40) };
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const value of [reaction('a', 'Like', 3, 8), reaction('b'), reaction('a', 'Recast'), reaction('a', 'Like', 4), { data: {} }]) {
      fetch.mockResolvedValueOnce(response(value));
      await expect(getReactionStatus(7, target, 'like')).rejects.toMatchObject({ code: 'invalid_response' });
    }
    const count = fetch.mock.calls.length;
    await expect(getReactionStatus(0, target, 'like')).rejects.toThrow('ID');
    await expect(getReactionStatus(7, { ...target, hash: 'short' }, 'like')).rejects.toThrow('hash');
    expect(fetch).toHaveBeenCalledTimes(count);
  });

  it('deduplicates visible targets, bounds status reads to four requests, and keys results to the viewer', async () => {
    let inFlight = 0, max = 0;
    const fetch = vi.fn().mockImplementation(async () => {
      inFlight++; max = Math.max(max, inFlight);
      await new Promise(resolve => setTimeout(resolve, 1));
      inFlight--;
      return absentReaction();
    });
    vi.stubGlobal('fetch', fetch);
    const targets = ['a', 'b', 'c'].map(letter => ({ fid: 3, hash: letter.repeat(40) }));
    expect(await getReactionStatuses(7, [...targets, { fid: 3, hash: `0x${targets[0].hash}` }])).toEqual(targets.map(target => ({ ...target, viewerFid: 7, liked: false, recasted: false })));
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(max).toBeLessThanOrEqual(4);
    await expect(getReactionStatuses(7, new Array(26).fill(targets[0]))).rejects.toThrow('25 visible');
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('rejects partial status failures and cancels pending reads on account cancellation', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('Disconnected'));
    vi.stubGlobal('fetch', fetch);
    await expect(getReactionStatuses(7, [{ fid: 3, hash: 'a'.repeat(40) }])).rejects.toThrow('Disconnected');
    const controller = new AbortController(); controller.abort();
    const calls = fetch.mock.calls.length;
    await expect(getReactionStatuses(7, [{ fid: 3, hash: 'a'.repeat(40) }], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(calls);
  });
});

describe('profile likes and recasts', () => {
  it.each([['likes', 'Like', 'like'], ['recasts', 'Recast', 'recast']] as const)('loads newest-first %s and hydrates the actual target casts', async (tab, wireType, type) => {
    const full = cast('a', { text: 'Authoritative target content' });
    const fetch = vi.fn().mockResolvedValueOnce(response({ messages: [reaction('a', wireType)], nextPageToken: 'dG9rZW4=' })).mockResolvedValueOnce(response({ cast: full }));
    vi.stubGlobal('fetch', fetch);
    const page = await getProfileFeed({ fid: 7, tab, limit: 1 });
    expect(page).toEqual({ casts: [{ ...full, reaction_context: { fid: 7, type, timestamp: new Date((183000000 + 1609459200) * 1000).toISOString() } }], next: { cursor: 'dG9rZW4=' } });
    expect(fetch.mock.calls[0][0]).toBe(`/api/v1/reactionsByFid?fid=7&reaction_type=${wireType}&pageSize=1&reverse=true`);
    expect(fetch.mock.calls[1][0]).toBe(`/api/v2/farcaster/cast?identifier=${'a'.repeat(40)}&type=hash`);
  });

  it('continues past verified deleted targets with the real opaque cursor and no result loss', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ messages: [reaction('a')], nextPageToken: 'dG9rZW4=' }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'cast_not_found' }), { status: 404 }))
      .mockResolvedValueOnce(response({ messages: [reaction('b')], nextPageToken: '' }))
      .mockResolvedValueOnce(response({ cast: cast('b') }));
    vi.stubGlobal('fetch', fetch);
    const page = await getProfileFeed({ fid: 7, tab: 'likes', limit: 1 });
    expect(page.casts.map(value => value.hash)).toEqual(['b'.repeat(40)]);
    expect(page.next.cursor).toBeNull();
    expect(fetch.mock.calls[2][0]).toContain('pageToken=dG9rZW4%3D');
    expect(fetch.mock.calls[2][0]).toContain('pageSize=1');
  });

  it('retains a continuation after the bounded scan of sparse URL-only reactions', async () => {
    const urlReaction = { ...reaction('a'), data: { ...reaction('a').data, reactionBody: { type: 'REACTION_TYPE_LIKE', targetUrl: 'https://example.com' } } };
    const fetch = vi.fn().mockImplementation(async (path: string) => {
      const page = Number(new URL(path, 'https://local').searchParams.get('pageToken') ? atob(new URL(path, 'https://local').searchParams.get('pageToken')!) : '0');
      return response({ messages: [urlReaction], nextPageToken: btoa(String(page + 1)) });
    });
    vi.stubGlobal('fetch', fetch);
    expect(await getProfileFeed({ fid: 7, tab: 'likes', limit: 1 })).toEqual({ casts: [], next: { cursor: btoa('5') } });
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('fails closed on invalid reaction receipts, unsafe/repeated cursors, wrong target hydration and non-deletion errors', async () => {
    for (const initial of [
      { messages: [reaction('a', 'Like', 3, 8)] },
      { messages: [reaction('a')], nextPageToken: 'https://evil.example/' },
      { messages: [reaction('a')], nextPageToken: 'dG9rZW4=' },
      { messages: [reaction('a'), reaction('b')] },
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(initial)));
      await expect(getProfileFeed({ fid: 7, tab: 'likes', cursor: 'dG9rZW4=', limit: 1 })).rejects.toMatchObject({ code: 'invalid_response' });
    }
    for (const hydration of [response({ cast: cast('b') }), response({ cast: cast('a', { author: user(4) }) }), new Response(JSON.stringify({ code: 'upstream_error' }), { status: 404 })]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ messages: [reaction('a')] })).mockResolvedValueOnce(hydration));
      await expect(getProfileFeed({ fid: 7, tab: 'likes', limit: 1 })).rejects.toThrow();
    }
  });
});

describe('bounded community reads', () => {
  it('loads friends-of-friends without exposing self or duplicate recommendations', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ users: [user(3), user(4), user(3)] })); vi.stubGlobal('fetch', fetch);
    expect(await getSuggestedUsers(4, 6)).toEqual({ users: [user(3)] });
    expect(fetch.mock.calls[0][0]).toBe('/api/v2/farcaster/following/suggested?fid=4&limit=6');
    await expect(getSuggestedUsers(4, 21)).rejects.toThrow('20');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('reads actual channel participants with bounded decimal pagination', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ members: [{ user: user(3), role: 'member' }], next: { cursor: '3' } })); vi.stubGlobal('fetch', fetch);
    expect(await getChannelMembers('art', { cursor: '2', limit: 25 })).toEqual({ users: [user(3)], next: { cursor: '3' } });
    expect(fetch.mock.calls[0][0]).toBe('/api/v2/farcaster/channel/members?channel_id=art&limit=25&cursor=2');
    await expect(getChannelMembers('https://evil.test')).rejects.toThrow('channel');
    await expect(getChannelMembers('art', { cursor: 'abc' })).rejects.toThrow('cursor');
    await expect(getChannelMembers('art', { limit: 26 })).rejects.toThrow('25');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('returns an explicit quote sample without inventing archive pagination or accepting unrelated casts', async () => {
    const quoted = cast('b', { embeds: [{ cast_id: { fid: 3, hash: `0x${'a'.repeat(40)}` } }] });
    const fetch = vi.fn().mockResolvedValueOnce(response({ casts: [quoted], next: { cursor: 'ignored' } })).mockResolvedValueOnce(response({ casts: [] }))
      .mockResolvedValueOnce(response({ casts: [cast('c')] })); vi.stubGlobal('fetch', fetch);
    expect(await getCastQuotes('a'.repeat(40))).toEqual({ casts: [quoted], next: { cursor: null } });
    expect(await getCastQuotes('a'.repeat(40))).toEqual({ casts: [], next: { cursor: null } });
    expect(fetch.mock.calls[0][0]).toBe(`/api/v2/farcaster/cast/quotes?identifier=${'a'.repeat(40)}&type=hash&limit=25`);
    await expect(getCastQuotes('a'.repeat(40))).rejects.toThrow('invalid quote');
    await expect(getCastQuotes('a'.repeat(40), 26)).rejects.toThrow('25');
  });
  it('rejects malformed people and repeated participant cursors', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ users: [{ fid: 0 }] })).mockResolvedValueOnce(response({ members: [{ user: user(3) }], next: { cursor: '3' } })); vi.stubGlobal('fetch', fetch);
    await expect(getSuggestedUsers(7)).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(getChannelMembers('art', { cursor: '3' })).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('reaction-history operation deadline', () => {
  it('bounds the entire lookup plus target hydration to 25 seconds and cleans every timer', async () => {
    vi.useFakeTimers();
    try {
      let hydrationSignal: AbortSignal | undefined;
      const fetch = vi.fn().mockResolvedValueOnce(response({ messages: [reaction('a')] })).mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
        hydrationSignal = options.signal;
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      }));
      vi.stubGlobal('fetch', fetch);
      const pending = expect(getProfileFeed({ fid: 7, tab: 'likes', limit: 1 })).rejects.toMatchObject({ status: 504, code: 'timeout' });
      await vi.advanceTimersByTimeAsync(25_000);
      await pending;
      expect(hydrationSignal?.aborted).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('preserves caller cancellation and removes the aggregate deadline without converting cancellation into an empty page', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const fetch = vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); }));
      vi.stubGlobal('fetch', fetch);
      const pending = expect(getProfileFeed({ fid: 7, tab: 'recasts', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
      controller.abort();
      await pending;
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
