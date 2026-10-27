import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { bindingQuery, createAnalyticsHandler, verifyAccessJwt, type AnalyticsDashboardContext, type AnalyticsDashboardEnv } from './worker';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const DOMAIN = 'operator-tests.cloudflareaccess.com';
const AUDIENCE = 'a'.repeat(64);
const BASE = 'https://analytics.opencaster.org';
let keyPair: CryptoKeyPair;
let publicKey: JsonWebKey & { kid: string };
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

beforeAll(async () => {
  keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  publicKey = { ...await crypto.subtle.exportKey('jwk', keyPair.publicKey), kid: 'synthetic-signing-key', alg: 'RS256', use: 'sig' };
});

async function token(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}): Promise<string> {
  const encoded = `${encode({ alg: 'RS256', kid: publicKey.kid, ...header })}.${encode({ iss: `https://${DOMAIN}`, aud: [AUDIENCE], exp: NOW / 1000 + 3600, nbf: NOW / 1000 - 60, email: 'synthetic-operator@example.invalid', ...claims })}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(encoded));
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encoded}.${base64}`;
}

function request(assertion?: string, path = '/', options: RequestInit = {}): Request {
  return new Request(`${BASE}${path}`, { ...options, headers: { ...(assertion ? { 'Cf-Access-Jwt-Assertion': assertion } : {}), ...options.headers } });
}

function setup(rows: unknown[] = [{ kind: 'visit', events: 20 }]) {
  const query = vi.fn(async (_options: { query: string }) => ({ data: rows }));
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ keys: [publicKey] }));
  const env: AnalyticsDashboardEnv = { ACCESS_TEAM_DOMAIN: DOMAIN, ACCESS_AUD: AUDIENCE, ANALYTICS_SQL: { query } };
  const handler = createAnalyticsHandler({ fetcher, now: () => NOW });
  return { env, query, fetcher, handler };
}

describe('private analytics Access verification', () => {
  it('verifies a real RS256 signature and fetches only the deployment-fixed JWKS endpoint without identity headers', async () => {
    const { env, fetcher } = setup();
    expect(await verifyAccessJwt(request(await token({}, { jku: 'https://evil.invalid/certs', x5u: 'https://evil.invalid/cert' })), env, fetcher, NOW)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toMatchObject([`https://${DOMAIN}/cdn-cgi/access/certs`, { redirect: 'error' }]);
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('headers');
  });

  it('requires the signed assertion and configured audience before fetching keys', async () => {
    const { env, fetcher } = setup();
    for (const req of [request(), request(undefined, '/', { headers: { Cookie: 'CF_Authorization=unverified', 'Cf-Access-Authenticated-User-Email': 'operator@example.invalid' } }), request('invalid'), request('x'.repeat(16_385))]) {
      expect(await verifyAccessJwt(req, env, fetcher, NOW)).toBe(false);
    }
    for (const override of [{ ACCESS_AUD: '' }, { ACCESS_AUD: 'other-app' }, { ACCESS_TEAM_DOMAIN: '' }, { ACCESS_TEAM_DOMAIN: 'https://operator-tests.cloudflareaccess.com' }, { ACCESS_TEAM_DOMAIN: 'operator-tests.cloudflareaccess.com.evil.invalid' }]) {
      expect(await verifyAccessJwt(request(await token()), { ...env, ...override }, fetcher, NOW)).toBe(false);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects missing, expired, future, wrong-issuer and wrong-audience claims before fetching any key', async () => {
    const { env, fetcher } = setup();
    for (const claims of [{ iss: 'https://evil.invalid' }, { aud: ['b'.repeat(64)] }, { aud: [AUDIENCE, 5] }, { exp: NOW / 1000 }, { exp: String(NOW / 1000 + 60) }, { exp: null }, { nbf: NOW / 1000 + 1 }, { nbf: null }, { nbf: NOW / 1000 + 7200 }]) {
      expect(await verifyAccessJwt(request(await token(claims)), env, fetcher, NOW)).toBe(false);
    }
    for (const header of [{ alg: 'none' }, { alg: 'HS256' }, { kid: '' }, { crit: ['custom'] }]) expect(await verifyAccessJwt(request(await token({}, header)), env, fetcher, NOW)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a modified signature or unknown key even when claims are valid', async () => {
    const { env, fetcher } = setup();
    const signed = await token();
    const parts = signed.split('.');
    parts[1] = encode({ iss: `https://${DOMAIN}`, aud: AUDIENCE, exp: NOW / 1000 + 3600, nbf: NOW / 1000 - 60, role: 'injected' });
    expect(await verifyAccessJwt(request(parts.join('.')), env, fetcher, NOW)).toBe(false);
    expect(await verifyAccessJwt(request(await token({}, { kid: 'unknown' })), env, fetcher, NOW)).toBe(false);
  });

  it('fails closed for unavailable, malformed, oversized or ambiguous public key responses', async () => {
    const { env } = setup();
    const signed = await token();
    const failures = [
      async () => { throw new Error('PRIVATE-UPSTREAM-DETAIL'); },
      async () => new Response('PRIVATE-UPSTREAM-DETAIL', { status: 500 }),
      async () => new Response('not-json'),
      async () => new Response('{}', { headers: { 'Content-Length': '65537' } }),
      async () => new Response('x'.repeat(65_537)),
      async () => Response.json({ keys: [publicKey, publicKey] }),
      async () => Response.json({ keys: [{ ...publicKey, alg: 'HS256' }] }),
      async () => Response.json({ keys: [{ ...publicKey, use: 'enc' }] }),
      async () => Response.json({ keys: Array.from({ length: 17 }, () => publicKey) }),
    ];
    for (const fetcher of failures) expect(await verifyAccessJwt(request(signed), env, fetcher, NOW)).toBe(false);
  });

  it('bounds the entire key fetch and body read even when the transport ignores cancellation', async () => {
    const { env } = setup();
    const signed = await token();
    vi.useFakeTimers();
    try {
      for (const fetcher of [
        async () => new Promise<Response>(() => {}),
        async () => new Response(new ReadableStream<Uint8Array>({ start() {} })),
      ]) {
        const verification = verifyAccessJwt(request(signed), env, fetcher, NOW);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(await verification).toBe(false);
      }
    } finally { vi.useRealTimers(); }
  });
});

describe('private analytics request boundary', () => {
  it('accepts the runtime-authenticated Access context only for the configured application without reading identity or assertion headers', async () => {
    const { env, query, fetcher, handler } = setup();
    const getIdentity = vi.fn(() => { throw new Error('Identity must not be read'); });
    const context = { access: { aud: AUDIENCE, getIdentity } };
    const result = await handler(request(), env, context);
    expect(result.status).toBe(200);
    expect(query).toHaveBeenCalledTimes(10);
    expect(fetcher).not.toHaveBeenCalled();
    expect(getIdentity).not.toHaveBeenCalled();
  });

  it('fails closed for a wrong or malformed runtime audience without falling back to an otherwise valid assertion', async () => {
    const { env, query, fetcher, handler } = setup();
    const signed = await token();
    for (const access of [{ aud: 'b'.repeat(64) }, { aud: '' }, { aud: [AUDIENCE] }, {}, null]) {
      const context = { access } as unknown as AnalyticsDashboardContext;
      const result = await handler(request(signed), env, context);
      expect(result.status).toBe(403);
    }
    expect(query).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires valid deployment configuration even with a runtime-authenticated application', async () => {
    const { env, query, fetcher, handler } = setup();
    for (const override of [{ ACCESS_TEAM_DOMAIN: '' }, { ACCESS_TEAM_DOMAIN: 'invalid.example' }, { ACCESS_AUD: '' }, { ACCESS_AUD: 'not-an-audience' }]) {
      expect((await handler(request(), { ...env, ...override }, { access: { aud: override.ACCESS_AUD ?? AUDIENCE } })).status).toBe(403);
    }
    expect(query).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('retains signature verification when no runtime Access context is supplied and ignores spoofed context headers', async () => {
    const { env, query, fetcher, handler } = setup();
    const forged = request(undefined, '/', { headers: { 'Cf-Access-Aud': AUDIENCE, 'Cf-Access-Authenticated-User-Email': 'synthetic-operator@example.invalid', Cookie: 'CF_Authorization=unverified' } });
    expect((await handler(forged, env, {})).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect((await handler(request(await token()), env, {})).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(10);
  });

  it('denies every unauthenticated request before routes, parameter handling or analytics queries', async () => {
    const { env, query, fetcher, handler } = setup();
    for (const path of ['/', '/report?days=7', '/unknown', '/?sql=SELECT+secret', '/?days=1&days=7']) {
      const result = await handler(request(undefined, path), env);
      expect(result.status).toBe(403);
      expect(await result.text()).toBe('Access denied. Sign in through the private analytics address.');
    }
    expect(fetcher).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
  });

  it('renders fresh aggregate HTML only after authentication, without identity or credentials', async () => {
    const { env, query, handler } = setup();
    const signed = await token();
    const result = await handler(request(signed), env);
    expect(result.status).toBe(200);
    expect(result.headers.get('Content-Type')).toContain('text/html');
    const html = await result.text();
    expect(html).toContain('20'); expect(html).toContain('Countries'); expect(html).toContain('What people do');
    expect(html).not.toContain('synthetic-operator@example.invalid'); expect(html).not.toContain(signed);
    expect(html).not.toMatch(/<script|<iframe|<img|<link/i);
    expect(query).toHaveBeenCalledTimes(10);
    for (const [options] of query.mock.calls) {
      expect(options.query).toContain('FROM events.analyticsEngine.opencaster_activity');
      expect(options.query).not.toContain('FORMAT');
      expect(options.query).not.toContain('_sample_interval');
      expect(options.query).toContain('COUNT(*) AS events');
      expect(options.query).toContain('AVG(double2) AS mean');
      expect(options.query).toMatch(/^SELECT .* LIMIT \d+$/);
    }
    await handler(request(signed), env);
    expect(query).toHaveBeenCalledTimes(20); // No shared report cache.
  });

  it('permits only the fixed paths, GET method and four non-duplicated literal periods', async () => {
    const { env, query, handler } = setup();
    const signed = await token();
    for (const days of ['1', '7', '30', '90']) expect((await handler(request(signed, `/report?days=${days}`), env)).status).toBe(200);
    expect(query).toHaveBeenCalledTimes(40);
    for (const path of ['/?days=2', '/?days=01', '/?days=91', '/?days=', '/?days=7&days=7', '/?days=7&sql=SELECT', '/?sql=SELECT', '/?days=7%27+OR+1%3D1']) expect((await handler(request(signed, path), env)).status).toBe(400);
    for (const path of ['/report/', '/private', '/_analytics/events']) expect((await handler(request(signed, path), env)).status).toBe(404);
    expect((await handler(new Request('https://other.invalid/', { headers: { 'Cf-Access-Jwt-Assertion': signed } }), env)).status).toBe(404);
    for (const method of ['HEAD', 'POST', 'PUT', 'OPTIONS']) expect((await handler(request(signed, '/', { method }), env)).status).toBe(405);
    expect(query).toHaveBeenCalledTimes(40);
  });

  it('applies private, uncacheable and non-embeddable response headers on success and denial', async () => {
    const { env, handler } = setup();
    for (const result of [await handler(request(), env), await handler(request(await token()), env)]) {
      expect(result.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
      expect(result.headers.get('CDN-Cache-Control')).toBe('no-store');
      expect(result.headers.get('Cloudflare-CDN-Cache-Control')).toBe('no-store');
      expect(result.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
      expect(result.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
      expect(result.headers.get('X-Robots-Tag')).toContain('noindex');
      expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(result.headers.get('Referrer-Policy')).toBe('no-referrer');
      expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });

  it('returns a generic unavailable message without rendering partial data or upstream errors', async () => {
    const { env, handler } = setup();
    const signed = await token();
    for (const query of [async () => { throw new Error('SENSITIVE-QUERY-ERROR'); }, async () => ({ data: [null] }), async () => ({ data: Array.from({ length: 1001 }, () => ({})) }), async () => ({ data: [{ name: 'x'.repeat(4 * 1024 * 1024) }] })]) {
      const result = await handler(request(signed), { ...env, ANALYTICS_SQL: { query } });
      expect(result.status).toBe(503);
      expect(await result.text()).toBe('Analytics is temporarily unavailable. Please try again later.');
    }
    expect((await handler(request(signed), { ...env, ANALYTICS_SQL: undefined } as unknown as AnalyticsDashboardEnv)).status).toBe(503);
  });

  it('times out a stalled report and stops scheduling more queries once it completes late', async () => {
    const { env, fetcher } = setup();
    let release: (result: { data: unknown[] }) => void = () => {};
    const pending = new Promise<{ data: unknown[] }>(resolve => { release = resolve; });
    const query = vi.fn(() => pending);
    const handler = createAnalyticsHandler({ fetcher, now: () => NOW, queryDeadlineMs: 10 });
    const result = await handler(request(await token()), { ...env, ANALYTICS_SQL: { query } });
    expect(result.status).toBe(503); expect(query).toHaveBeenCalledTimes(4);
    release({ data: [] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('converts only the report dialect differences required by the native account binding', () => {
    expect(bindingQuery('SELECT blob1 FROM opencaster_activity WHERE timestamp > NOW() LIMIT 20 FORMAT JSON')).toBe('SELECT blob1 FROM events.analyticsEngine.opencaster_activity WHERE timestamp > NOW() LIMIT 20');
  });

  it('keeps the operator deployment separate, without alternate public URLs, credentials or invocation logs', () => {
    const source = readFileSync(new URL('../wrangler.analytics.jsonc', import.meta.url), 'utf8');
    const config = JSON.parse(source.replace(/^\s*\/\/.*$/gm, ''));
    expect(config.main).toBe('analytics/worker.ts');
    expect(config.workers_dev).toBe(false); expect(config.preview_urls).toBe(false);
    expect(config.routes).toEqual([{ pattern: 'analytics.opencaster.org', custom_domain: true }]);
    expect(config.assets).toBeUndefined();
    expect(config.analytics).toEqual({ binding: 'ANALYTICS_SQL' });
    expect(Object.keys(config.vars).sort()).toEqual(['ACCESS_AUD', 'ACCESS_TEAM_DOMAIN']);
    expect(config.observability.enabled).toBe(false);
    expect(config.observability.logs).toMatchObject({ enabled: false, invocation_logs: false, persist: false });
    expect(config.observability.traces.enabled).toBe(false); expect(config.observability.issues.enabled).toBe(false);
  });
});
