// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FeedPagination from './FeedPagination';

type Observer = {
  callback: IntersectionObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};
let host: HTMLDivElement;
let root: Root;
let observers: Observer[];
let observerConstructor: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  observers = [];
  observerConstructor = vi.fn(function (callback: IntersectionObserverCallback) {
    const observer = { callback, observe: vi.fn(), disconnect: vi.fn() };
    observers.push(observer);
    return observer;
  });
  vi.stubGlobal('IntersectionObserver', observerConstructor);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async (element: Parameters<Root['render']>[0]) => { await act(async () => root.render(element)); };
async function intersect(observer: Observer, isIntersecting = true, target = observer.observe.mock.calls[0][0] as Element) {
  await act(async () => observer.callback([{ isIntersecting, target } as IntersectionObserverEntry], observer as unknown as IntersectionObserver));
}

describe('automatic feed pagination', () => {
  it('loads only near the observed sentinel and has no manual load button in supported browsers', async () => {
    const onLoad = vi.fn();
    await render(<FeedPagination cursor="first" busy={false} error="" paused={false} onLoad={onLoad} />);
    expect(onLoad).not.toHaveBeenCalled();
    expect(observerConstructor).toHaveBeenCalledWith(expect.any(Function), { rootMargin: '600px 0px' });
    expect(observers[0].observe).toHaveBeenCalledExactlyOnceWith(host.querySelector('.feed-pagination__sentinel'));
    expect(host.querySelector('button')).toBeNull();
    await intersect(observers[0], false);
    await intersect(observers[0], true, document.createElement('div'));
    expect(onLoad).not.toHaveBeenCalled();
    await intersect(observers[0]); await intersect(observers[0]);
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it('re-arms after cursor changes and request completion so sparse pages can continue', async () => {
    const onLoad = vi.fn();
    await render(<FeedPagination cursor="first" busy={false} error="" paused={false} onLoad={onLoad} />);
    const first = observers[0];
    await intersect(first);
    await render(<FeedPagination cursor="first" busy={true} error="" paused={false} onLoad={onLoad} />);
    expect(first.disconnect).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading more conversations…');
    expect(host.querySelector('.feed-pagination')?.getAttribute('aria-busy')).toBe('true');
    await intersect(first); expect(onLoad).toHaveBeenCalledOnce();
    await render(<FeedPagination cursor="second" busy={false} error="" paused={false} onLoad={onLoad} />);
    await intersect(observers[1]); expect(onLoad).toHaveBeenCalledTimes(2);
    // No rows need to be added for a new cursor to request another sparse page.
    await render(<FeedPagination cursor="third" busy={false} error="" paused={false} onLoad={onLoad} />);
    expect(observers[1].disconnect).toHaveBeenCalledOnce();
    await intersect(observers[1]); expect(onLoad).toHaveBeenCalledTimes(2);
    await intersect(observers[2]); expect(onLoad).toHaveBeenCalledTimes(3);
    await render(<FeedPagination cursor="third" busy={true} error="" paused={false} onLoad={onLoad} />);
    await render(<FeedPagination cursor="third" busy={false} error="" paused={false} onLoad={onLoad} />);
    await intersect(observers[3]); expect(onLoad).toHaveBeenCalledTimes(4);
  });

  it('disconnects while the feed is paused and suppresses queued callbacks from hidden feeds', async () => {
    const onLoad = vi.fn();
    await render(<FeedPagination cursor="first" busy={false} error="" paused={false} onLoad={onLoad} />);
    const old = observers[0];
    await render(<FeedPagination cursor="first" busy={false} error="" paused onLoad={onLoad} />);
    expect(old.disconnect).toHaveBeenCalledOnce(); expect(observers).toHaveLength(1);
    expect(host.querySelector('.feed-pagination')?.hasAttribute('hidden')).toBe(true);
    await intersect(old); expect(onLoad).not.toHaveBeenCalled();
    await render(<FeedPagination cursor="first" busy={false} error="" paused={false} onLoad={onLoad} />);
    await intersect(old); expect(onLoad).not.toHaveBeenCalled();
    await intersect(observers[1]); expect(onLoad).toHaveBeenCalledOnce();
  });

  it('uses the latest callback without rebuilding an observer on routine rerenders', async () => {
    const firstLoad = vi.fn(); const latestLoad = vi.fn();
    await render(<FeedPagination cursor="first" busy={false} error="" paused={false} onLoad={firstLoad} />);
    await render(<FeedPagination cursor="first" busy={false} error="" paused={false} onLoad={latestLoad} />);
    expect(observers).toHaveLength(1);
    await intersect(observers[0]);
    expect(firstLoad).not.toHaveBeenCalled(); expect(latestLoad).toHaveBeenCalledOnce();
  });

  it('stops automatic requests after an error and offers an explicit retry', async () => {
    const onLoad = vi.fn();
    await render(<FeedPagination cursor="first" busy={false} error="" paused={false} onLoad={onLoad} />);
    await render(<FeedPagination cursor="first" busy={false} error="The node took too long." paused={false} onLoad={onLoad} />);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('The node took too long.');
    await intersect(observers[0]); expect(onLoad).not.toHaveBeenCalled();
    const retry = host.querySelector('button')!;
    expect(retry.textContent).toBe('Try again');
    await act(async () => retry.click()); expect(onLoad).toHaveBeenCalledOnce();
    await render(<FeedPagination cursor="first" busy error="The node took too long." paused={false} onLoad={onLoad} />);
    expect(host.querySelector('button')?.disabled).toBe(true);
  });

  it('does not observe an initially busy, paused or failed feed', async () => {
    const onLoad = vi.fn();
    await render(<FeedPagination cursor="first" busy error="" paused={false} onLoad={onLoad} />);
    await render(<FeedPagination cursor="first" busy={false} error="" paused onLoad={onLoad} />);
    await render(<FeedPagination cursor="first" busy={false} error="Unavailable" paused={false} onLoad={onLoad} />);
    expect(observerConstructor).not.toHaveBeenCalled(); expect(onLoad).not.toHaveBeenCalled();
  });

  it('keeps manual loading available when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const onLoad = vi.fn();
    await render(<FeedPagination cursor="first" busy={false} error="" paused={false} onLoad={onLoad} />);
    expect(observerConstructor).not.toHaveBeenCalled();
    expect(host.querySelector('button')?.textContent).toBe('Load more conversations');
    await act(async () => host.querySelector('button')!.click()); expect(onLoad).toHaveBeenCalledOnce();
    await render(<FeedPagination cursor="first" busy error="" paused={false} onLoad={onLoad} />);
    expect(host.querySelector('button')?.disabled).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading more conversations…');
  });
});
