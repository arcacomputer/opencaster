// @vitest-environment happy-dom
import { act, StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANALYTICS_DISABLED_KEY, ANALYTICS_ENDPOINT, analyticsSource, createAnalytics, setAnalyticsDisabled, type AnalyticsRuntime } from './analytics';
import { analyticsPage, isAnalyticsEvent, type AnalyticsEvent } from './analyticsEvents';

let clients: AnalyticsRuntime[];
let send: ReturnType<typeof vi.fn<typeof fetch>>;
function start(options: Parameters<typeof createAnalytics>[0] = {}) {
  const client = createAnalytics({ production: true, hostname: 'opencaster.org', fetch: send, ...options });
  clients.push(client); return client;
}
function events(): AnalyticsEvent[] {
  return send.mock.calls.flatMap(([, options]) => JSON.parse(String(options!.body)).events);
}
function click(label: string | null = 'cast-share-open', contents = 'Public cast with private test marker') {
  const button = document.createElement('button');
  if (label !== null) button.setAttribute('data-analytics', label);
  button.title = 'secret-title'; button.textContent = contents;
  button.setAttribute('data-fid', '123456');
  document.body.append(button); button.click(); button.remove();
}

beforeEach(() => {
  clients = []; localStorage.clear(); setAnalyticsDisabled(false);
  vi.useFakeTimers();
  send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(navigator, 'doNotTrack', 'get').mockReturnValue('unspecified');
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: false });
});
afterEach(() => {
  clients.forEach(client => client.stop());
  setAnalyticsDisabled(false); localStorage.clear(); document.body.replaceChildren();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('analytics boundary', () => {
  it('accepts only exact fixed schemas and bounded finite metrics', () => {
    for (const value of [
      { kind: 'visit', page: 'discover', name: 'direct' },
      { kind: 'pageview', page: 'profile', name: 'view' },
      { kind: 'click', page: 'cast', name: 'cast-share-open' },
      { kind: 'vital', page: 'search', name: 'LCP', value: 1200 },
      { kind: 'error', page: 'connect', name: 'uncaught' },
    ]) expect(isAnalyticsEvent(value)).toBe(true);
    for (const value of [
      null, [], { kind: 'visit', page: 'discover', name: 'view' },
      { kind: 'pageview', page: '/profile/alice', name: 'view' },
      { kind: 'pageview', page: 'profile', name: 'view', fid: 42 },
      { kind: 'click', page: 'search', name: 'secret search text' },
      { kind: 'click', page: 'search', name: 'search-submit', value: 1 },
      { kind: 'error', page: 'connect', name: 'uncaught', message: 'wallet payload' },
      ...[NaN, Infinity, -1, 600001].map(value => ({ kind: 'vital', page: 'discover', name: 'LCP', value })),
      { kind: 'vital', page: 'discover', name: 'CLS', value: 10.1 },
    ]) expect(isAnalyticsEvent(value)).toBe(false);
  });

  it('uses route categories without reading account, cast or query values', () => {
    const route = { kind: 'profile', get identifier() { throw new Error('must not inspect'); } };
    expect(analyticsPage(route)).toBe('profile');
    expect(analyticsPage({ kind: 'cast-alias' })).toBe('cast');
    expect(analyticsPage({ kind: '/secret' })).toBe('not-found');
  });

  it.each([
    ['', 'direct'], ['https://opencaster.org/profile/alice', 'internal'],
    ['https://www.google.com/search?q=secret', 'search'], ['https://google.cl/search?q=secret', 'search'],
    ['https://duckduckgo.com/?q=secret', 'search'], ['https://github.com/arcacomputer/opencaster', 'github'],
    ['https://farcaster.xyz/alice/0x1234', 'social'], ['https://t.co/private', 'social'],
    ['https://google.com.attacker.test', 'other'], ['https://fakegithub.com', 'other'],
    ['https://notopencaster.org', 'other'], ['not a url', 'other'],
  ])('classifies acquisition %s into %s', (referrer, expected) => { expect(analyticsSource(referrer)).toBe(expected); });
});

describe('first-party collection', () => {
  it('sends fixed labels only and omits credentials, referrers and DOM/error content', () => {
    const client = start({ initialPage: 'profile' });
    client.pageview({ kind: 'profile' });
    const link = document.createElement('a');
    link.href = '/profile/secret-account?q=private'; link.title = 'secret-title'; link.setAttribute('data-analytics', 'profile-open');
    link.innerHTML = '<span>secret-account-text</span>'; document.body.append(link);
    link.addEventListener('click', event => event.preventDefault());
    link.firstElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    click('wallet-secret-material'); click(null);
    window.dispatchEvent(new ErrorEvent('error', { message: 'secret-error-message', error: new Error('secret-stack') }));
    window.dispatchEvent(new Event('unhandledrejection'));
    client.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(ANALYTICS_ENDPOINT);
    expect(send.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true, headers: { 'Content-Type': 'application/json' } });
    expect(events()).toEqual([
      { kind: 'visit', page: 'profile', name: 'direct' },
      { kind: 'pageview', page: 'profile', name: 'view' },
      { kind: 'click', page: 'profile', name: 'profile-open' },
      { kind: 'error', page: 'profile', name: 'uncaught' },
      { kind: 'error', page: 'profile', name: 'unhandled-rejection' },
    ]);
    expect(JSON.stringify(send.mock.calls)).not.toMatch(/secret|private|123456|href|title|stack|message/);
  });

  it('deduplicates StrictMode replay while counting successive routes in the same category', async () => {
    const client = start(); const route = { kind: 'profile', identifier: 'private-name' };
    function View() { useEffect(() => client.pageview(route), []); return null; }
    const container = document.createElement('div'); const root = createRoot(container);
    await act(async () => { root.render(<StrictMode><View /></StrictMode>); });
    client.pageview({ kind: 'profile' }); client.pageview({ kind: 'cast-alias' }); client.flush();
    expect(events().filter(event => event.kind === 'pageview').map(event => event.page)).toEqual(['profile', 'profile', 'cast']);
    await act(async () => root.unmount());
  });

  it.each([{ production: false }, { hostname: 'localhost' }, { hostname: 'preview.opencaster.org' }])('does not collect outside canonical production: %j', options => {
    const client = start(options); click(); client.pageview({ kind: 'search' }); client.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['dnt', 'gpc', 'preference'] as const)('respects %s before collection', signal => {
    if (signal === 'dnt') vi.spyOn(navigator, 'doNotTrack', 'get').mockReturnValue('1');
    if (signal === 'gpc') Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true });
    if (signal === 'preference') setAnalyticsDisabled(true);
    const client = start(); click(); client.pageview({ kind: 'connect' }); client.flush();
    expect(send).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('discards queued events on opt out and resumes only after enabling', () => {
    const client = start(); click();
    setAnalyticsDisabled(true); client.refreshPreference(); client.flush();
    expect(localStorage.getItem(ANALYTICS_DISABLED_KEY)).toBe('true'); expect(send).not.toHaveBeenCalled();
    click(); vi.advanceTimersByTime(10_000); expect(send).not.toHaveBeenCalled();
    setAnalyticsDisabled(false); client.refreshPreference(); client.pageview({ kind: 'settings' }); client.flush();
    expect(events()).toEqual([{ kind: 'pageview', page: 'settings', name: 'view' }]);
  });

  it('checks newly enabled privacy signals before sending queued events', () => {
    const client = start(); click();
    Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true });
    client.flush(); expect(send).not.toHaveBeenCalled();
  });

  it('batches bounded queues and caps clicks and total events per document', () => {
    const client = start();
    for (let i = 0; i < 150; i++) click();
    client.flush(); expect(events()).toHaveLength(100);
    for (let i = 0; i < 500; i++) { click(); if (i % 50 === 0) client.flush(); }
    client.flush(); expect(events().filter(event => event.kind === 'click')).toHaveLength(400);
    for (let i = 0; i < 150; i++) { client.pageview({ kind: 'search' }); if (i % 50 === 0) client.flush(); }
    client.flush(); expect(events()).toHaveLength(500);
    for (const [, request] of send.mock.calls) {
      expect(JSON.parse(String(request!.body)).events.length).toBeLessThanOrEqual(20);
      expect(new TextEncoder().encode(String(request!.body)).length).toBeLessThanOrEqual(8192);
    }
  });

  it('flushes after five seconds and silently drops rejected or throwing transports without retries', async () => {
    send.mockRejectedValueOnce(new Error('collector unavailable'));
    const client = start(); vi.advanceTimersByTime(5_000); await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1); vi.advanceTimersByTime(20_000); expect(send).toHaveBeenCalledTimes(1);
    send.mockImplementationOnce(() => { throw new Error('blocked'); });
    click(); expect(() => client.flush()).not.toThrow(); expect(send).toHaveBeenCalledTimes(2);
    client.flush(); expect(send).toHaveBeenCalledTimes(2);
  });

  it('cleans up pending timers and listeners', () => {
    const client = start(); client.stop(); click(); client.pageview({ kind: 'search' });
    window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new ErrorEvent('error')); vi.advanceTimersByTime(10_000);
    expect(send).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('reports supported LCP, maximum CLS session window and TTFB once on pagehide', () => {
    const observers: MockObserver[] = [];
    class MockObserver {
      static supportedEntryTypes = ['largest-contentful-paint', 'layout-shift'];
      type = ''; disconnected = false;
      constructor(public callback: PerformanceObserverCallback) { observers.push(this); }
      observe(options: PerformanceObserverInit) { this.type = options.type!; }
      disconnect() { this.disconnected = true; }
      emit(entries: Record<string, unknown>[]) { this.callback({ getEntries: () => entries } as unknown as PerformanceObserverEntryList, this as unknown as PerformanceObserver); }
    }
    vi.stubGlobal('PerformanceObserver', MockObserver);
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ startTime: 0, responseStart: 120 }] as unknown as PerformanceEntry[]);
    const client = start({ initialPage: 'discover' });
    observers.find(observer => observer.type === 'largest-contentful-paint')!.emit([{ startTime: 1500 }, { startTime: 1900 }]);
    observers.find(observer => observer.type === 'layout-shift')!.emit([
      { startTime: 500, value: .1, hadRecentInput: false }, { startTime: 1000, value: .2, hadRecentInput: false },
      { startTime: 1200, value: 5, hadRecentInput: true }, { startTime: 7000, value: .15, hadRecentInput: false },
    ]);
    client.pageview({ kind: 'profile' }); window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pagehide'));
    const metrics = events().filter(event => event.kind === 'vital');
    expect(metrics).toHaveLength(3);
    expect(metrics).toContainEqual({ kind: 'vital', page: 'discover', name: 'LCP', value: 1900 });
    expect(metrics).toContainEqual({ kind: 'vital', page: 'discover', name: 'TTFB', value: 120 });
    expect((metrics.find(event => event.name === 'CLS') as Extract<AnalyticsEvent, {kind: 'vital'}>).value).toBeCloseTo(.3);
    expect(metrics.every(isAnalyticsEvent)).toBe(true);
    client.stop(); expect(observers.every(observer => observer.disconnected)).toBe(true);
  });
});
