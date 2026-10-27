import { sha256 } from '@noble/hashes/sha256.js';
import { getFeed, type FeedResponse } from './api';
import { feedMatches, normalizeFeedDefinition, orderFeedCasts, sourceKey, type FeedDefinition } from './customFeeds';

export const CUSTOM_FEED_PAGE_SIZE = 25;
export const CUSTOM_FEED_CONCURRENCY = 4;
export const CUSTOM_FEED_SOURCE_PAGE_LIMIT = 64;
export const CUSTOM_FEED_CURSOR_LIMIT = 65536;
const READ_DEADLINE_MS = 25_000;
const NODE_CURSOR = /^[a-zA-Z0-9_+/=:-]{1,2048}$/;
const encoder = new TextEncoder();
interface SourceState { key: string; cursor: string | null; done: boolean; seen: string[] }
interface CursorState { version: 1; sources: SourceState[] }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = (cursor: string) => btoa(Array.from(sha256(encoder.encode(cursor)), byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const abortReason = (signal: AbortSignal) => signal.reason ?? new DOMException('Feed loading cancelled.', 'AbortError');
class RepeatedSourcePageError extends Error {}

function encodeCursor(state: CursorState): string {
  const token = btoa(Array.from(encoder.encode(JSON.stringify(state)), byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (token.length > CUSTOM_FEED_CURSOR_LIMIT) throw new Error('This feed reached its safe pagination limit. Refresh it to start again.');
  return token;
}

function decodeCursor(token: string, keys: string[]): CursorState {
  try {
    if (!token || token.length > CUSTOM_FEED_CURSOR_LIMIT || !/^[A-Za-z0-9_-]+$/.test(token) || token.length % 4 === 1) throw new Error();
    const binary = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, character => character.charCodeAt(0))));
    if (!object(value) || value.version !== 1 || !Array.isArray(value.sources) || value.sources.length !== keys.length) throw new Error();
    const sources = value.sources.map((source, index): SourceState => {
      if (!object(source) || source.key !== keys[index] || typeof source.done !== 'boolean' || (source.cursor !== null && (typeof source.cursor !== 'string' || !NODE_CURSOR.test(source.cursor)))
        || !Array.isArray(source.seen) || source.seen.length >= CUSTOM_FEED_SOURCE_PAGE_LIMIT || !source.seen.every(item => typeof item === 'string' && /^[A-Za-z0-9_-]{43}$/.test(item))
        || new Set(source.seen).size !== source.seen.length || (!source.done && (source.cursor === null || source.seen.includes(digest(source.cursor as string))))
        || (source.done && source.cursor !== null)) throw new Error();
      return { key: keys[index], cursor: source.cursor as string | null, done: source.done, seen: [...source.seen] as string[] };
    });
    const state: CursorState = { version: 1, sources };
    if (encodeCursor(state) !== token) throw new Error();
    return state;
  } catch { throw new Error('This feed continuation is invalid or belongs to different sources. Refresh the feed.'); }
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortReason(signal));
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** One real page per active source. Empty filtered pages retain continuation. */
export async function readCustomFeed(definition: FeedDefinition, cursor?: string | null, signal?: AbortSignal): Promise<FeedResponse> {
  const normalized = normalizeFeedDefinition(definition);
  if (!normalized) throw new Error('This feed recipe is invalid.');
  if (signal?.aborted) throw abortReason(signal);
  const keys = normalized.sources.map(sourceKey);
  const state: CursorState = cursor === undefined || cursor === null
    ? { version: 1, sources: keys.map(key => ({ key, cursor: null, done: false, seen: [] })) }
    : decodeCursor(cursor, keys);
  if (state.sources.some(source => !source.done && source.seen.length >= CUSTOM_FEED_SOURCE_PAGE_LIMIT - 1)) throw new Error('This combined feed reached its browsing limit. Refresh it to start again.');
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(() => controller.abort(new DOMException('Feed loading took too long. Try again.', 'TimeoutError')), READ_DEADLINE_MS);
  const pages: FeedResponse[] = normalized.sources.map(() => ({ casts: [], next: { cursor: null } }));
  let next = 0;
  let failure: unknown;
  const worker = async () => {
    while (!controller.signal.aborted) {
      const index = next++;
      if (index >= normalized.sources.length) return;
      const slot = state.sources[index];
      if (slot.done) continue;
      const source = normalized.sources[index];
      try {
        const page = await abortable(getFeed({ ...source, cursor: slot.cursor, limit: CUSTOM_FEED_PAGE_SIZE, signal: controller.signal }), controller.signal);
        if (controller.signal.aborted) throw abortReason(controller.signal);
        if (!Array.isArray(page.casts)) throw new Error('The node returned an invalid feed page.');
        const nextCursor = page.next?.cursor;
        if (nextCursor !== undefined && nextCursor !== null && (typeof nextCursor !== 'string' || !NODE_CURSOR.test(nextCursor))) throw new Error('The node returned invalid feed pagination.');
        const seen = slot.cursor ? [...slot.seen, digest(slot.cursor)] : slot.seen;
        if (nextCursor && seen.includes(digest(nextCursor))) throw new RepeatedSourcePageError('The node repeated a source page. Refresh this feed to check for more conversations.');
        const done = !nextCursor;
        state.sources[index] = { key: slot.key, cursor: done ? null : nextCursor!, done, seen };
        pages[index] = page;
      } catch (error) {
        if (!controller.signal.aborted) {
          failure = error instanceof RepeatedSourcePageError ? error : new Error(`Could not load ${slot.key}. Retry to load all sources together.`, { cause: error });
          controller.abort(failure);
        }
        throw failure ?? error;
      }
    }
    throw failure ?? abortReason(controller.signal);
  };
  try {
    await Promise.all(Array.from({ length: Math.min(CUSTOM_FEED_CONCURRENCY, normalized.sources.length) }, worker));
    if (controller.signal.aborted) throw failure ?? abortReason(controller.signal);
    const casts = pages.flatMap(page => page.casts).filter(cast => feedMatches(cast, normalized));
    return { casts: orderFeedCasts(casts, normalized), next: { cursor: state.sources.some(source => !source.done) ? encodeCursor(state) : null } };
  } finally {
    clearTimeout(deadline); signal?.removeEventListener('abort', abort);
  }
}
