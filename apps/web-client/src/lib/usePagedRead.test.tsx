// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePagedRead, type PagedRead, type PagedReadOptions, type PagedReadPage } from './usePagedRead';

let root: Root; let container: HTMLDivElement; let latest: PagedRead<number>;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const options: PagedReadOptions = { repeatedStatus: 'Repeated.', cappedStatus: 'Capped.', errorFallback: 'Unavailable.' };
function Harness({ read, config = options }: { read(cursor: string | undefined, signal: AbortSignal): Promise<PagedReadPage<number>>; config?: PagedReadOptions }) {
  latest = usePagedRead<number>('key', true, read, String, config); return null;
}
const render = async (read: Parameters<typeof Harness>[0]['read'], config?: PagedReadOptions) => { await act(async () => root.render(<Harness read={read} config={config} />)); };
const step = async (action: () => void) => { await act(async () => action()); };

it('keeps paginating without caps until a continuation repeats', async () => {
  const read = vi.fn().mockResolvedValueOnce({ items: [1, 2], cursor: 'a' }).mockResolvedValueOnce({ items: [2, 3], cursor: 'b' }).mockResolvedValueOnce({ items: [4], cursor: 'a' });
  await render(read); await step(() => latest.more()); await step(() => latest.more());
  expect(read.mock.calls.map(call => call[0])).toEqual([undefined, 'a', 'b']);
  expect(latest.items).toEqual([1, 2, 3, 4]); expect(latest.cursor).toBeUndefined(); expect(latest.status).toBe('Repeated.');
});
it('applies item and page caps independently', async () => {
  await render(vi.fn().mockResolvedValue({ items: [1, 2, 3], cursor: 'a' }), { ...options, maxItems: 2 });
  expect(latest.items).toEqual([1, 2]); expect(latest.cursor).toBeUndefined(); expect(latest.status).toBe('Capped.');
  let page = 0;
  await render(vi.fn().mockImplementation(async () => ({ items: [++page], cursor: `p${page}` })), { ...options, maxPages: 2 });
  await step(() => latest.refresh()); expect(latest.items).toEqual([1]); expect(latest.cursor).toBe('p1');
  await step(() => latest.more()); expect(latest.items).toEqual([1, 2]); expect(latest.cursor).toBeUndefined(); expect(latest.status).toBe('Capped.');
});
it('truncates error messages, falls back for non-errors and retries the failed page', async () => {
  const read = vi.fn().mockResolvedValueOnce({ items: [1], cursor: 'a' }).mockRejectedValueOnce(new Error('x'.repeat(300))).mockRejectedValueOnce('nope').mockResolvedValueOnce({ items: [2] });
  await render(read); await step(() => latest.more());
  expect(latest.error).toHaveLength(240); await step(() => latest.retry());
  expect(latest.error).toBe('Unavailable.'); await step(() => latest.retry());
  expect(read.mock.calls.map(call => call[0])).toEqual([undefined, 'a', 'a', 'a']); expect(latest.items).toEqual([1, 2]); expect(latest.error).toBe('');
});
