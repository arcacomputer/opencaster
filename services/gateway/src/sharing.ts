import { APP_ORIGIN } from '@opencaster/client-core/appOrigins';
import { parseRoute, routePath } from '@opencaster/client-core/navigation';
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
  let title: string;
  let description: string;
  let alt: string;
  if (data.kind === 'channel') {
    const { channel } = data;
    title = `${channel.name} (/${channel.id}) · Opencaster`;
    description = channel.description || `Explore /${channel.id}, a public Hypersnap channel, on Opencaster.`;
    alt = `Channel ${channel.name} (/${channel.id}): ${description}`;
  } else if (data.kind === 'feed') {
    const { feed } = data;
    title = `${feed.name} · Custom feed · Opencaster`;
    description = `${feed.sourceCount} public ${feed.sourceCount === 1 ? 'source' : 'sources'}: ${feed.sources.join('; ')}. ${feed.rules.join('; ')}.`;
    alt = `Custom feed ${feed.name}: ${description}`;
  } else {
    const profile = data.profile;
    const identity = profile.username ? `${profile.displayName} (@${profile.username})` : `${profile.displayName} (FID ${profile.fid})`;
    title = `${identity}${data.kind === 'cast' ? ' posted' : ''} · Opencaster`;
    description = data.kind === 'cast' ? data.text || 'An image cast on Hypersnap. View the full conversation on Opencaster.'
      : profile.bio || `View ${identity}’s public Hypersnap profile, casts and conversations on Opencaster.`;
    alt = data.kind === 'cast' ? `Cast by ${identity}: ${data.text}` : `Profile of ${identity}${profile.bio ? `: ${profile.bio}` : ''}`;
  }
  const image = `${APP_ORIGIN}${shareImagePath(data)}`;
  const values: Record<string, string> = {
    description, 'og:title': title, 'twitter:title': title,
    'og:description': description, 'twitter:description': description,
    'og:image': image, 'og:image:secure_url': image, 'twitter:image': image,
    'og:image:alt': Array.from(alt).slice(0, 420).join(''), 'twitter:image:alt': Array.from(alt).slice(0, 420).join(''),
    'og:type': data.kind === 'profile' ? 'profile' : data.kind === 'cast' ? 'article' : 'website',
  };
  return html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeAttribute(title)}</title>`)
    .replace(/<meta\b[^>]*\b(?:name|property)="([^"]+)"[^>]*\/>/g, (tag, name: string) =>
      values[name] === undefined ? tag : tag.replace(/\bcontent="[^"]*"/, () => `content="${escapeAttribute(values[name])}"`));
}
