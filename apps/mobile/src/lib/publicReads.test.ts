import type { Cast, FeedResponse } from '@opencaster/client-core/api';
import { describe, expect, it, vi } from 'vitest';
import { CastPageController } from './publicReads';

function cast(hash: string): Cast {
  return {
    hash,
    author: { fid: 1 } as Cast['author'],
    text: `Cast ${hash}`,
    timestamp: '2026-10-01T12:00:00Z',
    embeds: [],
    reactions: { likes_count: 0, recasts_count: 0 },
    replies: { count: 0 },
  };
}

function page(casts: Cast[], cursor: string | null = null): FeedResponse {
  return { casts, next: { cursor } };
}

describe('CastPageController', () => {
  it('deduplicates cast hashes and stops when a cursor repeats', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(page([cast('0xAA'), cast('0xaa')], 'next'))
      .mockResolvedValueOnce(page([cast('0xaa'), cast('0xbb')], 'next'));
    const controller = new CastPageController(read);

    await controller.refresh();
    await controller.loadMore();

    expect(controller.getSnapshot().casts.map(item => item.hash)).toEqual(['0xAA', '0xbb']);
    expect(controller.getSnapshot().nextCursor).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('preserves current casts and allows retry after a pagination error', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(page([cast('first')], 'page-2'))
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(page([cast('second')]));
    const controller = new CastPageController(read);

    await controller.refresh();
    await controller.loadMore();
    expect(controller.getSnapshot()).toMatchObject({
      casts: [cast('first')],
      nextCursor: 'page-2',
      retryKind: 'page',
      error: 'temporary failure',
    });

    await controller.retry();
    expect(controller.getSnapshot().casts.map(item => item.hash)).toEqual(['first', 'second']);
    expect(controller.getSnapshot().error).toBeNull();
  });

  it('ignores a response that completes after cancellation', async () => {
    let resolve!: (result: FeedResponse) => void;
    const read = vi.fn(() => new Promise<FeedResponse>(done => { resolve = done; }));
    const controller = new CastPageController(read);
    const pending = controller.refresh();
    controller.cancel();
    resolve(page([cast('stale')]));
    await pending;

    expect(controller.getSnapshot().casts).toEqual([]);
    expect(controller.getSnapshot().phase).toBe('loading');
  });

  it.each(['immediate', 'deferred'] as const)('clears refreshing and retains casts after a %s rejection, then retries the first page', async timing => {
    let reject!: (error: Error) => void;
    const failure = new Error('Network request failed');
    const read = vi.fn()
      .mockResolvedValueOnce(page([cast('first')], 'page-2'))
      .mockImplementationOnce(() => timing === 'immediate'
        ? Promise.reject(failure)
        : new Promise<FeedResponse>((_, fail) => { reject = fail; }))
      .mockResolvedValueOnce(page([cast('recovered')]));
    const controller = new CastPageController(read);
    await controller.refresh();

    const refreshingStates: boolean[] = [];
    const unsubscribe = controller.subscribe(() => refreshingStates.push(controller.getSnapshot().refreshing));
    const pending = controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({ refreshing: true, casts: [cast('first')] });
    if (timing === 'deferred') reject(failure);
    await pending;

    expect(refreshingStates).toContain(true);
    expect(refreshingStates.at(-1)).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      refreshing: false,
      loadingMore: false,
      casts: [cast('first')],
      nextCursor: 'page-2',
      error: 'Network request failed',
      retryKind: 'refresh',
    });

    await controller.retry();
    expect(read.mock.calls.map(([cursor]) => cursor)).toEqual([null, null, null]);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      refreshing: false,
      casts: [cast('recovered')],
      nextCursor: null,
      error: null,
      retryKind: null,
    });
    unsubscribe();
  });

  it('stops pagination at the configured page limit but still allows refresh', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(page([cast('first')], 'page-2'))
      .mockResolvedValueOnce(page([cast('second')], 'page-3'))
      .mockResolvedValueOnce(page([cast('refreshed')], 'page-2'));
    const controller = new CastPageController(read, 2);

    await controller.refresh();
    await controller.loadMore();

    expect(read).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().nextCursor).toBeNull();

    await controller.refresh();
    expect(read).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot().casts.map(item => item.hash)).toEqual(['refreshed']);
    expect(controller.getSnapshot().nextCursor).toBe('page-2');
  });
});
