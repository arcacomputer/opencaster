/** Server-only node configuration. Never import this module into browser code. */
export interface UpstreamEnv {
  HYPERSNAP_ORIGIN?: string;
  HYPERSNAP_ORIGIN_TOKEN?: string;
  HYPERSNAP_READ_FALLBACK?: string;
  HYPERSNAP_NATIVE_READS?: string;
  HYPERSNAP_READ_ORIGIN?: string;
  HYPERSNAP_READ_ORIGIN_TOKEN?: string;
}

export interface UpstreamConfig {
  readonly origin: string;
  readonly token?: string;
}

const PUBLIC_ORIGIN = 'https://haatz.quilibrium.com';
export const ORIGIN_TOKEN_HEADER = 'X-Opencaster-Origin-Token';

export class UpstreamConfigurationError extends Error {
  constructor() { super('Node configuration unavailable'); }
}

export class InvalidUpstreamResponseError extends Error {}

/** Only an entirely absent pair selects the public development/fork default.
 * Reject malformed input before URL normalization can hide paths or userinfo. */
export function resolveUpstream(env: UpstreamEnv): UpstreamConfig {
  const origin = env.HYPERSNAP_ORIGIN;
  const token = env.HYPERSNAP_ORIGIN_TOKEN;
  if (origin === undefined && token === undefined) return { origin: PUBLIC_ORIGIN };
  if (typeof origin !== 'string' || typeof token !== 'string'
    || origin.trim() !== origin
    || !/^https:\/\/[^/?#\\\s@%]+\/?$/.test(origin)
    || token.length < 32 || /[^A-Za-z0-9_-]/.test(token)) throw new UpstreamConfigurationError();
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) throw new UpstreamConfigurationError();
    return { origin: url.origin, token };
  } catch { throw new UpstreamConfigurationError(); }
}

const NATIVE_READ_PATHS = new Set([
  '/v1/info',
  '/v2/farcaster/user',
  '/v2/farcaster/user/bulk',
  '/v2/farcaster/user/search',
]);

/** Proxy-only, exact read opt-in. Validate the base even when overriding it;
 * media authorization, sharing and signed submissions retain that base. */
export function resolveProxyUpstream(env: UpstreamEnv, path: string, method: string): UpstreamConfig {
  const base = resolveUpstream(env);
  if (env.HYPERSNAP_NATIVE_READS !== 'profiles-v1' || method !== 'GET' || !NATIVE_READ_PATHS.has(path)) return base;
  const read = resolveUpstream({
    HYPERSNAP_ORIGIN: env.HYPERSNAP_READ_ORIGIN,
    HYPERSNAP_ORIGIN_TOKEN: env.HYPERSNAP_READ_ORIGIN_TOKEN,
  });
  // Unlike the base, an enabled native read must never default to public Haatz.
  if (!read.token) throw new UpstreamConfigurationError();
  return read;
}

/** Fixed server-only read backup. Call only after primary validation; absence or
 * unknown opt-ins never enable it, and no request value controls its host. */
export function resolveReadFallback(env: UpstreamEnv, primary: UpstreamConfig): UpstreamConfig | undefined {
  if (primary.token && env.HYPERSNAP_READ_FALLBACK === 'haatz-v1') return { origin: PUBLIC_ORIGIN };
}

/** The timeline cursor is a scoped User/cast primary key. Stock Hypersnap pages
 * this feed over its Hyper store (root byte 1e) on every origin we use; the
 * retired fork-era node issued the same key under root 03. Both name one
 * logical position, so either is accepted and sent as 1e. A stock node answers
 * a root-03 key with an empty 200 page, which would silently end a timeline.
 * Preserve FID/postfix/timestamp/hash exactly; never repair unknown formats. */
export function validTimelineCursor(cursor: string, fid: string): boolean {
  if (!/^(?:03|1e)[a-fA-F0-9]{58}$/.test(cursor) || cursor.slice(10, 12) !== '01' || !/^\d{1,16}$/.test(fid)) return false;
  return BigInt(`0x${cursor.slice(2, 10)}`) === BigInt(fid);
}

/** Fresh allowlisted headers, regardless of the caller's headers. Never forward
 * browser credentials or follow a redirect carrying the private origin token.
 * Callers retain their own body/response bounds and abort deadline. */
export function fetchUpstream(config: UpstreamConfig, path: string, init: RequestInit = {}): Promise<Response> {
  if (!path.startsWith('/v1/') && !path.startsWith('/v2/')) throw new Error('Invalid node path');
  const destination = new URL(`${config.origin}${path}`);
  if (destination.origin !== config.origin || destination.hash || destination.username || destination.password) throw new Error('Invalid node path');
  if (destination.pathname === '/v2/farcaster/feed/user/casts' && destination.searchParams.has('cursor')) {
    const cursor = destination.searchParams.get('cursor')!;
    if (!validTimelineCursor(cursor, destination.searchParams.get('fid') ?? '')) throw new Error('Invalid timeline cursor');
    destination.searchParams.set('cursor', '1e' + cursor.slice(2));
  }
  const supplied = new Headers(init.headers);
  const headers = new Headers({ Accept: 'application/json' });
  const contentType = supplied.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);
  if (config.token) headers.set(ORIGIN_TOKEN_HEADER, config.token);
  return fetch(destination.href, {
    ...init, headers, redirect: 'manual', credentials: 'omit', cache: 'no-store',
  });
}

/** Even a misconfigured origin that reflects a request header must not expose
 * the credential in a successful JSON payload or a cached copy of that payload. */
export function parseUpstreamObject(bytes: Uint8Array, config: UpstreamConfig): Record<string, unknown> {
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch { throw new InvalidUpstreamResponseError('Invalid node response'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new InvalidUpstreamResponseError('Invalid node response');
  if (config.token) {
    if (text.includes(config.token)) throw new InvalidUpstreamResponseError('Invalid node response');
    // Validate string tokens in the original representation before forwarding
    // bytes. Unescaped tokens are covered by the complete-text check above.
    for (const match of text.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
      if (match[0].includes('\\') && (JSON.parse(match[0]) as string).includes(config.token)) throw new InvalidUpstreamResponseError('Invalid node response');
    }
  }
  return value as Record<string, unknown>;
}
