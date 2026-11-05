// Public client locations only. Protocol labels, storage keys and WebAuthn RP IDs
// remain independent of this display/hosting migration. Mobile migration candidate.
export const APP_ORIGIN = 'https://opencaster.org';
export const LEGACY_APP_ORIGIN = 'https://quorum.arca.computer';
export const WORKER_ORIGIN = 'https://hypersnap-quorum.lf-e32.workers.dev';
export const APP_ORIGINS = [APP_ORIGIN, LEGACY_APP_ORIGIN, WORKER_ORIGIN] as const;

/** Origins whose `/media/<sha256>` paths are our content-addressed uploads. */
export const UPLOADED_MEDIA_ORIGINS: readonly string[] = [APP_ORIGIN, LEGACY_APP_ORIGIN];
export const MEDIA_PATH = /^\/media\/[a-f0-9]{64}$/;

/** The public URL the gateway issues for an uploaded image. */
export function mediaUrl(sha256: string): string {
  return `${APP_ORIGIN}/media/${sha256}`;
}

/** Parsed URL on an uploaded-media origin with a content-addressed path. */
export function isUploadedMediaLocation(url: URL): boolean {
  return UPLOADED_MEDIA_ORIGINS.includes(url.origin) && MEDIA_PATH.test(url.pathname);
}

/** Published image URLs retain their original host and content address.
 * Exact string match: no normalization, query, fragment or other origin. */
export function isUploadedMediaUrl(value: unknown): value is string {
  return typeof value === 'string' && UPLOADED_MEDIA_ORIGINS.some(origin => value.startsWith(origin) && MEDIA_PATH.test(value.slice(origin.length)));
}
