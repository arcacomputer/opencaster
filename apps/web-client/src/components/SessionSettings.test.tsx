// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionSettings from './SessionSettings';
import { deleteSavedSession, getSavedSessionMethod, type WalletSession } from '../lib/auth';
import * as sessionPersistence from '../lib/sessionPersistence';
import { readSessionPersistence } from '../lib/sessionPersistence';

vi.mock('../lib/auth', () => ({ deleteSavedSession: vi.fn(), getSavedSessionMethod: vi.fn() }));
let container: HTMLDivElement;
let root: Root;
let session: WalletSession;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.resetAllMocks(); localStorage.clear();
  vi.mocked(getSavedSessionMethod).mockResolvedValue('browser');
  session = { publicKey: 'a'.repeat(64), rememberOnDevice: vi.fn().mockResolvedValue(undefined), dispose: vi.fn() } as unknown as WalletSession;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(value: WalletSession | null = session) { await act(async () => root.render(<SessionSettings session={value} />)); }
async function click(text: string) { const button = [...container.querySelectorAll('button')].find(item => item.textContent === text)!; await act(async () => button.click()); }

describe('session lifetime settings', () => {
  it('defaults to remembered sign-in without rewriting an existing saved vault on render', async () => {
    await render(); expect(readSessionPersistence()).toBe('remember');
    expect(session.rememberOnDevice).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Anyone using this browser profile');
  });
  it('removes durable sign-in when switching to tab-only but keeps this tab active', async () => {
    const notify = vi.spyOn(sessionPersistence, 'notifySessionChange');
    await render(); await click('Tab only');
    expect(deleteSavedSession).toHaveBeenCalledWith(session.publicKey, { notify: false });
    expect(readSessionPersistence()).toBe('tab');
    expect(session.dispose).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('sign-out');
    await click('Stay signed in');
    expect(session.rememberOnDevice).toHaveBeenCalledOnce();
    expect(readSessionPersistence()).toBe('remember');
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it('keeps tab-only selected and warns when the saved key cannot be removed', async () => {
    const notify = vi.spyOn(sessionPersistence, 'notifySessionChange');
    vi.mocked(deleteSavedSession).mockRejectedValue(new Error('Storage unavailable.'));
    await render(); await click('Tab only');
    expect(readSessionPersistence()).toBe('tab');
    expect(session.dispose).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('sign-out');
    const warning = container.querySelector('[role="alert"]')?.textContent ?? '';
    expect(warning).toContain('automatic sign-in is disabled');
    expect(warning).toContain('saved key could not be removed');
    expect(warning).toContain('Clear this site’s data');
  });
  it('does not mutate the vault if saving the preference fails', async () => {
    const storage = localStorage;
    vi.stubGlobal('localStorage', {
      getItem: storage.getItem.bind(storage),
      setItem(key: string, value: string) {
        if (key === 'arca.hypersnap.session-persistence') throw new Error('Preference storage denied.');
        storage.setItem(key, value);
      },
      removeItem: storage.removeItem.bind(storage),
      clear: storage.clear.bind(storage),
      key: storage.key.bind(storage),
      get length() { return storage.length; },
    } satisfies Storage);
    const notify = vi.spyOn(sessionPersistence, 'notifySessionChange');
    await render(); await click('Tab only');
    expect(readSessionPersistence()).toBe('remember');
    expect(deleteSavedSession).not.toHaveBeenCalled();
    expect(session.rememberOnDevice).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not save this session preference');
  });
  it('does not broadcast an invalidation when a guest chooses remembered sign-in', async () => {
    const notify = vi.spyOn(sessionPersistence, 'notifySessionChange');
    await render(null); await click('Stay signed in');
    expect(readSessionPersistence()).toBe('remember');
    expect(deleteSavedSession).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
