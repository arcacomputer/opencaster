/** Separate operator surface. Never imported by the public browser or gateway. */
import { collectReport, renderReport, type AnalyticsRow } from './report.mjs';

export interface AnalyticsSqlBinding {
  query(options: { query: string }): Promise<{ data: unknown }>;
}

export interface AnalyticsDashboardEnv {
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ANALYTICS_SQL: AnalyticsSqlBinding;
}

/** Supplied only by the Cloudflare runtime, never derived from request data. */
export interface AnalyticsDashboardContext {
  access?: { aud: string };
}

const MAX_JWT_BYTES = 16_384;
const MAX_JWKS_BYTES = 65_536;
const QUERY_DEADLINE_MS = 20_000;
const ALLOWED_DAYS = new Set(['1', '7', '30', '90']);
const SECURITY_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  'CDN-Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Vary': 'Cf-Access-Jwt-Assertion, Cookie',
} as const;

function response(body: string, status = 200, html = false): Response {
  return new Response(body, { status, headers: { ...SECURITY_HEADERS, 'Content-Type': html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8' } });
}

function validAccessConfiguration(env: Pick<AnalyticsDashboardEnv, 'ACCESS_TEAM_DOMAIN' | 'ACCESS_AUD'>): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN ?? '')
    && /^[a-f0-9]{64}$/.test(env.ACCESS_AUD ?? '');
}

function decodeSegment(segment: string): Uint8Array<ArrayBuffer> {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment) || segment.length % 4 === 1) throw new Error('Invalid assertion');
  const decoded = atob(segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '='));
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

function decodeObject(segment: string): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeSegment(segment)));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid assertion');
  return value as Record<string, unknown>;
}

async function readJwks(response: Response): Promise<unknown> {
  if (!response.ok || !response.body || Number(response.headers.get('Content-Length')) > MAX_JWKS_BYTES) throw new Error('Unavailable keys');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_JWKS_BYTES) { void reader.cancel().catch(() => {}); throw new Error('Unavailable keys'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** Verify the signed assertion, not an identity header or an unverified cookie.
 * Key location always comes from deployment configuration, never JWT contents.
 * https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
 */
export async function verifyAccessJwt(request: Request, env: Pick<AnalyticsDashboardEnv, 'ACCESS_TEAM_DOMAIN' | 'ACCESS_AUD'>, fetcher: typeof fetch = fetch, now = Date.now()): Promise<boolean> {
  const domain = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  if (!validAccessConfiguration(env)) return false;
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!assertion || assertion.length > MAX_JWT_BYTES) return false;
  try {
    const parts = assertion.split('.');
    if (parts.length !== 3) return false;
    const [encodedHeader, encodedClaims, encodedSignature] = parts;
    const header = decodeObject(encodedHeader);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.kid.length > 256 || header.crit !== undefined) return false;
    const claims = decodeObject(encodedClaims);
    const seconds = Math.floor(now / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== `https://${domain}` || audiences.length > 16 || audiences.some(value => typeof value !== 'string') || !audiences.includes(audience)) return false;
    if (typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp <= seconds) return false;
    if (typeof claims.nbf !== 'number' || !Number.isSafeInteger(claims.nbf) || claims.nbf > seconds || claims.nbf >= claims.exp) return false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          // Ignore token-controlled jku/x5u and use only the fixed team endpoint.
          const keysResponse = await fetcher(`https://${domain}/cdn-cgi/access/certs`, { redirect: 'error', signal: controller.signal });
          const jwks = await readJwks(keysResponse) as { keys?: unknown };
          if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length > 16) return false;
          const matches = jwks.keys.filter((value): value is JsonWebKey & { kid: string } => Boolean(value && typeof value === 'object' && !Array.isArray(value) && value.kid === header.kid));
          if (matches.length !== 1) return false;
          const jwk = matches[0];
          if (jwk.kty !== 'RSA' || jwk.alg !== 'RS256' || (jwk.use !== undefined && jwk.use !== 'sig') || !jwk.n || !jwk.e || jwk.d) return false;
          const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
          return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodeSegment(encodedSignature), new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`));
        })(),
        new Promise<false>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(false); }, 5_000); }),
      ]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  } catch { return false; }
}

/** Only the report's fixed SELECT statements reach the account-scoped binding. */
export function bindingQuery(sql: string): string {
  // The new SQL API applies sample weights itself. Reusing legacy explicit
  // _sample_interval aggregates would apply the weights twice.
  return sql
    .replace('SUM(_sample_interval * double2) / SUM(_sample_interval) AS mean', 'AVG(double2) AS mean')
    .replace('SUM(_sample_interval) AS events', 'COUNT(*) AS events')
    .replace('FROM opencaster_activity ', 'FROM events.analyticsEngine.opencaster_activity ')
    .replace(/ FORMAT JSON$/, '');
}

function analyticsRows(result: unknown): AnalyticsRow[] {
  const rows = (result as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows) || rows.length > 1_000 || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Unavailable report');
  // Bound data returned by a faulty binding before it reaches HTML rendering.
  if (JSON.stringify(rows).length > 4 * 1024 * 1024) throw new Error('Unavailable report');
  return rows as AnalyticsRow[];
}

export function createAnalyticsHandler({ fetcher = fetch, now = Date.now, queryDeadlineMs = QUERY_DEADLINE_MS }: { fetcher?: typeof fetch; now?: () => number; queryDeadlineMs?: number } = {}) {
  return async (request: Request, env: AnalyticsDashboardEnv, context?: AnalyticsDashboardContext): Promise<Response> => {
    // Authenticate before routing, validating input, touching the binding or HTML.
    // Access authenticates direct invocations in the platform and provides this
    // trusted context. Bind it to the exact application whose policy we reviewed.
    // No headers, cookies or identity claims can create a runtime context.
    // https://developers.cloudflare.com/workers/configuration/cloudflare-access/
    const platformAccess = context?.access;
    const authenticated = validAccessConfiguration(env) && (platformAccess !== undefined
      ? platformAccess !== null && platformAccess.aud === env.ACCESS_AUD
      : await verifyAccessJwt(request, env, fetcher, now()));
    if (!authenticated) return response('Access denied. Sign in through the private analytics address.', 403);
    const url = new URL(request.url);
    if (url.hostname !== 'analytics.opencaster.org' || !['/', '/report'].includes(url.pathname)) return response('Not found.', 404);
    if (request.method !== 'GET') return response('Method not allowed.', 405);
    const parameters = [...url.searchParams.keys()];
    const days = url.searchParams.get('days') ?? '7';
    if (!ALLOWED_DAYS.has(days) || parameters.some(key => key !== 'days') || parameters.length > 1) return response('Choose a period of 1, 7, 30 or 90 days.', 400);
    if (!env.ANALYTICS_SQL || typeof env.ANALYTICS_SQL.query !== 'function') return response('Analytics is temporarily unavailable. Please try again later.', 503);
    const deadline = now() + queryDeadlineMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    try {
      const report = await Promise.race([
        collectReport(Number(days), '', async sql => {
          if (stopped || now() >= deadline) throw new Error('Report deadline');
          const result = await env.ANALYTICS_SQL.query({ query: bindingQuery(sql) });
          if (stopped || now() >= deadline) throw new Error('Report deadline');
          return analyticsRows(result);
        }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Report deadline')), queryDeadlineMs); }),
      ]);
      return response(renderReport(report, { days: Number(days), generatedAt: new Date(now()), dashboard: true }), 200, true);
    } catch {
      return response('Analytics is temporarily unavailable. Please try again later.', 503);
    } finally { stopped = true; if (timer !== undefined) clearTimeout(timer); }
  };
}

export default { fetch: createAnalyticsHandler() };
