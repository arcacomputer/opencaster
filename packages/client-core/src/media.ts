/** Public, domain-separated upload authorization. No custody or device secrets
 * leave the session closure. This platform-independent format can be shared by
 * a future mobile client; only uploadMedia uses browser File/fetch APIs.
 */
import { bytesToHex } from '@opencaster/protocol/signedKeyRequest';
import { APP_ORIGIN, APP_ORIGINS } from './appOrigins';

export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export type MediaType = typeof MEDIA_TYPES[number];
export interface MediaUploadInput { origin: string; sha256: string; size: number; contentType: MediaType }
export interface MediaUploadGrant extends MediaUploadInput {
  version: 1; fid: number; publicKey: string; nonce: string;
  issuedAt: number; expiresAt: number; signature: string;
}
export type UnsignedMediaUploadGrant = Omit<MediaUploadGrant, 'signature'>;
const FIELDS = ['version', 'origin', 'fid', 'publicKey', 'nonce', 'issuedAt', 'expiresAt', 'sha256', 'size', 'contentType'];
export const MEDIA_UPLOAD_HEADER = 'X-Arca-Media-Grant';
export const MEDIA_UPLOAD_TTL_SECONDS = 120;

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function isMediaType(value: unknown): value is MediaType { return MEDIA_TYPES.includes(value as MediaType); }
export function isMediaOrigin(value: unknown): value is string {
  return APP_ORIGINS.includes(value as typeof APP_ORIGINS[number]);
}
function validInput(value: MediaUploadInput): void {
  if (!isMediaOrigin(value.origin) || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.size)
    || value.size < 1 || value.size > MAX_MEDIA_BYTES || !isMediaType(value.contentType)) throw new Error('Choose a JPEG, PNG, WebP or GIF image up to 5 MiB.');
}

/** Exact fields and canonical encoding prevent the upload permission from
 * authorizing a Farcaster message, a different origin, or different content. */
export function mediaGrantPayload(grant: UnsignedMediaUploadGrant): Uint8Array {
  validInput(grant);
  if (grant.version !== 1 || !Number.isSafeInteger(grant.fid) || grant.fid < 1 || grant.fid > 0xffffffff
    || !/^[a-f0-9]{64}$/.test(grant.publicKey) || !/^[a-f0-9]{64}$/.test(grant.nonce)
    || !Number.isSafeInteger(grant.issuedAt) || !Number.isSafeInteger(grant.expiresAt)
    || grant.issuedAt < 1 || grant.expiresAt <= grant.issuedAt || grant.expiresAt - grant.issuedAt > MEDIA_UPLOAD_TTL_SECONDS) throw new Error('Invalid media authorization.');
  const canonical = {
    version: 1, origin: grant.origin, fid: grant.fid, publicKey: grant.publicKey, nonce: grant.nonce,
    issuedAt: grant.issuedAt, expiresAt: grant.expiresAt, sha256: grant.sha256, size: grant.size, contentType: grant.contentType,
  };
  return new TextEncoder().encode(`arca.hypersnap.media.upload.v1\n${JSON.stringify(canonical)}`);
}

export function parseMediaUploadGrant(value: unknown, now = Math.floor(Date.now() / 1000)): MediaUploadGrant {
  if (!object(value) || Object.keys(value).length !== FIELDS.length + 1
    || ![...FIELDS, 'signature'].every(name => Object.hasOwn(value, name))
    || typeof value.signature !== 'string' || !/^[a-f0-9]{128}$/.test(value.signature)) throw new Error('Invalid media authorization.');
  const grant = value as unknown as MediaUploadGrant;
  mediaGrantPayload(grant);
  if (grant.issuedAt > now + 10 || grant.issuedAt < now - MEDIA_UPLOAD_TTL_SECONDS || grant.expiresAt <= now) throw new Error('Media authorization expired. Choose the image again.');
  return grant;
}

export async function createMediaUploadGrant(input: MediaUploadInput, identity: { fid: number; publicKey: string }, sign: (payload: Uint8Array) => Promise<Uint8Array>): Promise<MediaUploadGrant> {
  validInput(input);
  const issuedAt = Math.floor(Date.now() / 1000);
  const grant: UnsignedMediaUploadGrant = {
    version: 1, origin: input.origin, fid: identity.fid, publicKey: identity.publicKey,
    nonce: bytesToHex(crypto.getRandomValues(new Uint8Array(32))), issuedAt, expiresAt: issuedAt + MEDIA_UPLOAD_TTL_SECONDS,
    sha256: input.sha256, size: input.size, contentType: input.contentType,
  };
  const signature = bytesToHex(await sign(mediaGrantPayload(grant)));
  return parseMediaUploadGrant({ ...grant, signature });
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)));
}

/** One explicit attempt. A failed or interrupted upload never retries itself. */
export async function uploadMedia(file: File, authorize: (input: MediaUploadInput) => Promise<MediaUploadGrant>, signal?: AbortSignal): Promise<{ url: string }> {
  if (signal?.aborted) throw new DOMException('Upload cancelled.', 'AbortError');
  const origin = globalThis.location?.origin;
  if (!isMediaOrigin(origin)) throw new Error('Image uploads are available on opencaster.org.');
  if (!isMediaType(file.type) || file.size < 1 || file.size > MAX_MEDIA_BYTES) throw new Error('Choose a JPEG, PNG, WebP or GIF image up to 5 MiB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = await sha256Hex(bytes);
  if (signal?.aborted) throw new DOMException('Upload cancelled.', 'AbortError');
  const grant = await authorize({ origin, sha256, size: bytes.byteLength, contentType: file.type });
  parseMediaUploadGrant(grant);
  if (grant.origin !== origin || grant.sha256 !== sha256 || grant.size !== bytes.byteLength || grant.contentType !== file.type) throw new Error('The image authorization does not match this upload.');
  if (signal?.aborted) throw new DOMException('Upload cancelled.', 'AbortError');
  let response: Response;
  try {
    response = await fetch('/media/upload', {
      method: 'POST', headers: { 'Content-Type': file.type, [MEDIA_UPLOAD_HEADER]: JSON.stringify(grant) },
      body: bytes.buffer, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal,
    });
  } catch {
    // Keep transport errors and signed upload metadata out of the public error.
    if (signal?.aborted) throw new DOMException('Upload cancelled.', 'AbortError');
    throw new Error('The upload status could not be confirmed. Check your attachment before trying again.');
  }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const messages: Record<number, string> = {
      400: 'The image could not be validated. Choose a different image.', 401: 'Your device authorization expired. Reconnect before uploading.',
      403: 'This device is not authorized to upload. Reconnect your account.', 409: 'This upload authorization was already used. Choose the image again.',
      413: 'Choose an image up to 5 MiB.', 415: 'Choose a valid JPEG, PNG, WebP or GIF image.',
      429: 'The upload limit has been reached. Try again tomorrow.', 503: 'Image uploads are temporarily unavailable.',
    };
    throw new Error(messages[response.status] || 'The upload status could not be confirmed. Check your attachment before trying again.');
  }
  const expected = `${APP_ORIGIN}/media/${sha256}`;
  if (!object(value) || value.url !== expected) throw new Error('The server returned an invalid image link.');
  return { url: expected };
}
