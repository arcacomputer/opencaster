import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRoute } from '../src/lib/navigation';
import { encodeFeed, type FeedDefinition } from '../src/lib/customFeeds';
import { handleRequest, type Env } from './index';
import { canonicalShareUrl, withShareUrl } from './sharing';

const ORIGIN = 'https://opencaster.org';
const HASH = `0x${'ab'.repeat(20)}`;
const FEED: FeedDefinition = { version: 1, name: 'Builders', sources: [{ kind: 'user', fid: 42 }], order: 'newest', filters: { includeWords: [], excludeWords: [], hideReplies: false, imagesOnly: false } };
const FEED_PATH = `/feeds/view?feed=${encodeFeed(FEED)}`;
const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const head = (html: string) => /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? '';
const decode = (value: string) => value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attribute = (tag: string, name: string) => decode(new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? '');
function meta(html: string, key: string): string {
  const matches = [...head(html).matchAll(/<meta\b[^>]*>/g)]
    .map(match => match[0]).filter(tag => attribute(tag, 'name') === key || attribute(tag, 'property') === key);
  expect(matches, `one initial HTML tag for ${key}`).toHaveLength(1);
  return attribute(matches[0], 'content');
}
function canonical(html: string): string {
  const links = [...head(html).matchAll(/<link\b[^>]*>/g)].map(match => match[0]).filter(tag => attribute(tag, 'rel') === 'canonical');
  expect(links).toHaveLength(1);
  return attribute(links[0], 'href');
}
function htmlResponse(extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(HTML, { headers });
}
function fixture() {
  const fetch = vi.fn().mockRejectedValue(new Error('Sharing metadata must not require a network request.'));
  vi.stubGlobal('fetch', fetch);
  const assets = vi.fn(async (_request: Request) => htmlResponse());
  const env: Env = { ASSETS: { fetch: assets } };
  return { fetch, assets, env };
}

afterEach(() => vi.unstubAllGlobals());

describe('initial social sharing document and public assets', () => {
  it('provides consistent Open Graph and large Twitter card metadata before JavaScript executes', () => {
    const title = decode(/<title>([^<]+)<\/title>/.exec(head(HTML))?.[1] ?? '');
    expect(title).toContain('Opencaster');
    expect(meta(HTML, 'og:title')).toBe(title);
    expect(meta(HTML, 'twitter:title')).toBe(title);
    const description = meta(HTML, 'description');
    expect(description).toMatch(/Hypersnap/);
    expect(description).toMatch(/Arca Computer/);
    expect(meta(HTML, 'og:description')).toBe(description);
    expect(meta(HTML, 'twitter:description')).toBe(description);
    expect(meta(HTML, 'og:site_name')).toBe('Opencaster');
    expect(meta(HTML, 'og:type')).toBe('website');
    expect(meta(HTML, 'og:locale')).toBe('en_US');
    expect(meta(HTML, 'twitter:card')).toBe('summary_large_image');
    expect(canonical(HTML)).toBe(`${ORIGIN}/`);
    expect(meta(HTML, 'og:url')).toBe(canonical(HTML));
    const image = meta(HTML, 'og:image');
    expect(image).toBe(`${ORIGIN}/opencaster-social-v2.png`);
    expect(meta(HTML, 'og:image:secure_url')).toBe(image);
    expect(meta(HTML, 'twitter:image')).toBe(image);
    expect(meta(HTML, 'og:image:type')).toBe('image/png');
    expect(meta(HTML, 'og:image:alt')).toContain('Opencaster');
    expect(meta(HTML, 'twitter:image:alt')).toBe(meta(HTML, 'og:image:alt'));
    expect(head(HTML)).not.toMatch(/<script\b/i);
  });

  it('ships a real PNG whose dimensions match the crawler metadata', () => {
    const png = readFileSync(new URL('../public/opencaster-social-v2.png', import.meta.url));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.toString('ascii', 12, 16)).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(Number(meta(HTML, 'og:image:width')));
    expect(png.readUInt32BE(20)).toBe(Number(meta(HTML, 'og:image:height')));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    expect(png.length).toBeLessThan(5 * 1024 * 1024);
  });

  it('allows crawlers and keeps sharing files out of profile routes', () => {
    const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
    expect(robots).toMatch(/^User-agent:\s*\*\s*$/im);
    expect(robots).toMatch(/^Allow:\s*\/\s*$/im);
    expect(robots).not.toMatch(/^Disallow:\s*\/\s*$/im);
    for (const pathname of ['/robots.txt', '/opencaster-social-v1.png', '/opencaster-social-v1.svg', '/opencaster-social-v2.png', '/opencaster-social-v2.svg']) {
      expect(parseRoute({ pathname, search: '' }).kind).toBe('not-found');
    }
  });
});

describe('canonical public sharing URLs', () => {
  it.each([
    ['https://preview.example/?utm_source=telegram#tracking', '/'],
    ['https://preview.example/profile/42?tab=likes&utm_source=x', '/profile/42?tab=likes'],
    ['https://preview.example/Alice?tab=replies&private=discard', '/profile/alice?tab=replies'],
    ['https://preview.example/alice.eth', '/profile/alice.eth'],
    ['https://preview.example/profile/alice.base.eth?tab=media', '/profile/alice.base.eth?tab=media'],
    ['https://preview.example/Alice/0xABCDEF12?utm_source=share', '/alice/0xabcdef12'],
    [`https://preview.example/42/${HASH}`, `/42/${HASH}`],
    [`https://preview.example/cast/${HASH.slice(2).toUpperCase()}`, `/cast/${HASH}`],
    [`https://preview.example/?cast=${HASH}&utm_source=old`, `/cast/${HASH}`],
    ['https://preview.example/channel/art?cursor=private', '/channel/art'],
    ['https://preview.example/devlog?topic=private', '/devlog'],
    ['https://preview.example/feeds?account=private', '/feeds'],
    [`https://preview.example${FEED_PATH}`, FEED_PATH],
    ['https://preview.example/following?fid=0042&scopes=11&private=discard', '/following?fid=42'],
    ['https://preview.example/following?fid=42&fid=99', '/'],
    ['https://preview.example/feeds/view?feed=invalid', '/'],
    [`https://preview.example${FEED_PATH}&feed=invalid`, '/'],
    [`https://preview.example${FEED_PATH}&account=private`, '/'],
    ['https://preview.example/connect?return=https://evil.example&scopes=11', '/connect'],
    ['https://preview.example/search?q=hello+world&type=users&extra=private', '/search?q=hello+world&type=users'],
    ['https://preview.example/search?type=casts&q=hello', '/search?q=hello'],
    ['https://preview.example/unknown/extra/path?next=https://evil.example', '/'],
    ['https://preview.example/profile/alice?tab=likes&tab=recasts', '/'],
    ['https://preview.example/alice%2Fbob?private=value', '/'],
    ['https://preview.example/alice/0xabcdef123', '/'],
  ])('uses the fixed origin and only recognized route fields: %s', (input, path) => {
    expect(canonicalShareUrl(new URL(input))).toBe(`${ORIGIN}${path}`);
  });

  it('escapes HTML attribute separators while preserving the intended search URL', async () => {
    const query = '\"><script>alert(1)</script>& #next';
    const url = new URL('/search', ORIGIN);
    url.searchParams.set('q', query);
    url.searchParams.set('type', 'users');
    url.searchParams.set('unrecognized', 'private');
    const expected = `${ORIGIN}/search?${new URLSearchParams({ q: query, type: 'users' })}`;
    const response = await withShareUrl(htmlResponse(), url, 'GET');
    const html = await response.text();
    expect(canonical(html)).toBe(expected);
    expect(meta(html, 'og:url')).toBe(expected);
    expect(response.headers.get('Link')).toBe(`<${expected}>; rel="canonical"`);
    expect(head(html)).toContain('&amp;type=users');
    expect(head(html)).not.toContain('<script>');
    expect(head(html)).not.toContain('unrecognized');
    expect(meta(html, 'og:description')).toBe(meta(HTML, 'og:description'));
  });

  it('keeps feed definitions and public follow graphs in canonical links with generic metadata', async () => {
    const { fetch, env } = fixture();
    for (const path of ['/feeds', FEED_PATH, '/following?fid=42']) {
      const response = await handleRequest(new Request(`${ORIGIN}${path}`), env);
      const html = await response.text();
      expect(canonical(html)).toBe(`${ORIGIN}${path}`);
      expect(meta(html, 'og:url')).toBe(`${ORIGIN}${path}`);
      expect(response.headers.get('Link')).toBe(`<${ORIGIN}${path}>; rel="canonical"`);
      expect(meta(html, 'og:title')).toBe(meta(HTML, 'og:title'));
      expect(meta(html, 'og:description')).toBe(meta(HTML, 'og:description'));
      expect(meta(html, 'og:description')).not.toContain(FEED.name);
      const headResponse = await handleRequest(new Request(`${ORIGIN}${path}`, { method: 'HEAD' }), env);
      expect(headResponse.body).toBeNull();
      expect(headResponse.headers.get('Link')).toBe(response.headers.get('Link'));
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not rewrite binary assets or HTML error responses', async () => {
    for (const response of [new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } }), new Response('<h1>Missing</h1>', { status: 404, headers: { 'Content-Type': 'text/html' } })]) {
      const original = response.clone();
      const result = await withShareUrl(response, new URL('/profile/alice', ORIGIN), 'GET');
      expect(result).toBe(response);
      expect(result.headers.get('Link')).toBeNull();
      expect(await result.arrayBuffer()).toEqual(await original.arrayBuffer());
    }
  });

  it('removes static validators and lengths for both rewritten GET and matching HEAD responses', async () => {
    for (const method of ['GET', 'HEAD']) {
      const response = await withShareUrl(htmlResponse({ ETag: '"original-shell"', 'Content-Length': String(HTML.length) }), new URL('/alice', ORIGIN), method);
      expect(response.headers.get('ETag')).toBeNull();
      expect(response.headers.get('Content-Length')).toBeNull();
      expect(response.headers.get('Link')).toBe(`<${ORIGIN}/profile/alice>; rel="canonical"`);
      if (method === 'HEAD') {
        expect(response.body).toBeNull();
        expect(await response.text()).toBe('');
      } else expect(canonical(await response.text())).toBe(`${ORIGIN}/profile/alice`);
    }
  });
});

describe('sharing metadata at the Worker boundary', () => {
  it('keeps the generic card when a public profile or cast cannot be loaded, for every user agent', async () => {
    const { fetch, assets, env } = fixture();
    for (const [path, target] of [['/', '/'], ['/alice', '/profile/alice'], ['/42/0xabcdef12?utm_source=telegram', '/42/0xabcdef12'], ['/unknown/extra/path', '/']]) {
      for (const userAgent of ['TelegramBot (like TwitterBot)', 'Twitterbot/1.0', 'Mozilla/5.0']) {
        const response = await handleRequest(new Request(`${ORIGIN}${path}`, { headers: { 'User-Agent': userAgent } }), env);
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'self';");
        expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
        const html = await response.text();
        expect(canonical(html)).toBe(`${ORIGIN}${target}`);
        expect(meta(html, 'og:url')).toBe(canonical(html));
        expect(meta(html, 'og:title')).toBe(meta(HTML, 'og:title'));
        expect(meta(html, 'og:description')).toBe(meta(HTML, 'og:description'));
        expect(meta(html, 'og:image')).toBe(meta(HTML, 'og:image'));
      }
    }
    expect(assets).toHaveBeenCalledTimes(12);
    expect(fetch).toHaveBeenCalled();
  });

  it('serves HEAD canonical headers with no HTML body or upstream lookup', async () => {
    const { fetch, env } = fixture();
    const response = await handleRequest(new Request(`${ORIGIN}/profile/42?tab=likes&utm_source=x`, { method: 'HEAD' }), env);
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get('Link')).toBe(`<${ORIGIN}/profile/42?tab=likes>; rel="canonical"`);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves image bytes/cache headers, permits direct card embedding, and counts card/robots requests as assets', async () => {
    const { fetch } = fixture();
    const writeDataPoint = vi.fn();
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const env: Env = { ANALYTICS: { writeDataPoint }, ASSETS: { fetch: async request => {
      const image = new URL(request.url).pathname.endsWith('.png');
      return new Response(image ? bytes : 'User-agent: *\nAllow: /\n', { headers: { 'Content-Type': image ? 'image/png' : 'text/plain', 'Cache-Control': 'public, max-age=86400', ETag: '"static-file"', ...(image ? { 'Content-Length': String(bytes.length) } : {}) } });
    } } };
    const card = await handleRequest(new Request(`${ORIGIN}/opencaster-social-v2.png`), env);
    expect(new Uint8Array(await card.arrayBuffer())).toEqual(bytes);
    expect(card.headers.get('Content-Type')).toBe('image/png');
    expect(card.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(card.headers.get('ETag')).toBe('"static-file"');
    expect(card.headers.get('Content-Length')).toBe(String(bytes.length));
    expect(card.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(card.headers.get('Link')).toBeNull();
    const robots = await handleRequest(new Request(`${ORIGIN}/robots.txt`), env);
    expect(await robots.text()).toBe('User-agent: *\nAllow: /\n');
    expect(robots.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(writeDataPoint.mock.calls.map(([point]) => point.blobs.slice(0, 3))).toEqual([['request', 'asset', '2xx'], ['request', 'asset', '2xx']]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves legacy redirects before metadata rewriting and keeps API JSON outside the document path', async () => {
    const { assets, env } = fixture();
    const path = '/alice/0xabcdef12?utm_source=old';
    const legacy = await handleRequest(new Request(`https://quorum.arca.computer${path}`), env);
    expect(legacy.status).toBe(308);
    expect(legacy.headers.get('Location')).toBe(`${ORIGIN}${path}`);
    expect(await legacy.text()).toBe('');
    expect(assets).not.toHaveBeenCalled();
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: 'isolated' }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', upstream);
    const api = await handleRequest(new Request(`${ORIGIN}/api/v1/info`), env);
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({ version: 'isolated' });
    expect(api.headers.get('Link')).toBeNull();
    expect(api.headers.get('Cache-Control')).toBe('no-store');
    expect(upstream.mock.calls[0][0]).toBe('https://haatz.quilibrium.com/v1/info');
    expect(assets).not.toHaveBeenCalled();
  });
});
