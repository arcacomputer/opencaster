// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBrowserSession } from './useBrowserSession';
import { deleteSavedSession, restoreRememberedSession, type WalletSession } from './auth';
import { readSessionPersistence, subscribeSessionChanges } from './sessionPersistence';

vi.mock('./auth', () => ({ restoreRememberedSession: vi.fn(), deleteSavedSession: vi.fn() }));
vi.mock('./sessionPersistence', () => ({ readSessionPersistence: vi.fn(), subscribeSessionChanges: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
let state: ReturnType<typeof useBrowserSession>;
let changed: () => void;
const session = (key = 'a') => ({ publicKey: key.repeat(64), dispose: vi.fn() }) as unknown as WalletSession;
function Harness() { state = useBrowserSession(); return <p>{state.restoring ? 'restoring' : state.session?.publicKey ?? 'guest'}</p>; }
async function render() { await act(async () => root.render(<Harness />)); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.resetAllMocks();
  vi.mocked(readSessionPersistence).mockReturnValue('remember');
  vi.mocked(restoreRememberedSession).mockResolvedValue(null);
  vi.mocked(subscribeSessionChanges).mockImplementation(callback => { changed = callback; return vi.fn(); });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('remembered browser session lifecycle', () => {
  it('restores on each mount and keeps the saved vault on teardown', async () => {
    const first = session(); vi.mocked(restoreRememberedSession).mockResolvedValue(first);
    await render(); expect(state.session).toBe(first); expect(state.restoring).toBe(false);
    await act(async () => root.unmount());
    expect(first.dispose).toHaveBeenCalled(); expect(deleteSavedSession).not.toHaveBeenCalled();
    root = createRoot(container);
    const next = session(); vi.mocked(restoreRememberedSession).mockResolvedValue(next);
    await render(); expect(state.session).toBe(next);
  });
  it('does not restore a tab-only session', async () => {
    vi.mocked(readSessionPersistence).mockReturnValue('tab');
    await render(); expect(state.session).toBeNull(); expect(state.restoring).toBe(false);
    expect(restoreRememberedSession).not.toHaveBeenCalled();
  });
  it('disposes the old account immediately on a cross-tab change and restores the current saved account', async () => {
    const first = session(); const next = session('b');
    vi.mocked(restoreRememberedSession).mockResolvedValueOnce(first).mockResolvedValueOnce(next);
    await render(); await act(async () => changed());
    expect(first.dispose).toHaveBeenCalled(); expect(state.session).toBe(next);
    vi.mocked(restoreRememberedSession).mockResolvedValue(null);
    await act(async () => changed());
    expect(next.dispose).toHaveBeenCalled(); expect(state.session).toBeNull();
  });
  it('removes the remembered key before signing out', async () => {
    const first = session(); vi.mocked(restoreRememberedSession).mockResolvedValue(first);
    const deletion = deferred<void>(); vi.mocked(deleteSavedSession).mockReturnValue(deletion.promise);
    await render();
    let signingOut!: Promise<void>;
    await act(async () => { signingOut = state.signOut(first); });
    expect(state.session).toBe(first);
    await act(async () => { deletion.resolve(); await signingOut; });
    expect(deleteSavedSession).toHaveBeenCalledWith(first.publicKey);
    expect(state.session).toBeNull(); expect(first.dispose).toHaveBeenCalled();
  });
  it('rejects a late restore after an explicit replacement session', async () => {
    const restoring = deferred<WalletSession | null>();
    vi.mocked(restoreRememberedSession).mockReturnValue(restoring.promise);
    await render(); const next = session('b'); const late = session();
    await act(async () => state.setSession(next));
    await act(async () => restoring.resolve(late));
    expect(state.session).toBe(next); expect(late.dispose).toHaveBeenCalled();
  });
  it('preserves the vault on network failure and allows retry', async () => {
    vi.mocked(restoreRememberedSession).mockRejectedValueOnce(new Error('Network unavailable.'));
    await render(); expect(state.restoreError).toBe('Network unavailable.');
    expect(deleteSavedSession).not.toHaveBeenCalled();
    const next = session(); vi.mocked(restoreRememberedSession).mockResolvedValue(next);
    await act(async () => state.retryRestore());
    expect(state.session).toBe(next); expect(state.restoreError).toBe('');
  });
});
