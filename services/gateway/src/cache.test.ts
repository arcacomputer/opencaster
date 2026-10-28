import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, type Env, type WorkerExecutionContext } from './index';
import { ORIGIN_TOKEN_HEADER } from './upstream';

const BASE = 'https://opencaster.org';
const NODE = 'https://node.example.test';
const TOKEN = 'synthetic-origin-token_0123456789-abcdef';
const env: Env = { ASSETS: { fetch: vi.fn() }, HYPERSNAP_ORIGIN: NODE, HYPERSNAP_ORIGIN_TOKEN: TOKEN };
const trustedEnv: Env = { ...env, HYPERSNAP_AGGREGATE_CACHE: 'trusted-origin-v1' };
const failoverEnv: Env = { ...trustedEnv, HYPERSNAP_READ_FALLBACK: 'haatz-v1' };
const BACKUP = 'https://haatz.quilibrium.com';
const HINT = 'X-Opencaster-Aggregate-Cache';
const trustedHeaders = { 'Cache-Control': 'no-store', [HINT]: 'public-aggregate-v1' };
const trending = '/v2/farcaster/feed/trending?limit=20&time_window=24h';
const json = (value: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const request = (path = trending, headers: HeadersInit = {}) => new Request(`${BASE}/api${path}`, { headers });

/** Cache API test double only. Production has no in-memory fallback. Enforce
 * TTL just as Cache API match does, and clone streams to exercise repeated hits. */
function edge() {
  const entries = new Map<string, { response: Response; expires: number }>();
  const tasks: Promise<unknown>[] = [];
  const cache = {
    match: vi.fn(async (key: Request) => {
      const hit = entries.get(key.url);
      return hit && hit.expires > Date.now() ? hit.response.clone() : undefined;
    }),
    put: vi.fn(async (key: Request, response: Response) => {
      const ttl = Number(response.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1] ?? 0);
      entries.set(key.url, { response: response.clone(), expires: Date.now() + ttl * 1000 });
    }),
  };
  const ctx: WorkerExecutionContext = { waitUntil: vi.fn(task => { tasks.push(task); }) };
  vi.stubGlobal('caches', { default: cache });
  return { cache, entries, ctx, drain: async () => { await Promise.all(tasks.splice(0)); } };
}
function upstream(value: unknown = { casts: [], next: {} }) {
  const fetch = vi.fn().mockImplementation(async () => json(value)); vi.stubGlobal('fetch', fetch); return fetch;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('per-upstream cache isolation during read failover', () => {
  it('consults backup only after primary failure; recovered primary and its cache take precedence over a warm backup', async () => {
    const { ctx, cache, entries, drain } = edge(); const fetch = upstream();
    fetch.mockResolvedValueOnce(json({ code: 'primary_index_not_ready' }, 503, { 'Cache-Control': 'no-store' }));
    fetch.mockResolvedValueOnce(json({ casts: [{ hash: 'backup' }] }));
    const first = await handleRequest(request(), failoverEnv, ctx);
    expect(first.headers.get('X-Opencaster-Upstream')).toBe('backup'); expect(await first.json()).toEqual({ casts: [{ hash: 'backup' }] }); await drain();
    expect(cache.match.mock.calls.map(([key]) => new URL(key.url).searchParams.get('upstream'))).toEqual([NODE, BACKUP]);
    expect(new URL(cache.put.mock.calls[0][0].url).searchParams.get('upstream')).toBe(BACKUP);
    // A stored spoof cannot change attribution: only the key selected by this
    // request counts, and upstream response headers are reconstructed away.
    for (const entry of entries.values()) entry.response.headers.set('X-Opencaster-Upstream', 'primary');
    cache.match.mockClear();
    fetch.mockResolvedValueOnce(json({ casts: [{ hash: 'primary' }] }, 200, trustedHeaders));
    const recovered = await handleRequest(request(), failoverEnv, ctx); await drain();
    expect(recovered.headers.get('X-Opencaster-Upstream')).toBe('primary'); expect(await recovered.json()).toEqual({ casts: [{ hash: 'primary' }] });
    const hit = await handleRequest(request(), failoverEnv, ctx);
    expect(hit.headers.get('X-Opencaster-Upstream')).toBe('primary'); expect(await hit.json()).toEqual({ casts: [{ hash: 'primary' }] });
    expect(fetch).toHaveBeenCalledTimes(3); expect(cache.match).toHaveBeenCalledTimes(2);
    for (const [key] of cache.match.mock.calls) expect(new URL(key.url).searchParams.get('upstream')).toBe(NODE);
    for (const key of entries.keys()) if (new URL(key).searchParams.get('upstream') === NODE) entries.delete(key);
    fetch.mockResolvedValueOnce(json({ code: 'primary_index_not_ready' }, 503));
    const backupHit = await handleRequest(request(), failoverEnv, ctx);
    expect(backupHit.headers.get('X-Opencaster-Upstream')).toBe('backup'); expect(await backupHit.json()).toEqual({ casts: [{ hash: 'backup' }] });
    expect(fetch).toHaveBeenCalledTimes(4); expect(cache.put).toHaveBeenCalledTimes(2);
    for (const [key, response] of cache.put.mock.calls) { expect(key.url).not.toContain(TOKEN); expect(response.headers.has(HINT)).toBe(false); expect(response.headers.has(ORIGIN_TOKEN_HEADER)).toBe(false); }
  });

  it.each([401, 403, 404, 429, 307])('does not consult a warm backup namespace for primary HTTP %s', async status => {
    const { ctx, cache, drain } = edge(); const fetch = upstream();
    await handleRequest(request(), { ASSETS: env.ASSETS }, ctx); await drain(); cache.match.mockClear(); cache.put.mockClear(); fetch.mockClear();
    fetch.mockResolvedValueOnce(json({}, status)); const result = await handleRequest(request(), failoverEnv, ctx);
    expect(result.status).toBeGreaterThanOrEqual(400); expect(result.headers.get('X-Opencaster-Upstream')).toBe('primary'); expect(fetch).toHaveBeenCalledOnce();
    expect(cache.match).toHaveBeenCalledOnce(); expect(new URL(cache.match.mock.calls[0][0].url).searchParams.get('upstream')).toBe(NODE); expect(cache.put).not.toHaveBeenCalled();
  });

  it.each([
    ['no-store public hint', () => json({ casts: [] }, 200, trustedHeaders)],
    ['private', () => json({ casts: [] }, 200, { 'Cache-Control': 'private' })],
    ['no-cache', () => json({ casts: [] }, 200, { 'Cache-Control': 'no-cache' })],
    ['cookie', () => json({ casts: [] }, 200, { 'Set-Cookie': 'private' })],
    ['vary', () => json({ casts: [] }, 200, { Vary: 'Cookie' })],
    ['HTTP error', () => json({ casts: [] }, 503)],
    ['redirect', () => new Response(null, { status: 307, headers: { Location: 'https://attacker.example' } })],
    ['semantic error', () => json({ casts: [], error: 'Unauthorized' })],
    ['wrong shape', () => json({ channels: [] })],
    ['malformed JSON', () => new Response('{', { headers: { 'Content-Type': 'application/json' } })],
    ['oversized', () => new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } })],
    ['reflected primary credential', () => json({ casts: [], value: TOKEN })],
  ] as const)('never caches backup %s or trusts its gate hint', async (_label, makeResponse) => {
    const { ctx, cache, drain } = edge(); const fetch = upstream();
    for (let i = 0; i < 2; i++) {
      fetch.mockResolvedValueOnce(json({}, 503)); fetch.mockResolvedValueOnce(makeResponse());
      const result = await handleRequest(request(trending, { [HINT]: 'public-aggregate-v1' }), failoverEnv, ctx);
      expect(result.headers.get('X-Opencaster-Upstream')).toBe('backup'); expect(result.headers.get('Cache-Control')).toBe('no-store'); expect(await result.text()).not.toContain(TOKEN); await drain();
      expect(result.headers.has(HINT)).toBe(false); expect(result.headers.has('Set-Cookie')).toBe(false);
    }
    expect(fetch).toHaveBeenCalledTimes(4); expect(cache.put).not.toHaveBeenCalled();
    for (const [url, init] of fetch.mock.calls) if (new URL(url).origin === BACKUP) expect([...init.headers]).toEqual([['accept', 'application/json']]);
  });

  it.each([
    ['/v1/signersByFid?fid=3', {}], ['/v2/farcaster/user?fid=3', {}], ['/v2/farcaster/notifications?fid=3', {}],
    ['/v2/farcaster/feed/following?fid=3', {}], ['/v2/farcaster/feed/trending?cursor=next', {}],
    [trending, { Cookie: 'session=private' }], [trending, { Authorization: 'Bearer private' }],
  ] as const)('keeps both cache namespaces out of personalized/credentialed failover: %s %j', async (path, headers) => {
    const { ctx, cache, drain } = edge(); const fetch = upstream(); fetch.mockResolvedValueOnce(json({}, 503));
    const result = await handleRequest(request(path, headers), failoverEnv, ctx); await drain();
    expect(result.status).toBe(200); expect(result.headers.get('X-Opencaster-Upstream')).toBe('backup'); expect(fetch).toHaveBeenCalledTimes(2); expect(cache.match).not.toHaveBeenCalled(); expect(cache.put).not.toHaveBeenCalled();
  });

  it('preserves one coarse analytics event on a backup cache hit, after primary failure', async () => {
    vi.useFakeTimers(); const { ctx, drain } = edge(); const fetch = upstream(); const writeDataPoint = vi.fn();
    const settings = { ...failoverEnv, ANALYTICS: { writeDataPoint } };
    fetch.mockResolvedValueOnce(json({}, 503)); expect((await handleRequest(request(), settings, ctx)).status).toBe(200); await drain(); writeDataPoint.mockClear();
    fetch.mockResolvedValueOnce(json({}, 503)); const result = await handleRequest(request(), settings, ctx);
    expect(result.headers.get('X-Opencaster-Upstream')).toBe('backup'); expect(fetch).toHaveBeenCalledTimes(3);
    expect(writeDataPoint.mock.calls).toEqual([[{ blobs: ['request', 'api', '2xx', 'XX', 'other', 'other'], doubles: [1, 0], indexes: ['opencaster'] }]]);
    for (const value of [TOKEN, NODE, BACKUP, HINT, trending, 'haatz-v1']) expect(JSON.stringify(writeDataPoint.mock.calls)).not.toContain(value);
  });
});

describe('bounded public aggregate edge cache', () => {
  it.each([
    [trending, { casts: [{ hash: 'synthetic' }], next: { cursor: 'next' } }, 30],
    ['/v2/farcaster/channel/all?limit=20', { channels: [{ id: 'art' }], next: {} }, 60],
    ['/v2/farcaster/channel/trending?limit=20', { channels: [], next: {} }, 60],
    ['/v1/info', { version: 'synthetic' }, 15],
    ['/v2/farcaster/channel?id=art&type=id', { channel: { id: 'art' } }, 60],
  ] as const)('fills a cold cache and serves sanitized hits for %s without another upstream call', async (path, value, ttl) => {
    const { cache, ctx, drain } = edge();
    const fetch = upstream();
    fetch.mockImplementation(async () => json(value, 200, { 'X-Private-Upstream': TOKEN, [ORIGIN_TOKEN_HEADER]: TOKEN, Location: `https://example.test/${TOKEN}` }));
    for (let i = 0; i < 3; i++) {
      const result = await handleRequest(request(path, { [ORIGIN_TOKEN_HEADER]: 'browser-spoof' }), env, ctx);
      expect(result.status).toBe(200); expect(await result.json()).toEqual(value);
      expect(result.headers.get('Cache-Control')).toBe('no-store'); expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(result.headers.has('X-Private-Upstream')).toBe(false); expect(result.headers.has(ORIGIN_TOKEN_HEADER)).toBe(false); expect(result.headers.has('Location')).toBe(false);
      await drain();
    }
    expect(fetch).toHaveBeenCalledOnce(); expect(cache.match).toHaveBeenCalledTimes(3); expect(cache.put).toHaveBeenCalledOnce(); expect(ctx.waitUntil).toHaveBeenCalledOnce();
    const [key, stored] = cache.put.mock.calls[0];
    const identity = new URL(key.url);
    expect(identity.searchParams.get('upstream')).toBe(NODE); expect(key.url).not.toContain(TOKEN); expect(key.url).not.toContain('browser-spoof'); expect([...key.headers]).toEqual([]);
    expect(stored.headers.get('Cache-Control')).toBe(`public, max-age=${ttl}`); expect(JSON.stringify([...stored.headers])).not.toContain(TOKEN); expect(await stored.text()).not.toContain(TOKEN);
  });

  it('expires after 30 seconds and does not claim that a cache hit solves a cold-node timeout', async () => {
    vi.useFakeTimers(); const { ctx, drain } = edge(); const fetch = upstream();
    await handleRequest(request(), env, ctx); await drain();
    await vi.advanceTimersByTimeAsync(29_999); await handleRequest(request(), env, ctx); expect(fetch).toHaveBeenCalledOnce();
    fetch.mockImplementationOnce((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))));
    await vi.advanceTimersByTimeAsync(1);
    const pending = handleRequest(request(), env, ctx);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending; expect(result.status).toBe(504); expect(await result.json()).toMatchObject({ code: 'timeout' });
    await drain(); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('separates upstreams, window and limit; normalizes query ordering/numeric padding but never uses token identity', async () => {
    const { ctx, drain, cache } = edge(); const fetch = upstream();
    for (const [path, settings] of [
      [trending, env],
      ['/v2/farcaster/feed/trending?time_window=24h&limit=020', env],
      [trending, { ...env, HYPERSNAP_ORIGIN_TOKEN: '_'.repeat(32) }],
      [trending.replace('24h', '7d'), env],
      [trending.replace('limit=20', 'limit=21'), env],
      [trending, { ...env, HYPERSNAP_ORIGIN: 'https://another.example.test' }],
      [trending, { ASSETS: env.ASSETS }],
    ] as const) { expect((await handleRequest(request(path), settings, ctx)).status).toBe(200); await drain(); }
    expect(fetch).toHaveBeenCalledTimes(5); expect(cache.put).toHaveBeenCalledTimes(5);
    for (const [key] of cache.put.mock.calls) { expect(key.url).not.toContain(TOKEN); expect(key.url).not.toContain('_'.repeat(32)); }
  });

  it('validates method, origin, path, query and configuration before cache lookup even with an existing hit', async () => {
    const { ctx, drain, cache } = edge(); const fetch = upstream();
    await handleRequest(request(), env, ctx); await drain(); cache.match.mockClear();
    for (const candidate of [
      request(`${trending}&fid=3`), request(`${trending}&limit=30`), request(`${trending}&time_window=24h`), request(`${trending}&cursor=`),
      request(trending.replace('limit=20', 'limit=101')), request(trending.replace('24h', '30d')),
      request(trending, { Origin: 'https://attacker.example' }), request(trending, { 'Sec-Fetch-Site': 'cross-site' }),
      request('/v2/farcaster/feed%2Ftrending'), new Request(`${BASE}/api${trending}`, { method: 'POST' }),
    ]) expect((await handleRequest(candidate, env, ctx)).status).toBeGreaterThanOrEqual(400);
    const invalid = await handleRequest(request(), { ...env, HYPERSNAP_ORIGIN_TOKEN: undefined }, ctx);
    expect(invalid.status).toBe(503); expect(cache.match).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    '/v1/signersByFid?fid=3', '/v1/onChainIdRegistryEventByAddress?address=0x' + 'a'.repeat(40),
    '/v1/linkById?fid=3&link_type=follow&target_fid=4',
    '/v1/reactionById?fid=3&reaction_type=Like&target_fid=4&target_hash=' + 'a'.repeat(40),
    '/v2/farcaster/user?fid=3', '/v2/farcaster/notifications?fid=3', '/v2/farcaster/feed/following?fid=3',
    '/v2/farcaster/feed/user/casts?fid=3', '/v2/farcaster/feed/channels?channel_ids=art',
    '/v2/farcaster/following/suggested?fid=3&limit=20',
    '/v2/farcaster/channel/search?q=art', '/v2/farcaster/channel/members?channel_id=art&limit=25',
    '/v2/farcaster/channel/all?cursor=next', '/v2/farcaster/feed/trending?cursor=next',
    '/v2/farcaster/cast/search?q=art',
  ])('never looks up or stores nonaggregate/personalized/paginated read: %s', async path => {
    const { ctx, drain, cache } = edge(); const fetch = upstream();
    for (let i = 0; i < 2; i++) expect((await handleRequest(request(path), env, ctx)).status).toBe(200);
    await drain(); expect(fetch).toHaveBeenCalledTimes(2); expect(cache.match).not.toHaveBeenCalled(); expect(cache.put).not.toHaveBeenCalled();
  });

  it.each<HeadersInit>([{ Cookie: 'session=private' }, { Authorization: 'Bearer private' }])('bypasses aggregate caching for browser credential headers %j', async headers => {
    const { ctx, drain, cache } = edge(); const fetch = upstream();
    for (let i = 0; i < 2; i++) expect((await handleRequest(request(trending, headers), env, ctx)).status).toBe(200);
    await drain(); expect(fetch).toHaveBeenCalledTimes(2); expect(cache.match).not.toHaveBeenCalled(); expect(cache.put).not.toHaveBeenCalled();
  });

  it('never caches signed writes or analytics events', async () => {
    const { ctx, drain, cache } = edge(); const fetch = upstream();
    for (let i = 0; i < 2; i++) {
      expect((await handleRequest(new Request(`${BASE}/api/v1/submitMessage`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([8, 1]) }), env, ctx)).status).toBe(200);
      await handleRequest(new Request(`${BASE}/_analytics/events`, { method: 'POST' }), env, ctx);
    }
    await drain(); expect(fetch).toHaveBeenCalledTimes(2); expect(cache.match).not.toHaveBeenCalled(); expect(cache.put).not.toHaveBeenCalled();
  });

  it.each([
    ['error status', () => json({ casts: [], error: TOKEN }, 503)],
    ['redirect', () => new Response(null, { status: 302, headers: { Location: `https://attacker.example/${TOKEN}` } })],
    ['wrong content type', () => new Response('<html>not JSON</html>')],
    ['malformed JSON', () => new Response('{', { headers: { 'Content-Type': 'application/json' } })],
    ['array', () => json([])], ['null', () => json(null)],
    ['oversized body', () => new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } })],
    ['reflected token', () => json({ casts: [], nested: { token: TOKEN } })],
    ['HTTP 200 error', () => json({ casts: [], error: 'failure' })],
    ['wrong aggregate shape', () => json({ channels: [] })],
    ['non-200 success', () => json({ casts: [] }, 201)],
    ['sets cookie', () => json({ casts: [] }, 200, { 'Set-Cookie': 'session=private' })],
    ['varies', () => json({ casts: [] }, 200, { Vary: 'Authorization' })],
    ['private', () => json({ casts: [] }, 200, { 'Cache-Control': 'private' })],
    ['no-store', () => json({ casts: [] }, 200, { 'Cache-Control': 'no-store' })],
  ] as const)('never stores %s responses', async (_label, makeResponse) => {
    const { ctx, drain, cache } = edge(); const fetch = upstream(); fetch.mockImplementation(async () => makeResponse());
    for (let i = 0; i < 2; i++) {
      const result = await handleRequest(request(), env, ctx); expect(await result.text()).not.toContain(TOKEN);
      expect(result.headers.has('Set-Cookie')).toBe(false); await drain();
    }
    expect(fetch).toHaveBeenCalledTimes(2); expect(cache.put).not.toHaveBeenCalled();
  });

  it('skips cache entirely without waitUntil or the Cloudflare Cache API', async () => {
    const { ctx, cache } = edge(); const fetch = upstream();
    for (let i = 0; i < 2; i++) expect((await handleRequest(request(), env)).status).toBe(200);
    expect(cache.match).not.toHaveBeenCalled(); expect(cache.put).not.toHaveBeenCalled();
    vi.stubGlobal('caches', undefined);
    for (let i = 0; i < 2; i++) expect((await handleRequest(request(), env, ctx)).status).toBe(200);
    expect(ctx.waitUntil).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('treats cache read/write failures as optional and handles a disabled waitUntil without a rejection', async () => {
    const { ctx, cache, drain } = edge(); const fetch = upstream();
    cache.match.mockRejectedValueOnce(new Error('cache unavailable')); cache.put.mockRejectedValueOnce(new Error('cache full'));
    expect((await handleRequest(request(), env, ctx)).status).toBe(200); await drain();
    expect((await handleRequest(request(), env, { waitUntil: () => { throw new Error('disabled'); } })).status).toBe(200);
    await drain(); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('falls back from a stalled lookup at 200ms, authenticating the real node', async () => {
    vi.useFakeTimers(); const { ctx, cache, drain } = edge(); const fetch = upstream();
    cache.match.mockImplementationOnce(() => new Promise(() => {}));
    const pending = handleRequest(request(), env, ctx);
    await vi.advanceTimersByTimeAsync(199); expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending; expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ casts: [], next: {} });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].headers.get(ORIGIN_TOKEN_HEADER)).toBe(TOKEN);
    await drain(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['resolve', 'reject'] as const)('handles a lookup that %ss after fallback, cancelling late streams without waiting for cancellation', async outcome => {
    vi.useFakeTimers(); const { ctx, cache, drain } = edge(); const fetch = upstream();
    let resolve!: (value: Response) => void; let reject!: (error: Error) => void;
    cache.match.mockImplementationOnce(() => new Promise<Response>((yes, no) => { resolve = yes; reject = no; }));
    const cancel = vi.fn(() => Promise.reject(new Error('optional cancellation failed')));
    const late = new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'application/json' } });
    const pending = handleRequest(request(), env, ctx);
    await vi.advanceTimersByTimeAsync(200); expect((await pending).status).toBe(200); await drain();
    if (outcome === 'resolve') resolve(late); else reject(new Error('late cache failure'));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledTimes(outcome === 'resolve' ? 1 : 0);
    expect(fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['pending', 'reject'] as const)('bounds combined lookup/body time and cancels stalled body even when cancellation is %s', async cancellation => {
    vi.useFakeTimers(); const { ctx, cache, drain } = edge(); const fetch = upstream();
    const cancel = vi.fn(() => cancellation === 'pending' ? new Promise<void>(() => {}) : Promise.reject(new Error('cancel failed')));
    const cached = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"casts":[')); }, cancel,
    }), { headers: { 'Content-Type': 'application/json' } });
    cache.match.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(cached), 150)));
    const pending = handleRequest(request(), env, ctx);
    await vi.advanceTimersByTimeAsync(199); expect(fetch).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(200); expect(cancel).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
    await drain(); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not add the optional cache budget to the original 20-second deadline', async () => {
    vi.useFakeTimers(); const { ctx, cache, drain } = edge(); const fetch = upstream();
    cache.match.mockImplementationOnce(() => new Promise(() => {}));
    fetch.mockImplementationOnce((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))));
    const pending = handleRequest(request(), env, ctx);
    await vi.advanceTimersByTimeAsync(200); expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(19_799); expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending; expect(result.status).toBe(504); expect(await result.json()).toMatchObject({ code: 'timeout' });
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true); await drain(); expect(cache.put).not.toHaveBeenCalled();
  });

  it.each([
    [trending, { casts: [], next: {} }, 30],
    ['/v2/farcaster/channel/all?limit=20', { channels: [], next: {} }, 60],
    ['/v2/farcaster/channel/trending?limit=20', { channels: [], next: {} }, 60],
    ['/v1/info', { version: 'synthetic' }, 15],
    ['/v2/farcaster/channel?id=art&type=id', { channel: { id: 'art' } }, 60],
  ] as const)('caches gate no-store only with private configuration plus exact opt-in and trusted response hint: %s', async (path, value, ttl) => {
    const { ctx, cache, drain } = edge(); const fetch = upstream();
    fetch.mockImplementation(async () => json(value, 200, { ...trustedHeaders, [ORIGIN_TOKEN_HEADER]: TOKEN, 'X-Private-Upstream': TOKEN }));
    for (let i = 0; i < 2; i++) {
      const response = await handleRequest(request(path, { [HINT]: 'browser-spoof' }), trustedEnv, ctx);
      expect(response.status).toBe(200); expect(await response.json()).toEqual(value);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      for (const name of [HINT, ORIGIN_TOKEN_HEADER, 'X-Private-Upstream']) expect(response.headers.has(name)).toBe(false);
      await drain();
    }
    expect(fetch).toHaveBeenCalledOnce(); expect(cache.put).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].headers.has(HINT)).toBe(false);
    const [key, stored] = cache.put.mock.calls[0];
    expect([...key.headers]).toEqual([]); expect(key.url).not.toContain(TOKEN); expect(key.url).not.toContain('browser-spoof');
    expect(stored.headers.get('Cache-Control')).toBe(`public, max-age=${ttl}`);
    for (const name of [HINT, ORIGIN_TOKEN_HEADER, 'X-Private-Upstream']) expect(stored.headers.has(name)).toBe(false);
  });

  it.each([
    ['no opt-in', env, 'public-aggregate-v1'],
    ['unknown opt-in', { ...env, HYPERSNAP_AGGREGATE_CACHE: 'trusted-origin-v2' }, 'public-aggregate-v1'],
    ['case-changed opt-in', { ...env, HYPERSNAP_AGGREGATE_CACHE: 'TRUSTED-ORIGIN-V1' }, 'public-aggregate-v1'],
    ['padded opt-in', { ...env, HYPERSNAP_AGGREGATE_CACHE: 'trusted-origin-v1 ' }, 'public-aggregate-v1'],
    ['no response hint', trustedEnv, undefined],
    ['unknown response hint', trustedEnv, 'public-aggregate-v2'],
    ['case-changed response hint', trustedEnv, 'PUBLIC-AGGREGATE-V1'],
    ['duplicate response hint', trustedEnv, 'public-aggregate-v1, public-aggregate-v1'],
    ['public fallback cannot attest', { ASSETS: env.ASSETS, HYPERSNAP_AGGREGATE_CACHE: 'trusted-origin-v1' }, 'public-aggregate-v1'],
  ] as const)('keeps no-store exclusion for %s even with browser-spoofed hints', async (_label, settings, hint) => {
    const { ctx, cache, drain } = edge(); const fetch = upstream();
    fetch.mockImplementation(async () => json({ casts: [] }, 200, { 'Cache-Control': 'no-store', ...(hint === undefined ? {} : { [HINT]: hint }) }));
    for (let i = 0; i < 2; i++) {
      const response = await handleRequest(request(trending, { [HINT]: 'public-aggregate-v1', HYPERSNAP_AGGREGATE_CACHE: 'trusted-origin-v1' }), settings, ctx);
      expect(response.status).toBe(200); expect(response.headers.has(HINT)).toBe(false); await drain();
    }
    expect(fetch).toHaveBeenCalledTimes(2); expect(cache.put).not.toHaveBeenCalled();
    for (const [, init] of fetch.mock.calls) expect([...init.headers.keys()]).toEqual('HYPERSNAP_ORIGIN_TOKEN' in settings && settings.HYPERSNAP_ORIGIN_TOKEN ? ['accept', ORIGIN_TOKEN_HEADER.toLowerCase()] : ['accept']);
  });

  it.each<HeadersInit>([
    { 'Cache-Control': 'private, no-store' }, { 'Cache-Control': 'no-store, no-cache' },
    { 'Cache-Control': 'no-store, PRIVATE="field"' }, { 'Cache-Control': 'NO-CACHE="field", no-store' },
    { 'Set-Cookie': 'session=private' }, { Vary: 'Authorization' }, { Vary: '*' }, { Vary: '' },
  ])('does not let the trusted hint override privacy exclusions %j', async headers => {
    const { ctx, cache, drain } = edge(); const fetch = upstream();
    fetch.mockImplementation(async () => json({ casts: [] }, 200, { ...trustedHeaders, ...headers }));
    for (let i = 0; i < 2; i++) { expect((await handleRequest(request(), trustedEnv, ctx)).status).toBe(200); await drain(); }
    expect(fetch).toHaveBeenCalledTimes(2); expect(cache.put).not.toHaveBeenCalled();
  });

  it.each([
    () => json({ casts: [], error: 'failure' }), () => json({ casts: [], errors: [] }), () => json({ casts: [], code: 'failure' }),
    () => json({ unknown: [] }), () => json([]), () => json(null), () => json({ casts: [], secret: TOKEN }),
    () => json({ casts: [] }, 503), () => json({ casts: [] }, 201),
    () => new Response(null, { status: 302, headers: { Location: 'https://attacker.example' } }),
    () => new Response('<html>not JSON</html>'),
    () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }),
  ])('never lets trusted hints approve unknown/error/malformed responses', async makeResponse => {
    const { ctx, cache, drain } = edge(); const fetch = upstream();
    fetch.mockImplementation(async () => { const response = makeResponse(); for (const [key, value] of Object.entries(trustedHeaders)) response.headers.set(key, value); return response; });
    for (let i = 0; i < 2; i++) {
      const result = await handleRequest(request(), trustedEnv, ctx); expect(await result.text()).not.toContain(TOKEN);
      expect(result.headers.has(HINT)).toBe(false); await drain();
    }
    expect(fetch).toHaveBeenCalledTimes(2); expect(cache.put).not.toHaveBeenCalled();
  });

  it.each([
    '/v1/signersByFid?fid=3', '/v2/farcaster/user?fid=3', '/v2/farcaster/notifications?fid=3',
    '/v2/farcaster/feed/following?fid=3', '/v2/farcaster/feed/user/casts?fid=3',
    '/v2/farcaster/channel/all?cursor=next', '/v2/farcaster/feed/trending?cursor=next',
  ])('does not let trusted hints approve personalized or cursor paths: %s', async path => {
    const { ctx, cache, drain } = edge(); const fetch = upstream();
    fetch.mockImplementation(async () => json({ casts: [], channels: [] }, 200, trustedHeaders));
    expect((await handleRequest(request(path), trustedEnv, ctx)).status).toBe(200); await drain();
    expect(cache.match).not.toHaveBeenCalled(); expect(cache.put).not.toHaveBeenCalled();
  });

  it('does not let trusted hints approve unallowlisted/invalid/write or Cookie/Authorization requests', async () => {
    const { ctx, cache, drain } = edge(); const fetch = upstream();
    fetch.mockImplementation(async () => json({ casts: [], channels: [] }, 200, trustedHeaders));
    for (const req of [request('/v2/farcaster/unknown'), request(`${trending}&fid=3`), request(`${trending}&limit=21`)]) {
      expect((await handleRequest(req, trustedEnv, ctx)).status).toBeGreaterThanOrEqual(400);
    }
    expect(fetch).not.toHaveBeenCalled();
    for (const req of [request(trending, { Cookie: 'private' }), request(trending, { Authorization: 'Bearer private' }),
      new Request(`${BASE}/api/v1/submitMessage`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([8, 1]) })]) {
      expect((await handleRequest(req, trustedEnv, ctx)).status).toBe(200);
    }
    await drain(); expect(fetch).toHaveBeenCalledTimes(3); expect(cache.match).not.toHaveBeenCalled(); expect(cache.put).not.toHaveBeenCalled();
  });

  it('retains coarse analytics for cache hits and configuration errors without leaking origin settings, hints or keys', async () => {
    vi.useFakeTimers(); const { ctx, cache, drain } = edge(); const fetch = upstream(); const writeDataPoint = vi.fn();
    const settings: Env = { ...trustedEnv, ANALYTICS: { writeDataPoint } };
    fetch.mockImplementation(async () => json({ casts: [] }, 200, trustedHeaders));
    expect((await handleRequest(request(), settings, ctx)).status).toBe(200); await drain(); writeDataPoint.mockClear();
    expect((await handleRequest(request(), settings, ctx)).status).toBe(200);
    expect(writeDataPoint.mock.calls).toEqual([[{ blobs: ['request', 'api', '2xx', 'XX', 'other', 'other'], doubles: [1, 0], indexes: ['opencaster'] }]]);
    const failed = await handleRequest(request(), { ...settings, HYPERSNAP_ORIGIN_TOKEN: undefined }, ctx);
    expect(failed.status).toBe(503); expect(await failed.json()).toMatchObject({ code: 'upstream_configuration_unavailable' });
    expect(writeDataPoint.mock.calls[1]).toEqual([{ blobs: ['request', 'api', '5xx', 'XX', 'other', 'other'], doubles: [1, 0], indexes: ['opencaster'] }]);
    expect(fetch).toHaveBeenCalledOnce(); expect(cache.match).toHaveBeenCalledTimes(2); expect(cache.put).toHaveBeenCalledOnce();
    const telemetry = JSON.stringify(writeDataPoint.mock.calls);
    for (const value of [TOKEN, NODE, HINT, 'trusted-origin-v1', trending, '/__opencaster_aggregate']) expect(telemetry).not.toContain(value);
  });

  it.each([
    () => json({ casts: [], secret: TOKEN }), () => json([]), () => json({ casts: [] }, 503),
    () => json({ casts: [], error: 'failure' }), () => json({ unknown: [] }),
    () => json({ casts: [] }, 200, { 'Set-Cookie': 'session=private' }),
    () => json({ casts: [] }, 200, { Vary: 'Authorization' }),
    () => json({ casts: [] }, 200, { 'Cache-Control': 'private' }),
    () => json({ casts: [] }, 200, { 'Cache-Control': 'no-cache' }),
    () => json({ casts: [] }, 200, { 'Cache-Control': 'no-store', [HINT]: 'public-aggregate-v1' }),
    () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }),
  ])('revalidates cached JSON/size/status and falls back to the actual node for corrupt entries', async makeResponse => {
    const { ctx, cache, drain } = edge(); const fetch = upstream(); cache.match.mockResolvedValueOnce(makeResponse());
    const result = await handleRequest(request(), trustedEnv, ctx); expect(result.status).toBe(200); expect(await result.json()).toEqual({ casts: [], next: {} });
    await drain(); expect(fetch).toHaveBeenCalledOnce();
  });
});


describe('reconciled byte-preserving cache responses', () => {
  it('keeps original JSON bytes on misses and hits through a trusted private origin', async () => {
    const { ctx, drain, cache } = edge();
    const bytes = '{ "casts": [], "counter": 9007199254740993, "escaped": "\\u0061" }\n';
    const fetch = vi.fn().mockImplementation(async () => new Response(bytes, { headers: { 'Content-Type': 'application/json', ...trustedHeaders } }));
    vi.stubGlobal('fetch', fetch);
    expect(await (await handleRequest(request(), trustedEnv, ctx)).text()).toBe(bytes); await drain();
    expect(await (await handleRequest(request(), trustedEnv, ctx)).text()).toBe(bytes);
    expect(fetch).toHaveBeenCalledOnce(); expect(cache.put).toHaveBeenCalledOnce();
  });

  it('separates channel IDs and keeps trusted no-store gating for newly cached routes', async () => {
    const { ctx, drain, cache } = edge(); const fetch = upstream({ channel: { id: 'synthetic' } });
    for (const path of ['/v2/farcaster/channel?id=art&type=id', '/v2/farcaster/channel?type=id&id=music', '/v2/farcaster/channel?type=id&id=art']) {
      expect((await handleRequest(request(path), trustedEnv, ctx)).status).toBe(200); await drain();
    }
    expect(fetch).toHaveBeenCalledTimes(2); expect(cache.put).toHaveBeenCalledTimes(2);
    fetch.mockImplementation(async () => json({ version: 'synthetic' }, 200, { 'Cache-Control': 'no-store' }));
    for (let i = 0; i < 2; i++) { expect((await handleRequest(request('/v1/info'), trustedEnv, ctx)).status).toBe(200); await drain(); }
    expect(fetch).toHaveBeenCalledTimes(4); expect(cache.put).toHaveBeenCalledTimes(2);
  });
});
