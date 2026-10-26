import { describe, expect, it } from 'vitest';
import { castPath, castAliasPath, castPermalink, matchesCastRoute, parseRoute, profilePath, publicUrl, routePath, searchPath, parseLocalPath, connectReturnPath, feedPath, followingPath } from './navigation';
import { encodeFeed, type FeedDefinition } from './customFeeds';

const hash = '0x0123456789abcdef0123456789abcdef01234567';
const route = (pathname: string, search = '') => parseRoute({ pathname, search });
const feed: FeedDefinition = { version: 1, name: 'Builders', sources: [{ kind: 'user', fid: 42 }], order: 'newest', filters: { includeWords: [], excludeWords: [], hideReplies: false, imagesOnly: false } };

describe('public Hypersnap routes', () => {
  it('distinguishes feed and own-profile routes', () => {
    expect(route('/')).toEqual({ kind: 'discover' });
    expect(route('/following')).toEqual({ kind: 'following' });
    expect(route('/feeds')).toEqual({ kind: 'feeds' });
    expect(route('/bookmarks')).toEqual({ kind: 'bookmarks' });
    expect(route('/profile')).toEqual({ kind: 'profile' });
    expect(route('/connect')).toEqual({ kind: 'connect' });
  });

  it('accepts bounded usernames and positive safe FIDs without looking them up', () => {
    for (const identifier of ['1234', String(Number.MAX_SAFE_INTEGER), 'alice', 'alice.eth', 'alice-base_1']) {
      expect(route(`/profile/${identifier}`)).toEqual({ kind: 'profile', identifier });
    }
    expect(route(`/profile/${'a'.repeat(128)}`).kind).toBe('profile');
  });

  it('requires full cast hashes and normalizes uppercase hex and an optional 0x prefix', () => {
    expect(route(`/cast/${hash}`)).toEqual({ kind: 'cast', hash });
    expect(route(`/cast/${hash.slice(2).toUpperCase()}`)).toEqual({ kind: 'cast', hash });
  });

  it('preserves old shared cast links while rejecting ambiguous or invalid legacy hashes', () => {
    expect(route('/', `?cast=${hash}`)).toEqual({ kind: 'cast', hash });
    expect(route('/', `?utm_source=share&cast=${hash.slice(2).toUpperCase()}`)).toEqual({ kind: 'cast', hash });
    for (const search of ['?cast=', '?cast=0x1234', `?cast=${hash}&cast=${hash}`, '?cast=%2f', '?cast=%']) {
      expect(route('/', search)).toEqual({ kind: 'not-found' });
    }
    // A query on another route must not replace its explicit path target.
    expect(route('/profile/1234', `?cast=${hash}`)).toEqual({ kind: 'profile', identifier: '1234' });
  });

  it('supports the same bounded channel identifiers as the Hypersnap API', () => {
    for (const channel of ['quilibrium', 'art_2026', 'client-dev', 'A'.repeat(64)]) {
      expect(route(`/channel/${channel}`)).toEqual({ kind: 'channel', channel });
    }
    for (const channel of ['', 'a'.repeat(65), 'a.b', '@art', 'a/b']) {
      expect(route(`/channel/${channel}`)).toEqual({ kind: 'not-found' });
    }
  });

  it('preserves feature routes and profile tabs across direct loads and thread backgrounds', () => {
    expect(route('/notifications')).toEqual({ kind: 'notifications' });
    expect(route('/channels')).toEqual({ kind: 'channels' });
    expect(route('/devlog')).toEqual({ kind: 'devlog' });
    expect(routePath(parseLocalPath('/devlog'))).toBe('/devlog');
    expect(publicUrl('/devlog')).toBe('https://opencaster.org/devlog');
    expect(route('/profile/1234', '?tab=replies')).toEqual({ kind: 'profile', identifier: '1234', tab: 'replies' });
    expect(route('/profile', '?tab=media')).toEqual({ kind: 'profile', tab: 'media' });
    expect(route('/profile/1234', '?tab=other').kind).toBe('not-found');
    expect(route('/profile/1234', '?tab=media&tab=casts').kind).toBe('not-found');
    expect(profilePath(1234, 'media')).toBe('/profile/1234?tab=media');
    const search = searchPath('hello 🌱', 'users');
    expect(parseLocalPath(search)).toEqual({ kind: 'search', query: 'hello 🌱', searchKind: 'users' });
    expect(routePath(parseLocalPath(search))).toBe(search);
    expect(routePath(parseLocalPath('/profile/1234?tab=media'))).toBe('/profile/1234?tab=media');
    for (const tab of ['likes', 'recasts'] as const) {
      expect(route('/profile', `?tab=${tab}`)).toEqual({ kind: 'profile', tab });
      expect(route('/profile/1234', `?tab=${tab}`)).toEqual({ kind: 'profile', identifier: '1234', tab });
      expect(profilePath(1234, tab)).toBe(`/profile/1234?tab=${tab}`);
      expect(routePath(parseLocalPath(profilePath(1234, tab)))).toBe(`/profile/1234?tab=${tab}`);
      expect(route('/profile/1234', `?tab=${tab}&tab=casts`).kind).toBe('not-found');
    }
  });

  it('bounds search input and refuses ambiguous or unsupported search modes', () => {
    expect(route('/search')).toEqual({ kind: 'search', query: '', searchKind: 'casts' });
    for (const query of ['?q=a&q=b', '?type=wallets', '?type=casts&type=users', '?q=%00', `?q=${'a'.repeat(257)}`]) expect(route('/search', query).kind).toBe('not-found');
    expect(() => searchPath('😀'.repeat(65))).toThrow('Invalid search');
    expect(() => publicUrl('/profile/1234?tab=bad')).toThrow();
  });

  it('rejects malformed or oversized targets before an API can be selected', () => {
    for (const pathname of [
      '', 'profile/1234', '//evil.example', '/unknown/extra/path', '/following/extra', '/following/',
      '/profile/', '/profile/0', '/profile/000', '/profile/9007199254740992',
      '/profile/1234/extra', `/profile/${'a'.repeat(129)}`, '/profile/@alice',
      '/profile/.', '/profile/..', '/profile/alice%2fcast', '/profile/alice%5Ccast',
      '/profile/alice%252fcast', '/profile/alice%', '/profile/alice\\cast',
      '/profile/alice?cast=x', '/profile/alice#cast', '/profile/alice smith',
      '/profile/alice\n', '/profile/álîce', '/profile/😀',
      '/cast/0x1234', `/cast/0x${'z'.repeat(40)}`, `/cast/${hash}0`,
      `/${'a'.repeat(300)}`,
    ]) expect(route(pathname), pathname).toEqual({ kind: 'not-found' });
    expect(route('/', `?tracking=${'a'.repeat(2048)}`)).toEqual({ kind: 'not-found' });
    expect(route('/', 'cast=value')).toEqual({ kind: 'not-found' });
    expect(route('/', '?tracking=\u0000')).toEqual({ kind: 'not-found' });
  });
});

describe('public custom feed routes', () => {
  it('restores shared feed definitions through direct loads, history and sign-in returns', () => {
    const token = encodeFeed(feed);
    const path = feedPath(feed);
    expect(path).toBe(`/feeds/view?feed=${token}`);
    expect(parseLocalPath(path)).toEqual({ kind: 'feed', token });
    expect(routePath(parseLocalPath(path))).toBe(path);
    expect(connectReturnPath(path)).toBe(path);
    expect(publicUrl(path)).toBe(`https://opencaster.org${path}`);
    expect(routePath(parseLocalPath('/feeds'))).toBe('/feeds');
    expect(connectReturnPath('/feeds')).toBe('/feeds');
    expect(publicUrl('/feeds')).toBe('https://opencaster.org/feeds');
  });

  it('rejects malformed, ambiguous and unsupported feed definitions', () => {
    const token = encodeFeed(feed);
    const unsupported = btoa(JSON.stringify({ ...feed, version: 2 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    for (const search of ['', '?feed=', '?feed=invalid', `?feed=${unsupported}`, `?feed=${token}&feed=${token}`, `?feed=${token}&unknown=private`, `?feed=${token}&fid=42`, `?feed=${'a'.repeat(6001)}`, `?feed=${'a'.repeat(6500)}`, '?feed=%00', '?feed=%', '?feed=../../settings']) {
      expect(route('/feeds/view', search), search).toEqual({ kind: 'not-found' });
    }
    for (const path of ['/feeds/', '/feeds/view/extra', '/feed', '/feed/0x01234567', '/feeds/0x01234567']) expect(parseLocalPath(path)).toEqual({ kind: 'not-found' });
    expect(() => publicUrl('/feeds/view?feed=invalid')).toThrow('Invalid public path');
  });

  it('allows longer validated feed definitions without widening other route query limits', () => {
    const definition: FeedDefinition = { ...feed, sources: Array.from({ length: 8 }, (_, index) => ({ kind: 'user', fid: index + 42 })), filters: { ...feed.filters,
      includeWords: Array.from({ length: 10 }, (_, index) => `include-${index}-${'a'.repeat(52)}`),
      excludeWords: Array.from({ length: 10 }, (_, index) => `exclude-${index}-${'b'.repeat(52)}`),
    } };
    const path = feedPath(definition);
    expect(path.length).toBeGreaterThan(2048);
    expect(parseLocalPath(path)).toEqual({ kind: 'feed', token: encodeFeed(definition) });
    expect(routePath(parseLocalPath(path))).toBe(path);
    for (const pathname of ['/', '/feeds', '/following', '/search']) expect(route(pathname, `?feed=${encodeFeed(definition)}`)).toEqual({ kind: 'not-found' });
  });

  it('opens another public account’s following feed without account authorization queries', () => {
    expect(followingPath()).toBe('/following');
    for (const fid of [42, Number.MAX_SAFE_INTEGER]) {
      expect(followingPath(fid)).toBe(`/following?fid=${fid}`);
      expect(parseLocalPath(followingPath(fid))).toEqual({ kind: 'following', fid });
      expect(routePath(parseLocalPath(followingPath(fid)))).toBe(followingPath(fid));
      expect(connectReturnPath(followingPath(fid))).toBe(followingPath(fid));
    }
    expect(route('/following', '?fid=0042&scopes=11&return=https://example.org')).toEqual({ kind: 'following', fid: 42 });
    expect(routePath(route('/following', '?fid=0042&scopes=11'))).toBe('/following?fid=42');
    expect(publicUrl(followingPath(42))).toBe('https://opencaster.org/following?fid=42');
    for (const search of ['?fid=', '?fid=0', '?fid=000', '?fid=-1', '?fid=1.2', '?fid=+42', '?fid=1e2', '?fid=NaN', '?fid=9007199254740992', '?fid=42&fid=42', '?fid=%00', '?fid=42%20']) expect(route('/following', search)).toEqual({ kind: 'not-found' });
    for (const fid of [0, -1, 1.2, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) expect(() => followingPath(fid)).toThrow('Invalid following FID');
  });
});

describe('sign-in navigation', () => {
  it('keeps sign-in URLs independent of account, permission and redirect query parameters', () => {
    expect(route('/connect', '?fid=1234&scopes=1,2,11&return=https://example.org')).toEqual({ kind: 'connect' });
    expect(routePath(route('/connect', '?fid=1234'))).toBe('/connect');
  });

  it('accepts only canonical recognized local return pages and prevents sign-in loops', () => {
    expect(connectReturnPath('/search?q=hello%20world&type=users')).toBe('/search?q=hello+world&type=users');
    expect(connectReturnPath(`/cast/${hash}`)).toBe(`/cast/${hash}`);
    expect(connectReturnPath('/profile/1234?tab=likes')).toBe('/profile/1234?tab=likes');
    for (const value of [undefined, null, {}, 'https://example.org', '//example.org', '/\\example.org', '/connect', '/connect?return=/following', '/unknown/extra/path', '/profile%2falice', '/following#x', '/search?q=%00']) expect(connectReturnPath(value)).toBe('/');
  });
});

describe('adaptive author-scoped routes', () => {
  it('accepts username, FID and ENS authors while keeping their scope even for a full hash', () => {
    for (const authorIdentifier of ['gandhionchain', '410023', 'alice.eth', 'jesse.base.eth', 'user_name-1', 'a'.repeat(128)]) {
      expect(route(`/${authorIdentifier}/0xcfd6d3c3`)).toEqual({ kind: 'cast-alias', authorIdentifier, hashPrefix: '0xcfd6d3c3' });
      expect(route(`/${authorIdentifier}/${hash}`)).toEqual({ kind: 'cast-alias', authorIdentifier, hashPrefix: hash });
    }
    expect(route('/GandhiOnChain/0XCFD6D3C3')).toEqual({ kind: 'cast-alias', authorIdentifier: 'gandhionchain', hashPrefix: '0xcfd6d3c3' });
  });

  it('accepts byte-aligned prefixes of 8 through 40 hex characters and rejects other hash formats', () => {
    for (let length = 8; length <= 40; length += 2) expect(route(`/alice/0x${'a'.repeat(length)}`)).toEqual({ kind: 'cast-alias', authorIdentifier: 'alice', hashPrefix: `0x${'a'.repeat(length)}` });
    for (const value of ['0x', '0x1234567', '0x123456789', `0x${'a'.repeat(39)}`, `0x${'a'.repeat(41)}`, `0x${'a'.repeat(42)}`, 'cfd6d3c3', hash.slice(2), '0xcfd6d3cz', '0xcfd6d3c3-extra', '0xcfd6d3c3/extra']) {
      expect(route(`/alice/${value}`)).toEqual({ kind: 'not-found' }); expect(() => castAliasPath('alice', value)).toThrow();
    }
  });

  it('maps root profile aliases to the existing canonical profile route without reading authorization queries', () => {
    expect(route('/Alice')).toEqual({ kind: 'profile', identifier: 'alice' });
    expect(route('/410023')).toEqual({ kind: 'profile', identifier: '410023' });
    expect(route('/JESSE.BASE.ETH', '?tab=likes')).toEqual({ kind: 'profile', identifier: 'jesse.base.eth', tab: 'likes' });
    expect(routePath(route('/alice', '?fid=99&scopes=1,2,11&return=https://example.org'))).toBe('/profile/alice');
    expect(route('/alice', '?tab=likes&tab=casts')).toEqual({ kind: 'not-found' });
    expect(route('/alice', '?tab=unknown')).toEqual({ kind: 'not-found' });
  });

  it('preserves all reserved route namespaces and static names rather than treating them as authors', () => {
    const appNames = ['following', 'feeds', 'feed', 'bookmarks', 'notifications', 'channels', 'devlog', 'settings', 'connect', 'search', 'profile', 'channel', 'cast'];
    const staticNames = ['api', 'assets', 'media', 'licenses', '.well-known', 'index.html', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'manifest.json', 'manifest.webmanifest', 'sw.js', 'service-worker.js', 'unknown-dark.png', 'unknown-light.png', 'InterVariable.ttf', 'Sen-VariableFont_wght.ttf', 'quorum-symbol.svg', 'opencaster-symbol.svg', 'THIRD_PARTY_DEPENDENCY_LICENSES.txt'];
    for (const name of [...appNames, ...staticNames]) {
      expect(route(`/${name.toUpperCase()}`)).toEqual({ kind: 'not-found' });
      expect(route(`/${name.toUpperCase()}/0xcfd6d3c3`)).toEqual({ kind: 'not-found' });
      expect(() => castAliasPath(name, '0xcfd6d3c3')).toThrow();
    }
    for (const name of staticNames) expect(route(`/${name}`)).toEqual({ kind: 'not-found' });
    expect(route('/profile/alice')).toEqual({ kind: 'profile', identifier: 'alice' });
    expect(route('/channel/0xcfd6d3c3')).toEqual({ kind: 'channel', channel: '0xcfd6d3c3' });
    expect(route('/profile/0xcfd6d3c3')).toEqual({ kind: 'profile', identifier: '0xcfd6d3c3' });
    expect(route('/cast/0xcfd6d3c3')).toEqual({ kind: 'not-found' });
    expect(route(`/cast/${hash}`)).toEqual({ kind: 'cast', hash });
  });

  it('fails closed for malformed, encoded, ambiguous and external adaptive paths', () => {
    for (const author of ['', '.', '..', '0', '000', '9007199254740992', '@alice', 'a'.repeat(129), 'alice%2fcast', 'alice%252fcast', 'alice%5ccast', 'alice\\cast', 'alice name', 'alice\n', 'álîce', 'https:']) {
      expect(route(`/${author}/0xcfd6d3c3`)).toEqual({ kind: 'not-found' }); expect(() => castAliasPath(author, '0xcfd6d3c3')).toThrow();
    }
    for (const path of ['/alice/', '/alice//0xcfd6d3c3', '//alice/0xcfd6d3c3', '/alice/0xcfd6d3c3/', '/alice/0xcfd6d3c3#x', '/alice/0xcfd6d3c3%2fextra', 'https://example.org/alice/0xcfd6d3c3']) expect(parseLocalPath(path)).toEqual({ kind: 'not-found' });
  });

  it('keeps aliases as safe local return targets while sharing known casts by canonical full hash', () => {
    const alias = route('/GandhiOnChain/0XCFD6D3C3', '?fid=1&scopes=1,2,11&return=https://example.org');
    expect(routePath(alias)).toBe('/gandhionchain/0xcfd6d3c3');
    expect(connectReturnPath('/gandhionchain/0xcfd6d3c3?fid=1&scopes=11')).toBe('/gandhionchain/0xcfd6d3c3');
    expect(connectReturnPath('/alice')).toBe('/profile/alice');
    expect(publicUrl(castPath(hash))).toBe(`https://opencaster.org/cast/${hash}`);
    expect(() => castPath('0xcfd6d3c3')).toThrow('Invalid cast hash');
  });
});

describe('share link construction', () => {
  it('shares known casts with the same author and eight-hex-character path as Farcaster', () => {
    const cast = { hash: '0x8D336914CDDB739974EB0C2E820FA744054C9439', author: { fid: 20, username: 'YES2CRYPTO.ETH' } };
    expect(castPermalink(cast)).toBe('/yes2crypto.eth/0x8d336914');
    expect(publicUrl(castPermalink(cast))).toBe('https://opencaster.org/yes2crypto.eth/0x8d336914');
    expect(parseLocalPath(castPermalink(cast))).toEqual({ kind: 'cast-alias', authorIdentifier: 'yes2crypto.eth', hashPrefix: '0x8d336914' });
    expect(castPermalink(cast, { fullHash: true })).toBe(`/yes2crypto.eth/${cast.hash.toLowerCase()}`);
  });

  it('uses the actual FID when a username cannot safely identify the cast author', () => {
    for (const username of ['', '1234', 'cast', 'CONNECT', 'alice/bob', '@alice', '.', '..', 'alice%2fbob', 'a'.repeat(129)]) {
      expect(castPermalink({ hash, author: { fid: 20, username } })).toBe('/20/0x01234567');
    }
    expect(() => castPermalink({ hash: '0x01234567', author: { fid: 20, username: 'alice' } })).toThrow('Invalid cast hash');
    for (const fid of [0, -1, 1.2, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => castPermalink({ hash, author: { fid, username: 'alice' } })).toThrow('Invalid cast author FID');
    }
  });

  it('matches known routes only when their full hash or scoped author and prefix agree', () => {
    const cast = { hash, author: { fid: 20, username: 'alice' } };
    expect(matchesCastRoute(route(`/cast/${hash}`), cast)).toBe(true);
    expect(matchesCastRoute(route('/alice/0x01234567'), cast)).toBe(true);
    expect(matchesCastRoute(route('/20/0x01234567'), cast)).toBe(true);
    expect(matchesCastRoute(route(`/alice/${hash}`), cast)).toBe(true);
    for (const path of ['/bob/0x01234567', '/21/0x01234567', '/alice/0x12345678', `/cast/0x${'a'.repeat(40)}`, '/profile/alice']) {
      expect(matchesCastRoute(parseLocalPath(path), cast), path).toBe(false);
    }
    expect(matchesCastRoute(route('/alice/0x01234567'), { ...cast, hash: '0x01234567' })).toBe(false);
    expect(matchesCastRoute(route('/alice/0x01234567'), { ...cast, author: { fid: 0, username: 'alice' } })).toBe(false);
  });

  it('produces stable FID and full normalized hash paths at the canonical domain', () => {
    expect(profilePath(1234)).toBe('/profile/1234');
    expect(castPath(hash.slice(2).toUpperCase())).toBe(`/cast/${hash}`);
    expect(publicUrl(profilePath(1234))).toBe('https://opencaster.org/profile/1234');
    expect(publicUrl(castPath(hash))).toBe(`https://opencaster.org/cast/${hash}`);
    expect(publicUrl('/profile')).toBe('https://opencaster.org/profile');
  });

  it('does not create external, malformed, or ambiguous share destinations', () => {
    for (const fid of [0, -1, 1.2, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => profilePath(fid)).toThrow('Invalid profile FID');
    }
    for (const value of ['', '0x1234', `${hash}0`, `https://evil.example/${hash}`]) {
      expect(() => castPath(value)).toThrow('Invalid cast hash');
    }
    for (const path of ['https://evil.example', '//evil.example', '/profile/../following', '/profile%2falice', '/?cast=x', '/profile#x']) {
      expect(() => publicUrl(path)).toThrow('Invalid public path');
    }
  });
});
