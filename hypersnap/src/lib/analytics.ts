import { analyticsPage, isAnalyticsAction, isAnalyticsEvent, type AnalyticsEvent, type AnalyticsPage } from './analyticsEvents';

export const ANALYTICS_DISABLED_KEY = 'opencaster.analytics.disabled';
export const ANALYTICS_ENDPOINT = '/_analytics/events';
const MAX_QUEUE = 100;
const MAX_EVENTS = 500;
const MAX_CLICKS = 400;
const MAX_BATCH = 20;
const MAX_BYTES = 8_192;
const FLUSH_INTERVAL = 5_000;

/** Reduce acquisition to a fixed category; the referrer itself is never retained. */
export function analyticsSource(referrer: string): Extract<AnalyticsEvent, { kind: 'visit' }>['name'] {
  if (!referrer) return 'direct';
  try {
    const url = new URL(referrer);
    if (!['http:', 'https:'].includes(url.protocol)) return 'other';
    const host = url.hostname.toLowerCase();
    if (host === 'opencaster.org') return 'internal';
    if (host === 'github.com' || host.endsWith('.github.com')) return 'github';
    if (['google.com', 'google.cl', 'google.co.uk', 'google.ca', 'google.de', 'google.fr', 'google.es', 'google.com.br', 'bing.com', 'duckduckgo.com', 'search.yahoo.com', 'search.brave.com', 'ecosia.org'].some(domain => host === domain || host.endsWith(`.${domain}`))) return 'search';
    if (['twitter.com', 'x.com', 't.co', 'farcaster.xyz', 'warpcast.com', 'bsky.app', 'reddit.com', 'facebook.com', 'instagram.com', 'linkedin.com'].some(domain => host === domain || host.endsWith(`.${domain}`))) return 'social';
  } catch { /* Malformed or opaque referrers remain unclassified. */ }
  return 'other';
}

export function analyticsPrivacySignal(): boolean {
  try {
    return navigator.doNotTrack === '1' || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  } catch { return true; }
}

export function analyticsDisabled(): boolean {
  if (disabledForThisDocument !== undefined) return disabledForThisDocument;
  try { return localStorage.getItem(ANALYTICS_DISABLED_KEY) === 'true'; } catch { return false; }
}

interface AnalyticsOptions {
  /** Overrides exist for isolated tests; the real bootstrap uses production defaults. */
  production?: boolean;
  hostname?: string;
  initialPage?: AnalyticsPage;
  fetch?: typeof fetch;
}
export interface AnalyticsRuntime {
  pageview(route: { kind: string }): void;
  flush(): void;
  refreshPreference(): void;
  stop(): void;
}

let disabledForThisDocument: boolean | undefined;
let runtime: AnalyticsRuntime | undefined;

/** First-party, bounded aggregate counters. No URL, account or DOM content is read. */
export function createAnalytics(options: AnalyticsOptions = {}): AnalyticsRuntime {
  const production = options.production ?? import.meta.env.PROD;
  const hostname = options.hostname ?? location.hostname;
  const eligible = production && hostname === 'opencaster.org';
  const transport = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let page = options.initialPage ?? 'discover';
  const documentPage = page;
  let queue: AnalyticsEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let accepted = 0;
  let clicks = 0;
  let active = false;
  let stopped = false;
  let visited = false;
  let lastRoute: object | undefined;
  let lcp: number | undefined;
  let cls = 0;
  let clsSession = 0;
  let clsStart = 0;
  let clsLast = 0;
  let vitalsReported = false;
  let observers: PerformanceObserver[] = [];

  const permitted = () => eligible && !stopped && !analyticsPrivacySignal() && !analyticsDisabled();
  function clearQueue() {
    queue = [];
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  function schedule() {
    if (timer === undefined) timer = setTimeout(() => { timer = undefined; flush(); }, FLUSH_INTERVAL);
  }
  function add(event: AnalyticsEvent) {
    if (!active || !permitted() || accepted >= MAX_EVENTS || queue.length >= MAX_QUEUE || !isAnalyticsEvent(event)) return;
    if (event.kind === 'click') { if (clicks >= MAX_CLICKS) return; clicks += 1; }
    accepted += 1;
    queue.push(event);
    schedule();
  }
  function flush() {
    if (!permitted()) { clearQueue(); return; }
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    // Never retry: failed telemetry is expendable and must not affect the app.
    while (queue.length) {
      const events: AnalyticsEvent[] = [];
      while (queue.length && events.length < MAX_BATCH) {
        const next = queue[0];
        const candidate = JSON.stringify({ events: [...events, next] });
        if (new TextEncoder().encode(candidate).length > MAX_BYTES) break;
        events.push(queue.shift()!);
      }
      if (!events.length) { queue.shift(); continue; }
      try {
        void transport(ANALYTICS_ENDPOINT, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events }), credentials: 'omit',
          referrerPolicy: 'no-referrer', keepalive: true,
        }).catch(() => {});
      } catch { /* A blocked or unavailable collector never interrupts navigation. */ }
    }
  }
  function click(event: Event) {
    try {
      const target = event.target instanceof Element ? event.target.closest('[data-analytics]') : null;
      if (!target || target.matches(':disabled') || target.getAttribute('aria-disabled') === 'true') return;
      const name = target.getAttribute('data-analytics');
      if (isAnalyticsAction(name)) add({ kind: 'click', page, name });
    } catch { /* Ignore unsupported or detached event targets. */ }
  }
  function uncaught() { add({ kind: 'error', page, name: 'uncaught' }); }
  function rejection() { add({ kind: 'error', page, name: 'unhandled-rejection' }); }
  function reportVitals() {
    if (vitalsReported || !active || !permitted()) return;
    vitalsReported = true;
    if (lcp !== undefined) add({ kind: 'vital', page: documentPage, name: 'LCP', value: lcp });
    if (observers.some(observer => observerNames.get(observer) === 'layout-shift')) add({ kind: 'vital', page: documentPage, name: 'CLS', value: cls });
    try {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (navigation && navigation.responseStart > 0) add({ kind: 'vital', page: documentPage, name: 'TTFB', value: Math.max(0, navigation.responseStart - navigation.startTime) });
    } catch { /* Performance APIs are optional. */ }
  }
  function hidden() { if (document.visibilityState === 'hidden') { reportVitals(); flush(); } }
  function pagehide() { reportVitals(); flush(); }
  const observerNames = new WeakMap<PerformanceObserver, string>();
  function observeVitals() {
    if (typeof PerformanceObserver === 'undefined') return;
    for (const type of ['largest-contentful-paint', 'layout-shift']) {
      try {
        if (!PerformanceObserver.supportedEntryTypes?.includes(type)) continue;
        const observer = new PerformanceObserver(list => {
          if (!active || !permitted() || vitalsReported) return;
          for (const entry of list.getEntries()) {
            if (type === 'largest-contentful-paint') lcp = entry.startTime;
            else {
              const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
              if (shift.hadRecentInput || !Number.isFinite(shift.value) || shift.value < 0) continue;
              if (clsSession > 0 && entry.startTime - clsLast < 1_000 && entry.startTime - clsStart < 5_000) clsSession += shift.value;
              else { clsSession = shift.value; clsStart = entry.startTime; }
              clsLast = entry.startTime;
              cls = Math.max(cls, clsSession);
            }
          }
        });
        observer.observe({ type, buffered: true });
        observerNames.set(observer, type);
        observers.push(observer);
      } catch { /* Missing browser metrics leave an honest coverage gap. */ }
    }
  }
  function deactivate() {
    active = false; clearQueue();
    document.removeEventListener('click', click, true);
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('pagehide', pagehide);
    window.removeEventListener('error', uncaught);
    window.removeEventListener('unhandledrejection', rejection);
    for (const observer of observers) observer.disconnect();
    observers = [];
  }
  function refreshPreference() {
    if (!permitted()) { deactivate(); return; }
    if (active) return;
    active = true;
    document.addEventListener('click', click, true);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('error', uncaught);
    window.addEventListener('unhandledrejection', rejection);
    // Metrics cover a document's initial navigation, never a particular profile or cast.
    observeVitals();
    if (!visited) { visited = true; add({ kind: 'visit', page, name: analyticsSource(document.referrer) }); }
  }
  const result: AnalyticsRuntime = {
    pageview(route) {
      page = analyticsPage(route);
      // React StrictMode replays the same effect with the same route object.
      if (lastRoute === route) return;
      lastRoute = route;
      add({ kind: 'pageview', page, name: 'view' });
    },
    flush,
    refreshPreference,
    stop() { stopped = true; deactivate(); window.removeEventListener('storage', storageChanged); },
  };
  function storageChanged(event: StorageEvent) {
    if (event.key === ANALYTICS_DISABLED_KEY || event.key === null) { disabledForThisDocument = undefined; refreshPreference(); }
  }
  if (eligible) window.addEventListener('storage', storageChanged);
  refreshPreference();
  return result;
}

/** Bootstrap outside React so development effect replay cannot install duplicate listeners. */
export function initAnalytics(initialRoute: { kind: string }): void {
  try { if (!runtime) runtime = createAnalytics({ initialPage: analyticsPage(initialRoute) }); } catch { /* Analytics never blocks app startup. */ }
}
export function trackPageView(route: { kind: string }): void { try { runtime?.pageview(route); } catch { /* Navigation is independent of telemetry. */ } }

export function setAnalyticsDisabled(disabled: boolean): boolean {
  disabledForThisDocument = disabled;
  let saved = true;
  try {
    if (disabled) localStorage.setItem(ANALYTICS_DISABLED_KEY, 'true');
    else localStorage.removeItem(ANALYTICS_DISABLED_KEY);
  } catch { saved = false; }
  runtime?.refreshPreference();
  return saved;
}
