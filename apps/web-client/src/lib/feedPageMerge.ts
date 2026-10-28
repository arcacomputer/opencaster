export interface FeedPageItem {
  hash: string;
  timestamp: string;
}

export function mergeFeedPage<T extends FeedPageItem>(existing: readonly T[], incoming: readonly T[], compare?: (a: T, b: T) => number): T[] {
  const values = new Map(existing.map(item => [item.hash.replace(/^0x/i, '').toLowerCase(), item]));
  const additions = new Map<string, T>();
  for (const item of incoming) {
    const key = item.hash.replace(/^0x/i, '').toLowerCase();
    if (values.has(key)) values.set(key, item);
    else additions.set(key, item);
  }
  const oldItems = [...values.values()];
  const newItems = [...additions.values()];
  if (!compare) return [...oldItems, ...newItems];

  const sorted = (items: readonly T[]) => items.every((item, index) => index === 0 || compare(items[index - 1], item) <= 0);
  if (!sorted(oldItems)) return [...oldItems, ...newItems].sort(compare);

  newItems.sort(compare);
  const merged: T[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldItems.length && newIndex < newItems.length) {
    if (compare(oldItems[oldIndex], newItems[newIndex]) <= 0) merged.push(oldItems[oldIndex++]);
    else merged.push(newItems[newIndex++]);
  }
  return [...merged, ...oldItems.slice(oldIndex), ...newItems.slice(newIndex)];
}
