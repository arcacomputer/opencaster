import { APP_ORIGIN } from '../src/lib/appOrigins';
import type { AppRoute } from '../src/lib/navigation';
import { loadShareData, type ShareData } from './shareData';
import { buildShareSvg } from './shareLayout';
import { previewImageData, previewImageUrl } from './shareMedia';
import type { MediaEnv } from './media';

export interface ShareImageEnv extends MediaEnv { ASSETS: { fetch(request: Request): Promise<Response> } }
interface Context { waitUntil(promise: Promise<unknown>): void }
interface ImageCache { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<void> }
const IMAGE_HEADERS = {
  'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300',
  'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff',
};

export function shareImagePath(data: ShareData): string {
  return data.kind === 'profile' ? `/_share/v1/profile/${data.profile.fid}.png`
    : `/_share/v1/cast/${data.profile.fid}/${data.hash.replace(/^0x/, '')}.png`;
}

export function shareImageRoute(url: URL): AppRoute | undefined {
  if (url.search || url.pathname.length > 128) return;
  const profile = /^\/_share\/v1\/profile\/([1-9]\d{0,9})\.png$/.exec(url.pathname);
  const cast = /^\/_share\/v1\/cast\/([1-9]\d{0,9})\/([a-f0-9]{40})\.png$/.exec(url.pathname);
  const fid = Number(profile?.[1] ?? cast?.[1]);
  if (!Number.isSafeInteger(fid) || fid <= 0 || fid > 0xffffffff) return;
  if (profile) return { kind: 'profile', identifier: String(fid) };
  if (cast) return { kind: 'cast-alias', authorIdentifier: String(fid), hashPrefix: `0x${cast[2]}` };
}

const fontPromises = new WeakMap<ShareImageEnv['ASSETS'], Promise<Uint8Array>>();
function fontFor(env: ShareImageEnv): Promise<Uint8Array> {
  let pending = fontPromises.get(env.ASSETS);
  if (!pending) {
    const load = (async () => {
      const response = await env.ASSETS.fetch(new Request(`${APP_ORIGIN}/InterVariable.ttf`));
      if (response.status !== 200 || !response.body) { void response.body?.cancel().catch(() => undefined); throw new Error('Font unavailable'); }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          size += item.value.length;
          if (size > 1_000_000) { void reader.cancel().catch(() => undefined); throw new Error('Font too large'); }
          chunks.push(item.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return bytes;
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    pending = Promise.race([load, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Font unavailable')), 1000);
    })]).finally(() => clearTimeout(timer)).catch(error => { fontPromises.delete(env.ASSETS); throw error; });
    fontPromises.set(env.ASSETS, pending);
  }
  return pending;
}

async function boundedCacheRead(cache: ImageCache, key: Request): Promise<Response | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => cache.match(key)).catch(() => undefined),
      new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 150); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Identity-only routes: text and images never come from request parameters.
 * Public PNGs expire after five minutes, including casts that may be deleted.
 */
export async function handleShareImage(request: Request, env: ShareImageEnv, ctx?: Context): Promise<Response> {
  const url = new URL(request.url);
  const route = shareImageRoute(url);
  if (!route) return new Response('Preview not found.', { status: 404, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
  if (request.method === 'HEAD') return new Response(null, { headers: { ...IMAGE_HEADERS, 'Cache-Control': 'no-store' } });

  let cache: ImageCache | undefined;
  try { cache = typeof caches === 'undefined' ? undefined : (caches as CacheStorage & { default?: ImageCache }).default; } catch { /* Optional edge cache. */ }
  const key = new Request(`${APP_ORIGIN}${url.pathname}`);
  if (cache) {
    const cached = await boundedCacheRead(cache, key);
    if (cached?.status === 200 && cached.headers.get('Content-Type') === 'image/png') return cached;
    void cached?.body?.cancel().catch(() => undefined);
  }

  const data = await loadShareData(route, env, request.signal);
  if (data) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const render = (async () => {
      const [avatarDataUrl, imageDataUrl, font, renderer] = await Promise.all([
        previewImageData(data.profile.avatarUrl, env),
        data.kind === 'cast' ? previewImageData(data.imageUrls?.find(value => previewImageUrl(value)), env) : undefined,
        fontFor(env), import('./sharePng'),
      ]);
      const bytes = await renderer.renderSharePng(buildShareSvg(data, { avatarDataUrl, imageDataUrl }), font);
      return new Response(new Uint8Array(bytes).buffer, { headers: { ...IMAGE_HEADERS, 'X-Opencaster-Preview': data.kind } });
    })();
    try {
      const response = await Promise.race([render, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 1800); })]);
      if (response) {
        if (cache && ctx) {
          const output = response.clone();
          ctx.waitUntil(Promise.resolve().then(() => cache!.put(key, output)).catch(() => undefined));
        }
        return response;
      }
    } catch { /* Unavailable imagery must not break sharing. */ }
    finally { clearTimeout(timer); }
  }
  const fallback = await env.ASSETS.fetch(new Request(`${APP_ORIGIN}/opencaster-social-v1.png`));
  const headers = new Headers(fallback.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  headers.set('X-Opencaster-Preview', 'fallback');
  return new Response(fallback.body, { status: fallback.status, headers });
}
