import { APP_ORIGIN } from '../src/lib/appOrigins';
import { parseRoute, routePath } from '../src/lib/navigation';
import { loadShareData, type ShareData } from './shareData';
import { shareImagePath, type ShareImageEnv } from './shareImages';

/** Keep public profiles, casts and feed definitions distinct. Only recognized
 * public query fields survive; the host is ours.
 */
export function canonicalShareUrl(url: URL): string {
  return `${APP_ORIGIN}${routePath(parseRoute(url))}`;
}

export function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The initial document, rather than client-side effects, supplies crawler tags. */
export async function withShareUrl(response: Response, url: URL, method: string, env?: ShareImageEnv, signal?: AbortSignal): Promise<Response> {
  if (response.status !== 200 || !response.headers.get('Content-Type')?.toLowerCase().includes('text/html')) return response;
  const canonical = canonicalShareUrl(url);
  const headers = new Headers(response.headers);
  headers.set('Link', `<${canonical}>; rel="canonical"`);
  // The binding's validators describe the template, before URL rewriting.
  headers.delete('Content-Length');
  headers.delete('ETag');
  if (method === 'HEAD') return new Response(null, { status: response.status, headers });

  const attribute = escapeAttribute(canonical);
  let html = (await response.text())
    .replace(/<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${attribute}" />`)
    .replace(/<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${attribute}" />`);
  const data = env && html.includes('property="og:image"') ? await loadShareData(parseRoute(url), env, signal) : undefined;
  if (data) html = individualMetadata(html, data);
  return new Response(html, { status: response.status, headers });
}

/** Replace only our known head tags; untrusted display values stay escaped. */
export function individualMetadata(html: string, data: ShareData): string {
  const profile = data.profile;
  const identity = profile.username ? `${profile.displayName} (@${profile.username})` : `${profile.displayName} (FID ${profile.fid})`;
  const title = `${identity}${data.kind === 'cast' ? ' posted' : ''} · Opencaster`;
  const description = data.kind === 'cast' ? data.text || 'An image cast on Hypersnap. View the full conversation on Opencaster.'
    : profile.bio || `View ${identity}’s public Hypersnap profile, casts and conversations on Opencaster.`;
  const image = `${APP_ORIGIN}${shareImagePath(data)}`;
  const alt = data.kind === 'cast' ? `Cast by ${identity}: ${data.text}` : `Profile of ${identity}${profile.bio ? `: ${profile.bio}` : ''}`;
  const values: Record<string, string> = {
    description, 'og:title': title, 'twitter:title': title,
    'og:description': description, 'twitter:description': description,
    'og:image': image, 'og:image:secure_url': image, 'twitter:image': image,
    'og:image:alt': Array.from(alt).slice(0, 420).join(''), 'twitter:image:alt': Array.from(alt).slice(0, 420).join(''),
    'og:type': data.kind === 'profile' ? 'profile' : 'article',
  };
  return html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeAttribute(title)}</title>`)
    .replace(/<meta\b[^>]*\b(?:name|property)="([^"]+)"[^>]*\/>/g, (tag, name: string) =>
      values[name] === undefined ? tag : tag.replace(/\bcontent="[^"]*"/, () => `content="${escapeAttribute(values[name])}"`));
}
