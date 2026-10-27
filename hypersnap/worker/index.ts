/** Fixed-origin, bounded gateway. Custody secrets stay in the user's wallet;
 * this worker accepts public queries or signed wire bytes.
 */
import { handleMediaRequest, type MediaEnv } from './media';
import { normalizeHypersnapEnsName } from '../src/lib/ensName';
import { handleAnalyticsEvents, recordRequestMetric, type AnalyticsEnv } from './analytics';
import { fetchUpstream, InvalidUpstreamResponseError, parseUpstreamObject, resolveReadFallback, resolveUpstream, type UpstreamConfig } from './upstream';
import { withShareUrl } from './sharing';
import { handleShareImage } from './shareImages';
export { MediaUploadQuota } from './media';
export interface Env extends MediaEnv, AnalyticsEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  HYPERSNAP_AGGREGATE_CACHE?: string;
}

const CANONICAL_ORIGIN = 'https://opencaster.org';
const LEGACY_HOST = 'quorum.arca.computer';
const STATIC_ASSET_PATHS = new Set([
  '/index.html', '/favicon.ico', '/robots.txt', '/sitemap.xml',
  '/manifest.json', '/manifest.webmanifest', '/opencaster-symbol.svg',
  '/opencaster-social-v1.png', '/opencaster-social-v1.svg',
  '/opencaster-social-v2.png', '/opencaster-social-v2.svg',
  '/quorum-symbol.svg', '/unknown-dark.png', '/unknown-light.png',
  '/InterVariable.ttf', '/Sen-VariableFont_wght.ttf', '/THIRD_PARTY_DEPENDENCY_LICENSES.txt',
]);
const MAX_MESSAGE_BYTES = 65_536;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;
const PRIMARY_READ_TIMEOUT_MS = 4_000;
const AGGREGATE_LOOKUP_MS = 200;
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
  // Browser data responses and wallet HTML are never cached. The explicit
  // aggregate edge cache below stores a separate, sanitized copy only.
  if (headers.get('Content-Type')?.includes('text/html')) headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(value: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return secure(new Response(JSON.stringify(value), { status, headers }));
}

function validatedJson(bytes: Uint8Array<ArrayBuffer>): Response {
  return secure(new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }));
}

function failure(status: number, code: string, message: string): Response {
  return json({ code, message }, status);
}

type Rule = (value: string) => boolean;
type QueryRules = Record<string, Rule>;
const integer = (max: number, min = 1): Rule => value => /^\d{1,16}$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
const fid = integer(Number.MAX_SAFE_INTEGER);
const fidList = (max: number): Rule => value => { const fids = value.split(','); return fids.length <= max && new Set(fids).size === fids.length && fids.every(fid); };
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
  '/v2/farcaster/user/bulk': { required: ['fids'], query: { fids: fidList(100) } },
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
class RetryableReadError extends Error {}

/** Abort fetch AND body work even if a transport ignores its signal. The race
 * owns late rejections; stream cancellation itself must never hold the caller. */
async function bounded<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  let abort!: () => void;
  const deadline = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error('Node deadline exceeded'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try { return await Promise.race([deadline, Promise.resolve().then(() => {
    if (signal.aborted) throw new Error('Node deadline exceeded');
    return work();
  })]); }
  finally { signal.removeEventListener('abort', abort); }
}

function discardResponse(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

async function readLimited(body: ReadableStream<Uint8Array> | null, limit: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  // Cache streams do not share fetch's abort signal. Cancel the locked reader,
  // but never wait for an optional cache backend's cancellation to complete.
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      if (signal?.aborted) { cancel(); throw new InvalidUpstreamResponseError(); }
      const { value, done } = await reader.read();
      if (signal?.aborted) throw new InvalidUpstreamResponseError();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        cancel();
        throw new SizeLimitError();
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
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

export interface WorkerExecutionContext { waitUntil(promise: Promise<unknown>): void }
interface AggregateCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
}

/** A finite allowlist, not a general proxy cache. Validation must run first.
 * Cache identity contains only the upstream origin and public query fields;
 * browser headers and the origin credential never enter it. */
function aggregateCache(request: Request, url: URL, path: string, config: UpstreamConfig, ctx?: WorkerExecutionContext): { cache: AggregateCache; key: Request } | undefined {
  if (request.method !== 'GET' || url.searchParams.has('cursor')
    || request.headers.has('Authorization') || request.headers.has('Cookie')
    || !EDGE_CACHE_TTL_SECONDS[path]
    || !ctx || typeof ctx.waitUntil !== 'function') return;
  try {
    const cache = typeof caches === 'undefined' ? undefined : (caches as CacheStorage & { default?: AggregateCache }).default;
    if (!cache || typeof cache.match !== 'function' || typeof cache.put !== 'function') return;
    const key = new URL('/__opencaster_aggregate/v2', url.origin);
    key.searchParams.set('upstream', config.origin);
    key.searchParams.set('path', path);
    // Normalize finite numeric parameters so padded limits cannot grow cache
    // cardinality. Omitted defaults stay distinct from explicitly set limits.
    if (url.searchParams.has('limit')) key.searchParams.set('limit', String(Number(url.searchParams.get('limit'))));
    if (url.searchParams.has('time_window')) key.searchParams.set('time_window', url.searchParams.get('time_window')!);
    if (url.searchParams.has('id')) key.searchParams.set('id', url.searchParams.get('id')!);
    if (url.searchParams.has('type')) key.searchParams.set('type', url.searchParams.get('type')!);
    return { cache, key: new Request(key.href, { method: 'GET' }) };
  } catch { return; }
}

function publicAggregate(value: Record<string, unknown>, path: string): boolean {
  if ('error' in value || 'errors' in value || 'code' in value) return false;
  if (path === '/v1/info') return true;
  if (path === '/v2/farcaster/channel') return !!value.channel && typeof value.channel === 'object' && !Array.isArray(value.channel);
  return Array.isArray(value[path === '/v2/farcaster/feed/trending' ? 'casts' : 'channels']);
}

/** One budget covers lookup AND validation. A late lookup still owns a stream
 * and must discard it, even after the caller has fallen back to the node. */
async function cachedAggregate(aggregate: { cache: AggregateCache; key: Request }, path: string, config: UpstreamConfig, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (signal.aborted) return;
  const controller = new AbortController();
  const discard = (response?: Response) => { void response?.body?.cancel().catch(() => undefined); };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  const deadline = new Promise<undefined>(resolve => {
    abort = () => { controller.abort(); resolve(undefined); };
    signal.addEventListener('abort', abort, { once: true });
    timeout = setTimeout(abort, AGGREGATE_LOOKUP_MS);
  });
  const lookup = Promise.resolve().then(async () => {
    const cached = await aggregate.cache.match(aggregate.key);
    if (controller.signal.aborted || !cached || cached.status !== 200
      || !cached.headers.get('Content-Type')?.toLowerCase().includes('application/json')
      || cached.headers.has('Set-Cookie') || cached.headers.has('Vary')
      || /\b(?:private|no-store|no-cache)\b/i.test(cached.headers.get('Cache-Control') ?? '')) {
      discard(cached); return;
    }
    const bytes = await readLimited(cached.body, MAX_RESPONSE_BYTES, controller.signal);
    const value = parseUpstreamObject(bytes, config);
    if (!controller.signal.aborted && publicAggregate(value, path)) return bytes;
  }).catch(() => undefined); // Includes rejections arriving after the deadline.
  try { return await Promise.race([lookup, deadline]); }
  finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
}

async function proxy(request: Request, url: URL, env: Env, ctx?: WorkerExecutionContext): Promise<Response> {
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

  let config: UpstreamConfig;
  try { config = resolveUpstream(env); }
  catch { return failure(503, 'upstream_configuration_unavailable', 'The Hypersnap gateway is temporarily unavailable.'); }

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

  // The optional cache budget is inside, not in addition to, the existing
  // 20-second node deadline. A stalled cache cannot extend that deadline.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const backup = !isWrite ? resolveReadFallback(env, config) : undefined;
  let selected: 'primary' | 'backup' = 'primary';
  const attributed = (response: Response) => {
    const headers = new Headers(response.headers);
    headers.set('X-Opencaster-Upstream', selected);
    return new Response(response.body, { status: response.status, headers });
  };
  const attempt = async (target: UpstreamConfig, retry: boolean): Promise<Response> => {
    const aggregate = aggregateCache(request, url, path, target, ctx);
    if (aggregate) {
      // Check the primary namespace first. The backup namespace is reached only
      // after a real primary failure, never as a substitute for a healthy node.
      const bytes = await bounded(controller.signal, () => cachedAggregate(aggregate, path, config, controller.signal));
      if (bytes) return validatedJson(bytes);
    }
    const attemptController = new AbortController();
    const abort = () => attemptController.abort();
    controller.signal.addEventListener('abort', abort, { once: true });
    if (controller.signal.aborted) abort();
    const primaryTimeout = retry ? setTimeout(abort, PRIMARY_READ_TIMEOUT_MS) : undefined;
    let retryAllowed = retry;
    try {
      return await bounded(attemptController.signal, async () => {
        const headers = new Headers({ Accept: 'application/json' });
        if (isWrite) headers.set('Content-Type', 'application/octet-stream');
        let upstream: Response;
        try {
          upstream = await fetchUpstream(target, `${path}${url.search}`, {
            method: request.method, headers,
            body: body ? new Uint8Array(body).buffer : undefined,
            signal: attemptController.signal,
          });
        } catch { throw new RetryableReadError(); }
        if (attemptController.signal.aborted) { discardResponse(upstream); throw new RetryableReadError(); }
        // Once a nonretryable status is known, neither its body transport nor its
        // timeout can turn an auth denial, missing record or redirect into failover.
        retryAllowed = retry && (upstream.ok || (upstream.status >= 500 && upstream.status <= 599));
        if (retry && upstream.status >= 500 && upstream.status <= 599) {
          discardResponse(upstream); throw new RetryableReadError();
        }
        const readResponse = async (limit: number) => {
          try { return await readLimited(upstream.body, limit, attemptController.signal); }
          catch (error) {
            if (error instanceof SizeLimitError || error instanceof InvalidUpstreamResponseError) throw error;
            throw new RetryableReadError();
          }
        };
        if (!upstream.ok) {
          // Optional node indexes return 503 with these exact source-defined
          // messages. Preserve that capability boundary without forwarding raw
          // errors or making a disabled index look like an empty successful feed.
          if (((upstream.status === 503 && (path === '/v2/farcaster/cast/search' || path.startsWith('/v2/farcaster/channel') || path === '/v2/farcaster/feed/channels' || path === '/v2/farcaster/notifications' || path === '/v2/farcaster/following/suggested'))
            || (upstream.status === 404 && (path === '/v2/farcaster/cast' || path === '/v2/farcaster/channel'))) && upstream.headers.get('Content-Type')?.includes('application/json')) {
            const bytes = await readResponse(4096);
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
            const bytes = await readResponse(4096);
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
            const bytes = await readResponse(4096);
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
            const bytes = await readResponse(4096);
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
            const bytes = await readResponse(4096);
            const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
            if (value && typeof value === 'object' && 'error' in value && value.error === 'Failed to get reaction'
              && 'error_detail' in value && typeof value.error_detail === 'string'
              && /^status: NotFound, message: "cast not found", details: \[\](?:, metadata: MetadataMap \{ headers: \{\} \})?$/.test(value.error_detail)) {
              return failure(404, 'reaction_not_found', 'This reaction does not exist.');
            }
          }
          discardResponse(upstream);
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
          discardResponse(upstream);
          return failure(502, isWrite ? 'submission_unknown' : 'invalid_response', isWrite ? SUBMISSION_UNKNOWN : 'The node returned an invalid response.');
        }
        const bytes = await readResponse(MAX_RESPONSE_BYTES);
        const value = parseUpstreamObject(bytes, config);
        const response = validatedJson(bytes);
        // Only the authenticated gate can attest that its no-store header guards
        // transport authentication, not personalized data. Browser hints never count.
        const trustedAggregate = !!target.token && env.HYPERSNAP_AGGREGATE_CACHE === 'trusted-origin-v1'
          && upstream.headers.get('X-Opencaster-Aggregate-Cache') === 'public-aggregate-v1';
        if (aggregate && upstream.status === 200 && publicAggregate(value, path)
          && !upstream.headers.has('Set-Cookie') && !upstream.headers.has('Vary')
          && !/\b(?:private|no-cache)\b/i.test(upstream.headers.get('Cache-Control') ?? '')
          && (trustedAggregate || !/\bno-store\b/i.test(upstream.headers.get('Cache-Control') ?? ''))) {
          // Only validated JSON bytes are stored, never upstream headers. Keep
          // browsers no-store; only the Cache API copy has a route-specific TTL.
          const headers = new Headers(response.headers);
          headers.set('Cache-Control', `public, max-age=${EDGE_CACHE_TTL_SECONDS[path]}`);
          const stored = new Response(bytes, { status: 200, headers });
          try { ctx!.waitUntil(Promise.resolve().then(() => aggregate.cache.put(aggregate.key, stored)).catch(() => undefined)); }
          catch { /* Missing/disabled execution context cannot fail an API read. */ }
        }
        return response;
      });
    }
    catch (error) {
      if (retryAllowed && !controller.signal.aborted
        && (attemptController.signal.aborted || error instanceof RetryableReadError)) throw new RetryableReadError();
      if (error instanceof RetryableReadError) throw new Error('Node transport unavailable', { cause: error });
      throw error;
    } finally {
      clearTimeout(primaryTimeout);
      controller.signal.removeEventListener('abort', abort);
    }
  };
  try {
    return attributed(await bounded(controller.signal, async () => {
      try { return await attempt(config, !!backup); }
      catch (error) {
        if (!backup || !(error instanceof RetryableReadError) || controller.signal.aborted) throw error;
        selected = 'backup';
        return attempt(backup, false);
      }
    }));
  } catch (error) {
    if (isWrite) return attributed(failure(controller.signal.aborted ? 504 : 502, 'submission_unknown', SUBMISSION_UNKNOWN));
    if (controller.signal.aborted) return attributed(failure(504, 'timeout', 'The Hypersnap node took too long to respond. Try again.'));
    if (error instanceof InvalidUpstreamResponseError) return attributed(failure(502, 'invalid_response', 'The node returned an invalid response.'));
    if (error instanceof SizeLimitError) return attributed(failure(502, 'response_too_large', 'The node returned too much data. Try a smaller page.'));
    return attributed(failure(502, 'upstream_unavailable', 'The Hypersnap node is temporarily unavailable. Try again.'));
  } finally {
    clearTimeout(timeout);
  }
}

async function routeRequest(request: Request, env: Env, ctx?: WorkerExecutionContext): Promise<Response> {
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
  if (url.pathname === '/_analytics/events') return secure(await handleAnalyticsEvents(request, env));
  if (url.pathname === '/_share' || url.pathname.startsWith('/_share/')) {
    const response = secure(await handleShareImage(request, env, ctx));
    response.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    return response;
  }
  if (url.pathname === '/media' || url.pathname.startsWith('/media/')) return handleMediaRequest(request, env);
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return proxy(request, url, env, ctx);
  if (request.method !== 'GET' && request.method !== 'HEAD') return failure(405, 'method_not_allowed', 'This method is unavailable.');
  const response = secure(await withShareUrl(await env.ASSETS.fetch(request), url, request.method, env, request.signal));
  // The public card can also be embedded directly by link-preview services.
  if (['/opencaster-social-v1.png', '/opencaster-social-v1.svg', '/opencaster-social-v2.png', '/opencaster-social-v2.svg'].includes(url.pathname)) {
    response.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  }
  return cacheStaticAsset(url, response);
}

// Content-hashed bundles keep their existing immutable lifetime alongside sharing metadata.
function cacheStaticAsset(url: URL, response: Response): Response {
  if ((response.status !== 200 && response.status !== 304) || response.headers.get('Content-Type')?.includes('text/html')) return response;
  if (url.pathname.startsWith('/assets/')) response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  else if (/^\/[^/]+\.ttf$/.test(url.pathname)) response.headers.set('Cache-Control', 'public, max-age=86400');
  return response;
}

export async function handleRequest(request: Request, env: Env, ctx?: WorkerExecutionContext): Promise<Response> {
  const path = new URL(request.url).pathname;
  // Ingestion itself is excluded; a batch must not generate another event.
  if (path === '/_analytics/events') return routeRequest(request, env, ctx);
  const category = path === '/api' || path.startsWith('/api/') ? 'api'
    : path === '/media' || path.startsWith('/media/') ? 'media'
      // Profile names can contain dots, including ENS/Base names. Only known
      // static namespaces/files are assets; a suffix is not enough to tell.
      : path.startsWith('/assets/') || path.startsWith('/licenses/') || path.startsWith('/_share/') || path === '/_share' || STATIC_ASSET_PATHS.has(path) ? 'asset'
        : request.method === 'GET' || request.method === 'HEAD' ? 'page' : 'other';
  const started = Date.now();
  let status = 500;
  try {
    const response = await routeRequest(request, env, ctx);
    status = response.status;
    return response;
  } finally {
    // Store only a route family, status class, coarse dimensions and duration.
    // Never pass the URL, request/response body or an exception to telemetry.
    recordRequestMetric(env, request, status, Math.max(0, Date.now() - started), category);
  }
}

export default { fetch: handleRequest };
