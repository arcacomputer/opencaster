// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MediaViewer from './MediaViewer';
import { ProfileDetails, ShareProfileDialog } from './ProfileDetails';
import CastOptions from './CastOptions';
import type { Cast, User } from '@opencaster/client-core/api';
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true; this.querySelector<HTMLButtonElement>('button')?.focus(); });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('public content tools', () => {
  it('navigates images with arrows and refuses credential-bearing or insecure URLs', async () => {
    await act(async () => root.render(<MediaViewer images={[{ url: 'https://example.org/a.png', alt: 'First' }, { url: 'https://example.org/b.png', alt: 'Second' }]} initialIndex={0} onClose={vi.fn()} />));
    expect(host.querySelector('img')?.alt).toBe('First');
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(host.querySelector('img')?.alt).toBe('Second'); expect(host.textContent).toContain('2 of 2');
    await act(async () => root.render(<MediaViewer key="unsafe" images={[{ url: 'http://example.org/a.png', alt: 'Bad' }, { url: 'https://user:password@example.org/b.png', alt: 'Bad' }]} initialIndex={0} onClose={vi.fn()} />));
    expect(host.querySelector('img')).toBeNull(); expect(host.textContent).toContain('No image is available');
  });
  it('renders only valid linked addresses and a stable FID profile link', async () => {
    const user = { fid: 12, username: 'alice', registered_at: '2024-02-01T00:00:00Z', verified_addresses: { eth_addresses: [`0x${'a'.repeat(40)}`, 'javascript:bad'], sol_addresses: ['1'.repeat(32)] } } as User;
    await act(async () => root.render(<><ProfileDetails user={user} /><ShareProfileDialog user={user} onClose={vi.fn()} /></>));
    expect(host.textContent).toContain('Linked addresses (2)'); expect(host.textContent).not.toContain('javascript:bad'); expect(host.textContent).toContain('Joined');
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Profile link"]')?.value).toBe('https://opencaster.org/profile/12');
  });
  it('copies rendered mention text without changing or submitting a cast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const cast = { text: 'Hello there', mentioned_profiles: [], author: { fid: 12 } } as unknown as Cast;
    const onShare = vi.fn(); const onQuote = vi.fn();
    await act(async () => root.render(<CastOptions cast={cast} onClose={vi.fn()} onShare={onShare} onQuote={onQuote} />));
    await act(async () => { [...host.querySelectorAll('button')].find(item => item.textContent === 'Copy text')!.click(); });
    expect(writeText).toHaveBeenCalledWith('Hello there'); expect(onShare).not.toHaveBeenCalled(); expect(onQuote).not.toHaveBeenCalled();
  });
});
