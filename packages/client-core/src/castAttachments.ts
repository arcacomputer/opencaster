import { isUploadedMediaLocation } from './appOrigins';
import { safeHttpsUrl } from './safeUrl';

// Current and legacy Farcaster playlists redirect to this exact Stream host.
// Keep the browser's JavaScript fetch policy limited to those origins.
export const HLS_CONNECT_ORIGINS: readonly string[] = [
  'https://stream.farcaster.xyz',
  'https://stream.warpcast.com',
  'https://customer-1sfsx5osnbu5jfyw.cloudflarestream.com',
];

export type PlaybackKind = 'video' | 'hls' | 'audio';
export type CastUrlAttachment = { kind: 'image' | 'link' | PlaybackKind; url: string };

function attachmentKind(url: URL): CastUrlAttachment['kind'] {
  const { hostname, pathname } = url;
  if (/\.m3u8$/i.test(pathname)) return 'hls';
  if (/\.(mp4|m4v|mov|webm|ogv)$/i.test(pathname)) return 'video';
  if (/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)$/i.test(pathname)) return 'audio';
  if (/\.(png|apng|jpe?g|jfif|webp|gif|avif|bmp|ico)$/i.test(pathname)
    || hostname === 'imagedelivery.net' || hostname === 'imagedelivery.cloud'
    || (hostname === 'pbs.twimg.com' && pathname.startsWith('/media/'))
    || isUploadedMediaLocation(url)) return 'image';
  return 'link';
}

/** Read the protocol's two URL slots, preserving the authored URLs for opening. */
export function castUrlAttachments(embeds: unknown): CastUrlAttachment[] {
  if (!Array.isArray(embeds)) return [];
  const attachments: CastUrlAttachment[] = [];
  const seen = new Set<string>();
  for (const embed of embeds) {
    if (!embed || typeof embed !== 'object' || !('url' in embed)) continue;
    const url = safeHttpsUrl(embed.url, { preserve: true });
    if (!url) continue;
    const parsed = new URL(url);
    if (seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    attachments.push({ url, kind: attachmentKind(parsed) });
    if (attachments.length === 2) break;
  }
  return attachments;
}
