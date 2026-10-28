// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BookmarkTools, { type BookmarkToolsProps } from './BookmarkTools';

let container: HTMLDivElement; let root: Root; let props: BookmarkToolsProps;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); props = { query: '', sort: 'newest', count: 3, total: 3, onQueryChange: vi.fn(), onSortChange: vi.fn(), onClear: vi.fn() }; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(overrides: Partial<BookmarkToolsProps> = {}) { await act(async () => root.render(<BookmarkTools {...props} {...overrides} />)); }
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!;
async function click(item: HTMLElement) { await act(async () => item.click()); }

describe('controlled local bookmark tools', () => {
  it('discloses browser-only snapshots and changes query/order only from explicit controls', async () => {
    await render(); expect(container.textContent).toContain('not synced to your account'); expect(props.onQueryChange).not.toHaveBeenCalled(); expect(props.onSortChange).not.toHaveBeenCalled();
    const input = container.querySelector('input')!; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(input, '東京'); input.dispatchEvent(new Event('input', { bubbles: true })); }); expect(props.onQueryChange).toHaveBeenCalledWith('東京');
    await click(button('Oldest saved')); expect(props.onSortChange).toHaveBeenCalledWith('oldest');
    await render({ query: '東京', sort: 'oldest', count: 1 }); expect(container.querySelector('[role="status"]')?.textContent).toBe('1 of 3 saved'); expect(button('Oldest saved').getAttribute('aria-pressed')).toBe('true');
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Clear bookmark search"]')!); expect(props.onQueryChange).toHaveBeenLastCalledWith(''); expect(props.onClear).not.toHaveBeenCalled();
  });
  it('requires a separate explicit confirmation to clear all snapshots and supports cancelling', async () => {
    await render(); await click(button('Clear bookmarks')); expect(props.onClear).not.toHaveBeenCalled(); expect(container.textContent).toContain('Your casts, reactions and uploaded images stay unchanged.');
    await click(button('Keep bookmarks')); expect(container.querySelector('[aria-label="Confirm clearing bookmarks"]')).toBeNull();
    await click(button('Clear bookmarks')); await click(button('Clear all 3 bookmarks')); expect(props.onClear).toHaveBeenCalledOnce(); expect(container.querySelector('[aria-label="Confirm clearing bookmarks"]')).toBeNull();
  });
  it('invalidates a pending confirmation when the collection or search changes', async () => {
    await render(); await click(button('Clear bookmarks')); await render({ total: 4, count: 4 }); expect(container.querySelector('[aria-label="Confirm clearing bookmarks"]')).toBeNull();
    await render(); expect(container.querySelector('[aria-label="Confirm clearing bookmarks"]')).toBeNull();
    await click(button('Clear bookmarks')); await click(button('Oldest saved')); expect(container.querySelector('[aria-label="Confirm clearing bookmarks"]')).toBeNull(); expect(props.onClear).not.toHaveBeenCalled();
  });
  it('keeps an empty local collection clear action disabled', async () => {
    await render({ total: 0, count: 0 }); expect(button('Clear bookmarks').disabled).toBe(true); expect(container.querySelector('[role="status"]')?.textContent).toBe('0 saved casts'); expect(props.onClear).not.toHaveBeenCalled();
  });
});
