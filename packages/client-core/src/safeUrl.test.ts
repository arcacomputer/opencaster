import { describe, expect, it } from 'vitest';
import { safeHttpsUrl } from './safeUrl';

describe('safeHttpsUrl', () => {
  it('returns the normalized href of credential-free HTTPS URLs', () => {
    expect(safeHttpsUrl('https://Example.com')).toBe('https://example.com/');
    expect(safeHttpsUrl('https://example.com:8443/a b?q=1#x')).toBe('https://example.com:8443/a%20b?q=1#x');
  });

  it('preserves the exact input when requested', () => {
    expect(safeHttpsUrl('https://Example.com', { preserve: true })).toBe('https://Example.com');
  });

  it.each([undefined, null, 42, {}, '', 'not a url', '/relative', 'http://example.com', 'javascript:alert(1)', 'data:image/png;base64,AA==', 'https://user@example.com', 'https://:secret@example.com', 'https://user:secret@example.com'])('rejects %s', value => {
    expect(safeHttpsUrl(value)).toBeUndefined();
    expect(safeHttpsUrl(value, { preserve: true })).toBeUndefined();
  });

  it('applies an optional length cap to the input', () => {
    const url = `https://example.com/${'a'.repeat(30)}`;
    expect(safeHttpsUrl(url, { maxLength: url.length })).toBe(url);
    expect(safeHttpsUrl(url, { maxLength: url.length - 1 })).toBeUndefined();
  });
});
