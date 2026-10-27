import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCast, type Cast, type User } from './api';
import { getCastAncestors, matchesParentCast, parentCastReference } from './castContext';

vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), getCast: vi.fn() }));
const user = (fid: number): User => ({ fid, username: `person${fid}`, custody_address: '', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 });
const cast = (index: number, extra: Partial<Cast> = {}): Cast => ({ hash: `0x${index.toString(16).padStart(40, '0')}`, author: user(index + 1), text: `Cast ${index}`, timestamp: '2026-10-24T12:00:00.000Z', embeds: [], reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 }, ...extra });
const reply = (index: number, parent: Cast): Cast => cast(index, { parent_hash: parent.hash, parent_author: { fid: parent.author.fid } });
function serve(casts: Cast[]) {
  const byHash = new Map(casts.map(value => [value.hash, value]));
  vi.mocked(getCast).mockImplementation(async hash => {
    const found = byHash.get(hash);
    if (!found) throw new Error('Public cast unavailable.');
    return found;
  });
}
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

describe('cast reply context', () => {
  it('normalizes parent hashes and checks the exact hash and expected author', () => {
    const parent = cast(10);
    const child = reply(11, parent);
    child.parent_hash = parent.hash.slice(2).toUpperCase();
    expect(parentCastReference(child)).toEqual({ hash: parent.hash, fid: parent.author.fid });
    expect(matchesParentCast(child, parent)).toBe(true);
    expect(matchesParentCast(child, cast(12))).toBe(false);
    expect(matchesParentCast(child, { ...parent, author: user(99) })).toBe(false);
    expect(matchesParentCast({ parent_hash: parent.hash }, parent)).toBe(true);
    expect(matchesParentCast(child, { ...parent, author: user(0) })).toBe(false);
  });

  it('returns a channel root immediately without treating its URL as a reply', async () => {
    expect(await getCastAncestors(cast(1, { parent_url: 'https://example.test/channel' }))).toEqual({ ancestors: [], status: 'complete' });
    expect(getCast).not.toHaveBeenCalled();
  });

  it('reads exact parent casts once and returns the oldest parent first', async () => {
    const oldest = cast(1), parent = reply(2, oldest), selected = reply(3, parent);
    const original = JSON.stringify([oldest, parent, selected]);
    const controller = new AbortController(); serve([oldest, parent]);
    expect(await getCastAncestors(selected, controller.signal)).toEqual({ ancestors: [oldest, parent], status: 'complete' });
    expect(vi.mocked(getCast).mock.calls.map(([hash]) => hash)).toEqual([parent.hash, oldest.hash]);
    const readSignal = vi.mocked(getCast).mock.calls[0][1]!;
    expect(readSignal.aborted).toBe(false);
    expect(vi.mocked(getCast).mock.calls[1][1]).toBe(readSignal);
    expect(JSON.stringify([oldest, parent, selected])).toBe(original);
  });

  it('keeps verified nearer parents when older context is unavailable', async () => {
    const oldest = cast(1), parent = reply(2, oldest), selected = reply(3, parent);
    serve([parent]);
    expect(await getCastAncestors(selected)).toEqual({ ancestors: [parent], status: 'unavailable' });
  });

  it('uses a supplied bounded parent reader for ancestry', async () => {
    const parent = cast(1), readCast = vi.fn().mockResolvedValue(parent);
    await expect(getCastAncestors(reply(2, parent), undefined, { readCast })).resolves.toEqual({ ancestors: [parent], status: 'complete' });
    expect(readCast).toHaveBeenCalledWith(parent.hash, expect.any(AbortSignal));
    expect(getCast).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'hash', changed: cast(9) },
    { label: 'author', changed: { ...cast(1), author: user(99) } },
    { label: 'text', changed: { ...cast(1), text: undefined } as unknown as Cast },
  ])('discards an invalid parent $label without hiding the selected cast', async ({ changed }) => {
    const selected = reply(2, cast(1));
    vi.mocked(getCast).mockResolvedValue(changed);
    expect(await getCastAncestors(selected)).toEqual({ ancestors: [], status: 'unavailable' });
  });

  it.each(['unsafe', 'https://example.test/', '0x' + 'a'.repeat(41), 123])('does not fetch an invalid parent hash %j', async parent_hash => {
    const selected = cast(2, { parent_hash } as Partial<Cast>);
    expect(parentCastReference(selected)).toBeUndefined();
    expect(await getCastAncestors(selected)).toEqual({ ancestors: [], status: 'unavailable' });
    expect(getCast).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, '12'])('does not fetch context with an invalid expected author %j', async fid => {
    const selected = reply(2, cast(1)); selected.parent_author = { fid } as Cast['parent_author'];
    expect(parentCastReference(selected)).toBeUndefined();
    expect(await getCastAncestors(selected)).toEqual({ ancestors: [], status: 'unavailable' });
    expect(getCast).not.toHaveBeenCalled();
  });

  it('permits the node to omit the expected parent author', async () => {
    const parent = cast(1), selected = reply(2, parent); delete selected.parent_author;
    serve([parent]);
    expect(await getCastAncestors(selected)).toEqual({ ancestors: [parent], status: 'complete' });
  });

  it('bounds ancestor requests to eight by default and leaves older context available for navigation', async () => {
    const ancestors = [cast(1)];
    for (let index = 2; index <= 10; index++) ancestors.push(reply(index, ancestors[index - 2]));
    serve(ancestors);
    expect(await getCastAncestors(ancestors[9])).toEqual({ ancestors: ancestors.slice(1, 9), status: 'limited' });
    expect(getCast).toHaveBeenCalledTimes(8);
  });

  it('reports complete when the oldest root is exactly at the configured limit', async () => {
    const oldest = cast(1), parent = reply(2, oldest), selected = reply(3, parent); serve([oldest, parent]);
    expect(await getCastAncestors(selected, undefined, { limit: 2 })).toEqual({ ancestors: [oldest, parent], status: 'complete' });
  });

  it('stops cycles before reading the selected cast again', async () => {
    const parent = cast(1), selected = reply(2, parent);
    parent.parent_hash = selected.hash.toUpperCase().replace(/^0X/, '0x'); parent.parent_author = { fid: selected.author.fid };
    serve([parent, selected]);
    expect(await getCastAncestors(selected)).toEqual({ ancestors: [parent], status: 'unavailable' });
    expect(getCast).toHaveBeenCalledTimes(1);
  });

  it('stops a self-referencing cast without making a request', async () => {
    const selected = cast(1); selected.parent_hash = selected.hash;
    expect(await getCastAncestors(selected)).toEqual({ ancestors: [], status: 'unavailable' });
    expect(getCast).not.toHaveBeenCalled();
  });

  it('propagates cancellation before any read', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(getCastAncestors(reply(2, cast(1)), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(getCast).not.toHaveBeenCalled();
  });

  it('ignores a parent returned after cancellation and never schedules an older read', async () => {
    const oldest = cast(1), parent = reply(2, oldest), selected = reply(3, parent);
    const controller = new AbortController();
    let finish!: (value: Cast) => void;
    vi.mocked(getCast).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = getCastAncestors(selected, controller.signal);
    controller.abort(); finish(parent);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(getCast).toHaveBeenCalledTimes(1);
  });

  it('propagates caller cancellation immediately and aborts the pending transport', async () => {
    const controller = new AbortController();
    vi.mocked(getCast).mockImplementation(() => new Promise(() => {}));
    const pending = getCastAncestors(reply(2, cast(1)), controller.signal);
    const readSignal = vi.mocked(getCast).mock.calls[0][1]!;
    const reason = new DOMException('Leaving this conversation.', 'AbortError');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(readSignal.aborted).toBe(true);
    expect(readSignal.reason).toBe(reason);
  });

  it('limits the entire ancestry walk to 20 seconds and retains verified partial parents', async () => {
    vi.useFakeTimers();
    const oldest = cast(1), parent = reply(2, oldest), selected = reply(3, parent);
    let finishLate!: (value: Cast) => void;
    vi.mocked(getCast).mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 15_000));
      return parent;
    }).mockImplementationOnce(() => new Promise(resolve => { finishLate = resolve; }));
    const controller = new AbortController();
    const pending = getCastAncestors(selected, controller.signal);
    let settled = false; void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(getCast).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result).toEqual({ ancestors: [parent], status: 'unavailable' });
    expect(vi.mocked(getCast).mock.calls[1][1]?.aborted).toBe(true);
    expect(controller.signal.aborted).toBe(false);
    finishLate(oldest); await Promise.resolve();
    expect(result).toEqual({ ancestors: [parent], status: 'unavailable' });
    expect(getCast).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up the whole-chain timer and caller listener after successful ancestry reads', async () => {
    vi.useFakeTimers();
    const parent = cast(1), controller = new AbortController(); serve([parent]);
    await expect(getCastAncestors(reply(2, parent), controller.signal)).resolves.toEqual({ ancestors: [parent], status: 'complete' });
    const readSignal = vi.mocked(getCast).mock.calls[0][1]!;
    expect(vi.getTimerCount()).toBe(0);
    controller.abort();
    expect(readSignal.aborted).toBe(false);
  });

  it('propagates a cancelled parent read instead of presenting an unavailable cast', async () => {
    vi.mocked(getCast).mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    await expect(getCastAncestors(reply(2, cast(1)))).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each([0, -1, 33, 1.5])('rejects an unsafe ancestry limit %j before reading', async limit => {
    await expect(getCastAncestors(reply(2, cast(1)), undefined, { limit })).rejects.toThrow('between 1 and 32');
    expect(getCast).not.toHaveBeenCalled();
  });
});
