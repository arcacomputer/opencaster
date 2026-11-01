import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, type Env } from './index';
import { ORIGIN_TOKEN_HEADER, validTimelineCursor } from './upstream';

// Synthetic fixed-key fixture; real namespace-only mismatch is retained in the
// private live qualification receipts. No production credentials or writes.
const tail = '000615d0010a54f540716d6661862b138163329c4c8ee2e0c67e72a27a';
const native = '03' + tail;
const legacy = '1e' + tail;
const node = 'https://node.example.test';
const backup = 'https://haatz.quilibrium.com';
const token = 'synthetic-origin-token_0123456789-abcdef';
const env: Env = { ASSETS: { fetch: vi.fn() }, HYPERSNAP_ORIGIN: node, HYPERSNAP_ORIGIN_TOKEN: token, HYPERSNAP_READ_FALLBACK: 'haatz-v1' };
const route = '/v2/farcaster/feed/user/casts';
const req = (cursor: string) => new Request(`https://opencaster.org/api${route}?fid=398800&limit=100&cursor=${cursor}`);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('timeline continuation across canonical/legacy storage namespaces', () => {
  it('retries a primary resource failure on the same logical backup position, not an empty history', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ message: 'synthetic budget exhausted' }, 500)).mockResolvedValueOnce(json({ casts: [{ hash: 'synthetic-next-cast' }], next: { cursor: legacy } }));
    vi.stubGlobal('fetch', fetch);
    const r = await handleRequest(req(native), env);
    expect(r.status).toBe(200); expect(r.headers.get('X-Opencaster-Upstream')).toBe('backup');
    expect((await r.json()).casts).toHaveLength(1);
    expect(fetch.mock.calls.map(x => x[0])).toEqual([`${node}${route}?fid=398800&limit=100&cursor=${native}`, `${backup}${route}?fid=398800&limit=100&cursor=${legacy}`]);
    expect(fetch.mock.calls[0][1].headers.get(ORIGIN_TOKEN_HEADER)).toBe(token);
    expect(fetch.mock.calls[1][1].headers.has(ORIGIN_TOKEN_HEADER)).toBe(false);
  });
  it('resumes a legacy backup cursor on a recovered primary at the identical logical position', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ casts: [{ hash: 'synthetic-next-cast' }], next: {} })); vi.stubGlobal('fetch', fetch);
    const r = await handleRequest(req(legacy), env);
    expect(r.status).toBe(200); expect(r.headers.get('X-Opencaster-Upstream')).toBe('primary');
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][0]).toBe(`${node}${route}?fid=398800&limit=100&cursor=${native}`);
  });
  it('uses legacy namespace for the public single-origin development default too', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ casts: [], next: {} })); vi.stubGlobal('fetch', fetch);
    expect((await handleRequest(req(native), { ASSETS: env.ASSETS })).status).toBe(200);
    expect(fetch.mock.calls[0][0]).toBe(`${backup}${route}?fid=398800&limit=100&cursor=${legacy}`);
  });
  it.each(['ff'+tail, native.slice(0,-1), native+'0', '03'+'00000001'+tail.slice(8), '03'+tail.slice(0,8)+'02'+tail.slice(10), 'zz'+tail, '', 'next-page'])('rejects unsupported, malformed or differently scoped key before fetch: %s', async value => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await handleRequest(req(value), env)).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });
  it('does not confuse supported prefixes with general token rewriting', () => {
    expect(validTimelineCursor(native,'398800')).toBe(true); expect(validTimelineCursor(legacy,'398800')).toBe(true);
    expect(validTimelineCursor(native,'1')).toBe(false); expect(validTimelineCursor(native,'4294967296')).toBe(false);
  });
});
