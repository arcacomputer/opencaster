import { describe, expect, it } from 'vitest';
import { CHANNEL_PIN_LIMIT, CHANNEL_PINS_STORAGE_KEY, readChannelPins, toggleChannelPin, writeChannelPins } from './channelPins';
import type { Channel } from '@opencaster/client-core/api';

const channel = (id: string): Channel => ({ id, name: `Channel ${id}`, url: `https://example.com/${id}`, parent_url: `https://example.com/${id}?a=1`, description: 'Public channel', member_count: 2 });
function store() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe('device-only saved channel shortcuts', () => {
  it('round-trips bounded public snapshots and preserves exact parent identifiers', () => {
    const storage = store();
    const item = { ...channel('quorum'), parent_url: 'https://example.com:443/quorum?x=%2f&x=2', privateData: 'not stored' };
    expect(writeChannelPins([item], storage)).toBe(true);
    expect(readChannelPins(storage)).toEqual([channel('quorum')].map(value => ({ ...value, parent_url: item.parent_url })));
    expect(storage.getItem(CHANNEL_PINS_STORAGE_KEY)).not.toContain('privateData');
    expect(storage.getItem(CHANNEL_PINS_STORAGE_KEY)).not.toContain('not stored');
  });

  it('adds a shortcut once and removes it by ID without mutating its input', () => {
    const original = [channel('one')];
    const added = toggleChannelPin(original, channel('two'));
    expect(added.map(item => item.id)).toEqual(['two', 'one']);
    expect(original).toEqual([channel('one')]);
    expect(toggleChannelPin(added, { ...channel('two'), name: 'A different name' })).toEqual(original);
  });

  it('rejects a new shortcut at the limit while allowing removal', () => {
    const values = Array.from({ length: CHANNEL_PIN_LIMIT }, (_, index) => channel(`item${index}`));
    expect(() => toggleChannelPin(values, channel('extra'))).toThrow('Remove a saved channel');
    expect(toggleChannelPin(values, values[0])).toHaveLength(CHANNEL_PIN_LIMIT - 1);
  });

  it('does not trust malformed versions, identifiers, duplicate records or image URLs from storage', () => {
    const storage = store();
    for (const raw of ['{', '{}', JSON.stringify({ version: 2, channels: [channel('one')] }), 'x'.repeat(256 * 1024 + 1)]) {
      storage.setItem(CHANNEL_PINS_STORAGE_KEY, raw);
      expect(readChannelPins(storage)).toEqual([]);
    }
    storage.setItem(CHANNEL_PINS_STORAGE_KEY, JSON.stringify({ version: 1, channels: [null, { id: '../bad' }, channel('one'), channel('one'), { id: 'two', image_url: 'javascript:alert(1)', url: 'https://user:password@example.com/' }] }));
    expect(readChannelPins(storage)).toEqual([channel('one'), { id: 'two', name: 'two', url: '' }]);
  });

  it('keeps browser storage failures nonfatal and bounds stored metadata', () => {
    const unavailable = { getItem: () => { throw new Error('Unavailable'); }, setItem: () => { throw new Error('Full'); } };
    expect(readChannelPins(unavailable)).toEqual([]);
    expect(writeChannelPins([channel('one')], unavailable)).toBe(false);
    const storage = store();
    expect(writeChannelPins([{ ...channel('one'), name: 'n'.repeat(300), description: 'd'.repeat(2_000) }], storage)).toBe(true);
    const [saved] = readChannelPins(storage);
    expect(saved.name).toHaveLength(128);
    expect(saved.description).toHaveLength(512);
  });
});
