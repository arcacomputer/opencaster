import { describe, expect, it } from 'vitest';
import { safeHttpUrl, safeHttpsUrl, splitSafeLinks } from './urls';

describe('mobile external URL handling', () => {
  it('accepts only credential-free HTTP(S) URLs for remote media', () => {
    expect(safeHttpUrl('https://images.example/image.png')).toBe('https://images.example/image.png');
    expect(safeHttpUrl('http://images.example/image.png')).toBe('http://images.example/image.png');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('https://user:pass@example.com/image.png')).toBeNull();
  });

  it('allows only HTTPS links to be opened from cast text', () => {
    expect(safeHttpsUrl('https://example.com/post')).toBe('https://example.com/post');
    expect(safeHttpsUrl('http://example.com/post')).toBeNull();
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
