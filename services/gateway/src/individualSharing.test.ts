import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, type Env } from './index';
import { individualMetadata } from './sharing';
import type { ShareData } from './shareData';

const html = readFileSync(new URL('../../../apps/web-client/index.html', import.meta.url), 'utf8');
const hash = 'ab'.repeat(20);
const user = {
  fid: 42, username: 'alice', display_name: 'Alice & friends',
  profile: { bio: { text: 'Building <open> things — hello 🌎' } },
  pfp_url: 'https://imagedelivery.net/account/avatar/public', follower_count: 10, following_count: 2,
};
const meta = (text: string, key: string) => new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`).exec(text)?.[1];
const shell: Env = { ASSETS: { fetch: async () => new Response(html, { headers: { 'Content-Type': 'text/html', ETag: '"template"' } }) } };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('individual public metadata', () => {
  it.each(['/alice', '/profile/alice', '/profile/42?tab=likes'])('shows the resolved profile in initial HTML at %s', async path => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ user }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`https://opencaster.org${path}`, { headers: { 'User-Agent': 'TelegramBot (like TwitterBot)' } }), shell);
    const text = await response.text();
    expect(meta(text, 'og:title')).toBe('Alice &amp; friends (@alice) · Opencaster');
    expect(meta(text, 'twitter:title')).toBe(meta(text, 'og:title'));
    expect(meta(text, 'description')).toBe('Building &lt;open&gt; things — hello 🌎');
    expect(meta(text, 'og:description')).toBe(meta(text, 'description'));
    expect(meta(text, 'og:image')).toBe('https://opencaster.org/_share/v1/profile/42.png');
    expect(meta(text, 'twitter:image')).toBe(meta(text, 'og:image'));
    expect(meta(text, 'og:type')).toBe('profile');
    expect(text).not.toContain(user.pfp_url);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('ETag')).toBeNull();
  });

  it.each(['TelegramBot (like TwitterBot)', 'Twitterbot/1.0', 'Mozilla/5.0'])('shows exact cast text and author to %s', async userAgent => {
    const fetch = vi.fn(async (input: string, _init?: RequestInit) => {
      const url = new URL(input);
      return new Response(JSON.stringify(url.pathname.endsWith('/cast')
        ? { cast: { hash, author: user, text: 'A real post: <script>alert("x")</script> & $& 🌎', timestamp: '2026-10-26T12:00:00Z', embeds: [] } }
        : { user }), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetch);
    const response = await handleRequest(new Request(`https://opencaster.org/cast/0x${hash}?utm_source=share`, { headers: { 'User-Agent': userAgent, Authorization: 'private-browser-header', Cookie: 'session=private' } }), shell);
    const text = await response.text();
    expect(meta(text, 'og:title')).toBe('Alice &amp; friends (@alice) posted · Opencaster');
    expect(meta(text, 'og:description')).toContain('A real post: &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; $&amp; 🌎');
    expect(meta(text, 'og:image')).toBe(`https://opencaster.org/_share/v1/cast/42/${hash}.png`);
    expect(meta(text, 'og:url')).toBe(`https://opencaster.org/cast/0x${hash}`);
    expect(meta(text, 'og:type')).toBe('article');
    expect(text).not.toContain('<script>alert');
    expect(text).not.toContain('private-browser-header');
    const init = fetch.mock.calls[0][1] as RequestInit | undefined;
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    expect(new Headers(init?.headers).has('Cookie')).toBe(false);
  });

  it('retains the generic card for deleted casts, unavailable profiles and own-profile routes', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    for (const path of [`/cast/0x${hash}`, '/alice', '/profile']) {
      const text = await (await handleRequest(new Request(`https://opencaster.org${path}`), shell)).text();
      expect(meta(text, 'og:image')).toBe('https://opencaster.org/opencaster-social-v2.png');
      expect(meta(text, 'og:title')).toBe('Opencaster · An open source social client');
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps XML-sensitive names, quotes and replacement tokens inside single escaped tags', () => {
    const data: ShareData = { kind: 'profile', profile: { fid: 42, username: 'alice', displayName: '"><img src=x> $&', bio: '" onload="danger & $`', followers: 0 } };
    const text = individualMetadata(html, data);
    expect(text).not.toContain('<img src=x>');
    expect(meta(text, 'og:title')).toContain('&quot;&gt;&lt;img src=x&gt; $&amp;');
    expect(meta(text, 'description')).toBe('&quot; onload=&quot;danger &amp; $`');
    expect((text.match(/property="og:title"/g) ?? [])).toHaveLength(1);
    expect((text.match(/name="twitter:title"/g) ?? [])).toHaveLength(1);
  });
});
