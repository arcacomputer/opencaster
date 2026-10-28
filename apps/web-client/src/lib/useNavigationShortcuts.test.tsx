// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNavigationShortcuts } from './useNavigationShortcuts';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function Harness(props: { onSearch(): void; onHelp(): void }) { useNavigationShortcuts(props); return <><input aria-label="Composer" /><div contentEditable suppressContentEditableWarning><span>Editor</span></div><dialog /></>; }
function press(key: string, options: KeyboardEventInit = {}, target: EventTarget = document) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }); target.dispatchEvent(event); return event;
}
it('opens search/help, uses current callbacks and unregisters on unmount', async () => {
  const onSearch = vi.fn(); const onHelp = vi.fn();
  await act(async () => root.render(<Harness onSearch={onSearch} onHelp={onHelp} />));
  expect(press('k', { metaKey: true }).defaultPrevented).toBe(true); press('k', { ctrlKey: true }); press('/'); press('?');
  expect(onSearch).toHaveBeenCalledTimes(3); expect(onHelp).toHaveBeenCalledOnce();
  const next = vi.fn(); await act(async () => root.render(<Harness onSearch={next} onHelp={onHelp} />)); press('/'); expect(next).toHaveBeenCalledOnce();
  await act(async () => root.unmount()); root = createRoot(container); press('/'); expect(next).toHaveBeenCalledOnce();
});
it('never hijacks typing, modal dialogs, repeats, IME composition or unrelated modifiers', async () => {
  const onSearch = vi.fn(); const onHelp = vi.fn(); await act(async () => root.render(<Harness onSearch={onSearch} onHelp={onHelp} />));
  press('/', {}, container.querySelector('input')!); press('k', { metaKey: true }, container.querySelector('span')!);
  press('/', { isComposing: true }); press('/', { repeat: true }); press('/', { altKey: true }); press('k', { ctrlKey: true, shiftKey: true });
  const prevented = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }); prevented.preventDefault(); document.dispatchEvent(prevented);
  container.querySelector('dialog')!.open = true; press('/'); press('?');
  expect(onSearch).not.toHaveBeenCalled(); expect(onHelp).not.toHaveBeenCalled();
});
