import { describe, expect, it, vi } from 'vitest';
import { decodeHiddenContent, isHiddenTarget, LocalContent, MAX_HIDDEN_ITEMS, MAX_LOCAL_CONTENT_BYTES } from './localContent';

const HASH = 'ab'.repeat(20);

function storage(initial: string | null = null) {
  let value = initial;
  return { read: vi.fn(async () => value), write: vi.fn(async (next: string) => { value = next; }) };
}

describe('LocalContent', () => {
  it('persists canonical user/cast filters across restart and restores each independently', async () => {
    const disk = storage();
    const controller = new LocalContent(disk);
    expect(controller.getSnapshot().phase).toBe('loading');
    await controller.load();
    await controller.hideCast(`0x${HASH.toUpperCase()}`);
    await controller.hideCast(HASH);
    await controller.hideUser(3);
    const restarted = new LocalContent(disk);
    await restarted.load();
    expect(restarted.getSnapshot().data).toEqual({ version: 1, users: [3], casts: [HASH] });
    expect(isHiddenTarget(restarted.getSnapshot().data, { fid: 4, hash: `0x${HASH}` })).toBe(true);
    expect(isHiddenTarget(restarted.getSnapshot().data, { fid: 3, hash: 'cd'.repeat(20) })).toBe(true);
    await restarted.restoreCast(HASH);
    expect(isHiddenTarget(restarted.getSnapshot().data, { fid: 3, hash: HASH })).toBe(true);
    await restarted.restoreUser(3);
    expect(isHiddenTarget(restarted.getSnapshot().data, { fid: 3, hash: HASH })).toBe(false);
  });

  it('fails closed on unreadable/corrupt preferences until explicit reset succeeds', async () => {
    const disk = storage('{broken');
    const controller = new LocalContent(disk);
    await controller.load();
    expect(controller.getSnapshot().phase).toBe('error');
    await controller.hideUser(3);
    expect(disk.write).not.toHaveBeenCalled();
    await controller.reset();
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', busy: false, data: { users: [], casts: [] } });
    const restarted = new LocalContent(disk);
    await restarted.load();
    expect(restarted.getSnapshot().phase).toBe('ready');
  });

  it('does not claim a failed save or reset succeeded; retries persisted state', async () => {
    const disk = storage(JSON.stringify({ version: 1, users: [3], casts: [] }));
    const controller = new LocalContent(disk);
    await controller.load();
    disk.write.mockRejectedValueOnce(new Error('disk full'));
    await controller.reset();
    expect(controller.getSnapshot()).toMatchObject({ phase: 'error', data: { users: [3] } });
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', data: { users: [3] } });
  });

  it('serializes operations by refusing another mutation while a save is pending', async () => {
    let finish!: () => void;
    const disk = storage();
    const controller = new LocalContent(disk);
    await controller.load();
    disk.write.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = controller.hideUser(3);
    await controller.reset();
    expect(controller.getSnapshot().busy).toBe(true);
    expect(disk.write).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().data.users).toEqual([]);
    finish();
    await pending;
    expect(controller.getSnapshot().data.users).toEqual([3]);
  });

  it('bounds saved data and refuses malformed identifiers or schemas', () => {
    for (const value of [
      ' '.repeat(MAX_LOCAL_CONTENT_BYTES + 1),
      JSON.stringify({ version: 2, users: [], casts: [] }),
      JSON.stringify({ version: 1, users: [0], casts: [] }),
      JSON.stringify({ version: 1, users: [0x100000000], casts: [] }),
      JSON.stringify({ version: 1, users: [], casts: ['invalid'] }),
      JSON.stringify({ version: 1, users: [], casts: [], extra: true }),
      JSON.stringify({ version: 1, users: Array.from({ length: MAX_HIDDEN_ITEMS + 1 }, (_, i) => i + 1), casts: [] }),
    ]) expect(() => decodeHiddenContent(value)).toThrow();
  });
});
