// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUser, type User } from '../lib/api';
import { decodeFeed, type FeedDefinition, type SavedFeed } from '../lib/customFeeds';
import { FeedHeader, FeedsView, PublicFollowingPicker, type FeedsViewProps } from './Feeds';

vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), getUser: vi.fn() }));
const definition: FeedDefinition = { version: 1, name: 'Builders', sources: [{ kind: 'trending', timeWindow: '24h' }], order: 'source', filters: { includeWords: [], excludeWords: [], hideReplies: false, imagesOnly: false } };
const saved: SavedFeed = { id: 'test-feed', definition, pinned: true };
const user: User = { fid: 42, username: 'alice', custody_address: '', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 };
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.resetAllMocks();
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  vi.mocked(getUser).mockResolvedValue(user);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(element: Parameters<Root['render']>[0]) { await act(async () => root.render(element)); }
function button(label: string) { return [...(container.querySelector('dialog') ?? container).querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.trim() === label || element.getAttribute('aria-label') === label)!; }
async function click(label: string) { await act(async () => button(label).click()); }
function field(label: string) { const item = [...(container.querySelector('dialog') ?? container).querySelectorAll<HTMLLabelElement>('label')].find(element => element.childNodes[0]?.textContent?.trim() === label)!; return document.getElementById(item.htmlFor) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement; }
async function fill(label: string, value: string) {
  const input = field(label); const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
function view(overrides: Partial<FeedsViewProps> = {}) { return { feeds: [] as SavedFeed[], onOpen: vi.fn(), onSave: vi.fn(), onTogglePin: vi.fn(), onDelete: vi.fn(), ...overrides }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(value => { resolve = value; }); return { promise, resolve }; }

describe('public customizable feed controls', () => {
  it('allows guests to browse starter feeds without resolving an account or requesting a wallet', async () => {
    const props = view(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await render(<FeedsView {...props} />);
    expect(container.textContent).toContain('No wallet needed'); expect(container.textContent).toContain('do not sync across devices');
    await click('Browse trending'); expect(props.onOpen).toHaveBeenCalledWith({ ...definition, name: 'Trending · 24h' });
    expect(getUser).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(props.onSave).not.toHaveBeenCalled();
  });
  it('creates a feed with explicit account resolution, mixed sources, phrase filters and loaded ordering', async () => {
    const props = view(); await render(<FeedsView {...props} />); await click('Create feed');
    await fill('Feed name', 'My reading'); await click('Add source');
    await fill('Source type', 'user'); await fill('Account username or FID', '@alice'); expect(getUser).not.toHaveBeenCalled();
    await click('Add source'); expect(getUser).toHaveBeenCalledWith({ username: 'alice' }, expect.any(AbortSignal));
    expect(container.textContent).toContain('@alice · Casts · FID 42 added.');
    await fill('Source type', 'channel'); await fill('Channel ID', '/art'); await click('Add source');
    await fill('Include any of these phrases', 'open source\nart'); await fill('Exclude any of these phrases', 'spoilers\ngiveaways');
    await fill('Order', 'newest');
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click('Save feed');
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith({ version: 1, name: 'My reading', sources: [{ kind: 'trending', timeWindow: '24h' }, { kind: 'user', fid: 42 }, { kind: 'channel', channel: 'art' }], order: 'newest', filters: { includeWords: ['open source', 'art'], excludeWords: ['spoilers', 'giveaways'], hideReplies: true, imagesOnly: false } }, undefined);
    expect(container.querySelector('dialog')).toBeNull();
  });
  it('rejects duplicate or invalid sources and retains the editor after a failed save', async () => {
    const props = view(); await render(<FeedsView {...props} />); await click('Create feed'); await click('Add source'); await click('Add source');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('already in your feed');
    await fill('Source type', 'channel'); await fill('Channel ID', 'https://external.example/channel'); await click('Add source');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Enter a channel ID');
    await fill('Feed name', 'Invalid filters'); await fill('Include any of these phrases', Array.from({ length: 11 }, (_, i) => `phrase${i}`).join('\n')); await click('Save feed');
    expect(props.onSave).not.toHaveBeenCalled(); expect(container.querySelector('dialog')).not.toBeNull(); expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
  it('edits the existing feed, preserves source ordering changes and requires confirmation before deletion', async () => {
    const props = view({ feeds: [{ ...saved, definition: { ...definition, sources: [...definition.sources, { kind: 'channel', channel: 'art' }] } }] });
    await render(<FeedsView {...props} />); await click('Unpin Builders'); expect(props.onTogglePin).toHaveBeenCalledExactlyOnceWith(saved.id);
    await click('Delete Builders'); expect(props.onDelete).not.toHaveBeenCalled(); await click('Keep feed'); expect(props.onDelete).not.toHaveBeenCalled();
    await click('Customize Builders'); await click('Move Channel /art up'); await fill('Feed name', 'Art first'); await click('Save changes');
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Art first', sources: [{ kind: 'channel', channel: 'art' }, { kind: 'trending', timeWindow: '24h' }] }), saved.id);
    await click('Delete Builders'); await click('Delete feed'); expect(props.onDelete).toHaveBeenCalledExactlyOnceWith(saved.id);
  });
  it('aborts public following lookups on input change and discards late responses', async () => {
    const pending = deferred<User>(); vi.mocked(getUser).mockReturnValueOnce(pending.promise); const open = vi.fn();
    await render(<PublicFollowingPicker fid={7} onOpen={open} />); expect(container.textContent).toContain('FID 7');
    await fill('Account username or FID', 'alice');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    const signal = vi.mocked(getUser).mock.calls[0][1]!; expect(signal.aborted).toBe(false);
    await fill('Account username or FID', 'bob'); expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(user)); expect(open).not.toHaveBeenCalled();
    vi.mocked(getUser).mockResolvedValue({ ...user, fid: 43, username: 'bob' });
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(open).toHaveBeenCalledExactlyOnceWith(43);
  });
  it('cancels pending source lookup when the editor closes and rejects a mismatched FID', async () => {
    const pending = deferred<User>(); vi.mocked(getUser).mockReturnValueOnce(pending.promise); const props = view();
    await render(<FeedsView {...props} />); await click('Create feed'); await fill('Source type', 'following'); await fill('Account username or FID', '42'); await click('Add source');
    const signal = vi.mocked(getUser).mock.calls[0][1]!;
    await click('Close dialog'); expect(signal.aborted).toBe(true); await act(async () => pending.resolve(user));
    expect(container.querySelector('dialog')).toBeNull(); expect(props.onSave).not.toHaveBeenCalled();
    const open = vi.fn(); vi.mocked(getUser).mockResolvedValue({ ...user, fid: 43 });
    await render(<PublicFollowingPicker onOpen={open} />); await fill('Account username or FID', '42');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(open).not.toHaveBeenCalled(); expect(container.querySelector('[role="alert"]')?.textContent).toContain('different or invalid FID');
  });
  it.each(['saved', 'shared'] as const)('preserves literal commas when customizing a %s feed', async kind => {
    const original: FeedDefinition = { ...definition, filters: { ...definition.filters, includeWords: ['hello, world', 'art'], excludeWords: ['no, thanks'] } };
    const props = view({ feeds: [{ ...saved, definition: original }] });
    if (kind === 'saved') {
      await render(<FeedsView {...props} />); await click('Customize Builders');
    } else {
      await render(<FeedHeader definition={original} onSave={props.onSave} onTogglePin={vi.fn()} onNavigate={vi.fn()} notify={vi.fn()} />); await click('Customize');
    }
    expect(field('Include any of these phrases').value).toBe('hello, world\nart');
    expect(field('Exclude any of these phrases').value).toBe('no, thanks');
    expect(container.textContent).toContain('Commas stay part of a phrase.');
    await fill('Feed name', 'Renamed reading'); await click(kind === 'saved' ? 'Save changes' : 'Save feed');
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith({ ...original, name: 'Renamed reading' }, kind === 'saved' ? saved.id : undefined);
  });
  it('shares the public rules, saves shared feeds explicitly and offers manual copying if clipboard is unavailable', async () => {
    const save = vi.fn(); const notify = vi.fn(); const copy = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await render(<FeedHeader definition={definition} onSave={save} onTogglePin={vi.fn()} onNavigate={vi.fn()} notify={notify} />);
    expect(save).not.toHaveBeenCalled(); expect(container.textContent).toContain('includes the feed name, public sources and filters');
    await click('Save feed'); expect(save).toHaveBeenCalledExactlyOnceWith(definition);
    await click('Copy feed link'); expect(copy).toHaveBeenCalledOnce();
    const link = container.querySelector('input')!.value; const url = new URL(link);
    expect(url.origin).toBe('https://opencaster.org'); expect(url.pathname).toBe('/feeds/view'); expect(decodeFeed(url.searchParams.get('feed')!)).toEqual(definition);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Copy command');
  });
});
