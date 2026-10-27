import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeFeed, type FeedDefinition } from '../src/lib/customFeeds';
import { handleRequest, type Env } from './index';
import { renderSharePng } from './sharePng';

// Exercise the real public lookup, metadata, routing and SVG layout. Only the
// Worker-only Wasm rasterizer is replaced; its input remains observable here.
vi.mock('./sharePng', () => ({ renderSharePng: vi.fn() }));

const ORIGIN = 'https://opencaster.org';
const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const PNG = new Uint8Array(readFileSync(new URL('../public/opencaster-social-v2.png', import.meta.url)));
const FONT = new Uint8Array([0, 1, 2, 3]);
const FONT_URL = `${ORIGIN}/InterVariable.ttf`;
const GENERIC_IMAGE = `${ORIGIN}/opencaster-social-v2.png`;
const CHANNEL_PATH = '/_share/v1/channel/art.png';
const channel = { id: 'art', name: 'Art & builders', description: 'Share sketches, open art and creative tools.', member_count: 321 };
const definition: FeedDefinition = {
  version: 1, name: 'Creative builders', sources: [{ kind: 'channel', channel: 'art' }, { kind: 'user', fid: 42 }],
  order: 'newest', filters: { includeWords: ['art'], excludeWords: ['spam'], hideReplies: true, imagesOnly: true },
};
const feedPath = (feed: FeedDefinition) => `/feeds/view?feed=${encodeFeed(feed)}`;
const imagePath = (feed: FeedDefinition) => `/_share/v1/feed.png?feed=${encodeFeed(feed)}`;
const decode = (value: string) => value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const head = (html: string) => /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? '';
function meta(html: string, key: string): string {
  const matches = [...head(html).matchAll(/<meta\b[^>]*\b(?:name|property)="([^"]+)"[^>]*>/g)].filter(match => match[1] === key);
  expect(matches, `one initial ${key} tag`).toHaveLength(1);
  return decode(/\bcontent="([^"]*)"/.exec(matches[0][0])?.[1] ?? '');
}
const canonical = (html: string) => decode(/<link rel="canonical" href="([^"]*)"/.exec(head(html))?.[1] ?? '');
function publicToken(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
function fixture(value: unknown = { channel }) {
  const network = vi.fn(async (_input: string, _init?: RequestInit) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
  const assets = vi.fn(async (request: Request) => {
    if (request.url === FONT_URL) return new Response(new Uint8Array(FONT).buffer);
    if (request.url === GENERIC_IMAGE) return new Response(new Uint8Array(PNG).buffer, { headers: { 'Content-Type': 'image/png' } });
    return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: '"shell"' } });
  });
  const env: Env = { ASSETS: { fetch: assets } };
  vi.stubGlobal('fetch', network);
  vi.stubGlobal('caches', undefined);
  return { env, network, assets };
}
async function document(path: string, env: Env, userAgent = 'TelegramBot (like TwitterBot)') {
  const response = await handleRequest(new Request(`${ORIGIN}${path}`, { headers: { 'User-Agent': userAgent, Cookie: 'session=private', Authorization: 'Bearer private' } }), env);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('ETag')).toBeNull();
  return { response, html: await response.text() };
}
function consistentMetadata(html: string, path: string, expectedImage: string) {
  expect(meta(html, 'twitter:title')).toBe(meta(html, 'og:title'));
  expect(meta(html, 'og:description')).toBe(meta(html, 'description'));
  expect(meta(html, 'twitter:description')).toBe(meta(html, 'description'));
  expect(meta(html, 'og:image')).toBe(`${ORIGIN}${expectedImage}`);
  expect(meta(html, 'twitter:image')).toBe(meta(html, 'og:image'));
  expect(meta(html, 'og:image:secure_url')).toBe(meta(html, 'og:image'));
  expect(meta(html, 'og:image:type')).toBe('image/png');
  expect(meta(html, 'og:image:width')).toBe('1200');
  expect(meta(html, 'og:image:height')).toBe('630');
  expect(canonical(html)).toBe(`${ORIGIN}${path}`);
  expect(meta(html, 'og:url')).toBe(canonical(html));
}
beforeEach(() => { vi.mocked(renderSharePng).mockReset().mockResolvedValue(PNG); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('channel and feed initial sharing documents', () => {
  it.each(['TelegramBot (like TwitterBot)', 'Twitterbot/1.0', 'Mozilla/5.0'])('describes the actual channel before JavaScript for %s', async userAgent => {
    const { env, network } = fixture();
    const { html, response } = await document('/channel/art?utm_source=share&title=forged', env, userAgent);
    expect(meta(html, 'og:title')).toContain(channel.name);
    expect(meta(html, 'og:title')).toContain('Opencaster');
    expect(meta(html, 'og:description')).toBe(channel.description);
    consistentMetadata(html, '/channel/art', CHANNEL_PATH);
    expect(response.headers.get('Link')).toBe(`<${ORIGIN}/channel/art>; rel="canonical"`);
    expect(network).toHaveBeenCalledOnce();
    const [input, init] = network.mock.calls[0];
    const target = new URL(input);
    expect(target.origin).toBe('https://haatz.quilibrium.com');
    expect(target.pathname).toBe('/v2/farcaster/channel');
    expect([...target.searchParams]).toEqual([['id', 'art'], ['type', 'id']]);
    expect(new Headers(init?.headers).has('Cookie')).toBe(false);
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    expect(html).not.toContain('forged');
  });

  it('describes a shared recipe and its filters without node configuration or browser storage', async () => {
    const { env, network } = fixture();
    env.HYPERSNAP_ORIGIN = 'https://invalid.example/private-path';
    const getItem = vi.fn(() => { throw new Error('Do not read browser-local feeds.'); });
    vi.stubGlobal('localStorage', { getItem });
    vi.stubGlobal('sessionStorage', { getItem });
    const path = feedPath(definition);
    const { html } = await document(path, env);
    expect(meta(html, 'og:title')).toContain(definition.name);
    const description = meta(html, 'og:description');
    for (const label of ['Channel /art', 'Account FID 42', 'Newest loaded first', 'Includes any phrase', 'Excludes any phrase', 'Images only', 'Replies hidden']) expect(description).toContain(label);
    expect(description).not.toMatch(/saved|signed in|complete global/i);
    consistentMetadata(html, path, imagePath(definition));
    expect(network).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });

  it('escapes hostile channel names, feed names and phrase text inside single metadata tags', async () => {
    const name = '"><img src=x> $&';
    const topic = '" onload="danger <script>bad()</script> & $`';
    const { env, network } = fixture({ channel: { ...channel, name, description: topic } });
    const feed: FeedDefinition = { ...definition, name, filters: { ...definition.filters, includeWords: [topic] } };
    for (const path of ['/channel/art', feedPath(feed)]) {
      const { html } = await document(path, env);
      expect(meta(html, 'og:title')).toContain(name);
      expect(meta(html, 'og:description')).toContain(topic);
      expect(head(html)).toContain('&quot;&gt;&lt;img src=x&gt; $&amp;');
      expect(head(html)).not.toContain('<img src=x>');
      expect(head(html)).not.toContain('<script>bad()');
      expect(meta(html, 'twitter:title')).toBe(meta(html, 'og:title'));
    }
    expect(network).toHaveBeenCalledOnce();
  });

  it.each([{}, { channel: { ...channel, id: 'other' } }, { channel: { ...channel, name: 42 } }])('keeps the generic card for missing or mismatched channels: %j', async value => {
    const { env } = fixture(value);
    const { html } = await document('/channel/art', env);
    expect(meta(html, 'og:title')).toBe(meta(HTML, 'og:title'));
    expect(meta(html, 'og:image')).toBe(meta(HTML, 'og:image'));
    expect(canonical(html)).toBe(`${ORIGIN}/channel/art`);
  });

  it.each([
    '/feeds/view', '/feeds/view?feed=invalid', '/feeds/view?feed=AA',
    `/feeds/view?feed=${'a'.repeat(6001)}`,
    `/feeds/view?feed=${publicToken({ ...definition, sources: [] })}`,
    `${feedPath(definition)}&feed=invalid`,
    `${feedPath(definition)}&image=https://attacker.example/image.png`,
    `${feedPath(definition)}&title=Forged`,
    `${feedPath(definition)}&utm_source=telegram`,
  ])('keeps malformed or content-bearing feed query %# generic', async path => {
    const { env, network } = fixture();
    const { html } = await document(path, env);
    expect(meta(html, 'og:title')).toBe(meta(HTML, 'og:title'));
    expect(meta(html, 'og:image')).toBe(meta(HTML, 'og:image'));
    expect(canonical(html)).toBe(`${ORIGIN}/`);
    expect(network).not.toHaveBeenCalled();
  });
});

describe('channel and feed public preview PNGs', () => {
  it.each([
    ['channel', CHANNEL_PATH, ['Art &amp; builders', channel.description]],
    ['feed', imagePath(definition), [definition.name, 'Channel /art', 'Account FID 42']],
  ] as const)('serves a real-layout %s card with fixed font and public PNG headers', async (kind, path, labels) => {
    const { env, network, assets } = fixture({ channel: { ...channel, image_url: 'https://attacker.example/unsafe.png' } });
    const response = await handleRequest(new Request(`${ORIGIN}${path}`, { headers: { Cookie: 'private', Authorization: 'Bearer private' } }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('X-Opencaster-Preview')).toBe(kind);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const body = Buffer.from(await response.arrayBuffer());
    expect([...body.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect([body.readUInt32BE(16), body.readUInt32BE(20)]).toEqual([1200, 630]);
    expect(renderSharePng).toHaveBeenCalledOnce();
    const [svg, font] = vi.mocked(renderSharePng).mock.calls[0];
    expect(svg).toContain('width="1200" height="630"');
    for (const label of labels) expect(svg).toContain(label);
    expect(svg).not.toContain('https://attacker.example');
    expect(font).toEqual(FONT);
    expect(assets).toHaveBeenCalledOnce();
    const assetRequest = assets.mock.calls[0][0];
    expect(assetRequest.url).toBe(FONT_URL);
    expect(assetRequest.method).toBe('GET');
    expect([...assetRequest.headers]).toEqual([]);
    expect(network).toHaveBeenCalledTimes(kind === 'channel' ? 1 : 0);
  });

  it('does not confuse different recipes in the cache and strips unknown schema metadata from canonical keys', async () => {
    const { env, network } = fixture();
    const match = vi.fn().mockResolvedValue(undefined);
    const put = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('caches', { default: { match, put } });
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } };
    const alternate = { ...definition, name: 'Another recipe', sources: [{ kind: 'user' as const, fid: 99 }] };
    const raw = publicToken({ ...definition, name: ` ${definition.name} `, image: 'https://attacker.example/private.png', viewer: { key: 'private' }, filters: { ...definition.filters, tracking: 'discard' } });
    for (const path of [imagePath(definition), imagePath(alternate), `/_share/v1/feed.png?feed=${raw}`]) {
      const response = await handleRequest(new Request(`https://preview.example${path}`, { headers: { Cookie: 'private', Authorization: 'private' } }), env, ctx);
      expect(response.headers.get('X-Opencaster-Preview')).toBe('feed');
    }
    await Promise.all(pending);
    const cacheKey = (feed: FeedDefinition) => `${ORIGIN}${imagePath(feed)}&brand=open-door-v2`;
    const expected = [cacheKey(definition), cacheKey(alternate), cacheKey(definition)];
    expect(match.mock.calls.map(([key]) => (key as Request).url)).toEqual(expected);
    expect(put.mock.calls.map(([key]) => (key as Request).url)).toEqual(expected);
    for (const [key] of [...match.mock.calls, ...put.mock.calls]) {
      expect((key as Request).method).toBe('GET');
      expect([...(key as Request).headers]).toEqual([]);
    }
    expect(network).not.toHaveBeenCalled();
  });

  it.each([
    '/_share/v1/channel/art.png?text=forged',
    '/_share/v1/channel/art.png?image=https://attacker.example/image.png',
    '/_share/v1/channel/art.png?brand=forged',
    '/_share/v1/channel/art/extra.png', '/_share/v1/channel/%61rt.png',
    '/_share/v1/feed.png', '/_share/v1/feed.png?feed=invalid',
    `${imagePath(definition)}&feed=invalid`,
    `${imagePath(definition)}&text=forged`,
    `${imagePath(definition)}&utm_source=telegram`,
    `${imagePath(definition)}&brand=forged`,
    `${imagePath(definition)}&image=https://attacker.example/image.png`,
  ])('rejects image query injection %# before data, asset or cache work', async path => {
    const { env, network, assets } = fixture();
    const match = vi.fn();
    vi.stubGlobal('caches', { default: { match, put: vi.fn() } });
    const response = await handleRequest(new Request(`${ORIGIN}${path}`), env);
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(match).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(assets).not.toHaveBeenCalled();
    expect(renderSharePng).not.toHaveBeenCalled();
  });

  it.each([{}, { channel: { ...channel, id: 'wrong' } }])('serves an uncached generic PNG for an unavailable channel: %j', async value => {
    const { env, assets } = fixture(value);
    const response = await handleRequest(new Request(`${ORIGIN}${CHANNEL_PATH}`), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Opencaster-Preview')).toBe('fallback');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    expect(assets.mock.calls.map(([request]) => request.url)).toEqual([GENERIC_IMAGE]);
    expect(renderSharePng).not.toHaveBeenCalled();
  });

  it.each([CHANNEL_PATH, imagePath(definition)])('serves bodyless image HEAD %# without data, assets, renderer or cache', async path => {
    const { env, network, assets } = fixture();
    const match = vi.fn();
    vi.stubGlobal('caches', { default: { match, put: vi.fn() } });
    const response = await handleRequest(new Request(`${ORIGIN}${path}`, { method: 'HEAD' }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.body).toBeNull();
    expect(network).not.toHaveBeenCalled();
    expect(assets).not.toHaveBeenCalled();
    expect(match).not.toHaveBeenCalled();
    expect(renderSharePng).not.toHaveBeenCalled();
  });
});
