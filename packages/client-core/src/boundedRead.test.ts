import { describe, expect, it, vi } from 'vitest';
import { MissingBodyError, ReadAbortedError, readLimited, SizeLimitError } from './boundedRead';

function stream(chunks: number[], cancel?: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((size, index) => controller.enqueue(new Uint8Array(size).fill(index + 1)));
      // A source that can still be cancelled stays open after its chunks.
      if (!cancel) controller.close();
    },
    cancel,
  });
}

describe('readLimited', () => {
  it('joins every chunk up to and including the limit', async () => {
    const bytes = await readLimited(stream([2, 3]), 5);
    expect([...bytes]).toEqual([1, 1, 2, 2, 2]);
  });

  it('throws for a missing body unless the caller accepts an empty result', async () => {
    await expect(readLimited(null, 5)).rejects.toBeInstanceOf(MissingBodyError);
    expect((await readLimited(null, 5, { onMissing: 'empty' })).byteLength).toBe(0);
  });

  it('cancels the reader once the limit is exceeded', async () => {
    const cancel = vi.fn();
    await expect(readLimited(stream([4, 2], cancel), 5)).rejects.toBeInstanceOf(SizeLimitError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects without reading when the signal has already aborted', async () => {
    const cancel = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(readLimited(stream([1], cancel), 5, { signal: controller.signal })).rejects.toBeInstanceOf(ReadAbortedError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects a pending read on abort even if the stream never delivers', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel });
    const pending = readLimited(body, 5, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ReadAbortedError);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
