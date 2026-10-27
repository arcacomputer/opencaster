import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getConversation, resolveCastAlias, type Cast, type CastAliasContinuation, type CastAliasResult, type User } from './api';

const prefix = '0xcfd6d3c3';
const hash = (index = 1) => `${prefix}${index.toString(16).padStart(32, '0')}`;
const otherHash = `0x${'a'.repeat(40)}`;
const author: User = { fid: 10, username: 'alice', custody_address: '', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 };
const cast = (value = hash(), fid = author.fid): Cast => ({ hash: value, author: { ...author, fid }, text: 'Synthetic cast', timestamp: '2026-10-22T10:00:00Z', embeds: [], reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 } });
const timestamp = 183000000;
const message = (value = hash(), type = 'MESSAGE_TYPE_CAST_ADD', time = timestamp) => ({ hash: value, data: { type, fid: author.fid, timestamp: time, network: 'FARCASTER_NETWORK_MAINNET', ...(type === 'MESSAGE_TYPE_CAST_ADD' ? { castAddBody: { text: 'Synthetic cast' } } : { castRemoveBody: { targetHash: value } }) } });
const ordered = (messages: ReturnType<typeof message>[], start = timestamp) => messages.map((value, index) => ({ ...value, data: { ...value.data, timestamp: start - index } }));
const unrelatedHash = (n: number) => `0x${'a'.repeat(32)}${n.toString(16).padStart(8, '0')}`;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const input = { authorIdentifier: 'alice', hashPrefix: prefix };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(deliver => { resolve = deliver; });
  return { promise, resolve };
}
// Native legacy User/FID/CastMessage/timestamp/hash primary keys, not opaque
// synthetic strings: reverse pagination is exclusive and lexicographic.
function cursorFor(receipt: ReturnType<typeof message>, overrides: { root?: number; fid?: number; postfix?: number; length?: number } = {}) {
  const bytes = new Uint8Array(overrides.length ?? 30); const key = new Uint8Array(30); const view = new DataView(key.buffer);
  key[0] = overrides.root ?? 3; view.setUint32(1, overrides.fid ?? receipt.data.fid); key[5] = overrides.postfix ?? 1; view.setUint32(6, receipt.data.timestamp);
  key.set(Uint8Array.from(receipt.hash.slice(2).match(/../g)!, pair => parseInt(pair, 16)), 10);
  bytes.set(key.subarray(0, Math.min(bytes.length, key.length)));
  return btoa(String.fromCharCode(...bytes));
}
const historyReceipt = (n: number, value = unrelatedHash(n)) => message(value, 'MESSAGE_TYPE_CAST_ADD', timestamp - n);
const token = (n: number) => cursorFor(historyReceipt(n));
function install(pages: unknown[], hydration?: (url: URL, options: RequestInit) => Promise<Response> | Response, user = author) {
  const reads = [...pages];
  const fetch = vi.fn(async (path: string, options: RequestInit) => {
    const url = new URL(path, 'https://quorum.arca.computer');
    expect(options.credentials).toBe('omit'); expect(options.body).toBeUndefined();
    if (url.pathname.includes('/user')) return json({ user });
    if (url.pathname.endsWith('/castsByFid')) {
      expect(url.searchParams.get('fid')).toBe(String(author.fid)); expect(url.searchParams.get('pageSize')).toBe('250'); expect(url.searchParams.get('reverse')).toBe('true');
      if (!reads.length) throw new Error('Unexpected history page');
      const page = reads.shift();
      return page instanceof Promise ? page : json(page);
    }
    if (url.pathname.endsWith('/cast')) {
      expect(url.searchParams.get('fid')).toBe(String(author.fid));
      return hydration ? hydration(url, options) : json({ cast: cast(`0x${url.searchParams.get('identifier')}`) });
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  vi.stubGlobal('fetch', fetch); return fetch;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('bounded author-scoped cast links', () => {
  it('resolves an exhausted unambiguous history and hydrates its exact FID/full hash', async () => {
    const fetch = install([{ messages: ordered([message(), message(otherHash), message(hash(2), 'MESSAGE_TYPE_CAST_REMOVE'), message(unrelatedHash(2))]) }]);
    const result = await resolveCastAlias({ ...input, authorIdentifier: 'ALICE', hashPrefix: prefix.toUpperCase() });
    expect(result).toEqual({ author, candidates: [cast()], complete: true, scanned: 4 }); expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][0]).toContain('/by-username?username=alice');
  });
  it('publishes an exact hydrated match before later history settles and reuses it for the final result', async () => {
    const receipt = historyReceipt(1, hash()); const laterPage = deferred<Response>();
    const fetch = install([{ messages: [receipt], nextPageToken: cursorFor(receipt) }, laterPage.promise]);
    const onProgress = vi.fn<(snapshot: CastAliasResult) => void>(); const settled = vi.fn();
    const pending = resolveCastAlias({ ...input, onProgress }); void pending.then(settled, settled);
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalled());
    expect(onProgress.mock.calls[0][0]).toEqual({ author, candidates: [cast()], complete: false, scanned: 1 });
    await vi.waitFor(() => expect(fetch.mock.calls.filter(([path]) => path.includes('/castsByFid'))).toHaveLength(2));
    expect(settled).not.toHaveBeenCalled();
    expect(fetch.mock.calls.filter(([path]) => path.includes('/cast?'))).toHaveLength(1);
    laterPage.resolve(json({ messages: [historyReceipt(2)] }));
    expect(await pending).toEqual({ author, candidates: [cast()], complete: true, scanned: 2 });
    expect(fetch.mock.calls.filter(([path]) => path.includes('/cast?'))).toHaveLength(1);
    for (const [snapshot] of onProgress.mock.calls) {
      expect(snapshot.complete).toBe(false); expect(snapshot.continuation).toBeUndefined();
    }
  });
  it('stops before the next history page when a verified progress match aborts the caller', async () => {
    const receipt = historyReceipt(1, hash()); const tail = historyReceipt(2);
    const hydration = deferred<Response>(); const hydrated = { ...cast(), text: 'Verified hydrated cast' };
    const fetch = install([{ messages: [receipt, tail], nextPageToken: cursorFor(tail) }, { messages: [] }], url => {
      expect(url.searchParams.get('identifier')).toBe(hash().slice(2));
      return hydration.promise;
    });
    const controller = new AbortController();
    const onProgress = vi.fn<(snapshot: CastAliasResult) => void>(snapshot => {
      expect(snapshot).toEqual({ author, candidates: [hydrated], complete: false, scanned: 2 });
      expect(fetch.mock.calls.filter(([path]) => path.includes('/castsByFid'))).toHaveLength(1);
      controller.abort();
    });
    const pending = resolveCastAlias({ ...input, onProgress, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(onProgress).not.toHaveBeenCalled();
    hydration.resolve(json({ cast: hydrated }));
    await rejected;
    expect(controller.signal.aborted).toBe(true); expect(onProgress).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.filter(([path]) => path.includes('/castsByFid'))).toHaveLength(1);
    expect(fetch.mock.calls.filter(([path]) => path.includes('/cast?'))).toHaveLength(1);
  });
  it('hydrates only after history for callers without progress', async () => {
    const receipt = historyReceipt(1, hash()); const laterPage = deferred<Response>();
    const fetch = install([{ messages: [receipt], nextPageToken: cursorFor(receipt) }, laterPage.promise]);
    const pending = resolveCastAlias(input);
    await vi.waitFor(() => expect(fetch.mock.calls.filter(([path]) => path.includes('/castsByFid'))).toHaveLength(2));
    expect(fetch.mock.calls.filter(([path]) => path.includes('/cast?'))).toHaveLength(0);
    laterPage.resolve(json({ messages: [] }));
    expect(await pending).toMatchObject({ candidates: [cast()], complete: true, scanned: 1 });
    expect(fetch.mock.calls.filter(([path]) => path.includes('/cast?'))).toHaveLength(1);
  });
  it.each(['Zh==', token(2)])('validates the current page pagination before publishing its matching cast: %s', async nextPageToken => {
    const receipt = historyReceipt(1, hash());
    const fetch = install([{ messages: [receipt], nextPageToken }]); const onProgress = vi.fn();
    await expect(resolveCastAlias({ ...input, onProgress })).rejects.toMatchObject({ code: 'invalid_pagination' });
    expect(onProgress).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('skips a removed or pruned progressive candidate without hydrating it again at completion', async () => {
    const receipt = historyReceipt(1, hash()); const laterPage = deferred<Response>();
    const fetch = install([{ messages: [receipt], nextPageToken: cursorFor(receipt) }, laterPage.promise], () => json({ code: 'cast_not_found' }, 404));
    const onProgress = vi.fn<(snapshot: CastAliasResult) => void>();
    const pending = resolveCastAlias({ ...input, onProgress });
    await vi.waitFor(() => expect(fetch.mock.calls.filter(([path]) => path.includes('/castsByFid'))).toHaveLength(2));
    for (const [snapshot] of onProgress.mock.calls) expect(snapshot.candidates).toEqual([]);
    laterPage.resolve(json({ messages: [] }));
    expect(await pending).toMatchObject({ candidates: [], complete: true, scanned: 1 });
    expect(fetch.mock.calls.filter(([path]) => path.includes('/cast?'))).toHaveLength(1);
  });
  it('accumulates verified prefix collisions in progress and retains every choice in the final result', async () => {
    const first = historyReceipt(1, hash()); const laterPage = deferred<Response>();
    const fetch = install([{ messages: [first], nextPageToken: cursorFor(first) }, laterPage.promise]);
    const onProgress = vi.fn<(snapshot: CastAliasResult) => void>();
    const pending = resolveCastAlias({ ...input, onProgress });
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalled());
    expect(onProgress.mock.calls[0][0].candidates).toEqual([cast()]);
    laterPage.resolve(json({ messages: [historyReceipt(2, hash(2))] }));
    expect(await pending).toEqual({ author, candidates: [cast(), cast(hash(2))], complete: true, scanned: 2 });
    expect(onProgress.mock.calls.some(([snapshot]) => snapshot.scanned === 2 && snapshot.candidates.length === 2)).toBe(true);
    expect(onProgress.mock.calls[0][0].candidates).toEqual([cast()]);
    for (const [snapshot] of onProgress.mock.calls) {
      expect(snapshot.complete).toBe(false); expect(snapshot.continuation).toBeUndefined();
    }
    expect(fetch.mock.calls.filter(([path]) => path.includes('/cast?'))).toHaveLength(2);
  });
  it('keeps all matching candidates instead of picking the first prefix collision', async () => {
    install([{ messages: ordered([message(), message(hash(2))]) }]);
    const result = await resolveCastAlias(input);
    expect(result.complete).toBe(true); expect(result.candidates.map(value => value.hash)).toEqual([hash(), hash(2)]);
  });
  it('discloses incomplete history after four pages and continues cumulatively on an explicit call', async () => {
    const pages = Array.from({ length: 4 }, (_, n) => { const receipt = historyReceipt(n + 1, n === 0 ? hash() : unrelatedHash(n + 1)); return { messages: [receipt], nextPageToken: cursorFor(receipt) }; });
    const fetch = install(pages);
    const first = await resolveCastAlias(input);
    expect(first.complete).toBe(false); expect(first.scanned).toBe(4); expect(first.candidates).toEqual([cast()]);
    expect(first.continuation?.cursor).toBe(pages[3].nextPageToken); expect(fetch).toHaveBeenCalledTimes(6);
    const nextFetch = install([{ messages: [historyReceipt(5, hash(2))] }]);
    const second = await resolveCastAlias({ ...input, continuation: first.continuation });
    expect(second).toEqual({ author, candidates: [cast(), cast(hash(2))], complete: true, scanned: 5 });
    expect(nextFetch.mock.calls[1][0]).toContain(`pageToken=${encodeURIComponent(pages[3].nextPageToken)}`);
  });
  it('distinguishes a complete empty result from an incomplete empty batch', async () => {
    install([{ messages: [] }]); expect(await resolveCastAlias(input)).toMatchObject({ candidates: [], complete: true, scanned: 0 });
    install(Array.from({ length: 4 }, (_, n) => ({ messages: [historyReceipt(n + 1)], nextPageToken: token(n + 1) })));
    expect(await resolveCastAlias(input)).toMatchObject({ candidates: [], complete: false, scanned: 4, continuation: { cursor: token(4) } });
  });
  it('uses direct author-scoped lookup for a full hash without reading history', async () => {
    const fetch = install([]);
    expect(await resolveCastAlias({ ...input, hashPrefix: hash() })).toEqual({ author, candidates: [cast()], complete: true, scanned: 0 }); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([
    { authorIdentifier: '../alice' }, { authorIdentifier: '0' }, { authorIdentifier: '4294967296' }, { hashPrefix: '0xabcd' }, { hashPrefix: '0x123456789' }, { hashPrefix: `0x${'a'.repeat(42)}` },
  ])('rejects malformed authors and prefixes before a network call: %j', async changes => {
    const fetch = install([]); await expect(resolveCastAlias({ ...input, ...changes })).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { hash: '0x1234' }, { data: { ...message().data, fid: 11 } }, { data: { ...message().data, type: 'MESSAGE_TYPE_REACTION_ADD' } },
    { data: { ...message().data, network: 'FARCASTER_NETWORK_TESTNET' } }, { data: { ...message().data, timestamp: -1 } }, { data: { ...message().data, castAddBody: null } },
  ])('rejects malformed or unrelated history instead of inferring absence: %j', async changes => {
    const fetch = install([{ messages: [{ ...message(), ...changes }] }]);
    await expect(resolveCastAlias(input)).rejects.toMatchObject({ code: 'invalid_response' }); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([cast(hash(2)), cast(hash(), 11), { ...cast(), timestamp: 'invalid' }, { ...cast(), embeds: null }])('rejects mismatched or malformed canonical hydration', async value => {
    install([{ messages: [message()] }], () => json({ cast: value }));
    await expect(resolveCastAlias(input)).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('skips only a verified removed/pruned cast and propagates generic 404 errors', async () => {
    install([{ messages: [message()] }], () => json({ code: 'cast_not_found', message: 'Missing cast' }, 404));
    expect(await resolveCastAlias(input)).toMatchObject({ complete: true, candidates: [] });
    install([{ messages: [message()] }], () => json({ code: 'upstream_error', message: 'Unavailable' }, 404));
    await expect(resolveCastAlias(input)).rejects.toMatchObject({ code: 'upstream_error', status: 404 });
    install([], () => json({ code: 'cast_not_found' }, 404));
    expect(await resolveCastAlias({ ...input, hashPrefix: hash() })).toMatchObject({ complete: true, candidates: [] });
  });
  it('rejects a different requested numeric author before any history read', async () => {
    const fetch = install([], undefined, { ...author, fid: 11 });
    await expect(resolveCastAlias({ ...input, authorIdentifier: '10' })).rejects.toMatchObject({ code: 'invalid_response' }); expect(fetch).toHaveBeenCalledOnce();
  });
  it('rejects repeated and malformed page tokens without claiming complete history', async () => {
    install([{ messages: [historyReceipt(1)], nextPageToken: token(1) }, { messages: [historyReceipt(2)], nextPageToken: token(1) }]);
    await expect(resolveCastAlias(input)).rejects.toMatchObject({ code: 'invalid_pagination' });
    install([{ messages: [historyReceipt(1)], nextPageToken: 'Zh==' }]); await expect(resolveCastAlias(input)).rejects.toMatchObject({ code: 'invalid_pagination' });
  });
  it.each([
    { label: 'Hyper shadow namespace', cursor: cursorFor(historyReceipt(1), { root: 30 }) },
    { label: 'different author FID', cursor: cursorFor(historyReceipt(1), { fid: 11 }) },
    { label: 'different message postfix', cursor: cursorFor(historyReceipt(1), { postfix: 2 }) },
    { label: 'truncated native key', cursor: cursorFor(historyReceipt(1), { length: 29 }) },
    { label: 'oversized native key', cursor: cursorFor(historyReceipt(1), { length: 31 }) },
    { label: 'null instead of omitted EOF', cursor: null },
  ])('rejects $label pagination instead of claiming complete history', async ({ cursor }) => {
    const fetch = install([{ messages: [historyReceipt(1)], nextPageToken: cursor }]);
    await expect(resolveCastAlias(input)).rejects.toMatchObject({ code: 'invalid_pagination' }); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects a native cursor that skips beyond the last receipt and an empty nonterminal page', async () => {
    install([{ messages: [historyReceipt(1)], nextPageToken: token(2) }]);
    await expect(resolveCastAlias(input)).rejects.toMatchObject({ code: 'invalid_pagination' });
    install([{ messages: [], nextPageToken: token(1) }]);
    await expect(resolveCastAlias(input)).rejects.toMatchObject({ code: 'invalid_pagination' });
  });
  it('accepts native descending hash order for casts sharing a timestamp', async () => {
    install([{ messages: [message(hash(2)), message(hash())] }]);
    expect((await resolveCastAlias(input)).candidates.map(value => value.hash)).toEqual([hash(2), hash()]);
  });
  it.each([
    { label: 'ascending timestamps', messages: [historyReceipt(2), historyReceipt(1)] },
    { label: 'duplicate native receipt key', messages: [historyReceipt(1), historyReceipt(1)] },
    { label: 'ascending hash for equal timestamps', messages: [message(hash()), message(hash(2))] },
  ])('rejects $label instead of treating unordered history as exhausted', async ({ messages }) => {
    install([{ messages }]); await expect(resolveCastAlias(input)).rejects.toMatchObject({ code: 'invalid_pagination' });
  });
  it.each([historyReceipt(1), historyReceipt(0)])('rejects a page that does not begin below the exclusive incoming cursor: %j', async receipt => {
    install([{ messages: [historyReceipt(1)], nextPageToken: token(1) }, { messages: [receipt] }]);
    await expect(resolveCastAlias(input)).rejects.toMatchObject({ code: 'invalid_pagination' });
  });
  it('rejects oversized history pages', async () => {
    install([{ messages: ordered(Array.from({ length: 251 }, (_, n) => message(unrelatedHash(n)))) }]);
    await expect(resolveCastAlias(input)).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('binds continuation state to the original author, prefix and safe cursor', async () => {
    const state: CastAliasContinuation = { authorIdentifier: 'alice', hashPrefix: prefix, fid: 10, cursor: token(4), seenCursors: [token(1)], hashes: [hash()], scanned: 1000 };
    for (const changes of [{ authorIdentifier: 'bob' }, { hashPrefix: '0x12345678' }, { cursor: 'Zh==' }, { cursor: cursorFor(historyReceipt(4), { root: 30 }) }, { cursor: cursorFor(historyReceipt(4), { fid: 11 }) }, { cursor: cursorFor(historyReceipt(4), { postfix: 2 }) }, { cursor: cursorFor(historyReceipt(4), { length: 29 }) }, { cursor: cursorFor(historyReceipt(4), { length: 31 }) }, { seenCursors: [token(4)] }, { seenCursors: [token(2), token(1)] }, { cursor: token(1), seenCursors: [token(2)] }, { hashes: [otherHash] }, { scanned: -1 }]) {
      const fetch = install([]); await expect(resolveCastAlias({ ...input, continuation: { ...state, ...changes } })).rejects.toThrow('continuation'); expect(fetch).not.toHaveBeenCalled();
    }
    const fetch = install([], undefined, { ...author, fid: 11 });
    await expect(resolveCastAlias({ ...input, continuation: state })).rejects.toMatchObject({ code: 'account_changed' }); expect(fetch).toHaveBeenCalledOnce();
  });
  it('limits candidate hydration to four concurrent public reads', async () => {
    let active = 0, maximum = 0;
    install([{ messages: ordered(Array.from({ length: 9 }, (_, n) => message(hash(n + 1)))) }], async url => {
      active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 1)); active--;
      return json({ cast: cast(`0x${url.searchParams.get('identifier')}`) });
    });
    expect((await resolveCastAlias(input)).candidates).toHaveLength(9); expect(maximum).toBe(4);
  });
  it('stops at the candidate cap without presenting a partial collision set as complete', async () => {
    install([{ messages: ordered(Array.from({ length: 26 }, (_, n) => message(hash(n + 1)))) }]);
    const result = await resolveCastAlias(input);
    expect(result).toMatchObject({ complete: false, limited: true }); expect(result.continuation).toBeUndefined(); expect(result.candidates).toHaveLength(25);
  });
  it('stops at the cumulative history cap with an honest incomplete result', async () => {
    const continuation: CastAliasContinuation = { authorIdentifier: 'alice', hashPrefix: prefix, fid: 10, cursor: token(1), seenCursors: [], hashes: [], scanned: 99_999 };
    install([{ messages: [historyReceipt(2)], nextPageToken: token(2) }]);
    expect(await resolveCastAlias({ ...input, continuation })).toMatchObject({ complete: false, limited: true, scanned: 100_000 });
  });
  it('limits a final exhausted page to the remaining history budget and ignores matches beyond it', async () => {
    const continuation: CastAliasContinuation = { authorIdentifier: 'alice', hashPrefix: prefix, fid: 10, cursor: token(1), seenCursors: [], hashes: [], scanned: 99_999 };
    const fetch = install([{ messages: [historyReceipt(2), historyReceipt(3, hash())] }]);
    const result = await resolveCastAlias({ ...input, continuation });
    expect(result).toEqual({ author, candidates: [], complete: false, limited: true, scanned: 100_000 }); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('can prove exhaustion when the final page exactly fits the remaining budget', async () => {
    const continuation: CastAliasContinuation = { authorIdentifier: 'alice', hashPrefix: prefix, fid: 10, cursor: token(1), seenCursors: [], hashes: [], scanned: 99_999 };
    install([{ messages: [historyReceipt(2)] }]);
    expect(await resolveCastAlias({ ...input, continuation })).toEqual({ author, candidates: [], complete: true, scanned: 100_000 });
  });
  it('does no read for an already cancelled lookup', async () => {
    const fetch = install([]); const controller = new AbortController(); controller.abort();
    await expect(resolveCastAlias({ ...input, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(fetch).not.toHaveBeenCalled();
  });
  it('suppresses a history response that arrives after cancellation', async () => {
    let deliver!: (value: Response) => void;
    const fetch = vi.fn().mockResolvedValueOnce(json({ user: author })).mockImplementationOnce(() => new Promise<Response>(resolve => { deliver = resolve; }));
    vi.stubGlobal('fetch', fetch); const controller = new AbortController();
    const pending = resolveCastAlias({ ...input, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); controller.abort(); deliver(json({ messages: [message()] }));
    await rejected; expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('suppresses progressive hydration that arrives after caller cancellation', async () => {
    const hydration = deferred<Response>(); const receipt = historyReceipt(1, hash());
    const fetch = install([{ messages: [receipt], nextPageToken: cursorFor(receipt) }], () => hydration.promise);
    const onProgress = vi.fn(); const controller = new AbortController();
    const pending = resolveCastAlias({ ...input, onProgress, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    controller.abort(); hydration.resolve(json({ cast: cast() }));
    await rejected; expect(onProgress).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('suppresses progressive hydration that arrives after the shared deadline', async () => {
    vi.useFakeTimers(); const hydration = deferred<Response>(); const receipt = historyReceipt(1, hash());
    const fetch = install([{ messages: [receipt], nextPageToken: cursorFor(receipt) }], () => hydration.promise);
    const onProgress = vi.fn();
    const pending = resolveCastAlias({ ...input, onProgress });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'timeout', status: 504 });
    await vi.advanceTimersByTimeAsync(0); expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(25_001); hydration.resolve(json({ cast: cast() }));
    await rejected; expect(onProgress).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('rejects a late direct missing-cast response after caller cancellation rather than returning an empty result', async () => {
    let deliver!: (value: Response) => void;
    const fetch = install([], () => new Promise<Response>(resolve => { deliver = resolve; })); const controller = new AbortController();
    const pending = resolveCastAlias({ ...input, hashPrefix: hash(), signal: controller.signal }); const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); controller.abort(); deliver(json({ code: 'cast_not_found' }, 404));
    await rejected; expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects a late direct missing-cast response after the shared deadline rather than claiming absence', async () => {
    vi.useFakeTimers(); let deliver!: (value: Response) => void;
    const fetch = install([], () => new Promise<Response>(resolve => { deliver = resolve; }));
    const pending = resolveCastAlias({ ...input, hashPrefix: hash() }); const rejected = expect(pending).rejects.toMatchObject({ code: 'timeout', status: 504 });
    await vi.advanceTimersByTimeAsync(0); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(25_001); deliver(json({ code: 'cast_not_found' }, 404)); await rejected;
  });
  it('shares one deadline across author/history reads and canonical hydration', async () => {
    vi.useFakeTimers();
    install([{ messages: [message()] }], (_url, options) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(json({ cast: cast() })), 30_000);
      options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal?.reason); }, { once: true });
    }));
    const pending = resolveCastAlias(input); const rejected = expect(pending).rejects.toMatchObject({ code: 'timeout', status: 504 });
    await vi.advanceTimersByTimeAsync(25_001); await rejected;
  });
  it('rejects a conversation whose root does not match the requested full hash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ conversation: { cast: cast(hash(2)) } })));
    await expect(getConversation(hash())).rejects.toBeInstanceOf(ApiError);
    await expect(getConversation(hash())).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
