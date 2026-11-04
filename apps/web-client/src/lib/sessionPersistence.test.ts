import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifySessionChange, readSessionPersistence, subscribeSessionChanges, writeSessionPersistence } from './sessionPersistence';

afterEach(() => { vi.unstubAllGlobals(); });

describe('browser session persistence preference', () => {
  it('defaults to remembering and stores only the non-secret mode', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    expect(readSessionPersistence()).toBe('remember');
    writeSessionPersistence('tab');
    expect(readSessionPersistence()).toBe('tab');
    writeSessionPersistence('remember');
    expect(readSessionPersistence()).toBe('remember');
    expect([...values.values()]).toEqual(['remember']);
    expect(() => writeSessionPersistence('invalid' as unknown as 'tab')).toThrow('Choose either');
  });

  it('reports browser storage write failures without throwing while reading the default', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    expect(readSessionPersistence()).toBe('remember');
    expect(() => writeSessionPersistence('tab')).toThrow('Could not save this session preference');
  });

  it('broadcasts only a random event id and does not notify its own document', () => {
    class FakeBroadcastChannel {
      static channels: FakeBroadcastChannel[] = [];
      readonly listeners = new Set<(event: MessageEvent) => void>();
      constructor(readonly name: string) { FakeBroadcastChannel.channels.push(this); }
      addEventListener(_type: string, listener: (event: MessageEvent) => void) { this.listeners.add(listener); }
      postMessage(data: unknown) {
        for (const peer of FakeBroadcastChannel.channels) {
          if (peer !== this && peer.name === this.name) for (const listener of peer.listeners) listener({ data } as MessageEvent);
        }
      }
      unref() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const ownChanges = vi.fn();
    const unsubscribe = subscribeSessionChanges(ownChanges);
    const remote = new FakeBroadcastChannel('arca.hypersnap.session-changes');
    let observed: unknown;
    remote.addEventListener('message', event => { observed = event.data; });
    notifySessionChange();
    expect(ownChanges).not.toHaveBeenCalled();
    expect(observed).toEqual({ id: expect.stringMatching(/^[0-9a-f]{32}$/) });
    unsubscribe();
  });

  it('uses storage events when BroadcastChannel is unsupported and ignores malformed events', async () => {
    vi.resetModules();
    const persistence = await import('./sessionPersistence');
    vi.stubGlobal('BroadcastChannel', undefined);
    const callbacks = new Map<string, (event: StorageEvent) => void>();
    vi.stubGlobal('addEventListener', (type: string, listener: (event: StorageEvent) => void) => callbacks.set(type, listener));
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      getItem: (key: string) => values.get(key) ?? null,
    });
    const changed = vi.fn();
    const unsubscribe = persistence.subscribeSessionChanges(changed);
    persistence.notifySessionChange();
    expect(changed).not.toHaveBeenCalled();
    const storage = callbacks.get('storage')!;
    storage({ key: 'arca.hypersnap.session-change', newValue: JSON.stringify({ id: 'a'.repeat(32) }) } as StorageEvent);
    storage({ key: 'arca.hypersnap.session-change', newValue: JSON.stringify({ id: 'a'.repeat(32) }) } as StorageEvent);
    storage({ key: 'arca.hypersnap.session-change', newValue: JSON.stringify({ token: 'not-an-event-id' }) } as StorageEvent);
    expect(changed).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
