// Public client locations only. Protocol labels, storage keys and WebAuthn RP IDs
// remain independent of this display/hosting migration. Mobile migration candidate.
export const APP_ORIGIN = 'https://opencaster.org';
export const LEGACY_APP_ORIGIN = 'https://quorum.arca.computer';
export const WORKER_ORIGIN = 'https://hypersnap-quorum.lf-e32.workers.dev';
export const APP_ORIGINS = [APP_ORIGIN, LEGACY_APP_ORIGIN, WORKER_ORIGIN] as const;

/** Published image URLs retain their original host and content address. */
export function isUploadedMediaUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\/(?:opencaster\.org|quorum\.arca\.computer)\/media\/[a-f0-9]{64}$/.test(value);
}
