import { getCast, type Cast } from './api';

const HASH = /^(?:0x)?[a-fA-F0-9]{40}$/;
const ANCESTRY_TIMEOUT_MS = 20_000;
const normalizeHash = (value: unknown): string | undefined => typeof value === 'string' && HASH.test(value) ? `0x${value.replace(/^0x/, '').toLowerCase()}` : undefined;
const validFid = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

export interface ParentCastReference { hash: string; fid?: number }
export interface CastAncestors { ancestors: Cast[]; status: 'complete' | 'unavailable' | 'limited' }

/** A channel parent URL identifies its channel, not another cast. */
export function parentCastReference(cast: Pick<Cast, 'parent_hash' | 'parent_author'>): ParentCastReference | undefined {
  const hash = normalizeHash(cast.parent_hash);
  if (!hash) return;
  const parent = cast.parent_author;
  if (parent != null && (typeof parent !== 'object' || Array.isArray(parent))) return;
  const fid = parent?.fid;
  if (fid != null && !validFid(fid)) return;
  return { hash, ...(fid == null ? {} : { fid }) };
}

/** Compare exact protocol identities before accepting a parent read or cache hit. */
export function matchesParentCast(child: Pick<Cast, 'parent_hash' | 'parent_author'>, parent: Cast): boolean {
  const reference = parentCastReference(child);
  return Boolean(reference && normalizeHash(parent?.hash) === reference.hash && validFid(parent?.author?.fid)
    && (reference.fid === undefined || parent.author.fid === reference.fid));
}

/** Read only the selected cast's ancestry, within one 20-second deadline.
 * Missing or invalid older context does not discard already verified parents
 * or prevent the selected cast opening. Caller cancellation still propagates. */
export async function getCastAncestors(cast: Cast, signal?: AbortSignal, options: { limit?: number; readCast?: typeof getCast } = {}): Promise<CastAncestors> {
  const limit = options.limit ?? 8;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) throw new Error('Read between 1 and 32 parent casts.');
  signal?.throwIfAborted();
  const ancestors: Cast[] = [];
  const initialHash = normalizeHash(cast.hash);
  const seen = new Set(initialHash ? [initialHash] : []);
  const result = (status: CastAncestors['status']): CastAncestors => ({ ancestors: [...ancestors].reverse(), status });
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  let interrupt!: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    interrupt = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', interrupt, { once: true });
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Earlier context took too long to load.', 'TimeoutError'));
  }, ANCESTRY_TIMEOUT_MS);
  try {
    let current = cast;
    while (current.parent_hash != null && current.parent_hash !== '') {
      controller.signal.throwIfAborted();
      const reference = parentCastReference(current);
      if (!reference || seen.has(reference.hash)) return result('unavailable');
      if (ancestors.length === limit) return result('limited');
      // Racing the deadline also ignores a response from a transport that is
      // slow to honor cancellation, without extending the whole-chain budget.
      const parent = await Promise.race([(options.readCast ?? getCast)(reference.hash, controller.signal), interrupted]);
      controller.signal.throwIfAborted();
      if (!matchesParentCast(current, parent) || typeof parent.text !== 'string' || typeof parent.timestamp !== 'string') return result('unavailable');
      seen.add(reference.hash); ancestors.push(parent); current = parent;
    }
    return result('complete');
  } catch (error) {
    signal?.throwIfAborted();
    if (!timedOut && error instanceof Error && error.name === 'AbortError') throw error;
    return result('unavailable');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', interrupt);
  }
}
