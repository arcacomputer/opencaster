import { APP_ORIGIN } from '../src/lib/appOrigins';
import { parseRoute, routePath } from '../src/lib/navigation';

/** Keep shared profiles/casts distinct without fetching account or cast data.
 * Only the client's recognized query fields survive; the host is always ours.
 */
export function canonicalShareUrl(url: URL): string {
  return `${APP_ORIGIN}${routePath(parseRoute(url))}`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The initial document, rather than client-side effects, supplies crawler tags. */
export async function withShareUrl(response: Response, url: URL, method: string): Promise<Response> {
  if (response.status !== 200 || !response.headers.get('Content-Type')?.toLowerCase().includes('text/html')) return response;
  const canonical = canonicalShareUrl(url);
  const headers = new Headers(response.headers);
  headers.set('Link', `<${canonical}>; rel="canonical"`);
  // The binding's validators describe the template, before URL rewriting.
  headers.delete('Content-Length');
  headers.delete('ETag');
  if (method === 'HEAD') return new Response(null, { status: response.status, headers });

  const attribute = escapeAttribute(canonical);
  const html = (await response.text())
    .replace(/<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${attribute}" />`)
    .replace(/<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${attribute}" />`);
  return new Response(html, { status: response.status, headers });
}
