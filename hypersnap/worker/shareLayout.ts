import type { ShareData, ShareProfile } from './shareData';

export interface ShareImageOptions {
  avatarDataUrl?: string;
  imageDataUrl?: string;
}

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const WIDTH = 1200;
const HEIGHT = 630;
const INK = '#F4EDFF';
const MUTED = '#C8BBD9';
const LAVENDER = '#C4A7FF';

/** Bound work before segmentation and discard characters XML 1.0 cannot carry.
 * Keep joiners and combining marks so names and emoji stay whole when wrapped.
 */
function clean(value: string): string {
  return Array.from(value.slice(0, 8000)).filter(character => {
    const code = character.codePointAt(0)!;
    return code === 9 || code === 10 || code === 13
      || (code >= 32 && code <= 0xd7ff && !(code >= 0x7f && code <= 0x9f))
      || (code >= 0xe000 && code <= 0xfffd)
      || (code >= 0x10000 && code <= 0x10ffff);
  }).join('').replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\r\n?/g, '\n');
}

function escapeXml(value: string): string {
  return clean(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function graphemes(value: string): string[] {
  return Array.from(segmenter.segment(value), item => item.segment);
}

/** Conservative Inter advances; layouts deliberately leave spare horizontal
 * space. Long words and text without spaces still wrap at grapheme boundaries.
 */
function advance(value: string, size: number): number {
  if (/^\p{Mark}+$/u.test(value)) return 0;
  if (/\p{Extended_Pictographic}|[\u{1f1e6}-\u{1f1ff}]/u.test(value)) return size * 1.2;
  const code = value.codePointAt(0)!;
  if (code >= 0x2e80 && code <= 0xa4cf || code >= 0xac00 && code <= 0xd7af
    || code >= 0xf900 && code <= 0xfaff || code >= 0xff01 && code <= 0xff60
    || code >= 0x20000) return size * 1.08;
  if (/^\s$/u.test(value)) return size * 0.3;
  if (/^[ilI.,:;!'`|]$/u.test(value)) return size * 0.3;
  if (/^[mwMW@%&]$/u.test(value)) return size * 0.94;
  if (/^\p{Lu}/u.test(value)) return size * 0.75;
  if (/^[0-9]/u.test(value)) return size * 0.65;
  return size * 0.61;
}

function lineWidth(value: readonly string[], size: number): number {
  return value.reduce((width, character) => width + advance(character, size), 0);
}

function ellipsize(value: string, size: number, width: number): string {
  const characters = graphemes(value.trimEnd());
  while (characters.length && lineWidth([...characters, '…'], size) > width) characters.pop();
  return `${characters.join('').trimEnd()}…`;
}

function wrap(value: string, size: number, width: number, limit: number): string[] {
  const source = graphemes(clean(value).replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
  const characters = source.slice(0, 1800);
  const lines: string[] = [];
  let line: string[] = [];
  for (const character of characters) {
    if (character === '\n') {
      lines.push(line.join('').trimEnd());
      line = [];
      continue;
    }
    if (character === ' ' && !line.length) continue;
    while (line.length && lineWidth(line, size) + advance(character, size) > width) {
      const space = line.lastIndexOf(' ');
      if (space >= 0) {
        lines.push(line.slice(0, space).join('').trimEnd());
        line = line.slice(space + 1);
      } else {
        lines.push(line.join(''));
        line = [];
      }
    }
    if (character !== ' ' || line.length) line.push(character);
  }
  if (line.length) lines.push(line.join('').trimEnd());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const visible = lines.slice(0, limit);
  if ((lines.length > limit || source.length > characters.length) && visible.length) {
    visible[visible.length - 1] = ellipsize(visible[visible.length - 1], size, width);
  }
  return visible;
}

function text(role: string, value: string, x: number, y: number, size: number, extra = ''): string {
  return `<text data-role="${role}" x="${x}" y="${y}" font-size="${size}" ${extra}>${escapeXml(value)}</text>`;
}

function textBlock(role: string, lines: readonly string[], x: number, y: number, size: number, leading: number, extra = ''): string {
  return `<text data-role="${role}" font-size="${size}" ${extra}>${lines.map((line, index) => `<tspan x="${x}" y="${y + index * leading}">${escapeXml(line)}</tspan>`).join('')}</text>`;
}

/** Only decoded, bounded raster bytes supplied by the caller may become SVG
 * image references. Public profile URLs never become fetches or SVG hrefs here.
 */
function rasterDataUrl(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.length <= 3 * 1024 * 1024
    && /^data:image\/(?:png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})+(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
    ? value : undefined;
}

function symbol(x: number, y: number, size: number): string {
  return `<g transform="translate(${x} ${y}) scale(${size / 100})"><rect width="100" height="100" rx="26" fill="#292335"/><path d="M17 78V49a33 33 0 0 1 66 0v29H69V49a19 19 0 0 0-38 0v29Z" fill="#F4EDFF"/><path d="M51 47.8q0-1.3 1.2-1.9l11.1-5.8q1.7-.9 1.7 1.1v41.1q0 2-1.7 1L52.2 77q-1.2-.7-1.2-2Z" fill="#C4A7FF"/></g>`;
}

function initials(profile: ShareProfile): string {
  const words = clean(profile.displayName || profile.username || 'O').trim().split(/\s+/u);
  const first = graphemes(words[0] ?? 'O')[0] ?? 'O';
  const last = words.length > 1 ? graphemes(words[words.length - 1])[0] ?? '' : '';
  return graphemes(`${first}${last}`.toUpperCase()).slice(0, 2).join('');
}

function avatar(profile: ShareProfile, image: string | undefined, cx: number, cy: number, radius: number): string {
  return `<defs><clipPath id="avatar-clip"><circle cx="${cx}" cy="${cy}" r="${radius}"/></clipPath></defs><circle cx="${cx}" cy="${cy}" r="${radius + 5}" fill="#C4A7FF" fill-opacity=".12"/><circle cx="${cx}" cy="${cy}" r="${radius + 1}" fill="url(#avatar)" stroke="#C4A7FF" stroke-opacity=".35" stroke-width="2"/>${image
    ? `<image data-role="avatar" href="${image}" x="${cx - radius}" y="${cy - radius}" width="${radius * 2}" height="${radius * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar-clip)"/>`
    : text('avatar-initials', initials(profile), cx, cy + radius * 0.33, radius * 0.94, `fill="${INK}" text-anchor="middle" font-weight="700"`)}`;
}

function handle(profile: ShareProfile): string {
  return profile.username ? `@${clean(profile.username)}` : `FID ${profile.fid}`;
}

function count(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return;
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function date(value: string): string {
  if (!value || value.length > 80) return '';
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime())
    ? timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
}

function profileCard(profile: ShareProfile, image: string | undefined): string {
  const name = clean(profile.displayName || profile.username || `FID ${profile.fid}`).replace(/\s+/g, ' ');
  const nameSize = lineWidth(graphemes(name), 60) > 770 ? 52 : 60;
  const names = wrap(name, nameSize, 770, 2);
  const nameTop = names.length > 1 ? 226 : 241;
  const nameBottom = nameTop + (names.length - 1) * 61;
  const bioTop = nameBottom + 103;
  const followers = count(profile.followers);
  const following = count(profile.following);
  const counts = [followers === undefined ? '' : `${followers} followers`, following === undefined ? '' : `${following} following`].filter(Boolean);
  return `<g opacity=".45"><circle cx="1014" cy="323" r="157" fill="none" stroke="#C4A7FF" stroke-opacity=".22"/><circle cx="1014" cy="323" r="207" fill="none" stroke="#C4A7FF" stroke-opacity=".12"/><circle cx="1014" cy="323" r="257" fill="none" stroke="#C4A7FF" stroke-opacity=".08"/></g><rect x="64" y="162" width="43" height="5" rx="2.5" fill="${LAVENDER}"/>${textBlock('profile-name', names, 64, nameTop, nameSize, 61, `fill="${INK}" font-weight="700" letter-spacing="-1.8"`)}${textBlock('profile-handle', wrap(handle(profile), 27, 770, 1), 66, nameBottom + 43, 27, 35, `fill="${LAVENDER}"`)}${textBlock('profile-bio', wrap(profile.bio || 'Discover their casts and conversations on Opencaster.', 29, 770, names.length > 1 ? 3 : 4), 66, bioTop, 29, 39, `fill="${MUTED}"`)}${avatar(profile, image, 1014, 310, 104)}${text('profile-counts', counts.join('   ·   ') || `FID ${profile.fid}`, 66, 523, 25, `fill="${INK}" font-weight="500"`)}`;
}

function castCard(data: Extract<ShareData, { kind: 'cast' }>, image: string | undefined, attachment: string | undefined): string {
  const name = data.profile.displayName || data.profile.username || `FID ${data.profile.fid}`;
  const fontSize = attachment ? 36 : graphemes(clean(data.text)).length <= 110 ? 46 : 41;
  const body = data.text || (attachment ? 'Shared a photo.' : 'Shared a cast.');
  const bodyWidth = attachment ? 652 : 1068;
  return `${avatar(data.profile, image, 105, 200, 39)}${textBlock('cast-author', wrap(name.replace(/\s+/g, ' '), 34, 670, 1), 172, 193, 34, 42, `fill="${INK}" font-weight="700" letter-spacing="-.7"`)}${textBlock('cast-handle', wrap(handle(data.profile), 23, 670, 1), 173, 231, 23, 30, `fill="${LAVENDER}"`)}${text('cast-date', date(data.timestamp), 1134, 194, 21, `fill="${MUTED}" text-anchor="end"`)}${textBlock('cast-text', wrap(body, fontSize, bodyWidth, 5), 66, 293, fontSize, attachment ? 49 : 55, `fill="${INK}" letter-spacing="-.5"`)}${attachment
    ? `<defs><clipPath id="attachment-clip"><rect x="764" y="267" width="370" height="263" rx="18"/></clipPath></defs><rect x="763" y="266" width="372" height="265" rx="19" fill="#292335" stroke="#C4A7FF" stroke-opacity=".3"/><image data-role="cast-image" href="${attachment}" x="764" y="267" width="370" height="263" preserveAspectRatio="xMidYMid slice" clip-path="url(#attachment-clip)"/>` : ''}`;
}

/** Original, deterministic 1200×630 artwork. The caller supplies public display
 * data and optional validated raster bytes; the layout never fetches resources.
 */
export function buildShareSvg(data: ShareData, options: ShareImageOptions = {}): string {
  const title = data.kind === 'profile'
    ? `${data.profile.displayName || data.profile.username} on Opencaster`
    : `${data.profile.displayName || data.profile.username} on Opencaster: ${data.text}`;
  const description = data.kind === 'profile' ? data.profile.bio : data.text;
  const avatarData = rasterDataUrl(options.avatarDataUrl);
  const attachmentData = data.kind === 'cast' ? rasterDataUrl(options.imageDataUrl) : undefined;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="share-title share-description"><title id="share-title">${escapeXml(title.slice(0, 500))}</title><desc id="share-description">${escapeXml(description.slice(0, 600))}</desc><defs><linearGradient id="background" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#211B2C"/><stop offset="1" stop-color="#15121E"/></linearGradient><radialGradient id="glow" cx=".86" cy=".35" r=".7"><stop stop-color="#7F54B6" stop-opacity=".21"/><stop offset="1" stop-color="#7F54B6" stop-opacity="0"/></radialGradient><linearGradient id="avatar" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#5B4278"/><stop offset="1" stop-color="#342442"/></linearGradient></defs><rect width="1200" height="630" fill="url(#background)"/><rect width="1200" height="630" fill="url(#glow)"/><path d="M0 1H1200" stroke="#C4A7FF" stroke-opacity=".3"/><g font-family="Inter, sans-serif">${symbol(64, 45, 57)}${text('brand', 'Opencaster', 138, 84, 34, `fill="${INK}" font-weight="700" letter-spacing="-.9"`)}<rect x="${data.kind === 'profile' ? 1006 : 1042}" y="58" width="${data.kind === 'profile' ? 128 : 92}" height="34" rx="17" fill="#C4A7FF" fill-opacity=".1" stroke="#C4A7FF" stroke-opacity=".23"/>${text('card-kind', data.kind === 'profile' ? 'PROFILE' : 'CAST', data.kind === 'profile' ? 1070 : 1088, 81, 15, `fill="${LAVENDER}" text-anchor="middle" font-weight="600" letter-spacing="2"`)}<path d="M64 126H1136" stroke="#C4A7FF" stroke-opacity=".12"/>${data.kind === 'profile' ? profileCard(data.profile, avatarData) : castCard(data, avatarData, attachmentData)}<path d="M64 557H1136" stroke="#C4A7FF" stroke-opacity=".2"/>${text('footer', data.kind === 'profile' ? 'Public profile on Hypersnap' : 'A conversation on Hypersnap', 66, 597, 20, `fill="${MUTED}"`)}${text('domain', 'opencaster.org', 1134, 597, 22, `fill="${INK}" text-anchor="end" font-weight="500"`)}</g></svg>`;
}
