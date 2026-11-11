import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, type Env } from './index';
import { fetchUpstream, ORIGIN_TOKEN_HEADER, validTimelineCursor } from './upstream';

// Synthetic fixed-key fixture. No production credentials or writes. `hyper` is
// the key stock Hypersnap issues and accepts; `retired` is the same position as
// the retired fork-era node issued it, still held by older clients.
const tail = '000615d0010a54f540716d6661862b138163329c4c8ee2e0c67e72a27a';
const retired = '03' + tail;
const hyper = '1e' + tail;
const node = 'https://node.example.test';
const backup = 'https://haatz.quilibrium.com';
const token = 'synthetic-origin-token_0123456789-abcdef';
const env: Env = { ASSETS: { fetch: vi.fn() }, HYPERSNAP_ORIGIN: node, HYPERSNAP_ORIGIN_TOKEN: token, HYPERSNAP_READ_FALLBACK: 'haatz-v1' };
const route = '/v2/farcaster/feed/user/casts';
const req = (cursor: string) => new Request(`https://opencaster.org/api${route}?fid=398800&limit=100&cursor=${cursor}`);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('timeline continuation on stock Hypersnap origins', () => {
  it('continues on the private stock node with the key that node issued, unchanged', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ casts: [{ hash: 'synthetic-next-cast' }], next: { cursor: hyper } })); vi.stubGlobal('fetch', fetch);
    const r = await handleRequest(req(hyper), env);
    expect(r.status).toBe(200); expect(r.headers.get('X-Opencaster-Upstream')).toBe('primary');
    expect((await r.json()).next.cursor).toBe(hyper);
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][0]).toBe(`${node}${route}?fid=398800&limit=100&cursor=${hyper}`);
    expect(fetch.mock.calls[0][1].headers.get(ORIGIN_TOKEN_HEADER)).toBe(token);
  });
  it('never sends the private stock node a retired root-03 key, which it would answer with an empty page', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ casts: [{ hash: 'synthetic-next-cast' }], next: {} })); vi.stubGlobal('fetch', fetch);
    const r = await handleRequest(req(retired), env);
    expect(r.status).toBe(200); expect(r.headers.get('X-Opencaster-Upstream')).toBe('primary');
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][0]).toBe(`${node}${route}?fid=398800&limit=100&cursor=${hyper}`);
  });
  it('continues without any backup configured: one request, to the private node only', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ message: 'synthetic budget exhausted' }, 500)); vi.stubGlobal('fetch', fetch);
    const r = await handleRequest(req(hyper), { ASSETS: env.ASSETS, HYPERSNAP_ORIGIN: node, HYPERSNAP_ORIGIN_TOKEN: token });
    expect(r.status).toBeGreaterThanOrEqual(500); expect(r.headers.get('X-Opencaster-Upstream')).not.toBe('backup');
    expect(fetch.mock.calls.map(x => new URL(x[0]).origin)).toEqual([node]);
  });
  it('retries a primary resource failure on the same logical backup position, not an empty history', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ message: 'synthetic budget exhausted' }, 500)).mockResolvedValueOnce(json({ casts: [{ hash: 'synthetic-next-cast' }], next: { cursor: hyper } }));
    vi.stubGlobal('fetch', fetch);
    const r = await handleRequest(req(retired), env);
    expect(r.status).toBe(200); expect(r.headers.get('X-Opencaster-Upstream')).toBe('backup');
    expect((await r.json()).casts).toHaveLength(1);
    expect(fetch.mock.calls.map(x => x[0])).toEqual([`${node}${route}?fid=398800&limit=100&cursor=${hyper}`, `${backup}${route}?fid=398800&limit=100&cursor=${hyper}`]);
    expect(fetch.mock.calls[0][1].headers.get(ORIGIN_TOKEN_HEADER)).toBe(token);
    expect(fetch.mock.calls[1][1].headers.has(ORIGIN_TOKEN_HEADER)).toBe(false);
  });
  it('uses the same key for the public single-origin development default too', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ casts: [], next: {} })); vi.stubGlobal('fetch', fetch);
    expect((await handleRequest(req(retired), { ASSETS: env.ASSETS })).status).toBe(200);
    expect(fetch.mock.calls[0][0]).toBe(`${backup}${route}?fid=398800&limit=100&cursor=${hyper}`);
  });
  it.each([retired, hyper])('preserves the full cursor tail and strips browser credentials at the fetch boundary: %s', async (cursor: string) => {
    const fetch = vi.fn().mockResolvedValue(json({})); vi.stubGlobal('fetch', fetch);
    const upperTail = cursor.slice(0, 2) + cursor.slice(2).toUpperCase();
    await fetchUpstream({ origin: node, token }, `${route}?fid=398800&limit=100&cursor=${upperTail}`, {
      headers: { Cookie: 'synthetic-cookie', Authorization: 'Bearer synthetic-browser-token', [ORIGIN_TOKEN_HEADER]: 'spoof' },
      redirect: 'follow', credentials: 'include', cache: 'force-cache',
    });
    const [url, init] = fetch.mock.calls[0];
    expect(new URL(url).searchParams.get('cursor')).toBe('1e' + upperTail.slice(2));
    expect([...init.headers]).toEqual([['accept', 'application/json'], [ORIGIN_TOKEN_HEADER.toLowerCase(), token]]);
    expect(init).toMatchObject({ redirect: 'manual', credentials: 'omit', cache: 'no-store' });
  });
  it.each(['ff'+tail, retired.slice(0,-1), retired+'0', '03'+'00000001'+tail.slice(8), '03'+tail.slice(0,8)+'02'+tail.slice(10), '1e'+'00000001'+tail.slice(8), '1e'+tail.slice(0,8)+'02'+tail.slice(10), 'zz'+tail, '', 'next-page'])('rejects unsupported, malformed or differently scoped key before fetch: %s', async (value: string) => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await handleRequest(req(value), env)).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });
  it('does not confuse supported prefixes with general token rewriting', () => {
    expect(validTimelineCursor(retired,'398800')).toBe(true); expect(validTimelineCursor(hyper,'398800')).toBe(true);
    expect(validTimelineCursor(hyper,'1')).toBe(false); expect(validTimelineCursor(hyper,'4294967296')).toBe(false);
  });
});
