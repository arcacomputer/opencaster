/** Fixed-origin, bounded gateway. Custody secrets stay in the user's wallet;
 * this worker accepts public queries or signed wire bytes.
 */
import { handleMediaRequest, type MediaEnv } from './media';
import { normalizeHypersnapEnsName } from '../src/lib/ensName';
export { MediaUploadQuota } from './media';
export interface Env extends MediaEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}
export interface WorkerContext { waitUntil(promise: Promise<unknown>): void }

const UPSTREAM = 'https://haatz.quilibrium.com';
const CANONICAL_ORIGIN = 'https://opencaster.org';
const LEGACY_HOST = 'quorum.arca.computer';
const MAX_MESSAGE_BYTES = 65_536;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;
const SUBMISSION_UNKNOWN = 'Submission status is unknown. Check your profile or signer state before trying again.';

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; font-src 'self'; connect-src 'self' wss://relay.walletconnect.org wss://relay.walletconnect.com https://verify.walletconnect.org https://verify.walletconnect.com; frame-src https://verify.walletconnect.org https://verify.walletconnect.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), publickey-credentials-create=(self), publickey-credentials-get=(self)',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function secure(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  // Neither data responses nor the HTML used to unlock a wallet may be cached.
  if (headers.get('Content-Type')?.includes('text/html')) headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(value: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return secure(new Response(JSON.stringify(value), { status, headers }));
}

function failure(status: number, code: string, message: string): Response {
  return json({ code, message }, status);
}

type Rule = (value: string) => boolean;
type QueryRules = Record<string, Rule>;
const integer = (max: number, min = 1): Rule => value => /^\d{1,16}$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
const fid = integer(Number.MAX_SAFE_INTEGER);
const address: Rule = value => /^0x[a-fA-F0-9]{40}$/.test(value);
const hash: Rule = value => /^(?:0x)?[a-fA-F0-9]{40}$/.test(value);
const username: Rule = value => /^[a-zA-Z0-9_.-]{1,128}$/.test(value);
const ensName: Rule = value => { try { return normalizeHypersnapEnsName(value).name === value; } catch { return false; } };
const channel: Rule = value => /^[a-zA-Z0-9_-]{1,64}$/.test(value);
// eslint-disable-next-line no-control-regex -- Gateway search validation intentionally rejects ASCII control characters.
const searchQuery: Rule = value => !!value.trim() && new TextEncoder().encode(value).length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
const cursor: Rule = value => /^[a-zA-Z0-9_+/=:-]{1,2048}$/.test(value);
const pagination: QueryRules = { limit: integer(100), cursor };
const followPagination: QueryRules = { limit: integer(100), cursor: value => /^\d{1,20}$/.test(value) && BigInt(value) <= 0xffffffffffffffffn };
const reactionType: Rule = value => value === 'Like' || value === 'Recast';
const reactionPageToken: Rule = value => value.length > 0 && value.length <= 2048 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
const castHistoryPageToken: Rule = value => { try { return reactionPageToken(value) && btoa(atob(value)) === value; } catch { return false; } };

interface Endpoint { required?: string[]; query: QueryRules; validate?: (params: URLSearchParams) => boolean }
const READ_ENDPOINTS: Record<string, Endpoint> = {
  '/v1/info': { query: {} },
  '/v1/fidByName': { required: ['name', 'type'], query: { name: ensName, type: value => value === 'ens' || value === 'basename' }, validate: params => normalizeHypersnapEnsName(params.get('name')!).type === params.get('type') },
  '/v1/castsByFid': { required: ['fid', 'pageSize', 'reverse'], query: { fid: integer(0xffffffff), pageSize: value => value === '250', reverse: value => value === 'true', pageToken: castHistoryPageToken } },
  '/v1/signersByFid': { required: ['fid'], query: { fid, pageSize: integer(1000), pageToken: cursor, 'requesterFids[0]': fid } },
  '/v1/onChainIdRegistryEventByAddress': { required: ['address'], query: { address } },
  '/v1/linkById': { required: ['fid', 'link_type', 'target_fid'], query: { fid, link_type: value => value === 'follow', target_fid: fid } },
  '/v1/reactionById': { required: ['fid', 'reaction_type', 'target_fid', 'target_hash'], query: { fid, reaction_type: reactionType, target_fid: fid, target_hash: hash } },
  '/v1/reactionsByFid': { required: ['fid', 'reaction_type', 'pageSize', 'reverse'], query: { fid, reaction_type: reactionType, pageSize: integer(100), pageToken: reactionPageToken, reverse: value => value === 'true' || value === 'false' } },
  '/v1/reactionsByCast': { required: ['target_fid', 'target_hash', 'reaction_type', 'pageSize', 'reverse'], query: { target_fid: fid, target_hash: hash, reaction_type: reactionType, pageSize: integer(25), pageToken: reactionPageToken, reverse: value => value === 'true' } },
  '/v2/farcaster/user': { required: ['fid'], query: { fid } },
  '/v2/farcaster/user/by-username': { required: ['username'], query: { username } },
  '/v2/farcaster/user/search': { required: ['q'], query: { q: searchQuery, limit: integer(100) } },
  '/v2/farcaster/user/custody-address': { required: ['custody_address'], query: { custody_address: address } },
  '/v2/farcaster/user/followers': { required: ['fid'], query: { ...followPagination, fid } },
  '/v2/farcaster/user/following': { required: ['fid'], query: { ...followPagination, fid } },
  '/v2/farcaster/feed/trending': { query: { ...pagination, time_window: value => ['1h', '6h', '12h', '24h', '7d'].includes(value) } },
  '/v2/farcaster/feed/following': { required: ['fid'], query: { ...pagination, fid } },
  '/v2/farcaster/feed/user/casts': { required: ['fid'], query: { ...pagination, fid } },
  '/v2/farcaster/feed/channels': { required: ['channel_ids'], query: { ...pagination, channel_ids: channel } },
  '/v2/farcaster/cast': { required: ['identifier'], query: { identifier: hash, type: value => value === 'hash', fid } },
  '/v2/farcaster/cast/search': { required: ['q'], query: { q: searchQuery, limit: integer(100) } },
  '/v2/farcaster/cast/conversation': { required: ['identifier', 'type'], query: { identifier: hash, type: value => value === 'hash', reply_depth: integer(3, 0) } },
  '/v2/farcaster/notifications': { required: ['fid'], query: { ...pagination, fid } },
  '/v2/farcaster/channel': { required: ['id', 'type'], query: { id: channel, type: value => value === 'id' } },
  '/v2/farcaster/channel/all': { query: pagination },
  '/v2/farcaster/channel/trending': { query: { limit: integer(100) } },
  '/v2/farcaster/channel/search': { required: ['q'], query: { q: searchQuery, limit: integer(100) } },
  '/v2/farcaster/following/suggested': { required: ['fid', 'limit'], query: { fid, limit: integer(20) } },
  '/v2/farcaster/channel/members': { required: ['channel_id', 'limit'], query: { channel_id: channel, limit: integer(25), cursor: followPagination.cursor } },
  '/v2/farcaster/cast/quotes': { required: ['identifier', 'type', 'limit'], query: { identifier: hash, type: value => value === 'hash', limit: integer(25) } },
};

// Global reads whose responses never depend on the viewer. They are shared at
// the edge for a short TTL; every other read and the write path stay uncached.
const EDGE_CACHE_TTL_SECONDS: Record<string, number> = {
  '/v1/info': 15,
  '/v2/farcaster/feed/trending': 30,
  '/v2/farcaster/channel/trending': 60,
  '/v2/farcaster/channel/all': 60,
  '/v2/farcaster/channel': 60,
};

function edgeCache(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

function validQuery(params: URLSearchParams, endpoint: Endpoint): boolean {
  const seen = new Set<string>();
  for (const [name, value] of params) {
    const rule = endpoint.query[name];
    if (seen.has(name) || !rule || !rule(value)) return false;
    seen.add(name);
  }
  return (endpoint.required ?? []).every(name => seen.has(name)) && (!endpoint.validate || endpoint.validate(params));
}

class SizeLimitError extends Error {}

async function readLimited(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new SizeLimitError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function proxy(request: Request, url: URL, ctx?: WorkerContext): Promise<Response> {
  // The path never controls the destination host. Encoded path separators,
  // alternate authorities, duplicate query keys and unknown fields are rejected.
  if (url.pathname.includes('%') || url.pathname.includes('\\')) return failure(400, 'invalid_path', 'Invalid API path.');
  const path = url.pathname.slice('/api'.length);
  const isWrite = path === '/v1/submitMessage';
  const endpoint = READ_ENDPOINTS[path];
  if (!endpoint && !isWrite) return failure(404, 'not_found', 'This API route is unavailable.');
  if (request.method !== (isWrite ? 'POST' : 'GET')) return failure(405, 'method_not_allowed', 'This method is unavailable.');
  const origin = request.headers.get('Origin');
  if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') return failure(403, 'origin_denied', 'Cross-site API requests are unavailable.');
  if (isWrite ? url.search !== '' : !validQuery(url.searchParams, endpoint)) return failure(400, 'invalid_query', 'Invalid API query.');

  const ttl = isWrite ? undefined : EDGE_CACHE_TTL_SECONDS[path];
  const cache = ttl && ctx ? edgeCache() : undefined;
  // Key on the validated path and query only, never the caller's headers.
  const cacheKey = cache ? new Request(`${url.origin}${url.pathname}${url.search}`) : undefined;
  if (cache && cacheKey) {
    const hit = await cache.match(cacheKey).catch(() => undefined);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set('Cache-Control', 'no-store');
      return secure(new Response(hit.body, { status: hit.status, headers }));
    }
  }

  let body: Uint8Array | undefined;
  if (isWrite) {
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/octet-stream') return failure(415, 'invalid_content_type', 'Submit a signed binary Farcaster message.');
    const declaredLength = request.headers.get('Content-Length');
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_MESSAGE_BYTES)) return failure(413, 'message_too_large', 'Signed message exceeds 64 KiB.');
    try {
      body = await readLimited(request.body, MAX_MESSAGE_BYTES);
    } catch {
      return failure(413, 'message_too_large', 'Signed message exceeds 64 KiB.');
    }
    if (!body.byteLength) return failure(400, 'empty_message', 'A signed message is required.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const headers = new Headers({ Accept: 'application/json' });
    if (isWrite) headers.set('Content-Type', 'application/octet-stream');
    const upstream = await fetch(`${UPSTREAM}${path}${url.search}`, {
      method: request.method,
      headers,
      body: body ? new Uint8Array(body).buffer : undefined,
      // Workers supports manual/follow only. A 3xx is rejected below without
      // following it, so the destination remains the fixed public node.
      redirect: 'manual',
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!upstream.ok) {
      // Optional node indexes return 503 with these exact source-defined
      // messages. Preserve that capability boundary without forwarding raw
      // errors or making a disabled index look like an empty successful feed.
      if (((upstream.status === 503 && (path === '/v2/farcaster/cast/search' || path.startsWith('/v2/farcaster/channel') || path === '/v2/farcaster/feed/channels' || path === '/v2/farcaster/notifications' || path === '/v2/farcaster/following/suggested'))
        || (upstream.status === 404 && (path === '/v2/farcaster/cast' || path === '/v2/farcaster/channel'))) && upstream.headers.get('Content-Type')?.includes('application/json')) {
        const bytes = await readLimited(upstream.body, 4096);
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (value && typeof value === 'object' && 'message' in value) {
          if (upstream.status === 404 && path === '/v2/farcaster/cast' && value.message === 'Cast not found') return failure(404, 'cast_not_found', 'This cast was not found on Hypersnap.');
          if (upstream.status === 404 && path === '/v2/farcaster/channel' && value.message === 'Channel not found') return failure(404, 'channel_not_found', 'This channel was not found on Hypersnap.');
          const unavailable = path === '/v2/farcaster/cast/search' ? ['Search indexing not available', 'Search feature disabled']
            : path.startsWith('/v2/farcaster/channel') ? ['Channels indexing not enabled'] : path === '/v2/farcaster/feed/channels' ? ['Channel feed service not available'] : path === '/v2/farcaster/following/suggested' ? ['Social graph indexing not enabled'] : ['Hub query service not available'];
          if (upstream.status === 503 && typeof value.message === 'string' && unavailable.includes(value.message)) {
            return failure(503, 'feature_unavailable', path === '/v2/farcaster/cast/search' ? 'Cast search is not enabled on this Hypersnap node.'
              : path.startsWith('/v2/farcaster/channel') ? 'The channel index is not enabled on this Hypersnap node.' : path === '/v2/farcaster/feed/channels' ? 'Channel feeds are not enabled on this Hypersnap node.' : path === '/v2/farcaster/following/suggested' ? 'Suggested profiles are unavailable on this Hypersnap node.' : 'Recent activity is unavailable on this Hypersnap node.');
          }
        }
      }
      // The v1 adapter wraps bad_request.rate_limited in HTTP 400. Recognize
      // only the verified submit error shape; never expose the upstream text.
      if (isWrite && upstream.status === 400 && upstream.headers.get('Content-Type')?.includes('application/json')) {
        const bytes = await readLimited(upstream.body, 4096);
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (value && typeof value === 'object' && 'error' in value && value.error === 'Failed to submit message'
          && 'error_detail' in value && typeof value.error_detail === 'string'
          && /^status: InvalidArgument, message: "bad_request\.rate_limited\/rate limit exceeded for FID \d+",/.test(value.error_detail)) {
          return failure(429, 'rate_limited', 'Hypersnap is limiting new approvals or messages. Wait at least one minute before trying again.');
        }
      }
      // A missing indexed ENS/Basename proof has this exact native v1 shape.
      // Storage, validation and transport failures do not mean an unlinked name.
      if (path === '/v1/fidByName' && upstream.status === 400 && upstream.headers.get('Content-Type')?.includes('application/json')) {
        const bytes = await readLimited(upstream.body, 4096);
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (value && typeof value === 'object' && 'error' in value && value.error === 'Failed to get fid by name'
          && 'error_detail' in value && typeof value.error_detail === 'string'
          && /^status: NotFound, message: "username proof not found", details: \[\](?:, metadata: MetadataMap \{ headers: \{\} \})?$/.test(value.error_detail)) {
          return failure(404, 'ens_name_not_found', 'This ENS name is not linked to an account on this Hypersnap node. Try your username or FID.');
        }
      }
      // Hypersnap's v1 HTTP adapter reports every gRPC error as HTTP 400.
      // Only this exact NotFound result means an absent follow; network,
      // validation, and storage failures must never appear as "not following".
      if (path === '/v1/linkById' && upstream.status === 400 && upstream.headers.get('Content-Type')?.includes('application/json')) {
        const bytes = await readLimited(upstream.body, 4096);
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (value && typeof value === 'object' && 'error' in value && value.error === 'Failed to get link'
          && 'error_detail' in value && typeof value.error_detail === 'string' && value.error_detail.startsWith('status: NotFound,')) {
          return failure(404, 'follow_not_found', 'This follow relationship does not exist.');
        }
      }
      // A missing reaction is wrapped as HTTP 400 by this exact v1 adapter.
      // Do not turn storage failures, bad input, or unrelated NotFound errors
      // into a false "not liked" state.
      if (path === '/v1/reactionById' && upstream.status === 400 && upstream.headers.get('Content-Type')?.includes('application/json')) {
        const bytes = await readLimited(upstream.body, 4096);
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (value && typeof value === 'object' && 'error' in value && value.error === 'Failed to get reaction'
          && 'error_detail' in value && typeof value.error_detail === 'string'
          && /^status: NotFound, message: "cast not found", details: \[\](?:, metadata: MetadataMap \{ headers: \{\} \})?$/.test(value.error_detail)) {
          return failure(404, 'reaction_not_found', 'This reaction does not exist.');
        }
      }
      await upstream.body?.cancel();
      const status = [400, 401, 403, 404, 409, 422, 429].includes(upstream.status) ? upstream.status : 502;
      const messages: Record<number, string> = {
        400: isWrite ? 'The node rejected this signed message. Check your signer and try again.' : 'The node rejected this request.',
        401: 'The node could not authenticate this signed message.',
        403: 'The node did not authorize this request.',
        404: 'This profile or cast was not found on the node.',
        409: 'The node reported a conflict. Refresh and try again.',
        422: 'The node could not validate this signed message.',
        429: 'The node is busy. Wait a moment before trying again.',
        502: isWrite ? SUBMISSION_UNKNOWN : 'The Hypersnap node is temporarily unavailable. Try again.',
      };
      return failure(status, status === 429 ? 'rate_limited' : isWrite && status >= 500 ? 'submission_unknown' : 'upstream_error', messages[status]);
    }
    if (!upstream.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
      await upstream.body?.cancel();
      return failure(502, isWrite ? 'submission_unknown' : 'invalid_response', isWrite ? SUBMISSION_UNKNOWN : 'The node returned an invalid response.');
    }
    const bytes = await readLimited(upstream.body, MAX_RESPONSE_BYTES);
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return failure(502, isWrite ? 'submission_unknown' : 'invalid_response', isWrite ? SUBMISSION_UNKNOWN : 'The node returned an invalid response.');
    const response = json(value);
    if (cache && cacheKey && ctx) {
      const stored = response.clone();
      const headers = new Headers(stored.headers);
      headers.set('Cache-Control', `public, s-maxage=${ttl}`);
      ctx.waitUntil(cache.put(cacheKey, new Response(stored.body, { status: 200, headers })).catch(() => undefined));
    }
    return response;
  } catch (error) {
    if (isWrite) return failure(controller.signal.aborted ? 504 : 502, 'submission_unknown', SUBMISSION_UNKNOWN);
    if (controller.signal.aborted) return failure(504, 'timeout', 'The Hypersnap node took too long to respond. Try again.');
    if (error instanceof SizeLimitError) return failure(502, 'response_too_large', 'The node returned too much data. Try a smaller page.');
    return failure(502, 'upstream_unavailable', 'The Hypersnap node is temporarily unavailable. Try again.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function handleRequest(request: Request, env: Env, ctx?: WorkerContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.host === LEGACY_HOST) {
    const destination = new URL(CANONICAL_ORIGIN);
    destination.pathname = url.pathname; destination.search = url.search;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // Redirecting a signed write changes its origin and can taint the browser
      // Origin header. Leave its body untouched and require a fresh connection.
      return json({ code: 'site_moved', message: 'Opencaster has moved to https://opencaster.org. Reopen that site and reconnect before submitting.' }, 409, { Location: destination.href, Link: `<${CANONICAL_ORIGIN}>; rel="canonical"` });
    }
    const headers = new Headers({ Location: destination.href, 'Cache-Control': 'no-store' });
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
    // Public images embedded in existing casts can cross the legacy host on
    // their way to the same content-addressed object on the canonical domain.
    if (url.pathname.startsWith('/media/')) headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    return new Response(null, { status: 308, headers });
  }
  if (url.pathname === '/media' || url.pathname.startsWith('/media/')) return handleMediaRequest(request, env);
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return proxy(request, url, ctx);
  if (request.method !== 'GET' && request.method !== 'HEAD') return failure(405, 'method_not_allowed', 'This method is unavailable.');
  return secure(await env.ASSETS.fetch(request));
}

export default { fetch: handleRequest };
