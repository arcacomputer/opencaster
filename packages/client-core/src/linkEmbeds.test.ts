import { describe, expect, it } from 'vitest';
import { linkEmbedProvider } from './linkEmbeds';

describe('fixed public link embed providers', () => {
  it.each(['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'])('recognizes X aliases and drops tracking for %s', host => {
    expect(linkEmbedProvider(`https://${host}/Interior/status/463440424141459456?s=20#tracking`)).toEqual({ kind: 'x', id: '463440424141459456', url: 'https://x.com/Interior/status/463440424141459456' });
  });

  it('recognizes X ID routes and media links without treating the media suffix as part of the ID', () => {
    expect(linkEmbedProvider('https://x.com/i/web/status/463440424141459456')?.url).toBe('https://x.com/i/web/status/463440424141459456');
    expect(linkEmbedProvider('https://twitter.com/Interior/status/463440424141459456/photo/2')?.id).toBe('463440424141459456');
    expect(linkEmbedProvider('https://x.com/Interior/status/463440424141459456/video/1')?.id).toBe('463440424141459456');
    expect(linkEmbedProvider('https://x.com/Interior/status/00001')?.id).toBe('1');
  });

  it.each([
    'https://youtube.com/watch?v=dQw4w9WgXcQ&si=tracking',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=tracking',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  ])('uses the fixed YouTube privacy-enhanced player for %s', input => {
    expect(linkEmbedProvider(input)).toEqual({ kind: 'youtube', id: 'dQw4w9WgXcQ', title: 'YouTube video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' });
  });

  it.each([['t=90', 90], ['t=1m30s', 90], ['t=1h2m3s', 3723], ['start=42&t=99', 42]])('retains a bounded YouTube start time: %s', (query, start) => {
    expect(linkEmbedProvider(`https://youtu.be/dQw4w9WgXcQ?${query}`)).toMatchObject({ url: `https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=${start}s`, src: `https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=${start}` });
  });

  it.each(['t=-1', 'start=1.5', 't=99999999999999999999', 't=604801', 't=alert(1)', 't=0', 't=', 't=1&t=2', 'start=invalid&t=20'])('ignores invalid YouTube start values: %s', query => {
    expect(linkEmbedProvider(`https://youtu.be/dQw4w9WgXcQ?${query}`)).toMatchObject({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' });
  });

  it.each(['https://vimeo.com/123456789?share=copy', 'https://www.vimeo.com/123456789', 'https://player.vimeo.com/video/123456789'])('recognizes only public numeric Vimeo routes: %s', input => {
    expect(linkEmbedProvider(input)).toEqual({ kind: 'vimeo', id: '123456789', title: 'Vimeo video', url: 'https://vimeo.com/123456789', src: 'https://player.vimeo.com/video/123456789' });
  });

  it.each(['track', 'album', 'playlist', 'episode', 'show'])('recognizes Spotify %s routes and drops tracking', kind => {
    expect(linkEmbedProvider(`https://open.spotify.com/${kind}/4uLU6hMCjMI75M1A2tKUQC?si=tracking`)).toEqual({ kind: 'spotify', id: '4uLU6hMCjMI75M1A2tKUQC', title: `Spotify ${kind}`, url: `https://open.spotify.com/${kind}/4uLU6hMCjMI75M1A2tKUQC`, src: `https://open.spotify.com/embed/${kind}/4uLU6hMCjMI75M1A2tKUQC` });
    expect(linkEmbedProvider(`https://open.spotify.com/embed/${kind}/4uLU6hMCjMI75M1A2tKUQC`)?.kind).toBe('spotify');
  });

  it.each([
    '', 'https://example.com/post', 'http://x.com/Interior/status/1',
    'https://x.com.evil.test/Interior/status/1', 'https://evil.x.com/Interior/status/1',
    'https://x.com@evil.test/Interior/status/1', 'https://name:password@x.com/Interior/status/1',
    'https://x.com:443/Interior/status/1', 'https://x.com:8443/Interior/status/1',
    'https://x.com./Interior/status/1', 'https://%78.com/Interior/status/1',
    'https://x.com\\@evil.test/Interior/status/1', ' https://x.com/Interior/status/1',
    'https://x.com/Interior\n/status/1', 'https://x.com/old/../Interior/status/1',
    'https://x.com/Interior/%73tatus/1', 'https://x.com/Interior/status/0',
    'https://x.com/Interior/status/123456789012345678901', 'https://x.com/Interior/status/1/extra',
    'https://x.com/Interior/status/1/photo/9', 'https://x.com/Interior',
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'https://youtube.com/redirect?q=https://evil.test',
    'https://youtube.com/watch?v=dQw4w9WgXcQ&v=abcdefghijk', 'https://youtu.be/short',
    'https://youtu.be/dQw4w9WgXcQ/more',
    'https://vimeo.com/0', 'https://vimeo.com/1234567890123', 'https://vimeo.com/123456789/privatehash',
    'https://vimeo.com/123456789?h=privatehash', 'https://player.vimeo.com/video/123456789?h=privatehash',
    'https://open.spotify.com/artist/4uLU6hMCjMI75M1A2tKUQC', 'https://open.spotify.com/track/short',
    'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC/more',
  ])('leaves unsupported or ambiguous input as an ordinary link: %j', input => {
    expect(linkEmbedProvider(input)).toBeUndefined();
  });
});
