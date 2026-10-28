import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, type Env } from './index';
import { ORIGIN_TOKEN_HEADER, resolveReadFallback, resolveUpstream } from './upstream';

const BASE = 'https://opencaster.org';
const NODE = 'https://node.example.test';
const BACKUP = 'https://haatz.quilibrium.com';
const TOKEN = 'synthetic-origin-token_0123456789-abcdef';
const env: Env = { ASSETS: { fetch: vi.fn() }, HYPERSNAP_ORIGIN: NODE, HYPERSNAP_ORIGIN_TOKEN: TOKEN, HYPERSNAP_READ_FALLBACK: 'haatz-v1' };
const json = (value: unknown = {}, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const request = (path = '/v1/info', headers: HeadersInit = {}) => new Request(`${BASE}/api${path}`, { headers });
const write = () => new Request(`${BASE}/api/v1/submitMessage`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([8, 1, 0, 255]) });
const attribution = (response: Response, value: 'primary' | 'backup') => expect(response.headers.get('X-Opencaster-Upstream')).toBe(value);
function mockFetch() {
  const fetch = vi.fn().mockImplementation(async () => json({ source: 'backup' }));
  vi.stubGlobal('fetch', fetch); return fetch;
}
function stalledBody(cancel = vi.fn(() => new Promise<void>(() => {})), status = 200) {
  return { cancel, response: new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel }), { status, headers: { 'Content-Type': 'application/json' } }) };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('bounded, server-only read failover', () => {
  it('prefers a healthy private primary and emits only a safe locally generated attribution', async () => {
    const fetch = mockFetch(); fetch.mockResolvedValueOnce(json({ source: 'primary' }, 200, { 'X-Opencaster-Upstream': TOKEN, [ORIGIN_TOKEN_HEADER]: TOKEN }));
    const response = await handleRequest(request(), env);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ source: 'primary' }); attribution(response, 'primary');
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][0]).toBe(`${NODE}/v1/info`);
    expect(response.headers.has(ORIGIN_TOKEN_HEADER)).toBe(false);
  });

  it.each([undefined, '', 'haatz-v2', 'HAATZ-V1', 'haatz-v1 ', BACKUP])('does not enable read backup with an absent/unknown server opt-in: %s', async optIn => {
    const fetch = mockFetch(); fetch.mockRejectedValueOnce(new Error(TOKEN));
    const settings = { ...env, HYPERSNAP_READ_FALLBACK: optIn };
    expect(resolveReadFallback(settings, resolveUpstream(settings))).toBeUndefined();
    const response = await handleRequest(request('/v1/info', { HYPERSNAP_READ_FALLBACK: 'haatz-v1', 'X-Opencaster-Upstream': 'backup' }), settings);
    expect(response.status).toBe(502); attribution(response, 'primary'); expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps the absent-pair public development default single-origin even with opt-in', async () => {
    const fetch = mockFetch(); fetch.mockRejectedValueOnce(new Error('transport'));
    const settings = { ASSETS: env.ASSETS, HYPERSNAP_READ_FALLBACK: 'haatz-v1' };
    expect(resolveReadFallback(settings, resolveUpstream(settings))).toBeUndefined();
    const response = await handleRequest(request(), settings);
    expect(response.status).toBe(502); attribution(response, 'primary'); expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][0]).toBe(`${BACKUP}/v1/info`);
    expect(fetch.mock.calls[0][1].headers.has(ORIGIN_TOKEN_HEADER)).toBe(false);
  });

  it.each(['fallback=haatz-v1', 'upstream=backup', 'origin=https://attacker.example', 'HYPERSNAP_READ_FALLBACK=haatz-v1'])('rejects user-controlled routing query %s before any network/cache work', async query => {
    const fetch = mockFetch(); const cache = { match: vi.fn(), put: vi.fn() }; vi.stubGlobal('caches', { default: cache });
    const response = await handleRequest(request(`/v2/farcaster/feed/trending?${query}`), env, { waitUntil: vi.fn() });
    expect(response.status).toBe(400); expect(fetch).not.toHaveBeenCalled(); expect(cache.match).not.toHaveBeenCalled(); expect(cache.put).not.toHaveBeenCalled();
  });

  it.each([500, 501, 502, 503, 504, 599])('retries HTTP %s once, discarding its body without awaiting cancellation', async status => {
    const fetch = mockFetch(); const failed = stalledBody(); fetch.mockResolvedValueOnce(new Response(failed.response.body, { status }));
    const response = await handleRequest(request(), env);
    expect(response.status).toBe(200); attribution(response, 'backup'); expect(await response.json()).toEqual({ source: 'backup' });
    expect(failed.cancel).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(call => call[0])).toEqual([`${NODE}/v1/info`, `${BACKUP}/v1/info`]);
  });

  it.each(['fetch rejection', 'body transport error'] as const)('retries a primary %s once with fresh credential-free backup headers', async cause => {
    const fetch = mockFetch();
    if (cause === 'fetch rejection') fetch.mockRejectedValueOnce(new Error(TOKEN));
    else fetch.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.error(new Error(TOKEN)); } }), { headers: { 'Content-Type': 'application/json' } }));
    const response = await handleRequest(request('/v2/farcaster/notifications?fid=3', {
      Cookie: 'session=browser-secret', Authorization: 'Bearer browser-secret', [ORIGIN_TOKEN_HEADER]: TOKEN,
      'X-Opencaster-Aggregate-Cache': 'public-aggregate-v1', 'CF-Access-Client-Id': 'browser-id', 'CF-Access-Client-Secret': 'browser-secret',
      HYPERSNAP_READ_FALLBACK: 'haatz-v1', 'Content-Type': 'browser-type',
    }), env);
    expect(response.status).toBe(200); attribution(response, 'backup'); expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1].headers.get(ORIGIN_TOKEN_HEADER)).toBe(TOKEN);
    const [url, init] = fetch.mock.calls[1]; expect(url).toBe(`${BACKUP}/v2/farcaster/notifications?fid=3`);
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store' }); expect(init.body).toBeUndefined();
    expect([...init.headers]).toEqual([['accept', 'application/json']]);
    expect(await response.text()).not.toContain(TOKEN); expect(JSON.stringify([...response.headers])).not.toContain(TOKEN);
  });

  it.each(['headers', 'body'] as const)('switches after the primary 4-second %s deadline even when fetch/cancel ignores abort', async phase => {
    vi.useFakeTimers(); const fetch = mockFetch(); const stalled = stalledBody();
    if (phase === 'headers') fetch.mockImplementationOnce(() => new Promise(() => {})); else fetch.mockResolvedValueOnce(stalled.response);
    const pending = handleRequest(request(), env);
    await vi.advanceTimersByTimeAsync(3_999); expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); const response = await pending;
    expect(response.status).toBe(200); attribution(response, 'backup'); expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    if (phase === 'body') expect(stalled.cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('uses one 4-second primary budget across delayed headers and a stalled body', async () => {
    vi.useFakeTimers(); const fetch = mockFetch(); const stalled = stalledBody();
    fetch.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(stalled.response), 3_500)));
    const pending = handleRequest(request(), env);
    await vi.advanceTimersByTimeAsync(3_999); expect(fetch).toHaveBeenCalledOnce(); expect(stalled.cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); const response = await pending;
    expect(response.status).toBe(200); attribution(response, 'backup'); expect(stalled.cancel).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts a primary body completed just before its deadline without trying backup', async () => {
    vi.useFakeTimers(); const fetch = mockFetch();
    fetch.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { setTimeout(() => { controller.enqueue(new TextEncoder().encode('{"source":"primary"}')); controller.close(); }, 3_999); } }), { headers: { 'Content-Type': 'application/json' } }));
    const pending = handleRequest(request(), env); await vi.advanceTimersByTimeAsync(3_999); const response = await pending;
    expect(await response.json()).toEqual({ source: 'primary' }); attribution(response, 'primary'); expect(fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a late primary response and handles late fetch rejection without leaking or a third fetch', async () => {
    vi.useFakeTimers(); const fetch = mockFetch(); let resolve!: (response: Response) => void;
    fetch.mockImplementationOnce(() => new Promise<Response>(yes => { resolve = yes; }));
    const pending = handleRequest(request(), env); await vi.advanceTimersByTimeAsync(4_000); attribution(await pending, 'backup');
    const late = stalledBody(vi.fn(() => Promise.reject(new Error(TOKEN)))); resolve(late.response); await vi.advanceTimersByTimeAsync(0);
    expect(late.cancel).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledTimes(2);
    let reject!: (error: Error) => void;
    fetch.mockImplementationOnce(() => new Promise<Response>((_yes, no) => { reject = no; }));
    const another = handleRequest(request(), env); await vi.advanceTimersByTimeAsync(4_000); attribution(await another, 'backup'); reject(new Error(TOKEN)); await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(4); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([300, 301, 302, 303, 304, 307, 308, 400, 401, 403, 404, 405, 408, 409, 418, 422, 429, 499])('never fails over HTTP %s or forwards its headers', async status => {
    const fetch = mockFetch(); const cancel = vi.fn(() => Promise.reject(new Error(TOKEN)));
    fetch.mockResolvedValueOnce(new Response(status === 304 ? null : new ReadableStream({ cancel }), { status, headers: { Location: `https://attacker.example/${TOKEN}`, [ORIGIN_TOKEN_HEADER]: TOKEN } }));
    const response = await handleRequest(request(), env);
    expect(response.status).toBeGreaterThanOrEqual(400); attribution(response, 'primary'); expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].redirect).toBe('manual'); expect(await response.text()).not.toContain(TOKEN); expect(response.headers.has('Location')).toBe(false); expect(response.headers.has(ORIGIN_TOKEN_HEADER)).toBe(false);
  });

  it.each(['transport', 'timeout'] as const)('does not turn a known 4xx body %s into failover', async cause => {
    vi.useFakeTimers(); const fetch = mockFetch(); const stalled = stalledBody(undefined, 400);
    fetch.mockResolvedValueOnce(cause === 'timeout' ? stalled.response : new Response(new ReadableStream({ start(controller) { controller.error(new Error('transport')); } }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    const pending = handleRequest(request('/v1/linkById?fid=3&link_type=follow&target_fid=4'), env);
    await vi.advanceTimersByTimeAsync(4_000); const response = await pending;
    expect(response.status).toBeGreaterThanOrEqual(400); attribution(response, 'primary'); expect(fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['semantic auth denial', () => json({ error: 'Unauthorized', code: 'unauthenticated' })],
    ['semantic permission denial', () => json({ error: 'PermissionDenied' })],
    ['malformed JSON', () => new Response('{', { headers: { 'Content-Type': 'application/json' } })],
    ['nonobject JSON', () => json([])], ['reflected token', () => json({ nested: TOKEN })],
    ['non-JSON', () => new Response('not JSON')],
    ['oversize JSON', () => new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } })],
  ] as const)('does not fail over %s', async (_label, makeResponse) => {
    const fetch = mockFetch(); fetch.mockResolvedValueOnce(makeResponse()); const response = await handleRequest(request(), env);
    attribution(response, 'primary'); expect(fetch).toHaveBeenCalledOnce(); expect(await response.text()).not.toContain(TOKEN);
  });

  it.each(['transport', '5xx', 'redirect', '4xx'] as const)('does not retry backup %s failure', async failure => {
    const fetch = mockFetch(); fetch.mockRejectedValueOnce(new Error('primary transport'));
    if (failure === 'transport') fetch.mockRejectedValueOnce(new Error(TOKEN));
    else fetch.mockResolvedValueOnce(new Response(TOKEN, { status: failure === '5xx' ? 503 : failure === 'redirect' ? 307 : 403, headers: { Location: `https://attacker.example/${TOKEN}` } }));
    const response = await handleRequest(request(), env); expect(response.status).toBeGreaterThanOrEqual(400); attribution(response, 'backup'); expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].redirect).toBe('manual'); expect(await response.text()).not.toContain(TOKEN); expect(response.headers.has('Location')).toBe(false);
  });

  it.each(['headers', 'body'] as const)('bounds both cache lookups, primary and stalled backup %s to one absolute 20-second deadline', async phase => {
    vi.useFakeTimers(); const fetch = mockFetch(); const stalled = stalledBody(); const cache = { match: vi.fn(() => new Promise(() => {})), put: vi.fn() };
    vi.stubGlobal('caches', { default: cache });
    fetch.mockImplementationOnce(() => new Promise(() => {}));
    if (phase === 'headers') fetch.mockImplementationOnce(() => new Promise(() => {})); else fetch.mockResolvedValueOnce(stalled.response);
    const pending = handleRequest(request('/v2/farcaster/feed/trending'), env, { waitUntil: vi.fn() });
    await vi.advanceTimersByTimeAsync(199); expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3_999); expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(cache.match).toHaveBeenCalledTimes(2); expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(200); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15_599); expect(fetch.mock.calls[1][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); const response = await pending;
    expect(response.status).toBe(504); attribution(response, 'backup'); expect(await response.json()).toMatchObject({ code: 'timeout' });
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(true); if (phase === 'body') expect(stalled.cancel).toHaveBeenCalledOnce();
    expect(cache.put).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('enforces the unchanged 20-second no-backup deadline on a stalled response body', async () => {
    vi.useFakeTimers(); const fetch = mockFetch(); const stalled = stalledBody(); fetch.mockResolvedValueOnce(stalled.response);
    const pending = handleRequest(request(), { ...env, HYPERSNAP_READ_FALLBACK: undefined });
    await vi.advanceTimersByTimeAsync(19_999); expect(stalled.cancel).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1);
    const response = await pending; expect(response.status).toBe(504); expect(stalled.cancel).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['transport', '5xx', 'timeout', 'stalled body', 'redirect'] as const)('never replays a synthetic signed POST after %s despite read opt-in', async cause => {
    vi.useFakeTimers(); const fetch = mockFetch(); const stalled = stalledBody();
    if (cause === 'transport') fetch.mockRejectedValueOnce(new Error(TOKEN));
    else if (cause === 'timeout') fetch.mockImplementationOnce(() => new Promise(() => {}));
    else if (cause === 'stalled body') fetch.mockResolvedValueOnce(stalled.response);
    else fetch.mockResolvedValueOnce(new Response(TOKEN, { status: cause === '5xx' ? 503 : 307 }));
    const pending = handleRequest(write(), env); await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledOnce(); expect(new Uint8Array(fetch.mock.calls[0][1].body)).toEqual(new Uint8Array([8, 1, 0, 255]));
    if (cause === 'timeout' || cause === 'stalled body') {
      await vi.advanceTimersByTimeAsync(19_999); expect(fetch.mock.calls[0][1].signal.aborted).toBe(false); await vi.advanceTimersByTimeAsync(1);
    }
    const response = await pending; expect(response.status).toBe(cause === 'timeout' || cause === 'stalled body' ? 504 : 502);
    expect(await response.json()).toMatchObject({ code: 'submission_unknown' }); attribution(response, 'primary'); expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][0]).toBe(`${NODE}/v1/submitMessage`); expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves coarse request analytics for successful failover and failed backup without logging private state', async () => {
    vi.useFakeTimers(); const fetch = mockFetch(); const writeDataPoint = vi.fn(); const settings = { ...env, ANALYTICS: { writeDataPoint } };
    fetch.mockRejectedValueOnce(new Error(TOKEN)); const response = await handleRequest(request('/v2/farcaster/notifications?fid=3'), settings); expect(response.status).toBe(200);
    fetch.mockRejectedValueOnce(new Error(TOKEN)); fetch.mockResolvedValueOnce(json({}, 503)); expect((await handleRequest(request(), settings)).status).toBe(502);
    expect(writeDataPoint.mock.calls).toEqual([
      [{ blobs: ['request', 'api', '2xx', 'XX', 'other', 'other'], doubles: [1, 0], indexes: ['opencaster'] }],
      [{ blobs: ['request', 'api', '5xx', 'XX', 'other', 'other'], doubles: [1, 0], indexes: ['opencaster'] }],
    ]);
    const telemetry = JSON.stringify(writeDataPoint.mock.calls); for (const value of [TOKEN, NODE, BACKUP, 'fid', 'haatz-v1', '/notifications']) expect(telemetry).not.toContain(value);
  });
});
