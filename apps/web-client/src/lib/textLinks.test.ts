import { describe, expect, it } from 'vitest';
import { textLinks } from './textLinks';

describe('literal public text links', () => {
  it('keeps sentence punctuation outside links, preserves balanced URL parentheses and never changes the text', () => {
    const text = 'Read (https://example.com/Guide_(one)), then http://example.org. café 🌍';
    const result = textLinks(text);
    expect(result.filter(part => part.href).map(part => part.href)).toEqual(['https://example.com/Guide_(one)', 'http://example.org/']);
    expect(result.map(part => part.text).join('')).toBe(text);
    expect(textLinks('“https://example.com/a”').filter(part => part.href)).toEqual([{ text: 'https://example.com/a', href: 'https://example.com/a' }]);
    expect(textLinks('([https://example.com/a]).').filter(part => part.href)).toEqual([{ text: 'https://example.com/a', href: 'https://example.com/a' }]);
    expect(textLinks(`https://example.com/${')'.repeat(10_000)}`).filter(part => part.href)).toEqual([{ text: 'https://example.com/', href: 'https://example.com/' }]);
  });
  it('leaves credentials, unsupported schemes, invalid hosts and embedded word tokens as plain text', () => {
    for (const text of ['https://alice:secret@example.com', 'https://alice@example.com', 'javascript:alert(1)', 'data:text/html,test', 'https://', 'abchttps://example.com']) {
      expect(textLinks(text)).toEqual([{ text }]);
    }
  });
  it('preserves adjacent links, query parameters, Unicode paths and HTML-looking text as literal segments', () => {
    const text = '<https://example.com/你好?q=a&b=2> https://other.example/x#part!';
    const result = textLinks(text);
    expect(result.map(part => part.text).join('')).toBe(text);
    expect(result.filter(part => part.href).map(part => part.href)).toEqual(['https://example.com/%E4%BD%A0%E5%A5%BD?q=a&b=2', 'https://other.example/x#part']);
    expect(textLinks('')).toEqual([{ text: '' }]);
  });
});
