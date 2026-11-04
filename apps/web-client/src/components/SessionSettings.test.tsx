// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionSettings from './SessionSettings';
import { deleteSavedSession, getSavedSessionMethod, type WalletSession } from '../lib/auth';
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
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<SessionSettings session={session} />)); }
async function click(text: string) { const button = [...container.querySelectorAll('button')].find(item => item.textContent === text)!; await act(async () => button.click()); }

describe('session lifetime settings', () => {
  it('defaults to remembered sign-in without rewriting an existing saved vault on render', async () => {
    await render(); expect(readSessionPersistence()).toBe('remember');
    expect(session.rememberOnDevice).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Anyone using this browser profile');
  });
  it('removes durable sign-in when switching to tab-only but keeps this tab active', async () => {
    await render(); await click('Tab only');
    expect(deleteSavedSession).toHaveBeenCalledWith(session.publicKey);
    expect(readSessionPersistence()).toBe('tab');
    expect(session.dispose).not.toHaveBeenCalled();
    await click('Stay signed in');
    expect(session.rememberOnDevice).toHaveBeenCalledOnce();
    expect(readSessionPersistence()).toBe('remember');
  });
  it('does not claim tab-only mode when the saved key cannot be removed', async () => {
    vi.mocked(deleteSavedSession).mockRejectedValue(new Error('Storage unavailable.'));
    await render(); await click('Tab only');
    expect(readSessionPersistence()).toBe('remember');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Storage unavailable');
  });
});
