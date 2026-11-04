import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, type Env } from './index';
import { handleMediaRequest, type MediaEnv } from './media';
import { loadShareData } from './shareData';
import { encodeFeed, type FeedDefinition } from '@opencaster/client-core/customFeeds';
import { previewImageData } from './shareMedia';

const BASE = 'https://opencaster.org';
const hash = 'ab'.repeat(20);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const manifest = (extra: Partial<{ blockedFids: number[]; blockedCasts: string[]; blockedMedia: string[] }> = {}) => JSON.stringify({
  version: 1, blockedFids: [7], blockedCasts: [], blockedMedia: [], ...extra,
});
const base: Env = { ASSETS: { fetch: vi.fn(async () => new Response('<html><head><title>Opencaster</title><meta property="og:image" content="base"></head></html>', { headers: { 'Content-Type': 'text/html' } })) } };

afterEach(() => { vi.unstubAllGlobals(); });

describe('gateway visibility moderation integration', () => {
  it('filters feed, nested conversation and bulk users without changing cursors or counts', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ casts: [{ hash: 'a'.repeat(40), author: { fid: 8 }, replies: [{ fid: '7' }, { fid: 9 }] }], next: { cursor: 'keep' }, total: 3 }))
      .mockResolvedValueOnce(json({ conversation: { cast: { hash: 'a'.repeat(40), author: { fid: 8 } }, replies: [{ cast: { author: { fid: 7 } } }, { cast: { author: { fid: 9 } } }] }, next: { cursor: 'keep' } }))
      .mockResolvedValueOnce(json({ users: [{ fid: 7, username: 'hidden' }, { fid: 8 }], next: { cursor: 'keep' }, total: 2 }));
    vi.stubGlobal('fetch', fetch);
    const env = { ...base, OPENCASTER_MODERATION: manifest() };
    const feed = await handleRequest(new Request(`${BASE}/api/v2/farcaster/feed/trending?limit=25&time_window=24h`), env);
    expect(await feed.json()).toEqual({ casts: [{ hash: 'a'.repeat(40), author: { fid: 8 }, replies: [{ fid: 9 }] }], next: { cursor: 'keep' }, total: 3 });
    const conversation = await handleRequest(new Request(`${BASE}/api/v2/farcaster/cast/conversation?identifier=${hash}&type=hash&reply_depth=3`), env);
    expect(await conversation.json()).toMatchObject({ conversation: { replies: [{ cast: { author: { fid: 9 } } }] }, next: { cursor: 'keep' } });
    const users = await handleRequest(new Request(`${BASE}/api/v2/farcaster/user/bulk?fids=7%2C8`), env);
    expect(await users.json()).toEqual({ users: [{ fid: 8 }], next: { cursor: 'keep' }, total: 2 });
  });

  it('denies blocked single references before reads and fails closed for invalid configuration', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const denied = await handleRequest(new Request(`${BASE}/api/v1/castsByFid?fid=7&pageSize=250&reverse=true`), { ...base, OPENCASTER_MODERATION: manifest() });
    expect(denied.status).toBe(403); expect(fetch).not.toHaveBeenCalled();
    const blockedCast = await handleRequest(new Request(`${BASE}/api/v2/farcaster/cast?identifier=0x${hash}&type=hash`), { ...base, OPENCASTER_MODERATION: manifest({ blockedCasts: [hash] }) });
    expect(blockedCast.status).toBe(403); expect(fetch).not.toHaveBeenCalled();
    const invalid = await handleRequest(new Request(`${BASE}/api/v2/farcaster/feed/trending?limit=25&time_window=24h`), { ...base, OPENCASTER_MODERATION: '' });
    expect(invalid.status).toBe(503); expect(fetch).not.toHaveBeenCalled();
  });

  it('returns only the minimal blocked-user identity stub while preserving signer/name registries and writes', async () => {
    const bytes = new Uint8Array([8, 1, 2, 3]);
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ user: { fid: 7, username: 'hidden', display_name: 'Private', custody_address: `0x${'a'.repeat(40)}`, pfp_url: 'https://bad.test/image', profile: { bio: { text: 'private' } }, follower_count: 42, following_count: 43, viewer_context: { following: true } } }))
      .mockResolvedValueOnce(json({ signers: [{ fid: 7, key: 'public' }] }))
      .mockResolvedValueOnce(json({ fid: 7 }))
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    const env = { ...base, OPENCASTER_MODERATION: manifest() };
    const profile = await handleRequest(new Request(`${BASE}/api/v2/farcaster/user?fid=7`), env);
    expect(await profile.json()).toEqual({ user: { fid: 7, custody_address: `0x${'a'.repeat(40)}`, username: '', display_name: 'Unavailable on Opencaster', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 } });
    for (const path of ['/api/v1/signersByFid?fid=7', '/api/v1/fidByName?name=abc.eth&type=ens']) expect((await handleRequest(new Request(`${BASE}${path}`), env)).status).toBe(200);
    const write = await handleRequest(new Request(`${BASE}/api/v1/submitMessage`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes }), { ...env, OPENCASTER_MODERATION: '' });
    expect(write.status).toBe(200);
    expect(fetch.mock.calls.at(-1)?.[1].body).toEqual(bytes.buffer);
  });

  it('applies current rules to live primary, backup and warm aggregate bytes', async () => {
    const privateEnv = { ...base, OPENCASTER_MODERATION: manifest(), HYPERSNAP_ORIGIN: 'https://primary.test', HYPERSNAP_ORIGIN_TOKEN: 'synthetic-origin-token_0123456789-abcdef', HYPERSNAP_READ_FALLBACK: 'haatz-v1' };
    const fetch = vi.fn().mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({ casts: [{ fid: 7 }, { fid: 8 }], total: 2, next: { cursor: 'unchanged' } }));
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api/v2/farcaster/feed/trending?limit=25&time_window=24h`), privateEnv);
    expect(await response.json()).toEqual({ casts: [{ fid: 8 }], total: 2, next: { cursor: 'unchanged' } });
    const cache = { match: vi.fn().mockResolvedValue(json({ casts: [{ fid: 7 }, { fid: 9 }], total: 2, next: { cursor: 'warm' } })), put: vi.fn() };
    vi.stubGlobal('caches', { default: cache });
    const ctx = { waitUntil: vi.fn() };
    const cached = await handleRequest(new Request(`${BASE}/api/v2/farcaster/feed/trending?limit=25&time_window=24h`), privateEnv, ctx);
    expect(await cached.json()).toEqual({ casts: [{ fid: 9 }], total: 2, next: { cursor: 'warm' } });
    expect(cache.match).toHaveBeenCalledOnce();
  });

  it('denies signed cast-history pages if any native receipt must be removed', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ messages: [{ hash, data: { fid: 8, type: 3, castAddBody: { mentions: [7] } }, dataBytes: 'unchanged', signature: 'unchanged' }], nextPageToken: 'keep' }));
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api/v1/castsByFid?fid=8&pageSize=250&reverse=true`), { ...base, OPENCASTER_MODERATION: manifest() });
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ code: 'content_unavailable', message: 'This content is unavailable on Opencaster.' });
  });

  it('uses generic HTML metadata for blocked identities and rejects actual blocked feed sources', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ user: { fid: 7, username: 'hidden', display_name: 'Private', custody_address: `0x${'a'.repeat(40)}`, profile: { bio: { text: '' } } } })));
    const env = { ...base, OPENCASTER_MODERATION: manifest() };
    const html = await handleRequest(new Request(`${BASE}/profile/hidden`), env);
    expect(await html.text()).not.toContain('Private');
    const recipe: FeedDefinition = { version: 1, name: 'Synthetic account feed', sources: [{ kind: 'following', fid: 7 }], order: 'source', filters: { includeWords: [], excludeWords: [], hideReplies: false, imagesOnly: false } };
    const route = { kind: 'feed' as const, token: encodeFeed(recipe) };
    expect(await loadShareData(route, {})).toMatchObject({ kind: 'feed' });
    expect(await loadShareData(route, env)).toBeUndefined();
  });

  it('rejects blocked full-hash casts and hosted media through the real share resolver and preview reader', async () => {
    const fullHash = `0x${'c'.repeat(40)}`;
    const mediaHash = 'd'.repeat(64);
    const author = { fid: 8, username: 'allowed', display_name: 'Allowed', profile: { bio: { text: '' } }, follower_count: 1, following_count: 2 };
    const cast = { hash: fullHash, author, text: '🌈 !', timestamp: '2026-11-04T12:00:00Z', embeds: [{ url: `${BASE}/media/${mediaHash}` }], mentioned_profiles: [{ fid: 7, username: 'blockedusername' }], mentioned_profiles_ranges: [{ start: 5, end: 5 }] };
    const fetch = vi.fn().mockImplementation(async () => json({ cast }));
    vi.stubGlobal('fetch', fetch);
    const route = { kind: 'cast' as const, hash: fullHash };
    expect(await loadShareData(route, {})).toMatchObject({ kind: 'cast', text: '🌈 @blockedusername!' });
    expect(await loadShareData(route, { ...base, OPENCASTER_MODERATION: manifest() })).toBeUndefined();

    const castBlocked = { ...base, OPENCASTER_MODERATION: manifest({ blockedFids: [], blockedCasts: [fullHash] }) };
    expect(await loadShareData(route, castBlocked)).toBeUndefined();
    expect(fetch.mock.calls[0][0]).toContain(`/v2/farcaster/cast?identifier=${'c'.repeat(40)}&type=hash`);

    fetch.mockClear();
    const bucket = { get: vi.fn(), head: vi.fn(), put: vi.fn() };
    const mediaBlocked = { ...base, MEDIA_BUCKET: bucket, MEDIA_QUOTA: {} as MediaEnv['MEDIA_QUOTA'], OPENCASTER_MODERATION: manifest({ blockedFids: [], blockedMedia: [mediaHash] }) };
    expect(await loadShareData(route, mediaBlocked)).toBeUndefined();
    expect(await previewImageData(`${BASE}/media/${mediaHash}`, mediaBlocked)).toBeUndefined();
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it('blocks media before bucket reads and makes allowed content no-store only when configured', async () => {
    const key = 'b'.repeat(64); const get = vi.fn().mockResolvedValue(null); const head = vi.fn().mockResolvedValue(null);
    const env: MediaEnv = { MEDIA_BUCKET: { get, head, put: vi.fn() }, MEDIA_QUOTA: {} as MediaEnv['MEDIA_QUOTA'] };
    const denied = await handleMediaRequest(new Request(`${BASE}/media/${key}`, { headers: { 'If-None-Match': '"old"' } }), { ...env, OPENCASTER_MODERATION: manifest({ blockedMedia: [key] }) });
    expect(denied.status).toBe(403); expect(get).not.toHaveBeenCalled();
    const invalid = await handleMediaRequest(new Request(`${BASE}/media/${key}`, { method: 'HEAD' }), { ...env, OPENCASTER_MODERATION: '' });
    expect(invalid.status).toBe(503); expect(head).not.toHaveBeenCalled();
    get.mockResolvedValue({ body: new Uint8Array([1, 2, 3]).buffer, size: 3, httpEtag: '"etag"', httpMetadata: { contentType: 'image/png' } });
    const configured = await handleMediaRequest(new Request(`${BASE}/media/${key}`), { ...env, OPENCASTER_MODERATION: manifest({ blockedFids: [] }) });
    expect(configured.status).toBe(200); expect(configured.headers.get('Cache-Control')).toBe('no-store');
    const legacy = await handleMediaRequest(new Request(`${BASE}/media/${key}`, { headers: { 'If-None-Match': '"etag"' } }), env);
    expect(legacy.status).toBe(304); expect(legacy.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });
});
