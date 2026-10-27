import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519.js';
import { createMediaUploadGrant, MAX_MEDIA_BYTES, MEDIA_UPLOAD_HEADER, mediaGrantPayload, parseMediaUploadGrant, sha256Hex, type MediaUploadGrant } from '../src/lib/media';
import { bytesToHex, hexToBytes } from '../src/lib/protocol/signedKeyRequest';
import { handleMediaRequest, MediaUploadQuota, validateImage, type MediaEnv } from './media';
import { handleRequest } from './index';
import { ORIGIN_TOKEN_HEADER } from './upstream';

const BASE = 'https://opencaster.org';
const LEGACY = 'https://quorum.arca.computer';
const PRIVATE_ORIGIN = 'https://node.example.test';
const ORIGIN_TOKEN = 'synthetic-origin-token_0123456789-abcdef';
const privateConfig = { HYPERSNAP_ORIGIN: PRIVATE_ORIGIN, HYPERSNAP_ORIGIN_TOKEN: ORIGIN_TOKEN, HYPERSNAP_READ_FALLBACK: 'haatz-v1' };
// Synthetic, unregistered test identity. It never signs a live account action.
const key = new Uint8Array(32).fill(31);
const publicKey = bytesToHex(ed25519.getPublicKey(key));
const png = new Uint8Array(readFileSync(new URL('../public/unknown-dark.png', import.meta.url)));

class MemoryQuotaStorage {
  values = new Map<string, unknown>();
  alarm = 0;
  private pending: Promise<unknown> = Promise.resolve();
  async get<T>(name: string): Promise<T | undefined> { return structuredClone(this.values.get(name)) as T | undefined; }
  async put(name: string, value: unknown): Promise<void> { this.values.set(name, structuredClone(value)); }
  async transaction<T>(callback: (txn: MemoryQuotaStorage) => Promise<T>): Promise<T> {
    const operation = this.pending.then(() => callback(this));
    this.pending = operation.catch(() => undefined);
    return operation;
  }
  async setAlarm(time: number): Promise<void> { this.alarm = time; }
  async deleteAll(): Promise<void> { this.values.clear(); }
}

function environment() {
  const storage = new MemoryQuotaStorage();
  const quota = new MediaUploadQuota({ storage });
  const images = new Map<string, { bytes: Uint8Array; type: string }>();
  const put = vi.fn(async (hash: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string } }) => {
    if (!images.has(hash)) images.set(hash, { bytes: new Uint8Array(value), type: options.httpMetadata.contentType });
  });
  const image = (hash: string) => {
    const value = images.get(hash);
    return value ? { size: value.bytes.length, httpEtag: `"${hash}"`, httpMetadata: { contentType: value.type }, body: new Response(new Uint8Array(value.bytes).buffer).body! } : null;
  };
  const env: MediaEnv = {
    MEDIA_BUCKET: { get: async hash => image(hash), head: async hash => image(hash), put },
    MEDIA_QUOTA: { idFromName: name => name, get: () => quota },
  };
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ signers: [{
    key: publicKey, source: 'SIGNER_SOURCE_OFFCHAIN', requestFid: 1234,
    expiresAt: Math.floor(Date.now() / 1000) + 3600, scopes: ['MESSAGE_TYPE_CAST_ADD'],
  }] }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  return { env, fetch, put, images, storage, quota };
}
async function grantFor(bytes = png): Promise<MediaUploadGrant> {
  return createMediaUploadGrant({ origin: BASE, sha256: await sha256Hex(bytes), size: bytes.length, contentType: 'image/png' }, { fid: 1234, publicKey }, async payload => ed25519.sign(payload, key));
}
function upload(grant: MediaUploadGrant, bytes = png, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}/media/upload`, { method: 'POST', headers: { Origin: BASE, 'Content-Type': grant.contentType, [MEDIA_UPLOAD_HEADER]: JSON.stringify(grant), ...headers }, body: new Uint8Array(bytes).buffer });
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('authenticated media uploads', () => {
  it('authenticates both uncached private-origin signer checks without forwarding browser credentials', async () => {
    const { env, fetch, put } = environment();
    const cache = { match: vi.fn(), put: vi.fn() }; vi.stubGlobal('caches', { default: cache });
    const grant = await grantFor();
    const result = await handleRequest(upload(grant, png, { [ORIGIN_TOKEN_HEADER]: 'browser-spoof', Authorization: 'browser-secret', Cookie: 'browser-secret' }), { ...env, ...privateConfig, ASSETS: { fetch: vi.fn() } }, { waitUntil: vi.fn() });
    expect(result.status).toBe(200); expect(await result.text()).not.toContain(ORIGIN_TOKEN);
    expect(fetch).toHaveBeenCalledTimes(2); expect(put).toHaveBeenCalledOnce();
    for (const [url, options] of fetch.mock.calls) {
      expect(url).toBe(`${PRIVATE_ORIGIN}/v1/signersByFid?fid=1234&pageSize=1000&requesterFids%5B0%5D=1234`);
      expect(options).toMatchObject({ redirect: 'manual', credentials: 'omit', cache: 'no-store' });
      expect([...options.headers]).toEqual([['accept', 'application/json'], [ORIGIN_TOKEN_HEADER.toLowerCase(), ORIGIN_TOKEN]]);
    }
    expect(cache.match).not.toHaveBeenCalled(); expect(cache.put).not.toHaveBeenCalled();
  });

  it.each([
    { HYPERSNAP_ORIGIN: PRIVATE_ORIGIN }, { HYPERSNAP_ORIGIN_TOKEN: ORIGIN_TOKEN },
    { ...privateConfig, HYPERSNAP_ORIGIN: `${PRIVATE_ORIGIN}/v1` },
    { ...privateConfig, HYPERSNAP_ORIGIN_TOKEN: 'short' },
  ])('fails closed with sanitized 503 on invalid media origin configuration %j', async config => {
    const { env, fetch, put, storage } = environment();
    const result = await handleMediaRequest(upload(await grantFor()), { ...env, ...config });
    expect(result.status).toBe(503); expect(await result.json()).toEqual({ code: 'registry_unavailable', message: 'Signer authorization could not be checked.' });
    expect(fetch).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(storage.values.size).toBe(0);
  });

  it('does not follow private registry redirects, leak their credentials or reserve storage', async () => {
    const { env, fetch, put, storage } = environment();
    fetch.mockImplementationOnce(async () => new Response(ORIGIN_TOKEN, { status: 307, headers: { Location: `https://attacker.example/${ORIGIN_TOKEN}`, [ORIGIN_TOKEN_HEADER]: ORIGIN_TOKEN } }));
    const result = await handleMediaRequest(upload(await grantFor()), { ...env, ...privateConfig });
    expect(result.status).toBe(503); expect(await result.text()).not.toContain(ORIGIN_TOKEN); expect(result.headers.has('Location')).toBe(false); expect(result.headers.has(ORIGIN_TOKEN_HEADER)).toBe(false);
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][1].redirect).toBe('manual'); expect(put).not.toHaveBeenCalled(); expect(storage.values.size).toBe(0);
  });

  it('retains the 10-second private signer deadline without reserving storage', async () => {
    vi.useFakeTimers(); const { env, fetch, put, storage } = environment();
    fetch.mockImplementationOnce((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(new Error(ORIGIN_TOKEN)))));
    const pending = handleMediaRequest(upload(await grantFor()), { ...env, ...privateConfig });
    await vi.advanceTimersByTimeAsync(9_999); expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); const result = await pending;
    expect(result.status).toBe(503); expect(await result.text()).not.toContain(ORIGIN_TOKEN); expect(put).not.toHaveBeenCalled(); expect(storage.values.size).toBe(0);
  });

  it.each(([1, 2] as const).flatMap(check => (['ignored fetch abort', 'stalled success body', 'pending error cancellation', 'rejected error cancellation', 'late fetch rejection'] as const).map(mode => ({ check, mode }))))('hard-bounds signer check $check with $mode and zero storage effects', async ({ check, mode }) => {
    const grant = await grantFor();
    vi.useFakeTimers();
    const { env, fetch, put, storage, quota, images } = environment();
    const getQuota = vi.spyOn(env.MEDIA_QUOTA!, 'get'); const reserve = vi.spyOn(quota, 'fetch');
    const storagePut = vi.spyOn(storage, 'put'); const transaction = vi.spyOn(storage, 'transaction'); const alarm = vi.spyOn(storage, 'setAlarm');
    const validRegistry = fetch.getMockImplementation()!;
    if (check === 2) fetch.mockImplementationOnce(validRegistry);
    let resolveLate: ((response: Response) => void) | undefined;
    let rejectLate: ((reason: Error) => void) | undefined;
    const cancel = vi.fn(() => mode === 'rejected error cancellation'
      ? Promise.reject(new Error(ORIGIN_TOKEN)) : new Promise<void>(() => undefined));
    fetch.mockImplementationOnce(() => {
      if (mode === 'ignored fetch abort' || mode === 'late fetch rejection') {
        return new Promise<Response>((resolve, reject) => { resolveLate = resolve; rejectLate = reject; });
      }
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ cancel }), {
        status: mode === 'stalled success body' ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      }));
    });
    const req = upload(grant); const pending = handleMediaRequest(req, { ...env, ...privateConfig });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(check));
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(result.status).toBe(503); expect(await result.text()).not.toContain(ORIGIN_TOKEN);
    expect(req.bodyUsed).toBe(check === 2);
    if (mode === 'ignored fetch abort') {
      resolveLate!(new Response(new ReadableStream<Uint8Array>({ cancel }), { headers: { 'Content-Type': 'application/json' } }));
      await vi.advanceTimersByTimeAsync(0); expect(cancel).toHaveBeenCalledOnce();
    } else if (mode === 'late fetch rejection') {
      rejectLate!(new Error(ORIGIN_TOKEN)); await vi.advanceTimersByTimeAsync(0);
    } else { expect(cancel).toHaveBeenCalledOnce(); }
    for (const effect of [getQuota, reserve, storagePut, transaction, alarm, put]) expect(effect).not.toHaveBeenCalled();
    expect(storage.values.size).toBe(0); expect(images.size).toBe(0); expect(storage.alarm).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(check); expect(vi.getTimerCount()).toBe(0);
    for (const [url] of fetch.mock.calls) expect(url).toContain(`${PRIVATE_ORIGIN}/v1/signersByFid?`);
  });

  it('keeps existing public media and legacy redirects available independently of broken private-node configuration', async () => {
    const { env, fetch, images } = environment(); const digest = await sha256Hex(png); images.set(digest, { bytes: png, type: 'image/png' });
    const settings = { ...env, HYPERSNAP_ORIGIN: PRIVATE_ORIGIN, ASSETS: { fetch: vi.fn() } };
    const moved = await handleRequest(new Request(`${LEGACY}/media/${digest}`), settings);
    expect(moved.status).toBe(308);
    const result = await handleRequest(new Request(moved.headers.get('Location')!), settings);
    expect(result.status).toBe(200); expect(new Uint8Array(await result.arrayBuffer())).toEqual(png); expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['redirect', 'timeout', 'HTTP error', 'transport error', 'malformed JSON', 'invalid registry'] as const)('fails closed on the SECOND private-origin signer check (%s), with zero quota/storage effects', async outcome => {
    const grant = await grantFor();
    vi.useFakeTimers();
    const { env, fetch, put, storage, quota, images } = environment();
    const getQuota = vi.spyOn(env.MEDIA_QUOTA!, 'get');
    const reserve = vi.spyOn(quota, 'fetch');
    const storagePut = vi.spyOn(storage, 'put'); const transaction = vi.spyOn(storage, 'transaction'); const alarm = vi.spyOn(storage, 'setAlarm');
    const cache = { match: vi.fn(), put: vi.fn() }; vi.stubGlobal('caches', { default: cache });
    // The first check succeeds. Only the post-transfer recheck fails.
    fetch.mockImplementationOnce(fetch.getMockImplementation()!);
    fetch.mockImplementationOnce((_url: string, options: RequestInit) => {
      if (outcome === 'timeout') return new Promise<Response>((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(new Error(ORIGIN_TOKEN))));
      if (outcome === 'transport error') return Promise.reject(new Error(ORIGIN_TOKEN));
      return Promise.resolve(outcome === 'redirect'
        ? new Response(ORIGIN_TOKEN, { status: 307, headers: { Location: `https://attacker.example/${ORIGIN_TOKEN}`, [ORIGIN_TOKEN_HEADER]: ORIGIN_TOKEN } })
        : outcome === 'HTTP error' ? new Response(ORIGIN_TOKEN, { status: 500 })
          : new Response(outcome === 'malformed JSON' ? '{' : JSON.stringify({ signers: ORIGIN_TOKEN }), { headers: { 'Content-Type': 'application/json' } }));
    });
    const req = upload(grant);
    const pending = handleMediaRequest(req, { ...env, ...privateConfig });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    if (outcome === 'timeout') {
      expect(fetch.mock.calls[1][1].signal.aborted).toBe(false);
      expect(getQuota).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
    }
    const result = await pending;
    expect(req.bodyUsed).toBe(true); expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ code: 'registry_unavailable', message: 'Signer authorization could not be checked.' });
    for (const name of ['Location', ORIGIN_TOKEN_HEADER, 'X-Opencaster-Aggregate-Cache']) expect(result.headers.has(name)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetch.mock.calls) {
      expect(url).toBe(`${PRIVATE_ORIGIN}/v1/signersByFid?fid=1234&pageSize=1000&requesterFids%5B0%5D=1234`);
      expect(options).toMatchObject({ redirect: 'manual', credentials: 'omit', cache: 'no-store' });
      expect(options.headers.get(ORIGIN_TOKEN_HEADER)).toBe(ORIGIN_TOKEN);
    }
    for (const effect of [getQuota, reserve, storagePut, transaction, alarm, put, cache.match, cache.put]) expect(effect).not.toHaveBeenCalled();
    expect(storage.values.size).toBe(0); expect(storage.alarm).toBe(0); expect(images.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });

  it('redirects legacy public image URLs to the same bucket without blocking cross-origin images', async () => {
    const { env, images } = environment(); const digest = await sha256Hex(png); images.set(digest, { bytes: png, type: 'image/png' });
    const workerEnv = { ...env, ASSETS: { fetch: vi.fn() } };
    const redirect = await handleRequest(new Request(`${LEGACY}/media/${digest}`), workerEnv);
    expect(redirect.status).toBe(308); expect(redirect.headers.get('Location')).toBe(`${BASE}/media/${digest}`); expect(redirect.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    const image = await handleRequest(new Request(redirect.headers.get('Location')!), workerEnv);
    expect(image.status).toBe(200); expect(image.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin'); expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
  });

  it('never redirects or forwards a legacy image upload and rejects its grant on the new origin', async () => {
    const { env, fetch, put } = environment();
    const legacyGrant = await createMediaUploadGrant({ origin: LEGACY, sha256: await sha256Hex(png), size: png.length, contentType: 'image/png' }, { fid: 1234, publicKey }, async payload => ed25519.sign(payload, key));
    const legacyUpload = new Request(`${LEGACY}/media/upload`, { method: 'POST', headers: { Origin: LEGACY, 'Content-Type': legacyGrant.contentType, [MEDIA_UPLOAD_HEADER]: JSON.stringify(legacyGrant) }, body: new Uint8Array(png).buffer });
    const moved = await handleRequest(legacyUpload, { ...env, ASSETS: { fetch: vi.fn() } });
    expect(moved.status).toBe(409); expect(await moved.json()).toMatchObject({ code: 'site_moved' }); expect(legacyUpload.bodyUsed).toBe(false);
    expect((await handleMediaRequest(upload(legacyGrant), env)).status).toBe(401);
    for (const origin of [LEGACY, 'null', 'https://hypersnap-quorum.lf-e32.workers.dev']) expect((await handleMediaRequest(upload(legacyGrant, png, { Origin: origin }), env)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
  });

  it('stores only signed, active-signer, bounded images and serves immutable inert content', async () => {
    const { env, fetch, put } = environment();
    const grant = await grantFor();
    const response = await handleMediaRequest(upload(grant), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: `${BASE}/media/${grant.sha256}` });
    expect(fetch.mock.calls[0][0]).toBe('https://haatz.quilibrium.com/v1/signersByFid?fid=1234&pageSize=1000&requesterFids%5B0%5D=1234');
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual', cache: 'no-store' });
    expect(put.mock.calls[0][2]).toMatchObject({ onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'image/png' } });
    const image = await handleMediaRequest(new Request(`${BASE}/media/${grant.sha256}`), env);
    expect(image.headers.get('Content-Type')).toBe('image/png');
    expect(image.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(image.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(image.headers.get('Cache-Control')).toContain('immutable');
    expect(image.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
    const cached = await handleMediaRequest(new Request(`${BASE}/media/${grant.sha256}`, { headers: { 'If-None-Match': `"${grant.sha256}"` } }), env);
    expect(cached.status).toBe(304);
  });

  it('rejects unsigned, foreign-origin and tampered grants before registry or storage', async () => {
    const { env, fetch, put } = environment();
    const grant = await grantFor();
    for (const request of [
      new Request(`${BASE}/media/upload`, { method: 'POST', headers: { Origin: BASE } }),
      upload(grant, png, { Origin: 'https://attacker.example' }),
      upload({ ...grant, fid: 4321 }),
      upload({ ...grant, sha256: 'f'.repeat(64) }),
      upload({ ...grant, publicKey: 'a'.repeat(64) }),
    ]) expect((await handleMediaRequest(request, env)).status).toBeGreaterThanOrEqual(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('refuses replay with an atomic nonce reservation, including concurrent attempts', async () => {
    const { env, put } = environment();
    const grant = await grantFor();
    const responses = await Promise.all([handleMediaRequest(upload(grant), env), handleMediaRequest(upload(grant), env)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(put).toHaveBeenCalledOnce();
  });

  it('denies expired, wrong-owner, wrong-scope and truncated signer registries', async () => {
    const { env, fetch, put } = environment();
    const grant = await grantFor();
    for (const signer of [
      { source: 'SIGNER_SOURCE_OFFCHAIN', requestFid: 1234, expiresAt: 1, scopes: ['MESSAGE_TYPE_CAST_ADD'] },
      { source: 'SIGNER_SOURCE_OFFCHAIN', requestFid: 777, expiresAt: 9999999999, scopes: ['MESSAGE_TYPE_CAST_ADD'] },
      { source: 'SIGNER_SOURCE_OFFCHAIN', requestFid: 1234, expiresAt: 9999999999, scopes: ['MESSAGE_TYPE_REACTION_ADD'] },
      { source: 'SIGNER_SOURCE_ONCHAIN', requestFid: 1234, expiresAt: 9999999999, scopes: ['MESSAGE_TYPE_CAST_ADD'] },
    ]) {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({ signers: [{ key: publicKey, ...signer }] }), { headers: { 'Content-Type': 'application/json' } }));
      expect((await handleMediaRequest(upload(grant), env)).status).toBe(403);
    }
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ signers: [], nextPageToken: 'more' }), { headers: { 'Content-Type': 'application/json' } }));
    expect((await handleMediaRequest(upload(grant), env)).status).toBe(503);
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects mismatched bytes, forged file types and oversize streams without storing them', async () => {
    const { env, put } = environment();
    const grant = await grantFor();
    const changed = new Uint8Array(png); changed[changed.length - 1] ^= 1;
    expect((await handleMediaRequest(upload(grant, changed), env)).status).toBe(400);
    const html = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await handleMediaRequest(upload(await grantFor(html), html), env)).status).toBe(415);
    expect((await handleMediaRequest(upload(grant, new Uint8Array(MAX_MEDIA_BYTES + 1)), env)).status).toBe(413);
    expect(put).not.toHaveBeenCalled();
  });

  it('rechecks revocation after the image transfer before reserving storage', async () => {
    const { env, fetch, put, storage } = environment();
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ signers: [{ key: publicKey, source: 'SIGNER_SOURCE_OFFCHAIN', requestFid: 1234, expiresAt: Math.floor(Date.now() / 1000) + 3600, scopes: ['MESSAGE_TYPE_CAST_ADD'] }] }), { headers: { 'Content-Type': 'application/json' } }));
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ signers: [] }), { headers: { 'Content-Type': 'application/json' } }));
    expect((await handleMediaRequest(upload(await grantFor()), env)).status).toBe(403);
    expect(put).not.toHaveBeenCalled();
    expect(storage.values.size).toBe(0);
  });

  it('enforces daily account quota and clears nonce/account state only after grants expire', async () => {
    const { env, storage, quota, put } = environment();
    for (let i = 0; i < 10; i++) expect((await handleMediaRequest(upload(await grantFor()), env)).status).toBe(200);
    expect((await handleMediaRequest(upload(await grantFor()), env)).status).toBe(429);
    expect(put).toHaveBeenCalledTimes(10);
    expect(storage.alarm).toBeGreaterThan(Date.now() + 120000);
    await quota.alarm();
    expect(storage.values.size).toBe(0);
  });

  it('fails closed when infrastructure or the fixed Hypersnap registry is unavailable', async () => {
    expect((await handleMediaRequest(upload(await grantFor()), {})).status).toBe(503);
    const { env, fetch, put } = environment();
    fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://attacker.example' } }));
    expect((await handleMediaRequest(upload(await grantFor()), env)).status).toBe(503);
    expect(put).not.toHaveBeenCalled();
  });

  it('keeps grants separate from cast signatures and rejects extra fields, unsupported hosts and expiry extension', async () => {
    const grant = await grantFor();
    const payload = mediaGrantPayload(grant);
    expect(new TextDecoder().decode(payload)).toMatch(/^arca\.hypersnap\.media\.upload\.v1\n/);
    expect(ed25519.verify(hexToBytes(grant.signature), payload, ed25519.getPublicKey(key), { zip215: false })).toBe(true);
    expect(() => parseMediaUploadGrant({ ...grant, seed: 'forbidden' })).toThrow();
    expect(() => parseMediaUploadGrant({ ...grant, origin: 'https://attacker.example' })).toThrow();
    expect(() => parseMediaUploadGrant({ ...grant, expiresAt: grant.issuedAt + 121 })).toThrow();
    expect(() => parseMediaUploadGrant(grant, grant.expiresAt)).toThrow();
  });

  it('checks image dimensions as well as MIME signatures', () => {
    expect(() => validateImage(png, 'image/png')).not.toThrow();
    const huge = new Uint8Array(png); new DataView(huge.buffer).setUint32(16, 9000);
    expect(() => validateImage(huge, 'image/png')).toThrow();
    expect(() => validateImage(png, 'image/jpeg')).toThrow();
    expect(() => validateImage(new Uint8Array(), 'image/png')).toThrow();
  });
});
