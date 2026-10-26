// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { getCast, getChannels, getFeed, getInfo, getUser, type Cast, type User } from './lib/api';
import { contentPreferencesKey, emptyContentPreferences } from './lib/contentPreferences';
import { readSavedFeeds, SAVED_FEED_STORAGE_KEY, writeSavedFeeds, type FeedDefinition } from './lib/customFeeds';
import { feedPath } from './lib/navigation';

const wallet = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('./components/ConnectAccount', () => ({
  default: () => { wallet.render(); return <div data-testid="wallet">Wallet flow</div>; },
  DeviceSettings: () => <div>Device settings</div>,
}));
vi.mock('./lib/api', async original => ({ ...await original<typeof import('./lib/api')>(), getCast: vi.fn(), getChannels: vi.fn(), getFeed: vi.fn(), getInfo: vi.fn(), getUser: vi.fn() }));

const person = (fid: number): User => ({ fid, username: `person${fid}`, display_name: `Person ${fid}`, custody_address: '0x1111111111111111111111111111111111111111', profile: { bio: { text: 'An isolated public account' } }, follower_count: 0, following_count: 0 });
const cast = (letter: string, fid: number, text: string, day = 20): Cast => ({ hash: `0x${letter.repeat(40)}`, author: person(fid), text, timestamp: `2026-10-${day}T12:00:00.000Z`, embeds: [], reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 } });
const recipe = (name = 'Builders', fid = 42): FeedDefinition => ({ version: 1, name, sources: [{ kind: 'user', fid }], order: 'newest', filters: { includeWords: [], excludeWords: [], hideReplies: false, imagesOnly: false } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let container: HTMLDivElement;
let root: Root;
let observers: { callback: IntersectionObserverCallback; observer: IntersectionObserver; target?: Element; disconnected: boolean }[];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  localStorage.clear(); sessionStorage.clear(); localStorage.setItem('opencaster.explore', '1'); history.replaceState(null, '', '/');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Integration tests must not contact the network.')));
  observers = [];
  vi.stubGlobal('IntersectionObserver', class {
    entry: typeof observers[number];
    constructor(callback: IntersectionObserverCallback) { this.entry = { callback, observer: this as unknown as IntersectionObserver, disconnected: false }; observers.push(this.entry); }
    observe(target: Element) { this.entry.target = target; }
    disconnect() { this.entry.disconnected = true; }
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  vi.mocked(getFeed).mockResolvedValue({ casts: [], next: {} });
  vi.mocked(getChannels).mockResolvedValue({ channels: [], next: {} });
  vi.mocked(getInfo).mockResolvedValue({ version: 'isolated-feeds-test' });
  vi.mocked(getUser).mockImplementation(async lookup => person(lookup.fid ?? 42));
  vi.mocked(getCast).mockResolvedValue(cast('f', 99, 'An isolated parent cast'));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks();
  localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals();
});
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function start(path: string) { history.replaceState(null, '', path); await act(async () => root.render(<App />)); await settle(); }
async function click(element: Element | undefined | null) { expect(element).toBeDefined(); expect(element).not.toBeNull(); await act(async () => { element!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }); await settle(); }
function button(text: string, scope: ParentNode = container) { return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text); }
function labelField(text: string, scope: ParentNode = container): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const label = [...scope.querySelectorAll<HTMLLabelElement>('label')].find(item => item.textContent?.trim().startsWith(text));
  expect(label, `field ${text}`).toBeDefined();
  return (label!.querySelector('input, textarea, select') ?? document.getElementById(label!.htmlFor)) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
}
async function fill(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
async function submit(form: HTMLFormElement) { await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await settle(); }
async function reachEnd() {
  const entry = observers.filter(item => item.target && !item.disconnected).at(-1); expect(entry).toBeDefined();
  await act(async () => { entry!.callback([{ target: entry!.target!, isIntersecting: true } as IntersectionObserverEntry], entry!.observer); }); await settle();
}
async function traverse(direction: 'back' | 'forward') { await act(async () => { history[direction](); await new Promise(resolve => setTimeout(resolve, 10)); }); await settle(); }
async function remount(path: string) { await act(async () => root.unmount()); root = createRoot(container); await start(path); }
const texts = () => [...container.querySelectorAll('main .feed > .cast .cast__text')].map(item => item.textContent);
const feedLink = (name: string) => [...container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Home feeds"] a')].find(item => item.textContent?.trim() === name);
function noWallet() { expect(wallet.render).not.toHaveBeenCalled(); expect(container.querySelector('[data-testid="wallet"]')).toBeNull(); expect(location.pathname).not.toBe('/connect'); }

describe('guest public following timelines', () => {
  it('loads and paginates a public FID directly without a wallet or remembered exploration', async () => {
    localStorage.removeItem('opencaster.explore');
    const first = cast('a', 20, 'Public first page'); const second = cast('b', 30, 'Public second page');
    vi.mocked(getFeed).mockImplementation(async options => ({ casts: [options.cursor ? second : first], next: options.cursor ? {} : { cursor: 'public-next' } }));
    await start('/following?fid=42');
    expect(texts()).toEqual([first.text]); expect(container.querySelector('.public-following-picker')?.textContent).toContain('FID 42');
    expect(getFeed).toHaveBeenCalledWith(expect.objectContaining({ kind: 'following', fid: 42, limit: 25, signal: expect.any(AbortSignal) }));
    await reachEnd(); expect(texts()).toEqual([first.text, second.text]);
    expect(vi.mocked(getFeed).mock.calls.map(([options]) => [options.kind, options.fid, options.cursor])).toEqual([['following', 42, undefined], ['following', 42, 'public-next']]);
    expect(container.querySelector('.feed-pagination')).toBeNull(); noWallet();
  });

  it('waits for an explicit public account lookup before requesting the guest following feed', async () => {
    await start('/following');
    expect(getFeed).not.toHaveBeenCalled(); expect(container.querySelector('main')?.textContent).toContain('Choose an account above');
    const picker = container.querySelector<HTMLElement>('.public-following-picker')!;
    await fill(labelField('Account username or FID', picker), 'public-builder');
    await submit(picker.querySelector('form')!);
    expect(getUser).toHaveBeenCalledWith({ username: 'public-builder' }, expect.any(AbortSignal));
    expect(location.pathname + location.search).toBe('/following?fid=42');
    expect(getFeed).toHaveBeenCalledWith(expect.objectContaining({ kind: 'following', fid: 42 })); noWallet();
  });
});

describe('shared custom timeline reading', () => {
  it('blends sources, applies recipe and guest content filters, deduplicates and continues only active sources', async () => {
    const older = cast('a', 20, 'Build a public project', 20); const newer = cast('b', 30, 'Build some art', 22); const newest = cast('c', 40, 'Build the next public project', 24);
    const muted = cast('d', 99, 'Build a muted account project', 23); const phraseMuted = cast('e', 50, 'Build a spoiler project', 23);
    const excluded = cast('f', 60, 'Build a giveaway', 23); const noMatch = cast('1', 60, 'An unrelated conversation', 23);
    const reply: Cast = { ...cast('2', 70, 'Build a reply', 23), parent_hash: `0x${'3'.repeat(40)}`, parent_author: { fid: 20 } };
    const definition: FeedDefinition = { ...recipe(), sources: [{ kind: 'trending', timeWindow: '24h' }, { kind: 'user', fid: 20 }, { kind: 'channel', channel: 'art' }], filters: { includeWords: ['build'], excludeWords: ['giveaway'], hideReplies: true, imagesOnly: false } };
    localStorage.setItem(contentPreferencesKey(), JSON.stringify({ ...emptyContentPreferences(), mutedAccounts: [{ fid: 99 }], mutedWords: ['spoiler'] }));
    vi.mocked(getFeed).mockImplementation(async options => options.kind === 'trending'
      ? options.cursor ? { casts: [newest, older], next: {} } : { casts: [older, excluded, noMatch, reply], next: { cursor: 'trending-next' } }
      : options.kind === 'user' ? { casts: [{ ...older, hash: older.hash.toUpperCase() }, phraseMuted], next: {} } : { casts: [muted, newer], next: {} });
    await start(feedPath(definition));
    expect(texts()).toEqual([newer.text, older.text]); expect(getFeed).toHaveBeenCalledTimes(3);
    expect(container.querySelector('.custom-feed-header')?.textContent).toContain('Newest loaded first');
    expect(container.querySelector('main')?.textContent).toContain('2 loaded casts are filtered on this browser');
    await reachEnd(); expect(getFeed).toHaveBeenCalledTimes(4);
    expect(vi.mocked(getFeed).mock.calls[3][0]).toEqual(expect.objectContaining({ kind: 'trending', timeWindow: '24h', cursor: 'trending-next' }));
    expect(texts()).toEqual([newest.text, newer.text, older.text]); expect(container.querySelector('.feed-pagination')).toBeNull(); noWallet();
  });

  it('aborts an obsolete custom read and restores feed identities across Back and Forward', async () => {
    const old = recipe('First feed', 10); const current = recipe('Second feed', 20);
    const pending = deferred<{ casts: Cast[]; next: {} }>(); const stale = cast('a', 10, 'Obsolete result'); const restored = cast('b', 10, 'Restored first timeline'); const fresh = cast('c', 20, 'Current second timeline');
    expect(writeSavedFeeds([{ id: 'first', definition: old, pinned: true }, { id: 'second', definition: current, pinned: true }])).toBe(true);
    let firstReads = 0;
    vi.mocked(getFeed).mockImplementation(options => options.fid === 10 && firstReads++ === 0 ? pending.promise : Promise.resolve({ casts: [options.fid === 10 ? restored : fresh], next: {} }));
    await start(feedPath(old)); const obsoleteSignal = vi.mocked(getFeed).mock.calls[0][0].signal!;
    await click(feedLink('Second feed')); expect(obsoleteSignal.aborted).toBe(true); expect(texts()).toEqual([fresh.text]);
    await act(async () => pending.resolve({ casts: [stale], next: {} })); expect(texts()).toEqual([fresh.text]);
    await traverse('back'); expect(location.pathname + location.search).toBe(feedPath(old)); expect(texts()).toEqual([restored.text]);
    await traverse('forward'); expect(location.pathname + location.search).toBe(feedPath(current)); expect(texts()).toEqual([fresh.text]); noWallet();
  });
});

describe('browser-local feed management', () => {
  it('creates, customizes and pins a feed, exposes mobile navigation and restores it after remounting', async () => {
    await start('/feeds'); expect(getFeed).not.toHaveBeenCalled();
    expect(container.querySelector('nav[aria-label="Mobile navigation"] button[aria-label="Feeds"]')?.getAttribute('aria-current')).toBe('page');
    await click(button('Create feed'));
    let editor = container.querySelector<HTMLDialogElement>('dialog[open]')!;
    await fill(labelField('Feed name', editor), 'Builders'); await click(button('Add source', editor));
    await fill(labelField('Source type', editor), 'channel'); await fill(labelField('Channel ID', editor), 'art'); await click(button('Add source', editor));
    await fill(labelField('Order', editor), 'newest'); await fill(labelField('Include any', editor), 'build\nart'); await fill(labelField('Exclude any', editor), 'giveaway');
    await click(labelField('Hide replies', editor)); await submit(editor.querySelector('form')!);
    expect(readSavedFeeds()).toHaveLength(1); expect(readSavedFeeds()[0].definition).toEqual({ version: 1, name: 'Builders', sources: [{ kind: 'trending', timeWindow: '24h' }, { kind: 'channel', channel: 'art' }], order: 'newest', filters: { includeWords: ['build', 'art'], excludeWords: ['giveaway'], hideReplies: true, imagesOnly: false } });
    await click(container.querySelector('button[aria-label="Pin Builders"]'));
    expect(feedLink('Builders')).toBeDefined(); expect(container.querySelector('nav[aria-label="Pinned feeds"]')?.textContent).toContain('Builders');
    await click(container.querySelector('button[aria-label="Customize Builders"]')); editor = container.querySelector('dialog[open]')!;
    await fill(labelField('Feed name', editor), 'Builder lab'); await fill(labelField('Include any', editor), 'open source'); await submit(editor.querySelector('form')!);
    const saved = readSavedFeeds()[0]; expect(saved.pinned).toBe(true); expect(saved.definition.name).toBe('Builder lab'); expect(saved.definition.filters.includeWords).toEqual(['open source']);
    expect(feedLink('Builders')).toBeUndefined(); expect(feedLink('Builder lab')?.getAttribute('href')).toBe(feedPath(saved.definition));
    await click(container.querySelector('nav[aria-label="Mobile navigation"] button[aria-label="Discover"]'));
    expect(location.pathname).toBe('/'); expect(feedLink('Builder lab')).toBeDefined();
    await click(container.querySelector('nav[aria-label="Mobile navigation"] button[aria-label="Feeds"]'));
    await remount('/feeds'); expect(readSavedFeeds()).toEqual([saved]); expect(container.querySelector('.feed-card')?.textContent).toContain('Builder lab'); expect(feedLink('Builder lab')).toBeDefined(); noWallet();
  });

  it('saves and pins a shared timeline, and removes it only after manager confirmation', async () => {
    const definition = recipe('Shared builders'); await start(feedPath(definition));
    const header = () => container.querySelector<HTMLElement>('.custom-feed-header')!;
    expect(header().textContent).toContain('PUBLIC FEED'); await click(button('Save feed', header()));
    expect(readSavedFeeds()).toHaveLength(1); await click(button('Pin feed', header())); expect(readSavedFeeds()[0].pinned).toBe(true); expect(feedLink(definition.name)).toBeDefined();
    await click(button('All feeds', header()));
    await click(container.querySelector('button[aria-label="Delete Shared builders"]')); expect(readSavedFeeds()).toHaveLength(1);
    await click(button('Keep feed')); expect(container.querySelector('.feed-card__confirm')).toBeNull();
    await click(container.querySelector('button[aria-label="Delete Shared builders"]')); await click(button('Delete feed'));
    expect(readSavedFeeds()).toEqual([]); expect(feedLink(definition.name)).toBeUndefined(); expect(container.querySelector('.feed-card')).toBeNull();
    await remount(feedPath(definition)); expect(header().textContent).toContain('PUBLIC FEED'); expect(button('Save feed', header())).toBeDefined(); noWallet();
  });

  it('keeps saved feeds and pins usable for this tab when browser storage rejects writes', async () => {
    const storage = localStorage;
    vi.stubGlobal('localStorage', { getItem: storage.getItem.bind(storage), clear: storage.clear.bind(storage), removeItem: storage.removeItem.bind(storage), setItem: (key: string, value: string) => { if (key === SAVED_FEED_STORAGE_KEY) throw new DOMException('Storage denied', 'SecurityError'); storage.setItem(key, value); } });
    await start(feedPath(recipe('Tab-only builders'))); await click(button('Save feed', container.querySelector('.custom-feed-header')!));
    expect(container.querySelector('.toast')?.textContent).toContain('Feeds will last for this tab');
    await click(button('Pin feed', container.querySelector('.custom-feed-header')!)); expect(feedLink('Tab-only builders')).toBeDefined(); expect(localStorage.getItem(SAVED_FEED_STORAGE_KEY)).toBeNull();
    await click(button('All feeds', container.querySelector('.custom-feed-header')!)); expect(container.querySelector('.feed-card')?.textContent).toContain('Tab-only builders');
    await remount('/feeds'); expect(container.querySelector('.feed-card')).toBeNull(); expect(feedLink('Tab-only builders')).toBeUndefined(); noWallet();
  });
});
