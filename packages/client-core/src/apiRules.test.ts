import { describe, expect, it } from 'vitest';
import { API_LIMITS, CAST_HASH, CHANNEL_ID, PAGE_CURSOR, WALLET_ADDRESS, validDecimalCursor, validPageToken, validSearchQuery } from './apiRules';

describe('shared API request rules', () => {
  it('accepts the documented identifier formats only', () => {
    expect(CAST_HASH.test(`0x${'a'.repeat(40)}`)).toBe(true);
    expect(CAST_HASH.test('A'.repeat(40))).toBe(true);
    expect(CAST_HASH.test(`0x${'a'.repeat(39)}`)).toBe(false);
    expect(WALLET_ADDRESS.test(`0x${'F'.repeat(40)}`)).toBe(true);
    expect(WALLET_ADDRESS.test('f'.repeat(40))).toBe(false);
    expect(CHANNEL_ID.test('base_-1')).toBe(true);
    expect(CHANNEL_ID.test('a'.repeat(65))).toBe(false);
    expect(CHANNEL_ID.test('a.b')).toBe(false);
    expect(PAGE_CURSOR.test('ab+/=:_-')).toBe(true);
    expect(PAGE_CURSOR.test('a'.repeat(2049))).toBe(false);
  });

  it('bounds base64 page tokens and decimal cursors', () => {
    expect(validPageToken('AAAA')).toBe(true);
    expect(validPageToken('AA==')).toBe(true);
    expect(validPageToken('')).toBe(false);
    expect(validPageToken('AAA')).toBe(false);
    expect(validPageToken('A'.repeat(2052))).toBe(false);
    expect(validDecimalCursor('18446744073709551615')).toBe(true);
    expect(validDecimalCursor('18446744073709551616')).toBe(false);
    expect(validDecimalCursor('-1')).toBe(false);
  });

  it('accepts 1 to 256 bytes of search text without control characters', () => {
    expect(validSearchQuery('hello')).toBe(true);
    expect(validSearchQuery('   ')).toBe(false);
    expect(validSearchQuery('é'.repeat(128))).toBe(true);
    expect(validSearchQuery('é'.repeat(129))).toBe(false);
    expect(validSearchQuery('a\u0007b')).toBe(false);
    expect(validSearchQuery('a\u007fb')).toBe(false);
  });

  it('keeps the per-endpoint limits unchanged', () => {
    expect(API_LIMITS).toEqual({ page: 100, bulkUsers: 100, castReactions: 25, channelMembers: 25, castQuotes: 25, suggestedUsers: 20 });
  });
});
