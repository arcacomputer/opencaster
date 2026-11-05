import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './errors';

export interface PagedReadPage<T> { items: T[]; cursor?: string | null }
export interface PagedReadOptions {
  /** Most items kept across pages; reaching it stops pagination with `cappedStatus`. */
  maxItems?: number;
  /** Most successful pages per read; reaching it with a continuation stops pagination with `cappedStatus`. */
  maxPages?: number;
  repeatedStatus: string;
  cappedStatus?: string;
  errorFallback: string;
}
export interface PagedRead<T> {
  key: string;
  items: T[];
  cursor?: string;
  busy: boolean;
  loaded: boolean;
  error: string;
  status: string;
  cancel(): void;
  refresh(): void;
  more(): void;
  retry(): void;
}

export const LOADING_CANCELLED = 'Loading cancelled.';
const initial = <T,>(key: string, busy: boolean) => ({ key, items: [] as T[], cursor: undefined as string | undefined, busy, loaded: false, error: '', status: '' });

/**
 * Cursor-paginated, abortable read keyed by `key`. A key change aborts the
 * in-flight request and starts over; stale completions are discarded, repeated
 * continuations and caps stop pagination, and items are deduplicated by `identity`.
 */
export function usePagedRead<T>(key: string, enabled: boolean, read: (cursor: string | undefined, signal: AbortSignal) => Promise<PagedReadPage<T>>, identity: (item: T) => string, options: PagedReadOptions): PagedRead<T> {
  const [state, setState] = useState(() => initial<T>(key, enabled));
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const requesting = useRef(false);
  const seen = useRef(new Set<string>());
  const pageCount = useRef(0);
  const lastAttempt = useRef<{ cursor?: string; replace: boolean }>({ replace: true });
  const currentKey = useRef(key); currentKey.current = key;
  const reader = useRef(read); reader.current = read;
  const id = useRef(identity); id.current = identity;
  const config = useRef(options); config.current = options;
  const load = useCallback(async (cursor?: string, replace = true) => {
    if (!enabled || requesting.current) return;
    requesting.current = true; controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const run = ++generation.current; const capturedKey = key;
    lastAttempt.current = { cursor, replace };
    setState(current => ({ ...current, key, busy: true, error: '', status: '' }));
    try {
      const page = await reader.current(cursor, request.signal);
      if (request.signal.aborted || run !== generation.current || currentKey.current !== capturedKey) return;
      if (cursor) seen.current.add(cursor);
      const repeated = Boolean(page.cursor && (page.cursor === cursor || seen.current.has(page.cursor)));
      const pages = ++pageCount.current;
      const { maxItems = Infinity, maxPages = Infinity, repeatedStatus, cappedStatus = '' } = config.current;
      setState(current => {
        const entries = new Map((replace ? [] : current.items).map(item => [id.current(item), item]));
        for (const item of page.items) entries.set(id.current(item), item);
        const capped = entries.size >= maxItems || (pages >= maxPages && Boolean(page.cursor));
        return { key, items: [...entries.values()].slice(0, maxItems), cursor: repeated || capped ? undefined : page.cursor || undefined, busy: false, loaded: true, error: '', status: repeated ? repeatedStatus : capped ? cappedStatus : '' };
      });
    } catch (cause) {
      if (!request.signal.aborted && run === generation.current && currentKey.current === capturedKey) setState(current => ({ ...current, busy: false, error: errorMessage(cause, config.current.errorFallback) }));
    } finally { if (run === generation.current) requesting.current = false; }
  }, [enabled, key]);
  useEffect(() => {
    generation.current += 1; controller.current?.abort(); requesting.current = false; seen.current.clear(); pageCount.current = 0;
    setState(initial<T>(key, enabled));
    if (enabled) void load();
    return () => { generation.current += 1; controller.current?.abort(); requesting.current = false; };
  }, [key, enabled, load]);
  function cancel() { generation.current += 1; controller.current?.abort(); requesting.current = false; setState(current => ({ ...current, busy: false, status: LOADING_CANCELLED })); }
  return { ...(state.key === key ? state : initial<T>(key, enabled)),
    cancel,
    refresh: () => { if (requesting.current) return; seen.current.clear(); pageCount.current = 0; void load(); },
    more: () => void load(state.cursor, false),
    retry: () => void load(lastAttempt.current.cursor, lastAttempt.current.replace) };
}
