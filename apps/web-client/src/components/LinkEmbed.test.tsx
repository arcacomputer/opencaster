// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LinkEmbed from './LinkEmbed';

const X_ID = '463440424141459456';
const X_URL = `https://x.com/Interior/status/${X_ID}?s=20`;
const X_ORIGIN = 'https://platform.twitter.com';
const EMBED_ID = `opencaster-x-${X_ID}`;
let container: HTMLDivElement;
let root: Root | undefined;
let onNavigate: ReturnType<typeof vi.fn<(path: string) => void>>;
let observers: { callback: IntersectionObserverCallback; target?: Element; disconnect: ReturnType<typeof vi.fn<() => void>> }[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Happy DOM deliberately does not load iframe documents. Give each frame a
  // distinct Window identity so postMessage checks exercise browser behavior.
  const windows = new WeakMap<HTMLIFrameElement, Window>();
  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockImplementation(function (this: HTMLIFrameElement) {
    if (!windows.has(this)) windows.set(this, { postMessage: vi.fn() } as unknown as Window);
    return windows.get(this)!;
  });
  observers = [];
  vi.stubGlobal('IntersectionObserver', class {
    entry: (typeof observers)[number];
    constructor(callback: IntersectionObserverCallback) { this.entry = { callback, disconnect: vi.fn() }; observers.push(this.entry); }
    observe(target: Element) { this.entry.target = target; }
    disconnect() { this.entry.disconnect(); }
  });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container); onNavigate = vi.fn();
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function render(url = X_URL, dark = false) {
  await act(async () => root!.render(<LinkEmbed url={url} dark={dark} onNavigate={onNavigate} />));
}
async function intersect(isIntersecting = true) {
  const entry = observers.at(-1)!;
  await act(async () => entry.callback([{ isIntersecting, target: entry.target } as IntersectionObserverEntry], {} as IntersectionObserver));
}
function frame() { return container.querySelector<HTMLIFrameElement>('iframe')!; }
async function message(data: unknown, options: { origin?: string; source?: MessageEventSource | null } = {}) {
  const event = new MessageEvent('message', { data, origin: options.origin ?? X_ORIGIN, source: options.source === undefined ? frame().contentWindow : options.source });
  await act(async () => { window.dispatchEvent(event); });
}
const native = (method: string, detail: Record<string, unknown> = {}, envelope: Record<string, unknown> = {}) => ({
  'twttr.embed': { jsonrpc: '2.0', id: EMBED_ID, method: `twttr.private.${method}`, params: [{ data: { tweet_id: X_ID }, ...detail }], ...envelope },
});

describe('inline external link embeds', () => {
  it('waits until a provider is near the viewport before loading the remote X frame', async () => {
    await render();
    expect(frame()).toBeNull();
    expect(container.querySelector<HTMLAnchorElement>('.rich-embed__original')!.href).toBe(`https://x.com/Interior/status/${X_ID}`);
    await act(async () => { vi.advanceTimersByTime(20_001); });
    expect(container.textContent).toContain('Loading X');
    await intersect(false); expect(frame()).toBeNull();
    await intersect();
    const src = new URL(frame().src);
    expect(src.origin).toBe(X_ORIGIN); expect(src.pathname).toBe('/embed/Tweet.html');
    expect(Object.fromEntries(src.searchParams)).toEqual({ id: X_ID, dnt: 'true', hideThread: 'true', theme: 'light', lang: 'en', embedId: EMBED_ID });
    expect(frame().title).toBe('Embedded X post');
    expect(frame().getAttribute('sandbox')!.split(' ')).toContain('allow-scripts');
    expect(frame().getAttribute('sandbox')).toContain('allow-same-origin');
    expect(frame().getAttribute('sandbox')).not.toContain('allow-top-navigation');
    expect(frame().referrerPolicy).toBe('no-referrer');
    expect(document.querySelector('script[src]')).toBeNull();
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it('uses the dark X player and still loads when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    await render(X_URL, true);
    expect(new URL(frame().src).searchParams.get('theme')).toBe('dark');
  });

  it('requires the exact frame, provider origin, JSON-RPC envelope and tweet ID before trusting X messages', async () => {
    await render(); await intersect();
    await message(native('rendered'), { source: window });
    await message(native('rendered'), { source: null });
    for (const origin of ['null', 'https://opencaster.org', 'https://platform.x.com', 'https://platform.twitter.com.evil.test']) await message(native('rendered'), { origin });
    for (const data of [
      null, 'ready', '{broken', 'x'.repeat(10_001), {}, { 'twttr.embed': null }, { 'twttr.embed': 'ready' },
      native('rendered', {}, { jsonrpc: '1.0' }), native('rendered', {}, { id: 'another-frame' }),
      native('rendered', {}, { params: [] }), native('rendered', {}, { params: [{ data: { tweet_id: X_ID } }, {}] }),
      native('rendered', {}, { params: [null] }), native('rendered', { data: null }),
      native('rendered', { data: { tweet_id: `${X_ID}0` } }), native('rendered', { data: { tweet_id: Number(X_ID) } }),
      native('initialized'), native('unknown'), native('no_results', {}, { id: 'another-frame' }),
    ]) await message(data);
    expect(frame().height).toBe('360');
    expect(container.querySelector('[role="status"]')!.textContent).toContain('Loading X');
    await message(native('rendered'));
    expect(container.querySelector('[role="status"]')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(20_001); });
    expect(frame()).not.toBeNull();
  });

  it('resizes within bounds but waits for the native rendered event to mark X ready', async () => {
    await render(); await intersect();
    for (const height of ['420', NaN, Infinity, -1, 0, 1601]) await message(native('resize', { height }));
    expect(frame().height).toBe('360');
    await message(native('resize', { height: 420.25 }));
    expect(frame().height).toBe('422');
    expect(container.textContent).toContain('Loading X');
    await message(native('resize', { height: 1 })); expect(frame().height).toBe('240');
    await message(native('resize', { height: 1600 })); expect(frame().height).toBe('1600');
    await message(JSON.stringify(native('rendered')));
    expect(container.querySelector('[role="status"]')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(20_001); });
    expect(frame()).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('still times out when X resizes without confirming that its content rendered', async () => {
    await render(); await intersect(); await message(native('resize', { height: 420 }));
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(frame()).toBeNull(); expect(container.textContent).toContain('X embed unavailable');
  });

  it('shows an unavailable X result, keeps the original link, and retries in a fresh frame', async () => {
    await render(); await intersect();
    const previous = frame(); const previousSource = previous.contentWindow;
    await message(JSON.stringify(native('no_results')));
    expect(frame()).toBeNull();
    expect(container.textContent).toContain('X embed unavailable');
    expect(container.querySelector<HTMLAnchorElement>('.rich-embed__original')!.href).toBe(`https://x.com/Interior/status/${X_ID}`);
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    expect(frame()).not.toBe(previous);
    expect(container.textContent).toContain('Loading X');
    await message(native('rendered'), { source: previousSource });
    expect(container.textContent).toContain('Loading X');
    await message(native('rendered'));
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('times out a blocked embed and retains a usable canonical original link', async () => {
    await render(); await intersect();
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(frame()).toBeNull();
    expect(container.textContent).toContain('X embed unavailable. Open the original to view it.');
    const original = container.querySelector<HTMLAnchorElement>('.rich-embed__original')!;
    expect(original.href).toBe(`https://x.com/Interior/status/${X_ID}`);
    expect(original.target).toBe('_blank'); expect(original.rel).toContain('noopener'); expect(original.rel).toContain('noreferrer');
  });

  it('removes the timer, observer, and message listener when unmounted', async () => {
    const add = vi.spyOn(window, 'addEventListener'); const remove = vi.spyOn(window, 'removeEventListener');
    await render(); await intersect();
    const receive = add.mock.calls.find(call => call[0] === 'message')![1];
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await act(async () => root!.unmount()); root = undefined;
    expect(remove).toHaveBeenCalledWith('message', receive);
    expect(observers[0].disconnect).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('loads the canonical media player lazily and keeps it ready after its load event', async () => {
    await render('https://youtu.be/dQw4w9WgXcQ?t=1m30s&si=tracking');
    expect(frame()).toBeNull(); await intersect();
    expect(frame().src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90');
    expect(frame().title).toBe('YouTube player');
    expect(frame().getAttribute('sandbox')).not.toContain('allow-top-navigation');
    await act(async () => { frame().dispatchEvent(new Event('load')); });
    expect(container.querySelector('[role="status"]')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(20_001); });
    expect(frame()).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('makes an unavailable media player retryable without losing the original destination', async () => {
    await render('https://vimeo.com/123456789'); await intersect();
    await act(async () => { frame().dispatchEvent(new Event('error')); });
    expect(frame()).toBeNull(); expect(container.textContent).toContain('Vimeo embed unavailable');
    expect(container.querySelector<HTMLAnchorElement>('.rich-embed__original')!.href).toBe('https://vimeo.com/123456789');
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    expect(frame().src).toBe('https://player.vimeo.com/video/123456789');
  });

  it('shows a readable full destination for unsupported links', async () => {
    const url = 'https://www.example.com/articles/hello%20world?edition=2#details';
    await render(url);
    const link = container.querySelector<HTMLAnchorElement>('a')!;
    expect(link.href).toBe(url); expect(link.target).toBe('_blank');
    expect(container.querySelector('small')!.textContent).toBe('example.com');
    expect(container.querySelector('strong')!.textContent).toBe('/articles/hello world?edition=2#details');
    expect(frame()).toBeNull(); expect(observers).toHaveLength(0);
  });

  it.each(['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const)('preserves native %s clicks for local social links', async modifier => {
    await render('https://warpcast.com/alice/0xabcdef12?s=20');
    const link = container.querySelector<HTMLAnchorElement>('a')!;
    expect(link.getAttribute('href')).toBe('/alice/0xabcdef12');
    expect(link.target).toBe('');
    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, [modifier]: true });
    await act(async () => { link.dispatchEvent(modified); });
    expect(modified.defaultPrevented).toBe(false); expect(onNavigate).not.toHaveBeenCalled();
    const ordinary = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    await act(async () => { link.dispatchEvent(ordinary); });
    expect(ordinary.defaultPrevented).toBe(true); expect(onNavigate).toHaveBeenCalledExactlyOnceWith('/alice/0xabcdef12');
  });
});
