import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCast, type Cast, type User } from './api';
import { createParentCastReader } from './parentCastReader';

vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), getCast: vi.fn() }));
const user = (fid: number): User => ({ fid, username: `person${fid}`, custody_address: '', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 });
const cast = (index: number): Cast => ({ hash: `0x${index.toString(16).padStart(40, '0')}`, author: user(index + 1), text: `Cast ${index}`, timestamp: '2026-10-24T12:00:00.000Z', embeds: [], reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 } });
afterEach(() => vi.resetAllMocks());
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('shared public parent cast reads', () => {
  it('permits at most four active transports and starts queued reads as slots become available', async () => {
    const reader = createParentCastReader();
    const finishes: Array<() => void> = [];
    let active = 0, maximum = 0;
    vi.mocked(getCast).mockImplementation((hash) => new Promise(resolve => {
      active++; maximum = Math.max(maximum, active);
      finishes.push(() => { active--; resolve(cast(Number.parseInt(hash.slice(2), 16))); });
    }));
    const reads = [1, 2, 3, 4, 5, 6].map(index => reader.read(cast(index).hash));
    expect(getCast).toHaveBeenCalledTimes(4);
    finishes[0](); await flush(); expect(getCast).toHaveBeenCalledTimes(5);
    finishes[1](); await flush(); expect(getCast).toHaveBeenCalledTimes(6);
    for (const finish of finishes.slice(2)) finish();
    expect((await Promise.all(reads)).map(value => value.hash)).toEqual([1, 2, 3, 4, 5, 6].map(index => cast(index).hash));
    expect(maximum).toBe(4);
  });

  it('deduplicates normalized in-flight hashes and reuses validated success', async () => {
    const reader = createParentCastReader(), parent = cast(10);
    let finish!: (value: Cast) => void;
    vi.mocked(getCast).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = reader.read(parent.hash), second = reader.read(parent.hash.slice(2).toUpperCase());
    expect(getCast).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getCast).mock.calls[0][0]).toBe(parent.hash);
    finish(parent);
    await expect(Promise.all([first, second])).resolves.toEqual([parent, parent]);
    await expect(reader.read(parent.hash)).resolves.toBe(parent);
    expect(getCast).toHaveBeenCalledTimes(1);
  });

  it('cancels one subscriber independently while another continues the same transport', async () => {
    const reader = createParentCastReader(), parent = cast(1), controller = new AbortController();
    let finish!: (value: Cast) => void;
    vi.mocked(getCast).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = reader.read(parent.hash, controller.signal), second = reader.read(parent.hash);
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejected;
    expect(vi.mocked(getCast).mock.calls[0][1]?.aborted).toBe(false);
    finish(parent); await expect(second).resolves.toBe(parent);
    expect(getCast).toHaveBeenCalledTimes(1);
  });

  it('drops queued requests when their last subscriber leaves', async () => {
    const reader = createParentCastReader(), controller = new AbortController();
    const finishes: Array<() => void> = [];
    vi.mocked(getCast).mockImplementation(hash => new Promise(resolve => { finishes.push(() => resolve(cast(Number.parseInt(hash.slice(2), 16)))); }));
    const active = [1, 2, 3, 4].map(index => reader.read(cast(index).hash));
    const queued = reader.read(cast(5).hash, controller.signal);
    const rejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejected;
    finishes.forEach(finish => finish()); await Promise.all(active);
    expect(getCast).toHaveBeenCalledTimes(4);
  });

  it('aborts a transport after its last subscriber leaves and ignores a late success', async () => {
    const reader = createParentCastReader(), parent = cast(1), controller = new AbortController();
    let finish!: (value: Cast) => void;
    vi.mocked(getCast).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(parent);
    const first = reader.read(parent.hash, controller.signal);
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejected;
    expect(vi.mocked(getCast).mock.calls[0][1]?.aborted).toBe(true);
    finish(parent); await flush();
    await expect(reader.read(parent.hash)).resolves.toBe(parent);
    expect(getCast).toHaveBeenCalledTimes(2);
  });

  it.each([
    { label: 'hash', invalid: cast(9) },
    { label: 'FID', invalid: { ...cast(1), author: user(0) } },
    { label: 'text', invalid: { ...cast(1), text: undefined } as unknown as Cast },
  ])('does not cache a response with invalid $label', async ({ invalid }) => {
    const reader = createParentCastReader(); vi.mocked(getCast).mockResolvedValue(invalid);
    await expect(reader.read(cast(1).hash)).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(reader.read(cast(1).hash)).rejects.toMatchObject({ code: 'invalid_response' });
    expect(getCast).toHaveBeenCalledTimes(2);
  });

  it('does not cache unavailable responses, allowing an explicit later retry', async () => {
    const reader = createParentCastReader(), parent = cast(1);
    vi.mocked(getCast).mockRejectedValueOnce(new Error('Parent unavailable.')).mockResolvedValue(parent);
    await expect(reader.read(parent.hash)).rejects.toThrow('Parent unavailable.');
    await expect(reader.read(parent.hash)).resolves.toBe(parent);
    expect(getCast).toHaveBeenCalledTimes(2);
  });

  it('bounds success caching to 128 casts and keeps recently used entries', async () => {
    const reader = createParentCastReader();
    vi.mocked(getCast).mockImplementation(async hash => cast(Number.parseInt(hash.slice(2), 16)));
    for (let index = 1; index <= 128; index++) await reader.read(cast(index).hash);
    await reader.read(cast(1).hash); // Keep the first entry recently used.
    await reader.read(cast(129).hash);
    await reader.read(cast(1).hash);
    expect(getCast).toHaveBeenCalledTimes(129);
    await reader.read(cast(2).hash);
    expect(getCast).toHaveBeenCalledTimes(130);
  });

  it('clears pending work and remains reusable after effect cleanup and replay', async () => {
    const reader = createParentCastReader();
    vi.mocked(getCast).mockImplementation((_hash, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true })));
    const reads = [1, 2, 3, 4, 5].map(index => reader.read(cast(index).hash));
    const rejected = Promise.all(reads.map(read => expect(read).rejects.toMatchObject({ name: 'AbortError' })));
    reader.dispose(); await rejected;
    expect(getCast).toHaveBeenCalledTimes(4);
    expect(vi.mocked(getCast).mock.calls.every(([, signal]) => signal?.aborted)).toBe(true);
    vi.mocked(getCast).mockResolvedValue(cast(6));
    await expect(reader.read(cast(6).hash)).resolves.toEqual(cast(6));
    expect(getCast).toHaveBeenCalledTimes(5);
  });

  it('does not let cancelled old requests erase a new shared request for the same parent', async () => {
    const reader = createParentCastReader(), parent = cast(1), controller = new AbortController();
    let finishOld!: (value: Cast) => void, finishNew!: (value: Cast) => void;
    vi.mocked(getCast).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
    const old = reader.read(parent.hash, controller.signal);
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejected;
    const fresh = reader.read(parent.hash); finishOld(parent); await flush();
    const shared = reader.read(parent.hash);
    expect(getCast).toHaveBeenCalledTimes(2);
    finishNew(parent); await expect(Promise.all([fresh, shared])).resolves.toEqual([parent, parent]);
  });

  it('rejects invalid hashes and already cancelled callers without a transport read', async () => {
    const reader = createParentCastReader(), controller = new AbortController(); controller.abort();
    await expect(reader.read('invalid')).rejects.toThrow('Invalid cast hash.');
    await expect(reader.read(cast(1).hash, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(getCast).not.toHaveBeenCalled();
  });
});
