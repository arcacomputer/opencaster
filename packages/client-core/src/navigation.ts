// These helpers are platform independent and can move to a shared Hypersnap
// client package when a mobile client needs the same public URL contract.
import { APP_ORIGIN } from './appOrigins';
import { decodeFeed, encodeFeed, type FeedDefinition } from './customFeeds';

export type ProfileTab = 'casts' | 'replies' | 'media' | 'likes' | 'recasts';
export type SearchKind = 'casts' | 'users';
export type AppRoute =
  | { kind: 'discover' }
  | { kind: 'following'; fid?: number }
  | { kind: 'feeds' }
  | { kind: 'feed'; token: string }
  | { kind: 'bookmarks' }
  | { kind: 'notifications' }
  | { kind: 'channels' }
  | { kind: 'devlog' }
  | { kind: 'settings' }
  | { kind: 'connect' }
  | { kind: 'search'; query: string; searchKind: SearchKind }
  | { kind: 'channel'; channel: string }
  | { kind: 'profile'; identifier?: string; tab?: ProfileTab }
  | { kind: 'cast'; hash: string }
  | { kind: 'cast-alias'; authorIdentifier: string; hashPrefix: string }
  | { kind: 'not-found' };

const MAX_PATH_LENGTH = 256;
const MAX_SEARCH_LENGTH = 2048;
const MAX_FEED_SEARCH_LENGTH = 6500;
const USERNAME = /^[a-zA-Z0-9_.-]{1,128}$/;
const CHANNEL = /^[a-zA-Z0-9_-]{1,64}$/;
const HASH = /^(?:0x)?([a-fA-F0-9]{40})$/;
const ALIAS_HASH = /^0x([a-f0-9]{8,40})$/i;
const RESERVED_NAMES = new Set([
  'following', 'feeds', 'feed', 'bookmarks', 'notifications', 'channels', 'devlog', 'settings', 'connect', 'search', 'profile', 'channel', 'cast',
  'api', 'assets', 'media', 'licenses', '.well-known', '_share',
  'index.html', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'manifest.json', 'manifest.webmanifest', 'sw.js', 'service-worker.js',
  'unknown-dark.png', 'unknown-light.png', 'intervariable.ttf', 'sen-variablefont_wght.ttf', 'quorum-symbol.svg', 'opencaster-symbol.svg', 'third_party_dependency_licenses.txt',
  'opencaster-social-v1.png', 'opencaster-social-v1.svg',
  'opencaster-social-v2.png', 'opencaster-social-v2.svg',
]);

function normalizedHash(hash: string): string | undefined {
  const match = HASH.exec(hash);
  return match ? `0x${match[1].toLowerCase()}` : undefined;
}

function validIdentifier(identifier: string): boolean {
  if (!USERNAME.test(identifier) || identifier === '.' || identifier === '..') return false;
  if (!/^\d+$/.test(identifier)) return true;
  const fid = Number(identifier);
  return Number.isSafeInteger(fid) && fid > 0;
}

function validAliasIdentifier(identifier: string): boolean {
  return validIdentifier(identifier) && !RESERVED_NAMES.has(identifier.toLowerCase());
}

function normalizedAliasHash(hashPrefix: string): string | undefined {
  const match = ALIAS_HASH.exec(hashPrefix);
  return match && match[1].length % 2 === 0 ? `0x${match[1].toLowerCase()}` : undefined;
}

/** Parse only the public client routes; malformed identifiers never reach an API. */
export function parseRoute({ pathname, search }: { pathname: string; search: string }): AppRoute {
  // Route identifiers have an ASCII wire format, so percent escapes are neither
  // needed nor accepted. This also rejects encoded and double-encoded slashes.
  if (pathname.length > MAX_PATH_LENGTH || search.length > (pathname === '/feeds/view' ? MAX_FEED_SEARCH_LENGTH : MAX_SEARCH_LENGTH)
    // eslint-disable-next-line no-control-regex -- Reject raw path controls before parsing or normalization.
    || !pathname.startsWith('/') || /[%\\?#\s\u0000-\u001f\u007f]/.test(pathname)
    // eslint-disable-next-line no-control-regex -- Reject raw query controls before parsing or normalization.
    || (search !== '' && !search.startsWith('?')) || /[\u0000-\u001f\u007f]/.test(search)) {
    return { kind: 'not-found' };
  }

  if (pathname === '/') {
    const params = new URLSearchParams(search);
    if (!params.has('cast')) return { kind: 'discover' };
    const hashes = params.getAll('cast');
    const hash = hashes.length === 1 ? normalizedHash(hashes[0]) : undefined;
    return hash ? { kind: 'cast', hash } : { kind: 'not-found' };
  }
  if (pathname === '/following') {
    const fids = new URLSearchParams(search).getAll('fid');
    if (fids.length === 0) return { kind: 'following' };
    const fid = /^\d+$/.test(fids[0]) ? Number(fids[0]) : Number.NaN;
    return fids.length === 1 && Number.isSafeInteger(fid) && fid > 0
      ? { kind: 'following', fid } : { kind: 'not-found' };
  }
  if (pathname === '/feeds') return { kind: 'feeds' };
  if (pathname === '/feeds/view') {
    const params = new URLSearchParams(search);
    const token = params.get('feed');
    // A shared feed is a public, validated definition. It carries no local
    // account identity, pin state, or opaque settings from the sharing browser.
    if (params.size !== 1 || !token || !decodeFeed(token)) return { kind: 'not-found' };
    return { kind: 'feed', token };
  }
  if (pathname === '/bookmarks') return { kind: 'bookmarks' };
  if (pathname === '/notifications') return { kind: 'notifications' };
  if (pathname === '/channels') return { kind: 'channels' };
  if (pathname === '/devlog') return { kind: 'devlog' };
  if (pathname === '/settings') return { kind: 'settings' };
  // Account identifiers and permission requests never come from a sign-in URL.
  if (pathname === '/connect') return { kind: 'connect' };
  if (pathname === '/search') {
    const params = new URLSearchParams(search);
    const query = params.get('q')?.trim() ?? '';
    const kind = params.get('type') ?? 'casts';
    if (params.getAll('q').length > 1 || params.getAll('type').length > 1 || !['casts', 'users'].includes(kind)
      // eslint-disable-next-line no-control-regex -- Decoded search text must also exclude ASCII control characters.
      || new TextEncoder().encode(query).length > 256 || /[\u0000-\u001f\u007f]/.test(query)) return { kind: 'not-found' };
    return { kind: 'search', query, searchKind: kind as SearchKind };
  }
  const tabs = new URLSearchParams(search).getAll('tab');
  const tab = tabs[0];
  const validTab = tabs.length < 2 && (tab === undefined || ['casts', 'replies', 'media', 'likes', 'recasts'].includes(tab));
  if (pathname === '/profile') return validTab ? { kind: 'profile', ...(tab && tab !== 'casts' ? { tab: tab as ProfileTab } : {}) } : { kind: 'not-found' };

  const segments = pathname.split('/');
  if (segments.length === 2 && validAliasIdentifier(segments[1]) && validTab) {
    return { kind: 'profile', identifier: segments[1].toLowerCase(), ...(tab && tab !== 'casts' ? { tab: tab as ProfileTab } : {}) };
  }
  if (segments.length !== 3) return { kind: 'not-found' };
  const [, kind, identifier] = segments;
  if (kind === 'profile' && validIdentifier(identifier) && validTab) return { kind: 'profile', identifier, ...(tab && tab !== 'casts' ? { tab: tab as ProfileTab } : {}) };
  if (kind === 'channel' && CHANNEL.test(identifier)) return { kind: 'channel', channel: identifier };
  if (kind === 'cast') {
    const hash = normalizedHash(identifier);
    if (hash) return { kind: 'cast', hash };
  }
  if (validAliasIdentifier(kind)) {
    const hashPrefix = normalizedAliasHash(identifier);
    if (hashPrefix) return { kind: 'cast-alias', authorIdentifier: kind.toLowerCase(), hashPrefix };
  }
  return { kind: 'not-found' };
}

/** Stable profile links use the FID, so a later username change keeps working. */
export function profilePath(fid: number, tab: ProfileTab = 'casts'): string {
  if (!Number.isSafeInteger(fid) || fid <= 0) throw new Error('Invalid profile FID.');
  if (!['casts', 'replies', 'media', 'likes', 'recasts'].includes(tab)) throw new Error('Invalid profile tab.');
  return `/profile/${fid}${tab === 'casts' ? '' : `?tab=${tab}`}`;
}

export function searchPath(query = '', kind: SearchKind = 'casts'): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  if (kind !== 'casts') params.set('type', kind);
  const path = `/search${params.size ? `?${params}` : ''}`;
  if (parseLocalPath(path).kind !== 'search') throw new Error('Invalid search.');
  return path;
}

/** Public follow graphs can be browsed without connecting the target account. */
export function followingPath(fid?: number): string {
  if (fid === undefined) return '/following';
  if (!Number.isSafeInteger(fid) || fid <= 0) throw new Error('Invalid following FID.');
  return `/following?fid=${fid}`;
}

/** Share definitions explicitly; browser-local feed IDs and pins never travel. */
export function feedPath(definition: FeedDefinition): string {
  return `/feeds/view?feed=${encodeFeed(definition)}`;
}

/** Only split local route paths; callers never resolve a supplied host. */
export function parseLocalPath(path: string): AppRoute {
  const separator = path.indexOf('?');
  return parseRoute({ pathname: separator < 0 ? path : path.slice(0, separator), search: separator < 0 ? '' : path.slice(separator) });
}

/** Sign-in can return only to a recognized local page, never another sign-in. */
export function connectReturnPath(value: unknown): string {
  if (typeof value !== 'string') return '/';
  const route = parseLocalPath(value);
  return route.kind === 'not-found' || route.kind === 'connect' ? '/' : routePath(route);
}

export function routePath(route: AppRoute): string {
  if (route.kind === 'cast') return castPath(route.hash);
  if (route.kind === 'cast-alias') return castAliasPath(route.authorIdentifier, route.hashPrefix);
  if (route.kind === 'channel') return `/channel/${route.channel}`;
  if (route.kind === 'search') return searchPath(route.query, route.searchKind);
  if (route.kind === 'following') return followingPath(route.fid);
  if (route.kind === 'feed') {
    const definition = decodeFeed(route.token);
    if (!definition) throw new Error('Invalid feed.');
    return feedPath(definition);
  }
  if (route.kind === 'profile') return `${route.identifier ? `/profile/${route.identifier}` : '/profile'}${route.tab && route.tab !== 'casts' ? `?tab=${route.tab}` : ''}`;
  return route.kind === 'discover' || route.kind === 'not-found' ? '/' : `/${route.kind}`;
}

export function castPath(hash: string): string {
  const normalized = normalizedHash(hash);
  if (!normalized) throw new Error('Invalid cast hash.');
  return `/cast/${normalized}`;
}

type CastLinkTarget = { hash: string; author: { fid: number; username: string } };

/** Farcaster's public path shape, using a known cast's author and hash prefix.
 * The full-hash form is available when a choice must identify one exact cast.
 * Resolving a short link still requires the author's available Hypersnap history.
 */
export function castPermalink(cast: CastLinkTarget, { fullHash = false }: { fullHash?: boolean } = {}): string {
  const hash = normalizedHash(cast.hash);
  if (!hash) throw new Error('Invalid cast hash.');
  const { fid, username } = cast.author;
  if (!Number.isSafeInteger(fid) || fid <= 0) throw new Error('Invalid cast author FID.');
  // Numeric names would be parsed as FIDs; missing, reserved or malformed
  // usernames therefore use the actual FID instead of changing author scope.
  const identifier = typeof username === 'string' && validAliasIdentifier(username) && !/^\d+$/.test(username) ? username : String(fid);
  return castAliasPath(identifier, fullHash ? hash : hash.slice(0, 10));
}

/** Match only a cast already known in this tab; this never resolves an author.
 * Alternate names verified by the API must retain their separately verified
 * alias-to-cast association rather than inferring identity from a hash prefix.
 */
export function matchesCastRoute(route: AppRoute, cast: CastLinkTarget): boolean {
  const hash = normalizedHash(cast.hash);
  if (!hash || !Number.isSafeInteger(cast.author?.fid) || cast.author.fid <= 0) return false;
  if (route.kind === 'cast') return normalizedHash(route.hash) === hash;
  if (route.kind !== 'cast-alias' || !validAliasIdentifier(route.authorIdentifier)) return false;
  const prefix = normalizedAliasHash(route.hashPrefix);
  if (!prefix || !hash.startsWith(prefix)) return false;
  return /^\d+$/.test(route.authorIdentifier)
    ? Number(route.authorIdentifier) === cast.author.fid
    : typeof cast.author.username === 'string' && route.authorIdentifier.toLowerCase() === cast.author.username.toLowerCase();
}

/** Validated author-scoped paths also support exact full-hash disambiguation. */
export function castAliasPath(authorIdentifier: string, hashPrefix: string): string {
  const normalized = normalizedAliasHash(hashPrefix);
  if (!validAliasIdentifier(authorIdentifier) || !normalized) throw new Error('Invalid author-scoped cast path.');
  return `/${authorIdentifier.toLowerCase()}/${normalized}`;
}

/** Public share links always use our canonical origin, including on previews. */
export function publicUrl(path: string): string {
  if (parseLocalPath(path).kind === 'not-found') throw new Error('Invalid public path.');
  return `${APP_ORIGIN}${path}`;
}
