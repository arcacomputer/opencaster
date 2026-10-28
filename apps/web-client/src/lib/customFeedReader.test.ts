import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFeed, type Cast, type FeedResponse } from '@opencaster/client-core/api';
import { CUSTOM_FEED_CURSOR_LIMIT, CUSTOM_FEED_SOURCE_PAGE_LIMIT, readCustomFeed } from './customFeedReader';
import type { FeedDefinition } from '@opencaster/client-core/customFeeds';

vi.mock('@opencaster/client-core/api', async original => ({ ...await original<typeof import('@opencaster/client-core/api')>(), getFeed: vi.fn() }));
const definition = (extra: Partial<FeedDefinition> = {}): FeedDefinition => ({ version: 1, name: 'My feed', sources: [{ kind: 'user', fid: 1 }], order: 'source', filters: { includeWords: [], excludeWords: [], hideReplies: false, imagesOnly: false }, ...extra });
const cast = (id: number, text = `Cast ${id}`): Cast => ({ hash: `0x${id.toString(16).padStart(40, '0')}`, author: { fid: id, username: `person${id}`, custody_address: '', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 }, text, timestamp: `2026-10-26T${String(id).padStart(2, '0')}:00:00Z`, embeds: [], reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 } });
const page = (casts: Cast[] = [], cursor: string | null = null): FeedResponse => ({ casts, next: { cursor } });
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

describe('bounded multi-source feed reading', () => {
  it('keeps at most four transports active, reads exactly one 25-cast page per source and preserves chosen source order', async () => {
    const finishes: Array<() => void> = []; let active = 0, maximum = 0;
    vi.mocked(getFeed).mockImplementation(options => new Promise(resolve => {
      active++; maximum = Math.max(maximum, active);
      finishes.push(() => { active--; resolve(page([cast(options.fid!)])); });
    }));
    const feed = definition({ sources: Array.from({ length: 8 }, (_, fid) => ({ kind: 'user', fid: fid + 1 })) });
    const reading = readCustomFeed(feed);
    expect(getFeed).toHaveBeenCalledTimes(4);
    finishes[2](); await flush(); expect(getFeed).toHaveBeenCalledTimes(5);
    finishes[0](); finishes[1](); finishes[3](); await flush(); expect(getFeed).toHaveBeenCalledTimes(8);
    finishes.slice(4).forEach(finish => finish());
    const result = await reading;
    expect(result.casts.map(item => item.author.fid)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); expect(result.next.cursor).toBeNull(); expect(maximum).toBe(4);
    for (const [options] of vi.mocked(getFeed).mock.calls) expect(options.limit).toBe(25);
  });

  it('carries independent source cursors, skips exhausted sources and preserves sparse filtered continuation', async () => {
    const feed = definition({ sources: [{ kind: 'user', fid: 1 }, { kind: 'channel', channel: 'art' }], filters: { includeWords: ['match'], excludeWords: [], hideReplies: false, imagesOnly: false } });
    vi.mocked(getFeed).mockResolvedValueOnce(page([cast(1, 'hidden')], 'user-page2')).mockResolvedValueOnce(page([cast(2, 'hidden')])).mockResolvedValueOnce(page([cast(3, 'match')]));
    const first = await readCustomFeed(feed);
    expect(first.casts).toEqual([]); expect(first.next.cursor).toBeTruthy();
    const second = await readCustomFeed(feed, first.next.cursor);
    expect(second.casts).toEqual([cast(3, 'match')]); expect(second.next.cursor).toBeNull(); expect(getFeed).toHaveBeenCalledTimes(3);
    expect(vi.mocked(getFeed).mock.calls[2][0]).toMatchObject({ kind: 'user', fid: 1, cursor: 'user-page2', limit: 25 });
  });

  it('deduplicates sources/casts and applies loaded-only newest order', async () => {
    const feed = definition({ sources: [{ kind: 'user', fid: 1 }, { kind: 'user', fid: 1 }, { kind: 'following', fid: 2 }], order: 'newest' });
    vi.mocked(getFeed).mockResolvedValueOnce(page([cast(1), cast(2)])).mockResolvedValueOnce(page([{ ...cast(2), hash: cast(2).hash.slice(2).toUpperCase() }, cast(3)]));
    const result = await readCustomFeed(feed);
    expect(getFeed).toHaveBeenCalledTimes(2); expect(result.casts).toEqual([cast(3), cast(2), cast(1)]);
  });

  it('reports repeated cursors and longer cycles without falsely claiming exhaustion or advancing the caller continuation', async () => {
    vi.mocked(getFeed).mockResolvedValueOnce(page([cast(1)], 'one')).mockResolvedValueOnce(page([cast(2)], 'two')).mockResolvedValueOnce(page([cast(3)], 'one'));
    const first = await readCustomFeed(definition()), second = await readCustomFeed(definition(), first.next.cursor);
    const cursorBeforeFailure = second.next.cursor;
    await expect(readCustomFeed(definition(), second.next.cursor)).rejects.toThrow('The node repeated a source page. Refresh this feed');
    expect(second.casts).toEqual([cast(2)]); expect(second.next.cursor).toBe(cursorBeforeFailure); expect(getFeed).toHaveBeenCalledTimes(3);
    vi.mocked(getFeed).mockResolvedValueOnce(page([], 'repeat')).mockResolvedValueOnce(page([], 'repeat'));
    const fourth = await readCustomFeed(definition()); await expect(readCustomFeed(definition(), fourth.next.cursor)).rejects.toThrow('The node repeated a source page');
  });

  it('rejects a cycle atomically across sources so a retry reuses each previous source cursor', async () => {
    const feed = definition({ sources: [{ kind: 'user', fid: 1 }, { kind: 'channel', channel: 'art' }] });
    vi.mocked(getFeed).mockImplementation(async options => options.cursor ? page([cast(2)], options.kind === 'user' ? 'first' : 'advanced') : page([cast(1)], options.kind === 'user' ? 'first' : 'channel-first'));
    const first = await readCustomFeed(feed);
    await expect(readCustomFeed(feed, first.next.cursor)).rejects.toThrow('The node repeated a source page');
    vi.mocked(getFeed).mockClear();
    await expect(readCustomFeed(feed, first.next.cursor)).rejects.toThrow('The node repeated a source page');
    expect(vi.mocked(getFeed).mock.calls.map(([options]) => options.cursor)).toEqual(['first', 'channel-first']);
  });

  it('rejects invalid, mismatched or reordered source vectors before making a network request', async () => {
    const feed = definition({ sources: [{ kind: 'user', fid: 1 }, { kind: 'channel', channel: 'art' }] });
    vi.mocked(getFeed).mockResolvedValue(page([], 'next'));
    const result = await readCustomFeed(feed); vi.mocked(getFeed).mockClear();
    for (const cursor of ['', 'bad!', 'a', 'x'.repeat(CUSTOM_FEED_CURSOR_LIMIT + 1)]) await expect(readCustomFeed(feed, cursor)).rejects.toThrow('continuation');
    await expect(readCustomFeed(definition(), result.next.cursor)).rejects.toThrow('different sources');
    await expect(readCustomFeed({ ...feed, sources: [...feed.sources].reverse() }, result.next.cursor)).rejects.toThrow('different sources');
    await expect(readCustomFeed({ ...feed, sources: [{ kind: 'user', fid: 2 }, feed.sources[1]] }, result.next.cursor)).rejects.toThrow('different sources');
    expect(getFeed).not.toHaveBeenCalled();
  });

  it('does not expose successful partial pages when a source fails, aborts pending reads and allows a clean retry', async () => {
    const feed = definition({ sources: Array.from({ length: 8 }, (_, fid) => ({ kind: 'user', fid: fid + 1 })) });
    vi.mocked(getFeed).mockResolvedValueOnce(page([cast(1)], 'next')).mockRejectedValueOnce(new Error('node unavailable')).mockImplementation(() => new Promise(() => {}));
    await expect(readCustomFeed(feed)).rejects.toThrow('Could not load user:2');
    // The first successful source can free a slot before the failure is observed.
    expect(vi.mocked(getFeed).mock.calls.length).toBeLessThanOrEqual(5);
    for (const [options] of vi.mocked(getFeed).mock.calls) expect(options.signal?.aborted).toBe(true);
    vi.mocked(getFeed).mockResolvedValue(page([cast(1)]));
    expect((await readCustomFeed(feed)).casts).toEqual([cast(1)]);
  });

  it('rejects cancellation promptly even if an underlying transport ignores its signal, and never starts queued sources', async () => {
    const controller = new AbortController(), feed = definition({ sources: Array.from({ length: 8 }, (_, fid) => ({ kind: 'user', fid: fid + 1 })) });
    let finish!: (value: FeedResponse) => void;
    vi.mocked(getFeed).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const reading = readCustomFeed(feed, null, controller.signal), rejected = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejected; finish(page([cast(1)])); await flush(); expect(getFeed).toHaveBeenCalledTimes(4);
    await expect(readCustomFeed(feed, null, controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(getFeed).toHaveBeenCalledTimes(4);
  });

  it('bounds the aggregate deadline and reports it as a failure rather than an empty timeline', async () => {
    vi.useFakeTimers(); vi.mocked(getFeed).mockImplementation(() => new Promise(() => {}));
    const reading = readCustomFeed(definition()), rejected = expect(reading).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(25_000); await rejected;
    expect(vi.mocked(getFeed).mock.calls[0][0].signal?.aborted).toBe(true);
  });

  it('reports the bounded history cap on continuation instead of silently claiming exhaustion', async () => {
    let serial = 0; vi.mocked(getFeed).mockImplementation(async () => page([], `page-${++serial}`));
    let cursor: string | null | undefined = null;
    for (let index = 0; index < CUSTOM_FEED_SOURCE_PAGE_LIMIT; index++) cursor = (await readCustomFeed(definition(), cursor)).next.cursor;
    expect(cursor).toBeTruthy(); await expect(readCustomFeed(definition(), cursor)).rejects.toThrow('browsing limit'); expect(getFeed).toHaveBeenCalledTimes(CUSTOM_FEED_SOURCE_PAGE_LIMIT);
  });

  it('rejects malformed node pagination and invalid definitions without mistaking them for exhausted pages', async () => {
    vi.mocked(getFeed).mockResolvedValue({ casts: [cast(1)], next: { cursor: 'bad!' } });
    await expect(readCustomFeed(definition())).rejects.toThrow('Could not load');
    vi.mocked(getFeed).mockClear(); await expect(readCustomFeed({ ...definition(), sources: [] })).rejects.toThrow('recipe is invalid'); expect(getFeed).not.toHaveBeenCalled();
  });
});
