import { isAnalyticsEvent } from '../src/lib/analyticsEvents';

export interface AnalyticsDataPoint {
  blobs: string[];
  doubles: number[];
  indexes: string[];
}

export interface AnalyticsEnv {
  ANALYTICS?: { writeDataPoint(point: AnalyticsDataPoint): void };
  ANALYTICS_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const ORIGIN = 'https://opencaster.org';
const EVENT_PATH = '/_analytics/events';
const MAX_BODY_BYTES = 8_192;
const MAX_EVENTS = 20;
const REQUEST_CATEGORIES = new Set(['page', 'asset', 'api', 'media', 'other']);

function result(status: number): Response {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
}

function optedOut(request: Request): boolean {
  return request.headers.get('DNT') === '1' || request.headers.get('Sec-GPC') === '1';
}

/** Only coarse, finite categories cross the analytics storage boundary. */
function dimensions(request: Request): [string, string, string] {
  const cf = (request as Request & { cf?: { country?: unknown } }).cf;
  const country = typeof cf?.country === 'string' && /^[A-Z]{2}$/.test(cf.country) ? cf.country : 'XX';
  const ua = request.headers.get('User-Agent') ?? '';
  const browser = /(?:Edg|Edge|EdgiOS|EdgA)\//i.test(ua) ? 'edge'
    : /(?:Firefox|FxiOS)\//i.test(ua) ? 'firefox'
      : /(?:Chrome|Chromium|CriOS)\//i.test(ua) ? 'chrome'
        : /Version\/[^ ]+.*Safari\//i.test(ua) ? 'safari' : 'other';
  const device = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua) ? 'tablet'
    : /Mobile|iPhone|iPod|Android/i.test(ua) ? 'mobile'
      : /Windows|Macintosh|X11|Linux/i.test(ua) ? 'desktop' : 'other';
  return [country, device, browser];
}

function write(env: AnalyticsEnv, kind: string, page: string, name: string, value: number, coarse: [string, string, string]): void {
  try {
    env.ANALYTICS?.writeDataPoint({
      blobs: [kind, page, name, ...coarse],
      doubles: [1, value],
      indexes: ['opencaster'],
    });
  } catch {
    // Analytics availability must never affect reading, signing, or publishing.
  }
}

class BodyTooLarge extends Error {}

async function readBody(request: Request): Promise<unknown> {
  if (!request.body) throw new Error();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** The browser can submit fixed aggregate labels, never arbitrary telemetry. */
export async function handleAnalyticsEvents(request: Request, env: AnalyticsEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== ORIGIN || url.username || url.password
    || request.headers.get('Origin') !== ORIGIN
    || ![null, 'same-origin'].includes(request.headers.get('Sec-Fetch-Site'))) return result(403);
  if (url.pathname !== EVENT_PATH || url.search || url.hash) return result(400);
  if (request.method !== 'POST') return result(405);
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') ?? '')
    || ![null, 'identity'].includes(request.headers.get('Content-Encoding'))) return result(415);
  if (optedOut(request)) return result(204);
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) return result(400);
    if (Number(declaredLength) > MAX_BODY_BYTES) return result(413);
  }
  if (env.ANALYTICS_RATE_LIMITER) {
    // Cloudflare supplies this address. It is only a transient rate-limit key;
    // it is never included in an analytics point, response, or application log.
    const ip = request.headers.get('CF-Connecting-IP');
    try {
      const allowed = await env.ANALYTICS_RATE_LIMITER.limit({ key: ip && ip.length <= 128 ? ip : 'unknown' });
      if (!allowed.success) return result(429);
    } catch {
      return result(204);
    }
  }
  let body: unknown;
  try { body = await readBody(request); }
  catch (error) { return result(error instanceof BodyTooLarge ? 413 : 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return result(400);
  const object = body as Record<string, unknown>;
  if (Object.keys(object).length !== 1 || !Array.isArray(object.events)
    || object.events.length < 1 || object.events.length > MAX_EVENTS
    || !object.events.every(isAnalyticsEvent)) return result(400);
  const coarse = dimensions(request);
  for (const event of object.events) {
    write(env, event.kind, event.page, event.name, event.kind === 'vital' ? event.value : 0, coarse);
  }
  return result(204);
}

/** Request paths, query values, payloads, headers, and faults are never stored. */
export function recordRequestMetric(env: AnalyticsEnv, request: Request, responseStatus: number, durationMs: number, routeCategory: string): void {
  if (!env.ANALYTICS || optedOut(request) || new URL(request.url).origin !== ORIGIN
    || !REQUEST_CATEGORIES.has(routeCategory)
    || !Number.isInteger(responseStatus) || responseStatus < 100 || responseStatus > 599
    || !Number.isFinite(durationMs) || durationMs < 0) return;
  write(env, 'request', routeCategory, `${Math.floor(responseStatus / 100)}xx`, Math.min(durationMs, 600_000), dimensions(request));
}
