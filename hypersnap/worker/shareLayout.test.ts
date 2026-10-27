import { describe, expect, it } from 'vitest';
import type { FeedDefinition } from '../src/lib/customFeeds';
import type { ShareData, ShareProfile } from './shareData';
import { buildShareSvg } from './shareLayout';

const profile: ShareProfile = {
  fid: 42, username: 'alice', displayName: 'Alice Rivera',
  bio: 'Building an open social world. Art, code, and conversations.',
  avatarUrl: 'https://untrusted.example/avatar.svg', followers: 1200, following: 84,
};
const cast: ShareData = {
  kind: 'cast', profile, hash: `0x${'ab'.repeat(20)}`,
  text: 'An open social world starts with a conversation. What are you building today?',
  timestamp: '2026-10-26T23:30:00-03:00',
};
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
const channel: Extract<ShareData, { kind: 'channel' }> = {
  kind: 'channel', channel: { id: 'art', name: 'Art & imagination', description: 'A space for artists, collectors, and the things that inspire us.', imageUrl: 'https://untrusted.example/art.png', members: 4210 },
};
const definition: FeedDefinition = {
  version: 1, name: 'Art, code & ideas', sources: [{ kind: 'channel', channel: 'art' }, { kind: 'user', fid: 42 }], order: 'newest',
  filters: { includeWords: ['building'], excludeWords: [], imagesOnly: true, hideReplies: true },
};
const feed: Extract<ShareData, { kind: 'feed' }> = {
  kind: 'feed', feed: {
    name: definition.name, sources: ['Channel /art', 'Account FID 42'], sourceCount: 2,
    rules: ['Newest loaded first', 'Includes any phrase: “building”', 'Images only', 'Replies hidden'], definition,
  },
};

function role(svg: string, name: string): string {
  return new RegExp(`<text data-role="${name}"[^>]*>([\\s\\S]*?)</text>`).exec(svg)?.[1] ?? '';
}
function lines(svg: string, name: string): string[] {
  return [...role(svg, name).matchAll(/<tspan\b[^>]*>([^<]*)<\/tspan>/g)].map(match => match[1]);
}

describe('public sharing card SVG layout', () => {
  it('renders the actual profile identity, bio, public counts, and exact Opencaster symbol', () => {
    const svg = buildShareSvg({ kind: 'profile', profile });
    expect(svg).toContain('width="1200" height="630" viewBox="0 0 1200 630"');
    expect(role(svg, 'brand')).toBe('Opencaster');
    expect(role(svg, 'card-kind')).toBe('PROFILE');
    expect(lines(svg, 'profile-name')).toEqual(['Alice Rivera']);
    expect(lines(svg, 'profile-handle')).toEqual(['@alice']);
    expect(lines(svg, 'profile-bio').join(' ')).toBe(profile.bio);
    expect(role(svg, 'profile-counts')).toBe('1.2K followers   ·   84 following');
    expect(role(svg, 'avatar-initials')).toBe('AR');
    expect(svg).toContain('d="M17 78V49a33 33 0 0 1 66 0v29H69V49a19 19 0 0 0-38 0v29Z"');
    expect(svg).toContain('d="M51 47.8q0-1.3 1.2-1.9l11.1-5.8q1.7-.9 1.7 1.1v41.1q0 2-1.7 1L52.2 77q-1.2-.7-1.2-2Z"');
    expect(role(svg, 'footer')).toContain('Hypersnap');
    expect(role(svg, 'domain')).toBe('opencaster.org');
    expect(svg).not.toContain(profile.avatarUrl);
  });

  it('renders the actual cast and author with a deterministic UTC date', () => {
    const svg = buildShareSvg(cast);
    expect(lines(svg, 'cast-author')).toEqual(['Alice Rivera']);
    expect(lines(svg, 'cast-handle')).toEqual(['@alice']);
    expect(lines(svg, 'cast-text').join(' ')).toBe(cast.text);
    expect(role(svg, 'cast-date')).toBe('Oct 27, 2026');
    expect(role(svg, 'card-kind')).toBe('CAST');
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('<filter');
    expect(svg).not.toContain('<foreignObject');
  });

  it('escapes user text and removes invalid XML code points without damaging Unicode', () => {
    const hostile = '"><script>alert(1)</script>&\u0000\u0001\ufffe\ud800';
    const svg = buildShareSvg({ ...cast, profile: { ...profile, displayName: hostile, username: hostile }, text: hostile });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&quot;');
    for (const character of ['\u0000', '\u0001', '\ufffe', '\ud800']) expect(svg).not.toContain(character);
    expect(svg).not.toContain('onload=');
  });

  it.each([
    'https://untrusted.example/image.png',
    'http://127.0.0.1/private',
    'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/png;base64,AAAA" onload="alert(1)',
    'data:image/png;base64,AAAA\nAAAA',
    'data:image/gif;base64,R0lGODlh',
    'data:image/png;base64,',
  ])('never embeds a caller image outside the raster data allowlist: %s', image => {
    const svg = buildShareSvg(cast, { avatarDataUrl: image, imageDataUrl: image });
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('href=');
    expect(svg).not.toContain(image);
  });

  it('embeds supplied raster bytes with bounded, clipped image geometry', () => {
    const svg = buildShareSvg(cast, { avatarDataUrl: png, imageDataUrl: png });
    expect(svg.match(/<image /g)).toHaveLength(2);
    expect(svg).toContain(`data-role="avatar" href="${png}"`);
    expect(svg).toContain(`data-role="cast-image" href="${png}"`);
    expect(svg).toContain('clip-path="url(#avatar-clip)"');
    expect(svg).toContain('clip-path="url(#attachment-clip)"');
    expect(svg).toContain('width="370" height="263"');
  });

  it('bounds output from long names, handles, biographies, casts and oversized data URLs', () => {
    const svg = buildShareSvg({ ...cast, profile: { ...profile, displayName: 'W'.repeat(20000), username: 'w'.repeat(20000) }, text: 'Word '.repeat(20000) }, { imageDataUrl: `data:image/png;base64,${'AAAA'.repeat(1024 * 1024)}` });
    expect(lines(svg, 'cast-author')).toHaveLength(1);
    expect(lines(svg, 'cast-author')[0]).toMatch(/…$/);
    expect(lines(svg, 'cast-handle')).toHaveLength(1);
    expect(lines(svg, 'cast-text')).toHaveLength(5);
    expect(lines(svg, 'cast-text')[4]).toMatch(/…$/);
    expect(svg.length).toBeLessThan(10000);
    expect(svg).not.toContain('<image');
    const person = buildShareSvg({ kind: 'profile', profile: { ...profile, displayName: 'W'.repeat(10000), bio: 'Word '.repeat(10000) } });
    expect(lines(person, 'profile-name')).toHaveLength(2);
    expect(lines(person, 'profile-name')[1]).toMatch(/…$/);
    expect(lines(person, 'profile-bio')).toHaveLength(3);
    expect(lines(person, 'profile-bio')[2]).toMatch(/…$/);
    expect(person.length).toBeLessThan(10000);
  });

  it('wraps words, paragraphs, unbroken URLs, CJK and complete emoji graphemes', () => {
    const emoji = '👩🏽‍💻';
    const svg = buildShareSvg({ ...cast, text: `${emoji.repeat(24)}\n${'界'.repeat(150)}` });
    const textLines = lines(svg, 'cast-text');
    expect(textLines.length).toBeLessThanOrEqual(5);
    expect(textLines[0]).toMatch(new RegExp(`^(?:${emoji})+$`, 'u'));
    expect(textLines[1]).toMatch(new RegExp(`^(?:${emoji})+$`, 'u'));
    expect(textLines[textLines.length - 1]).toMatch(/…$/);
    expect(svg).not.toContain('�');
    const unbroken = buildShareSvg({ ...cast, text: 'https://example.com/' + 'w'.repeat(500) });
    expect(lines(unbroken, 'cast-text')).toHaveLength(5);
    expect(lines(unbroken, 'cast-text')[4]).toMatch(/…$/);
  });

  it('uses honest missing-data fallbacks and omits invalid statistics and dates', () => {
    const minimal = { fid: 42, username: '', displayName: '', bio: '', followers: NaN, following: -1 };
    const svg = buildShareSvg({ kind: 'profile', profile: minimal });
    expect(lines(svg, 'profile-name')).toEqual(['FID 42']);
    expect(lines(svg, 'profile-handle')).toEqual(['FID 42']);
    expect(role(svg, 'profile-counts')).toBe('FID 42');
    expect(lines(svg, 'profile-bio').join(' ')).toContain('Discover their casts');
    expect(svg).not.toMatch(/NaN|Infinity|-1 following/);
    const emptyCast = buildShareSvg({ ...cast, text: '', timestamp: '<script>bad date</script>' });
    expect(lines(emptyCast, 'cast-text')).toEqual(['Shared a cast.']);
    expect(role(emptyCast, 'cast-date')).toBe('');
  });

  it('renders a channel identity, description, participants and a distinct channel icon', () => {
    const svg = buildShareSvg(channel);
    expect(role(svg, 'card-kind')).toBe('CHANNEL');
    expect(lines(svg, 'channel-name')).toEqual(['Art &amp; imagination']);
    expect(lines(svg, 'channel-id')).toEqual(['/art']);
    expect(lines(svg, 'channel-description').join(' ')).toBe(channel.channel.description);
    expect(role(svg, 'channel-counts')).toBe('4.2K participants');
    expect(role(svg, 'channel-symbol')).toBe('#');
    expect(role(svg, 'footer')).toBe('Public channel on Hypersnap');
    expect(svg).toContain('d="M17 78V49a33 33 0 0 1 66 0v29H69V49a19 19 0 0 0-38 0v29Z"');
    expect(svg).not.toContain(channel.channel.imageUrl);
    expect(svg).not.toMatch(/followers|following/);
  });

  it('clips a supplied channel raster and rejects unsafe image references', () => {
    const svg = buildShareSvg(channel, { avatarDataUrl: png });
    expect(svg.match(/<image /g)).toHaveLength(1);
    expect(svg).toContain(`data-role="channel-image" href="${png}"`);
    expect(svg).toContain('clip-path="url(#channel-clip)"');
    expect(svg).toContain('width="208" height="208"');
    expect(role(svg, 'channel-symbol')).toBe('');
    const unsafe = buildShareSvg(channel, { avatarDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' });
    expect(unsafe).not.toContain('<image');
    expect(role(unsafe, 'channel-symbol')).toBe('#');
  });

  it('shows honest channel fallbacks and never invents a participant count', () => {
    const minimal = buildShareSvg({ kind: 'channel', channel: { id: 'art', name: '', description: '', members: NaN } });
    expect(lines(minimal, 'channel-name')).toEqual(['/art']);
    expect(lines(minimal, 'channel-description').join(' ')).toContain('casts and conversations on Hypersnap');
    expect(role(minimal, 'channel-counts')).toBe('A public Hypersnap channel');
    expect(minimal).not.toContain('NaN');
    const singular = buildShareSvg({ ...channel, channel: { ...channel.channel, members: 1 } });
    expect(role(singular, 'channel-counts')).toBe('1 participant');
    const empty = buildShareSvg({ ...channel, channel: { ...channel.channel, members: 0 } });
    expect(role(empty, 'channel-counts')).toBe('0 participants');
  });

  it('shows custom feed sources, actual filters, and bounded ordering language', () => {
    const svg = buildShareSvg(feed, { avatarDataUrl: png, imageDataUrl: png });
    expect(role(svg, 'card-kind')).toBe('CUSTOM FEED');
    expect(lines(svg, 'feed-name')).toEqual(['Art, code &amp; ideas']);
    expect(role(svg, 'feed-source-label')).toBe('2 SOURCES');
    expect(lines(svg, 'feed-sources')).toEqual(feed.feed.sources);
    expect(lines(svg, 'feed-rules')[0]).toBe('Newest loaded first');
    expect(lines(svg, 'feed-rules')).toContain('Match any: “building”');
    expect(lines(svg, 'feed-rules')).toContain('Images only');
    expect(lines(svg, 'feed-rules')).toContain('Replies hidden');
    expect(role(svg, 'footer')).toBe('Custom feed on Hypersnap');
    expect(svg).not.toContain('<image');
    expect(svg).not.toMatch(/global|complete archive|live feed|latest posts/i);
  });

  it('summarizes extra sources while retaining all five types of feed rule', () => {
    const sources = Array.from({ length: 8 }, (_, index) => `Account FID ${index + 1}`);
    const rules = ['Source order (as loaded)', 'Includes any phrase: “art”', 'Excludes any phrase: “sale”', 'Images only', 'Replies hidden'];
    const svg = buildShareSvg({ ...feed, feed: { ...feed.feed, sources, sourceCount: 8, rules } });
    expect(lines(svg, 'feed-sources')).toEqual(sources.slice(0, 4));
    expect(role(svg, 'feed-more-sources')).toBe('+ 4 more sources');
    expect(lines(svg, 'feed-rules')).toHaveLength(5);
    expect(lines(svg, 'feed-rules').slice(-2)).toEqual(['Images only', 'Replies hidden']);
    expect(role(svg, 'feed-source-label')).toBe('8 SOURCES');
  });

  it('bounds long channel and feed text without breaking emoji graphemes or panel geometry', () => {
    const emoji = '👩🏽‍💻';
    const longChannel = buildShareSvg({ kind: 'channel', channel: { id: 'W'.repeat(20000), name: emoji.repeat(2000), description: 'Word '.repeat(10000) } });
    expect(lines(longChannel, 'channel-name')).toHaveLength(2);
    expect(lines(longChannel, 'channel-name')[0]).toMatch(new RegExp(`^(?:${emoji})+$`, 'u'));
    expect(lines(longChannel, 'channel-name')[1]).toMatch(/…$/);
    expect(lines(longChannel, 'channel-id')).toHaveLength(1);
    expect(lines(longChannel, 'channel-description')).toHaveLength(3);
    expect(lines(longChannel, 'channel-description')[2]).toMatch(/…$/);
    expect(longChannel.length).toBeLessThan(10000);
    const longFeed = buildShareSvg({ ...feed, feed: { ...feed.feed, name: 'W'.repeat(20000), sources: Array.from({ length: 8 }, () => emoji.repeat(2000)), sourceCount: 8, rules: Array.from({ length: 5 }, () => 'W'.repeat(10000)) } });
    expect(lines(longFeed, 'feed-name')).toHaveLength(2);
    expect(lines(longFeed, 'feed-name')[1]).toMatch(/…$/);
    expect(lines(longFeed, 'feed-sources')).toHaveLength(4);
    expect(lines(longFeed, 'feed-sources').every(line => line.endsWith('…'))).toBe(true);
    expect(lines(longFeed, 'feed-rules')).toHaveLength(5);
    expect(lines(longFeed, 'feed-rules').every(line => line.endsWith('…'))).toBe(true);
    expect(longFeed.length).toBeLessThan(10000);
    expect(longFeed).not.toContain('�');
    for (const svg of [longChannel, longFeed]) {
      const positions = [...svg.matchAll(/<tspan x="(\d+)" y="(\d+)"/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
      expect(positions.every(position => position.x >= 40 && position.x <= 1160 && position.y >= 40 && position.y <= 530)).toBe(true);
    }
  });

  it('escapes every channel and feed display field and strips invalid XML text', () => {
    const hostile = '"><script>alert(1)</script>&\u0000\u0001\ufffe\ud800';
    const channelSvg = buildShareSvg({ kind: 'channel', channel: { id: hostile, name: hostile, description: hostile } });
    const feedSvg = buildShareSvg({ ...feed, feed: { ...feed.feed, name: hostile, sources: [hostile], rules: [hostile] } });
    for (const svg of [channelSvg, feedSvg]) {
      expect(svg).not.toContain('<script>');
      expect(svg).toContain('&lt;script&gt;');
      expect(svg).toContain('&amp;');
      for (const character of ['\u0000', '\u0001', '\ufffe', '\ud800']) expect(svg).not.toContain(character);
      expect(svg).not.toMatch(/<foreignObject|<filter|<image|onload=/);
    }
  });

  it('falls back safely when optional feed descriptions and counts are absent', () => {
    const svg = buildShareSvg({ ...feed, feed: { ...feed.feed, name: '', sources: [], sourceCount: NaN, rules: [] } });
    expect(lines(svg, 'feed-name')).toEqual(['Custom feed']);
    expect(lines(svg, 'feed-sources')).toEqual(['Public Hypersnap sources']);
    expect(lines(svg, 'feed-rules')).toEqual(['Source order (as loaded)']);
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  });
});
