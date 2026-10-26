/** The deliberately small portion of Hypersnap's public API used by this client.
 * Field names follow the node's wire format (src/api/types.rs upstream).
 * Mobile clients can reuse this module; it has no dependency on the Quorum relay.
 */
import { normalizeHypersnapEnsName } from './ensName';
import { APP_ORIGIN, LEGACY_APP_ORIGIN } from './appOrigins';

export interface User {
  fid: number;
  username: string;
  display_name?: string;
  pfp_url?: string;
  custody_address: string;
  registered_at?: string;
  profile: { bio: { text: string }; banner?: { url?: string } };
  follower_count: number;
  following_count: number;
  verified_addresses?: { eth_addresses: string[]; sol_addresses: string[] };
  viewer_context?: { following: boolean; followed_by: boolean };
}

export interface Channel {
  id: string;
  name: string;
  url: string;
  parent_url?: string;
  image_url?: string;
  description?: string;
  follower_count?: number;
  /** Unique accounts that have posted here; this is not a subscription count. */
  member_count?: number;
}

export interface Cast {
  hash: string;
  author: User;
  text: string;
  timestamp: string;
  parent_hash?: string;
  parent_url?: string;
  root_parent_url?: string;
  parent_author?: { fid?: number | null };
  embeds: Array<{ url: string } | { cast_id: { fid: number; hash: string } }>;
  reactions: { likes_count: number; recasts_count: number };
  replies: { count: number };
  mentioned_profiles?: User[];
  mentioned_profiles_ranges?: Array<{ start: number; end: number }>;
  channel?: Channel;
  viewer_context?: { liked: boolean; recasted: boolean };
  /** Original publication time stays in timestamp; this identifies profile activity. */
  reaction_context?: { fid: number; type: 'like' | 'recast'; timestamp: string };
}

export interface FeedResponse {
  casts: Cast[];
  next: { cursor?: string | null };
}

export interface FollowsResponse { users: User[]; next: { cursor?: string | null } }
export interface ChannelsResponse { channels: Channel[]; next: { cursor?: string | null } }

/** The node currently omits the like/recast subtype from notification receipts. */
export interface ActivityItem {
  id: string;
  type: 'reactions' | 'follows' | 'replies' | 'mentions' | 'unknown';
  timestamp: string;
  actors: User[];
  cast?: Cast;
  targetHash?: string;
}
export interface NotificationsResponse { notifications: ActivityItem[]; next: { cursor?: string | null } }

export interface ConversationNode {
  cast: Cast;
  replies: ConversationNode[];
}

export interface Signer {
  key: string;
  fid?: number;
  source?: string;
  /** KEY_ADD timestamp expressed as Unix epoch seconds by the node. */
  addedAt?: number;
  expiresAt?: number;
  scopes?: string[];
  requestFid?: number;
  nonce?: number;
}

export interface SignersResponse {
  signers: Signer[];
  currentUserNonce: number;
  gaslessSignerCount?: number;
  gaslessSignerLimit?: number;
  requesterFidNonces?: Record<string, number>;
  nextPageToken?: string;
}

export interface NodeInfo {
  [key: string]: unknown;
  version: string;
  numShards?: number;
  peer_id?: string;
  dbStats?: { numMessages: number; numFidRegistrations: number; approxSize: number };
  shardInfos?: Array<{ shardId?: number; numMessages?: number; blockDelay?: number }>;
}

export interface SubmitMessageResponse {
  hash?: string;
  data?: { fid?: number; [key: string]: unknown };
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code = 'api_error') {
    super(message);
    this.name = 'ApiError';
  }
}

const API_BASE = '/api';
const REQUEST_TIMEOUT_MS = 25_000;
const SUBMISSION_UNKNOWN = 'Submission status is unknown. Check your profile or signer state before trying again.';
const HASH = /^(?:0x)?[a-fA-F0-9]{40}$/;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const CHANNEL_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const PAGE_CURSOR = /^[a-zA-Z0-9_+/=:-]{1,2048}$/;

function fidValue(fid: number | undefined): string {
  if (!Number.isSafeInteger(fid) || Number(fid) < 1) throw new Error('Enter a valid Farcaster ID.');
  return String(fid);
}

function hashValue(hash: string): string {
  if (!HASH.test(hash)) throw new Error('Invalid cast hash.');
  return hash.replace(/^0x/, '').toLowerCase();
}

function addressValue(address: string): string {
  if (!ADDRESS.test(address)) throw new Error('Invalid wallet address.');
  return address;
}

function pageParams(cursor?: string | null, limit = 20): URLSearchParams {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Feed limit must be between 1 and 100.');
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) {
    if (!PAGE_CURSOR.test(cursor)) throw new Error('Invalid pagination cursor.');
    params.set('cursor', cursor);
  }
  return params;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function publicUser(value: unknown): value is User {
  return isObject(value) && Number.isSafeInteger(value.fid) && Number(value.fid) > 0 && typeof value.username === 'string';
}

function nextCursor(value: unknown, previous?: string | null): string | null {
  if (value === undefined || value === null || value === previous || value === '5b6e756c6c2c6e756c6c5d') return null;
  if (typeof value !== 'string' || !PAGE_CURSOR.test(value)) throw new ApiError('The node returned invalid pagination.', 502, 'invalid_response');
  // get_casts_by_parent serializes one token per shard, including an exhausted
  // all-null array. The isolated node has one shard; production can have more.
  if (/^(?:[a-f0-9]{2})+$/i.test(value)) {
    try {
      const decoded: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(value.match(/../g)!, byte => parseInt(byte, 16))));
      if (Array.isArray(decoded) && decoded.length > 0 && decoded.every(token => token === null)) return null;
    } catch { /* Most valid cursors are opaque binary keys, not JSON. */ }
  }
  return value;
}

function searchQuery(value: string): string {
  const query = value.trim();
  // eslint-disable-next-line no-control-regex -- Search validation intentionally rejects ASCII control characters.
  if (!query || new TextEncoder().encode(query).length > 256 || /[\u0000-\u001f\u007f]/.test(query)) throw new Error('Enter a search query of 1 to 256 bytes.');
  return query;
}

async function requestJson<T>(path: string, params?: URLSearchParams, signal?: AbortSignal, body?: Uint8Array): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), REQUEST_TIMEOUT_MS);
  try {
    const query = params?.toString();
    const response = await fetch(`${API_BASE}${path}${query ? `?${query}` : ''}`, {
      method: body ? 'POST' : 'GET',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/octet-stream' } : {}) },
      body: body ? new Uint8Array(body).buffer : undefined,
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      // The local worker supplies bounded, non-sensitive errors. Never surface
      // arbitrary HTML or an upstream response that may echo submitted data.
      const code = isObject(result) && typeof result.code === 'string' ? result.code : 'api_error';
      const message = isObject(result) && typeof result.message === 'string'
        ? result.message.slice(0, 240)
        : `The node returned HTTP ${response.status}.`;
      throw new ApiError(message, response.status, code);
    }
    if (!isObject(result)) throw new ApiError('The node returned an invalid response.', 502, 'invalid_response');
    return result as T;
  } catch (error) {
    if (body && !(error instanceof ApiError && error.status < 500)) {
      throw new ApiError(SUBMISSION_UNKNOWN, error instanceof ApiError ? error.status : 502, 'submission_unknown');
    }
    if (controller.signal.aborted && !signal?.aborted) throw new ApiError('The node took too long to respond. Try again.', 504, 'timeout');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export type TrendingTimeWindow = '1h' | '6h' | '12h' | '24h' | '7d';
export interface FeedOptions {
  kind: 'trending' | 'following' | 'channel' | 'user';
  fid?: number;
  channel?: string;
  cursor?: string | null;
  limit?: number;
  timeWindow?: TrendingTimeWindow;
  signal?: AbortSignal;
}

export async function getFeed(options: FeedOptions): Promise<FeedResponse> {
  const params = pageParams(options.cursor, options.limit);
  if (options.timeWindow !== undefined) {
    if (options.kind !== 'trending' || !['1h', '6h', '12h', '24h', '7d'].includes(options.timeWindow)) throw new Error('Select a supported trending time window.');
    params.set('time_window', options.timeWindow);
  }
  let path: string;
  switch (options.kind) {
    case 'following':
      path = '/v2/farcaster/feed/following';
      params.set('fid', fidValue(options.fid));
      break;
    case 'user':
      path = '/v2/farcaster/feed/user/casts';
      params.set('fid', fidValue(options.fid));
      break;
    case 'channel':
      if (!options.channel || !/^[a-zA-Z0-9_-]{1,64}$/.test(options.channel)) throw new Error('Invalid channel.');
      path = '/v2/farcaster/feed/channels';
      params.set('channel_ids', options.channel);
      break;
    default:
      path = '/v2/farcaster/feed/trending';
  }
  const response = await requestJson<FeedResponse>(path, params, options.signal);
  if (!Array.isArray(response.casts)) throw new ApiError('The node returned an invalid feed.', 502, 'invalid_response');
  const next = response.next?.cursor;
  // The current node can emit the exhausted dual-index token `[null,null]`.
  // Also stop a repeated cursor instead of presenting an endless More button.
  let casts = response.casts;
  if (options.kind === 'channel') {
    if (casts.some(cast => !isObject(cast) || typeof cast.hash !== 'string' || typeof cast.timestamp !== 'string')) throw new ApiError('The node returned an invalid channel feed.', 502, 'invalid_response');
    // The node applies the requested limit to each shard and concatenates their
    // results. Keep the full batch (truncation would lose casts), but merge its
    // order and duplicate hashes before the UI appends it to earlier pages.
    casts = [...new Map(casts.map(cast => [cast.hash.replace(/^0x/, '').toLowerCase(), cast])).values()]
      .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0) || a.hash.localeCompare(b.hash));
  }
  return { casts, next: { cursor: nextCursor(next, options.cursor) } };
}

export type ProfileTab = 'casts' | 'replies' | 'media' | 'likes' | 'recasts';

export interface ReactionTarget { fid: number; hash: string }
export interface ReactionStatus extends ReactionTarget { viewerFid: number; liked: boolean; recasted: boolean }
type ReactionKind = 'like' | 'recast';
const BASE64_TOKEN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function reactionKind(type: ReactionKind): 'Like' | 'Recast' {
  if (type !== 'like' && type !== 'recast') throw new Error('Invalid reaction type.');
  return type === 'like' ? 'Like' : 'Recast';
}

function reactionCursor(value: unknown, previous?: string | null): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048 || !BASE64_TOKEN.test(value) || value === previous) throw new ApiError('The node returned invalid reaction pagination.', 502, 'invalid_response');
  return value;
}

/** Bounded public reads only. A failed member aborts the batch; missing data
 * must never be interpreted as an absent relationship. */
async function mapPublicReads<T, R>(items: T[], read: (item: T, signal: AbortSignal) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const results = new Array<R>(items.length);
  let index = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
      while (index < items.length) {
        controller.signal.throwIfAborted();
        const current = index++;
        try { results[current] = await read(items[current], controller.signal); }
        catch (error) { controller.abort(error); throw error; }
      }
    }));
    controller.signal.throwIfAborted();
    return results;
  } finally { signal?.removeEventListener('abort', abort); }
}

interface ReactionMessage {
  hash: string;
  data: { type: string; fid: number; timestamp: number; network: string; reactionBody: { type: string; targetCastId?: ReactionTarget; targetUrl?: string } };
}

function validateReaction(value: unknown, viewerFid: number, type: ReactionKind): ReactionMessage {
  if (!isObject(value) || typeof value.hash !== 'string' || !HASH.test(value.hash) || !isObject(value.data)) throw new ApiError('The node returned an invalid reaction.', 502, 'invalid_response');
  const data = value.data;
  if (data.type !== 'MESSAGE_TYPE_REACTION_ADD' || data.fid !== viewerFid || data.network !== 'FARCASTER_NETWORK_MAINNET'
    || !Number.isInteger(data.timestamp) || Number(data.timestamp) < 0 || Number(data.timestamp) > 0xffffffff || !isObject(data.reactionBody)
    || data.reactionBody.type !== (type === 'like' ? 'REACTION_TYPE_LIKE' : 'REACTION_TYPE_RECAST')) throw new ApiError('The node returned an invalid reaction.', 502, 'invalid_response');
  const body = data.reactionBody;
  // URL reactions are real protocol messages but have no cast to hydrate.
  if (body.targetCastId !== undefined) {
    if (!isObject(body.targetCastId) || !Number.isSafeInteger(body.targetCastId.fid) || Number(body.targetCastId.fid) < 1
      || typeof body.targetCastId.hash !== 'string' || !HASH.test(body.targetCastId.hash) || body.targetUrl) throw new ApiError('The node returned an invalid reaction target.', 502, 'invalid_response');
  } else if (typeof body.targetUrl !== 'string' || !body.targetUrl) throw new ApiError('The node returned an invalid reaction target.', 502, 'invalid_response');
  return value as unknown as ReactionMessage;
}

export type CastReactionPeopleType = 'likes' | 'recasts';
/** One node page, not a complete archive or a globally ordered ranking. The
 * node applies pageSize per shard and can repeat exhausted shards on later
 * pages. Keep the entire bounded page before advancing its opaque token. */
export async function getCastReactionPeople(options: { target: ReactionTarget; type: CastReactionPeopleType; cursor?: string | null; limit?: number; signal?: AbortSignal }): Promise<FollowsResponse> {
  const targetFid = fidValue(options.target.fid);
  const targetHash = hashValue(options.target.hash);
  if (options.type !== 'likes' && options.type !== 'recasts') throw new Error('Invalid cast reaction list.');
  const type = options.type === 'likes' ? 'like' : 'recast';
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error('Request up to 25 reactions per shard.');
  if (options.cursor) reactionCursor(options.cursor);
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException('Reaction people timed out', 'TimeoutError')), REQUEST_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ target_fid: targetFid, target_hash: targetHash, reaction_type: reactionKind(type), pageSize: String(limit), reverse: 'true' });
    if (options.cursor) params.set('pageToken', options.cursor);
    const response = await requestJson<{ messages: unknown[]; nextPageToken?: string }>('/v1/reactionsByCast', params, controller.signal);
    // Independent of the per-shard request limit. Never silently truncate a
    // response and then retain its continuation, which would lose people.
    if (!Array.isArray(response.messages) || response.messages.length > 1000) throw new ApiError('The node returned an invalid cast reaction list.', 502, 'invalid_response');
    const actorFids = new Set<number>();
    for (const value of response.messages) {
      if (!isObject(value) || !isObject(value.data) || !Number.isSafeInteger(value.data.fid) || Number(value.data.fid) < 1) throw new ApiError('The node returned an invalid reaction actor.', 502, 'invalid_response');
      const message = validateReaction(value, Number(value.data.fid), type);
      const target = message.data.reactionBody.targetCastId;
      if (!target || String(target.fid) !== targetFid || hashValue(target.hash) !== targetHash) throw new ApiError('The node returned a different reaction target.', 502, 'invalid_response');
      actorFids.add(message.data.fid);
    }
    const cursor = reactionCursor(response.nextPageToken, options.cursor);
    const users = await mapPublicReads([...actorFids], async (fid, signal) => {
      const user = await getUser({ fid }, signal);
      if (!publicUser(user) || user.fid !== fid) throw new ApiError('The node returned an invalid reaction profile.', 502, 'invalid_response');
      return user;
    }, controller.signal);
    controller.signal.throwIfAborted();
    return { users, next: { cursor } };
  } catch (error) {
    const timedOut = controller.signal.aborted && !options.signal?.aborted && controller.signal.reason instanceof DOMException && controller.signal.reason.name === 'TimeoutError';
    controller.abort(error);
    if (timedOut) throw new ApiError('Cast reaction profiles took too long to load. Try again.', 504, 'timeout');
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

/** Hypersnap does not populate cast.viewer_context. Resolve the actual current
 * add receipt; only the worker's exact source-defined absence code is false. */
export async function getReactionStatus(viewerFid: number, target: ReactionTarget, type: ReactionKind, signal?: AbortSignal): Promise<boolean> {
  const params = new URLSearchParams({ fid: fidValue(viewerFid), reaction_type: reactionKind(type), target_fid: fidValue(target.fid), target_hash: hashValue(target.hash) });
  try {
    const value = await requestJson<unknown>('/v1/reactionById', params, signal);
    const message = validateReaction(value, viewerFid, type);
    const observed = message.data.reactionBody.targetCastId;
    if (!observed || observed.fid !== target.fid || hashValue(observed.hash) !== hashValue(target.hash)) throw new ApiError('The node returned a different reaction target.', 502, 'invalid_response');
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && error.code === 'reaction_not_found') return false;
    throw error;
  }
}

/** At most 25 visible casts and four requests in flight. Callers must key cached
 * results by viewer FID as well as target and cancel when the account changes. */
export async function getReactionStatuses(viewerFid: number, targets: ReactionTarget[], signal?: AbortSignal): Promise<ReactionStatus[]> {
  fidValue(viewerFid);
  if (!Array.isArray(targets) || targets.length > 25) throw new Error('Check up to 25 visible casts at a time.');
  const unique = new Map<string, ReactionTarget>();
  for (const target of targets) {
    fidValue(target.fid);
    const hash = hashValue(target.hash);
    unique.set(`${target.fid}:${hash}`, { fid: target.fid, hash });
  }
  const normalized = [...unique.values()];
  const jobs = normalized.flatMap(target => (['like', 'recast'] as const).map(type => ({ target, type })));
  const states = await mapPublicReads(jobs, ({ target, type }, localSignal) => getReactionStatus(viewerFid, target, type, localSignal), signal);
  return normalized.map((target, index) => ({ ...target, viewerFid, liked: states[index * 2], recasted: states[index * 2 + 1] }));
}

async function getProfileReactions(options: { fid: number; tab: 'likes' | 'recasts'; cursor?: string | null; limit?: number; signal?: AbortSignal }): Promise<FeedResponse> {
  // Bound the entire scan + target hydration, rather than resetting a timeout
  // for every page and every cast (which could otherwise take many minutes).
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException('Reaction history timed out', 'TimeoutError')), REQUEST_TIMEOUT_MS);
  try {
    return await readProfileReactions({ ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) throw new ApiError('Profile reaction history took too long to load. Try again.', 504, 'timeout');
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

async function readProfileReactions(options: { fid: number; tab: 'likes' | 'recasts'; cursor?: string | null; limit?: number; signal: AbortSignal }): Promise<FeedResponse> {
  const type = options.tab === 'likes' ? 'like' : 'recast';
  const limit = options.limit ?? 20;
  const casts: Cast[] = [];
  let cursor = options.cursor;
  const seen = new Set<string>();
  if (cursor) reactionCursor(cursor);
  for (let page = 0; page < 5; page++) {
    options.signal?.throwIfAborted();
    if (cursor) {
      if (seen.has(cursor)) throw new ApiError('The node returned invalid reaction pagination.', 502, 'invalid_response');
      seen.add(cursor);
    }
    const remaining = limit - casts.length;
    const params = new URLSearchParams({ fid: fidValue(options.fid), reaction_type: reactionKind(type), pageSize: String(remaining), reverse: 'true' });
    if (cursor) params.set('pageToken', cursor);
    const response = await requestJson<{ messages: unknown[]; nextPageToken?: string }>('/v1/reactionsByFid', params, options.signal);
    if (!Array.isArray(response.messages) || response.messages.length > remaining) throw new ApiError('The node returned invalid reaction history.', 502, 'invalid_response');
    const messages = response.messages.map(value => validateReaction(value, options.fid, type));
    const next = reactionCursor(response.nextPageToken, cursor);
    const hydrated = await mapPublicReads<ReactionMessage, Cast | undefined>(messages, async (message, localSignal) => {
      const target = message.data.reactionBody.targetCastId;
      if (!target) return undefined;
      try {
        const cast = await getCast(target.hash, localSignal);
        if (!isObject(cast) || !publicUser(cast.author) || cast.author.fid !== target.fid || typeof cast.hash !== 'string' || hashValue(cast.hash) !== hashValue(target.hash)
          || typeof cast.text !== 'string' || typeof cast.timestamp !== 'string' || !Number.isFinite(Date.parse(cast.timestamp)) || !Array.isArray(cast.embeds)
          || !isObject(cast.reactions) || !Number.isSafeInteger(cast.reactions.likes_count) || cast.reactions.likes_count < 0
          || !Number.isSafeInteger(cast.reactions.recasts_count) || cast.reactions.recasts_count < 0
          || !isObject(cast.replies) || !Number.isSafeInteger(cast.replies.count) || cast.replies.count < 0) throw new ApiError('The node returned invalid reaction history.', 502, 'invalid_response');
        return { ...cast, reaction_context: { fid: options.fid, type, timestamp: new Date((message.data.timestamp + 1609459200) * 1000).toISOString() } } satisfies Cast;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404 && error.code === 'cast_not_found') return undefined;
        throw error;
      }
    }, options.signal);
    casts.push(...hydrated.filter((cast): cast is Cast => cast !== undefined));
    cursor = next;
    if (!cursor || casts.length >= limit) break;
  }
  return { casts, next: { cursor: cursor ?? null } };
}

/** Image formats rendered by this client, including our content-addressed R2 URLs. */
export function hasImageEmbed(cast: Cast): boolean {
  return cast.embeds?.some(embed => {
    if (!('url' in embed)) return false;
    try {
      const url = new URL(embed.url);
      return url.protocol === 'https:' && (/\.(png|jpe?g|webp|gif)$/i.test(url.pathname)
        || ['imagedelivery.net', 'imagedelivery.cloud'].includes(url.hostname)
        || ([APP_ORIGIN, LEGACY_APP_ORIGIN].includes(url.origin) && /^\/media\/[a-f0-9]{64}$/.test(url.pathname)));
    } catch { return false; }
  }) ?? false;
}

/** Filter one real user-feed page without waiting for additional history reads.
 * A sparse tab can return an empty page with a cursor: callers must keep More
 * available so the next request continues after this complete underlying page.
 * The node's replies_and_recasts adapter is unsuitable: it includes channel
 * roots as replies and can skip results while truncating its fetched batch.
 */
export async function getProfileFeed(options: { fid: number; tab: ProfileTab; cursor?: string | null; limit?: number; signal?: AbortSignal }): Promise<FeedResponse> {
  if (!['casts', 'replies', 'media', 'likes', 'recasts'].includes(options.tab)) throw new Error('Invalid profile tab.');
  pageParams(options.cursor, options.limit);
  fidValue(options.fid);
  if (options.tab === 'likes' || options.tab === 'recasts') return getProfileReactions({ ...options, tab: options.tab });
  const limit = options.limit ?? 20;
  const response = await getFeed({ kind: 'user', fid: options.fid, cursor: options.cursor, limit, signal: options.signal });
  const casts = response.casts.filter(cast => {
    const isReply = !!cast.parent_hash;
    return options.tab === 'media' ? hasImageEmbed(cast) : options.tab === 'replies' ? isReply : !isReply;
  });
  if (casts.length > limit) throw new ApiError('The node exceeded the requested profile page size.', 502, 'invalid_response');
  return { casts, next: response.next };
}

/** Prefix search is bounded to the node's ranked top results; it has no cursor. */
export async function searchUsers(options: { query: string; limit?: number; signal?: AbortSignal }): Promise<{ users: User[] }> {
  const params = pageParams(undefined, options.limit);
  params.set('q', searchQuery(options.query));
  const response = await requestJson<{ users: User[] }>('/v2/farcaster/user/search', params, options.signal);
  if (!Array.isArray(response.users)) throw new ApiError('The node returned invalid search results.', 502, 'invalid_response');
  // Imported index entries can hydrate to fid:0 placeholders. They are not accounts.
  return { users: response.users.filter(publicUser) };
}

/** Tantivy can retain deleted casts and emits excerpts with zeroed metadata.
 * Hydrate at most 25 ranked hits, four at a time, before exposing cast actions.
 * One 25-second deadline bounds the search and every hydration request together.
 */
export async function searchCasts(options: { query: string; limit?: number; signal?: AbortSignal }): Promise<FeedResponse> {
  const params = pageParams(undefined, options.limit);
  params.set('limit', String(Math.min(options.limit ?? 20, 25)));
  params.set('q', searchQuery(options.query));
  if (options.signal?.aborted) throw new DOMException('Search cancelled.', 'AbortError');
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Search timed out', 'TimeoutError')), REQUEST_TIMEOUT_MS);
  try {
    const response = await requestJson<{ result?: FeedResponse }>('/v2/farcaster/cast/search', params, controller.signal);
    if (!isObject(response.result) || !Array.isArray(response.result.casts)) throw new ApiError('The node returned invalid search results.', 502, 'invalid_response');
    const seen = new Set<string>();
    const hits: Array<{ hash: string; fid: number }> = [];
    for (const cast of response.result.casts.slice(0, Math.min(options.limit ?? 20, 25))) {
      if (!isObject(cast) || typeof cast.hash !== 'string' || !HASH.test(cast.hash) || !publicUser(cast.author)) continue;
      const hash = hashValue(cast.hash);
      if (!seen.has(hash)) { seen.add(hash); hits.push({ hash, fid: cast.author.fid }); }
    }
    const hydrated: Array<Cast | undefined> = new Array(hits.length);
    let next = 0;
    const worker = async () => {
      while (!controller.signal.aborted) {
        const index = next++;
        if (index >= hits.length) return;
        try {
          const cast = await getCast(hits[index].hash, controller.signal);
          if (typeof cast.hash !== 'string' || !HASH.test(cast.hash) || hashValue(cast.hash) !== hits[index].hash || !publicUser(cast.author) || cast.author.fid !== hits[index].fid
            || typeof cast.text !== 'string' || typeof cast.timestamp !== 'string' || !Number.isFinite(Date.parse(cast.timestamp))
            || !Array.isArray(cast.embeds) || cast.embeds.length > 2 || cast.embeds.some((embed: unknown) => !isObject(embed)
              || !(('url' in embed && !('cast_id' in embed) && typeof embed.url === 'string')
                || (!('url' in embed) && isObject(embed.cast_id) && Number.isSafeInteger(embed.cast_id.fid) && Number(embed.cast_id.fid) > 0 && typeof embed.cast_id.hash === 'string' && HASH.test(embed.cast_id.hash))))
            || !isObject(cast.reactions) || !Number.isSafeInteger(cast.reactions.likes_count) || cast.reactions.likes_count < 0
            || !Number.isSafeInteger(cast.reactions.recasts_count) || cast.reactions.recasts_count < 0
            || !isObject(cast.replies) || !Number.isSafeInteger(cast.replies.count) || cast.replies.count < 0) {
            throw new ApiError('The node returned an invalid search cast.', 502, 'invalid_response');
          }
          hydrated[index] = cast;
        } catch (error) {
          // Only verified absence means stale search data. Outages, malformed
          // responses and cancellation must never look like successful no hits.
          if (!(error instanceof ApiError && error.status === 404 && error.code === 'cast_not_found')) throw error;
        }
      }
      throw controller.signal.reason ?? new DOMException('Search cancelled.', 'AbortError');
    };
    await Promise.all(Array.from({ length: Math.min(4, hits.length) }, worker));
    if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException('Search cancelled.', 'AbortError');
    // The current index ignores cursors and always returns its ranked top N.
    return { casts: hydrated.filter((cast): cast is Cast => cast !== undefined), next: { cursor: null } };
  } catch (error) {
    const timedOut = controller.signal.aborted && !options.signal?.aborted && controller.signal.reason instanceof DOMException && controller.signal.reason.name === 'TimeoutError';
    controller.abort(error); // Cancel pending hydration and stop scheduling hits.
    if (timedOut) throw new ApiError('Cast search took too long to respond. Try again.', 504, 'timeout');
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

export async function getChannels(options: { kind: 'all' | 'trending' | 'search'; query?: string; cursor?: string | null; limit?: number; signal?: AbortSignal }): Promise<ChannelsResponse> {
  if (!['all', 'trending', 'search'].includes(options.kind)) throw new Error('Invalid channel directory.');
  if (options.cursor && options.kind !== 'all') throw new Error('This channel list does not support pagination.');
  const params = pageParams(options.cursor, options.limit);
  if (options.kind === 'search') params.set('q', searchQuery(options.query ?? ''));
  const response = await requestJson<ChannelsResponse>(`/v2/farcaster/channel/${options.kind}`, params, options.signal);
  if (!Array.isArray(response.channels)) throw new ApiError('The node returned invalid channels.', 502, 'invalid_response');
  return {
    // The index also contains arbitrary parent-URL namespaces. This directory
    // exposes named channels that our local /channel/:id route can represent.
    channels: response.channels.filter(value => isObject(value) && typeof value.id === 'string' && CHANNEL_ID.test(value.id) && typeof value.url === 'string' && typeof value.name === 'string'),
    next: { cursor: options.kind === 'all' ? nextCursor(response.next?.cursor, options.cursor) : null },
  };
}

export async function getChannel(id: string, signal?: AbortSignal): Promise<Channel> {
  if (!CHANNEL_ID.test(id)) throw new Error('Invalid channel.');
  const response = await requestJson<{ channel: Channel }>('/v2/farcaster/channel', new URLSearchParams({ id, type: 'id' }), signal);
  if (!isObject(response.channel) || typeof response.channel.id !== 'string' || !CHANNEL_ID.test(response.channel.id)
    || response.channel.id !== id || typeof response.channel.url !== 'string' || typeof response.channel.name !== 'string') throw new ApiError('The node returned an invalid channel.', 502, 'invalid_response');
  return response.channel;
}

/** A bounded friends-of-friends sample from the node, not a complete ranking. */
export async function getSuggestedUsers(fid: number, limit = 8, signal?: AbortSignal): Promise<{ users: User[] }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Request up to 20 suggested profiles.');
  const response = await requestJson<{ users: User[] }>('/v2/farcaster/following/suggested', new URLSearchParams({ fid: fidValue(fid), limit: String(limit) }), signal);
  if (!Array.isArray(response.users) || response.users.length > limit || response.users.some(user => !publicUser(user))) throw new ApiError('The node returned invalid suggested profiles.', 502, 'invalid_response');
  return { users: [...new Map(response.users.filter(user => user.fid !== fid).map(user => [user.fid, user])).values()] };
}

/** The node's channel member index tracks people who posted here. It does not
 * track subscriptions, permissions, ownership, or current membership. */
export async function getChannelMembers(channelId: string, options: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {}): Promise<FollowsResponse> {
  if (!CHANNEL_ID.test(channelId)) throw new Error('Invalid channel.');
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error('Request up to 25 channel participants.');
  const decimal = (value: unknown): value is string => typeof value === 'string' && /^\d{1,20}$/.test(value) && BigInt(value) <= 0xffffffffffffffffn;
  if (options.cursor && !decimal(options.cursor)) throw new Error('Invalid channel participants cursor.');
  const params = new URLSearchParams({ channel_id: channelId, limit: String(limit) });
  if (options.cursor) params.set('cursor', options.cursor);
  const response = await requestJson<{ members: Array<{ user: User }>; next?: { cursor?: string | null } }>('/v2/farcaster/channel/members', params, options.signal);
  if (!Array.isArray(response.members) || response.members.length > limit || response.members.some(member => !isObject(member) || !publicUser(member.user))) throw new ApiError('The node returned invalid channel participants.', 502, 'invalid_response');
  const next = response.next?.cursor;
  if (next !== undefined && next !== null && (!decimal(next) || next === options.cursor)) throw new ApiError('The node returned invalid channel participants pagination.', 502, 'invalid_response');
  return { users: [...new Map(response.members.map(member => [member.user.fid, member.user])).values()], next: { cursor: next ?? null } };
}

/** A bounded quote-index sample. An empty response also occurs on nodes with
 * no quote index, so callers must never claim this is an exhaustive archive. */
export async function getCastQuotes(hash: string, limit = 25, signal?: AbortSignal): Promise<FeedResponse> {
  const targetHash = hashValue(hash);
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error('Request up to 25 quote casts.');
  const response = await requestJson<{ casts: Cast[] }>('/v2/farcaster/cast/quotes', new URLSearchParams({ identifier: targetHash, type: 'hash', limit: String(limit) }), signal);
  if (!Array.isArray(response.casts) || response.casts.length > limit) throw new ApiError('The node returned invalid quote casts.', 502, 'invalid_response');
  const unique = new Map<string, Cast>();
  for (const cast of response.casts) {
    if (!isObject(cast) || !publicUser(cast.author) || typeof cast.hash !== 'string' || !HASH.test(cast.hash)
      || typeof cast.text !== 'string' || typeof cast.timestamp !== 'string' || !Number.isFinite(Date.parse(cast.timestamp)) || !Array.isArray(cast.embeds)
      || !isObject(cast.reactions) || !Number.isSafeInteger(cast.reactions.likes_count) || cast.reactions.likes_count < 0
      || !Number.isSafeInteger(cast.reactions.recasts_count) || cast.reactions.recasts_count < 0
      || !isObject(cast.replies) || !Number.isSafeInteger(cast.replies.count) || cast.replies.count < 0
      || !cast.embeds.some(embed => isObject(embed) && 'cast_id' in embed && isObject(embed.cast_id) && Number.isSafeInteger(embed.cast_id.fid) && Number(embed.cast_id.fid) > 0
        && typeof embed.cast_id.hash === 'string' && HASH.test(embed.cast_id.hash) && hashValue(embed.cast_id.hash) === targetHash)) throw new ApiError('The node returned invalid quote casts.', 502, 'invalid_response');
    unique.set(hashValue(cast.hash), cast);
  }
  return { casts: [...unique.values()], next: { cursor: null } };
}

/** Public recent activity. The node's bounded recent-cast scan is not a complete
 * historical inbox; read state is local to this client, never a stub POST API.
 */
export async function getNotifications(options: { fid: number; cursor?: string | null; limit?: number; signal?: AbortSignal }): Promise<NotificationsResponse> {
  const params = pageParams(options.cursor, options.limit);
  params.set('fid', fidValue(options.fid));
  const response = await requestJson<{ notifications: Array<{ type: string; user: User; cast?: Cast | null; timestamp: string }>; next: { cursor?: string | null } }>('/v2/farcaster/notifications', params, options.signal);
  if (!Array.isArray(response.notifications)) throw new ApiError('The node returned invalid activity.', 502, 'invalid_response');
  const notifications: ActivityItem[] = [];
  const seen = new Set<string>();
  for (const item of response.notifications) {
    if (!isObject(item) || !publicUser(item.user) || typeof item.type !== 'string' || typeof item.timestamp !== 'string' || !Number.isFinite(Date.parse(item.timestamp))) throw new ApiError('The node returned invalid activity.', 502, 'invalid_response');
    const cast = item.cast && isObject(item.cast) && HASH.test(String(item.cast.hash)) ? item.cast : undefined;
    const type: ActivityItem['type'] = item.type === 'likes' ? 'reactions' : item.type === 'follows' ? 'follows'
      : cast?.parent_author?.fid === options.fid ? 'replies'
        : cast?.mentioned_profiles?.some(user => user.fid === options.fid) ? 'mentions' : 'unknown';
    // The v2 adapter does not include the original message hash. This stable
    // public-field key is suitable for local seen state, not a signed receipt.
    const id = `${item.timestamp}:${item.user.fid}:${type}:${cast?.hash ?? ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    notifications.push({ id, type, timestamp: item.timestamp, actors: [item.user], ...(cast ? { cast, targetHash: cast.hash } : {}) });
  }
  return { notifications, next: { cursor: nextCursor(response.next?.cursor, options.cursor) } };
}

/** Resolve only Hypersnap's stored name proof, then hydrate its stable FID.
 * The two public reads share a deadline and never query an Ethereum RPC.
 */
async function getUserByEnsName(input: string, signal?: AbortSignal): Promise<User> {
  const { name, type } = normalizeHypersnapEnsName(input);
  if (signal?.aborted) throw signal.reason ?? new DOMException('Account lookup cancelled.', 'AbortError');
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException('Account name lookup timed out', 'TimeoutError')), REQUEST_TIMEOUT_MS);
  try {
    const proof = await requestJson<{ fid?: unknown }>('/v1/fidByName', new URLSearchParams({ name, type }), controller.signal);
    if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException('Account lookup cancelled.', 'AbortError');
    if (!Number.isSafeInteger(proof.fid) || Number(proof.fid) < 1 || Number(proof.fid) > 0xffffffff) throw new ApiError('The node returned an invalid account name proof.', 502, 'invalid_response');
    const fid = proof.fid as number;
    const user = await getUser({ fid }, controller.signal);
    if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException('Account lookup cancelled.', 'AbortError');
    if (user.fid !== fid) throw new ApiError('The node returned a different account for this name proof.', 502, 'invalid_response');
    return user;
  } catch (error) {
    const timedOut = controller.signal.aborted && !signal?.aborted && controller.signal.reason instanceof DOMException && controller.signal.reason.name === 'TimeoutError';
    if (timedOut) throw new ApiError('Account name lookup took too long to respond. Try again.', 504, 'timeout');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function getUser(lookup: { fid?: number; username?: string; custodyAddress?: string; ensName?: string }, signal?: AbortSignal): Promise<User> {
  if (Object.values(lookup).filter(value => value !== undefined).length !== 1) throw new Error('Use one profile identifier.');
  if (lookup.ensName !== undefined) return getUserByEnsName(lookup.ensName, signal);
  // Existing profile links and exact mention lookups pass names as username.
  // Preserve other legacy usernames while routing .eth proofs natively too.
  if (lookup.username !== undefined && /\.eth$/i.test(lookup.username.replace(/^@/, ''))) return getUserByEnsName(lookup.username, signal);
  let path = '/v2/farcaster/user';
  const params = new URLSearchParams();
  if (lookup.custodyAddress !== undefined) {
    path += '/custody-address';
    params.set('custody_address', addressValue(lookup.custodyAddress));
  } else if (lookup.username !== undefined) {
    const username = lookup.username.replace(/^@/, '');
    if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(username)) throw new Error('Enter a valid Farcaster username.');
    path += '/by-username';
    params.set('username', username);
  } else {
    params.set('fid', fidValue(lookup.fid));
  }
  const response = await requestJson<{ user: User }>(path, params, signal);
  if (!isObject(response.user) || !Number.isSafeInteger(response.user.fid)) throw new ApiError('The node returned an invalid profile.', 502, 'invalid_response');
  return response.user;
}

/** Public social graph data; a wallet connection is not API authentication. */
export async function getFollows(options: { fid: number; kind: 'followers' | 'following'; cursor?: string | null; limit?: number; signal?: AbortSignal }): Promise<FollowsResponse> {
  if (options.kind !== 'followers' && options.kind !== 'following') throw new Error('Invalid follow list.');
  const validCursor = (value: unknown): value is string => typeof value === 'string' && /^\d{1,20}$/.test(value) && BigInt(value) <= 0xffffffffffffffffn;
  if (options.cursor && !validCursor(options.cursor)) throw new Error('Invalid follow pagination cursor.');
  const params = pageParams(options.cursor, options.limit);
  params.set('fid', fidValue(options.fid));
  const response = await requestJson<FollowsResponse>(`/v2/farcaster/user/${options.kind}`, params, options.signal);
  if (!Array.isArray(response.users) || response.users.some(user => !isObject(user) || !Number.isSafeInteger(user.fid) || user.fid < 1)) throw new ApiError('The node returned an invalid follow list.', 502, 'invalid_response');
  const next = response.next?.cursor;
  if (next !== undefined && next !== null && !validCursor(next)) throw new ApiError('The node returned an invalid follow cursor.', 502, 'invalid_response');
  return { users: response.users, next: { cursor: next === options.cursor ? null : next } };
}

export async function getFollowStatus(viewerFid: number, targetFid: number, signal?: AbortSignal): Promise<boolean> {
  const params = new URLSearchParams({ fid: fidValue(viewerFid), link_type: 'follow', target_fid: fidValue(targetFid) });
  try {
    const result = await requestJson<{ data?: { type?: string; fid?: number; linkBody?: { type?: string; targetFid?: number } } }>('/v1/linkById', params, signal);
    if (result.data?.type !== 'MESSAGE_TYPE_LINK_ADD' || result.data.fid !== viewerFid || result.data.linkBody?.type !== 'follow' || result.data.linkBody.targetFid !== targetFid) throw new ApiError('The node returned an invalid follow relationship.', 502, 'invalid_response');
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && error.code === 'follow_not_found') {
      // Imported accounts can keep follows in LINK_COMPACT_STATE rather than
      // individual LINK_ADD messages. Hypersnap's effective social index also
      // applies later removals. Its cursor is an exclusive target-FID bound,
      // so one seek checks this relationship without downloading the graph.
      const page = await getFollows({ fid: viewerFid, kind: 'following', cursor: String(targetFid - 1), limit: 1, signal });
      if (page.users.length > 1 || page.users.some(user => user.fid < targetFid)) throw new ApiError('The node returned an invalid follow relationship.', 502, 'invalid_response');
      return page.users[0]?.fid === targetFid;
    }
    throw error;
  }
}

export async function getCast(hash: string, signal?: AbortSignal): Promise<Cast> {
  const response = await requestJson<{ cast: Cast }>('/v2/farcaster/cast', new URLSearchParams({ identifier: hashValue(hash), type: 'hash' }), signal);
  if (!isObject(response.cast)) throw new ApiError('The cast could not be loaded.', 502, 'invalid_response');
  return response.cast;
}

// Platform-independent candidates for a future shared Hypersnap client.
export interface CastAliasContinuation {
  readonly authorIdentifier: string;
  readonly hashPrefix: string;
  readonly fid: number;
  readonly cursor: string;
  readonly seenCursors: readonly string[];
  readonly hashes: readonly string[];
  readonly scanned: number;
}
export interface CastAliasResult {
  author: User;
  /** Cumulative, currently available matches, each hydrated by exact FID/hash. */
  candidates: Cast[];
  complete: boolean;
  /** Cumulative history messages; native history includes removals as well. */
  scanned: number;
  continuation?: CastAliasContinuation;
  limited?: boolean;
}
const CAST_LINK_PAGE_SIZE = 250;
const CAST_LINK_BATCH_PAGES = 4;
const CAST_LINK_MAX_MESSAGES = 100_000;
const CAST_LINK_MAX_MATCHES = 25;

/** Native v1 history uses the legacy User/CastMessage primary key. Hyper's
 * shadow User prefix (0x1e) is used by v2 feeds, not this v1 store. The fixed
 * key is [0x03][FID:u32 BE][0x01][timestamp:u32 BE][message hash:20].
 */
function castHistoryCursorKey(value: unknown, fid: number): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 2048 || !BASE64_TOKEN.test(value)) return;
  try {
    const bytes = atob(value);
    if (bytes.length !== 30 || btoa(bytes) !== value || bytes.charCodeAt(0) !== 0x03 || bytes.charCodeAt(5) !== 0x01) return;
    const cursorFid = bytes.charCodeAt(1) * 0x1000000 + bytes.charCodeAt(2) * 0x10000 + bytes.charCodeAt(3) * 0x100 + bytes.charCodeAt(4);
    if (cursorFid !== fid) return;
    return Array.from(bytes, byte => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  } catch { return; }
}
function castLinkCursor(value: unknown, fid: number): value is string {
  return castHistoryCursorKey(value, fid) !== undefined;
}
function castHistoryMessageKey(fid: number, timestamp: number, hash: string): string {
  return `03${fid.toString(16).padStart(8, '0')}01${timestamp.toString(16).padStart(8, '0')}${hashValue(hash)}`;
}
function descendingCastHistoryCursors(seen: readonly string[], cursor: string, fid: number): boolean {
  let previous: string | undefined;
  for (const token of [...seen, cursor]) {
    const key = castHistoryCursorKey(token, fid);
    if (!key || (previous !== undefined && key >= previous)) return false;
    previous = key;
  }
  return true;
}
function castLinkFid(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 0xffffffff;
}
async function getAuthorCast(fid: number, hash: string, signal: AbortSignal): Promise<Cast> {
  signal.throwIfAborted();
  const fullHash = hashValue(hash);
  const response = await requestJson<{ cast?: unknown }>('/v2/farcaster/cast', new URLSearchParams({ identifier: fullHash, type: 'hash', fid: String(fid) }), signal);
  signal.throwIfAborted();
  const cast = response.cast;
  if (!isObject(cast) || typeof cast.hash !== 'string' || !HASH.test(cast.hash) || hashValue(cast.hash) !== fullHash
    || !isObject(cast.author) || cast.author.fid !== fid || typeof cast.text !== 'string'
    || typeof cast.timestamp !== 'string' || !Number.isFinite(Date.parse(cast.timestamp)) || !Array.isArray(cast.embeds)) {
    throw new ApiError('The node returned a different or invalid cast for this author.', 502, 'invalid_response');
  }
  return { ...cast, hash: `0x${fullHash}` } as unknown as Cast;
}

/** Native Hypersnap has no short-hash index. Search a bounded author history
 * batch and disclose whether it was exhausted; never infer uniqueness from a
 * first match. Continuing is explicit, and all history state stays in memory.
 */
export async function resolveCastAlias(options: {
  authorIdentifier: string;
  hashPrefix: string;
  continuation?: CastAliasContinuation;
  signal?: AbortSignal;
  /** Verified matches from validated pages; never a claim of uniqueness. */
  onProgress?: (snapshot: CastAliasResult) => void;
}): Promise<CastAliasResult> {
  const authorIdentifier = options.authorIdentifier.toLowerCase();
  if (!/^[a-z0-9_.-]{1,128}$/.test(authorIdentifier) || authorIdentifier === '.' || authorIdentifier === '..') throw new Error('Invalid cast author.');
  const numericAuthor = /^\d+$/.test(authorIdentifier);
  if (numericAuthor && !castLinkFid(Number(authorIdentifier))) throw new Error('Invalid cast author FID.');
  if (!/^0x(?:[a-f0-9]{2}){4,20}$/i.test(options.hashPrefix)) throw new Error('Use a cast hash with 8–40 hexadecimal characters after 0x.');
  const hashPrefix = options.hashPrefix.toLowerCase();
  const state = options.continuation;
  if (state && (hashPrefix.length === 42 || state.authorIdentifier !== authorIdentifier || state.hashPrefix !== hashPrefix
    || !castLinkFid(state.fid) || !castLinkCursor(state.cursor, state.fid) || !Number.isSafeInteger(state.scanned) || state.scanned < 0 || state.scanned >= CAST_LINK_MAX_MESSAGES
    || !Array.isArray(state.seenCursors) || state.seenCursors.length > CAST_LINK_MAX_MESSAGES / CAST_LINK_PAGE_SIZE
    || !descendingCastHistoryCursors(state.seenCursors, state.cursor, state.fid)
    || !Array.isArray(state.hashes) || state.hashes.length > CAST_LINK_MAX_MATCHES || new Set(state.hashes).size !== state.hashes.length
    || state.hashes.some(hash => typeof hash !== 'string' || !/^0x[a-f0-9]{40}$/.test(hash) || !hash.startsWith(hashPrefix)))) {
    throw new Error('This cast lookup continuation is invalid. Start the lookup again.');
  }
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException('Cast link lookup timed out.', 'TimeoutError')), REQUEST_TIMEOUT_MS);
  try {
    const author = await getUser(numericAuthor ? { fid: Number(authorIdentifier) } : { username: authorIdentifier }, controller.signal);
    controller.signal.throwIfAborted();
    if (!castLinkFid(author.fid) || (numericAuthor && author.fid !== Number(authorIdentifier))) throw new ApiError('The node returned a different or invalid author.', 502, 'invalid_response');
    if (state && state.fid !== author.fid) throw new ApiError('This username now belongs to a different account. Start the lookup again.', 409, 'account_changed');
    if (hashPrefix.length === 42) {
      try { return { author, candidates: [await getAuthorCast(author.fid, hashPrefix, controller.signal)], complete: true, scanned: 0 }; }
      catch (error) {
        controller.signal.throwIfAborted();
        if (error instanceof ApiError && error.status === 404 && error.code === 'cast_not_found') return { author, candidates: [], complete: true, scanned: 0 };
        throw error;
      }
    }
    let cursor: string | undefined = state?.cursor;
    let scanned = state?.scanned ?? 0;
    let complete = false;
    let limited = false;
    const seenCursors = new Set(state?.seenCursors ?? []);
    const hashes = new Set(state?.hashes ?? []);
    // Reuse exact author/hash reads within this batch. Progress and final
    // results share verified data without introducing a persistent cast cache.
    const hydrated = new Map<string, Cast | null>();
    const hydrateCandidates = async (): Promise<Cast[]> => {
      const pending = [...hashes].filter(hash => !hydrated.has(hash));
      const matches = await mapPublicReads(pending, async (hash, signal) => {
        try { return await getAuthorCast(author.fid, hash, signal); }
        catch (error) {
          signal.throwIfAborted();
          if (error instanceof ApiError && error.status === 404 && error.code === 'cast_not_found') return null;
          throw error;
        }
      }, controller.signal);
      controller.signal.throwIfAborted();
      matches.forEach((cast, index) => hydrated.set(pending[index], cast));
      return [...hashes].flatMap(hash => { const cast = hydrated.get(hash); return cast ? [cast] : []; });
    };
    for (let page = 0; page < CAST_LINK_BATCH_PAGES; page++) {
      controller.signal.throwIfAborted();
      if (scanned >= CAST_LINK_MAX_MESSAGES || seenCursors.size >= CAST_LINK_MAX_MESSAGES / CAST_LINK_PAGE_SIZE) { limited = true; break; }
      if (cursor) {
        if (seenCursors.has(cursor)) throw new ApiError('The node repeated a cast-history cursor.', 502, 'invalid_pagination');
        seenCursors.add(cursor);
      }
      const params = new URLSearchParams({ fid: String(author.fid), pageSize: String(CAST_LINK_PAGE_SIZE), reverse: 'true' });
      if (cursor) params.set('pageToken', cursor);
      const history = await requestJson<{ messages?: unknown; nextPageToken?: unknown }>('/v1/castsByFid', params, controller.signal);
      controller.signal.throwIfAborted();
      if (!Array.isArray(history.messages) || history.messages.length > CAST_LINK_PAGE_SIZE) throw new ApiError('The node returned invalid author history.', 502, 'invalid_response');
      const remaining = CAST_LINK_MAX_MESSAGES - scanned;
      const checkedMessages = history.messages.slice(0, remaining);
      if (history.messages.length > remaining) limited = true;
      scanned += checkedMessages.length;
      let previousHistoryKey = cursor ? castHistoryCursorKey(cursor, author.fid) : undefined;
      for (const [messageIndex, message] of history.messages.entries()) {
        if (!isObject(message) || typeof message.hash !== 'string' || !HASH.test(message.hash) || !isObject(message.data)
          || message.data.fid !== author.fid || !Number.isSafeInteger(message.data.timestamp) || Number(message.data.timestamp) < 0 || Number(message.data.timestamp) > 0xffffffff
          || message.data.network !== 'FARCASTER_NETWORK_MAINNET'
          || !['MESSAGE_TYPE_CAST_ADD', 'MESSAGE_TYPE_CAST_REMOVE'].includes(String(message.data.type))
          || (message.data.type === 'MESSAGE_TYPE_CAST_ADD' && !isObject(message.data.castAddBody))
          || (message.data.type === 'MESSAGE_TYPE_CAST_REMOVE' && !isObject(message.data.castRemoveBody))) {
          throw new ApiError('The node returned invalid or unrelated cast history.', 502, 'invalid_response');
        }
        const fullHash = `0x${hashValue(message.hash)}`;
        const key = castHistoryMessageKey(author.fid, Number(message.data.timestamp), fullHash);
        if (previousHistoryKey !== undefined && key >= previousHistoryKey) throw new ApiError('The node returned out-of-order cast history.', 502, 'invalid_pagination');
        previousHistoryKey = key;
        if (messageIndex < checkedMessages.length && message.data.type === 'MESSAGE_TYPE_CAST_ADD' && fullHash.startsWith(hashPrefix) && !hashes.has(fullHash)) {
          if (hashes.size >= CAST_LINK_MAX_MATCHES) limited = true;
          else hashes.add(fullHash);
        }
      }
      const next = history.nextPageToken;
      if (next === undefined || next === '') { complete = !limited; cursor = undefined; }
      else {
        if (!castLinkCursor(next, author.fid) || seenCursors.has(next) || !history.messages.length
          || castHistoryCursorKey(next, author.fid) !== previousHistoryKey) throw new ApiError('The node returned invalid, unrelated or repeated cast-history pagination.', 502, 'invalid_pagination');
        cursor = next;
      }
      if (options.onProgress && hashes.size) {
        const candidates = await hydrateCandidates();
        controller.signal.throwIfAborted();
        if (candidates.length) options.onProgress({ author, candidates, complete: false, scanned });
      }
      if (!cursor) break;
      if (limited || scanned >= CAST_LINK_MAX_MESSAGES) { limited = true; break; }
    }
    const candidates = await hydrateCandidates();
    controller.signal.throwIfAborted();
    return { author, candidates, complete, scanned, ...(limited ? { limited: true } : {}),
      ...(!complete && !limited && cursor ? { continuation: { authorIdentifier, hashPrefix, fid: author.fid, cursor, seenCursors: [...seenCursors], hashes: candidates.map(cast => cast.hash), scanned } } : {}) };
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted && controller.signal.reason instanceof DOMException && controller.signal.reason.name === 'TimeoutError') {
      throw new ApiError('Cast link lookup took too long. Try again.', 504, 'timeout');
    }
    options.signal?.throwIfAborted();
    controller.signal.throwIfAborted();
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

export async function getConversation(hash: string, signal?: AbortSignal): Promise<ConversationNode> {
  type NestedCast = Cast & { direct_replies?: NestedCast[] };
  const response = await requestJson<{ conversation?: { cast?: NestedCast }; cast?: Cast; replies?: ConversationNode[] }>(
    '/v2/farcaster/cast/conversation',
    new URLSearchParams({ identifier: hashValue(hash), type: 'hash', reply_depth: '2' }),
    signal,
  );
  const normalize = (cast: NestedCast, depth = 0): ConversationNode => {
    const { direct_replies, ...plainCast } = cast;
    return { cast: plainCast, replies: depth < 5 && Array.isArray(direct_replies) ? direct_replies.map(reply => normalize(reply, depth + 1)) : [] };
  };
  const root = response.conversation?.cast ?? response.cast;
  if (root && (typeof root.hash !== 'string' || !HASH.test(root.hash) || hashValue(root.hash) !== hashValue(hash))) throw new ApiError('The node returned a different conversation.', 502, 'invalid_response');
  if (response.conversation?.cast) return normalize(response.conversation.cast);
  if (response.cast) return { cast: response.cast, replies: response.replies ?? [] };
  throw new ApiError('The node returned an invalid conversation.', 502, 'invalid_response');
}

export function getInfo(signal?: AbortSignal): Promise<NodeInfo> {
  return requestJson('/v1/info', undefined, signal);
}

export async function getSigners(fid: number, signal?: AbortSignal): Promise<SignersResponse> {
  // Rust's query decoder expects an indexed sequence, not a scalar string.
  const params = new URLSearchParams({ fid: fidValue(fid), pageSize: '1000', 'requesterFids[0]': String(fid) });
  const result = await requestJson<SignersResponse>('/v1/signersByFid', params, signal);
  if (!Array.isArray(result.signers) || !Number.isSafeInteger(result.currentUserNonce)) throw new ApiError('The node returned invalid signer state.', 502, 'invalid_response');
  // Do not mistake a truncated active signer list for a missing signer.
  const seenTokens = new Set<string>();
  while (result.nextPageToken) {
    if (result.signers.length >= 10_000 || seenTokens.size >= 10) throw new ApiError('This account has too many signers to inspect safely.', 502, 'signer_limit');
    if (seenTokens.has(result.nextPageToken)) throw new ApiError('The node returned invalid signer pagination.', 502, 'invalid_response');
    seenTokens.add(result.nextPageToken);
    params.set('pageToken', result.nextPageToken);
    const page = await requestJson<SignersResponse>('/v1/signersByFid', params, signal);
    if (!Array.isArray(page.signers) || page.nextPageToken === result.nextPageToken) throw new ApiError('The node returned invalid signer pagination.', 502, 'invalid_response');
    result.signers.push(...page.signers);
    result.nextPageToken = page.nextPageToken;
  }
  return result;
}

export function getCustodyEvents(address: string, signal?: AbortSignal): Promise<{ fid: number; [key: string]: unknown }> {
  return requestJson('/v1/onChainIdRegistryEventByAddress', new URLSearchParams({ address: addressValue(address) }), signal);
}

export function submitMessage(bytes: Uint8Array, signal?: AbortSignal): Promise<SubmitMessageResponse> {
  if (bytes.byteLength < 1 || bytes.byteLength > 65_536) throw new Error('Signed message must be between 1 byte and 64 KiB.');
  return requestJson('/v1/submitMessage', undefined, signal, bytes);
}
