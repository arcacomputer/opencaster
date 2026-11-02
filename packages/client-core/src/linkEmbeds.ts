export type LinkEmbedProvider =
  | { kind: 'x'; id: string; url: string }
  | { kind: 'youtube' | 'vimeo' | 'spotify'; id: string; url: string; src: string; title: string };

const X_HOSTS = new Set(['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const SHORT_YOUTUBE_HOSTS = new Set(['youtu.be', 'www.youtu.be']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_START_SECONDS = 7 * 24 * 60 * 60;

function positiveId(value: string, digits: number): string | undefined {
  if (!new RegExp(`^\\d{1,${digits}}$`).test(value)) return;
  const id = BigInt(value);
  return id > 0n ? id.toString() : undefined;
}

function youtubeStart(params: URLSearchParams): number | undefined {
  const key = params.has('start') ? 'start' : 't';
  const values = params.getAll(key);
  if (values.length !== 1 || values[0].length > 20) return;
  const value = values[0];
  let seconds: number;
  if (/^\d+$/.test(value)) seconds = Number(value);
  else {
    const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
    if (!value || !parts) return;
    seconds = Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0);
  }
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= MAX_START_SECONDS ? seconds : undefined;
}

/** Recognize fixed public provider routes. Never trust an arbitrary iframe URL,
 * provider-supplied HTML, credentials, or a query parameter as an embed source.
 */
export function linkEmbedProvider(input: string): LinkEmbedProvider | undefined {
  if (!input || input.length > 2048 || /[\s\\]/.test(input)) return;
  const raw = /^https:\/\/([^/?#]+)([^?#]*)/i.exec(input);
  if (!raw || /[@:%]/.test(raw[1]) || /%|(?:^|\/)\.{1,2}(?:\/|$)/.test(raw[2])) return;
  let parsed: URL;
  try { parsed = new URL(input); } catch { return; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return;
  const { hostname, pathname, searchParams } = parsed;

  if (X_HOSTS.has(hostname)) {
    const match = /^\/(?:([A-Za-z0-9_]{1,15})\/status|i\/web\/status)\/(\d{1,20})(?:\/(?:photo\/[1-4]|video\/1))?\/?$/.exec(pathname);
    const id = match && positiveId(match[2], 20);
    if (!match || !id) return;
    return { kind: 'x', id, url: `https://x.com/${match[1] ? `${match[1]}/status` : 'i/web/status'}/${id}` };
  }

  if (YOUTUBE_HOSTS.has(hostname) || SHORT_YOUTUBE_HOSTS.has(hostname)) {
    let id: string | undefined;
    if (SHORT_YOUTUBE_HOSTS.has(hostname)) id = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(pathname)?.[1];
    else if (pathname === '/watch' && searchParams.getAll('v').length === 1) id = searchParams.get('v') ?? undefined;
    else id = /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(pathname)?.[1];
    if (!id || !YOUTUBE_ID.test(id)) return;
    const start = youtubeStart(searchParams);
    return {
      kind: 'youtube', id, title: 'YouTube video',
      url: `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ''}`,
      src: `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}`,
    };
  }

  if (VIMEO_HOSTS.has(hostname)) {
    if (searchParams.has('h')) return;
    const match = (hostname === 'player.vimeo.com' ? /^\/video\/(\d{1,12})\/?$/ : /^\/(\d{1,12})\/?$/).exec(pathname);
    const id = match && positiveId(match[1], 12);
    if (!id) return;
    return { kind: 'vimeo', id, title: 'Vimeo video', url: `https://vimeo.com/${id}`, src: `https://player.vimeo.com/video/${id}` };
  }

  if (hostname === 'open.spotify.com') {
    const match = /^\/(?:embed\/)?(track|album|playlist|episode|show)\/([A-Za-z0-9]{22})\/?$/.exec(pathname);
    if (!match) return;
    const path = `${match[1]}/${match[2]}`;
    return { kind: 'spotify', id: match[2], title: `Spotify ${match[1]}`, url: `https://open.spotify.com/${path}`, src: `https://open.spotify.com/embed/${path}` };
  }
}
