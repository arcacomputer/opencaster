// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError, type Cast } from '@opencaster/client-core/api';
import type { WalletSession } from '../lib/auth';
import { FULL_CLIENT_SCOPES, FULL_SOCIAL_SCOPES } from '@opencaster/client-core/pairing';
import DeleteCastDialog from './DeleteCastDialog';

const cast = { hash: `0x${'ab'.repeat(20)}`, text: 'Synthetic <cast>', author: { fid: 1234, username: 'test' } } as Cast;
function render(session: WalletSession | null) {
  const onEnable = vi.fn(); const onDeleted = vi.fn();
  const html = renderToStaticMarkup(<DeleteCastDialog cast={cast} session={session} onEnable={onEnable} onDeleted={onDeleted} onClose={() => {}} />);
  expect(onEnable).not.toHaveBeenCalled(); expect(onDeleted).not.toHaveBeenCalled();
  return html;
}
function session(fid: number, scopes: readonly number[]): WalletSession { return { fid, publicKey: 'synthetic-public-key', scopes } as WalletSession; }

describe('explicit own-cast deletion review', () => {
  it('requires sign-in and never exposes a deletion action to guests', () => {
    const html = render(null);
    expect(html).toContain('Connect wallet');
    expect(html).not.toContain('delete-cast-confirm');
  });
  it('requires a new explicit deletion permission for a legacy social device', () => {
    const html = render(session(1234, FULL_SOCIAL_SCOPES));
    expect(html).toContain('Enable deletion');
    expect(html).toContain('then confirm deletion here');
    expect(html).not.toContain('delete-cast-confirm');
  });
  it('does not offer approval or deletion for another account’s cast', () => {
    const html = render(session(4321, FULL_CLIENT_SCOPES));
    expect(html).toContain('You can delete only casts published by your own account.');
    expect(html).not.toContain('Enable deletion');
    expect(html).not.toContain('delete-cast-confirm');
  });
  it('offers an explicit final confirmation for the authorized owner and discloses remaining copies and images', () => {
    const html = render(session(1234, FULL_CLIENT_SCOPES));
    expect(html).toContain('delete-cast-confirm');
    expect(html).toContain('cannot be undone');
    expect(html).toContain('copies may remain');
    expect(html).toContain('Uploaded images remain public');
    expect(html).toContain('Synthetic &lt;cast&gt;');
    expect(html).not.toContain('Enable deletion');
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolveValue => { resolve = resolveValue; });
  return { promise, resolve };
}

describe('asynchronous deletion review and account changes', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onEnable: ReturnType<typeof vi.fn>;
  let onDeleted: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    onEnable = vi.fn(); onDeleted = vi.fn(); onClose = vi.fn();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });
  function connected(publicKey = 'first-synthetic-key', fid = cast.author.fid, scopes: readonly number[] = FULL_CLIENT_SCOPES) {
    const deleteCast = vi.fn<WalletSession['deleteCast']>().mockResolvedValue({ hash: 'cd'.repeat(20) });
    return { session: { publicKey, fid, scopes, deleteCast } as unknown as WalletSession, deleteCast };
  }
  async function view(selected: WalletSession, target: Cast = cast) {
    await act(async () => root.render(<DeleteCastDialog cast={target} session={selected} onEnable={onEnable} onDeleted={onDeleted} onClose={onClose} />));
  }
  function button(label: string) { return [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === label); }
  async function click(element: Element) { await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }); }

  it('requires another explicit confirmation after deletion permission is approved', async () => {
    const original = connected('original-social-key', cast.author.fid, FULL_SOCIAL_SCOPES);
    await view(original.session);
    await click(button('Enable deletion')!);
    expect(onEnable).toHaveBeenCalledOnce(); expect(original.deleteCast).not.toHaveBeenCalled();
    const expanded = connected('new-deletion-key');
    await view(expanded.session);
    expect(expanded.deleteCast).not.toHaveBeenCalled(); expect(onDeleted).not.toHaveBeenCalled();
    await click(button('Delete cast')!);
    expect(expanded.deleteCast).toHaveBeenCalledExactlyOnceWith({ fid: cast.author.fid, hash: cast.hash });
    expect(onDeleted).toHaveBeenCalledExactlyOnceWith(cast);
  });

  it('blocks dismissal and duplicate submissions while waiting for confirmed removal', async () => {
    const account = connected(); const pending = deferred<{ hash: string }>();
    account.deleteCast.mockReturnValueOnce(pending.promise);
    await view(account.session);
    await click(button('Delete cast')!);
    expect(button('Checking deletion…')?.disabled).toBe(true);
    expect(button('Cancel')?.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Keep this dialog open');
    await click(container.querySelector('[aria-label="Close dialog"]')!);
    const dialog = container.querySelector('dialog')!;
    await click(dialog);
    const escape = new Event('cancel', { bubbles: false, cancelable: true });
    await act(async () => { dialog.dispatchEvent(escape); });
    expect(escape.defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled(); expect(onDeleted).not.toHaveBeenCalled();
    expect(account.deleteCast).toHaveBeenCalledOnce();
    await act(async () => pending.resolve({ hash: 'cd'.repeat(20) }));
    expect(onDeleted).toHaveBeenCalledExactlyOnceWith(cast);
  });

  it('offers only an explicit status check for an uncertain deletion and never retries automatically', async () => {
    const account = connected();
    account.deleteCast.mockRejectedValueOnce(new ApiError('Status is unknown.', 504, 'submission_unknown'));
    await view(account.session);
    await click(button('Delete cast')!);
    expect(account.deleteCast).toHaveBeenCalledOnce(); expect(onDeleted).not.toHaveBeenCalled();
    expect(button('Delete cast')).toBeUndefined(); expect(button('Check deletion status')).toBeDefined();
    expect(container.textContent).toContain('will not submit another deletion');
    await click(button('Check deletion status')!);
    expect(account.deleteCast).toHaveBeenCalledTimes(2);
    expect(account.deleteCast.mock.calls[1][0]).toEqual({ fid: cast.author.fid, hash: cast.hash });
    expect(onDeleted).toHaveBeenCalledExactlyOnceWith(cast);
  });

  it.each([{ nextKey: 'replacement-key', nextFid: 1234 }, { nextKey: 'another-account-key', nextFid: 4321 }])('ignores stale confirmed removal after the connected device changes to %j', async ({ nextKey, nextFid }) => {
    const account = connected(); const pending = deferred<{ hash: string }>();
    account.deleteCast.mockReturnValueOnce(pending.promise);
    await view(account.session); await click(button('Delete cast')!);
    const replacement = connected(nextKey, nextFid);
    await view(replacement.session);
    expect(container.textContent).toContain('connected device changed');
    expect(button('Delete cast')).toBeUndefined(); expect(button('Check deletion status')).toBeUndefined();
    await act(async () => pending.resolve({ hash: 'cd'.repeat(20) }));
    expect(onDeleted).not.toHaveBeenCalled(); expect(replacement.deleteCast).not.toHaveBeenCalled();
    await click(button('Cancel')!); expect(onClose).toHaveBeenCalledOnce();
  });

  it('cannot check an uncertain old-device request through a replacement device that would submit a new write', async () => {
    const account = connected();
    account.deleteCast.mockRejectedValueOnce(new ApiError('Status is unknown.', 504, 'submission_unknown'));
    await view(account.session); await click(button('Delete cast')!);
    const replacement = connected('replacement-key');
    await view(replacement.session);
    expect(container.textContent).toContain('check the cast before taking another action');
    expect(button('Check deletion status')).toBeUndefined(); expect(button('Delete cast')).toBeUndefined();
    expect(replacement.deleteCast).not.toHaveBeenCalled(); expect(onDeleted).not.toHaveBeenCalled();
  });

  it('does not let an earlier target’s completion affect a different cast or release its pending state', async () => {
    const account = connected();
    const earlier = deferred<{ hash: string }>(); const current = deferred<{ hash: string }>();
    account.deleteCast.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(current.promise);
    await view(account.session); await click(button('Delete cast')!);
    const next = { ...cast, hash: `0x${'ef'.repeat(20)}`, text: 'Another synthetic cast' };
    await view(account.session, next); await click(button('Delete cast')!);
    await act(async () => earlier.resolve({ hash: 'cd'.repeat(20) }));
    expect(onDeleted).not.toHaveBeenCalled(); expect(button('Checking deletion…')?.disabled).toBe(true);
    await click(container.querySelector('[aria-label="Close dialog"]')!);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => current.resolve({ hash: '12'.repeat(20) }));
    expect(onDeleted).toHaveBeenCalledExactlyOnceWith(next);
  });
});
