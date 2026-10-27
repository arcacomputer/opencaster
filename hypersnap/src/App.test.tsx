// @vitest-environment happy-dom
import { act, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { getCast, getChannel, getChannels, getConversation, getFeed, getFollowStatus, getInfo, getProfileFeed, getReactionStatus, getSuggestedUsers, getChannelMembers, getCastQuotes, getUser, resolveCastAlias, searchCasts, searchUsers, type Cast, type CastAliasResult, type CastAliasContinuation, type User } from './lib/api';
import type { WalletSession } from './lib/auth';
import { uploadMedia } from './lib/media';
import { FULL_CLIENT_SCOPES, FULL_SOCIAL_SCOPES } from './lib/pairing';
import { castPermalink } from './lib/navigation';
import { contentPreferencesKey, emptyContentPreferences } from './lib/contentPreferences';

const wallet = vi.hoisted(() => ({ next: null as WalletSession | null, signal: null as AbortSignal | null, initialFid: undefined as number | undefined, onConnect: null as ((value: WalletSession) => void) | null }));
vi.mock('./components/ConnectAccount', () => ({
  default: function SyntheticWallet({ onConnect, onClose, requestedScopes, initialFid, presentation }: { onConnect(value: WalletSession): void; onClose(): void; requestedScopes?: readonly number[]; initialFid?: number; presentation?: string }) {
    const controller = useRef(new AbortController()); wallet.signal = controller.current.signal; wallet.initialFid = initialFid; wallet.onConnect = onConnect;
    useEffect(() => () => controller.current.abort(), []);
    return <main data-testid="synthetic-wallet" data-presentation={presentation}><p data-testid="requested-scopes">{requestedScopes?.join(',') || 'posting'}</p><button onClick={() => { if (wallet.next) onConnect(wallet.next); }}>Approve synthetic wallet</button><button onClick={onClose}>Cancel synthetic wallet</button></main>;
  },
  DeviceSettings: () => <div>Synthetic device settings</div>,
}));
vi.mock('./lib/media', () => ({ uploadMedia: vi.fn() }));
vi.mock('./lib/api', async original => ({ ...await original<typeof import('./lib/api')>(), getCast: vi.fn(), getChannel: vi.fn(), getChannels: vi.fn(), getConversation: vi.fn(), getFeed: vi.fn(), getFollowStatus: vi.fn(), getInfo: vi.fn(), getProfileFeed: vi.fn(), getReactionStatus: vi.fn(), getSuggestedUsers: vi.fn(), getChannelMembers: vi.fn(), getCastQuotes: vi.fn(), getUser: vi.fn(), resolveCastAlias: vi.fn(), searchCasts: vi.fn(), searchUsers: vi.fn() }));

const person = (fid: number): User => ({ fid, username: `person${fid}`, display_name: `Person ${fid}`, custody_address: '0x1111111111111111111111111111111111111111', profile: { bio: { text: 'An isolated public profile' } }, follower_count: 0, following_count: 0 });
const cast = (letter: string, authorFid: number, text: string): Cast => ({ hash: `0x${letter.repeat(40)}`, author: person(authorFid), text, timestamp: '2026-10-19T12:00:00.000Z', embeds: [], reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 } });
const ownCast = cast('a', 10, 'My isolated cast');
const otherCast = cast('b', 20, 'Someone else’s isolated cast');
function session(scopes: readonly number[], key = '1'): WalletSession {
  return { fid: 10, user: person(10), custodyAddress: person(10).custody_address, publicKey: key.repeat(64), scopes, cast: vi.fn().mockResolvedValue({ hash: `0x${'c'.repeat(40)}` }), deleteCast: vi.fn().mockResolvedValue(undefined), dispose: vi.fn(), react: vi.fn(), follow: vi.fn(), updateProfile: vi.fn(), refreshProfile: vi.fn(), authorizeMediaUpload: vi.fn() } as unknown as WalletSession;
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((value, error) => { resolve = value; reject = error; }); return { promise, resolve, reject }; }
let container: HTMLDivElement;
let root: Root;
let feedObservers: { callback: IntersectionObserverCallback; observer: IntersectionObserver; target?: Element; disconnected: boolean }[];
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); localStorage.clear(); localStorage.setItem('opencaster.explore', '1'); sessionStorage.clear(); wallet.next = null; wallet.signal = null; wallet.initialFid = undefined; wallet.onConnect = null;
  history.replaceState(null, '', '/');
  feedObservers = [];
  vi.stubGlobal('IntersectionObserver', class {
    entry: typeof feedObservers[number];
    constructor(callback: IntersectionObserverCallback) { this.entry = { callback, observer: this as unknown as IntersectionObserver, disconnected: false }; feedObservers.push(this.entry); }
    observe(target: Element) { this.entry.target = target; }
    disconnect() { this.entry.disconnected = true; }
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  vi.mocked(getFeed).mockResolvedValue({ casts: [], next: {} });
  vi.mocked(getProfileFeed).mockResolvedValue({ casts: [], next: {} });
  vi.mocked(getChannels).mockResolvedValue({ channels: [], next: {} });
  vi.mocked(getInfo).mockResolvedValue({ version: 'isolated-test' });
  vi.mocked(getReactionStatus).mockResolvedValue(false);
  vi.mocked(getSuggestedUsers).mockResolvedValue({ users: [person(30)] });
  vi.mocked(getChannelMembers).mockResolvedValue({ users: [person(20)], next: {} });
  vi.mocked(getCastQuotes).mockResolvedValue({ casts: [], next: {} });
  vi.mocked(getUser).mockImplementation(async lookup => person(lookup.fid ?? 10));
  vi.mocked(getFollowStatus).mockResolvedValue(false);
  vi.mocked(getConversation).mockResolvedValue({ cast: otherCast, replies: [] });
  vi.mocked(getCast).mockResolvedValue(otherCast);
  vi.mocked(resolveCastAlias).mockResolvedValue({ author: person(20), candidates: [otherCast], complete: true, scanned: 1 });
  vi.mocked(searchCasts).mockResolvedValue({ casts: [otherCast], next: {} });
  vi.mocked(searchUsers).mockResolvedValue({ users: [person(42)] });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function start(path = '/') { history.replaceState(null, '', path); await act(async () => root.render(<App />)); }
async function click(element: Element) { await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }); }
async function reachFeedEnd(times = 1) {
  const entry = feedObservers.filter(value => !value.disconnected && value.target).at(-1);
  expect(entry).toBeDefined();
  await act(async () => { for (let i = 0; i < times; i++) entry!.callback([{ target: entry!.target!, isIntersecting: true } as IntersectionObserverEntry], entry!.observer); });
}
function button(label: string, scope: ParentNode = container) { return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!; }
// Quote lives in each cast's Recast menu, as on X and Farcaster.
async function openQuote(scope: ParentNode = container, index = 0) {
  const trigger = scope.querySelectorAll('button.recast-trigger')[index];
  await click(trigger); await click(trigger.parentElement!.querySelector('[role="menu"] button[aria-label="Quote cast"]')!);
}
function thread() { return container.querySelector<HTMLElement>('section.conversation-page') ?? undefined!; }
function dialog(title: string) { return [...container.querySelectorAll<HTMLDialogElement>('dialog')].find(item => item.querySelector('h2')?.textContent === title)!; }
async function settleNavigation() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function connect(value: WalletSession) { wallet.next = value; await click(button('Sign in')); await click(button('Approve synthetic wallet')); await settleNavigation(); }
async function traverse(direction: 'back' | 'forward') {
  await act(async () => { history[direction](); await new Promise(resolve => setTimeout(resolve, 10)); });
}

describe('automatic timeline pagination', () => {
  it('loads near the end once per request, keeps existing casts visible, and stops at exhaustion', async () => {
    const page = deferred<{ casts: Cast[]; next: {} }>();
    vi.mocked(getFeed).mockImplementation(options => options.cursor ? page.promise : Promise.resolve({ casts: [ownCast], next: { cursor: 'next-page' } }));
    await start();
    expect(getFeed).toHaveBeenCalledOnce(); expect(button('More conversations')).toBeUndefined();
    await reachFeedEnd(2);
    expect(getFeed).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.feed-pagination')?.textContent).toContain('Loading');
    expect(container.querySelector('main .feed')?.textContent).toContain(ownCast.text);
    await act(async () => page.resolve({ casts: [otherCast, { ...ownCast, hash: 'A'.repeat(40) }], next: {} }));
    expect(container.querySelectorAll('main .feed .cast')).toHaveLength(2);
    expect(container.querySelector('.feed-pagination')).toBeNull();
    expect(container.querySelector('.feed-end')?.textContent).toContain('end of the casts available');
  });

  it('continues a sparse profile tab while it still has a cursor', async () => {
    vi.mocked(getProfileFeed).mockImplementation(async options => !options.cursor
      ? { casts: [], next: { cursor: 'sparse-page' } }
      : options.cursor === 'sparse-page' ? { casts: [], next: { cursor: 'older-page' } } : { casts: [otherCast], next: {} });
    await start('/profile/20?tab=media');
    await reachFeedEnd(); await reachFeedEnd();
    expect(getProfileFeed).toHaveBeenCalledTimes(3);
    expect(container.querySelector('main .feed')?.textContent).toContain(otherCast.text);
  });

  it('continues when all loaded casts are filtered without revealing them', async () => {
    localStorage.setItem(contentPreferencesKey(), JSON.stringify({ ...emptyContentPreferences(), mutedAccounts: [{ fid: ownCast.author.fid, username: ownCast.author.username }] }));
    vi.mocked(getFeed).mockImplementation(async options => options.cursor ? { casts: [otherCast], next: {} } : { casts: [ownCast], next: { cursor: 'unfiltered-page' } });
    await start();
    expect(container.querySelector('main')?.textContent).toContain('Your content controls are active');
    await reachFeedEnd();
    expect(container.querySelector('main .feed')?.textContent).toContain(otherCast.text);
    expect(container.querySelector('main .feed')?.textContent).not.toContain(ownCast.text);
  });

  it('keeps a failed page inline until an explicit retry succeeds', async () => {
    vi.mocked(getFeed).mockResolvedValueOnce({ casts: [ownCast], next: { cursor: 'retry-page' } }).mockRejectedValueOnce(new Error('Temporary page outage')).mockResolvedValueOnce({ casts: [otherCast], next: {} });
    await start(); await reachFeedEnd();
    expect(container.querySelector('.feed-pagination [role="alert"]')?.textContent).toContain('Temporary page outage');
    expect(container.querySelector('main .feed')?.textContent).toContain(ownCast.text);
    expect(getFeed).toHaveBeenCalledTimes(2);
    expect(feedObservers.every(entry => entry.disconnected)).toBe(true);
    await click(container.querySelector('.feed-pagination button')!);
    expect(getFeed).toHaveBeenCalledTimes(3);
    expect(vi.mocked(getFeed).mock.calls[2][0].cursor).toBe('retry-page');
    expect(container.querySelector('main .feed')?.textContent).toContain(otherCast.text);
  });

  it('stops cyclic cursors and resets pagination history on refresh', async () => {
    vi.mocked(getFeed).mockImplementation(async options => !options.cursor ? { casts: [ownCast], next: { cursor: 'page-a' } } : { casts: [otherCast], next: { cursor: options.cursor === 'page-a' ? 'page-b' : 'page-a' } });
    await start(); await reachFeedEnd(); await reachFeedEnd();
    expect(getFeed).toHaveBeenCalledTimes(3); expect(container.querySelector('.feed-pagination')).toBeNull();
    expect(container.querySelector('.feed-end')?.textContent).toContain('node repeated a feed page');
    await click(container.querySelector('button[aria-label="Refresh feed"]')!); await reachFeedEnd();
    expect(getFeed).toHaveBeenCalledTimes(5); expect(container.querySelector('.feed-pagination')).not.toBeNull();
  });

  it('pauses the background sentinel while a conversation is open and resumes on Back', async () => {
    vi.mocked(getFeed).mockImplementation(async options => ({ casts: [otherCast], next: options.cursor ? {} : { cursor: 'background-page' } }));
    await start();
    const observer = feedObservers.at(-1)!;
    await click(container.querySelector('main a[aria-label="Open cast"]')!);
    expect(observer.disconnected).toBe(true);
    await act(async () => observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], observer.observer));
    expect(getFeed).toHaveBeenCalledOnce();
    await click(thread().querySelector('button[aria-label="Back"]')!); await settleNavigation();
    await reachFeedEnd(); expect(getFeed).toHaveBeenCalledTimes(2);
  });
});

describe('homepage node support placement', () => {
  it('appears under the home tabs and before the composer and feed, without blocking browsing', async () => {
    vi.mocked(getFeed).mockResolvedValue({ casts: [otherCast], next: {} });
    await start();
    const banner = container.querySelector('.node-support')!;
    const tabs = container.querySelector('nav[aria-label="Home feeds"]')!;
    const feed = container.querySelector('main .feed')!;
    expect(banner).not.toBeNull(); expect(feed).not.toBeNull();
    expect(tabs.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(banner.compareDocumentPosition(feed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('main .feed')?.textContent).toContain(otherCast.text);
    await click(banner.querySelector('button')!);
    expect(container.querySelector('.node-support')).toBeNull();
    expect(container.querySelector('main .feed')?.textContent).toContain(otherCast.text);
  });

  it('stays above the home composer for a signed-in account', async () => {
    await start(); await connect(session(FULL_CLIENT_SCOPES));
    const banner = container.querySelector('.node-support')!; const composer = container.querySelector('main .home-composer .composer')!;
    expect(banner).not.toBeNull(); expect(composer).not.toBeNull();
    expect(banner.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(['/following', '/settings', '/devlog', '/profile/20'])('does not interrupt %s', async path => {
    await start(path); expect(container.querySelector('.node-support')).toBeNull();
  });
});

describe('Opencaster destinations for supported social links', () => {
  it.each(['short cast-text link', 'full-hash URL embed'] as const)('pushes a %s from a direct conversation so Back and Close return to its source cast', async kind => {
    const target: Cast = { ...otherCast, hash: `0xcbbe7828${'b'.repeat(32)}`, author: { ...otherCast.author, username: 'gandhionchain' }, text: 'The separate linked conversation' };
    const short = kind === 'short cast-text link';
    const targetPath = castPermalink(target);
    const source: Cast = { ...ownCast, hash: '0xffe80d84ab6bc9203c084001647e9520e21ac646', text: short ? 'Source with https://farcaster.xyz/gandhionchain/0xcbbe7828' : 'Source with a separate cast embed', embeds: short ? [] : [{ url: `https://farcaster.xyz/~/conversations/${target.hash}` }] };
    vi.mocked(getConversation).mockImplementation(async hash => ({ cast: hash === source.hash ? source : target, replies: [] }));
    vi.mocked(resolveCastAlias).mockResolvedValue({ author: target.author, candidates: [target], complete: false, scanned: 1000, continuation: { authorIdentifier: 'gandhionchain', hashPrefix: '0xcbbe7828', fid: 20, cursor: 'bmV4dA==', seenCursors: [], hashes: [target.hash], scanned: 1000 } });
    await start(`/cast/${source.hash}`); expect(history.state).toBeNull(); expect(thread().textContent).toContain(source.text);
    await click(thread().querySelector(short ? '.cast__text a' : '.link-embed')!);
    expect(history.state).toEqual({ quorumThread: true, quorumBackground: '/' });
    if (short) {
      expect(location.pathname).toBe('/gandhionchain/0xcbbe7828');
      expect(thread().querySelector('.cast-link-lookup')).toBeNull();
      expect(vi.mocked(resolveCastAlias).mock.calls[0][0].signal?.aborted).toBe(true);
    } else expect(resolveCastAlias).not.toHaveBeenCalled();
    expect(location.pathname).toBe(targetPath); expect(thread().textContent).toContain(target.text);
    expect(history.state).toEqual({ quorumThread: true, quorumBackground: '/' });
    await traverse('back'); expect(location.pathname).toBe(castPermalink(source)); expect(history.state).toBeNull(); expect(thread().textContent).toContain(source.text);
    await traverse('forward'); expect(location.pathname).toBe(targetPath); expect(thread().textContent).toContain(target.text);
    await click(thread().querySelector('button[aria-label="Back"]')!); await settleNavigation();
    expect(location.pathname).toBe(castPermalink(source)); expect(thread().textContent).toContain(source.text);
  });

  it('returns from a social profile link to the direct source conversation on Back', async () => {
    const source: Cast = { ...ownCast, text: 'Meet https://farcaster.xyz/person30' };
    vi.mocked(getConversation).mockResolvedValue({ cast: source, replies: [] });
    await start(`/cast/${source.hash}`); await click(thread().querySelector('.cast__text a')!);
    expect(location.pathname).toBe('/profile/person30'); expect(thread()).toBeUndefined();
    await traverse('back'); expect(location.pathname).toBe(castPermalink(source)); expect(thread().textContent).toContain(source.text);
  });

  it('opens cast-text profiles locally and preserves the feed background through cast-link Back and Forward', async () => {
    const source = cast('d', 10, 'Profile https://www.warpcast.com/Person30/?utm_source=cast#bio and cast https://farcaster.xyz/Person20/0xbbbbbbbb?ref=cast');
    vi.mocked(getFeed).mockResolvedValue({ casts: [source], next: {} });
    vi.mocked(getUser).mockImplementation(async lookup => person(lookup.username === 'person30' ? 30 : lookup.fid ?? 10));
    await start();
    const profileLink = container.querySelector<HTMLAnchorElement>('main .feed .cast__text a[href="/profile/person30"]')!;
    expect(profileLink.target).toBe(''); expect(profileLink.textContent).toContain('https://www.warpcast.com/Person30/');
    await click(profileLink); expect(location.pathname).toBe('/profile/person30'); expect(getUser).toHaveBeenCalledWith({ username: 'person30' }, expect.any(AbortSignal));
    await traverse('back'); expect(location.pathname).toBe('/');
    const castLink = container.querySelector<HTMLAnchorElement>('main .feed .cast__text a[href="/person20/0xbbbbbbbb"]')!;
    expect(castLink.target).toBe(''); await click(castLink);
    expect(resolveCastAlias).toHaveBeenCalledWith(expect.objectContaining({ authorIdentifier: 'person20', hashPrefix: '0xbbbbbbbb' }));
    expect(location.pathname).toBe(castPermalink(otherCast)); expect(history.state).toEqual({ quorumThread: true, quorumBackground: '/' });
    expect(thread().textContent).toContain(otherCast.text);
    await traverse('back'); expect(location.pathname).toBe('/'); expect(thread()).toBeUndefined();
    await traverse('forward'); expect(location.pathname).toBe(castPermalink(otherCast)); expect(thread().textContent).toContain(otherCast.text);
    await click(thread().querySelector('button[aria-label="Back"]')!); await settleNavigation(); expect(location.pathname).toBe('/');
  });

  it('labels supported URL embeds with their Opencaster destination and opens profile and cast embeds locally', async () => {
    const profileUrl = 'https://farcaster.xyz/person30?ref=embed'; const castUrl = `https://www.warpcast.com/person20/${otherCast.hash}#replies`;
    vi.mocked(getFeed).mockResolvedValue({ casts: [{ ...ownCast, embeds: [{ url: profileUrl }, { url: castUrl }] }], next: {} });
    await start();
    const links = [...container.querySelectorAll<HTMLAnchorElement>('main .feed .link-embed')];
    expect(links.map(link => link.getAttribute('href'))).toEqual(['/profile/person30', `/person20/${otherCast.hash}`]);
    for (const link of links) { expect(link.target).toBe(''); expect(link.textContent).toContain('opencaster.org'); expect(link.textContent).not.toMatch(/warpcast\.com|farcaster\.xyz/); }
    expect(links[0].title).toContain(profileUrl); expect(links[1].title).toContain(castUrl);
    await click(links[0]); expect(location.pathname).toBe('/profile/person30');
    await traverse('back'); await click(container.querySelector(`main .feed .link-embed[href="/person20/${otherCast.hash}"]`)!);
    expect(location.pathname).toBe(castPermalink(otherCast, { fullHash: true })); expect(getConversation).toHaveBeenCalledWith(otherCast.hash, expect.any(AbortSignal));
  });

  it('opens official full-hash conversation fallback links directly without inventing an author lookup', async () => {
    vi.mocked(getFeed).mockResolvedValue({ casts: [{ ...ownCast, text: `https://farcaster.xyz/~/conversations/${otherCast.hash}?ref=cast#replies` }], next: {} });
    await start(); const link = container.querySelector<HTMLAnchorElement>('main .feed .cast__text a')!;
    expect(link.getAttribute('href')).toBe(`/cast/${otherCast.hash}`); expect(link.target).toBe(''); await click(link);
    expect(location.pathname).toBe(castPermalink(otherCast)); expect(getConversation).toHaveBeenCalledWith(otherCast.hash, expect.any(AbortSignal)); expect(resolveCastAlias).not.toHaveBeenCalled();
    expect(history.state).toEqual({ quorumThread: true, quorumBackground: '/' });
  });

  it('routes profile-bio links locally and retains the profile tab behind its cast conversation', async () => {
    const publicProfile: User = { ...person(10), profile: { bio: { text: 'Meet https://warpcast.com/person30 and read https://farcaster.xyz/person20/0xbbbbbbbb?utm_source=bio' } } };
    vi.mocked(getUser).mockImplementation(async lookup => lookup.username === 'person30' ? person(30) : publicProfile);
    await start('/profile/10?tab=replies');
    await click(container.querySelector('.profile__bio a[href="/profile/person30"]')!); expect(location.pathname).toBe('/profile/person30');
    await traverse('back'); expect(location.pathname + location.search).toBe('/profile/10?tab=replies');
    const link = container.querySelector<HTMLAnchorElement>('.profile__bio a[href="/person20/0xbbbbbbbb"]')!; expect(link.target).toBe('');
    await click(link); expect(location.pathname).toBe(castPermalink(otherCast)); expect(history.state.quorumBackground).toBe('/profile/10?tab=replies');
    await click(thread().querySelector('button[aria-label="Back"]')!); await settleNavigation(); expect(location.pathname + location.search).toBe('/profile/10?tab=replies');
  });

  it('keeps real local hrefs for native modified clicks without intercepting them or starting lookups', async () => {
    vi.mocked(getFeed).mockResolvedValue({ casts: [{ ...ownCast, text: 'https://farcaster.xyz/person20/0xbbbbbbbb', embeds: [{ url: 'https://warpcast.com/person30' }] }], next: {} });
    await start();
    const links = [container.querySelector<HTMLAnchorElement>('main .feed .cast__text a')!, container.querySelector<HTMLAnchorElement>('main .feed .link-embed')!];
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^\/(?:profile\/person30|person20\/0xbbbbbbbb)$/); expect(link.target).toBe('');
      for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...modifier });
        await act(async () => { link.dispatchEvent(event); }); expect(event.defaultPrevented).toBe(false);
        // Happy DOM follows modified anchors in this window. Reset that native
        // navigation without dispatching popstate; the SPA must stay untouched.
        history.replaceState(null, '', '/');
      }
    }
    expect(location.pathname).toBe('/'); expect(resolveCastAlias).not.toHaveBeenCalled(); expect(getUser).not.toHaveBeenCalled();
  });

  it('preserves external and unsupported links and classifies raw tokens before URL normalization', async () => {
    const rawNormalized = 'https://farcaster.xyz/ignored/../person30';
    const externalUrl = 'https://example.org/person20/0xbbbbbbbb'; const unsupportedUrl = 'https://warpcast.com/~/channel/art';
    vi.mocked(getFeed).mockResolvedValue({ casts: [{ ...ownCast, text: `${rawNormalized} ${externalUrl} ${unsupportedUrl}`, embeds: [{ url: unsupportedUrl }, { url: externalUrl }] }], next: {} });
    await start();
    const links = [...container.querySelectorAll<HTMLAnchorElement>('main .feed .cast__text a, main .feed .link-embed')]; expect(links).toHaveLength(5);
    for (const link of links) { expect(link.getAttribute('href')).toMatch(/^https:\/\//); expect(link.target).toBe('_blank'); expect(link.rel).toBe('noopener noreferrer'); }
    const normalized = container.querySelector<HTMLAnchorElement>('main .feed .cast__text a')!;
    expect(normalized.getAttribute('href')).toBe('https://farcaster.xyz/person30'); expect(normalized.textContent).toBe(rawNormalized);
    expect(container.querySelector('main .feed .link-embed')?.textContent).toContain('warpcast.com');
    expect(resolveCastAlias).not.toHaveBeenCalled(); expect(getUser).not.toHaveBeenCalled();
  });

  it('keeps protocol quote previews as a single local anchor without nesting linkified text', async () => {
    vi.mocked(getFeed).mockResolvedValue({ casts: [{ ...ownCast, embeds: [{ cast_id: { fid: 20, hash: otherCast.hash } }] }], next: {} });
    vi.mocked(getCast).mockResolvedValue({ ...otherCast, text: 'Quoted https://farcaster.xyz/person30' });
    await start();
    const quote = container.querySelector<HTMLAnchorElement>('.quoted-cast')!; expect(quote.getAttribute('href')).toBe(castPermalink(otherCast)); expect(quote.querySelector('a')).toBeNull(); expect(quote.textContent).toContain('https://farcaster.xyz/person30');
    await click(quote); expect(location.pathname).toBe(castPermalink(otherCast));
  });
});

describe('author-scoped compatible cast URLs', () => {
  const alias = '/person20/0xbbbbbbbb';
  const continuation: CastAliasContinuation = { authorIdentifier: 'person20', hashPrefix: '0xbbbbbbbb', fid: 20, cursor: 'bmV4dA==', seenCursors: [], hashes: [otherCast.hash], scanned: 1000 };
  const result = (overrides: Partial<CastAliasResult> = {}): CastAliasResult => ({ author: person(20), candidates: [otherCast], complete: true, scanned: 10, ...overrides });

  it.each([alias, `/person20/${otherCast.hash}`])('verifies %s before showing its conversation at the original author/hash URL', async path => {
    const resolving = deferred<CastAliasResult>(); vi.mocked(resolveCastAlias).mockReturnValue(resolving.promise);
    const historyLength = history.length; await start(path);
    expect(thread()).toBeDefined(); expect(thread().textContent).toContain('Loading cast'); expect(getConversation).not.toHaveBeenCalled();
    expect(resolveCastAlias).toHaveBeenCalledWith(expect.objectContaining({ authorIdentifier: 'person20', hashPrefix: path.split('/')[2], signal: expect.any(AbortSignal) }));
    await act(async () => resolving.resolve(result()));
    expect(location.pathname).toBe(path); expect(history.length).toBe(historyLength); expect(history.state).toBeNull();
    expect(getConversation).toHaveBeenCalledWith(otherCast.hash, expect.any(AbortSignal)); expect(thread().textContent).toContain(otherCast.text);
    await click(thread().querySelector('button[aria-label="Back"]')!);
    expect(location.pathname).toBe('/'); expect(history.length).toBe(historyLength); expect(thread()).toBeUndefined();
  });

  it('automatically opens the first verified single result and its replies even when older history remains', async () => {
    const reply = cast('d', 30, 'Replies are available without another confirmation');
    vi.mocked(resolveCastAlias).mockResolvedValue(result({ complete: false, continuation, scanned: 1000 }));
    vi.mocked(getConversation).mockResolvedValue({ cast: otherCast, replies: [{ cast: reply, replies: [] }] });
    const historyLength = history.length;
    await start(alias);
    expect(location.pathname).toBe(alias); expect(history.length).toBe(historyLength); expect(history.state).toBeNull();
    expect(thread().textContent).toContain(otherCast.text);
    expect(thread().querySelector('.conversation-replies')?.textContent).toContain(reply.text);
    expect(thread().querySelector('.cast-link-lookup')).toBeNull();
    expect(button('Open full cast', thread())).toBeUndefined();
    expect(getConversation).toHaveBeenCalledWith(otherCast.hash, expect.any(AbortSignal));
    expect(vi.mocked(resolveCastAlias).mock.calls[0][0].signal?.aborted).toBe(true);
  });

  it('opens a verified progress match, cancels its lookup before loading replies and restores its search background on Back', async () => {
    const source = { ...ownCast, text: `Read https://farcaster.xyz${alias}` };
    const reply = cast('d', 30, 'The automatically opened conversation reply');
    const pending = deferred<CastAliasResult>();
    const background = '/search?q=cosmos';
    vi.mocked(searchCasts).mockResolvedValue({ casts: [source], next: {} });
    vi.mocked(resolveCastAlias).mockReturnValue(pending.promise);
    vi.mocked(getConversation).mockImplementation(async () => {
      expect(lookupSignal?.aborted).toBe(true);
      return { cast: otherCast, replies: [{ cast: reply, replies: [] }] };
    });
    await start(background);
    await click(container.querySelector(`main .cast__text a[href="${alias}"]`)!);
    const request = vi.mocked(resolveCastAlias).mock.calls[0][0]; const lookupSignal = request.signal;
    expect(location.pathname).toBe(alias); expect(thread().textContent).toContain('Loading cast');
    expect(getConversation).not.toHaveBeenCalled();
    await act(async () => request.onProgress?.(result({ complete: false, scanned: 250 })));

    expect(lookupSignal?.aborted).toBe(true); expect(location.pathname).toBe(alias);
    expect(history.state).toEqual({ quorumThread: true, quorumBackground: background });
    expect(thread().querySelector('.cast-link-lookup')).toBeNull();
    expect(thread().querySelector('.conversation-replies')?.textContent).toContain(reply.text);
    expect(getConversation).toHaveBeenCalledTimes(1);
    await traverse('back');
    expect(location.pathname + location.search).toBe(background); expect(thread()).toBeUndefined();
    const later = { ...cast('e', 20, 'A late collision must not replace the opened cast'), hash: `0xbbbbbbbb${'e'.repeat(32)}` };
    await act(async () => {
      request.onProgress?.(result({ candidates: [otherCast, later], complete: false, scanned: 500 }));
      pending.resolve(result({ candidates: [otherCast, later], complete: true, scanned: 1000 }));
    });
    expect(location.pathname + location.search).toBe(background); expect(thread()).toBeUndefined();
    await traverse('forward');
    expect(location.pathname).toBe(alias); expect(thread().querySelector('.cast-link-lookup')).toBeNull();
    expect(thread().querySelector('.conversation-replies')?.textContent).toContain(reply.text);
    expect(thread().textContent).not.toContain(later.text);
    expect(resolveCastAlias).toHaveBeenCalledTimes(1); expect(getConversation).toHaveBeenCalledTimes(2);
    await click(thread().querySelector('button[aria-label="Back"]')!); await settleNavigation();
    expect(location.pathname + location.search).toBe(background); expect(thread()).toBeUndefined();
  });

  it('keeps cumulative ambiguous candidates scoped to the author and requires choosing an exact full hash', async () => {
    const second = { ...cast('c', 20, 'Another matching full cast'), hash: `0xbbbbbbbb${'c'.repeat(32)}` };
    const third = { ...cast('d', 20, 'A later matching full cast'), hash: `0xbbbbbbbb${'d'.repeat(32)}` };
    const next = { ...continuation, hashes: [otherCast.hash, second.hash] };
    vi.mocked(resolveCastAlias).mockResolvedValueOnce(result({ candidates: [otherCast, second], complete: false, continuation: next, scanned: 1000 })).mockResolvedValueOnce(result({ candidates: [otherCast, second, third], complete: true, scanned: 2000 }));
    vi.mocked(getConversation).mockImplementation(async hash => ({ cast: hash === third.hash ? third : otherCast, replies: [] }));
    await start(alias); await click(button('Search older casts', thread()));
    expect(vi.mocked(resolveCastAlias).mock.calls[1][0].continuation).toBe(next); expect(location.pathname).toBe(alias); expect(getConversation).not.toHaveBeenCalled();
    expect(thread().textContent).toContain('More than one cast matches'); expect(thread().querySelectorAll('.cast-link-lookup__candidate')).toHaveLength(3);
    await click(thread().querySelector(`.cast-link-lookup__candidate > a[href="${castPermalink(third, { fullHash: true })}"]`)!);
    expect(location.pathname).toBe(castPermalink(third, { fullHash: true })); expect(thread().textContent).toContain(third.text);
  });

  it.each(['.cast__text', 'a.cast-permalink'])('keeps the exact choice when an ambiguous candidate is opened through %s', async selector => {
    const second = { ...cast('c', 20, 'The explicitly chosen matching cast'), hash: `0xbbbbbbbb${'c'.repeat(32)}` };
    vi.mocked(resolveCastAlias).mockResolvedValue(result({ candidates: [otherCast, second] }));
    vi.mocked(getConversation).mockResolvedValue({ cast: second, replies: [] });
    await start(alias);
    expect(thread().querySelectorAll('.cast-link-lookup__candidate')).toHaveLength(2);
    const candidate = thread().querySelectorAll('.cast-link-lookup__candidate')[1];
    expect(candidate.querySelector('a.cast-permalink')?.getAttribute('href')).toBe(castPermalink(second, { fullHash: true }));
    await click(candidate.querySelector(selector)!);
    expect(location.pathname).toBe(castPermalink(second, { fullHash: true }));
    expect(thread().textContent).toContain(second.text); expect(thread().textContent).not.toContain(otherCast.text);
    expect(getConversation).toHaveBeenCalledWith(second.hash, expect.any(AbortSignal));
    expect(resolveCastAlias).toHaveBeenCalledTimes(1);
  });

  it('aborts an alias on Back, ignores its late result and preserves its URL and search background through Forward', async () => {
    const pendingAlias = deferred<CastAliasResult>(); vi.mocked(resolveCastAlias).mockReturnValueOnce(pendingAlias.promise);
    const background = '/search?q=cosmos&type=users'; history.replaceState(null, '', background); history.pushState({ quorumThread: true, quorumBackground: background }, '', alias);
    await act(async () => root.render(<App />)); const signal = vi.mocked(resolveCastAlias).mock.calls[0][0].signal!;
    await traverse('back'); expect(signal.aborted).toBe(true); expect(location.pathname + location.search).toBe(background);
    await act(async () => pendingAlias.resolve(result())); expect(location.pathname + location.search).toBe(background); expect(thread()).toBeUndefined();
    await traverse('forward'); expect(location.pathname).toBe(alias); expect(history.state).toEqual({ quorumThread: true, quorumBackground: background });
    await traverse('back'); expect(location.pathname + location.search).toBe(background);
    await traverse('forward'); expect(location.pathname).toBe(alias); expect(resolveCastAlias).toHaveBeenCalledTimes(2);
    await click(thread().querySelector('button[aria-label="Back"]')!); await settleNavigation(); expect(location.pathname + location.search).toBe(background);
  });

  it('returns from sign-in to a still-unresolved alias and its explicit quote without changing account permissions', async () => {
    const second = { ...cast('c', 20, 'Another possible cast'), hash: `0xbbbbbbbb${'c'.repeat(32)}` };
    vi.mocked(resolveCastAlias).mockResolvedValue(result({ candidates: [otherCast, second], complete: false, continuation, scanned: 1000 }));
    await start(alias); await openQuote(thread()); await click(button('Quote', dialog('Quote cast')));
    expect(location.pathname).toBe('/connect'); expect(history.state.quorumConnectReturn).toBe(alias);
    expect(container.querySelector('[data-testid="requested-scopes"]')?.textContent).toBe('posting'); expect(wallet.initialFid).toBeUndefined();
    await click(button('Cancel synthetic wallet')); await settleNavigation();
    expect(location.pathname).toBe(alias); expect(dialog('Quote cast')).toBeDefined(); expect(dialog('Quote cast').textContent).toContain(otherCast.text);
    await click(dialog('Quote cast').querySelector('button[aria-label="Close dialog"]')!); await click(thread().querySelector('button[aria-label="Back"]')!);
    expect(location.pathname).toBe('/'); expect(wallet.next).toBeNull();
  });

  it('keeps an exhausted no-match result on its original link with an honest node-history message', async () => {
    vi.mocked(resolveCastAlias).mockResolvedValue(result({ candidates: [], complete: true, scanned: 250 }));
    await start(alias);
    expect(location.pathname).toBe(alias); expect(thread().textContent).toContain('No cast matched this link in the available history returned by this Hypersnap node.'); expect(getConversation).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'full hash', returned: { ...otherCast, hash: ownCast.hash, text: 'Unrelated conversation must stay hidden' } },
    { label: 'author FID', returned: { ...otherCast, author: person(99), text: 'Unrelated conversation must stay hidden' } },
  ])('rejects a conversation response whose $label differs from the verified alias cast', async ({ returned }) => {
    vi.mocked(getConversation).mockResolvedValue({ cast: returned, replies: [] });
    await start(alias);
    expect(location.pathname).toBe(alias); expect(thread().querySelector('[role="alert"]')?.textContent).toContain('different conversation');
    expect(thread().textContent).not.toContain(returned.text); expect(thread().querySelector('.composer')).toBeNull();
  });
});

describe('known-cast author/hash navigation', () => {
  it('opens a known feed cast at its short URL and reuses the verified association through Back and Forward', async () => {
    vi.mocked(getFeed).mockResolvedValue({ casts: [otherCast], next: {} });
    await start();
    expect(container.querySelector('main .feed a[aria-label="Open cast"]')?.getAttribute('href')).toBe(castPermalink(otherCast));
    await click(container.querySelector('main .feed .cast__text')!);
    expect(location.pathname).toBe(castPermalink(otherCast));
    expect(thread().textContent).toContain(otherCast.text);
    expect(resolveCastAlias).not.toHaveBeenCalled();
    expect(getConversation).toHaveBeenCalledTimes(1);
    expect(history.state).toEqual({ quorumThread: true, quorumBackground: '/' });
    await traverse('back');
    expect(location.pathname).toBe('/'); expect(thread()).toBeUndefined();
    await traverse('forward');
    expect(location.pathname).toBe(castPermalink(otherCast)); expect(thread().textContent).toContain(otherCast.text);
    expect(getConversation).toHaveBeenCalledTimes(2); expect(resolveCastAlias).not.toHaveBeenCalled();
    await click(thread().querySelector('button[aria-label="Back"]')!); await settleNavigation();
    expect(location.pathname).toBe('/'); expect(thread()).toBeUndefined();
  });

  it('uses a full author/hash path when another known cast already owns the generated short prefix', async () => {
    const first = { ...otherCast, hash: `0xcafebabe${'a'.repeat(32)}`, text: 'First known cast with this prefix' };
    const second = { ...otherCast, hash: `0xcafebabe${'b'.repeat(32)}`, text: 'Second known cast with this prefix' };
    vi.mocked(getFeed).mockResolvedValue({ casts: [first, second], next: {} });
    vi.mocked(getConversation).mockImplementation(async hash => ({ cast: hash === first.hash ? first : second, replies: [] }));
    await start(); await click(container.querySelectorAll('main .feed .cast__text')[0]);
    expect(location.pathname).toBe(castPermalink(first)); expect(thread().textContent).toContain(first.text);
    await traverse('back'); await click(container.querySelectorAll('main .feed .cast__text')[1]);
    expect(location.pathname).toBe(castPermalink(second, { fullHash: true }));
    expect(thread().textContent).toContain(second.text); expect(thread().textContent).not.toContain(first.text);
    expect(thread().querySelector('a.cast-permalink')?.getAttribute('href')).toBe(castPermalink(second, { fullHash: true }));
    await click(thread().querySelector('button[aria-label="Share cast"]')!);
    expect(dialog('Share cast').querySelector<HTMLInputElement>('input')?.value).toBe(`https://opencaster.org${castPermalink(second, { fullHash: true })}`);
    await click(dialog('Share cast').querySelector('button[aria-label="Close dialog"]')!);
    expect(getConversation).toHaveBeenLastCalledWith(second.hash, expect.any(AbortSignal));
    expect(resolveCastAlias).not.toHaveBeenCalled();
    await traverse('back'); await traverse('forward');
    expect(location.pathname).toBe(castPermalink(second, { fullHash: true })); expect(thread().textContent).toContain(second.text);
    await traverse('back'); await click(container.querySelectorAll('main .feed .cast__text')[0]);
    expect(location.pathname).toBe(castPermalink(first)); expect(thread().textContent).toContain(first.text);
    expect(thread().textContent).not.toContain(second.text); expect(resolveCastAlias).not.toHaveBeenCalled();
  });

  it('retains an API-verified alternate author alias and its association after leaving and returning', async () => {
    const path = '/former-name/0xbbbbbbbb';
    await start(path);
    expect(location.pathname).toBe(path); expect(thread().textContent).toContain(otherCast.text);
    expect(resolveCastAlias).toHaveBeenCalledWith(expect.objectContaining({ authorIdentifier: 'former-name' }));
    await click(thread().querySelector('.cast__header .author')!);
    expect(location.pathname).toBe('/profile/20');
    await traverse('back');
    expect(location.pathname).toBe(path); expect(thread().textContent).toContain(otherCast.text);
    expect(resolveCastAlias).toHaveBeenCalledTimes(1);
    expect(getConversation).toHaveBeenCalledTimes(2);
  });

  it('accepts pending replies after moving between two verified URLs for the same cast', async () => {
    const fullPath = castPermalink(otherCast, { fullHash: true });
    const source = { ...otherCast, text: `This cast also opens at https://farcaster.xyz${fullPath}` };
    const reply = cast('d', 30, 'Replies belong to the same verified cast');
    vi.mocked(getFeed).mockResolvedValue({ casts: [source], next: {} });
    vi.mocked(getConversation).mockResolvedValue({ cast: source, replies: [] });
    await start(); await click(container.querySelector('main .feed .cast__text')!);
    await click(thread().querySelector(`.cast__text a[href="${fullPath}"]`)!);
    expect(location.pathname).toBe(fullPath); expect(resolveCastAlias).toHaveBeenCalledTimes(1);
    expect(getConversation).toHaveBeenCalledTimes(2);
    await click(button('Discover', container.querySelector('nav[aria-label="Main navigation"]')!));
    const pending = deferred<Awaited<ReturnType<typeof getConversation>>>();
    vi.mocked(getConversation).mockReturnValueOnce(pending.promise);
    await click(container.querySelector('main .feed .cast__text')!);
    expect(location.pathname).toBe(castPermalink(source));
    const requestCount = vi.mocked(getConversation).mock.calls.length;
    await click(thread().querySelector(`.cast__text a[href="${fullPath}"]`)!);
    expect(location.pathname).toBe(fullPath); expect(resolveCastAlias).toHaveBeenCalledTimes(1);
    expect(getConversation).toHaveBeenCalledTimes(requestCount);
    await act(async () => pending.resolve({ cast: source, replies: [{ cast: reply, replies: [] }] }));
    expect(thread().querySelector('.conversation-replies')?.textContent).toContain(reply.text);
    expect(thread().textContent).not.toContain('Loading conversation…');
  });

  it('ignores a late reply tree after a different linked conversation has opened', async () => {
    const target = { ...otherCast, author: person(30), hash: `0xdeadbeef${'e'.repeat(32)}`, text: 'The new conversation' };
    const source = { ...ownCast, text: `Read https://farcaster.xyz${castPermalink(target)}` };
    const staleReply = cast('d', 40, 'Late replies from the previous conversation');
    const targetReply = cast('f', 50, 'Replies for the new conversation');
    const pending = deferred<Awaited<ReturnType<typeof getConversation>>>();
    vi.mocked(getFeed).mockResolvedValue({ casts: [source], next: {} });
    vi.mocked(getConversation).mockImplementation(hash => hash === source.hash ? pending.promise : Promise.resolve({ cast: target, replies: [{ cast: targetReply, replies: [] }] }));
    vi.mocked(resolveCastAlias).mockResolvedValue({ author: target.author, candidates: [target], complete: true, scanned: 1 });
    await start(); await click(container.querySelector('main .feed .cast__text')!);
    const signal = vi.mocked(getConversation).mock.calls[0][1]!;
    expect(thread().textContent).toContain(source.text);
    await click(thread().querySelector('.cast__text a')!);
    expect(location.pathname).toBe(castPermalink(target)); expect(signal.aborted).toBe(true);
    expect(thread().querySelector('.conversation-replies')?.textContent).toContain(targetReply.text);
    await act(async () => pending.resolve({ cast: source, replies: [{ cast: staleReply, replies: [] }] }));
    expect(location.pathname).toBe(castPermalink(target)); expect(thread().textContent).toContain(target.text);
    expect(thread().querySelector('.conversation-replies')?.textContent).toContain(targetReply.text);
    expect(thread().textContent).not.toContain(staleReply.text); expect(thread().querySelector('[role="alert"]')).toBeNull();
  });
});

describe('isolated App feature integration', () => {
  it.each([
    ['sidebar', '.sidebar__bottom button.full-width'],
    ['join card', '.join-card button'],
    ['mobile account', 'nav[aria-label="Mobile navigation"] button[aria-label="Account"]'],
    ['header', '.mobile-connect'],
  ])('opens the dedicated sign-in page from the %s without a modal or background feed', async (_label, selector) => {
    await start();
    const feedSignal = vi.mocked(getFeed).mock.calls[0][0].signal;
    const channelSignal = vi.mocked(getChannels).mock.calls[0][0].signal;
    vi.mocked(getFeed).mockClear(); vi.mocked(getChannels).mockClear(); vi.mocked(getInfo).mockClear();
    await click(container.querySelector(selector)!);
    expect(location.pathname + location.search).toBe('/connect');
    expect(container.querySelector('[data-testid="synthetic-wallet"]')?.getAttribute('data-presentation')).toBe('page');
    expect(container.querySelector('dialog')).toBeNull(); expect(container.querySelector('.app')).toBeNull(); expect(container.querySelector('.rightbar')).toBeNull();
    expect(feedSignal?.aborted).toBe(true); expect(channelSignal?.aborted).toBe(true);
    expect(getFeed).not.toHaveBeenCalled(); expect(getChannels).not.toHaveBeenCalled(); expect(getInfo).not.toHaveBeenCalled();
  });

  it('loads sign-in directly with baseline permissions and ignores forged redirect, identity and scope state', async () => {
    history.replaceState({ quorumConnectReturn: 'https://example.org/steal', quorumConnectBackground: '//example.org', scopes: FULL_CLIENT_SCOPES, initialFid: 999 }, '', '/connect?fid=999&scopes=1,2,11&return=https://example.org');
    await act(async () => root.render(<App />));
    expect(location.pathname + location.search).toBe('/connect');
    expect(container.querySelector('[data-testid="requested-scopes"]')?.textContent).toBe('posting'); expect(wallet.initialFid).toBeUndefined();
    expect(getFeed).not.toHaveBeenCalled(); expect(getChannels).not.toHaveBeenCalled(); expect(getInfo).not.toHaveBeenCalled(); expect(getUser).not.toHaveBeenCalled();
    await click(button('Cancel synthetic wallet')); expect(location.pathname).toBe('/');
  });

  it('keeps only a validated return route after a reload and does not restore an upgrade from history', async () => {
    history.replaceState({ quorumConnectReturn: '/search?q=cosmos&type=users', quorumConnectBackground: '/', scopes: FULL_CLIENT_SCOPES, initialFid: 999 }, '', '/connect');
    await act(async () => root.render(<App />));
    expect(container.querySelector('[data-testid="requested-scopes"]')?.textContent).toBe('posting'); expect(wallet.initialFid).toBeUndefined();
    await click(button('Cancel synthetic wallet'));
    expect(location.pathname + location.search).toBe('/search?q=cosmos&type=users');
  });

  it('aborts onboarding on browser Back, rejects its late session and drops upgrade context on Forward', async () => {
    vi.mocked(getFeed).mockResolvedValue({ casts: [ownCast], next: {} });
    await start(); const legacy = session(FULL_SOCIAL_SCOPES); await connect(legacy);
    await click(container.querySelector('button[aria-label="Delete cast"]')!); await click(button('Enable deletion', dialog('Delete cast')));
    const pendingSignal = wallet.signal; const staleConnect = wallet.onConnect!;
    expect(location.pathname).toBe('/connect'); expect(dialog('Delete cast')).toBeUndefined();
    expect(container.querySelector('[data-testid="requested-scopes"]')?.textContent).toBe(FULL_CLIENT_SCOPES.join(',')); expect(wallet.initialFid).toBe(10);
    await traverse('back'); expect(pendingSignal?.aborted).toBe(true); expect(dialog('Delete cast')).toBeDefined(); expect(legacy.dispose).not.toHaveBeenCalled();
    const late = session(FULL_CLIENT_SCOPES, '3'); await act(async () => staleConnect(late));
    expect(late.dispose).toHaveBeenCalledOnce(); expect(legacy.dispose).not.toHaveBeenCalled(); expect(legacy.deleteCast).not.toHaveBeenCalled();
    await traverse('forward'); expect(location.pathname).toBe('/connect');
    expect(container.querySelector('[data-testid="requested-scopes"]')?.textContent).toBe('posting'); expect(wallet.initialFid).toBeUndefined();
    await act(async () => staleConnect(late)); expect(legacy.dispose).not.toHaveBeenCalled();
    await click(button('Cancel synthetic wallet')); expect(location.pathname).toBe('/'); expect(container.textContent).toContain('Person 10');
  });

  it('returns from sign-in to the original conversation and closes it back to its search background', async () => {
    await start('/search?q=cosmos'); await click(container.querySelector('main a[aria-label="Open cast"]')!);
    await click(button('Sign in', thread()));
    expect(location.pathname).toBe('/connect'); expect(container.querySelector('dialog')).toBeNull();
    await click(button('Cancel synthetic wallet')); await settleNavigation();
    expect(thread()).toBeDefined(); expect(location.pathname).toBe(castPermalink(otherCast));
    await click(thread().querySelector('button[aria-label="Back"]')!); await settleNavigation();
    expect(location.pathname + location.search).toBe('/search?q=cosmos'); expect(thread()).toBeUndefined();
  });

  it('rejects a different account during a scoped upgrade and preserves the original device on cancel', async () => {
    vi.mocked(getFeed).mockResolvedValue({ casts: [ownCast], next: {} });
    await start(); const legacy = session(FULL_SOCIAL_SCOPES); await connect(legacy);
    await click(container.querySelector('button[aria-label="Delete cast"]')!); await click(button('Enable deletion', dialog('Delete cast')));
    const different = { ...session(FULL_CLIENT_SCOPES, '4'), fid: 20, user: person(20) }; wallet.next = different;
    await click(button('Approve synthetic wallet'));
    expect(location.pathname).toBe('/connect'); expect(container.querySelector('[role="alert"]')?.textContent).toContain('Reconnect the current account');
    expect(different.dispose).toHaveBeenCalledOnce(); expect(legacy.dispose).not.toHaveBeenCalled();
    await click(button('Cancel synthetic wallet')); await settleNavigation();
    expect(dialog('Delete cast')).toBeDefined(); expect(container.textContent).toContain('Person 10'); expect(legacy.deleteCast).not.toHaveBeenCalled();
  });

  it('resumes explicit profile editing after a successful same-account permission upgrade', async () => {
    await start('/profile/10'); const legacy = session([1, 3, 4]); await connect(legacy);
    await click(button('Enable profile editing')); expect(location.pathname).toBe('/connect');
    const upgradedBase = session(FULL_SOCIAL_SCOPES, '5'); const upgraded = { ...upgradedBase, user: { ...upgradedBase.user, username: 'fid:10' } }; wallet.next = upgraded;
    await click(button('Approve synthetic wallet')); await settleNavigation();
    expect(location.pathname).toBe('/profile/10'); expect(dialog('Edit profile')).toBeDefined(); expect(legacy.dispose).toHaveBeenCalledOnce(); expect(upgraded.updateProfile).not.toHaveBeenCalled();
    expect(container.querySelector('.toast')?.textContent).toContain('You’re connected to Hypersnap.'); expect(container.querySelector('.toast')?.textContent).not.toContain('@fid:');
  });

  it('keeps confirmed profile metadata and the current feed when the same signing session receives a display update', async () => {
    vi.mocked(getProfileFeed).mockResolvedValue({ casts: [ownCast], next: {} });
    await start('/profile/10'); const connected = session(FULL_CLIENT_SCOPES); await connect(connected);
    vi.mocked(connected.updateProfile).mockResolvedValue({ saved: ['displayName'] });
    const userReads = vi.mocked(getUser).mock.calls.length;
    const feedReads = vi.mocked(getProfileFeed).mock.calls.length;
    const reactionReads = vi.mocked(getReactionStatus).mock.calls.length;
    await click(button('Edit profile'));
    const editor = dialog('Edit profile');
    const name = editor.querySelector<HTMLInputElement>('input[type="text"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Confirmed local name');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('Save changes', editor));
    expect(connected.updateProfile).toHaveBeenCalledExactlyOnceWith({ displayName: 'Confirmed local name' });
    expect(container.querySelector('.profile h2')?.textContent).toBe('Confirmed local name');
    expect(container.textContent).toContain(ownCast.text); expect(button('Save changes', editor).disabled).toBe(true);
    expect(getUser).toHaveBeenCalledTimes(userReads); expect(getProfileFeed).toHaveBeenCalledTimes(feedReads); expect(getReactionStatus).toHaveBeenCalledTimes(reactionReads);
    expect(connected.dispose).not.toHaveBeenCalled();
  });

  it('preserves query and result kind through profile navigation and Back/Forward', async () => {
    await start('/search?q=person&type=users');
    expect((container.querySelector('main input[type="search"]') as HTMLInputElement).value).toBe('person');
    await click(container.querySelector('main a[href="/profile/42"]')!);
    expect(location.pathname).toBe('/profile/42');
    await traverse('back');
    expect(location.pathname + location.search).toBe('/search?q=person&type=users');
    expect(container.querySelector('a[aria-current="page"]')?.textContent).toBe('People');
    expect((container.querySelector('main input[type="search"]') as HTMLInputElement).value).toBe('person');
    await traverse('forward'); expect(location.pathname).toBe('/profile/42');
  });

  it('keeps search query in conversation background history and restores it when the thread closes', async () => {
    await start('/search?q=cosmos');
    await click(container.querySelector('main a[aria-label="Open cast"]')!);
    expect(history.state.quorumBackground).toBe('/search?q=cosmos');
    expect(thread()).toBeDefined();
    await traverse('back');
    expect(location.pathname + location.search).toBe('/search?q=cosmos');
    expect(thread()).toBeUndefined();
    await traverse('forward'); expect(thread()).toBeDefined();
    await click(thread().querySelector('button[aria-label="Back"]')!);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(location.pathname + location.search).toBe('/search?q=cosmos');
  });

  it('cancels an old profile tab request and ignores a delayed response after switching to Photos', async () => {
    const replies = deferred<{ casts: Cast[]; next: {} }>();
    const photos = deferred<{ casts: Cast[]; next: {} }>();
    vi.mocked(getProfileFeed).mockImplementation(options => options.tab === 'replies' ? replies.promise : photos.promise);
    await start('/profile/10?tab=replies');
    const first = vi.mocked(getProfileFeed).mock.calls.find(([options]) => options.tab === 'replies')![0];
    await click(container.querySelector('nav[aria-label="Profile content"] a[href="/profile/10?tab=media"]')!);
    expect(first.signal?.aborted).toBe(true); expect(location.search).toBe('?tab=media');
    await act(async () => photos.resolve({ casts: [cast('c', 10, 'Current photo result')], next: {} }));
    await act(async () => replies.resolve({ casts: [cast('d', 10, 'Stale reply result')], next: {} }));
    expect(container.textContent).toContain('Current photo result'); expect(container.textContent).not.toContain('Stale reply result');
  });

  it('cancels profile pagination after changing tabs and suppresses a late error from the old page', async () => {
    const next = deferred<{ casts: Cast[]; next: {} }>();
    vi.mocked(getProfileFeed).mockImplementation(options => options.tab === 'media'
      ? Promise.resolve({ casts: [cast('e', 10, 'New photo tab')], next: {} })
      : options.cursor ? next.promise : Promise.resolve({ casts: [cast('d', 10, 'Existing reply')], next: { cursor: 'next-replies' } }));
    await start('/profile/10?tab=replies');
    await reachFeedEnd();
    const oldPage = vi.mocked(getProfileFeed).mock.calls.find(([options]) => options.cursor === 'next-replies')![0];
    await click(container.querySelector('nav[aria-label="Profile content"] a[href="/profile/10?tab=media"]')!);
    expect(oldPage.signal?.aborted).toBe(true);
    await act(async () => next.reject(new Error('Old reply page failed after navigation')));
    expect(container.textContent).toContain('New photo tab');
    expect(container.textContent).not.toContain('Old reply page failed after navigation');
  });

  it('passes the channel record’s actual parent URL into the signed cast options', async () => {
    const channel = { id: 'isolated', name: 'Isolated channel', url: 'https://example.com/channel/alias', parent_url: 'https://example.com/real-namespace/isolated', member_count: 2 };
    vi.mocked(getChannel).mockResolvedValue(channel);
    await start('/channel/isolated'); const connected = session(FULL_CLIENT_SCOPES); await connect(connected);
    const field = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Write a cast"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(field, 'An isolated channel cast'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    await click(button('Cast', container.querySelector('main')!));
    expect(connected.cast).toHaveBeenCalledWith('An isolated channel cast', undefined, expect.objectContaining({ parentUrl: channel.parent_url }));
  });

  it('keeps the compact composer’s explicitly saved drafts separate when navigating between home and a channel', async () => {
    const channel = { id: 'isolated', name: 'Isolated channel', url: 'https://example.com/channel/alias', parent_url: 'https://example.com/real-namespace/isolated' };
    vi.mocked(getChannels).mockResolvedValue({ channels: [channel], next: {} });
    vi.mocked(getChannel).mockResolvedValue(channel);
    await start(); const connected = session(FULL_CLIENT_SCOPES); await connect(connected);
    const main = container.querySelector('main')!;
    const editor = () => main.querySelector<HTMLTextAreaElement>('textarea[aria-label="Write a cast"]')!;
    const edit = async (text: string) => {
      const field = editor(); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      await act(async () => { setter.call(field, text); field.dispatchEvent(new Event('input', { bubbles: true })); });
    };
    const openDrafts = () => click(main.querySelector('button[aria-label="Drafts"]')!);
    const openChannel = () => click(button('Isolated channel', container.querySelector('nav[aria-label="Channels"]')!));

    expect(main.querySelectorAll('textarea')).toHaveLength(1);
    const tools = main.querySelector('[role="group"][aria-label="Composer tools"]'); expect(tools).not.toBeNull();
    for (const label of ['Add image', 'Mention a person', 'Insert emoji', 'Drafts']) expect(tools!.querySelectorAll(`button[aria-label="${label}"]`)).toHaveLength(1);
    expect(main.querySelector('input[aria-label="Mention a username or FID"]')).toBeNull();
    expect(button('Save draft', main)).toBeUndefined();
    await edit('An explicitly saved home draft'); await openDrafts(); await click(button('Save draft', main));

    await openChannel(); expect(location.pathname).toBe('/channel/isolated');
    expect(main.querySelectorAll('textarea')).toHaveLength(1); expect(editor().value).toBe('');
    expect(main.textContent).toContain('Public channel cast');
    await edit('An explicitly saved channel draft'); await openDrafts(); expect(button('Restore saved draft', main)).toBeUndefined();
    await click(button('Save draft', main));

    await click(button('Discover', container.querySelector('nav[aria-label="Main navigation"]')!));
    expect(editor().value).toBe(''); await openDrafts(); await click(button('Restore saved draft', main));
    expect(editor().value).toBe('An explicitly saved home draft');
    await openChannel(); expect(editor().value).toBe(''); await openDrafts(); await click(button('Restore saved draft', main));
    expect(editor().value).toBe('An explicitly saved channel draft');
    expect(connected.cast).not.toHaveBeenCalled(); expect(uploadMedia).not.toHaveBeenCalled();
  });

  it('reserves one of the two embed slots for a quote and allows only one attached image', async () => {
    vi.mocked(getFeed).mockResolvedValue({ casts: [otherCast], next: {} });
    const connected = session(FULL_CLIENT_SCOPES);
    vi.mocked(uploadMedia).mockResolvedValue({ url: `https://opencaster.org/media/${'e'.repeat(64)}` });
    await start(); await connect(connected);
    await openQuote();
    const quote = dialog('Quote cast');
    expect(connected.cast).not.toHaveBeenCalled();
    const field = quote.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(field, 'files', { configurable: true, value: [new File([new Uint8Array([1, 2, 3])], 'isolated.png', { type: 'image/png' })] });
    await act(async () => { field.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(quote.querySelector<HTMLButtonElement>('button[aria-label="Add image"]')?.disabled).toBe(true); expect(quote.textContent).toContain('1/1 images');
    await click(button('Quote', quote));
    expect(connected.cast).toHaveBeenCalledWith('', undefined, expect.objectContaining({ embeds: [{ url: `https://opencaster.org/media/${'e'.repeat(64)}` }, { castId: { fid: otherCast.author.fid, hash: otherCast.hash } }] }));
    expect(dialog('Quote cast')).toBeUndefined();
  });

  it('keeps a newer quote draft open when a previously closed quote receives its late posting receipt', async () => {
    const secondCast = cast('f', 30, 'Another isolated cast to quote');
    const receipt = deferred<{ hash: string }>();
    vi.mocked(getFeed).mockResolvedValue({ casts: [otherCast, secondCast], next: {} });
    const connected = session(FULL_CLIENT_SCOPES);
    vi.mocked(connected.cast).mockReturnValueOnce(receipt.promise);
    await start(); await connect(connected);
    await openQuote(container.querySelector('main')!, 0);
    await click(button('Quote', dialog('Quote cast')));
    expect(connected.cast).toHaveBeenCalledOnce();
    await click(dialog('Quote cast').querySelector('button[aria-label="Close dialog"]')!);
    await openQuote(container.querySelector('main')!, 1);
    const newer = dialog('Quote cast');
    expect(newer.textContent).toContain(secondCast.text);
    const field = newer.querySelector<HTMLTextAreaElement>('textarea[aria-label="Write a quote"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(field, 'Keep this newer quote draft'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => receipt.resolve({ hash: `0x${'e'.repeat(40)}` }));
    expect(dialog('Quote cast')).toBeDefined();
    expect(dialog('Quote cast').textContent).toContain(secondCast.text);
    expect(dialog('Quote cast').querySelector('textarea')?.value).toBe('Keep this newer quote draft');
    expect(connected.cast).toHaveBeenCalledOnce();
  });

  it('merges channel pages chronologically, deduplicates normalized hashes and preserves trending ranking', async () => {
    const channel = { id: 'isolated', name: 'Isolated channel', url: 'https://example.com/channel/isolated' };
    vi.mocked(getChannel).mockResolvedValue(channel);
    const item = (letter: string, time: number) => ({ ...cast(letter, 20, `Channel time ${time}`), timestamp: new Date(1_000_000 + time * 1_000).toISOString() });
    const hundred = item('a', 100); const ninety = item('b', 90); const forty = item('c', 40); const thirty = item('d', 30);
    const eighty = item('e', 80); const seventy = item('f', 70);
    vi.mocked(getFeed).mockImplementation(async options => options.kind === 'channel'
      ? options.cursor ? { casts: [{ ...hundred, hash: 'A'.repeat(40) }, eighty, seventy], next: {} } : { casts: [hundred, ninety, forty, thirty], next: { cursor: 'channel-next' } }
      : { casts: [thirty, hundred], next: {} });
    await start('/channel/isolated');
    await reachFeedEnd();
    const texts = () => [...container.querySelectorAll('main .feed .cast__text')].map(element => element.textContent);
    expect(texts()).toEqual([100, 90, 80, 70, 40, 30].map(time => `Channel time ${time}`));
    await click(button('Discover'));
    expect(texts()).toEqual(['Channel time 30', 'Channel time 100']);
  });

  it('offers deletion only for the connected account and requires a separate confirmation after permission approval', async () => {
    vi.mocked(getFeed).mockResolvedValue({ casts: [ownCast, otherCast], next: {} });
    await start(); const legacy = session(FULL_SOCIAL_SCOPES); await connect(legacy);
    expect(container.querySelectorAll('button[aria-label="Delete cast"]')).toHaveLength(1);
    await click(container.querySelector('button[aria-label="Delete cast"]')!);
    expect(dialog('Delete cast').textContent).toContain(ownCast.text);
    expect(legacy.deleteCast).not.toHaveBeenCalled();
    await click(button('Enable deletion', dialog('Delete cast')));
    expect(container.querySelector('[data-testid="requested-scopes"]')?.textContent).toBe(FULL_CLIENT_SCOPES.join(','));
    const upgraded = session(FULL_CLIENT_SCOPES, '2'); wallet.next = upgraded;
    await click(button('Approve synthetic wallet')); await settleNavigation();
    expect(upgraded.deleteCast).not.toHaveBeenCalled();
    expect(legacy.deleteCast).not.toHaveBeenCalled();
    expect(dialog('Delete cast')).toBeDefined();
    await click(dialog('Delete cast').querySelector('.delete-cast-confirm')!);
    expect(upgraded.deleteCast).toHaveBeenCalledOnce();
    expect(upgraded.deleteCast).toHaveBeenCalledWith({ fid: ownCast.author.fid, hash: ownCast.hash });
    expect(dialog('Delete cast')).toBeUndefined();
  });

  it('keeps the existing device connected when a deletion permission review is cancelled', async () => {
    vi.mocked(getFeed).mockResolvedValue({ casts: [ownCast], next: {} });
    await start(); const legacy = session(FULL_SOCIAL_SCOPES); await connect(legacy);
    await click(container.querySelector('button[aria-label="Delete cast"]')!);
    await click(button('Enable deletion', dialog('Delete cast')));
    await click(button('Cancel synthetic wallet')); await settleNavigation();
    expect(button('Enable deletion', dialog('Delete cast'))).toBeDefined();
    expect(legacy.dispose).not.toHaveBeenCalled();
    expect(legacy.deleteCast).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Person 10');
  });

  it('opens image attachments in the viewer and preserves modified-click links', async () => {
    const photo = { ...otherCast, embeds: [{ url: 'https://example.org/a.png' }, { url: 'https://example.org/b.png' }] };
    vi.mocked(getFeed).mockResolvedValue({ casts: [photo], next: {} });
    await start();
    await click(container.querySelector('a[aria-label="View attached image"]')!);
    expect(dialog('Cast images').querySelector('img')?.src).toBe('https://example.org/a.png');
    await click(dialog('Cast images').querySelector('button[aria-label="Next image"]')!);
    expect(dialog('Cast images').querySelector('img')?.src).toBe('https://example.org/b.png');
    await click(dialog('Cast images').querySelector('button[aria-label="Close dialog"]')!);
    expect(container.querySelector('a[aria-label="View attached image"]')?.getAttribute('target')).toBe('_blank');
    expect(dialog('Cast images')).toBeUndefined();
  });

  it('saves a channel shortcut in the sidebar and restores it after remount without a protocol write', async () => {
    const channel = { id: 'isolated', name: 'Isolated channel', url: 'https://example.org/channels/isolated' };
    vi.mocked(getChannel).mockResolvedValue(channel);
    await start('/channel/isolated');
    await click(button('Save channel'));
    expect(container.querySelector('nav[aria-label="Saved channels"]')?.textContent).toContain('Isolated channel');
    await act(async () => { root.unmount(); }); root = createRoot(container);
    await act(async () => root.render(<App />));
    expect(container.querySelector('nav[aria-label="Saved channels"]')?.textContent).toContain('Isolated channel');
    expect(button('Saved on this browser')).toBeDefined();
  });

  it('shows shareable Likes tabs, profile links and cast text options', async () => {
    vi.mocked(getProfileFeed).mockResolvedValue({ casts: [otherCast], next: {} });
    await start('/profile/10?tab=likes');
    expect(vi.mocked(getProfileFeed).mock.calls.some(([options]) => options.tab === 'likes')).toBe(true);
    expect(container.querySelector('nav[aria-label="Profile content"] a[aria-current="page"]')?.textContent).toBe('Likes');
    await click(button('Share profile'));
    expect(dialog('Share profile').querySelector<HTMLInputElement>('input')?.value).toBe('https://opencaster.org/profile/10');
    await click(dialog('Share profile').querySelector('button[aria-label="Close dialog"]')!);
    await click(container.querySelector('button[aria-label="More cast options"]')!);
    expect(dialog('Cast options').querySelector('textarea')?.value).toBe(otherCast.text);
    await click(button('Quote cast', dialog('Cast options')));
    expect(dialog('Cast options')).toBeUndefined(); expect(dialog('Quote cast')).toBeDefined();
  });

  it('opens actual channel participants and clears the dialog on profile navigation', async () => {
    const channel = { id: 'isolated', name: 'Isolated channel', url: 'https://example.org/channels/isolated' };
    vi.mocked(getChannel).mockResolvedValue(channel);
    await start('/channel/isolated');
    await click(button('View participants'));
    expect(getChannelMembers).toHaveBeenCalledWith('isolated', expect.anything());
    const people = dialog('Participants · /Isolated channel'); expect(people).toBeDefined();
    await click(people.querySelector('a[href="/profile/20"]')!);
    expect(location.pathname).toBe('/profile/20'); expect(dialog('Participants · /Isolated channel')).toBeUndefined();
  });

});

describe('feed-first social layout', () => {
  it('shows guests a connect prompt instead of a home composer and collapses long casts until expanded', async () => {
    const long = cast('d', 20, `Opening line\n${'A long isolated paragraph. '.repeat(30)}`);
    vi.mocked(getFeed).mockResolvedValue({ casts: [long], next: {} });
    await start();
    const main = container.querySelector('main')!;
    expect(main.querySelector('textarea[aria-label="Write a cast"]')).toBeNull(); expect(main.querySelector('.welcome')).toBeNull(); expect(button('Cast', container.querySelector('.sidebar')!)).toBeUndefined();
    expect(main.querySelector('.cast__text--clamp')).not.toBeNull();
    await click(button('Show more', main));
    expect(main.querySelector('.cast__text--clamp')).toBeNull(); expect(button('Show more', main)).toBeUndefined();
  });

  it('opens a new-cast dialog from the sidebar and the mobile action, then closes it after publishing', async () => {
    await start(); const connected = session(FULL_CLIENT_SCOPES); await connect(connected);
    expect(container.querySelector('main textarea[aria-label="Write a cast"]')).not.toBeNull();
    await click(container.querySelector('button[aria-label="Write a new cast"]')!);
    const compose = dialog('New cast'); expect(compose.querySelector('textarea[aria-label="Write a cast"]')).not.toBeNull();
    await click(compose.querySelector('button[aria-label="Close dialog"]')!); expect(dialog('New cast')).toBeUndefined();
    await click(button('Cast', container.querySelector('.sidebar')!));
    const field = dialog('New cast').querySelector<HTMLTextAreaElement>('textarea')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(field, 'A cast from the dialog'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    await click(button('Cast', dialog('New cast')));
    expect(connected.cast).toHaveBeenCalledWith('A cast from the dialog', undefined, expect.anything());
    await settleNavigation(); expect(dialog('New cast')).toBeUndefined();
  });
});

describe('signed-out landing and cast pages', () => {
  it('greets a new visitor at the root with sign-in, then remembers the choice to explore', async () => {
    localStorage.removeItem('opencaster.explore');
    await start();
    expect(container.querySelector('.landing h1')?.textContent).toBe('Your people, your identity, your voice.'); expect(container.querySelector('.app')).toBeNull();
    await click(button('Explore without an account'));
    expect(container.querySelector('.landing')).toBeNull(); expect(container.querySelector('main .feed-heading')).not.toBeNull();
    expect(localStorage.getItem('opencaster.explore')).toBe('1');
  });

  it('opens the sign-in page from the landing and keeps shared links readable without it', async () => {
    localStorage.removeItem('opencaster.explore');
    await start(); await click(button('Sign in'));
    expect(location.pathname).toBe('/connect'); expect(container.querySelector('[data-testid="synthetic-wallet"]')).not.toBeNull();
    await act(async () => root.unmount()); root = createRoot(container);
    await start(`/cast/${otherCast.hash}`);
    expect(container.querySelector('.landing')).toBeNull(); expect(thread()?.textContent).toContain(otherCast.text);
    await click(thread().querySelector('button[aria-label="Back"]')!); await settleNavigation();
    expect(location.pathname).toBe('/'); expect(container.querySelector('.landing')).toBeNull();
  });

  it('opens a cast page from the card body, leaving links and actions alone, and returns to the feed', async () => {
    vi.mocked(getFeed).mockResolvedValue({ casts: [otherCast], next: {} });
    await start();
    const card = container.querySelector<HTMLElement>('main .feed .cast')!;
    await click(card.querySelector('button[aria-label="Bookmark cast"]')!); expect(location.pathname).toBe('/');
    await click(card.querySelector('.cast__text')!);
    expect(location.pathname).toBe(castPermalink(otherCast)); expect(container.querySelector('dialog')).toBeNull();
    expect(thread().textContent).toContain(otherCast.text); expect(container.querySelector<HTMLElement>('.main-base')!.hidden).toBe(true);
    expect(thread().textContent).toContain('Sign in to reply.');
    await click(thread().querySelector('button[aria-label="Back"]')!); await settleNavigation();
    expect(location.pathname).toBe('/'); expect(thread()).toBeUndefined(); expect(container.querySelector<HTMLElement>('.main-base')!.hidden).toBe(false);
  });
});

describe('profile and channel headers', () => {
  it('puts profile actions beside the avatar and returns to Discover from the header arrow', async () => {
    await start('/profile/20'); await settleNavigation();
    const actions = container.querySelector('.profile .profile-top .profile-actions')!;
    expect(button('Share profile', actions)).toBeTruthy(); expect(actions.querySelectorAll('button')).toHaveLength(2);
    expect(container.querySelector('.profile-public-link')).toBeNull(); expect(container.querySelector('main .feed-heading')).toBeNull();
    await click(container.querySelector('header button[aria-label="Back to discover"]')!); await settleNavigation();
    expect(location.pathname).toBe('/');
  });

  it('keeps channel participants in the channel header and goes back to the directory', async () => {
    const channel = { id: 'isolated', name: 'Isolated channel', url: 'https://example.com/channel/alias', parent_url: 'https://example.com/real-namespace/isolated', member_count: 2 };
    vi.mocked(getChannel).mockResolvedValue(channel);
    await start('/channel/isolated'); await settleNavigation();
    expect(button('View participants', container.querySelector('.feature-channel-header')!)).toBeTruthy(); expect(container.querySelector('.channel-detail-actions')).toBeNull();
    await click(container.querySelector('header button[aria-label="Back to channels"]')!); await settleNavigation();
    expect(location.pathname).toBe('/channels');
  });
});

describe('persistent node support links', () => {
  const supportLinks = (scope: ParentNode) => [...scope.querySelectorAll<HTMLAnchorElement>('a')].filter(link => link.textContent === 'Support the node');
  it('keeps a Support the node link in the sidebar and right column after the banner is dismissed', async () => {
    await start(); await click(container.querySelector('button[aria-label="Dismiss node support banner"]')!);
    expect(container.querySelector('.node-support')).toBeNull();
    for (const scope of [container.querySelector('.sidebar-links')!, container.querySelector('.rightbar footer')!]) {
      const [link] = supportLinks(scope);
      expect(link.href).toBe('https://buy.stripe.com/cNi00i9dY4kD3JP7G57ss05'); expect(link.target).toBe('_blank');
      expect(link.rel.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer'])); expect(link.getAttribute('aria-label')).toContain('opens Stripe');
    }
  });

  it('offers the same link in the signed-out landing footer', async () => {
    localStorage.removeItem('opencaster.explore'); await start();
    expect(supportLinks(container.querySelector('.landing__footer')!).map(link => link.href)).toEqual(['https://buy.stripe.com/cNi00i9dY4kD3JP7G57ss05']);
  });
});
