/** Shared browser/Worker boundary. Only these aggregate labels may leave the app. */
export const ANALYTICS_PAGES = [
  'discover', 'following', 'feeds', 'feed', 'bookmarks', 'notifications', 'channels', 'devlog',
  'settings', 'connect', 'search', 'channel', 'profile', 'cast', 'not-found',
] as const;
export type AnalyticsPage = typeof ANALYTICS_PAGES[number];

export const ANALYTICS_ACTIONS = [
  'nav-discover', 'nav-following', 'nav-bookmarks', 'nav-notifications', 'nav-search',
  'nav-channels', 'nav-feeds', 'nav-devlog', 'nav-settings', 'nav-profile', 'nav-channel',
  'connect-open', 'landing-explore', 'composer-open', 'node-support-open',
  'theme-toggle', 'source-open', 'hypersnap-open', 'shortcuts-open',
  'cast-open', 'cast-parent-open', 'cast-replies-open', 'cast-quote-open',
  'cast-delete-open', 'cast-share-open', 'cast-options-open', 'cast-image-open',
  'cast-quotes-open', 'cast-reactions-open', 'cast-copy-text',
  'cast-like', 'cast-unlike', 'cast-recast-menu-open', 'cast-recast', 'cast-unrecast',
  'bookmark-add', 'bookmark-remove', 'bookmarks-clear', 'bookmarks-sort',
  'profile-open', 'profile-share-open', 'profile-follow', 'profile-unfollow',
  'profile-followers-open', 'profile-following-open', 'profile-edit-open',
  'profile-tab-casts', 'profile-tab-replies', 'profile-tab-media',
  'profile-tab-likes', 'profile-tab-recasts', 'device-access-open', 'session-lock',
  'feed-refresh', 'feed-more', 'feed-window', 'search-submit',
  'search-kind-casts', 'search-kind-users', 'notifications-refresh',
  'notifications-mark-read', 'notifications-filter', 'channel-search',
  'channel-directory', 'channel-save', 'channel-unsave', 'channel-participants-open',
  'composer-image', 'composer-mentions', 'composer-emoji', 'composer-drafts',
  'composer-info', 'draft-save', 'draft-restore', 'draft-discard',
  'publish-cast', 'publish-reply', 'publish-quote', 'share-copy', 'share-native',
  'content-controls-open', 'content-reveal',
] as const;
export type AnalyticsAction = typeof ANALYTICS_ACTIONS[number];
export const ANALYTICS_VITALS = ['LCP', 'CLS', 'INP', 'TTFB'] as const;
export const ANALYTICS_ERRORS = ['uncaught', 'unhandled-rejection'] as const;
export const ANALYTICS_SOURCES = ['direct', 'search', 'social', 'github', 'internal', 'other'] as const;

export type AnalyticsEvent =
  | { kind: 'visit'; page: AnalyticsPage; name: typeof ANALYTICS_SOURCES[number] }
  | { kind: 'pageview'; page: AnalyticsPage; name: 'view' }
  | { kind: 'click'; page: AnalyticsPage; name: AnalyticsAction }
  | { kind: 'vital'; page: AnalyticsPage; name: typeof ANALYTICS_VITALS[number]; value: number }
  | { kind: 'error'; page: AnalyticsPage; name: typeof ANALYTICS_ERRORS[number] };

const pages = new Set<string>(ANALYTICS_PAGES);
const actions = new Set<string>(ANALYTICS_ACTIONS);
const vitals = new Set<string>(ANALYTICS_VITALS);
const errors = new Set<string>(ANALYTICS_ERRORS);
const sources = new Set<string>(ANALYTICS_SOURCES);

export function isAnalyticsAction(value: unknown): value is AnalyticsAction {
  return typeof value === 'string' && actions.has(value);
}

/** Reject extra fields instead of silently forwarding unexpected content. */
export function isAnalyticsEvent(input: unknown): input is AnalyticsEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const item = input as Record<string, unknown>;
  const keys = Object.keys(item);
  if (keys.length !== (item.kind === 'vital' ? 4 : 3)
    || keys.some(key => !['kind', 'page', 'name', ...(item.kind === 'vital' ? ['value'] : [])].includes(key))
    || typeof item.page !== 'string' || !pages.has(item.page) || typeof item.name !== 'string') return false;
  if (item.kind === 'visit') return sources.has(item.name);
  if (item.kind === 'pageview') return item.name === 'view';
  if (item.kind === 'click') return actions.has(item.name);
  if (item.kind === 'error') return errors.has(item.name);
  return item.kind === 'vital' && vitals.has(item.name) && typeof item.value === 'number'
    && Number.isFinite(item.value) && item.value >= 0 && item.value <= (item.name === 'CLS' ? 10 : 600_000);
}

/** Accept a route category only; identifiers, query text and URL paths are never read. */
export function analyticsPage(route: { kind: string }): AnalyticsPage {
  if (route.kind === 'cast-alias') return 'cast';
  return pages.has(route.kind) ? route.kind as AnalyticsPage : 'not-found';
}
