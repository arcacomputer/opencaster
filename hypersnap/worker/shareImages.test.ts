import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadShareData, type ShareData, type ShareProfile } from './shareData';
import { handleShareImage, shareImagePath, shareImageRoute, type ShareImageEnv } from './shareImages';
import { previewImageData } from './shareMedia';
import { renderSharePng } from './sharePng';

vi.mock('./shareData', () => ({ loadShareData: vi.fn() }));
vi.mock('./shareMedia', async importOriginal => ({ ...await importOriginal<typeof import('./shareMedia')>(), previewImageData: vi.fn() }));
// Keep the Worker-only Wasm module out of Vitest; exercise the real SVG layout.
vi.mock('./sharePng', () => ({ renderSharePng: vi.fn() }));

const ORIGIN = 'https://opencaster.org';
const HASH = 'ab'.repeat(20);
const PROFILE_PATH = '/_share/v1/profile/42.png';
const CAST_PATH = `/_share/v1/cast/42/${HASH}.png`;
const FONT_URL = `${ORIGIN}/InterVariable.ttf`;
const FALLBACK_URL = `${ORIGIN}/opencaster-social-v1.png`;
const png = new Uint8Array(readFileSync(new URL('../public/opencaster-social-v1.png', import.meta.url)));
const font = new Uint8Array([0, 1, 2, 3]);
const raster = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
const profile: ShareProfile = {
  fid: 42, username: 'alice', displayName: 'Alice Rivera', bio: 'Art and open conversations.',
  avatarUrl: 'https://imagedelivery.net/account/avatar/public', followers: 1234, following: 56,
};
const profileData: ShareData = { kind: 'profile', profile };
const castData: ShareData = {
  kind: 'cast', profile, hash: `0x${HASH}`, text: 'Hello from the actual public cast.',
  timestamp: '2026-10-26T00:00:00Z',
  imageUrls: [`${ORIGIN}/media/${'c'.repeat(64)}`, `${ORIGIN}/media/${'d'.repeat(64)}`],
};

function fixture() {
  const assets = vi.fn(async (request: Request) => {
    if (request.url === FONT_URL) return new Response(new Uint8Array(font).buffer);
    if (request.url === FALLBACK_URL) return new Response(new Uint8Array(png).buffer, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000' },
    });
    throw new Error(`Unexpected preview asset ${request.url}`);
  });
  const env: ShareImageEnv = { ASSETS: { fetch: assets } };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: vi.fn((promise: Promise<unknown>) => { pending.push(promise); }) };
  const network = vi.fn().mockRejectedValue(new Error('Image routes must use their fixed asset binding.'));
  vi.stubGlobal('fetch', network);
  vi.stubGlobal('caches', undefined);
  return { env, assets, ctx, pending, network };
}

function request(path = PROFILE_PATH, init?: RequestInit): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

function imageResponse(marker = 'cached'): Response {
  return new Response(new Uint8Array(png).buffer, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300', 'X-Test': marker },
  });
}

beforeEach(() => {
  vi.mocked(loadShareData).mockReset().mockResolvedValue(profileData);
  vi.mocked(previewImageData).mockReset().mockResolvedValue(undefined);
  vi.mocked(renderSharePng).mockReset().mockResolvedValue(png);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('identity-only public preview image paths', () => {
  it('uses versioned exact FID and full-hash paths for generated cards', () => {
    expect(shareImagePath(profileData)).toBe(PROFILE_PATH);
    expect(shareImagePath(castData)).toBe(CAST_PATH);
    expect(shareImagePath({ ...castData, hash: HASH })).toBe(CAST_PATH);
    expect(shareImageRoute(new URL(PROFILE_PATH, ORIGIN))).toEqual({ kind: 'profile', identifier: '42' });
    expect(shareImageRoute(new URL(CAST_PATH, ORIGIN))).toEqual({ kind: 'cast-alias', authorIdentifier: '42', hashPrefix: `0x${HASH}` });
    expect(shareImageRoute(new URL('/_share/v1/profile/4294967295.png', ORIGIN))).toEqual({ kind: 'profile', identifier: '4294967295' });
  });

  it.each([
    '/_share/v2/profile/42.png', '/_share/v1/profile/alice.png',
    '/_share/v1/profile/0.png', '/_share/v1/profile/042.png',
    '/_share/v1/profile/-1.png', '/_share/v1/profile/1.5.png',
    '/_share/v1/profile/4294967296.png', '/_share/v1/profile/99999999999.png',
    '/_share/v1/profile/%34%32.png', '/_share/v1/profile/42.PNG',
    '/_share/v1/profile/42.png/extra', '/_share/v1/profile/42.svg',
    '/_share/v1/profile/42.png?text=forged', '/_share/v1/profile/42.png?image=https://attacker.test/p.png',
    `/_share/v1/cast/alice/${HASH}.png`, `/_share/v1/cast/0/${HASH}.png`,
    `/_share/v1/cast/42/0x${HASH}.png`, `/_share/v1/cast/42/${HASH.toUpperCase()}.png`,
    `/_share/v1/cast/42/${HASH.slice(2)}.png`, `/_share/v1/cast/42/${HASH}ab.png`,
    `/_share/v1/cast/42/${HASH}.png?title=forged`, '/_share/v1/' + 'a'.repeat(130),
  ])('rejects unsupported or content-bearing image route %s without looking up data', async path => {
    const { env, assets } = fixture();
    expect(shareImageRoute(new URL(path, ORIGIN))).toBeUndefined();
    const response = await handleShareImage(request(path), env);
    expect(response.status).toBe(404); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(loadShareData).not.toHaveBeenCalled(); expect(assets).not.toHaveBeenCalled();
    expect(renderSharePng).not.toHaveBeenCalled();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('rejects %s before cache, data or image work', async method => {
    const { env, assets } = fixture();
    const cache = { match: vi.fn(), put: vi.fn() }; vi.stubGlobal('caches', { default: cache });
    const response = await handleShareImage(request(PROFILE_PATH, { method }), env);
    expect(response.status).toBe(405); expect(response.body).toBeNull();
    expect(response.headers.get('Allow')).toBe('GET, HEAD'); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(cache.match).not.toHaveBeenCalled(); expect(loadShareData).not.toHaveBeenCalled();
    expect(assets).not.toHaveBeenCalled(); expect(previewImageData).not.toHaveBeenCalled();
  });

  it.each([PROFILE_PATH, CAST_PATH])('serves a bodyless HEAD for %s without lookup, font, renderer or cache work', async path => {
    const { env, assets } = fixture();
    const cache = { match: vi.fn(), put: vi.fn() }; vi.stubGlobal('caches', { default: cache });
    const response = await handleShareImage(request(path, { method: 'HEAD' }), env);
    expect(response.status).toBe(200); expect(response.body).toBeNull();
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(cache.match).not.toHaveBeenCalled(); expect(loadShareData).not.toHaveBeenCalled();
    expect(assets).not.toHaveBeenCalled(); expect(previewImageData).not.toHaveBeenCalled();
    expect(renderSharePng).not.toHaveBeenCalled();
  });
});

describe('generated preview PNG responses', () => {
  it('renders the resolved profile with correct public PNG headers and one fixed font asset', async () => {
    const { env, assets, network } = fixture();
    vi.mocked(previewImageData).mockResolvedValueOnce(raster);
    const req = request();
    const response = await handleShareImage(req, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Opencaster-Preview')).toBe('profile');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    expect(loadShareData).toHaveBeenCalledExactlyOnceWith({ kind: 'profile', identifier: '42' }, env, req.signal);
    expect(previewImageData).toHaveBeenCalledExactlyOnceWith(profile.avatarUrl, env);
    expect(renderSharePng).toHaveBeenCalledOnce();
    const [svg, fontBytes] = vi.mocked(renderSharePng).mock.calls[0];
    expect(svg).toContain('Alice Rivera'); expect(svg).toContain('Art and open conversations.');
    expect(svg).toContain(`data-role="avatar" href="${raster}"`); expect(fontBytes).toEqual(font);
    expect(assets).toHaveBeenCalledOnce(); expect(assets.mock.calls[0][0].url).toBe(FONT_URL);
    expect(network).not.toHaveBeenCalled();
  });

  it('renders the actual full-hash cast and first image using only validated media helper results', async () => {
    const { env } = fixture();
    vi.mocked(loadShareData).mockResolvedValueOnce(castData);
    vi.mocked(previewImageData).mockResolvedValue(raster);
    const response = await handleShareImage(request(CAST_PATH), env);
    expect(response.headers.get('X-Opencaster-Preview')).toBe('cast');
    expect(loadShareData).toHaveBeenCalledWith({ kind: 'cast-alias', authorIdentifier: '42', hashPrefix: `0x${HASH}` }, env, expect.any(AbortSignal));
    expect(previewImageData).toHaveBeenCalledTimes(2);
    expect(previewImageData).toHaveBeenNthCalledWith(1, profile.avatarUrl, env);
    expect(previewImageData).toHaveBeenNthCalledWith(2, castData.imageUrls![0], env);
    const svg = vi.mocked(renderSharePng).mock.calls[0][0];
    expect(svg).toContain(castData.text); expect(svg).toContain('Alice Rivera');
    expect(svg).toContain('data-role="cast-image"'); expect(svg).not.toContain(castData.imageUrls![0]);
  });

  it('reuses font bytes for the same asset binding without sharing them across bindings', async () => {
    const first = fixture();
    await handleShareImage(request(), first.env); await handleShareImage(request(), first.env);
    expect(first.assets.mock.calls.map(([req]) => req.url)).toEqual([FONT_URL]);
    const second = fixture(); await handleShareImage(request(), second.env);
    expect(second.assets.mock.calls.map(([req]) => req.url)).toEqual([FONT_URL]);
  });

  it('keeps incoming cookies and authorization out of fixed font and fallback asset requests', async () => {
    const { env, assets } = fixture();
    const req = () => request(PROFILE_PATH, { headers: { Cookie: 'session=private', Authorization: 'Bearer private', 'X-Opencaster-Origin-Token': 'private' } });
    await handleShareImage(req(), env);
    vi.mocked(loadShareData).mockResolvedValueOnce(undefined);
    await handleShareImage(req(), env);
    expect(assets.mock.calls.map(([asset]) => asset.url)).toEqual([FONT_URL, FALLBACK_URL]);
    for (const [asset] of assets.mock.calls) {
      expect(asset.method).toBe('GET'); expect([...asset.headers]).toEqual([]);
    }
  });
});

describe('optional public image cache', () => {
  it('returns an early PNG cache hit before data, font or media lookup', async () => {
    const { env, assets, ctx } = fixture();
    const cached = imageResponse();
    const cache = { match: vi.fn().mockResolvedValue(cached), put: vi.fn() }; vi.stubGlobal('caches', { default: cache });
    expect(await handleShareImage(request(), env, ctx)).toBe(cached);
    expect(loadShareData).not.toHaveBeenCalled(); expect(previewImageData).not.toHaveBeenCalled();
    expect(assets).not.toHaveBeenCalled(); expect(renderSharePng).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled(); expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it('uses a fixed canonical cookie-free key and puts the exact generated PNG through waitUntil with TTL 300', async () => {
    const { env, ctx, pending } = fixture();
    const cache = { match: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) }; vi.stubGlobal('caches', { default: cache });
    const incoming = new Request(`https://preview.example${PROFILE_PATH}`, { headers: { Cookie: 'private', Authorization: 'private', 'X-Opencaster-Origin-Token': 'private' } });
    const response = await handleShareImage(incoming, env, ctx);
    expect(ctx.waitUntil).toHaveBeenCalledOnce(); await Promise.all(pending);
    expect(cache.match).toHaveBeenCalledOnce(); expect(cache.put).toHaveBeenCalledOnce();
    for (const key of [cache.match.mock.calls[0][0], cache.put.mock.calls[0][0]] as Request[]) {
      expect(key.url).toBe(`${ORIGIN}${PROFILE_PATH}`); expect(key.method).toBe('GET'); expect([...key.headers]).toEqual([]);
    }
    const stored = cache.put.mock.calls[0][1] as Response;
    expect(stored).not.toBe(response); expect(stored.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(stored.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(png);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  });

  it.each([
    { status: 404, type: 'image/png' }, { status: 200, type: 'text/html' },
  ])('discards an unusable cached response $status $type and renders fresh data', async ({ status, type }) => {
    const { env } = fixture();
    const cancel = vi.fn();
    const cached = new Response(new ReadableStream({ cancel }), { status, headers: { 'Content-Type': type } });
    const cache = { match: vi.fn().mockResolvedValue(cached), put: vi.fn() }; vi.stubGlobal('caches', { default: cache });
    const response = await handleShareImage(request(), env);
    expect(response.headers.get('X-Opencaster-Preview')).toBe('profile');
    expect(cancel).toHaveBeenCalledOnce(); expect(loadShareData).toHaveBeenCalledOnce();
  });

  it('renders normally when cache match rejects and absorbs background put failures', async () => {
    const { env, ctx, pending } = fixture();
    const cache = { match: vi.fn().mockRejectedValue(new Error('Cache unavailable')), put: vi.fn().mockRejectedValue(new Error('Cache write unavailable')) };
    vi.stubGlobal('caches', { default: cache });
    const response = await handleShareImage(request(), env, ctx);
    expect(response.headers.get('X-Opencaster-Preview')).toBe('profile');
    expect(ctx.waitUntil).toHaveBeenCalledOnce(); await expect(Promise.all(pending)).resolves.toEqual([undefined]);
  });

  it.each(['match', 'put'] as const)('preserves the generated PNG if optional cache %s throws synchronously', async operation => {
    const { env, ctx, pending } = fixture();
    const cache = { match: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) };
    cache[operation].mockImplementationOnce(() => { throw new Error('Optional cache unavailable'); });
    vi.stubGlobal('caches', { default: cache });
    const response = await handleShareImage(request(), env, ctx);
    expect(response.headers.get('X-Opencaster-Preview')).toBe('profile');
    await expect(Promise.all(pending)).resolves.toBeDefined();
  });

  it('renders normally if reading the optional cache binding throws', async () => {
    const { env } = fixture();
    vi.stubGlobal('caches', { get default() { throw new Error('Optional cache binding unavailable'); } });
    const response = await handleShareImage(request(), env);
    expect(response.headers.get('X-Opencaster-Preview')).toBe('profile');
  });

  it('continues after 150 ms when cache match never settles', async () => {
    vi.useFakeTimers();
    const { env } = fixture();
    const cache = { match: vi.fn(() => new Promise<Response>(() => undefined)), put: vi.fn() }; vi.stubGlobal('caches', { default: cache });
    const pending = handleShareImage(request(), env);
    await vi.advanceTimersByTimeAsync(149); expect(loadShareData).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;
    expect(response.headers.get('X-Opencaster-Preview')).toBe('profile');
    expect(loadShareData).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('serves generated data without cache writes when waitUntil is unavailable', async () => {
    const { env } = fixture();
    const cache = { match: vi.fn().mockResolvedValue(undefined), put: vi.fn() }; vi.stubGlobal('caches', { default: cache });
    expect((await handleShareImage(request(), env)).headers.get('X-Opencaster-Preview')).toBe('profile');
    expect(cache.put).not.toHaveBeenCalled();
  });
});

describe('uncached generic image fallback', () => {
  it('serves the fixed generic image when no public identity is available', async () => {
    const { env, assets, ctx } = fixture();
    vi.mocked(loadShareData).mockResolvedValueOnce(undefined);
    const cache = { match: vi.fn().mockResolvedValue(undefined), put: vi.fn() }; vi.stubGlobal('caches', { default: cache });
    const response = await handleShareImage(request(), env, ctx);
    expect(response.status).toBe(200); expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(response.headers.get('X-Opencaster-Preview')).toBe('fallback');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    expect(assets.mock.calls.map(([asset]) => asset.url)).toEqual([FALLBACK_URL]);
    expect(previewImageData).not.toHaveBeenCalled(); expect(renderSharePng).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled(); expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it.each(['renderer', 'font status', 'font network', 'font size'] as const)('falls back uncached after %s failure', async mode => {
    const { env, assets, ctx } = fixture();
    const cache = { match: vi.fn().mockResolvedValue(undefined), put: vi.fn() }; vi.stubGlobal('caches', { default: cache });
    if (mode === 'renderer') vi.mocked(renderSharePng).mockRejectedValueOnce(new Error('Render unavailable'));
    else if (mode === 'font status') assets.mockResolvedValueOnce(new Response(null, { status: 404 }));
    else if (mode === 'font network') assets.mockRejectedValueOnce(new Error('Font unavailable'));
    else assets.mockResolvedValueOnce(new Response(new Uint8Array(1_000_001).buffer));
    const response = await handleShareImage(request(), env, ctx);
    expect(response.headers.get('X-Opencaster-Preview')).toBe('fallback');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(assets.mock.calls.map(([asset]) => asset.url)).toEqual([FONT_URL, FALLBACK_URL]);
    expect(cache.put).not.toHaveBeenCalled(); expect(ctx.waitUntil).not.toHaveBeenCalled();
    if (mode !== 'renderer') expect(renderSharePng).not.toHaveBeenCalled();
  });

  it('retries loading a font after a failure instead of permanently caching the rejection', async () => {
    const { env, assets } = fixture();
    assets.mockRejectedValueOnce(new Error('Temporary font failure'));
    expect((await handleShareImage(request(), env)).headers.get('X-Opencaster-Preview')).toBe('fallback');
    expect((await handleShareImage(request(), env)).headers.get('X-Opencaster-Preview')).toBe('profile');
    expect(assets.mock.calls.map(([asset]) => asset.url)).toEqual([FONT_URL, FALLBACK_URL, FONT_URL]);
  });

  it.each(['font', 'renderer'] as const)('falls back at its per-resource deadline when %s never settles', async stalled => {
    vi.useFakeTimers();
    const { env, assets, ctx } = fixture();
    const cache = { match: vi.fn().mockResolvedValue(undefined), put: vi.fn() }; vi.stubGlobal('caches', { default: cache });
    if (stalled === 'font') assets.mockImplementationOnce(() => new Promise<Response>(() => undefined));
    else vi.mocked(renderSharePng).mockImplementationOnce(() => new Promise<Uint8Array>(() => undefined));
    let settled = false;
    const pending = handleShareImage(request(), env, ctx).then(response => { settled = true; return response; });
    const deadline = stalled === 'font' ? 1000 : 1800;
    await vi.advanceTimersByTimeAsync(deadline - 1); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;
    expect(response.headers.get('X-Opencaster-Preview')).toBe('fallback');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(cache.put).not.toHaveBeenCalled(); expect(ctx.waitUntil).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries font loading after its 1000 ms deadline instead of retaining a stalled promise', async () => {
    vi.useFakeTimers();
    const { env, assets } = fixture();
    assets.mockImplementationOnce(() => new Promise<Response>(() => undefined));
    const pending = handleShareImage(request(), env);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).headers.get('X-Opencaster-Preview')).toBe('fallback');
    expect((await handleShareImage(request(), env)).headers.get('X-Opencaster-Preview')).toBe('profile');
    expect(assets.mock.calls.map(([asset]) => asset.url)).toEqual([FONT_URL, FALLBACK_URL, FONT_URL]);
    expect(renderSharePng).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});
