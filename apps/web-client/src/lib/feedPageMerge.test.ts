import { describe, expect, it } from 'vitest';
import { mergeFeedPage, type FeedPageItem } from './feedPageMerge';

type Item = FeedPageItem & { value: number };
const newest = (a: Item, b: Item) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0);
const channel = (a: Item, b: Item) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || a.hash.localeCompare(b.hash);

function current(existing: readonly Item[], incoming: readonly Item[], compare?: (a: Item, b: Item) => number) {
  const merged = new Map(existing.map(item => [item.hash.replace(/^0x/i, '').toLowerCase(), item]));
  for (const item of incoming) merged.set(item.hash.replace(/^0x/i, '').toLowerCase(), item);
  const values = [...merged.values()];
  return compare ? values.sort(compare) : values;
}

describe('mergeFeedPage', () => {
  it('matches the previous Map-and-sort algorithm across randomized pages and ties', () => {
    let seed = 19;
    const random = (max: number) => { seed = (seed * 48271) % 2147483647; return seed % max; };
    const timestamp = () => new Date(Date.UTC(2026, 0, 1, 0, 0, random(5))).toISOString();
    const page = (): Item[] => Array.from({ length: random(24) }, (_, value) => ({
      hash: `${random(2) ? '0x' : ''}${random(18).toString(16).padStart(40, '0')}`,
      timestamp: timestamp(),
      value,
    }));
    for (let run = 0; run < 250; run++) {
      const previous = page();
      const incoming = page();
      for (const compare of [undefined, newest, channel]) {
        expect(mergeFeedPage(previous, incoming, compare)).toEqual(current(previous, incoming, compare));
      }
    }
  });
});
