import { ApiError, getCast, type Cast } from './api';

const HASH = /^(?:0x)?[a-fA-F0-9]{40}$/;
const normalizeHash = (value: unknown): string | undefined => typeof value === 'string' && HASH.test(value) ? `0x${value.replace(/^0x/, '').toLowerCase()}` : undefined;
interface Subscriber {
  resolve(cast: Cast): void;
  reject(reason: unknown): void;
  signal?: AbortSignal;
  abort(): void;
}
interface Read {
  hash: string;
  controller: AbortController;
  subscribers: Set<Subscriber>;
}
export interface ParentCastReader { read: typeof getCast; dispose(): void }

/** Share bounded public parent reads within one view. Each caller owns only its
 * subscription; cancelling one card must not cancel context another card needs. */
export function createParentCastReader(): ParentCastReader {
  const cache = new Map<string, Cast>();
  const pending = new Map<string, Read>();
  const queue: Read[] = [];
  let active = 0;
  const forget = (read: Read) => { if (pending.get(read.hash) === read) pending.delete(read.hash); };
  const settle = (read: Read, subscriber: Subscriber, cast?: Cast, error?: unknown) => {
    if (!read.subscribers.delete(subscriber)) return;
    subscriber.signal?.removeEventListener('abort', subscriber.abort);
    if (cast) subscriber.resolve(cast); else subscriber.reject(error);
  };
  const remember = (hash: string, cast: Cast) => {
    cache.delete(hash); cache.set(hash, cast);
    if (cache.size > 128) cache.delete(cache.keys().next().value!);
  };
  const pump = () => {
    while (active < 4 && queue.length) {
      const read = queue.shift()!;
      if (!read.subscribers.size || read.controller.signal.aborted) continue;
      active += 1;
      void (async () => {
        try {
          const cast = await getCast(read.hash, read.controller.signal);
          if (read.controller.signal.aborted) return;
          if (normalizeHash(cast?.hash) !== read.hash || !Number.isSafeInteger(cast?.author?.fid) || cast.author.fid < 1 || typeof cast.text !== 'string') {
            throw new ApiError('The node returned a different or invalid parent cast.', 502, 'invalid_response');
          }
          remember(read.hash, cast);
          for (const subscriber of read.subscribers) settle(read, subscriber, cast);
        } catch (error) {
          for (const subscriber of read.subscribers) settle(read, subscriber, undefined, error);
        } finally {
          active -= 1; forget(read); pump();
        }
      })();
    }
  };
  const read: typeof getCast = (input, signal) => {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const hash = normalizeHash(input);
    if (!hash) return Promise.reject(new Error('Invalid cast hash.'));
    const cached = cache.get(hash);
    if (cached) { remember(hash, cached); return Promise.resolve(cached); }
    let current = pending.get(hash);
    if (!current) {
      current = { hash, controller: new AbortController(), subscribers: new Set() };
      pending.set(hash, current); queue.push(current);
    }
    const entry = current;
    const result = new Promise<Cast>((resolve, reject) => {
      const subscriber: Subscriber = { resolve, reject, signal, abort() {
        settle(entry, subscriber, undefined, signal?.reason);
        if (!entry.subscribers.size) {
          forget(entry);
          const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1);
          entry.controller.abort(new DOMException('Parent context is no longer needed.', 'AbortError'));
        }
      } };
      entry.subscribers.add(subscriber);
      signal?.addEventListener('abort', subscriber.abort, { once: true });
    });
    pump();
    return result;
  };
  return { read, dispose() {
    const error = new DOMException('Parent context was cleared.', 'AbortError');
    for (const entry of pending.values()) {
      for (const subscriber of entry.subscribers) settle(entry, subscriber, undefined, error);
      entry.controller.abort(error);
    }
    pending.clear(); queue.length = 0; cache.clear();
  } };
}
