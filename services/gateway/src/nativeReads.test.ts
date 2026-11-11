import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519.js';
import { createMediaUploadGrant, MEDIA_UPLOAD_HEADER, sha256Hex } from '@opencaster/client-core/media';
import { bytesToHex } from '@opencaster/protocol/signedKeyRequest';
import { handleRequest, type Env } from './index';
import { loadShareData } from './shareData';
import { ORIGIN_TOKEN_HEADER, resolveProxyUpstream, resolveUpstream, UpstreamConfigurationError, type UpstreamEnv } from './upstream';

const BASE = 'https://opencaster.org';
const HAATZ = 'https://haatz.quilibrium.com';
const NATIVE = 'https://native.example.test';
const OLD = 'https://base.example.test';
// Synthetic fixtures only, never production credentials or account identities.
const TOKEN = 'synthetic-native-token_0123456789-abcdef';
const OLD_TOKEN = 'synthetic-base-token_0123456789-abcdef';
const native: UpstreamEnv = { HYPERSNAP_NATIVE_READS: 'profiles-v1', HYPERSNAP_READ_ORIGIN: NATIVE, HYPERSNAP_READ_ORIGIN_TOKEN: TOKEN };
const privateBase: UpstreamEnv = { HYPERSNAP_ORIGIN: OLD, HYPERSNAP_ORIGIN_TOKEN: OLD_TOKEN };
const env: Env = { ASSETS: { fetch: vi.fn() }, ...native };
const hash = `0x${'a'.repeat(40)}`;
const address = `0x${'b'.repeat(40)}`;
const reads = ['/v1/info', '/v2/farcaster/user?fid=196149', '/v2/farcaster/user/bulk?fids=196149,3,2,5650', '/v2/farcaster/user/search?q=felirami&limit=5'];
// Independent inventory of every other currently admitted GET, not a prefix test.
const otherReads = [
  '/v1/fidByName?name=dwr.eth&type=ens',
  '/v1/castsByFid?fid=3&pageSize=250&reverse=true',
  '/v1/signersByFid?fid=3',
  `/v1/onChainIdRegistryEventByAddress?address=${address}`,
  '/v1/linkById?fid=3&link_type=follow&target_fid=2',
  `/v1/reactionById?fid=3&reaction_type=Like&target_fid=2&target_hash=${hash}`,
  '/v1/reactionsByFid?fid=3&reaction_type=Like&pageSize=5&reverse=true',
  `/v1/reactionsByCast?target_fid=3&target_hash=${hash}&reaction_type=Like&pageSize=5&reverse=true`,
  '/v2/farcaster/user/by-username?username=dwr',
  `/v2/farcaster/user/custody-address?custody_address=${address}`,
  '/v2/farcaster/user/followers?fid=3', '/v2/farcaster/user/following?fid=3',
  '/v2/farcaster/feed/trending', '/v2/farcaster/feed/following?fid=3',
  '/v2/farcaster/feed/user/casts?fid=3', '/v2/farcaster/feed/channels?channel_ids=builders',
  `/v2/farcaster/cast?identifier=${hash}&type=hash`, '/v2/farcaster/cast/search?q=test',
  `/v2/farcaster/cast/conversation?identifier=${hash}&type=hash`,
  '/v2/farcaster/notifications?fid=3', '/v2/farcaster/channel?id=builders&type=id',
  '/v2/farcaster/channel/all', '/v2/farcaster/channel/trending', '/v2/farcaster/channel/search?q=test',
  '/v2/farcaster/following/suggested?fid=3&limit=5',
  '/v2/farcaster/channel/members?channel_id=builders&limit=5',
  `/v2/farcaster/cast/quotes?identifier=${hash}&type=hash&limit=5`,
];
const pathname = (path: string) => new URL(path, BASE).pathname;
const request = (path: string, headers: HeadersInit = {}) => new Request(`${BASE}/api${path}`, { headers });
const write = () => new Request(`${BASE}/api/v1/submitMessage`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([8, 1, 0, 255]) });
const json = (value: unknown = {}, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
function mockFetch() {
  const fetch = vi.fn().mockImplementation(async () => json({ source: 'fixture' }));
  vi.stubGlobal('fetch', fetch); return fetch;
}
const invalidPairs: UpstreamEnv[] = [
  {}, { HYPERSNAP_READ_ORIGIN: NATIVE }, { HYPERSNAP_READ_ORIGIN_TOKEN: TOKEN },
  ...['', 'http://native.example.test', '//native.example.test', 'https:native.example.test',
    `${NATIVE}/v1`, `${NATIVE}/?`, `${NATIVE}?q=1`, `${NATIVE}#`, `${NATIVE}/#fragment`,
    'https://user:pass@native.example.test', 'https://@native.example.test', 'https://user@native.example.test',
    `${NATIVE}\\evil`, `${NATIVE}/./`, `${NATIVE}/%2e`, ` ${NATIVE}`, `${NATIVE}\n`,
    'https://', `${NATIVE}:99999`, 'https://native%2eexample.test',
  ].map(HYPERSNAP_READ_ORIGIN => ({ HYPERSNAP_READ_ORIGIN, HYPERSNAP_READ_ORIGIN_TOKEN: TOKEN })),
  ...['', 'a'.repeat(31), `${TOKEN}=`, `${TOKEN}+`, `${TOKEN}/`, `${TOKEN} `, `${TOKEN}\n`, `${TOKEN}\r\nInjected: yes`]
    .map(HYPERSNAP_READ_ORIGIN_TOKEN => ({ HYPERSNAP_READ_ORIGIN: NATIVE, HYPERSNAP_READ_ORIGIN_TOKEN })),
  { HYPERSNAP_READ_ORIGIN: null, HYPERSNAP_READ_ORIGIN_TOKEN: TOKEN } as unknown as UpstreamEnv,
  { HYPERSNAP_READ_ORIGIN: NATIVE, HYPERSNAP_READ_ORIGIN_TOKEN: 123 } as unknown as UpstreamEnv,
];

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('exact proxy-only native profile reads', () => {
  it.each(reads)('selects the private read pair for %s without changing the base resolver', async path => {
    const fetch = mockFetch();
    for (const base of [{}, privateBase]) {
      const settings = { ...env, ...base };
      expect(resolveUpstream(settings)).toEqual(resolveUpstream(base));
      expect(resolveProxyUpstream(settings, pathname(path), 'GET')).toEqual({ origin: NATIVE, token: TOKEN });
      const result = await handleRequest(request(path), settings);
      expect(result.status).toBe(200); expect(result.headers.get('X-Opencaster-Upstream')).toBe('primary');
      expect(result.headers.get('Cache-Control')).toBe('no-store');
      const [url, init] = fetch.mock.calls.at(-1)!;
      expect(url).toBe(`${NATIVE}${path}`); expect(init.headers.get(ORIGIN_TOKEN_HEADER)).toBe(TOKEN);
      expect(init).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store' });
    }
  });

  it.each(otherReads)('keeps the base for the unqualified read %s, even with broken native configuration', async path => {
    const fetch = mockFetch();
    for (const base of [{}, privateBase]) {
      for (const pair of [native, { HYPERSNAP_NATIVE_READS: 'profiles-v1', HYPERSNAP_READ_ORIGIN: 'invalid' }]) {
        const settings = { ...env, ...pair, HYPERSNAP_READ_ORIGIN_TOKEN: pair.HYPERSNAP_READ_ORIGIN_TOKEN, ...base };
        const expected = resolveUpstream(base);
        expect(resolveProxyUpstream(settings, pathname(path), 'GET')).toEqual(expected);
        expect((await handleRequest(request(path), settings)).status).toBe(200);
        const [url, init] = fetch.mock.calls.at(-1)!;
        expect(url).toBe(`${expected.origin}${path}`); expect(init.headers.get(ORIGIN_TOKEN_HEADER)).toBe(expected.token ?? null);
      }
    }
  });

  it.each([undefined, '', 'profiles-v2', 'PROFILES-V1', 'profiles-v1 ', NATIVE])('ignores absent/unknown opt-in %s and does not validate an unused pair', async optIn => {
    const fetch = mockFetch();
    for (const base of [{}, privateBase]) {
      for (const path of reads) {
        const settings = { ...env, ...base, HYPERSNAP_NATIVE_READS: optIn, HYPERSNAP_READ_ORIGIN: 'invalid', HYPERSNAP_READ_ORIGIN_TOKEN: 'short' };
        expect(resolveProxyUpstream(settings, pathname(path), 'GET')).toEqual(resolveUpstream(base));
        expect((await handleRequest(request(path), settings)).status).toBe(200);
        expect(fetch.mock.calls.at(-1)![0]).toBe(`${resolveUpstream(base).origin}${path}`);
      }
    }
  });

  it.each([NATIVE, `${NATIVE}/`, 'https://native.example.test:443/', `${NATIVE}:8443`])('uses the existing strict pair validation/normalization for %s', origin => {
    expect(resolveProxyUpstream({ ...env, HYPERSNAP_READ_ORIGIN: origin }, '/v1/info', 'GET')).toEqual({ origin: new URL(origin).origin, token: TOKEN });
  });

  it.each(invalidPairs.map((pair, index) => ({ pair, index })))('fails closed only for selected reads with invalid/missing pair $index', async ({ pair }) => {
    const fetch = mockFetch(); const cache = { match: vi.fn(), put: vi.fn() }; vi.stubGlobal('caches', { default: cache });
    const settings: Env = { ASSETS: env.ASSETS, HYPERSNAP_NATIVE_READS: 'profiles-v1', HYPERSNAP_READ_FALLBACK: 'haatz-v1', ...pair };
    for (const path of reads) {
      expect(() => resolveProxyUpstream(settings, pathname(path), 'GET')).toThrow(UpstreamConfigurationError);
      const result = await handleRequest(request(path), settings, { waitUntil: vi.fn() });
      expect(result.status).toBe(503); expect(result.headers.get('Cache-Control')).toBe('no-store');
      expect(await result.json()).toEqual({ code: 'upstream_configuration_unavailable', message: 'The Hypersnap gateway is temporarily unavailable.' });
    }
    expect(fetch).not.toHaveBeenCalled(); expect(cache.match).not.toHaveBeenCalled(); expect(cache.put).not.toHaveBeenCalled();
    expect((await handleRequest(request('/v2/farcaster/feed/trending'), settings)).status).toBe(200);
    expect((await handleRequest(write(), settings)).status).toBe(200);
    expect(fetch.mock.calls.map(call => call[0])).toEqual([`${HAATZ}/v2/farcaster/feed/trending`, `${HAATZ}/v1/submitMessage`]);
  });

  it.each([
    { HYPERSNAP_ORIGIN: OLD }, { HYPERSNAP_ORIGIN_TOKEN: OLD_TOKEN },
    { ...privateBase, HYPERSNAP_ORIGIN: `${OLD}/v1` }, { ...privateBase, HYPERSNAP_ORIGIN_TOKEN: 'short' },
  ])('validates the existing base first, even with a valid override: %j', async base => {
    const fetch = mockFetch(); const settings = { ...env, ...base };
    for (const path of [...reads, '/v2/farcaster/feed/trending']) {
      expect(() => resolveProxyUpstream(settings, pathname(path), 'GET')).toThrow(UpstreamConfigurationError);
      expect((await handleRequest(request(path), settings)).status).toBe(503);
    }
    const submission = write(); expect((await handleRequest(submission, settings)).status).toBe(503); expect(submission.bodyUsed).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['POST', 'HEAD', 'PUT', 'OPTIONS', 'get'])('never selects native for helper method %s', method => {
    for (const path of reads) expect(resolveProxyUpstream(env, pathname(path), method)).toEqual({ origin: HAATZ });
  });

  it.each(['GET', 'POST', 'HEAD'])('keeps route/method/query checks before native configuration for %s', async method => {
    const fetch = mockFetch(); const broken = { ...env, HYPERSNAP_READ_ORIGIN: 'bad' };
    for (const path of reads) {
      const result = await handleRequest(new Request(`${BASE}/api${pathname(path)}?host=evil`, { method }), broken);
      expect(result.status).toBe(method === 'GET' ? 400 : 405);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(reads)('does not add slash/prefix aliases for %s', async path => {
    const fetch = mockFetch();
    for (const alias of [`${pathname(path)}/`, `${pathname(path)}/extra`, `${pathname(path)}-extra`]) {
      expect(resolveProxyUpstream(env, alias, 'GET')).toEqual({ origin: HAATZ });
      expect((await handleRequest(request(alias), env)).status).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leaves synthetic signed submissions on the base, with exact bytes and no replay', async () => {
    const fetch = mockFetch();
    for (const base of [{}, privateBase]) {
      for (const origin of [NATIVE, 'malformed']) {
        fetch.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
        const result = await handleRequest(write(), { ...env, ...base, HYPERSNAP_READ_ORIGIN: origin, HYPERSNAP_READ_FALLBACK: 'haatz-v1' });
        expect(result.status).toBe(502); expect(await result.json()).toMatchObject({ code: 'submission_unknown' });
        const [url, init] = fetch.mock.calls.at(-1)!;
        expect(url).toBe(`${resolveUpstream(base).origin}/v1/submitMessage`);
        expect(init.headers.get(ORIGIN_TOKEN_HEADER)).toBe(resolveUpstream(base).token ?? null);
        expect(new Uint8Array(init.body)).toEqual(new Uint8Array([8, 1, 0, 255]));
      }
    }
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

describe('native credential isolation and unchanged failure policy', () => {
  it.each(reads)('cannot choose a host or credential with caller headers for %s', async path => {
    const fetch = mockFetch();
    const headers = { HYPERSNAP_NATIVE_READS: 'profiles-v1', HYPERSNAP_READ_ORIGIN: 'https://attacker.example', HYPERSNAP_READ_ORIGIN_TOKEN: 'spoof',
      Host: 'attacker.example', 'X-Forwarded-Host': 'attacker.example', [ORIGIN_TOKEN_HEADER]: 'spoof', Cookie: 'browser-secret', Authorization: 'browser-secret', 'CF-Access-Client-Secret': 'browser-secret' };
    for (const settings of [env, { ...env, HYPERSNAP_NATIVE_READS: undefined }]) {
      expect((await handleRequest(request(path, headers), settings)).status).toBe(200);
      const [url, init] = fetch.mock.calls.at(-1)!;
      expect(url).toBe(`${settings.HYPERSNAP_NATIVE_READS ? NATIVE : HAATZ}${path}`);
      expect([...init.headers]).toEqual(settings.HYPERSNAP_NATIVE_READS ? [['accept', 'application/json'], [ORIGIN_TOKEN_HEADER.toLowerCase(), TOKEN]] : [['accept', 'application/json']]);
    }
  });

  it.each(['origin=https://attacker.example', 'host=attacker.example', 'HYPERSNAP_NATIVE_READS=profiles-v1', 'HYPERSNAP_READ_ORIGIN=https://attacker.example', 'HYPERSNAP_READ_ORIGIN_TOKEN=spoof', 'upstream=native'])('rejects routing query %s before network/cache', async query => {
    const fetch = mockFetch(); const cache = { match: vi.fn(), put: vi.fn() }; vi.stubGlobal('caches', { default: cache });
    for (const path of reads) {
      const result = await handleRequest(request(`${path}${path.includes('?') ? '&' : '?'}${query}`), env, { waitUntil: vi.fn() });
      expect(result.status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled(); expect(cache.match).not.toHaveBeenCalled(); expect(cache.put).not.toHaveBeenCalled();
  });

  it('treats allowed search text as data, not as a destination', async () => {
    const fetch = mockFetch(); const q = encodeURIComponent('https://attacker.example');
    expect((await handleRequest(request(`/v2/farcaster/user/search?q=${q}`), env)).status).toBe(200);
    expect(fetch.mock.calls[0][0]).toBe(`${NATIVE}/v2/farcaster/user/search?q=${q}`);
  });

  it.each(['literal', 'escaped', 'duplicate-key', 'backup-reflection'] as const)('rejects native token %s before forwarding or caching, without retrying invalid JSON', async mode => {
    const fetch = mockFetch(); const cache = { match: vi.fn(), put: vi.fn() }; vi.stubGlobal('caches', { default: cache });
    const escaped = `\\u0073${TOKEN.slice(1)}`;
    const body = mode === 'escaped' ? `{"value":"${escaped}"}` : mode === 'duplicate-key' ? `{"value":"${escaped}","value":"public"}` : JSON.stringify({ nested: TOKEN });
    if (mode === 'backup-reflection') fetch.mockRejectedValueOnce(new Error('transport'));
    fetch.mockResolvedValueOnce(new Response(body, { headers: { 'Content-Type': 'application/json', [ORIGIN_TOKEN_HEADER]: TOKEN } }));
    const result = await handleRequest(request('/v1/info'), { ...env, HYPERSNAP_READ_FALLBACK: 'haatz-v1' }, { waitUntil: vi.fn() });
    expect(result.status).toBe(502); expect(await result.json()).toMatchObject({ code: 'invalid_response' });
    expect(JSON.stringify([...result.headers])).not.toContain(TOKEN); expect(cache.put).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(mode === 'backup-reflection' ? 2 : 1);
  });

  it.each([301, 307, 400, 401, 403, 404, 429])('keeps native HTTP %s nonretryable, sanitizes headers/body and preserves 404', async status => {
    const fetch = mockFetch(); fetch.mockResolvedValueOnce(new Response(TOKEN, { status, headers: { Location: `https://attacker.example/${TOKEN}`, [ORIGIN_TOKEN_HEADER]: TOKEN } }));
    const result = await handleRequest(request('/v2/farcaster/user?fid=3'), { ...env, HYPERSNAP_READ_FALLBACK: 'haatz-v1' });
    expect(result.status).toBe(status < 400 ? 502 : status); expect(result.headers.get('X-Opencaster-Upstream')).toBe('primary');
    expect(await result.text()).not.toContain(TOKEN); expect(result.headers.has('Location')).toBe(false); expect(result.headers.has(ORIGIN_TOKEN_HEADER)).toBe(false); expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(reads)('uses existing Haatz fallback without either private credential for %s', async path => {
    const fetch = mockFetch();
    for (const base of [{}, privateBase]) {
      fetch.mockRejectedValueOnce(new Error(TOKEN)); fetch.mockResolvedValueOnce(json({ source: 'backup' }));
      const result = await handleRequest(request(path, { Cookie: 'secret', Authorization: 'secret', [ORIGIN_TOKEN_HEADER]: TOKEN }), { ...env, ...base, HYPERSNAP_READ_FALLBACK: 'haatz-v1' });
      expect(result.status).toBe(200); expect(result.headers.get('X-Opencaster-Upstream')).toBe('backup'); expect(await result.json()).toEqual({ source: 'backup' });
      const [[first, init], [backup, backupInit]] = fetch.mock.calls.slice(-2);
      expect(first).toBe(`${NATIVE}${path}`); expect(init.headers.get(ORIGIN_TOKEN_HEADER)).toBe(TOKEN);
      expect(backup).toBe(`${HAATZ}${path}`); expect([...backupInit.headers]).toEqual([['accept', 'application/json']]);
      expect(backupInit).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store' });
    }
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it.each([undefined, '', 'haatz-v2'])('does not enable fallback implicitly with native reads: %s', async optIn => {
    const fetch = mockFetch(); fetch.mockRejectedValueOnce(new Error(TOKEN));
    const result = await handleRequest(request('/v1/info'), { ...env, HYPERSNAP_READ_FALLBACK: optIn });
    expect(result.status).toBe(502); expect(result.headers.get('X-Opencaster-Upstream')).toBe('primary'); expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(['success', 'stall'] as const)('retains the 4-second native primary and absolute 20-second total deadline with backup %s', async backup => {
    vi.useFakeTimers(); const fetch = mockFetch(); fetch.mockImplementationOnce(() => new Promise(() => {}));
    if (backup === 'stall') fetch.mockImplementationOnce(() => new Promise(() => {}));
    const pending = handleRequest(request('/v1/info'), { ...env, HYPERSNAP_READ_FALLBACK: 'haatz-v1' });
    await vi.advanceTimersByTimeAsync(3_999); expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    if (backup === 'stall') {
      await vi.advanceTimersByTimeAsync(15_999); expect(fetch.mock.calls[1][1].signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1); expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
    }
    const result = await pending; expect(result.status).toBe(backup === 'stall' ? 504 : 200); expect(result.headers.get('X-Opencaster-Upstream')).toBe('backup');
    expect(fetch.mock.calls.map(call => call[0])).toEqual([`${NATIVE}/v1/info`, `${HAATZ}/v1/info`]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('nonproxy consumers retain the base origin', () => {
  it.each([NATIVE, 'malformed'])('keeps actual media signer authorization on the base with native origin %s', async origin => {
    const bytes = new Uint8Array(readFileSync(new URL('../../../apps/web-client/public/unknown-dark.png', import.meta.url)));
    const key = new Uint8Array(32).fill(31); const publicKey = bytesToHex(ed25519.getPublicKey(key));
    const grant = await createMediaUploadGrant({ origin: BASE, sha256: await sha256Hex(bytes), size: bytes.length, contentType: 'image/png' }, { fid: 1234, publicKey }, async payload => ed25519.sign(payload, key));
    const fetch = mockFetch();
    fetch.mockImplementation(async () => json({ signers: [{ key: publicKey, source: 'SIGNER_SOURCE_OFFCHAIN', requestFid: 1234, expiresAt: Math.floor(Date.now() / 1000) + 3600, scopes: ['MESSAGE_TYPE_CAST_ADD'] }] }));
    const reserve = vi.fn(async () => new Response(null, { status: 429 })); const put = vi.fn();
    for (const base of [{}, privateBase]) {
      const settings: Env = { ...env, ...base, HYPERSNAP_READ_ORIGIN: origin,
        MEDIA_BUCKET: { get: vi.fn(), head: vi.fn(), put }, MEDIA_QUOTA: { idFromName: value => value, get: () => ({ fetch: reserve }) } };
      const result = await handleRequest(new Request(`${BASE}/media/upload`, { method: 'POST', headers: { Origin: BASE, 'Content-Type': 'image/png', [MEDIA_UPLOAD_HEADER]: JSON.stringify(grant) }, body: new Uint8Array(bytes).buffer }), settings);
      expect(result.status).toBe(429); // Deliberate fixture quota denial after BOTH real signer checks.
      for (const [url, init] of fetch.mock.calls.slice(-2)) {
        expect(url).toBe(`${resolveUpstream(base).origin}/v1/signersByFid?fid=1234&pageSize=1000&requesterFids%5B0%5D=1234`);
        expect(init.headers.get(ORIGIN_TOKEN_HEADER)).toBe(resolveUpstream(base).token ?? null);
      }
    }
    expect(fetch).toHaveBeenCalledTimes(4); expect(reserve).toHaveBeenCalledTimes(2); expect(put).not.toHaveBeenCalled();
  });

  it.each([NATIVE, 'malformed'])('keeps direct share data and actual HTML sharing on the base with native origin %s', async origin => {
    const fetch = mockFetch(); fetch.mockImplementation(async () => json({ user: { fid: 3, username: 'dwr', display_name: 'Dwr' } }));
    for (const base of [{}, privateBase]) {
      const settings = { ...env, ...base, HYPERSNAP_READ_ORIGIN: origin, ASSETS: { fetch: vi.fn(async () => new Response(readFileSync(new URL('../../../apps/web-client/index.html', import.meta.url), 'utf8'), { headers: { 'Content-Type': 'text/html' } })) } };
      expect(await loadShareData({ kind: 'profile', identifier: '3' }, settings)).toMatchObject({ kind: 'profile', profile: { fid: 3 } });
      const result = await handleRequest(new Request(`${BASE}/profile/3`), settings); expect(result.status).toBe(200);
      expect(await result.text()).toContain('Dwr');
      for (const [url, init] of fetch.mock.calls.slice(-2)) {
        expect(url).toBe(`${resolveUpstream(base).origin}/v2/farcaster/user?fid=3`);
        expect(init.headers.get(ORIGIN_TOKEN_HEADER)).toBe(resolveUpstream(base).token ?? null);
      }
    }
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
