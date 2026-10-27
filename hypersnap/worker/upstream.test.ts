import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, type Env } from './index';
import { fetchUpstream, ORIGIN_TOKEN_HEADER, resolveUpstream, type UpstreamEnv } from './upstream';

const BASE = 'https://opencaster.org';
const NODE = 'https://node.example.test';
// Synthetic fixture only, never a deployed credential.
const TOKEN = 'synthetic-origin-token_0123456789-abcdef';
const privateEnv = { HYPERSNAP_ORIGIN: NODE, HYPERSNAP_ORIGIN_TOKEN: TOKEN };
const env: Env = { ASSETS: { fetch: vi.fn() } };
const response = (value: unknown = {}) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const invalid: UpstreamEnv[] = [
  { HYPERSNAP_ORIGIN: NODE }, { HYPERSNAP_ORIGIN_TOKEN: TOKEN },
  { HYPERSNAP_ORIGIN: '', HYPERSNAP_ORIGIN_TOKEN: '' },
  ...[
    'http://node.example.test', '//node.example.test', 'https:node.example.test',
    `${NODE}/v1`, `${NODE}/?`, `${NODE}?q=1`, `${NODE}#`, `${NODE}/#fragment`,
    'https://user:pass@node.example.test', 'https://@node.example.test',
    'https://user@node.example.test', 'https://node.example.test\\evil',
    'https://node.example.test/./', 'https://node.example.test/%2e',
    ` ${NODE}`, `${NODE}\n`, 'https://', 'https://node.example.test:99999',
  ].map(HYPERSNAP_ORIGIN => ({ HYPERSNAP_ORIGIN, HYPERSNAP_ORIGIN_TOKEN: TOKEN })),
  ...['', 'a'.repeat(31), `${TOKEN}=`, `${TOKEN}+`, `${TOKEN}/`, `${TOKEN} `, `${TOKEN}\n`, `${TOKEN}\r\nInjected: yes`]
    .map(HYPERSNAP_ORIGIN_TOKEN => ({ HYPERSNAP_ORIGIN: NODE, HYPERSNAP_ORIGIN_TOKEN })),
];

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('server-only origin configuration', () => {
  it('uses the unchanged public default only with both settings absent', async () => {
    expect(resolveUpstream({})).toEqual({ origin: 'https://haatz.quilibrium.com' });
    const fetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetch);
    const result = await handleRequest(new Request(`${BASE}/api/v1/info`, { headers: { [ORIGIN_TOKEN_HEADER]: 'browser-spoof' } }), env);
    expect(result.status).toBe(200);
    expect(fetch.mock.calls[0][0]).toBe('https://haatz.quilibrium.com/v1/info');
    expect(fetch.mock.calls[0][1].headers.has(ORIGIN_TOKEN_HEADER)).toBe(false);
  });

  it.each([NODE, `${NODE}/`, 'https://node.example.test:443/', 'https://node.example.test:8443'])('accepts an HTTPS origin without application URL components: %s', origin => {
    expect(resolveUpstream({ ...privateEnv, HYPERSNAP_ORIGIN: origin })).toEqual({ origin: new URL(origin).origin, token: TOKEN });
    expect(resolveUpstream({ ...privateEnv, HYPERSNAP_ORIGIN_TOKEN: '_'.repeat(32) }).token).toHaveLength(32);
  });

  it.each(invalid.map((config, index) => ({ config, index })))('fails closed for partial/invalid pair $index, before network, cache or write body', async ({ config }) => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const cache = { match: vi.fn(), put: vi.fn() }; vi.stubGlobal('caches', { default: cache });
    const waitUntil = vi.fn();
    for (const request of [
      new Request(`${BASE}/api/v2/farcaster/feed/trending`),
      new Request(`${BASE}/api/v1/submitMessage`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([8, 1]) }),
    ]) {
      const result = await handleRequest(request, { ...env, ...config, HYPERSNAP_READ_FALLBACK: 'haatz-v1' }, { waitUntil });
      expect(result.status).toBe(503); expect(result.headers.get('Cache-Control')).toBe('no-store');
      expect(await result.json()).toEqual({ code: 'upstream_configuration_unavailable', message: 'The Hypersnap gateway is temporarily unavailable.' });
      expect(request.bodyUsed).toBe(false);
    }
    expect(fetch).not.toHaveBeenCalled(); expect(cache.match).not.toHaveBeenCalled(); expect(cache.put).not.toHaveBeenCalled(); expect(waitUntil).not.toHaveBeenCalled();
  });

  it('authenticates all main read and write paths with fresh trusted headers, retaining signed bytes', async () => {
    const fetch = vi.fn().mockImplementation(async () => response({ hash: 'test' })); vi.stubGlobal('fetch', fetch);
    const bytes = new Uint8Array([8, 1, 0, 255]);
    for (const path of ['/v1/info', '/v1/signersByFid?fid=3', '/v2/farcaster/notifications?fid=3', '/v2/farcaster/feed/trending', '/v1/submitMessage']) {
      const write = path === '/v1/submitMessage';
      const result = await handleRequest(new Request(`${BASE}/api${path}`, {
        method: write ? 'POST' : 'GET', headers: { Origin: BASE, Cookie: 'browser-secret', Authorization: 'Bearer browser-secret', [ORIGIN_TOKEN_HEADER]: 'browser-spoof', 'Content-Type': 'application/octet-stream' },
        ...(write ? { body: bytes } : {}),
      }), { ...env, ...privateEnv });
      expect(result.status).toBe(200);
      expect(await result.text()).not.toContain(TOKEN); expect(JSON.stringify([...result.headers])).not.toContain(TOKEN);
      const [url, options] = fetch.mock.calls.at(-1)!;
      expect(url).toBe(`${NODE}${path}`);
      expect(options).toMatchObject({ redirect: 'manual', credentials: 'omit', cache: 'no-store', method: write ? 'POST' : 'GET' });
      expect([...options.headers]).toEqual(expect.arrayContaining([['accept', 'application/json'], [ORIGIN_TOKEN_HEADER.toLowerCase(), TOKEN]]));
      expect(options.headers.has('Cookie')).toBe(false); expect(options.headers.has('Authorization')).toBe(false); expect(options.headers.has('Origin')).toBe(false);
      if (write) expect(new Uint8Array(options.body)).toEqual(bytes);
    }
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('overwrites spoofed credentials even if a future caller passes browser headers to the helper', async () => {
    const fetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetch);
    await fetchUpstream(resolveUpstream(privateEnv), '/v1/info', { headers: { [ORIGIN_TOKEN_HEADER]: 'spoof', Cookie: 'secret', Authorization: 'secret', 'CF-Access-Client-Secret': 'secret' }, redirect: 'follow', credentials: 'include', cache: 'force-cache' });
    const [, options] = fetch.mock.calls[0];
    expect([...options.headers]).toEqual([['accept', 'application/json'], [ORIGIN_TOKEN_HEADER.toLowerCase(), TOKEN]]);
    expect(options).toMatchObject({ redirect: 'manual', credentials: 'omit', cache: 'no-store' });
  });

  it.each([301, 302, 303, 307, 308])('rejects upstream redirect %s without another fetch or exposing credentials/Location', async status => {
    const fetch = vi.fn().mockImplementation(async () => new Response(TOKEN, { status, headers: { Location: `https://untrusted.example/${TOKEN}`, [ORIGIN_TOKEN_HEADER]: TOKEN } })); vi.stubGlobal('fetch', fetch);
    const result = await handleRequest(new Request(`${BASE}/api/v1/info`), { ...env, ...privateEnv });
    expect(result.status).toBe(502); expect(await result.text()).not.toContain(TOKEN); expect(result.headers.has('Location')).toBe(false); expect(result.headers.has(ORIGIN_TOKEN_HEADER)).toBe(false);
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][1].redirect).toBe('manual');
  });

  it('does not expose credentials reflected in success JSON, error text, response headers or thrown errors', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const upstream of [
      new Response(JSON.stringify({ nested: { value: TOKEN } }), { headers: { 'Content-Type': 'application/json', [ORIGIN_TOKEN_HEADER]: TOKEN } }),
      // Escaping the wire representation must not bypass the object check.
      new Response(`{"value":"\\u0073${TOKEN.slice(1)}"}`, { headers: { 'Content-Type': 'application/json' } }),
      new Response(`{"value":"${TOKEN}","value":"public"}`, { headers: { 'Content-Type': 'application/json' } }),
      new Response(`{"value":"\\u0073${TOKEN.slice(1)}","value":"public"}`, { headers: { 'Content-Type': 'application/json' } }),
      new Response(TOKEN, { status: 503 }),
    ]) {
      fetch.mockResolvedValueOnce(upstream);
      const result = await handleRequest(new Request(`${BASE}/api/v1/info`), { ...env, ...privateEnv });
      expect(result.status).toBe(502); expect(await result.text()).not.toContain(TOKEN); expect(JSON.stringify([...result.headers])).not.toContain(TOKEN);
    }
    fetch.mockRejectedValueOnce(new Error(`network ${TOKEN}`));
    const result = await handleRequest(new Request(`${BASE}/api/v1/info`), { ...env, ...privateEnv });
    expect(result.status).toBe(502); expect(await result.text()).not.toContain(TOKEN);
  });

  it('rejects invalid UTF-8 JSON bytes before forwarding or caching', async () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('{\"value\":\"'), 0xff, ...new TextEncoder().encode('\"}')]);
    const fetch = vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'Content-Type': 'application/json' } })); vi.stubGlobal('fetch', fetch);
    const cache = { match: vi.fn(), put: vi.fn() }; vi.stubGlobal('caches', { default: cache });
    const result = await handleRequest(new Request(`${BASE}/api/v1/info`), { ...env, ...privateEnv }, { waitUntil: vi.fn() });
    expect(result.status).toBe(502); expect(await result.json()).toMatchObject({ code: 'invalid_response' }); expect(cache.put).not.toHaveBeenCalled();
  });

  it.each(['GET', 'POST'])('retains the 20-second private-origin %s deadline and uncertain submission behavior', async method => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error(TOKEN)));
    })); vi.stubGlobal('fetch', fetch);
    const write = method === 'POST';
    const pending = handleRequest(new Request(`${BASE}/api${write ? '/v1/submitMessage' : '/v1/info'}`, { method, ...(write ? { headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([8, 1]) } : {}) }), { ...env, ...privateEnv });
    await vi.advanceTimersByTimeAsync(19_999); expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][1].signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.status).toBe(504); expect(await result.json()).toMatchObject({ code: write ? 'submission_unknown' : 'timeout' }); expect(fetch).toHaveBeenCalledOnce();
  });
});
