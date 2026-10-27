import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, type Env } from './index';

const BASE = 'https://opencaster.org';
const LEGACY = 'https://quorum.arca.computer';
const WORKER = 'https://hypersnap-quorum.lf-e32.workers.dev';
const env: Env = {
  ASSETS: { fetch: async () => new Response('<!doctype html><html></html>', { headers: { 'Content-Type': 'text/html' } }) },
};
const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the Opencaster domain migration', () => {
  it.each([
    '/', '/profile/1234?tab=likes', '/gandhionchain/0xcfd6d3c3?utm_source=share',
    `/cast/0x${'a'.repeat(40)}`, `/media/${'b'.repeat(64)}`, '/alice%2Fbob?encoded=%2F%3F&next=https%3A%2F%2Fevil.example',
    '//evil.example/path?return=//evil.example&scopes=1,2,11',
  ])('redirects legacy GET links with the same path/query and a fixed destination: %s', async path => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const assets = vi.fn(); const request = new Request(`${LEGACY}${path}`);
    const response = await handleRequest(request, { ...env, ASSETS: { fetch: assets } });
    expect(response.status).toBe(308); const location = new URL(response.headers.get('Location')!); const source = new URL(request.url);
    expect(location.origin).toBe(BASE); expect(location.pathname).toBe(source.pathname); expect(location.search).toBe(source.search);
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer'); expect(fetch).not.toHaveBeenCalled(); expect(assets).not.toHaveBeenCalled();
  });

  it('redirects HEAD and insecure legacy links to the HTTPS canonical origin without a body', async () => {
    const response = await handleRequest(new Request('http://quorum.arca.computer/profile/alice?tab=media', { method: 'HEAD' }), env);
    expect(response.status).toBe(308); expect(response.headers.get('Location')).toBe(`${BASE}/profile/alice?tab=media`); expect(await response.text()).toBe('');
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('requires reopening the new site for legacy %s requests without consuming or forwarding them', async method => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const assets = vi.fn();
    const request = new Request(`${LEGACY}/api/v1/submitMessage?return=https://evil.example`, { method, headers: { Origin: LEGACY, 'Content-Type': 'application/octet-stream' }, ...(method === 'OPTIONS' ? {} : { body: new Uint8Array([8, 1]) }) });
    const response = await handleRequest(request, { ...env, ASSETS: { fetch: assets } });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'site_moved', message: expect.stringContaining('https://opencaster.org') });
    expect(response.headers.get('Location')).toBe(`${BASE}/api/v1/submitMessage?return=https://evil.example`);
    expect(response.headers.get('Link')).toBe(`<${BASE}>; rel="canonical"`); expect(request.bodyUsed).toBe(false);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull(); expect(fetch).not.toHaveBeenCalled(); expect(assets).not.toHaveBeenCalled();
  });

  it.each([BASE, WORKER, 'https://quorum.arca.computer.evil.example', 'https://quorum.arca.computer.', 'https://www.opencaster.org'])('does not redirect unrelated or operational hosts: %s', async origin => {
    const response = await handleRequest(new Request(`${origin}/profile/alice`), env);
    expect(response.status).toBe(200); expect(response.headers.get('Location')).toBeNull();
  });

  it.each([LEGACY, WORKER, 'null', 'https://evil.example'])('rejects cross-origin signatures and preflight on the canonical site: %s', async origin => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const submitted = await handleRequest(new Request(`${BASE}/api/v1/submitMessage`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([8, 1]) }), env);
    expect(submitted.status).toBe(403); expect(submitted.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const preflight = await handleRequest(new Request(`${BASE}/api/v1/submitMessage`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } }), env);
    expect(preflight.status).toBe(405); expect(preflight.headers.get('Access-Control-Allow-Origin')).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the stable worker hostname operational with its own-origin requests', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ version: 'isolated' })); vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${WORKER}/api/v1/info`, { headers: { Origin: WORKER } }), env);
    expect(response.status).toBe(200); expect(fetch.mock.calls[0][0]).toBe('https://haatz.quilibrium.com/v1/info'); expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('the fixed Hypersnap gateway', () => {
  it('forwards fixed-size public cast-history pages and opaque canonical cursors without credentials', async () => {
    const receipt = { data: { type: 'MESSAGE_TYPE_CAST_ADD', fid: 410023, network: 'FARCASTER_NETWORK_MAINNET' }, hash: `0x${'a'.repeat(40)}` };
    const token = 'AwAGQacBCpe8t9Lvcp/t5/Ae6RvjfQ51dp6dJmN8';
    const fetch = vi.fn().mockImplementation(async () => jsonResponse({ messages: [receipt], nextPageToken: token })); vi.stubGlobal('fetch', fetch);
    for (const cursor of [undefined, token]) {
      const query = new URLSearchParams({ fid: '410023', pageSize: '250', reverse: 'true', ...(cursor ? { pageToken: cursor } : {}) });
      const path = `/v1/castsByFid?${query}`;
      const response = await handleRequest(new Request(`${BASE}/api${path}`, { headers: { Cookie: 'do-not-forward', Authorization: 'Bearer do-not-forward', Origin: BASE } }), env);
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ messages: [receipt], nextPageToken: token });
      const [url, init] = fetch.mock.calls.at(-1)!;
      expect(url).toBe(`https://haatz.quilibrium.com${path}`); expect(init.method).toBe('GET'); expect(init.credentials).toBe('omit'); expect(init.redirect).toBe('manual');
      expect(init.headers.get('Cookie')).toBeNull(); expect(init.headers.get('Authorization')).toBeNull(); expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects unbounded, malformed or alternative cast-history queries before contacting the node', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const valid = 'fid=410023&pageSize=250&reverse=true';
    const invalid = [
      valid.replace('fid=410023', 'fid=0'), valid.replace('fid=410023', 'fid=-1'), valid.replace('fid=410023', 'fid=4294967296'),
      valid.replace('pageSize=250', 'pageSize=249'), valid.replace('pageSize=250', 'pageSize=251'), valid.replace('reverse=true', 'reverse=false'),
      valid.replace('&pageSize=250', ''), valid.replace('&reverse=true', ''), valid.replace('fid=410023&', ''),
      valid.replace('pageSize=250', 'page_size=250'), `${valid}&pageSize=250`, `${valid}&fid=3`, `${valid}&startTimestamp=0`, `${valid}&stop_timestamp=1`, `${valid}&rpc=https://example.com`,
      ...['', 'A===', 'AA=', 'AB==', 'AAAA_', 'not a cursor', 'A'.repeat(2052)].map(value => `${valid}&pageToken=${encodeURIComponent(value)}`),
      `${valid}&pageToken=YQ%3D%3D&pageToken=YQ%3D%3D`, `${valid}&page_token=YQ%3D%3D`,
    ];
    for (const query of invalid) expect((await handleRequest(new Request(`${BASE}/api/v1/castsByFid?${query}`), env)).status, query).toBe(400);
    expect((await handleRequest(new Request(`${BASE}/api/v1/castsByFid?${valid}`, { method: 'POST' }), env)).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves cast-history failures as controlled errors rather than a falsely complete empty page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Failed to get casts', error_detail: 'private database failure' }, 400)));
    const response = await handleRequest(new Request(`${BASE}/api/v1/castsByFid?fid=410023&pageSize=250&reverse=true`), env);
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ code: 'upstream_error', message: 'The node rejected this request.' });
  });

  it('forwards only canonical native ENS/Basename name-to-FID reads to the fixed node without credentials', async () => {
    const fetch = vi.fn().mockImplementation(async () => jsonResponse({ fid: 3 })); vi.stubGlobal('fetch', fetch);
    for (const [name, type] of [['dwr.eth', 'ens'], ['jesse.base.eth', 'basename'], [`${'a'.repeat(16)}.eth`, 'ens'], [`${'a'.repeat(16)}.base.eth`, 'basename']]) {
      const response = await handleRequest(new Request(`${BASE}/api/v1/fidByName?name=${name}&type=${type}`, { headers: { Authorization: 'Bearer never-forward', Cookie: 'wallet=never-forward', Origin: BASE } }), env);
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ fid: 3 });
      const [url, init] = fetch.mock.calls.at(-1)!;
      expect(url).toBe(`https://haatz.quilibrium.com/v1/fidByName?name=${name}&type=${type}`);
      expect(init.method).toBe('GET'); expect(init.credentials).toBe('omit'); expect(init.redirect).toBe('manual');
      expect(init.headers.get('Authorization')).toBeNull(); expect(init.headers.get('Cookie')).toBeNull();
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('rejects noncanonical names, unsupported forms, mismatched types and extra ENS query fields before any upstream read', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const query of [
      'name=dwr.eth', 'type=ens', 'name=&type=ens', 'name=dwr.eth&type=fname',
      'name=dwr.eth&type=basename', 'name=jesse.base.eth&type=ens',
      'name=DWR.eth&type=ens', 'name=%40dwr.eth&type=ens', 'name=dwr.eth.&type=ens',
      'name=sub.dwr.eth&type=ens', 'name=sub.jesse.base.eth&type=basename', 'name=vitalik.com&type=ens',
      'name=%F0%9F%98%80.eth&type=ens', 'name=-dwr.eth&type=ens', 'name=d_wr.eth&type=ens',
      `name=${'a'.repeat(17)}.eth&type=ens`, 'name=dwr.eth&type=ens&type=ens',
      'name=dwr.eth&name=vitalik.eth&type=ens', 'name=dwr.eth&type=ens&rpc=https://example.com',
    ]) expect((await handleRequest(new Request(`${BASE}/api/v1/fidByName?${query}`), env)).status, query).toBe(400);
    expect((await handleRequest(new Request(`${BASE}/api/v1/fidByName?name=dwr.eth&type=ens`, { method: 'POST' }), env)).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps only the verified native missing-name proof error to a helpful unlinked-name result', async () => {
    for (const metadata of ['', ', metadata: MetadataMap { headers: {} }']) {
      const fetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'Failed to get fid by name', error_detail: `status: NotFound, message: "username proof not found", details: []${metadata}` }, 400)); vi.stubGlobal('fetch', fetch);
      const response = await handleRequest(new Request(`${BASE}/api/v1/fidByName?name=arca-no-ens-404.eth&type=ens`), env);
      expect(response.status).toBe(404); expect(await response.json()).toEqual({ code: 'ens_name_not_found', message: 'This ENS name is not linked to an account on this Hypersnap node. Try your username or FID.' });
    }
  });

  it('does not classify storage, unrelated NotFound, malformed input or transport failures as an unlinked ENS name', async () => {
    for (const error of [
      { error: 'Failed to get fid by name', error_detail: 'status: Internal, message: "store error", details: []' },
      { error: 'Failed to get fid by name', error_detail: 'status: NotFound, message: "stores not found for fid", details: []' },
      { error: 'Failed to get username proof', error_detail: 'status: NotFound, message: "username proof not found", details: []' },
      { error: 'Name is required' },
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(error, 400)));
      const response = await handleRequest(new Request(`${BASE}/api/v1/fidByName?name=dwr.eth&type=ens`), env);
      expect(response.status).toBe(400); expect((await response.json() as { code: string }).code).toBe('upstream_error');
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Connection lost')));
    const unavailable = await handleRequest(new Request(`${BASE}/api/v1/fidByName?name=dwr.eth&type=ens`), env);
    expect(unavailable.status).toBe(502); expect((await unavailable.json() as { code: string }).code).toBe('upstream_unavailable');
  });

  it('allows only exact paginated cast-actor reads and strips request credentials', async () => {
    const fetch = vi.fn().mockImplementation(async () => jsonResponse({ messages: [] })); vi.stubGlobal('fetch', fetch);
    const path = `/v1/reactionsByCast?target_fid=3&target_hash=${'a'.repeat(40)}&reaction_type=Like&pageSize=25&reverse=true&pageToken=dG9rZW4%3D`;
    expect((await handleRequest(new Request(`${BASE}/api${path}`, { headers: { Cookie: 'private', Authorization: 'private' } }), env)).status).toBe(200);
    expect(fetch.mock.calls[0][0]).toBe(`https://haatz.quilibrium.com${path}`);
    expect(fetch.mock.calls[0][1].headers.get('Cookie')).toBeNull(); expect(fetch.mock.calls[0][1].headers.get('Authorization')).toBeNull();
    const prefix = `/v1/reactionsByCast?target_fid=3&target_hash=${'a'.repeat(40)}&reaction_type=Like&pageSize=25&reverse=true`;
    for (const invalid of [prefix.replace('target_fid=3', 'target_fid=0'), prefix.replace('target_hash=' + 'a'.repeat(40), 'target_hash=bad'), prefix.replace('reaction_type=Like', 'reaction_type=1'), prefix.replace('pageSize=25', 'pageSize=26'), prefix.replace('reverse=true', 'reverse=false'), prefix.replace('&reverse=true', ''), prefix + '&pageToken=a===', prefix + '&pageToken=', prefix + '&target_fid=4', prefix + '&target_url=https://evil.test', prefix + '&upstream=https://evil.test']) expect((await handleRequest(new Request(`${BASE}/api${invalid}`), env)).status).toBe(400);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('permits known trending windows only on the trending feed', async () => {
    const fetch = vi.fn().mockImplementation(async () => jsonResponse({ casts: [], next: {} })); vi.stubGlobal('fetch', fetch);
    for (const timeWindow of ['1h', '6h', '12h', '24h', '7d']) {
      expect((await handleRequest(new Request(`${BASE}/api/v2/farcaster/feed/trending?time_window=${timeWindow}&limit=20`), env)).status).toBe(200);
      expect(fetch.mock.lastCall?.[0]).toBe(`https://haatz.quilibrium.com/v2/farcaster/feed/trending?time_window=${timeWindow}&limit=20`);
    }
    for (const path of ['/feed/trending?time_window=30d', '/feed/trending?time_window=1h&time_window=7d', '/feed/following?fid=3&time_window=1h', '/feed/user/casts?fid=3&time_window=1h', '/feed/channels?channel_ids=art&time_window=1h']) expect((await handleRequest(new Request(`${BASE}/api/v2/farcaster${path}`), env)).status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(5);
  });
  it('forwards feature reads only to Hypersnap with bounded explicit parameters', async () => {
    const fetch = vi.fn().mockImplementation(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetch);
    const paths = [
      '/v2/farcaster/user/search?q=alice&limit=10',
      '/v2/farcaster/cast/search?q=hello+world&limit=20',
      '/v2/farcaster/notifications?fid=3&limit=20&cursor=abc%3D',
      '/v2/farcaster/channel?id=test&type=id',
      '/v2/farcaster/channel/all?limit=20&cursor=abcd',
      '/v2/farcaster/channel/trending?limit=20',
      '/v2/farcaster/channel/search?q=art&limit=10',
    ];
    for (const path of paths) expect((await handleRequest(new Request(`${BASE}/api${path}`, { headers: { Cookie: 'secret', Authorization: 'secret' } }), env)).status).toBe(200);
    expect(fetch.mock.calls.map(call => call[0])).toEqual(paths.map(path => `https://haatz.quilibrium.com${path}`));
    for (const [, options] of fetch.mock.calls) {
      expect(options.headers.get('Authorization')).toBeNull();
      expect(options.headers.get('Cookie')).toBeNull();
      expect(options.credentials).toBe('omit');
    }
  });

  it.each([
    '/v2/farcaster/user/search?q=',
    '/v2/farcaster/user/search?q=one&q=two',
    '/v2/farcaster/cast/search?q=%00hello',
    '/v2/farcaster/cast/search?q=hello&cursor=ignored',
    '/v2/farcaster/cast/search?q=' + encodeURIComponent('🙂'.repeat(65)),
    '/v2/farcaster/notifications?fid=0',
    '/v2/farcaster/notifications?fid=3&limit=101',
    '/v2/farcaster/channel?id=https://attacker.test&type=parent_url',
    '/v2/farcaster/channel/all?limit=1000',
    '/v2/farcaster/channel/search?q=hello&cursor=ignored',
    '/v2/farcaster/channel/trending?cursor=ignored',
  ])('rejects unsupported feature parameters before fetch: %s', async path => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect((await handleRequest(new Request(`${BASE}/api${path}`), env)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports source-defined disabled indexes as unavailable rather than empty success', async () => {
    for (const [path, upstreamMessage] of [
      ['/v2/farcaster/cast/search?q=hello', 'Search indexing not available'],
      ['/v2/farcaster/cast/search?q=hello', 'Search feature disabled'],
      ['/v2/farcaster/channel/all', 'Channels indexing not enabled'],
      ['/v2/farcaster/feed/channels?channel_ids=test', 'Channel feed service not available'],
      ['/v2/farcaster/notifications?fid=3', 'Hub query service not available'],
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: upstreamMessage }, 503)));
      const response = await handleRequest(new Request(`${BASE}/api${path}`), env);
      expect(response.status).toBe(503);
      expect((await response.json() as { code: string }).code).toBe('feature_unavailable');
    }
  });

  it('keeps generic upstream outages distinct from disabled-index responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'Sensitive database failure' }, 503)));
    const response = await handleRequest(new Request(`${BASE}/api/v2/farcaster/cast/search?q=hello`), env);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('Sensitive');
  });

  it('normalizes only the exact missing-cast response for uncertain deletion reconciliation', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ message: 'Cast not found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ message: 'Gateway route not found' }, 404));
    vi.stubGlobal('fetch', fetch);
    const path = `${BASE}/api/v2/farcaster/cast?identifier=${'a'.repeat(40)}&type=hash`;
    expect(await (await handleRequest(new Request(path), env)).json()).toEqual({ code: 'cast_not_found', message: 'This cast was not found on Hypersnap.' });
    expect((await (await handleRequest(new Request(path), env)).json() as { code: string }).code).toBe('upstream_error');
  });

  it('distinguishes absent named channels from absent casts', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ message: 'Channel not found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ message: 'Cast not found' }, 404));
    vi.stubGlobal('fetch', fetch);
    const path = `${BASE}/api/v2/farcaster/channel?id=unknown&type=id`;
    expect(await (await handleRequest(new Request(path), env)).json()).toEqual({ code: 'channel_not_found', message: 'This channel was not found on Hypersnap.' });
    expect((await (await handleRequest(new Request(path), env)).json() as { code: string }).code).toBe('upstream_error');
  });
  it('forwards only bounded public follow reads to the existing Hypersnap node', async () => {
    const fetch = vi.fn().mockImplementation(async () => jsonResponse({ users: [], next: {} }));
    vi.stubGlobal('fetch', fetch);
    for (const kind of ['followers', 'following']) expect((await handleRequest(new Request(`${BASE}/api/v2/farcaster/user/${kind}?fid=1234&limit=20`), env)).status).toBe(200);
    expect(fetch.mock.calls.map(call => call[0])).toEqual(['https://haatz.quilibrium.com/v2/farcaster/user/followers?fid=1234&limit=20', 'https://haatz.quilibrium.com/v2/farcaster/user/following?fid=1234&limit=20']);
    for (const query of ['fid=1234&target_fid=3&link_type=block', 'fid=1234&link_type=follow', 'fid=0&target_fid=3&link_type=follow']) {
      expect((await handleRequest(new Request(`${BASE}/api/v1/linkById?${query}`), env)).status).toBe(400);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const cursor of ['abc', '18446744073709551616']) expect((await handleRequest(new Request(`${BASE}/api/v2/farcaster/user/following?fid=1234&cursor=${cursor}`), env)).status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('normalizes only the verified v1 follow NotFound response without echoing upstream details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Failed to get link', error_detail: 'status: NotFound, message: "cast not found", details: []' }, 400)));
    const response = await handleRequest(new Request(`${BASE}/api/v1/linkById?fid=1234&target_fid=3&link_type=follow`), env);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 'follow_not_found', message: 'This follow relationship does not exist.' });
  });

  it('recognizes Hypersnap device-key rate limiting wrapped in HTTP 400', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Failed to submit message', error_detail: 'status: InvalidArgument, message: "bad_request.rate_limited/rate limit exceeded for FID 1234", details: [], metadata: MetadataMap { headers: {"x-err-code": "bad_request.rate_limited"} }' }, 400)));
    const response = await handleRequest(new Request(`${BASE}/api/v1/submitMessage`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([8, 1]) }), env);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: 'rate_limited', message: 'Hypersnap is limiting new approvals or messages. Wait at least one minute before trying again.' });
  });

  it('does not confuse unrelated signed-message rejection with the verified rate-limit error', async () => {
    for (const value of [
      { error: 'Different endpoint', error_detail: 'status: InvalidArgument, message: "bad_request.rate_limited/rate limit exceeded for FID 1234",' },
      { error: 'Failed to submit message', error_detail: 'status: InvalidArgument, message: "bad_request.validation_failure/invalid signature",' },
      { error: 'Failed to submit message', error_detail: 'untrusted echoed rate_limited text' },
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(value, 400)));
      const response = await handleRequest(new Request(`${BASE}/api/v1/submitMessage`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([8, 1]) }), env);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ code: 'upstream_error', message: 'The node rejected this signed message. Check your signer and try again.' });
    }
  });

  it('does not present validation or storage failures as an absent follow', async () => {
    for (const error of [{ error: 'Failed to get link', error_detail: 'status: Internal, message: db failure' }, { error: 'Other failure', error_detail: 'status: NotFound, message: wrong endpoint' }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(error, 400)));
      const response = await handleRequest(new Request(`${BASE}/api/v1/linkById?fid=1234&target_fid=3&link_type=follow`), env);
      expect(response.status).toBe(400);
      expect((await response.json() as { code: string }).code).toBe('upstream_error');
    }
  });
  it('forwards only an allowlisted read to the fixed node and drops credentials', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ casts: [], next: {} }));
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api/v2/farcaster/feed/trending?limit=20`, {
      headers: { Cookie: 'private-session', Authorization: 'secret' },
    }), env);
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://haatz.quilibrium.com/v2/farcaster/feed/trending?limit=20');
    expect(options.headers.get('Authorization')).toBeNull();
    expect(options.headers.get('Cookie')).toBeNull();
    expect(options.redirect).toBe('manual');
    expect(options.cache).toBe('no-store');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('rejects upstream redirects without following their destination', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://attacker.example/' } }));
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api/v1/info`), env);
    expect(response.status).toBe(502);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].redirect).toBe('manual');
    expect(response.headers.get('Location')).toBeNull();
  });

  it.each([
    '/api/https://attacker.example/',
    '/api/v1/submitBulkMessages',
    '/api/v2/farcaster/feed/trending?url=https://attacker.example',
    '/api/v2/farcaster/feed/trending?limit=1&limit=100',
    '/api/v2/farcaster/feed/trending?limit=100000',
    '/api/v2/farcaster/user?fid=-1',
    '/api/v2/farcaster/user?fid=3&seed=never-send-this',
    '/api/v2/farcaster/cast?identifier=https://attacker.example&type=url',
    '/api/v2/farcaster/feed/channels?channel_ids=https://attacker.example',
    '/api/v2%2ffarcaster/user?fid=3',
    '/api/v1/signersByFid?fid=3&requesterFids=3',
  ])('rejects unexpected paths and queries before any upstream fetch: %s', async path => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}${path}`), env);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts indexed signer-nonce parameters understood by the node', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ signers: [], currentUserNonce: 0 }));
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api/v1/signersByFid?fid=3&pageSize=1000&requesterFids%5B0%5D=3`), env);
    expect(response.status).toBe(200);
    expect(fetch.mock.calls[0][0]).toBe('https://haatz.quilibrium.com/v1/signersByFid?fid=3&pageSize=1000&requesterFids%5B0%5D=3');
  });

  it('rejects cross-site signed-message submission', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api/v1/submitMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Origin: 'https://attacker.example' }, body: new Uint8Array([1, 2]),
    }), env);
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { method: 'POST', path: '/v2/farcaster/user?fid=3', contentType: 'application/json', body: '{}' },
    { method: 'GET', path: '/v1/submitMessage', contentType: 'application/octet-stream', body: undefined },
    { method: 'POST', path: '/v1/submitMessage', contentType: 'application/json', body: '{"seed":"never-submit"}' },
    { method: 'POST', path: '/v1/submitMessage?upstream=other', contentType: 'application/octet-stream', body: 'bytes' },
  ])('rejects unsupported methods, write queries and JSON bodies', async test => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api${test.path}`, {
      method: test.method, headers: { 'Content-Type': test.contentType }, body: test.body,
    }), env);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('enforces the binary size limit even without a Content-Length header', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api/v1/submitMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(65_537),
    }), env);
    expect(response.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('forwards the exact signed bytes once, without caching the write', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ hash: 'abc' }));
    vi.stubGlobal('fetch', fetch);
    const body = new Uint8Array([8, 1, 18, 2, 255, 0]);
    const response = await handleRequest(new Request(`${BASE}/api/v1/submitMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Origin: BASE }, body,
    }), env);
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://haatz.quilibrium.com/v1/submitMessage');
    expect(new Uint8Array(options.body)).toEqual(body);
    expect(options.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('does not echo upstream errors or forwarded content', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'private echoed payload <script>bad()</script>' }, 400));
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api/v2/farcaster/user?fid=3`), env);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('private echoed payload');
  });

  it('marks failed write transport as uncertain instead of recommending a blind retry', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Connection lost after submission'));
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api/v1/submitMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([8, 1]),
    }), env);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: 'submission_unknown', message: 'Submission status is unknown. Check your profile or signer state before trying again.' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('bounds unexpectedly large upstream responses', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`${BASE}/api/v1/info`), env);
    expect(response.status).toBe(502);
    expect((await response.json() as { code: string }).code).toBe('response_too_large');
  });

  it('forwards a validated JSON object byte-for-byte with JSON and security headers', async () => {
    const body = '{ "fid": 12345678901234567890, "text": "caf\\u00e9 \u2603",\n"nested": {"a": [1, 2.50]} }';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'upstream=1' } })));
    const response = await handleRequest(new Request(`${BASE}/api/v1/info`), env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  it.each(['[1, 2]', 'null', '"text"', '{"truncated": '])('still rejects a successful upstream body that is not a JSON object: %s', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'application/json' } })));
    const response = await handleRequest(new Request(`${BASE}/api/v1/info`), env);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('truncated');
  });

  it('aborts a slow node and returns a controlled timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const pending = handleRequest(new Request(`${BASE}/api/v1/info`), env);
    await vi.advanceTimersByTimeAsync(20_001);
    const response = await pending;
    expect(response.status).toBe(504);
  });

  it('sets a restrictive CSP and no-referrer policy on the wallet HTML', async () => {
    const response = await handleRequest(new Request(BASE), env);
    const csp = response.headers.get('Content-Security-Policy');
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain('wss://relay.walletconnect.org');
    expect(csp).toContain('frame-src https://verify.walletconnect.org https://verify.walletconnect.com;');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('pulse.walletconnect');
    expect(csp).not.toMatch(/(?:connect-src|frame-src)[^;]*\*/);
    const permissions = response.headers.get('Permissions-Policy');
    expect(permissions).toContain('publickey-credentials-create=(self)');
    expect(permissions).toContain('publickey-credentials-get=(self)');
    expect(permissions).not.toContain('*');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('bounded public reaction endpoints', () => {
  const target = `target_fid=3&target_hash=${'a'.repeat(40)}`;
  it('forwards exact current-state and paginated history reads without credentials', async () => {
    const fetch = vi.fn().mockImplementation(async () => jsonResponse({ messages: [] })); vi.stubGlobal('fetch', fetch);
    const paths = [`/v1/reactionById?fid=7&reaction_type=Like&${target}`, '/v1/reactionsByFid?fid=7&reaction_type=Recast&pageSize=25&reverse=true&pageToken=dG9rZW4%3D'];
    for (const path of paths) expect((await handleRequest(new Request(`${BASE}/api${path}`, { headers: { Cookie: 'private', Authorization: 'private' } }), env)).status).toBe(200);
    expect(fetch.mock.calls.map(call => call[0])).toEqual(paths.map(path => `https://haatz.quilibrium.com${path}`));
    for (const [, options] of fetch.mock.calls) {
      expect(options.method).toBe('GET'); expect(options.headers.get('Cookie')).toBeNull(); expect(options.headers.get('Authorization')).toBeNull();
    }
  });
  it.each([
    '/v1/reactionById?fid=7&reaction_type=like&target_fid=3&target_hash=' + 'a'.repeat(40),
    '/v1/reactionById?fid=0&reaction_type=Like&target_fid=3&target_hash=' + 'a'.repeat(40),
    '/v1/reactionById?fid=7&reaction_type=Like&target_fid=3',
    '/v1/reactionById?fid=7&reaction_type=Like&target_url=https://evil.example',
    '/v1/reactionsByFid?fid=7&reaction_type=Like&pageSize=101&reverse=true',
    '/v1/reactionsByFid?fid=7&reaction_type=Like&pageSize=25&reverse=true&pageToken=https://evil.example',
    '/v1/reactionsByFid?fid=7&reaction_type=Like&pageSize=25&reverse=true&pageToken=a===',
    '/v1/reactionsByFid?fid=7&reaction_type=Like&pageSize=25&reverse=true&pageToken=dG9r&cursor=extra',
    '/v1/reactionsByFid?fid=7&reaction_type=Like&pageSize=25&reverse=true&fid=8',
    '/v1/reactionsByFid?fid=7&reaction_type=Like&pageSize=25',
  ])('rejects malformed or unbounded reaction reads: %s', async path => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await handleRequest(new Request(`${BASE}/api${path}`), env)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('maps only the exact verified reaction absence into reaction_not_found', async () => {
    for (const metadata of ['', ', metadata: MetadataMap { headers: {} }']) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Failed to get reaction', error_detail: `status: NotFound, message: "cast not found", details: []${metadata}` }, 400)));
      const result = await handleRequest(new Request(`${BASE}/api/v1/reactionById?fid=7&reaction_type=Like&${target}`), env);
      expect(result.status).toBe(404);
      expect(await result.json()).toEqual({ code: 'reaction_not_found', message: 'This reaction does not exist.' });
    }
  });
  it('keeps unrelated NotFound, storage errors, wrong status and wrong content type as failures', async () => {
    for (const [value, status, contentType] of [
      [{ error: 'Failed to get reaction', error_detail: 'status: Internal, message: "cast not found", details: []' }, 400, 'application/json'],
      [{ error: 'Failed to get reaction', error_detail: 'status: NotFound, message: "FID not found", details: []' }, 400, 'application/json'],
      [{ error: 'Other endpoint', error_detail: 'status: NotFound, message: "cast not found", details: []' }, 400, 'application/json'],
      [{ error: 'Failed to get reaction', error_detail: 'untrusted status: NotFound, message: "cast not found", details: []' }, 400, 'application/json'],
      [{ error: 'Failed to get reaction', error_detail: 'status: NotFound, message: "cast not found", details: []' }, 404, 'application/json'],
      [{ error: 'Failed to get reaction', error_detail: 'status: NotFound, message: "cast not found", details: []' }, 400, 'text/html'],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(value), { status, headers: { 'Content-Type': contentType } })));
      const result = await handleRequest(new Request(`${BASE}/api/v1/reactionById?fid=7&reaction_type=Like&${target}`), env);
      expect((await result.json() as { code: string }).code).toBe('upstream_error');
    }
  });
});

describe('supported community queries', () => {
  it('forwards only bounded suggested people, participant pages, and quote samples', async () => {
    const fetch = vi.fn().mockImplementation(async () => jsonResponse({})); vi.stubGlobal('fetch', fetch);
    for (const path of ['/v2/farcaster/following/suggested?fid=7&limit=6', '/v2/farcaster/channel/members?channel_id=art&limit=25&cursor=5', `/v2/farcaster/cast/quotes?identifier=${'a'.repeat(40)}&type=hash&limit=25`]) {
      expect((await handleRequest(new Request(`${BASE}/api${path}`), env)).status).toBe(200);
    }
    for (const path of ['/v2/farcaster/following/suggested?fid=7&limit=21', '/v2/farcaster/following/suggested?fid=7&limit=6&cursor=ignored', '/v2/farcaster/channel/members?channel_id=art&limit=26', '/v2/farcaster/channel/members?channel_id=art&limit=25&cursor=abc', `/v2/farcaster/cast/quotes?identifier=${'a'.repeat(40)}&type=hash&limit=25&cursor=ignored`]) {
      expect((await handleRequest(new Request(`${BASE}/api${path}`), env)).status).toBe(400);
    }
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('preserves disabled social graph and participant index failures without false empty success', async () => {
    for (const [path, message] of [['/v2/farcaster/following/suggested?fid=7&limit=6', 'Social graph indexing not enabled'], ['/v2/farcaster/channel/members?channel_id=art&limit=25', 'Channels indexing not enabled']]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message }, 503)));
      const result = await handleRequest(new Request(`${BASE}/api${path}`), env);
      expect(result.status).toBe(503); expect((await result.json() as { code: string }).code).toBe('feature_unavailable');
    }
  });
});

describe('static asset caching', () => {
  const asset = (body: string, type: string, status = 200) => ({ fetch: vi.fn().mockResolvedValue(new Response(status === 304 ? null : body, { status, headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=0, must-revalidate' } })) });

  it.each([['GET', 200], ['HEAD', 200], ['GET', 304]] as const)('lets browsers keep content-hashed bundles (%s %i)', async (method, status) => {
    const response = await handleRequest(new Request(`${BASE}/assets/index-B1x9QzPa.js`, { method }), { ...env, ASSETS: asset('export {}', 'text/javascript', status) });
    expect(response.status).toBe(status); expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('caches fixed-name root fonts for a day only', async () => {
    const response = await handleRequest(new Request(`${BASE}/InterVariable.ttf`), { ...env, ASSETS: asset('font', 'font/ttf') });
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400');
  });

  it('never caches HTML, including the SPA fallback for a missing bundle', async () => {
    for (const path of ['/', '/profile/alice', '/assets/missing-chunk.js']) {
      const response = await handleRequest(new Request(`${BASE}${path}`), env);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('leaves failed and unhashed asset responses on their default policy', async () => {
    const missing = await handleRequest(new Request(`${BASE}/assets/gone.js`), { ...env, ASSETS: asset('', 'text/plain', 404) });
    expect(missing.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    const image = await handleRequest(new Request(`${BASE}/unknown-dark.png`), { ...env, ASSETS: asset('png', 'image/png') });
    expect(image.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
  });
});
