// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { ApiError, getCast, getChannels, getConversation, getFeed, getFollowStatus, getInfo, getProfileFeed, getReactionStatus, getSuggestedUsers, getChannelMembers, getCastQuotes, getUser, resolveCastAlias, searchCasts, searchUsers, type Cast, type FeedResponse, type User } from '@opencaster/client-core/api';
import type { WalletSession } from './lib/auth';
import { FULL_CLIENT_SCOPES } from '@opencaster/client-core/pairing';
import { encodeFeed, type FeedDefinition } from '@opencaster/client-core/customFeeds';
import { readCustomFeed } from './lib/customFeedReader';

const wallet = vi.hoisted(() => ({ next: null as WalletSession | null }));
vi.mock('./components/ConnectAccount', () => ({
  default: ({ onConnect, onClose }: { onConnect(value: WalletSession): void; onClose(): void }) => <main><button onClick={() => { if (wallet.next) onConnect(wallet.next); }}>Approve synthetic wallet</button><button onClick={onClose}>Cancel synthetic wallet</button></main>,
  DeviceSettings: () => <div>Synthetic device settings</div>,
}));
vi.mock('@opencaster/client-core/media', () => ({ uploadMedia: vi.fn() }));
vi.mock('./lib/customFeedReader', () => ({ readCustomFeed: vi.fn() }));
vi.mock('@opencaster/client-core/api', async original => ({ ...await original<typeof import('@opencaster/client-core/api')>(), getCast: vi.fn(), getChannel: vi.fn(), getChannels: vi.fn(), getConversation: vi.fn(), getFeed: vi.fn(), getFollowStatus: vi.fn(), getInfo: vi.fn(), getProfileFeed: vi.fn(), getReactionStatus: vi.fn(), getSuggestedUsers: vi.fn(), getChannelMembers: vi.fn(), getCastQuotes: vi.fn(), getUser: vi.fn(), resolveCastAlias: vi.fn(), searchCasts: vi.fn(), searchUsers: vi.fn() }));

const person = (fid: number): User => ({ fid, username: `person${fid}`, display_name: `Person ${fid}`, custody_address: '0x1111111111111111111111111111111111111111', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 });
const cast = (letter: string, fid: number, text: string): Cast => ({ hash: `0x${letter.repeat(40)}`, author: person(fid), text, timestamp: '2026-10-26T12:00:00.000Z', embeds: [], reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 } });
const existing = cast('a', 20, 'Existing public conversation');
const published = cast('c', 10, 'My pending root cast');
const page = (casts: Cast[] = []): FeedResponse => ({ casts, next: {} });
const recipe = (name: string, fid: number): FeedDefinition => ({ version: 1, name, sources: [{ kind: 'user', fid }], order: 'newest', filters: { includeWords: [], excludeWords: [], hideReplies: false, imagesOnly: false } });
const customPath = (definition: FeedDefinition) => `/feeds/view?feed=${encodeFeed(definition)}`;
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function session(fid = 10, key = '1'): WalletSession {
  return { fid, user: person(fid), custodyAddress: person(fid).custody_address, publicKey: key.repeat(64), scopes: FULL_CLIENT_SCOPES, cast: vi.fn().mockResolvedValue({ hash: published.hash }), dispose: vi.fn(), deleteCast: vi.fn(), react: vi.fn(), follow: vi.fn(), updateProfile: vi.fn(), refreshProfile: vi.fn(), authorizeMediaUpload: vi.fn() } as unknown as WalletSession;
}
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear(); localStorage.setItem('opencaster.explore', '1'); wallet.next = null;
  history.replaceState(null, '', '/');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Publishing integration tests must not contact the network.')));
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  vi.mocked(getFeed).mockResolvedValue(page([existing])); vi.mocked(getProfileFeed).mockResolvedValue(page()); vi.mocked(readCustomFeed).mockResolvedValue(page([existing]));
  vi.mocked(getChannels).mockResolvedValue({ channels: [], next: {} }); vi.mocked(getInfo).mockResolvedValue({ version: 'isolated-test' });
  vi.mocked(getReactionStatus).mockResolvedValue(false); vi.mocked(getFollowStatus).mockResolvedValue(false);
  vi.mocked(getSuggestedUsers).mockResolvedValue({ users: [] }); vi.mocked(getChannelMembers).mockResolvedValue({ users: [], next: {} }); vi.mocked(getCastQuotes).mockResolvedValue(page());
  vi.mocked(getUser).mockImplementation(async lookup => person(lookup.fid ?? 10));
  vi.mocked(getConversation).mockImplementation(async hash => ({ cast: hash.replace(/^0x/, '').toLowerCase() === existing.hash.slice(2) ? existing : cast('b', 30, 'Another conversation'), replies: [] }));
  vi.mocked(getCast).mockResolvedValue(existing); vi.mocked(resolveCastAlias).mockResolvedValue({ author: existing.author, candidates: [existing], complete: true, scanned: 1 });
  vi.mocked(searchCasts).mockResolvedValue(page()); vi.mocked(searchUsers).mockResolvedValue({ users: [] });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function start(path = '/') {
  history.replaceState(null, '', path); await act(async () => root.render(<App />));
  // The public picker is a lazy module; wait for its visible result rather than
  // assuming an import finishes within the fixed ten-millisecond settle helper.
  if (path.startsWith('/following')) await vi.waitFor(async () => { await settle(); expect(container.querySelector('.public-following-picker')).toBeTruthy(); });
}
async function click(element: Element) { expect(element).toBeTruthy(); await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }); }
function button(label: string, scope: ParentNode = container) { return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!; }
async function connect(value: WalletSession) { wallet.next = value; await click(button('Sign in')); await vi.waitFor(async () => { await settle(); expect(button('Approve synthetic wallet')).toBeTruthy(); }); await click(button('Approve synthetic wallet')); await settle(); }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function type(text: string, scope: ParentNode = container.querySelector('.home-composer')!) {
  const field = scope.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text); field.dispatchEvent(new Event('input', { bubbles: true })); });
}
const pending = (scope: ParentNode = container) => scope.querySelector<HTMLElement>('article[aria-label="Pending cast"]');
const status = (scope: ParentNode = container) => pending(scope)?.querySelector('.pending-cast__status')?.textContent ?? pending(scope)?.querySelector('[role="status"]')?.textContent ?? '';
const base = () => container.querySelector<HTMLElement>('.main-base')!;
const thread = () => container.querySelector<HTMLElement>('section.conversation-page')!;
const dialog = () => container.querySelector<HTMLDialogElement>('dialog')!;
async function refresh() { await click(container.querySelector('button[aria-label="Refresh feed"]')!); }
async function go(path: string) { await act(async () => { history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }); await settle(); }
async function tab(name: string) { await click(container.querySelector(`nav[aria-label="Profile content"] a[href$="tab=${name}"]`)!); }

describe('publishing feedback in the application', () => {
  it('keeps loaded cards during refresh and inline retry, then clears them when the feed changes', async () => {
    await start();
    const refreshed = deferred<FeedResponse>(); vi.mocked(getFeed).mockReturnValueOnce(refreshed.promise);
    await refresh();
    expect(base().querySelector('.feed')?.textContent).toContain(existing.text);
    expect(base().querySelector('[aria-label="Loading casts"]')).toBeNull();
    await act(async () => refreshed.reject(new Error('Temporary refresh outage')));
    expect(base().querySelector('.feed')?.textContent).toContain(existing.text);
    expect(base().querySelector('[role="alert"]')?.textContent).toContain('Temporary refresh outage');
    const recovered = cast('d', 30, 'Fresh recovered conversation'); vi.mocked(getFeed).mockResolvedValueOnce(page([recovered]));
    await click(button('Try again', base()));
    expect(base().querySelector('.feed')?.textContent).toContain(recovered.text);
    expect(base().querySelector('.feed')?.textContent).not.toContain(existing.text);
    await click(container.querySelector('nav[aria-label="Home feeds"] a[href="/following"]')!);
    expect(base().querySelector('.feed')?.textContent ?? '').not.toContain(recovered.text);
  });

  it('retains a public Following refresh but clears the previous FID when a different public feed is loading or fails', async () => {
    await start('/following?fid=42'); await settle();
    expect(base().querySelector('.feed')?.textContent).toContain(existing.text);
    expect(base().querySelector('.public-following-picker')?.textContent).toContain('FID 42');
    const refreshRead = deferred<FeedResponse>(); vi.mocked(getFeed).mockReturnValueOnce(refreshRead.promise);
    await refresh(); expect(base().querySelector('.feed')?.textContent).toContain(existing.text);
    await act(async () => refreshRead.reject(new Error('Public refresh unavailable')));
    expect(base().querySelector('.feed')?.textContent).toContain(existing.text);
    const nextRead = deferred<FeedResponse>(); vi.mocked(getFeed).mockReturnValueOnce(nextRead.promise);
    await go('/following?fid=43');
    expect(getFeed).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'following', fid: 43 }));
    expect(base().querySelector('[aria-label="Loading casts"]')).not.toBeNull();
    expect(base().querySelector('.feed')?.textContent ?? '').not.toContain(existing.text);
    await act(async () => nextRead.reject(new Error('Next public feed unavailable')));
    expect(base().querySelector('.feed')?.textContent ?? '').not.toContain(existing.text);
    expect(base().textContent).toContain('Next public feed unavailable');
    expect(base().querySelector('.public-following-picker')?.textContent).toContain('FID 43');
    expect(button('Browse following', base())).toBeTruthy(); expect(location.pathname).toBe('/following');
  });

  it('retains a custom recipe refresh but clears old cards when another token is loading or fails', async () => {
    const first = recipe('First recipe', 20); const next = recipe('Second recipe', 30);
    await start(customPath(first)); await settle();
    expect(base().querySelector('.feed')?.textContent).toContain(existing.text);
    const refreshRead = deferred<FeedResponse>(); vi.mocked(readCustomFeed).mockReturnValueOnce(refreshRead.promise);
    await refresh(); expect(base().querySelector('.feed')?.textContent).toContain(existing.text);
    await act(async () => refreshRead.reject(new Error('Custom refresh unavailable')));
    expect(base().querySelector('.feed')?.textContent).toContain(existing.text);
    const nextRead = deferred<FeedResponse>(); vi.mocked(readCustomFeed).mockReturnValueOnce(nextRead.promise);
    await go(customPath(next));
    expect(readCustomFeed).toHaveBeenLastCalledWith(next, null, expect.any(AbortSignal));
    expect(base().querySelector('[aria-label="Loading casts"]')).not.toBeNull();
    expect(base().querySelector('.feed')?.textContent ?? '').not.toContain(existing.text);
    await act(async () => nextRead.reject(new Error('Next custom feed unavailable')));
    expect(base().querySelector('.feed')?.textContent ?? '').not.toContain(existing.text);
    expect(base().textContent).toContain('Next custom feed unavailable');
    expect(getFeed).not.toHaveBeenCalled();
  });

  it('keeps own pending casts out of another account public Following feed', async () => {
    const account = session(); const receipt = deferred<{ hash: string }>(); vi.mocked(account.cast).mockReturnValue(receipt.promise);
    await start(); await connect(account); await type(published.text); await click(button('Cast', container.querySelector('.home-composer')!));
    await go('/following?fid=42');
    expect(pending(base())).toBeNull(); expect(base().querySelector('.public-following-picker')?.textContent).toContain('FID 42');
    await go('/following?fid=10');
    expect(pending(base())?.textContent).toContain(published.text); expect(status(base())).toContain('Publishing');
    expect(account.cast).toHaveBeenCalledOnce();
  });

  it('shows a cast started on a custom recipe in a labelled pending tray separate from recipe results', async () => {
    const account = session(); const receipt = deferred<{ hash: string }>(); vi.mocked(account.cast).mockReturnValue(receipt.promise);
    const definition = { ...recipe('Filtered conversation', 20), filters: { includeWords: ['Existing'], excludeWords: [], hideReplies: true, imagesOnly: false } };
    await start(); await connect(account); await go(customPath(definition));
    await click(container.querySelector('button.sidebar-cast')!);
    await type(published.text, dialog()); await click(button('Cast', dialog()));
    await click(dialog().querySelector('button[aria-label="Close dialog"]')!);
    const tray = base().querySelector<HTMLElement>('.pending-casts[aria-label="Your pending casts"]')!;
    expect(tray).not.toBeNull(); expect(tray.querySelector('p')?.textContent).toBe('Your pending casts');
    expect(pending(tray)?.textContent).toContain(published.text);
    expect(base().querySelector('.feed')?.textContent).toContain(existing.text);
    expect(base().querySelector('.feed')?.textContent).not.toContain(published.text);
    expect(base().querySelector('.feed [aria-label="Pending cast"]')).toBeNull();
    expect(account.cast).toHaveBeenCalledOnce();
  });

  it('renders a pending cast immediately, retains it after acceptance, and replaces it only with the matching author and canonical hash', async () => {
    const account = session(); const receipt = deferred<{ hash: string }>(); vi.mocked(account.cast).mockReturnValue(receipt.promise);
    await start(); await connect(account); await type(published.text); await click(button('Cast', container.querySelector('.home-composer')!));
    expect(account.cast).toHaveBeenCalledOnce(); expect(pending()?.textContent).toContain(published.text); expect(status()).toContain('Publishing');
    expect(base().querySelector('.feed')?.textContent).toContain(existing.text);
    await act(async () => receipt.resolve({ hash: published.hash.slice(2).toUpperCase() }));
    expect(status()).toContain('Submitted'); expect(status()).toContain('waiting to appear');
    expect(container.querySelector<HTMLTextAreaElement>('.home-composer textarea')?.value).toBe('');
    vi.mocked(getFeed).mockResolvedValueOnce(page([{ ...published, author: person(99), text: 'Different author with the same reported hash' }]));
    await refresh(); expect(pending()?.textContent).toContain(published.text);
    vi.mocked(getFeed).mockResolvedValueOnce(page([published])); await refresh();
    expect(pending()).toBeNull(); expect(base().querySelectorAll('.feed .cast')).toHaveLength(1); expect(base().querySelector('.feed')?.textContent).toContain(published.text);
    expect(account.cast).toHaveBeenCalledOnce();
  });

  it('does not restore a pending card after its canonical cast was observed before the receipt arrived', async () => {
    const account = session(); const receipt = deferred<{ hash: string }>(); vi.mocked(account.cast).mockReturnValue(receipt.promise);
    await start(); await connect(account); await type(published.text); await click(button('Cast', container.querySelector('.home-composer')!));
    vi.mocked(getFeed).mockResolvedValueOnce(page([published])); await refresh();
    expect(status()).toContain('Publishing'); expect(base().querySelector('.feed')?.textContent).toContain(published.text);
    const postSubmitRead = deferred<FeedResponse>(); vi.mocked(getFeed).mockReturnValueOnce(postSubmitRead.promise);
    await act(async () => receipt.resolve({ hash: published.hash }));
    expect(pending()).toBeNull();
    await click(button('My profile')); await settle();
    expect(pending(base())).toBeNull();
    await act(async () => postSubmitRead.resolve(page([published])));
    expect(pending(base())).toBeNull(); expect(account.cast).toHaveBeenCalledOnce();
  });

  it('refreshes the feed exactly once after a pending New cast modal is closed and its receipt arrives', async () => {
    const account = session(); const receipt = deferred<{ hash: string }>(); vi.mocked(account.cast).mockReturnValue(receipt.promise);
    await start(); await connect(account);
    await click(container.querySelector('button[aria-label="Write a new cast"]')!);
    await type(published.text, dialog()); await click(button('Cast', dialog()));
    expect(status()).toContain('Publishing');
    await click(dialog().querySelector('button[aria-label="Close dialog"]')!);
    expect(container.querySelector('dialog')).toBeNull();
    const readsBeforeReceipt = vi.mocked(getFeed).mock.calls.length;
    vi.mocked(getFeed).mockResolvedValueOnce(page([existing, published]));
    await act(async () => receipt.resolve({ hash: published.hash })); await settle();
    expect(getFeed).toHaveBeenCalledTimes(readsBeforeReceipt + 1);
    expect(pending()).toBeNull(); expect(base().querySelector('.feed')?.textContent).toContain(published.text);
    expect(account.cast).toHaveBeenCalledOnce();
  });

  it.each([
    { cause: new ApiError('Outcome unknown', 504, 'submission_unknown'), expected: /unknown/i },
    { cause: new ApiError('The node rejected this signed message.', 400, 'upstream_error'), expected: /failed|rejected|not submitted/i },
  ])('retains the draft and explicit failure status without automatically resubmitting: $cause.code', async ({ cause, expected }) => {
    const account = session(); const receipt = deferred<{ hash: string }>(); vi.mocked(account.cast).mockReturnValue(receipt.promise);
    await start(); await connect(account); await type('Keep this draft after submission trouble'); await click(button('Cast', container.querySelector('.home-composer')!));
    await act(async () => receipt.reject(cause));
    expect(status()).toMatch(expected); expect(container.querySelector<HTMLTextAreaElement>('.home-composer textarea')?.value).toBe('Keep this draft after submission trouble');
    expect(container.querySelector('.home-composer [role="alert"]')).not.toBeNull();
    await refresh(); await settle(); expect(account.cast).toHaveBeenCalledOnce();
    expect([...pending()!.querySelectorAll('button')].some(item => /retry|resubmit|publish/i.test(item.textContent ?? ''))).toBe(false);
  });

  it('drops pending state on lock and keeps a late receipt out of a newly connected account', async () => {
    const account = session(); const receipt = deferred<{ hash: string }>(); vi.mocked(account.cast).mockReturnValue(receipt.promise);
    await start(); await connect(account); await type(published.text); await click(button('Cast', container.querySelector('.home-composer')!)); expect(pending()).not.toBeNull();
    await click(button('My profile')); await settle(); await click(button('Lock this tab'));
    expect(pending()).toBeNull(); expect(account.dispose).toHaveBeenCalledOnce();
    await connect(session(11, '2')); await click(button('Discover'));
    await act(async () => receipt.resolve({ hash: published.hash }));
    expect(pending()).toBeNull(); expect(base().querySelector('.feed')?.textContent).not.toContain(published.text);
  });

  it('shows a reply in its conversation and own Replies tab without injecting it into unrelated feeds or threads', async () => {
    const account = session(); const receipt = deferred<{ hash: string }>(); vi.mocked(account.cast).mockReturnValue(receipt.promise);
    await start(); await connect(account); await click(base().querySelector('.feed a[aria-label="Open cast"]')!);
    await type('Pending conversation reply', thread()); await click(button('Reply', thread().querySelector('.composer')!));
    expect(pending(thread())?.textContent).toContain('Pending conversation reply'); expect(pending(base())).toBeNull();
    expect(account.cast).toHaveBeenCalledWith('Pending conversation reply', { fid: existing.author.fid, hash: existing.hash }, expect.anything());
    await click(thread().querySelector('button[aria-label="Back"]')!); await settle(); expect(pending(base())).toBeNull();
    await click(button('My profile')); await settle(); expect(pending(base())).toBeNull();
    await tab('replies'); expect(pending(base())?.textContent).toContain('Pending conversation reply');
    await tab('media'); expect(pending(base())).toBeNull();
    const unrelated = cast('b', 30, 'Another conversation');
    await act(async () => { history.pushState(null, '', `/cast/${unrelated.hash}`); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(pending(thread())).toBeNull();
  });

  it('shows a pending quote as a root cast on the author profile, with no unrelated profile or nonmatching tab leakage', async () => {
    const account = session(); const receipt = deferred<{ hash: string }>(); vi.mocked(account.cast).mockReturnValue(receipt.promise);
    await start(); await connect(account);
    const recast = base().querySelector('button.recast-trigger')!; await click(recast); await click(recast.parentElement!.querySelector('[role="menu"] button[aria-label="Quote cast"]')!);
    await type('Pending quote commentary', dialog()); await click(button('Quote', dialog()));
    expect(pending(base())?.textContent).toContain('Pending quote commentary');
    await click(dialog().querySelector('button[aria-label="Close dialog"]')!);
    await click(button('My profile')); await settle(); expect(pending(base())?.textContent).toContain('Pending quote commentary');
    await tab('replies'); expect(pending(base())).toBeNull(); await tab('media'); expect(pending(base())).toBeNull(); await tab('likes'); expect(pending(base())).toBeNull();
    await act(async () => { history.pushState(null, '', '/profile/20'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(pending(base())).toBeNull(); expect(account.cast).toHaveBeenCalledOnce();
  });
});
