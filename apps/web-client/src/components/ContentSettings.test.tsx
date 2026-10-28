// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentSettings } from './ContentSettings';
import { emptyContentPreferences, type ContentPreferences } from '../lib/contentPreferences';

let container: HTMLDivElement; let root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = async (element: Parameters<Root['render']>[0]) => { await act(async () => root.render(element)); };
const button = (text: string) => [...container.querySelectorAll('button')].find(value => value.textContent?.trim() === text)!;
const click = async (element: Element) => { await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))); };
async function input(value: string) {
  const field = container.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
function Harness({ initial = emptyContentPreferences() }: { initial?: ContentPreferences }) {
  const [preferences, setPreferences] = useState(initial);
  return <ContentSettings preferences={preferences} onChange={setPreferences} />;
}

describe('local content settings', () => {
  it('states the browser boundary, permits guests and emits only controlled preference changes', async () => {
    const changed = vi.fn(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await render(<ContentSettings preferences={emptyContentPreferences()} onChange={changed} />);
    expect(container.textContent).toContain('ON THIS BROWSER'); expect(container.textContent).toContain('Guest preferences');
    expect(container.textContent).toContain('do not block accounts on the network');
    await input(' cafe\u0301 '); await submit();
    expect(changed).toHaveBeenCalledWith({ ...emptyContentPreferences(), mutedWords: ['café'] });
    expect(container.querySelector('[role="status"]')?.textContent).toContain('added');
    expect(fetch).not.toHaveBeenCalled(); expect(container.querySelector('input')?.value).toBe('');
  });
  it('announces required, Unicode byte-limit and duplicate errors without changing preferences', async () => {
    const changed = vi.fn(); await render(<ContentSettings preferences={{ ...emptyContentPreferences(), mutedWords: ['Café'] }} onChange={changed} fid={3} />);
    await submit(); expect(container.querySelector('[role="alert"]')?.textContent).toContain('Enter a word');
    await input('😀'.repeat(65)); expect(container.querySelector('[role="alert"]')?.textContent).toContain('256 UTF-8');
    expect(container.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
    await submit(); expect(changed).not.toHaveBeenCalled();
    await input('cafe\u0301'); await submit(); expect(container.querySelector('[role="alert"]')?.textContent).toContain('already muted');
    expect(container.textContent).toContain('FID 3'); expect(changed).not.toHaveBeenCalled();
  });
  it('removes phrases and accounts and clears only hidden casts', async () => {
    const initial = { ...emptyContentPreferences(), mutedWords: ['Café', 'literal.*'], mutedAccounts: [{ fid: 3, username: 'alice', display_name: 'Alice' }], hiddenCasts: ['a'.repeat(40)] };
    await render(<Harness initial={initial} />);
    await click(container.querySelector('button[aria-label="Remove muted phrase Café"]')!);
    expect(container.querySelector('.content-settings__words')?.textContent).toContain('literal.*'); expect(container.querySelector('.content-settings__words')?.textContent).not.toContain('Café');
    await click(button('Unmute')); expect(container.textContent).toContain('No accounts muted.');
    await click(button('Clear hidden casts')); expect(button('Clear hidden casts').disabled).toBe(true);
    expect(container.querySelector('.content-settings__words')?.textContent).toContain('literal.*'); expect(container.querySelector('[role="status"]')?.textContent).toContain('cleared');
    expect(container.querySelector('button[aria-label="Remove muted phrase literal.*"]')?.getAttribute('type')).toBe('button');
  });
  it('clears transient input and validation when switching account contexts', async () => {
    const changed = vi.fn(); const prefs = emptyContentPreferences();
    await render(<ContentSettings preferences={prefs} onChange={changed} fid={3} />);
    await input('unfinished');
    await render(<ContentSettings preferences={prefs} onChange={changed} fid={4} />);
    expect(container.querySelector('input')?.value).toBe(''); expect(container.textContent).toContain('FID 4');
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(changed).not.toHaveBeenCalled();
  });
});
