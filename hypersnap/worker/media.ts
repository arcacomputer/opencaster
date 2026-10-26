import { ed25519 } from '@noble/curves/ed25519.js';
import { MAX_MEDIA_BYTES, MEDIA_UPLOAD_HEADER, isMediaType, mediaGrantPayload, parseMediaUploadGrant, sha256Hex, type MediaType, type MediaUploadGrant } from '../src/lib/media';
import { hexToBytes } from '../src/lib/protocol/signedKeyRequest';
import { fetchUpstream, resolveUpstream, type UpstreamEnv } from './upstream';

interface MediaObject {
  body: ReadableStream<Uint8Array>; size: number; httpEtag: string;
  httpMetadata?: { contentType?: string };
}
export interface MediaEnv extends UpstreamEnv {
  MEDIA_BUCKET?: {
    get(key: string): Promise<MediaObject | null>;
    head(key: string): Promise<Omit<MediaObject, 'body'> | null>;
    put(key: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string; cacheControl: string }; onlyIf: { etagDoesNotMatch: string } }): Promise<unknown>;
  };
  MEDIA_QUOTA?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
}

const DAY_SECONDS = 86400;
const MAX_REGISTRY_BYTES = 1024 * 1024;
const MAX_DAILY_ACCOUNT_UPLOADS = 10;
const MAX_DAILY_ACCOUNT_BYTES = 50 * 1024 * 1024;
const MAX_DAILY_UPLOADS = 1000;
const MAX_DAILY_BYTES = 5 * 1024 * 1024 * 1024;
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
  'Cross-Origin-Resource-Policy': 'cross-origin', 'Cache-Control': 'no-store',
};
function failure(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message }), { status, headers: { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });
}
function success(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }

async function readLimited(body: ReadableStream<Uint8Array> | null, limit: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (!body) throw new Error('Missing body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal?.aborted) { cancel(); throw new Error('Registry deadline exceeded'); }
      const item = await reader.read();
      if (signal?.aborted) throw new Error('Registry deadline exceeded');
      if (item.done) break;
      length += item.value.byteLength;
      if (length > limit) { cancel(); throw new Error('Body too large'); }
      chunks.push(item.value);
    }
  } finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Header signatures are checked before the node request or durable storage.
 * Revoked/expired keys never authorize a new upload, even if the browser kept it. */
async function activeSigner(grant: MediaUploadGrant, env: MediaEnv): Promise<boolean> {
  const config = resolveUpstream(env);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Registry deadline exceeded')); }, 10000);
  });
  // Race the complete operation, not only fetch's abort signal. A transport or
  // cancellation hook can ignore abort; it must never hold upload authorization.
  const lookup = Promise.resolve().then(async () => {
    const params = new URLSearchParams({ fid: String(grant.fid), pageSize: '1000', 'requesterFids[0]': String(grant.fid) });
    const response = await fetchUpstream(config, `/v1/signersByFid?${params}`, { signal: controller.signal });
    if (controller.signal.aborted || !response.ok || !response.headers.get('Content-Type')?.includes('application/json')) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error('Registry unavailable');
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(await readLimited(response.body, MAX_REGISTRY_BYTES, controller.signal)));
    if (!object(value) || !Array.isArray(value.signers) || value.signers.length > 1000) throw new Error('Invalid registry');
    // Fail closed on a truncated list. An account with more keys may revoke old
    // keys first; pagination cannot silently turn an incomplete view into trust.
    if (value.nextPageToken) throw new Error('Registry incomplete');
    return value.signers.some(signer => object(signer)
      && typeof signer.key === 'string' && signer.key.replace(/^0x/i, '').toLowerCase() === grant.publicKey
      && signer.source === 'SIGNER_SOURCE_OFFCHAIN' && signer.requestFid === grant.fid
      && Number.isSafeInteger(signer.expiresAt) && Number(signer.expiresAt) > Math.floor(Date.now() / 1000) + 30
      && Array.isArray(signer.scopes) && signer.scopes.includes('MESSAGE_TYPE_CAST_ADD'));
  });
  // Promise.race observes lookup's late rejection as well as its first outcome.
  try { return await Promise.race([lookup, deadline]); }
  finally { clearTimeout(timer); }
}

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
/** Image signatures and declared dimensions are validated server-side. SVG,
 * HTML and arbitrary MIME data are never stored or rendered as active content. */
export function validateImage(bytes: Uint8Array, type: MediaType): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  if (type === 'image/png' && bytes.length >= 45 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)
    && view.getUint32(8) === 13 && ascii(bytes, 12, 4) === 'IHDR' && view.getUint32(bytes.length - 12) === 0 && ascii(bytes, bytes.length - 8, 4) === 'IEND') {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (type === 'image/gif' && bytes.length >= 14 && ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6)) && bytes.at(-1) === 0x3b) {
    width = view.getUint16(6, true); height = view.getUint16(8, true);
  } else if (type === 'image/webp' && bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP' && view.getUint32(4, true) === bytes.length - 8) {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === 'VP8X' && view.getUint32(16, true) === 10) {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
      width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
    } else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    }
  } else if (type === 'image/jpeg' && bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 8) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  }
  if (!width || !height || width > 8192 || height > 8192 || width * height > 25_000_000) throw new Error('Invalid or oversized image');
  return { width, height };
}

/** Called only for /media paths, before the SPA fallback. */
export async function handleMediaRequest(request: Request, env: MediaEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.search || url.pathname.includes('%')) return failure(400, 'invalid_media_path', 'Invalid image path.');
  if (!env.MEDIA_BUCKET || !env.MEDIA_QUOTA) return failure(503, 'media_unavailable', 'Image uploads are temporarily unavailable.');
  if (/^\/media\/[a-f0-9]{64}$/.test(url.pathname)) {
    if (!['GET', 'HEAD'].includes(request.method)) return failure(405, 'method_not_allowed', 'This method is unavailable.');
    try {
      const key = url.pathname.slice('/media/'.length);
      const item = request.method === 'HEAD' ? await env.MEDIA_BUCKET.head(key) : await env.MEDIA_BUCKET.get(key);
      if (!item || !isMediaType(item.httpMetadata?.contentType)) return failure(404, 'media_not_found', 'Image not found.');
      const headers = new Headers({ ...BASE_HEADERS, 'Content-Type': item.httpMetadata.contentType, 'Content-Length': String(item.size), 'Cache-Control': 'public, max-age=31536000, immutable', ETag: item.httpEtag });
      if (request.headers.get('If-None-Match') === item.httpEtag) return new Response(null, { status: 304, headers });
      return new Response(request.method === 'HEAD' ? null : (item as MediaObject).body, { headers });
    } catch { return failure(503, 'media_unavailable', 'Image uploads are temporarily unavailable.'); }
  }
  if (url.pathname !== '/media/upload') return failure(404, 'media_not_found', 'Image not found.');
  if (request.method !== 'POST') return failure(405, 'method_not_allowed', 'This method is unavailable.');
  if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return failure(403, 'origin_denied', 'Cross-site image uploads are unavailable.');
  const raw = request.headers.get(MEDIA_UPLOAD_HEADER);
  if (!raw || raw.length > 2048) return failure(401, 'invalid_grant', 'A device upload authorization is required.');
  let grant: MediaUploadGrant;
  try {
    grant = parseMediaUploadGrant(JSON.parse(raw));
    if (grant.origin !== url.origin || request.headers.get('Content-Type') !== grant.contentType
      || !ed25519.verify(hexToBytes(grant.signature), mediaGrantPayload(grant), hexToBytes(grant.publicKey), { zip215: false })) throw new Error('Grant mismatch');
  } catch { return failure(401, 'invalid_grant', 'The device upload authorization is invalid or expired.'); }
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d{1,8}$/.test(length) || Number(length) !== grant.size)) return failure(413, 'image_too_large', 'Image size does not match its authorization.');
  try { if (!await activeSigner(grant, env)) return failure(403, 'signer_denied', 'This device is no longer authorized to upload.'); }
  catch { return failure(503, 'registry_unavailable', 'Signer authorization could not be checked.'); }
  let bytes: Uint8Array;
  try { bytes = await readLimited(request.body, MAX_MEDIA_BYTES); }
  catch { return failure(413, 'image_too_large', 'Choose an image up to 5 MiB.'); }
  if (bytes.byteLength !== grant.size || await sha256Hex(bytes) !== grant.sha256) return failure(400, 'image_mismatch', 'The image does not match its authorization.');
  try { validateImage(bytes, grant.contentType); }
  catch { return failure(415, 'invalid_image', 'Choose a valid JPEG, PNG, WebP or GIF image.'); }
  // Reading a slow mobile upload may outlive its initial signer check. Check
  // authorization again immediately before reserving storage, so a key revoked
  // or expired during the transfer cannot rely on the earlier registry result.
  try { if (!await activeSigner(grant, env)) return failure(403, 'signer_denied', 'This device is no longer authorized to upload.'); }
  catch { return failure(503, 'registry_unavailable', 'Signer authorization could not be checked.'); }
  // Registry/body work may have outlived the short authorization window.
  try { parseMediaUploadGrant(grant); }
  catch { return failure(401, 'invalid_grant', 'The upload authorization expired.'); }
  try {
    // The issued day keeps a replay in the same object across UTC midnight.
    const quota = env.MEDIA_QUOTA.get(env.MEDIA_QUOTA.idFromName(`media-day-${Math.floor(grant.issuedAt / DAY_SECONDS)}`));
    const reserved = await quota.fetch(new Request('https://media-quota.internal/reserve', { method: 'POST', body: JSON.stringify(grant) }));
    if (!reserved.ok) return failure(reserved.status === 409 ? 409 : 429, 'upload_limit', reserved.status === 409 ? 'This upload authorization was already used.' : 'The daily image upload limit has been reached.');
    await env.MEDIA_BUCKET.put(grant.sha256, new Uint8Array(bytes).buffer, {
      httpMetadata: { contentType: grant.contentType, cacheControl: 'public, max-age=31536000, immutable' },
      onlyIf: { etagDoesNotMatch: '*' },
    });
    return success({ url: `https://opencaster.org/media/${grant.sha256}` });
  } catch { return failure(503, 'media_unavailable', 'The upload status could not be confirmed.'); }
}

interface QuotaStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  transaction<T>(callback: (txn: QuotaStorage) => Promise<T>): Promise<T>;
  setAlarm(time: number): Promise<void>;
  deleteAll(): Promise<void>;
}
/** SQLite-backed DO: quota and nonce reservation are one serializable commit.
 * Only the Worker binding reaches this class, never a public route. Each issued
 * UTC day's object deletes all state after every grant from that day expires. */
export class MediaUploadQuota {
  constructor(private readonly state: { storage: QuotaStorage }) {}
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return failure(405, 'method_not_allowed', 'Unavailable.');
    let grant: MediaUploadGrant;
    try {
      const text = await request.text();
      if (text.length > 2048) throw new Error('Too large');
      grant = parseMediaUploadGrant(JSON.parse(text));
    } catch { return failure(400, 'invalid_grant', 'Invalid grant.'); }
    const storage = this.state.storage;
    // Alarm scheduling precedes reservation; failure cannot leave retained
    // nonce state without its bounded cleanup time.
    await storage.setAlarm((Math.floor(grant.issuedAt / DAY_SECONDS) + 1) * DAY_SECONDS * 1000 + 300_000);
    const result = await storage.transaction(async txn => {
      const nonceKey = `nonce:${grant.fid}:${grant.publicKey}:${grant.nonce}`;
      if (await txn.get(nonceKey)) return 409;
      const accountKey = `fid:${grant.fid}`;
      const account = await txn.get<{ count: number; bytes: number }>(accountKey) || { count: 0, bytes: 0 };
      const total = await txn.get<{ count: number; bytes: number }>('total') || { count: 0, bytes: 0 };
      if (account.count >= MAX_DAILY_ACCOUNT_UPLOADS || account.bytes + grant.size > MAX_DAILY_ACCOUNT_BYTES
        || total.count >= MAX_DAILY_UPLOADS || total.bytes + grant.size > MAX_DAILY_BYTES) return 429;
      await txn.put(nonceKey, true);
      await txn.put(accountKey, { count: account.count + 1, bytes: account.bytes + grant.size });
      await txn.put('total', { count: total.count + 1, bytes: total.bytes + grant.size });
      return 200;
    });
    return result === 200 ? success({ reserved: true }) : failure(result, 'upload_limit', 'Upload limit reached.');
  }
  async alarm(): Promise<void> { await this.state.storage.deleteAll(); }
}
