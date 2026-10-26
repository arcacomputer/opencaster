import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaEnv } from './media';
import { previewImageData, previewImageUrl } from './shareMedia';
import { ORIGIN_TOKEN_HEADER } from './upstream';

const BASE = 'https://opencaster.org';
const LEGACY = 'https://quorum.arca.computer';
const HASH = 'a'.repeat(64);
const OWN_IMAGE = `${BASE}/media/${HASH}`;
const CDN_IMAGE = 'https://imagedelivery.net/public-account/profile-image/public';
const MAX_BYTES = 1024 * 1024;
const png = new Uint8Array(readFileSync(new URL('../public/unknown-dark.png', import.meta.url)));
const expectedData = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;

function environment() {
  const get = vi.fn(async () => ({
    body: new Response(new Uint8Array(png).buffer).body!,
    size: png.length,
    httpEtag: `"${HASH}"`,
    httpMetadata: { contentType: 'image/png' },
  }));
  const quotaFetch = vi.fn();
  const env: MediaEnv = {
    HYPERSNAP_ORIGIN: 'https://node.example.test',
    HYPERSNAP_ORIGIN_TOKEN: 'synthetic-private-origin-token_0123456789',
    HYPERSNAP_READ_FALLBACK: 'haatz-v1',
    MEDIA_BUCKET: { get, head: vi.fn(), put: vi.fn() },
    MEDIA_QUOTA: { idFromName: vi.fn(), get: () => ({ fetch: quotaFetch }) },
  };
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(imageResponse());
  vi.stubGlobal('fetch', fetch);
  return { env, fetch, get, quotaFetch };
}

function imageResponse(bytes = png, headers: HeadersInit = {}): Response {
  return new Response(new Uint8Array(bytes).buffer, { headers: { 'Content-Type': 'image/png', ...headers } });
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('share preview image allowlist', () => {
  it.each([BASE, LEGACY])('accepts fixed content-hash media on %s and normalizes its storage origin', origin => {
    expect(previewImageUrl(`${origin}/media/${HASH}`)?.href).toBe(OWN_IMAGE);
  });

  it.each([
    CDN_IMAGE,
    'https://imagedelivery.net/account_123-abc/avatar_123-abc/w=800,h=800,fit=cover',
  ])('accepts a fixed public image CDN path: %s', input => {
    expect(previewImageUrl(input)?.href).toBe(input);
  });

  it.each([
    undefined, '', 'not a URL', '/media/' + HASH,
    `http://opencaster.org/media/${HASH}`,
    `https://opencaster.org.attacker.test/media/${HASH}`,
    `https://attacker.test/media/${HASH}`,
    `https://node.example.test/media/${HASH}`,
    `https://127.0.0.1/media/${HASH}`,
    `https://user:password@opencaster.org/media/${HASH}`,
    `https://user@imagedelivery.net/account/avatar/public`,
    `https://opencaster.org:8443/media/${HASH}`,
    'https://imagedelivery.net:8443/account/avatar/public',
    `${OWN_IMAGE}?download=1`, `${OWN_IMAGE}#fragment`,
    `${BASE}/media/${HASH.toUpperCase()}`, `${BASE}/media/${HASH.slice(1)}`,
    `${BASE}/media/${HASH}/`, `${BASE}/media/upload`,
    `${BASE}/media/%61${HASH.slice(1)}`,
    `${BASE}/media/../media/${HASH}%00`,
    `${BASE}\\media\\${HASH}`,
    ` ${OWN_IMAGE}`, `${OWN_IMAGE}\n`,
    'https://imagedelivery.net.attacker.test/account/avatar/public',
    'https://imagedelivery.net/account/avatar',
    'https://imagedelivery.net/account/avatar/public/extra',
    'https://imagedelivery.net/account/avatar/public?token=secret',
    'https://imagedelivery.net/account/avatar/public#fragment',
    'https://imagedelivery.net/account/avatar/%70ublic',
    'https://imagedelivery.net/account/avatar/public.svg',
    `https://imagedelivery.net/${'a'.repeat(129)}/avatar/public`,
    `https://imagedelivery.net/${'a'.repeat(2050)}`,
  ])('rejects unavailable or untrusted image locations: %s', input => {
    expect(previewImageUrl(input)).toBeUndefined();
  });
});

describe('share preview image bytes', () => {
  it.each([BASE, LEGACY])('reads and validates own media from %s directly from the bucket', async origin => {
    const { env, fetch, get, quotaFetch } = environment();
    expect(await previewImageData(`${origin}/media/${HASH}`, env)).toBe(expectedData);
    expect(get).toHaveBeenCalledExactlyOnceWith(HASH);
    expect(fetch).not.toHaveBeenCalled();
    expect(quotaFetch).not.toHaveBeenCalled();
    expect(env.MEDIA_BUCKET!.put).not.toHaveBeenCalled();
  });

  it('embeds valid CDN image bytes with no cookies, origin credential or redirect following', async () => {
    const { env, fetch, get } = environment();
    expect(await previewImageData(CDN_IMAGE, env)).toBe(expectedData);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(CDN_IMAGE);
    expect(options).toMatchObject({ redirect: 'manual', credentials: 'omit', cache: 'no-store' });
    expect(options!.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(options!.headers);
    expect([...headers]).toEqual([['accept', 'image/png,image/jpeg']]);
    expect(headers.has('Cookie')).toBe(false);
    expect(headers.has('Authorization')).toBe(false);
    expect(headers.has(ORIGIN_TOKEN_HEADER)).toBe(false);
    expect(JSON.stringify([url, options])).not.toContain(env.HYPERSNAP_ORIGIN_TOKEN);
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects disallowed locations before any network or bucket work', async () => {
    const { env, fetch, get } = environment();
    expect(await previewImageData('https://attacker.test/image.png', env)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  });

  it.each([301, 302, 307, 308, 404, 500])('falls back on HTTP %s without following a redirect', async status => {
    const { env, fetch } = environment();
    const cancel = vi.fn();
    fetch.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), {
      status, headers: { 'Content-Type': 'image/png', Location: 'https://attacker.test/private' },
    }));
    expect(await previewImageData(CDN_IMAGE, env)).toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]!.redirect).toBe('manual');
  });

  it.each(['image/svg+xml', 'image/gif', 'image/webp', 'image/avif', 'text/html', 'application/octet-stream', ''])('does not embed active or unsupported MIME data: %s', async type => {
    const { env, fetch } = environment();
    fetch.mockResolvedValueOnce(imageResponse(png, { 'Content-Type': type }));
    expect(await previewImageData(CDN_IMAGE, env)).toBeUndefined();
  });

  it.each(['image/png', 'image/jpeg', 'image/webp'])('validates the bytes against declared %s MIME', async type => {
    const { env, fetch } = environment();
    fetch.mockResolvedValueOnce(imageResponse(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), { 'Content-Type': type }));
    expect(await previewImageData(CDN_IMAGE, env)).toBeUndefined();
  });

  it('accepts a valid MIME with charset parameters', async () => {
    const { env, fetch } = environment();
    fetch.mockResolvedValueOnce(imageResponse(png, { 'Content-Type': 'IMAGE/PNG; charset=binary' }));
    expect(await previewImageData(CDN_IMAGE, env)).toBe(expectedData);
  });

  it.each([String(MAX_BYTES + 1), '-1', '1.5', 'unknown'])('rejects an oversized or invalid advertised content length %s before reading', async length => {
    const { env, fetch } = environment();
    const cancel = vi.fn();
    fetch.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), {
      headers: { 'Content-Type': 'image/png', 'Content-Length': length },
    }));
    expect(await previewImageData(CDN_IMAGE, env)).toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('bounds compressed bytes even when content length is missing or dishonest', async () => {
    const { env, fetch } = environment();
    for (const headers of [{}, { 'Content-Length': '1' }] as Array<Record<string, string>>) {
      const cancel = vi.fn();
      fetch.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(MAX_BYTES)); controller.enqueue(new Uint8Array(1)); },
        cancel,
      }), { headers: { 'Content-Type': 'image/png', ...headers } }));
      expect(await previewImageData(CDN_IMAGE, env)).toBeUndefined();
      expect(cancel).toHaveBeenCalledOnce();
    }
  });

  it.each([[2049, 1], [1, 2049], [1500, 1500], [0, 1], [9000, 1]])('bounds decoded dimensions %s × %s before rendering', async (width, height) => {
    const { env, fetch } = environment();
    const bytes = new Uint8Array(png);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width); view.setUint32(20, height);
    fetch.mockResolvedValueOnce(imageResponse(bytes));
    expect(await previewImageData(CDN_IMAGE, env)).toBeUndefined();
  });

  it('falls back when media storage or network is unavailable', async () => {
    const { env, fetch, get } = environment();
    expect(await previewImageData(OWN_IMAGE, {})).toBeUndefined();
    get.mockRejectedValueOnce(new Error('Synthetic storage error'));
    expect(await previewImageData(OWN_IMAGE, env)).toBeUndefined();
    fetch.mockRejectedValueOnce(new Error('Synthetic transport error'));
    expect(await previewImageData(CDN_IMAGE, env)).toBeUndefined();
  });

  it('does not wait beyond 1200 ms for a fetch that ignores abort and cancels its late body', async () => {
    vi.useFakeTimers();
    const { env, fetch } = environment();
    let finish!: (response: Response) => void;
    fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    let settled = false;
    const pending = previewImageData(CDN_IMAGE, env).then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(1199);
    expect(settled).toBe(false); expect(fetch.mock.calls[0][1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeUndefined(); expect(fetch.mock.calls[0][1]!.signal!.aborted).toBe(true);
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    finish(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'image/png' } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not wait beyond 1200 ms for a stalled body whose cancellation never completes', async () => {
    vi.useFakeTimers();
    const { env, fetch } = environment();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    fetch.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'image/png' } }));
    let settled = false;
    const pending = previewImageData(CDN_IMAGE, env).then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(1199);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeUndefined(); expect(cancel).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]!.signal!.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  it('also bounds a stalled own-media bucket request without making a network request', async () => {
    vi.useFakeTimers();
    const { env, fetch, get } = environment();
    get.mockImplementationOnce(() => new Promise(() => undefined));
    const pending = previewImageData(OWN_IMAGE, env);
    await vi.advanceTimersByTimeAsync(1200);
    expect(await pending).toBeUndefined(); expect(fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the deadline after successful image loading', async () => {
    vi.useFakeTimers();
    const { env } = environment();
    expect(await previewImageData(CDN_IMAGE, env)).toBe(expectedData);
    expect(vi.getTimerCount()).toBe(0);
  });
});
