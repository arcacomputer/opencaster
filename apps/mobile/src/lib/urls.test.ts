import { describe, expect, it } from 'vitest';
import { safeHttpUrl, safeHttpsUrl, safeMediaEmbedUrls, splitSafeLinks } from './urls';

describe('mobile external URL handling', () => {
  it('parses only credential-free HTTP(S) URLs', () => {
    expect(safeHttpUrl('https://images.example/image.png')).toBe('https://images.example/image.png');
    expect(safeHttpUrl('http://images.example/image.png')).toBe('http://images.example/image.png');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('https://user:pass@example.com/image.png')).toBeNull();
  });

  it('allows only HTTPS links to be opened from cast text', () => {
    expect(safeHttpsUrl('https://example.com/post')).toBe('https://example.com/post');
    expect(safeHttpsUrl('http://example.com/post')).toBeNull();
  });

  it('limits media to two HTTPS URL embeds and skips other embed types', () => {
    expect(safeMediaEmbedUrls([
      { url: 'https://images.example/first.png' },
      { cast_id: { fid: 3, hash: 'a'.repeat(40) } },
      { url: 'https://images.example/third.png' },
    ])).toEqual(['https://images.example/first.png']);
    expect(safeMediaEmbedUrls([
      { url: 'http://images.example/cleartext.png' },
      { url: 'javascript:alert(1)' },
      { url: 'https://images.example/third.png' },
    ])).toEqual([]);
    expect(safeMediaEmbedUrls([
      { url: 'https://images.example/first.png' },
      { url: 'https://images.example/second.png' },
      { url: 'https://images.example/third.png' },
    ])).toEqual([
      'https://images.example/first.png',
      'https://images.example/second.png',
    ]);
  });

  it('splits HTTPS links from cast text without their trailing punctuation', () => {
    expect(splitSafeLinks('Read https://example.com/story. Thanks')).toEqual([
      { text: 'Read ' },
      { text: 'https://example.com/story', url: 'https://example.com/story' },
      { text: '. Thanks' },
    ]);
    expect(splitSafeLinks('custom:scheme')).toEqual([{ text: 'custom:scheme' }]);
  });
});
