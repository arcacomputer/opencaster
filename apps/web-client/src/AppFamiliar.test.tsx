// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { getCast, getCastReactionPeople, getChannelMembers, getChannels, getConversation, getFeed, getFollowStatus, getInfo, getProfileFeed, getReactionStatus, getSuggestedUsers, getUser, searchCasts, searchUsers, type Cast, type FeedResponse, type User } from '@opencaster/client-core/api';
import type { WalletSession } from './lib/auth';
import { BOOKMARK_STORAGE_KEY, LEGACY_BOOKMARK_STORAGE_KEY } from './lib/bookmarks';
import { contentPreferencesKey, emptyContentPreferences, readContentPreferences } from './lib/contentPreferences';
import { FULL_CLIENT_SCOPES } from '@opencaster/client-core/pairing';

// Only account authorization is synthetic. Local settings, cards, routes,
// bookmark tools and reaction-profile dialogs are the production components.
const wallet = vi.hoisted(() => ({ next: null as WalletSession | null }));
vi.mock('./components/ConnectAccount', () => ({
  default: ({ onConnect }: { onConnect(value: WalletSession): void }) => <button onClick={() => { if (wallet.next) onConnect(wallet.next); }}>Approve isolated wallet</button>,
  DeviceSettings: ({ onLock }: { onLock(revoked?: boolean): void }) => <button onClick={() => onLock(false)}>Lock isolated wallet</button>,
}));
vi.mock('@opencaster/client-core/api', async original => ({
  ...await original<typeof import('@opencaster/client-core/api')>(), getCast: vi.fn(), getCastReactionPeople: vi.fn(), getChannel: vi.fn(), getChannelMembers: vi.fn(), getChannels: vi.fn(), getConversation: vi.fn(), getFeed: vi.fn(), getFollowStatus: vi.fn(), getInfo: vi.fn(), getProfileFeed: vi.fn(), getReactionStatus: vi.fn(), getSuggestedUsers: vi.fn(), getUser: vi.fn(), searchCasts: vi.fn(), searchUsers: vi.fn(),
}));

const person = (fid: number): User => ({ fid, username: `person${fid}`, display_name: `Person ${fid}`, custody_address: '', profile: { bio: { text: 'An isolated public profile' } }, follower_count: 0, following_count: 0 });
const cast = (letter: string, author: number, text: string): Cast => ({ hash: `0x${letter.repeat(40)}`, author: person(author), text, timestamp: '2026-10-21T12:00:00.000Z', embeds: [], reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 } });
const first = cast('a', 20, 'An isolated coffee conversation');
const second = cast('b', 30, 'An isolated astronomy conversation');
function session(fid: number, key: string): WalletSession {
  return { fid, user: person(fid), custodyAddress: '', publicKey: key.repeat(64), scopes: FULL_CLIENT_SCOPES, dispose: vi.fn(), cast: vi.fn(), deleteCast: vi.fn(), react: vi.fn(), follow: vi.fn(), updateProfile: vi.fn(), refreshProfile: vi.fn(), authorizeMediaUpload: vi.fn() } as unknown as WalletSession;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
let container: HTMLDivElement; let root: Root;
let feedIntersection: IntersectionObserverCallback;
let feedSentinel: Element;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); localStorage.clear(); localStorage.setItem('opencaster.explore', '1'); wallet.next = null; history.replaceState(null, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { feedIntersection = callback; }
    observe(target: Element) { feedSentinel = target; } disconnect() {}
  });
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  vi.mocked(getFeed).mockResolvedValue({ casts: [first, second], next: {} });
  vi.mocked(getProfileFeed).mockResolvedValue({ casts: [], next: {} });
  vi.mocked(getChannels).mockResolvedValue({ channels: [], next: {} });
  vi.mocked(getInfo).mockResolvedValue({ version: 'isolated-test' });
  vi.mocked(getReactionStatus).mockResolvedValue(false);
  vi.mocked(getSuggestedUsers).mockResolvedValue({ users: [] });
  vi.mocked(getChannelMembers).mockResolvedValue({ users: [], next: {} });
  vi.mocked(getCastReactionPeople).mockResolvedValue({ users: [person(42)], next: {} });
  vi.mocked(getUser).mockImplementation(async lookup => person(lookup.fid ?? 10));
  vi.mocked(getFollowStatus).mockResolvedValue(false);
  vi.mocked(getConversation).mockResolvedValue({ cast: first, replies: [] });
  vi.mocked(getCast).mockResolvedValue(first);
  vi.mocked(searchCasts).mockResolvedValue({ casts: [], next: {} });
  vi.mocked(searchUsers).mockResolvedValue({ users: [] });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function until(ready: () => boolean) { for (let attempt = 0; attempt < 100 && !ready(); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); expect(ready()).toBe(true); }
async function start(path = '/') { history.replaceState(null, '', path); await act(async () => root.render(<App />)); await flush(); }
async function remount(path: string) { await act(async () => root.unmount()); root = createRoot(container); await start(path); }
async function click(element: Element) { expect(element).toBeTruthy(); await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }); await flush(); }
function button(label: string, scope: ParentNode = container) { return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent?.trim() === label)!; }
function dialog(title: string) { return [...container.querySelectorAll<HTMLDialogElement>('dialog')].find(value => value.querySelector('h2')?.textContent === title); }
const texts = () => [...container.querySelectorAll('main .feed .cast__text')].map(value => value.textContent);
async function discover() { await click(button('Discover', container.querySelector('nav[aria-label="Main navigation"]')!)); }
async function settings() { await click(container.querySelector('nav[aria-label="Main navigation"] a[href="/settings"]')!); await until(() => Boolean(container.querySelector('.content-settings'))); }
async function options(index = 0) { await click(container.querySelectorAll('main button[aria-label="More cast options"]')[index]); return dialog('Cast options')!; }
async function connect(value: WalletSession) { wallet.next = value; await click(button('Sign in')); await click(button('Approve isolated wallet')); }
async function lock() { await click(container.querySelector('button[aria-label="Manage this device’s signing access"]')!); await click(button('Lock isolated wallet')); }
async function input(field: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
}
function stubStorage(overrides: Partial<Pick<Storage, 'getItem' | 'setItem'>>) {
  const storage = localStorage;
  // Happy DOM binds storage methods through a Proxy. Replacing the global keeps
  // failure-mode mocks scoped to this test without relying on proxy spy cleanup.
  vi.stubGlobal('localStorage', {
    getItem: storage.getItem.bind(storage), setItem: storage.setItem.bind(storage),
    removeItem: storage.removeItem.bind(storage), clear: storage.clear.bind(storage),
    key: storage.key.bind(storage), get length() { return storage.length; }, ...overrides,
  } satisfies Storage);
  return storage;
}

describe('isolated familiar-client App integration', () => {
  it('opens public settings and restores a cast hidden through its menu without a network write', async () => {
    await start('/settings');
    await until(() => Boolean(container.querySelector('.content-settings')));
    expect(container.querySelector('main')?.textContent).toContain('Guest preferences');
    expect(container.querySelector('main h2')?.textContent).toBe('Content preferences');
    expect(getFeed).not.toHaveBeenCalled();
    await discover(); await click(button('Hide this cast on this browser', await options()));
    expect(texts()).toEqual([second.text]);
    expect(readContentPreferences().hiddenCasts).toEqual([first.hash.slice(2)]);
    await settings(); await click(button('Clear hidden casts')); await discover();
    expect(texts()).toEqual([first.text, second.text]);
    expect(readContentPreferences().hiddenCasts).toEqual([]);
    expect(wallet.next).toBeNull();
  });

  it('keeps muted authors scoped to the connected FID across account switches and permits restoring them', async () => {
    const alice = session(10, '1'); const bob = session(11, '2');
    await start(); await connect(alice); await click(button('Mute @person20 on this browser', await options()));
    expect(texts()).toEqual([second.text]);
    await settings(); expect(container.querySelector('main')?.textContent).toContain('Preferences for account FID 10');
    expect(button('Unmute', container.querySelector('main')!)).toBeTruthy();
    await lock(); await connect(bob); await discover();
    expect(texts()).toEqual([first.text, second.text]);
    await settings(); expect(container.querySelector('main')?.textContent).toContain('Preferences for account FID 11');
    expect(container.querySelector('main')?.textContent).toContain('No accounts muted.');
    await lock(); await connect(session(10, '3')); await discover();
    expect(texts()).toEqual([second.text]);
    await settings(); await click(button('Unmute')); await discover();
    expect(texts()).toEqual([first.text, second.text]);
    for (const value of [alice, bob]) {
      expect(value.cast).not.toHaveBeenCalled(); expect(value.react).not.toHaveBeenCalled(); expect(value.follow).not.toHaveBeenCalled();
    }
  });

  it('keeps tab-only muted authors in memory through account switches when preference storage fails', async () => {
    await start(); await connect(session(10, '1'));
    const originalSetItem = localStorage.setItem.bind(localStorage);
    const storage = stubStorage({ setItem(key, value) {
      if (key.startsWith('arca.hypersnap.content-preferences.')) throw new Error('Isolated quota failure');
      originalSetItem(key, value);
    } });
    await click(button('Mute @person20 on this browser', await options()));
    expect(texts()).toEqual([second.text]);
    expect(container.querySelector('.toast')?.textContent).toContain('Account muted for this tab. Browser storage is unavailable.');
    expect(readContentPreferences(10).mutedAccounts).toEqual([]);
    await lock(); expect(texts()).toEqual([first.text, second.text]);
    await connect(session(11, '2')); expect(texts()).toEqual([first.text, second.text]);
    await settings(); expect(container.querySelector('main')?.textContent).toContain('No accounts muted.');
    await lock(); await discover(); expect(texts()).toEqual([first.text, second.text]);
    await connect(session(10, '3')); expect(texts()).toEqual([second.text]);
    await settings(); expect(button('Unmute')).toBeTruthy();
    expect(readContentPreferences().mutedAccounts).toEqual([]); expect(readContentPreferences(11).mutedAccounts).toEqual([]);
    expect(Object.keys(storage).some(key => key.startsWith('arca.hypersnap.content-preferences.'))).toBe(false);
  });

  it('renders settings and applies tab-only muted phrases when all browser storage reads and writes are denied', async () => {
    stubStorage({
      getItem() { throw new Error('Isolated storage access denied'); },
      setItem() { throw new Error('Isolated storage access denied'); },
    });
    await start('/settings'); await until(() => Boolean(container.querySelector('.content-settings')));
    expect(container.querySelector('main')?.textContent).toContain('Guest preferences');
    await input(container.querySelector<HTMLInputElement>('.content-settings input')!, 'coffee');
    await act(async () => { container.querySelector('.content-settings form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(container.querySelector('.content-settings__words')?.textContent).toContain('coffee');
    expect(container.querySelector('.toast')?.textContent).toContain('Content controls will last for this tab. Browser storage is unavailable.');
    await discover(); expect(texts()).toEqual([second.text]);
    await settings(); expect(container.querySelector('.content-settings__words')?.textContent).toContain('coffee');
  });

  it('does not carry a temporary reveal into another account that also muted the same author', async () => {
    for (const fid of [10, 11]) localStorage.setItem(contentPreferencesKey(fid), JSON.stringify({ ...emptyContentPreferences(), mutedAccounts: [{ fid: first.author.fid, username: first.author.username }] }));
    await start(); await connect(session(10, '1'));
    expect(texts()).toEqual([second.text]);
    await click(button('Show for this view')); expect(texts()).toEqual([first.text, second.text]);
    await lock(); await connect(session(11, '2'));
    expect(texts()).toEqual([second.text]);
    expect(container.querySelector('.content-filter-summary')?.textContent).toContain('1 loaded cast is filtered');
    expect(readContentPreferences(10).mutedAccounts[0].fid).toBe(first.author.fid);
    expect(readContentPreferences(11).mutedAccounts[0].fid).toBe(first.author.fid);
  });

  it('reports full mute and hide lists without closing the cast menu or losing the visible feed', async () => {
    localStorage.setItem(contentPreferencesKey(), JSON.stringify({ ...emptyContentPreferences(), mutedAccounts: Array.from({ length: 100 }, (_, index) => ({ fid: index + 1_000 })), hiddenCasts: Array.from({ length: 500 }, (_, index) => index.toString(16).padStart(40, '0')) }));
    await start();
    const menu = await options();
    await click(button('Mute @person20 on this browser', menu));
    expect(dialog('Cast options')).toBe(menu);
    expect(container.querySelector('.toast')?.textContent).toContain('Mute up to 100 accounts. Remove one before adding another.');
    await click(button('Hide this cast on this browser', menu));
    expect(dialog('Cast options')).toBe(menu);
    expect(container.querySelector('.toast')?.textContent).toContain('Hide up to 500 casts. Clear hidden casts in content settings before hiding another.');
    expect(readContentPreferences().mutedAccounts).toHaveLength(100); expect(readContentPreferences().hiddenCasts).toHaveLength(500);
    await click(menu.querySelector('button[aria-label="Close dialog"]')!); expect(texts()).toEqual([first.text, second.text]);
  });

  it('searches and orders legacy bookmarks, confirms clearing, and keeps them cleared after refresh', async () => {
    localStorage.setItem(LEGACY_BOOKMARK_STORAGE_KEY, JSON.stringify([first, second, { hash: first.hash, author: null, text: 'Malformed public snapshot' }]));
    await start('/bookmarks');
    expect(texts()).toEqual([first.text, second.text]);
    expect(container.textContent).not.toContain('Malformed public snapshot');
    const field = container.querySelector<HTMLInputElement>('main input[type="search"]')!;
    await input(field, 'PERSON30 astronomy'); expect(texts()).toEqual([second.text]);
    await click(container.querySelector('button[aria-label="Clear bookmark search"]')!);
    await click(button('Oldest saved')); expect(texts()).toEqual([second.text, first.text]);
    await click(button('Clear bookmarks')); expect(texts()).toHaveLength(2);
    await click(button('Keep bookmarks')); expect(texts()).toHaveLength(2);
    await click(button('Clear bookmarks')); await click(button('Clear all 2 bookmarks'));
    expect(texts()).toEqual([]);
    expect(JSON.parse(localStorage.getItem(BOOKMARK_STORAGE_KEY)!)).toEqual({ version: 1, casts: [] });
    await remount('/bookmarks'); expect(texts()).toEqual([]);
    expect(container.querySelector('main')?.textContent).toContain('0 saved casts');
    expect(getFeed).not.toHaveBeenCalled();
  });

  it('changes trending windows, cancels stale pagination, and leaves following outside that setting', async () => {
    const stale = deferred<FeedResponse>();
    vi.mocked(getFeed).mockImplementation(options => options.cursor ? stale.promise : Promise.resolve({ casts: [options.timeWindow === '7d' ? second : first], next: options.timeWindow === '7d' ? {} : { cursor: 'old-trending-page' } }));
    await start();
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Trending time window"]')!;
    expect(select.value).toBe('24h');
    expect(getFeed).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'trending', timeWindow: '24h' }));
    await act(async () => { feedIntersection([{ target: feedSentinel, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); });
    const oldRequest = vi.mocked(getFeed).mock.calls.find(([value]) => value.cursor === 'old-trending-page')![0];
    await act(async () => { select.value = '7d'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(oldRequest.signal?.aborted).toBe(true);
    expect(getFeed).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'trending', timeWindow: '7d' }));
    await act(async () => stale.resolve({ casts: [cast('c', 20, 'A stale pagination result')], next: {} }));
    expect(texts()).toEqual([second.text]);
    await connect(session(10, '1')); await click(container.querySelector('nav[aria-label="Home feeds"] a[href="/following"]')!);
    const following = vi.mocked(getFeed).mock.calls.filter(([value]) => value.kind === 'following').at(-1)![0];
    expect(following).toEqual(expect.objectContaining({ kind: 'following', fid: 10 }));
    expect(following.timeWindow).toBeUndefined();
    expect(container.querySelector('select[aria-label="Trending time window"]')).toBeNull();
  });

  it('opens search and focuses its main query field with the global command shortcut', async () => {
    await start();
    const key = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => { document.body.dispatchEvent(key); }); await flush();
    expect(key.defaultPrevented).toBe(true); expect(location.pathname).toBe('/search');
    expect(document.activeElement).toBe(container.querySelector('main input[type="search"]'));
  });

  it('opens public reaction profiles through cast options and closes the dialog when visiting a profile', async () => {
    await start(); await click(button('View likes and recasts', await options()));
    await until(() => Boolean(dialog('Cast reactions')?.querySelector('a[href="/profile/42"]')));
    const reactions = dialog('Cast reactions')!;
    expect(reactions).toBeTruthy();
    expect(getCastReactionPeople).toHaveBeenCalledWith(expect.objectContaining({ target: { fid: first.author.fid, hash: first.hash }, type: 'likes' }));
    await click(reactions.querySelector('a[href="/profile/42"]')!);
    expect(location.pathname).toBe('/profile/42'); expect(dialog('Cast reactions')).toBeUndefined();
    expect(container.querySelector('main .profile h2')?.textContent).toBe('Person 42');
    expect(wallet.next).toBeNull();
  });
});
