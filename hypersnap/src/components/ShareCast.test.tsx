// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareCastDialog } from './ShareCast';
import type { Cast } from '../lib/api';

const cast: Cast = {
  hash: '0x8d336914cddb739974eb0c2e820fa744054c9439',
  author: { fid: 20, username: 'yes2crypto.eth', display_name: 'YES2Crypto', custody_address: '', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 },
  text: 'A public cast', timestamp: '2026-10-23T12:00:00Z', embeds: [], reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 },
};
const link = `https://opencaster.org/yes2crypto.eth/${cast.hash}`;
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(() => {});
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(() => {});
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(target = cast) { await act(async () => root.render(<ShareCastDialog cast={target} onClose={() => {}} notify={() => {}} />)); }
async function click(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!;
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
}

describe('Farcaster-shaped cast sharing', () => {
  it('uses the same exact author/hash URL for manual copying, clipboard, and opening a cast', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(copy);
    await render();
    expect(container.querySelector('input')?.value).toBe(link);
    expect(container.querySelector('a')?.getAttribute('href')).toBe(link);
    await click('Copy link'); expect(copy).toHaveBeenCalledExactlyOnceWith(link);
    expect(container.textContent).toContain('Cast link copied.');
  });

  it('uses the same public URL in the device share sheet', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    try {
      await render(); await click('Share via…');
      expect(share).toHaveBeenCalledExactlyOnceWith({ title: 'Cast by YES2Crypto', text: cast.text, url: link });
    } finally { Reflect.deleteProperty(navigator, 'share'); }
  });

  it('retains author scope through a FID URL when no usable username is available', async () => {
    await render({ ...cast, author: { ...cast.author, username: '' } });
    expect(container.querySelector('input')?.value).toBe(`https://opencaster.org/20/${cast.hash}`);
  });

  it('upgrades a supplied short path and retains a verified exact path', async () => {
    for (const path of ['/yes2crypto.eth/0x8d336914', `/yes2crypto.eth/${cast.hash}`]) {
      await act(async () => root.render(<ShareCastDialog cast={cast} path={path} onClose={() => {}} notify={() => {}} />));
      expect(container.querySelector('input')?.value).toBe(link);
    }
    await act(async () => root.render(<ShareCastDialog cast={cast} path={`/cast/${cast.hash}`} onClose={() => {}} notify={() => {}} />));
    expect(container.querySelector('input')?.value).toBe(`https://opencaster.org/cast/${cast.hash}`);
  });

  it('does not share another author or hash through a supplied path', async () => {
    for (const path of [`/another-author/${cast.hash}`, `/cast/0x${'ab'.repeat(20)}`]) {
      await act(async () => root.render(<ShareCastDialog cast={cast} path={path} onClose={() => {}} notify={() => {}} />));
      expect(container.querySelector('input')?.value).toBe(link);
    }
  });
});
