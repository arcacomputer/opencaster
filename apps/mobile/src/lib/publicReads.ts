import type { Cast, FeedResponse } from '@opencaster/client-core/api';

export type CastPageReader = (cursor: string | null, signal: AbortSignal) => Promise<FeedResponse>;
export type CastRetryKind = 'initial' | 'refresh' | 'page' | null;

export interface CastPageState {
  phase: 'loading' | 'ready' | 'error';
  casts: Cast[];
  nextCursor: string | null;
  loadingMore: boolean;
  refreshing: boolean;
  error: string | null;
  retryKind: CastRetryKind;
}

const INITIAL_STATE: CastPageState = {
  phase: 'loading',
  casts: [],
  nextCursor: null,
  loadingMore: false,
  refreshing: false,
  error: null,
  retryKind: null,
};

function cursorKey(cursor: string | null): string {
  return cursor === null ? 'first-page' : cursor;
}

function hashKey(cast: Cast): string {
  return cast.hash.replace(/^0x/i, '').toLowerCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Could not load public casts. Check your connection and try again.';
}

export class CastPageController {
  private state = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private readonly seenCursors = new Set<string>();
  private readonly seenHashes = new Set<string>();
  private activeRequest: AbortController | null = null;
  private generation = 0;
  private pagesLoaded = 0;

  constructor(private readonly readPage: CastPageReader, private readonly maxPages = 64) {}

  getSnapshot = (): CastPageState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async refresh(): Promise<void> {
    this.abortActiveRequest();
    const generation = ++this.generation;
    const hasCasts = this.state.casts.length > 0;
    this.publish({
      ...this.state,
      phase: hasCasts ? 'ready' : 'loading',
      refreshing: hasCasts,
      loadingMore: false,
      error: null,
      retryKind: null,
    });
    await this.fetchPage(null, generation, true);
  }

  async loadMore(): Promise<void> {
    if (this.state.loadingMore || this.state.refreshing || !this.state.nextCursor || this.state.error) return;
    await this.fetchPage(this.state.nextCursor, this.generation, false);
  }

  async retry(): Promise<void> {
    if (this.state.retryKind === 'page') {
      if (this.state.loadingMore) return;
      await this.fetchPage(this.state.nextCursor, this.generation, false);
    } else if (this.state.retryKind === 'initial' || this.state.retryKind === 'refresh') {
      await this.refresh();
    }
  }

  cancel(): void {
    this.generation++;
    this.abortActiveRequest();
  }

  private async fetchPage(cursor: string | null, generation: number, replace: boolean): Promise<void> {
    const key = cursorKey(cursor);
    if (!replace && (this.seenCursors.has(key) || this.pagesLoaded >= this.maxPages)) {
      this.publish({ ...this.state, nextCursor: null, loadingMore: false, refreshing: false });
      return;
    }
    const controller = new AbortController();
    this.activeRequest = controller;
    this.publish({
      ...this.state,
      phase: this.state.casts.length ? 'ready' : 'loading',
      loadingMore: !replace,
      error: null,
      retryKind: null,
    });

    try {
      const response = await this.readPage(cursor, controller.signal);
      if (generation !== this.generation || controller.signal.aborted) return;

      const seenCursors = replace ? new Set<string>([key]) : new Set(this.seenCursors).add(key);
      const page = replace ? [] : [...this.state.casts];
      const seenHashes = replace ? new Set<string>() : new Set(this.seenHashes);
      for (const cast of response.casts) {
        const hash = hashKey(cast);
        if (seenHashes.has(hash)) continue;
        seenHashes.add(hash);
        page.push(cast);
      }
      const pagesLoaded = replace ? 1 : this.pagesLoaded + 1;
      const next = response.next?.cursor ?? null;
      const nextCursor = pagesLoaded >= this.maxPages || !next || seenCursors.has(cursorKey(next))
        ? null
        : next;

      this.seenCursors.clear();
      seenCursors.forEach(value => this.seenCursors.add(value));
      this.seenHashes.clear();
      seenHashes.forEach(value => this.seenHashes.add(value));
      this.pagesLoaded = pagesLoaded;
      this.publish({
        phase: 'ready',
        casts: page,
        nextCursor,
        loadingMore: false,
        refreshing: false,
        error: null,
        retryKind: null,
      });
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return;
      const retryKind: CastRetryKind = replace
        ? (this.state.casts.length ? 'refresh' : 'initial')
        : 'page';
      this.publish({
        ...this.state,
        phase: this.state.casts.length ? 'ready' : 'error',
        loadingMore: false,
        refreshing: false,
        error: errorMessage(error),
        retryKind,
      });
    } finally {
      if (this.activeRequest === controller) this.activeRequest = null;
    }
  }

  private abortActiveRequest(): void {
    this.activeRequest?.abort();
    this.activeRequest = null;
  }

  private publish(state: CastPageState): void {
    this.state = state;
    this.listeners.forEach(listener => listener());
  }
}

export type PublicReadState<T> =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; value: T }
  | { phase: 'error'; error: string };

export function publicReadError(error: unknown): string {
  return errorMessage(error);
}
