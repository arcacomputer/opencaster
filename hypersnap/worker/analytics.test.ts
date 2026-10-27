import { describe, expect, it, vi } from 'vitest';
import { handleAnalyticsEvents, recordRequestMetric, type AnalyticsEnv } from './analytics';

const BASE = 'https://opencaster.org';
const event = { kind: 'click', page: 'profile', name: 'profile-follow' };

function request(body: unknown = { events: [event] }, headers: Record<string, string> = {}, url = `${BASE}/_analytics/events`): Request {
  const req = new Request(url, {
    method: 'POST',
    headers: { Origin: BASE, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  Object.defineProperty(req, 'cf', { value: { country: 'CL', city: 'never-stored', latitude: '-33.0' }, configurable: true });
  return req;
}

function environment() {
  const writeDataPoint = vi.fn();
  const env: AnalyticsEnv = { ANALYTICS: { writeDataPoint } };
  return { env, writeDataPoint };
}

describe('aggregate browser analytics ingestion', () => {
  it('stores only allowlisted labels and coarse categories, with no identifiers or request metadata', async () => {
    const { env, writeDataPoint } = environment();
    const req = request({ events: [event, { kind: 'vital', page: 'search', name: 'LCP', value: 1523 }] }, {
      'User-Agent': 'Mozilla/5.0 (iPhone; private-device-123) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      'CF-Connecting-IP': '192.0.2.3', Cookie: 'vault=secret', Authorization: 'Bearer private-key',
      Referer: `${BASE}/profile/1234?search=private`,
    });
    const response = await handleAnalyticsEvents(req, env);
    expect(response.status).toBe(204);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('');
    expect(writeDataPoint.mock.calls).toEqual([
      [{ blobs: ['click', 'profile', 'profile-follow', 'CL', 'mobile', 'safari'], doubles: [1, 0], indexes: ['opencaster'] }],
      [{ blobs: ['vital', 'search', 'LCP', 'CL', 'mobile', 'safari'], doubles: [1, 1523], indexes: ['opencaster'] }],
    ]);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it.each([
    ['https://evil.example', 'same-origin'], ['null', 'same-origin'], [BASE, 'cross-site'], [BASE, 'same-site'], [BASE, 'none'],
  ])('rejects untrusted Origin/site combinations before reading a body: %s %s', async (origin, site) => {
    const { env, writeDataPoint } = environment();
    const req = request(undefined, { Origin: origin, 'Sec-Fetch-Site': site });
    expect((await handleAnalyticsEvents(req, env)).status).toBe(403);
    expect(req.bodyUsed).toBe(false);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it('requires the exact production endpoint, no query, and a same-origin Origin header', async () => {
    const { env, writeDataPoint } = environment();
    for (const origin of ['https://www.opencaster.org', 'https://opencaster.org.evil.example', 'https://hypersnap-quorum.lf-e32.workers.dev', 'http://localhost:5173']) {
      const req = request(undefined, { Origin: origin }, `${origin}/_analytics/events`);
      expect((await handleAnalyticsEvents(req, env)).status).toBe(403);
      expect(req.bodyUsed).toBe(false);
    }
    const missingOrigin = request(); missingOrigin.headers.delete('Origin');
    expect((await handleAnalyticsEvents(missingOrigin, env)).status).toBe(403);
    for (const path of ['/_analytics/events?fid=123', '/_analytics/events#private', '/_analytics/events/', '/_analytics/other']) {
      const req = request(undefined, {}, `${BASE}${path}`);
      expect((await handleAnalyticsEvents(req, env)).status).toBe(400);
      expect(req.bodyUsed).toBe(false);
    }
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it('accepts a same-origin request without Fetch Metadata and normalizes finite country/browser/device categories', async () => {
    const { env, writeDataPoint } = environment();
    const req = request(undefined, { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/130.0 Safari/537.36 Edg/130.0' });
    req.headers.delete('Sec-Fetch-Site');
    Object.defineProperty(req, 'cf', { value: undefined, configurable: true });
    expect((await handleAnalyticsEvents(req, env)).status).toBe(204);
    expect(writeDataPoint).toHaveBeenCalledWith({ blobs: ['click', 'profile', 'profile-follow', 'XX', 'desktop', 'edge'], doubles: [1, 0], indexes: ['opencaster'] });
  });

  it('ignores unexpected country strings and raw browser headers', async () => {
    const { env, writeDataPoint } = environment();
    const req = new Request(`${BASE}/_analytics/events`, { method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json', 'CF-IPCountry': 'US', 'User-Agent': 'private-key=never-store' }, body: JSON.stringify({ events: [event] }) });
    Object.defineProperty(req, 'cf', { value: { country: 'United States/private' } });
    expect((await handleAnalyticsEvents(req, env)).status).toBe(204);
    expect(writeDataPoint).toHaveBeenCalledWith({ blobs: ['click', 'profile', 'profile-follow', 'XX', 'other', 'other'], doubles: [1, 0], indexes: ['opencaster'] });
  });

  it('allows POST JSON only and never enables a credentialed or cross-origin response', async () => {
    const { env, writeDataPoint } = environment();
    for (const method of ['GET', 'OPTIONS', 'PUT']) {
      const req = new Request(`${BASE}/_analytics/events`, { method, headers: { Origin: BASE } });
      expect((await handleAnalyticsEvents(req, env)).status).toBe(405);
    }
    for (const type of ['text/plain', 'application/octet-stream', 'application/json; charset=latin1', 'application/jsonp']) {
      const req = request(undefined, { 'Content-Type': type });
      const response = await handleAnalyticsEvents(req, env);
      expect(response.status).toBe(415); expect(req.bodyUsed).toBe(false);
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    }
    const req = request(undefined, { 'Content-Encoding': 'gzip' });
    expect((await handleAnalyticsEvents(req, env)).status).toBe(415);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it.each(['DNT', 'Sec-GPC'])('honors %s without consuming or storing the request', async header => {
    const { env, writeDataPoint } = environment();
    const limit = vi.fn(); env.ANALYTICS_RATE_LIMITER = { limit };
    const req = request({ privateKey: 'never-read' }, { [header]: '1' });
    expect((await handleAnalyticsEvents(req, env)).status).toBe(204);
    expect(req.bodyUsed).toBe(false); expect(writeDataPoint).not.toHaveBeenCalled(); expect(limit).not.toHaveBeenCalled();
  });

  it.each([
    null, [], {}, { events: [] }, { events: Array.from({ length: 21 }, () => event) },
    { events: [event], fid: 123 }, { events: [{ ...event, fid: 123 }] },
    { events: [{ ...event, page: '/profile/123' }] }, { events: [{ ...event, name: 'wallet:private-key' }] },
    { events: [{ ...event, value: 123 }] }, { events: [{ ...event, kind: 'unknown' }] },
    { events: [{ kind: 'vital', page: 'search', name: 'LCP', value: -1 }] },
    { events: [{ kind: 'vital', page: 'search', name: 'LCP', value: 600_001 }] },
    { events: [{ kind: 'vital', page: 'search', name: 'CLS', value: 11 }] },
    { events: [event, { kind: 'error', page: 'connect', name: 'private-exception' }] },
  ])('rejects the complete batch if any content is outside the finite schema: %j', async body => {
    const { env, writeDataPoint } = environment();
    expect((await handleAnalyticsEvents(request(body), env)).status).toBe(400);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and invalid UTF-8 with generic, empty errors', async () => {
    const { env, writeDataPoint } = environment();
    for (const body of ['{"events": [private-key', new Uint8Array([0xff, 0xfe])]) {
      const req = new Request(`${BASE}/_analytics/events`, { method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json' }, body });
      const response = await handleAnalyticsEvents(req, env);
      expect(response.status).toBe(400); expect(await response.text()).toBe('');
    }
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it('bounds declared length before reading and cancels chunked bodies after 8192 bytes', async () => {
    const { env, writeDataPoint } = environment();
    for (const [declared, status] of [['8193', 413], ['-1', 400], ['junk', 400]] as const) {
      const req = request(undefined, { 'Content-Length': declared });
      expect((await handleAnalyticsEvents(req, env)).status).toBe(status);
      expect(req.bodyUsed).toBe(false);
    }
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(8192)); controller.enqueue(new Uint8Array(1)); }, cancel });
    const req = new Request(`${BASE}/_analytics/events`, { method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit);
    expect((await handleAnalyticsEvents(req, env)).status).toBe(413);
    expect(cancel).toHaveBeenCalledTimes(1); expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it('limits event batches with an address used only as a transient limiter key', async () => {
    const { env, writeDataPoint } = environment();
    const limit = vi.fn().mockResolvedValue({ success: false }); env.ANALYTICS_RATE_LIMITER = { limit };
    const req = request(undefined, { 'CF-Connecting-IP': '192.0.2.99' });
    expect((await handleAnalyticsEvents(req, env)).status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: '192.0.2.99' });
    expect(req.bodyUsed).toBe(false); expect(writeDataPoint).not.toHaveBeenCalled();
    limit.mockResolvedValueOnce({ success: true });
    expect((await handleAnalyticsEvents(request(undefined, { 'CF-Connecting-IP': '192.0.2.99' }), env)).status).toBe(204);
    expect(JSON.stringify(writeDataPoint.mock.calls)).not.toContain('192.0.2.99');
  });

  it('keeps analytics outages and missing optional bindings away from the app', async () => {
    expect((await handleAnalyticsEvents(request(), {})).status).toBe(204);
    const writeDataPoint = vi.fn().mockImplementation(() => { throw new Error('do-not-log'); });
    const req = request({ events: [event, event] });
    expect((await handleAnalyticsEvents(req, { ANALYTICS: { writeDataPoint } })).status).toBe(204);
    expect(writeDataPoint).toHaveBeenCalledTimes(2);
    const limit = vi.fn().mockRejectedValue(new Error('do-not-log'));
    const limitedRequest = request();
    expect((await handleAnalyticsEvents(limitedRequest, { ANALYTICS: { writeDataPoint }, ANALYTICS_RATE_LIMITER: { limit } })).status).toBe(204);
    expect(limitedRequest.bodyUsed).toBe(false);
  });
});

describe('safe Worker request metrics', () => {
  it('stores status class, duration, and fixed route family without reading the request body', () => {
    const { env, writeDataPoint } = environment();
    const req = request({ privateKey: 'never-read' }, { Cookie: 'secret', Authorization: 'Bearer secret', 'CF-Connecting-IP': '192.0.2.6' }, `${BASE}/api/v1/submitMessage?fid=private`);
    recordRequestMetric(env, req, 502, 402.5, 'api');
    expect(req.bodyUsed).toBe(false);
    expect(writeDataPoint.mock.calls).toEqual([[{ blobs: ['request', 'api', '5xx', 'CL', 'other', 'other'], doubles: [1, 402.5], indexes: ['opencaster'] }]]);
  });

  it('rejects dynamic categories, unknown timings/statuses, other hosts, and opt-outs', () => {
    const { env, writeDataPoint } = environment();
    for (const category of ['/profile/123', 'api?fid=123', 'private-key', 'analytics']) recordRequestMetric(env, request(), 200, 10, category);
    for (const duration of [NaN, Infinity, -1]) recordRequestMetric(env, request(), 200, duration, 'api');
    for (const status of [0, 600, 200.5]) recordRequestMetric(env, request(), status, 10, 'api');
    recordRequestMetric(env, request(undefined, {}, 'https://evil.example/private'), 200, 10, 'api');
    for (const optOut of ['DNT', 'Sec-GPC']) recordRequestMetric(env, request(undefined, { [optOut]: '1' }), 200, 10, 'api');
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it('bounds extreme positive durations and swallows binding errors', () => {
    const { env, writeDataPoint } = environment();
    recordRequestMetric(env, request(), 200, 9_000_000, 'page');
    expect(writeDataPoint.mock.calls[0][0].doubles).toEqual([1, 600_000]);
    writeDataPoint.mockImplementation(() => { throw new Error('private-stack'); });
    expect(() => recordRequestMetric(env, request(), 200, 10, 'page')).not.toThrow();
  });
});
