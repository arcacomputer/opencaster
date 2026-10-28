// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NodeSupportBanner from './NodeSupportBanner';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.restoreAllMocks(); localStorage.clear(); vi.unstubAllGlobals();
});
async function render(visible = true) { await act(async () => root.render(<NodeSupportBanner visible={visible} />)); }
async function dismiss() {
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss node support banner"]')!.click());
}

describe('optional Hypersnap node support', () => {
  it('offers the exact live Stripe link without a wallet, embedded payment form or charitable promise', async () => {
    await render();
    const region = container.querySelector<HTMLElement>('section[aria-labelledby]')!;
    expect(document.getElementById(region.getAttribute('aria-labelledby')!)?.textContent).toBe('Help us run our own Hypersnap node');
    expect(region.textContent).toContain('Support our open-source work and help Arca Computer fund an independently operated node for Opencaster.');
    expect(region.textContent).toContain('Optional one-time support · Processed by Stripe');
    const link = region.querySelector<HTMLAnchorElement>('a')!;
    expect(link.href).toBe('https://buy.stripe.com/cNi00i9dY4kD3JP7G57ss05');
    expect(link.textContent).toContain('Support the node');
    expect(link.target).toBe('_blank');
    expect(link.rel.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
    expect(container.querySelector('iframe, form, dialog')).toBeNull();
    expect(region.textContent).not.toMatch(/tax.deductible|keep running|donate|guaranteed/i);
  });

  it('dismisses immediately and stays dismissed after remounting', async () => {
    await render(); await dismiss(); expect(container.textContent).toBe('');
    await act(async () => root.unmount()); root = createRoot(container);
    await render(); expect(container.textContent).toBe('');
  });

  it('does not show on other views and keeps a dismissal when navigating back', async () => {
    await render(false); expect(container.textContent).toBe('');
    await render(); expect(container.querySelector('section')).not.toBeNull();
    await dismiss(); await render(false); await render();
    expect(container.querySelector('section')).toBeNull();
  });

  it('remains dismissible when browser storage cannot be read or written', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full or denied'); });
    await render(); expect(container.querySelector('section')).not.toBeNull();
    await dismiss(); await render(false); await render();
    expect(container.querySelector('section')).toBeNull();
  });
});
