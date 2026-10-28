import { APP_ORIGIN, LEGACY_APP_ORIGIN } from '@opencaster/client-core/appOrigins';
import { handleMediaRequest, validateImage, type MediaEnv } from './media';

/** Only our content-addressed storage and a fixed public image CDN are read.
 * No user-selected host, redirect, cookie, node credential or SVG reaches resvg.
 */
export function previewImageUrl(input: string | undefined): URL | undefined {
  if (!input || input.length > 2048 || /[\s\\%]/.test(input)) return;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return;
    if ([APP_ORIGIN, LEGACY_APP_ORIGIN].includes(url.origin)) {
      if (!url.search && /^\/media\/[a-f0-9]{64}$/.test(url.pathname)) return new URL(url.pathname, APP_ORIGIN);
    } else if (url.hostname === 'imagedelivery.net' && !url.search
      && /^\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_=,-]{1,128}$/.test(url.pathname)) return url;
  } catch { /* An unavailable avatar is represented by initials. */ }
}

const MAX_IMAGE_BYTES = 1024 * 1024;
const IMAGE_TIMEOUT_MS = 1200;

export async function previewImageData(input: string | undefined, env: MediaEnv): Promise<string | undefined> {
  const url = previewImageUrl(input);
  if (!url) return;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    const response = url.origin === APP_ORIGIN
      ? await handleMediaRequest(new Request(url.href), env)
      : await fetch(url.href, { signal: controller.signal, headers: { Accept: 'image/png,image/jpeg' }, redirect: 'manual', credentials: 'omit', cache: 'no-store' });
    const cancel = () => { void response.body?.cancel().catch(() => undefined); };
    const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
    const length = response.headers.get('Content-Length');
    // This renderer decodes PNG/JPEG. Do not negotiate WebP from the CDN: an
    // unsupported raster can otherwise leave a blank avatar in an SVG image.
    if (controller.signal.aborted || response.status !== 200 || !response.body || !['image/png', 'image/jpeg'].includes(type ?? '')
      || (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_IMAGE_BYTES))) { cancel(); return; }
    const reader = response.body.getReader();
    const abort = () => { void reader.cancel().catch(() => undefined); };
    controller.signal.addEventListener('abort', abort, { once: true });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (controller.signal.aborted) return;
        if (item.done) break;
        size += item.value.byteLength;
        if (size > MAX_IMAGE_BYTES) { abort(); return; }
        chunks.push(item.value);
      }
    } finally { controller.signal.removeEventListener('abort', abort); reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const dimensions = validateImage(bytes, type as 'image/png' | 'image/jpeg');
    // Bound decoded memory as well as compressed bytes before handing to Wasm.
    if (dimensions.width > 2048 || dimensions.height > 2048 || dimensions.width * dimensions.height > 2_000_000) return;
    let binary = '';
    for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    return `data:${type};base64,${btoa(binary)}`;
  })();
  const deadline = new Promise<undefined>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(undefined); }, IMAGE_TIMEOUT_MS); });
  try { return await Promise.race([work, deadline]); }
  catch { return; }
  finally { clearTimeout(timer); }
}
