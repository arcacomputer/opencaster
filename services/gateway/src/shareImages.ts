import { APP_ORIGIN } from '@opencaster/client-core/appOrigins';
import { readLimited } from '@opencaster/client-core/boundedRead';
import { CUSTOM_FEED_TOKEN_LIMIT, decodeFeed, encodeFeed } from '@opencaster/client-core/customFeeds';
import { CHANNEL_ID } from '@opencaster/client-core/apiRules';
import type { AppRoute } from '@opencaster/client-core/navigation';
import { loadShareData, type ShareData } from './shareData';
import { buildShareSvg } from './shareLayout';
import { previewImageData, previewImageUrl } from './shareMedia';
import type { MediaEnv } from './media';
import { hasModerationBinding } from './moderation';

export interface ShareImageEnv extends MediaEnv { ASSETS: { fetch(request: Request): Promise<Response> } }
interface Context { waitUntil(promise: Promise<unknown>): void }
interface ImageCache { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<void> }
const IMAGE_HEADERS = {
  'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300',
  'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff',
};

export function shareImagePath(data: ShareData): string {
  return data.kind === 'profile' ? `/_share/v1/profile/${data.profile.fid}.png`
    : data.kind === 'channel' ? `/_share/v1/channel/${data.channel.id}.png`
      : data.kind === 'feed' ? `/_share/v1/feed.png?feed=${encodeFeed(data.feed.definition)}`
        : `/_share/v1/cast/${data.profile.fid}/${data.hash.replace(/^0x/, '')}.png`;
}

export function shareImageRoute(url: URL): AppRoute | undefined {
  if (url.pathname.length > 128) return;
  if (url.pathname === '/_share/v1/feed.png') {
    if (url.search.length > CUSTOM_FEED_TOKEN_LIMIT + 6 || url.searchParams.size !== 1 || url.searchParams.getAll('feed').length !== 1) return;
    const definition = decodeFeed(url.searchParams.get('feed') ?? '');
    return definition ? { kind: 'feed', token: encodeFeed(definition) } : undefined;
  }
  if (url.search) return;
  const channel = /^\/_share\/v1\/channel\/(.+)\.png$/.exec(url.pathname);
  if (channel && CHANNEL_ID.test(channel[1])) return { kind: 'channel', channel: channel[1] };
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
      return readLimited(response.body, 1_000_000);
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

/** Entity routes and validated public feed recipes only. Arbitrary text,
 * images and browser-local settings never become preview inputs.
 * Public PNGs expire after five minutes, including casts that may be deleted.
 */
export async function handleShareImage(request: Request, env: ShareImageEnv, ctx?: Context): Promise<Response> {
  const url = new URL(request.url);
  const route = shareImageRoute(url);
  if (!route) return new Response('Preview not found.', { status: 404, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
  if (request.method === 'HEAD') return new Response(null, { headers: { ...IMAGE_HEADERS, 'Cache-Control': 'no-store' } });
  const moderationConfigured = hasModerationBinding(env);

  let cache: ImageCache | undefined;
  try { if (!moderationConfigured) cache = typeof caches === 'undefined' ? undefined : (caches as CacheStorage & { default?: ImageCache }).default; } catch { /* Optional edge cache. */ }
  const keyUrl = new URL(url.pathname, APP_ORIGIN);
  if (route.kind === 'feed') keyUrl.searchParams.set('feed', route.token);
  keyUrl.searchParams.set('brand', 'open-door-v2');
  const key = new Request(keyUrl);
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
        previewImageData(data.kind === 'channel' ? data.channel.imageUrl : data.kind === 'feed' ? undefined : data.profile.avatarUrl, env),
        data.kind === 'cast' ? previewImageData(data.imageUrls?.find(value => previewImageUrl(value)), env) : undefined,
        fontFor(env), import('./sharePng'),
      ]);
      const bytes = await renderer.renderSharePng(buildShareSvg(data, { avatarDataUrl, imageDataUrl }), font);
      return new Response(new Uint8Array(bytes).buffer, { headers: { ...IMAGE_HEADERS, ...(moderationConfigured ? { 'Cache-Control': 'no-store' } : {}), 'X-Opencaster-Preview': data.kind } });
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
  const fallback = await env.ASSETS.fetch(new Request(`${APP_ORIGIN}/opencaster-social-v2.png`));
  const headers = new Headers(fallback.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  headers.set('X-Opencaster-Preview', 'fallback');
  return new Response(fallback.body, { status: fallback.status, headers });
}
