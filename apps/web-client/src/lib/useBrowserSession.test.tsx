// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBrowserSession } from './useBrowserSession';
import { deleteSavedSession, restoreRememberedSession, type WalletSession } from './auth';
import { notifySessionChange, readSessionPersistence, subscribeSessionChanges, type SessionChangeKind } from './sessionPersistence';

vi.mock('./auth', () => ({ restoreRememberedSession: vi.fn(), deleteSavedSession: vi.fn() }));
vi.mock('./sessionPersistence', () => ({ notifySessionChange: vi.fn(), readSessionPersistence: vi.fn(), subscribeSessionChanges: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
let state: ReturnType<typeof useBrowserSession>;
let changed: (kind: SessionChangeKind) => void;
const session = (key = 'a') => ({ publicKey: key.repeat(64), dispose: vi.fn() }) as unknown as WalletSession;
function Harness() { state = useBrowserSession(); return <p>{state.restoring ? 'restoring' : state.session?.publicKey ?? 'guest'}</p>; }
async function render() { await act(async () => root.render(<Harness />)); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
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
    await render(); await act(async () => changed('vault'));
    expect(first.dispose).toHaveBeenCalled(); expect(state.session).toBe(next);
    vi.mocked(restoreRememberedSession).mockResolvedValue(null);
    await act(async () => changed('vault'));
    expect(next.dispose).toHaveBeenCalled(); expect(state.session).toBeNull();
  });
  it('ends the local session before waiting for remembered-key removal', async () => {
    const first = session(); vi.mocked(restoreRememberedSession).mockResolvedValue(first);
    const deletion = deferred<void>(); vi.mocked(deleteSavedSession).mockReturnValue(deletion.promise);
    await render();
    let signingOut!: Promise<void>;
    await act(async () => { signingOut = state.signOut(first); });
    expect(state.session).toBeNull(); expect(first.dispose).toHaveBeenCalled();
    expect(notifySessionChange).toHaveBeenCalledWith('sign-out');
    await act(async () => { deletion.resolve(); await signingOut; });
    expect(deleteSavedSession).toHaveBeenCalledWith(first.publicKey, { notify: false });
    expect(state.session).toBeNull();
  });
  it('keeps the local sign-out and warns when the saved key cannot be removed', async () => {
    const first = session(); vi.mocked(restoreRememberedSession).mockResolvedValue(first);
    vi.mocked(deleteSavedSession).mockRejectedValue(new Error('IndexedDB unavailable.'));
    await render();
    let failure: unknown;
    await act(async () => { try { await state.signOut(first); } catch (cause) { failure = cause; } });
    expect(state.session).toBeNull(); expect(first.dispose).toHaveBeenCalledOnce();
    expect(notifySessionChange).toHaveBeenCalledWith('sign-out');
    expect(deleteSavedSession).toHaveBeenCalledWith(first.publicKey, { notify: false });
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('active session has ended');
    expect((failure as Error).message).toContain('Clear this site’s data');
    expect(restoreRememberedSession).toHaveBeenCalledOnce();
  });
  it('does not let a pending sign-out clear a newer unrelated session', async () => {
    const first = session(); const next = session('b');
    vi.mocked(restoreRememberedSession).mockResolvedValue(first);
    const deletion = deferred<void>(); vi.mocked(deleteSavedSession).mockReturnValue(deletion.promise);
    await render();
    let signingOut!: Promise<void>;
    await act(async () => { signingOut = state.signOut(first); });
    await act(async () => state.setSession(next));
    await act(async () => { deletion.resolve(); await signingOut; });
    expect(state.session).toBe(next);
    expect(deleteSavedSession).toHaveBeenCalledWith(first.publicKey, { notify: false });
  });
  it('clears a remote sign-out without trying to restore the saved key', async () => {
    const first = session(); vi.mocked(restoreRememberedSession).mockResolvedValue(first);
    await render();
    await act(async () => changed('sign-out'));
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(state.session).toBeNull();
    expect(restoreRememberedSession).toHaveBeenCalledOnce();
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
