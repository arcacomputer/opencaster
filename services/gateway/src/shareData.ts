import { normalizeHypersnapEnsName } from '@opencaster/client-core/ensName';
import type { AppRoute } from '@opencaster/client-core/navigation';
import type { Cast } from '@opencaster/client-core/api';
import { renderMentionSegments } from '@opencaster/client-core/content';
import { decodeFeed, type FeedDefinition } from '@opencaster/client-core/customFeeds';
import { fetchUpstream, parseUpstreamObject, resolveReadFallback, resolveUpstream, type UpstreamConfig, type UpstreamEnv } from './upstream';

/** Only public display fields may cross the sharing boundary. */
export interface ShareProfile {
  fid: number;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl?: string;
  followers?: number;
  following?: number;
}
export interface ShareChannel {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  members?: number;
}
export interface ShareFeed {
  name: string;
  sources: readonly string[];
  rules: readonly string[];
  sourceCount: number;
  definition: FeedDefinition;
}
export type ShareData =
  | { kind: 'profile'; profile: ShareProfile }
  | { kind: 'cast'; profile: ShareProfile; hash: string; text: string; timestamp: string; imageUrls?: readonly string[] }
  | { kind: 'channel'; channel: ShareChannel }
  | { kind: 'feed'; feed: ShareFeed };

const MAX_RESPONSE_BYTES = 1024 * 1024;
const LOOKUP_TIMEOUT_MS = 4000;
const ATTEMPT_TIMEOUT_MS = 1500;
const HISTORY_PAGE_SIZE = 250;
const HISTORY_PAGES = 2;
const FULL_HASH = /^(?:0x)?([a-f0-9]{40})$/i;
const IDENTIFIER = /^[a-z0-9_.-]{1,128}$/i;
const CHANNEL = /^[a-z0-9_-]{1,64}$/i;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const fidValue = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 0xffffffff;
const hashValue = (value: unknown): string | undefined => typeof value === 'string' ? FULL_HASH.exec(value)?.[1].toLowerCase() : undefined;

function text(value: unknown, limit: number, { preserveNewlines = false, preserveSpaces = false }: { preserveNewlines?: boolean; preserveSpaces?: boolean } = {}): string {
  if (typeof value !== 'string') return '';
  // Strip invisible direction controls before shaping text in an HTML/image card.
  // eslint-disable-next-line no-control-regex -- Public display text must not carry control characters.
  const cleaned = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, ' ');
  const formatted = preserveNewlines
    ? cleaned.replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    : preserveSpaces ? cleaned.replace(/[^\S ]+/g, ' ').trim() : cleaned.replace(/\s+/g, ' ').trim();
  return Array.from(formatted).slice(0, limit).join('');
}

function avatarUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return;
    return url.href;
  } catch { return; }
}

function profileValue(value: unknown): ShareProfile | undefined {
  if (!object(value) || !fidValue(value.fid) || typeof value.username !== 'string') return;
  // Hypersnap uses this exact bound sentinel for an unavailable username.
  const username = value.username === `fid:${value.fid}` ? '' : value.username;
  if (username !== '' && (!IDENTIFIER.test(username) || username === '.' || username === '..')) return;
  const profile = object(value.profile) ? value.profile : undefined;
  const bio = profile && object(profile.bio) ? text(profile.bio.text, 500) : '';
  const avatar = avatarUrl(value.pfp_url);
  const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
  return {
    fid: value.fid, username, displayName: text(value.display_name, 80) || username || `FID ${value.fid}`, bio,
    ...(avatar ? { avatarUrl: avatar } : {}),
    ...(count(value.follower_count) ? { followers: value.follower_count } : {}),
    ...(count(value.following_count) ? { following: value.following_count } : {}),
  };
}

/** Race explicitly: even a fetch implementation/stream that ignores abort must
 * not hold up the initial document. Late responses are cancelled, never used. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function cancelBody(response: Response): void { void response.body?.cancel().catch(() => {}); }

async function responseObject(response: Response, config: UpstreamConfig, signal: AbortSignal): Promise<Record<string, unknown>> {
  const length = response.headers.get('Content-Length');
  if (!response.headers.get('Content-Type')?.toLowerCase().includes('application/json') || !response.body
    || (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES))) {
    cancelBody(response); throw new Error('Invalid sharing response');
  }
  const reader = response.body.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error('Sharing response too large');
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return parseUpstreamObject(bytes, config);
  } finally {
    void reader.cancel().catch(() => {});
  }
}

type PublicRead = (path: string, params: URLSearchParams) => Promise<Record<string, unknown> | undefined>;

function publicReader(primary: UpstreamConfig, fallback: UpstreamConfig | undefined, signal: AbortSignal): PublicRead {
  return async (path, params) => {
    for (const config of [primary, ...(fallback ? [fallback] : [])]) {
      signal.throwIfAborted();
      const attempt = new AbortController();
      const abort = () => attempt.abort(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => attempt.abort(new DOMException('Sharing lookup timed out', 'TimeoutError')), ATTEMPT_TIMEOUT_MS);
      try {
        const pending = fetchUpstream(config, `${path}?${params}`, { method: 'GET', signal: attempt.signal });
        void pending.then(response => { if (attempt.signal.aborted) cancelBody(response); }, () => {});
        let response: Response;
        try { response = await abortable(pending, attempt.signal); }
        catch { signal.throwIfAborted(); continue; }
        attempt.signal.throwIfAborted();
        if (response.status >= 500 && response.status <= 599) { cancelBody(response); continue; }
        if (response.status !== 200) { cancelBody(response); return; }
        try { return await responseObject(response, config, attempt.signal); }
        catch (error) { signal.throwIfAborted(); if (attempt.signal.aborted) continue; throw error; }
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        attempt.abort();
        // Only transport, timeout and HTTP 5xx reach the backup. Malformed
        // successful responses must never silently change identity.
      }
    }
  };
}

async function loadProfile(identifier: string, read: PublicRead): Promise<ShareProfile | undefined> {
  if (!IDENTIFIER.test(identifier) || identifier === '.' || identifier === '..') return;
  let fid: number | undefined;
  let username: string | undefined;
  if (/^\d+$/.test(identifier)) {
    fid = Number(identifier);
    if (!fidValue(fid)) return;
  } else if (/\.eth$/i.test(identifier)) {
    const name = normalizeHypersnapEnsName(identifier);
    const proof = await read('/v1/fidByName', new URLSearchParams({ name: name.name, type: name.type }));
    if (!proof || !fidValue(proof.fid)) return;
    fid = proof.fid;
  } else username = identifier.toLowerCase();
  const response = await read(username ? '/v2/farcaster/user/by-username' : '/v2/farcaster/user',
    new URLSearchParams(username ? { username } : { fid: String(fid) }));
  const profile = profileValue(response?.user);
  if (!profile || (fid !== undefined && profile.fid !== fid) || (username !== undefined && profile.username.toLowerCase() !== username)) return;
  return profile;
}

async function loadChannel(id: string, read: PublicRead): Promise<ShareChannel | undefined> {
  if (!CHANNEL.test(id)) return;
  const response = await read('/v2/farcaster/channel', new URLSearchParams({ id, type: 'id' }));
  const channel = response?.channel;
  if (!object(channel) || channel.id !== id || typeof channel.name !== 'string') return;
  const image = avatarUrl(channel.image_url);
  return {
    id, name: text(channel.name, 80) || id, description: text(channel.description, 500),
    ...(image ? { imageUrl: image } : {}),
    ...(Number.isSafeInteger(channel.member_count) && Number(channel.member_count) >= 0 ? { members: channel.member_count as number } : {}),
  };
}

/** Shared recipes describe public inputs and rules, never a viewer's saved
 * state or a claim about the node's current results. No hydration is needed. */
function loadFeed(token: string): ShareFeed | undefined {
  const definition = decodeFeed(token);
  if (!definition) return;
  const sources = definition.sources.map(source => {
    if (source.kind === 'trending') return `Trending · ${source.timeWindow}`;
    if (source.kind === 'channel') return `Channel /${source.channel}`;
    return source.kind === 'user' ? `Account FID ${source.fid}` : `Public following of FID ${source.fid}`;
  });
  // Ordinary spaces are literal matching input, so retain their multiplicity.
  const phraseList = (phrases: readonly string[]) => phrases.map(phrase => `“${text(phrase, 64, { preserveSpaces: true })}”`).join(', ');
  const rules = [definition.order === 'newest' ? 'Newest loaded first' : 'Source order (as loaded)'];
  if (definition.filters.includeWords.length) rules.push(`Includes any phrase: ${phraseList(definition.filters.includeWords)}`);
  if (definition.filters.excludeWords.length) rules.push(`Excludes any phrase: ${phraseList(definition.filters.excludeWords)}`);
  if (definition.filters.imagesOnly) rules.push('Images only');
  if (definition.filters.hideReplies) rules.push('Replies hidden');
  return { name: text(definition.name, 64) || 'Custom feed', sources, rules, sourceCount: sources.length, definition };
}

async function loadCast(hash: string, read: PublicRead, expectedAuthor?: ShareProfile | number): Promise<ShareData | undefined> {
  const exactHash = hashValue(hash);
  if (!exactHash) return;
  const expectedFid = typeof expectedAuthor === 'number' ? expectedAuthor : expectedAuthor?.fid;
  const params = new URLSearchParams({ identifier: exactHash, type: 'hash' });
  if (expectedFid !== undefined) params.set('fid', String(expectedFid));
  const response = await read('/v2/farcaster/cast', params);
  const cast = response?.cast;
  if (!object(cast) || hashValue(cast.hash) !== exactHash || typeof cast.text !== 'string' || cast.text.length > 16_384
    || typeof cast.timestamp !== 'string' || cast.timestamp.length > 64 || !Number.isFinite(Date.parse(cast.timestamp)) || !Array.isArray(cast.embeds)) return;
  const author = profileValue(cast.author);
  if (!author || (expectedFid !== undefined && author.fid !== expectedFid)) return;
  const imageUrls = cast.embeds.flatMap(embed => {
    const url = object(embed) ? avatarUrl(embed.url) : undefined;
    return url ? [url] : [];
  }).slice(0, 2);
  // The API's raw protocol text omits mention labels. Reuse the browser's
  // all-or-nothing UTF-8 range validation before sanitation changes offsets.
  const displayedText = renderMentionSegments(cast as unknown as Pick<Cast, 'text' | 'mentioned_profiles' | 'mentioned_profiles_ranges'>)
    .map(segment => segment.kind === 'text' ? segment.text : `@${segment.user.username || segment.user.fid}`).join('');
  return { kind: 'cast', profile: typeof expectedAuthor === 'object' ? expectedAuthor : author, hash: `0x${exactHash}`, text: text(displayedText, 1200, { preserveNewlines: true }), timestamp: new Date(cast.timestamp).toISOString(),
    ...(imageUrls.length ? { imageUrls } : {}) };
}

/** Native v1 cursors are exact legacy User/FID/CastMessage/timestamp/hash
 * primary keys. Validate their author, exclusive ordering and last receipt. */
function cursorKey(value: unknown, fid: number): string | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{40}$/.test(value)) return;
  try {
    const raw = atob(value);
    if (raw.length !== 30 || btoa(raw) !== value || raw.charCodeAt(0) !== 3 || raw.charCodeAt(5) !== 1) return;
    const cursorFid = raw.charCodeAt(1) * 0x1000000 + raw.charCodeAt(2) * 0x10000 + raw.charCodeAt(3) * 0x100 + raw.charCodeAt(4);
    if (cursorFid !== fid) return;
    return Array.from(raw, byte => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  } catch { return; }
}

async function loadAlias(authorIdentifier: string, prefix: string, read: PublicRead): Promise<ShareData | undefined> {
  if (!/^0x(?:[a-f0-9]{2}){4,20}$/i.test(prefix)) return;
  const normalized = prefix.toLowerCase();
  // Exact FID/hash image routes already identify both public cast coordinates.
  // Read the cast directly and independently check its returned author FID.
  if (normalized.length === 42 && /^\d+$/.test(authorIdentifier)) {
    const fid = Number(authorIdentifier);
    return fidValue(fid) ? loadCast(normalized, read, fid) : undefined;
  }
  const profile = await loadProfile(authorIdentifier, read);
  if (!profile) return;
  if (normalized.length === 42) return loadCast(normalized, read, profile);
  let cursor: string | undefined;
  const matches = new Set<string>();
  for (let page = 0; page < HISTORY_PAGES; page++) {
    const params = new URLSearchParams({ fid: String(profile.fid), pageSize: String(HISTORY_PAGE_SIZE), reverse: 'true' });
    if (cursor) params.set('pageToken', cursor);
    const history = await read('/v1/castsByFid', params);
    if (!history || !Array.isArray(history.messages) || history.messages.length > HISTORY_PAGE_SIZE) return;
    let previousKey = cursor ? cursorKey(cursor, profile.fid) : undefined;
    for (const message of history.messages) {
      if (!object(message) || !object(message.data)) return;
      const hash = hashValue(message.hash);
      const data = message.data;
      if (!hash || data.fid !== profile.fid || !Number.isSafeInteger(data.timestamp) || Number(data.timestamp) < 0 || Number(data.timestamp) > 0xffffffff
        || data.network !== 'FARCASTER_NETWORK_MAINNET'
        || (data.type !== 'MESSAGE_TYPE_CAST_ADD' && data.type !== 'MESSAGE_TYPE_CAST_REMOVE')
        || (data.type === 'MESSAGE_TYPE_CAST_ADD' && !object(data.castAddBody))
        || (data.type === 'MESSAGE_TYPE_CAST_REMOVE' && !object(data.castRemoveBody))) return;
      const key = `03${profile.fid.toString(16).padStart(8, '0')}01${Number(data.timestamp).toString(16).padStart(8, '0')}${hash}`;
      if (previousKey !== undefined && key >= previousKey) return;
      previousKey = key;
      if (data.type === 'MESSAGE_TYPE_CAST_ADD' && `0x${hash}`.startsWith(normalized)) matches.add(`0x${hash}`);
    }
    const next = history.nextPageToken;
    if (next !== undefined && next !== '') {
      if (!history.messages.length || !cursorKey(next, profile.fid) || cursorKey(next, profile.fid) !== previousKey) return;
      cursor = next as string;
    } else cursor = undefined;
    if (matches.size > 1) return;
    if (!cursor) break;
  }
  // This is a unique observed candidate in at most 500 recent receipts, not a
  // claim that all available history was scanned or that the prefix is global.
  if (matches.size !== 1) return;
  return loadCast([...matches][0], read, profile);
}

/** Fail open to the generic site card on unavailable/ambiguous public data.
 * Every read shares this deadline and an optional caller's shorter deadline. */
export async function loadShareData(route: AppRoute, env: UpstreamEnv, signal?: AbortSignal): Promise<ShareData | undefined> {
  if (route.kind !== 'profile' && route.kind !== 'cast' && route.kind !== 'cast-alias' && route.kind !== 'channel' && route.kind !== 'feed') return;
  if (signal?.aborted) return;
  // Feed URLs contain their complete validated public definition; they work
  // even when the origin is unavailable or its private configuration is absent.
  if (route.kind === 'feed') {
    const feed = loadFeed(route.token);
    return feed ? { kind: 'feed', feed } : undefined;
  }
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException('Sharing lookup timed out', 'TimeoutError')), LOOKUP_TIMEOUT_MS);
  try {
    const primary = resolveUpstream(env);
    const read = publicReader(primary, resolveReadFallback(env, primary), controller.signal);
    let result: ShareData | undefined;
    if (route.kind === 'profile' && route.identifier) {
      const profile = await loadProfile(route.identifier, read);
      if (profile) result = { kind: 'profile', profile };
    } else if (route.kind === 'cast') result = await loadCast(route.hash, read);
    else if (route.kind === 'cast-alias') result = await loadAlias(route.authorIdentifier, route.hashPrefix, read);
    else if (route.kind === 'channel') {
      const channel = await loadChannel(route.channel, read);
      if (channel) result = { kind: 'channel', channel };
    }
    controller.signal.throwIfAborted();
    return result;
  } catch { return; }
  finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}
