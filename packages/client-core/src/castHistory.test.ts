import { describe, expect, it } from 'vitest';
import { castHistoryCursorKey, castHistoryMessageKey, validCastHistoryMessage } from './castHistory';

const HASH = 'ab'.repeat(20);
const cursorFor = (fid: number, timestamp: number, hash = HASH, prefix = 0x03, type = 0x01) => {
  const bytes = [prefix, ...[24, 16, 8, 0].map(shift => (fid >>> shift) & 0xff), type, ...[24, 16, 8, 0].map(shift => (timestamp >>> shift) & 0xff), ...hash.match(/../g)!.map(byte => parseInt(byte, 16))];
  return btoa(String.fromCharCode(...bytes));
};
const message = (data: Record<string, unknown> = {}, hash: unknown = `0x${HASH}`) => ({
  hash, data: { fid: 42, timestamp: 1000, network: 'FARCASTER_NETWORK_MAINNET', type: 'MESSAGE_TYPE_CAST_ADD', castAddBody: {}, ...data },
});

describe('cast history keys', () => {
  it('decodes an author cursor to the same key as its message', () => {
    const key = castHistoryCursorKey(cursorFor(42, 1000), 42);
    expect(key).toBe(`030000002a01000003e8${HASH}`);
    expect(castHistoryMessageKey(42, 1000, `0x${HASH.toUpperCase()}`)).toBe(key);
    expect(castHistoryMessageKey(42, 1000, HASH)).toBe(key);
  });

  it('rejects cursors for another author, prefix, message type or encoding', () => {
    const cursor = cursorFor(42, 1000);
    expect(castHistoryCursorKey(cursor, 43)).toBeUndefined();
    expect(castHistoryCursorKey(cursorFor(42, 1000, HASH, 0x1e), 42)).toBeUndefined();
    expect(castHistoryCursorKey(cursorFor(42, 1000, HASH, 0x03, 0x02), 42)).toBeUndefined();
    expect(castHistoryCursorKey(cursor.slice(0, 36), 42)).toBeUndefined();
    expect(castHistoryCursorKey(`${cursor}AAAA`, 42)).toBeUndefined();
    expect(castHistoryCursorKey(cursor.replace(/.$/, '-'), 42)).toBeUndefined();
    expect(castHistoryCursorKey(btoa('x'.repeat(29)), 42)).toBeUndefined();
    expect(castHistoryCursorKey('', 42)).toBeUndefined();
    expect(castHistoryCursorKey(undefined, 42)).toBeUndefined();
  });

  it('refuses to key an invalid hash', () => {
    expect(() => castHistoryMessageKey(42, 1000, 'not-a-hash')).toThrow('Invalid cast hash.');
  });
});

describe('validCastHistoryMessage', () => {
  it('accepts mainnet cast adds and removes by the author', () => {
    expect(validCastHistoryMessage(message(), 42)).toBe(true);
    expect(validCastHistoryMessage(message({ type: 'MESSAGE_TYPE_CAST_REMOVE', castAddBody: undefined, castRemoveBody: {} }, HASH), 42)).toBe(true);
  });

  it.each([
    ['another author', message({ fid: 43 })],
    ['a negative timestamp', message({ timestamp: -1 })],
    ['an out-of-range timestamp', message({ timestamp: 0x100000000 })],
    ['a fractional timestamp', message({ timestamp: 1.5 })],
    ['another network', message({ network: 'FARCASTER_NETWORK_TESTNET' })],
    ['another message type', message({ type: 'MESSAGE_TYPE_REACTION_ADD' })],
    ['a non-string type', message({ type: ['MESSAGE_TYPE_CAST_ADD'] })],
    ['a missing add body', message({ castAddBody: undefined })],
    ['a missing remove body', message({ type: 'MESSAGE_TYPE_CAST_REMOVE', castAddBody: undefined })],
    ['a short hash', message({}, '0xabcd')],
    ['a missing hash', message({}, null)],
    ['missing data', { hash: HASH }],
    ['an array', []],
  ])('rejects %s', (_label, value) => {
    expect(validCastHistoryMessage(value, 42)).toBe(false);
  });
});
