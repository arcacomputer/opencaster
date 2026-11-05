/** The body exceeded the caller's byte limit. Its reader was cancelled. */
export class SizeLimitError extends Error {}
/** The caller's signal aborted before the body completed. Its reader was cancelled. */
export class ReadAbortedError extends Error {}
/** No body was present and the caller did not accept an empty result. */
export class MissingBodyError extends Error {}

export interface ReadLimitedOptions {
  signal?: AbortSignal;
  /** `empty` returns zero bytes for a null body; the default throws MissingBodyError. */
  onMissing?: 'throw' | 'empty';
}

/** Read a whole stream without exceeding `limit` bytes. An abort rejects
 * immediately even if the stream ignores cancellation, and cancellation is
 * never awaited: a transport or cache backend can hang in its cancel hook. */
export async function readLimited(
  body: ReadableStream<Uint8Array> | null | undefined,
  limit: number,
  { signal, onMissing = 'throw' }: ReadLimitedOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) {
    if (onMissing === 'empty') return new Uint8Array();
    throw new MissingBodyError();
  }
  const reader = body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  let rejectAborted: (error: ReadAbortedError) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject; });
  aborted.catch(() => undefined);
  const abort = () => { cancel(); rejectAborted(new ReadAbortedError()); };
  signal?.addEventListener('abort', abort, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      if (signal?.aborted) { cancel(); throw new ReadAbortedError(); }
      const { value, done } = await (signal ? Promise.race([reader.read(), aborted]) : reader.read());
      if (signal?.aborted) throw new ReadAbortedError();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { cancel(); throw new SizeLimitError(); }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    // A read abandoned after abort can still hold the lock in older runtimes;
    // the reader is already cancelled, so releasing it is best-effort.
    try { reader.releaseLock(); } catch { /* already cancelled */ }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
