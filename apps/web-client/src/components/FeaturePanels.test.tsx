// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelHeader, ChannelsView, NotificationsView, ProfileTabs, SearchView } from './FeaturePanels';
import { getChannels, getNotifications, searchCasts, searchUsers, type ActivityItem, type Cast, type Channel, type User } from '@opencaster/client-core/api';

vi.mock('@opencaster/client-core/api', () => ({ getChannels: vi.fn(), getNotifications: vi.fn(), searchCasts: vi.fn(), searchUsers: vi.fn() }));

const person = (fid: number): User => ({ fid, username: `person${fid}`, display_name: `Person ${fid}`, custody_address: '', profile: { bio: { text: 'A public profile' } }, follower_count: 0, following_count: 0 });
const cast = (letter: string, text: string): Cast => ({ hash: `0x${letter.repeat(40)}`, author: person(2), text, timestamp: '2026-10-19T12:00:00.000Z', embeds: [], reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 } });
const activity = (id: string, timestamp: string): ActivityItem => ({ id, type: 'reactions', timestamp, actors: [person(2)], cast: cast('a', 'A public cast'), targetHash: `0x${'a'.repeat(40)}` });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolveValue => { resolve = resolveValue; });
  return { promise, resolve };
}
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear(); vi.clearAllMocks();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = async (view: Parameters<Root['render']>[0]) => { await act(async () => root.render(view)); };
const click = async (element: Element, options: MouseEventInit = {}) => {
  let navigated = true;
  await act(async () => { navigated = element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...options })); });
  return navigated;
};
const button = (label: string) => [...container.querySelectorAll('button')].find(element => element.textContent?.trim() === label)!;

describe('isolated feature panels', () => {
  it('abandons an earlier search and cannot replace the new query with a late response', async () => {
    const first = deferred<{ casts: Cast[]; next: {} }>();
    const second = deferred<{ casts: Cast[]; next: {} }>();
    vi.mocked(searchCasts).mockImplementation(options => options.query === 'first' ? first.promise : second.promise);
    const onSearch = vi.fn(); const onProfile = vi.fn();
    const props = { kind: 'casts' as const, onSearch, onProfile, renderCast: (item: Cast) => <p>{item.text}</p> };
    await render(<SearchView {...props} query="first" />);
    const firstSignal = vi.mocked(searchCasts).mock.calls[0][0].signal!;
    await render(<SearchView {...props} query="second" />);
    expect(firstSignal.aborted).toBe(true);
    await act(async () => second.resolve({ casts: [cast('b', 'Second query result')], next: {} }));
    expect(container.textContent).toContain('Second query result');
    await act(async () => first.resolve({ casts: [cast('a', 'Stale first result')], next: {} }));
    expect(container.textContent).toContain('Second query result');
    expect(container.textContent).not.toContain('Stale first result');
    expect(container.querySelector('input')?.value).toBe('second');
  });

  it('cancels a pending search and allows an explicit retry without accepting the cancelled response', async () => {
    const pending = deferred<{ casts: Cast[]; next: {} }>();
    vi.mocked(searchCasts).mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ casts: [cast('c', 'Retried result')], next: {} });
    await render(<SearchView query="query" kind="casts" onSearch={vi.fn()} onProfile={vi.fn()} renderCast={item => <p>{item.text}</p>} />);
    const signal = vi.mocked(searchCasts).mock.calls[0][0].signal!;
    await click(button('Cancel'));
    expect(signal.aborted).toBe(true); expect(container.textContent).toContain('Loading cancelled.');
    await render(<SearchView query="query" kind="casts" onSearch={vi.fn()} onProfile={vi.fn()} renderCast={item => <p>Updated card: {item.text}</p>} />);
    expect(searchCasts).toHaveBeenCalledOnce(); expect(container.textContent).toContain('Loading cancelled.');
    await click(button('Try again'));
    expect(container.textContent).toContain('Retried result');
    await act(async () => pending.resolve({ casts: [cast('d', 'Cancelled result')], next: {} }));
    expect(container.textContent).not.toContain('Cancelled result');
  });

  it('preserves ordinary profile navigation while allowing native new-tab gestures', async () => {
    vi.mocked(searchUsers).mockResolvedValue({ users: [person(42)] });
    const onProfile = vi.fn();
    await render(<SearchView query="person" kind="users" onSearch={vi.fn()} onProfile={onProfile} renderCast={() => null} />);
    const link = container.querySelector<HTMLAnchorElement>('a[href="/profile/42"]')!;
    expect(await click(link, { metaKey: true })).toBe(true); expect(onProfile).not.toHaveBeenCalled();
    expect(await click(link)).toBe(false); expect(onProfile).toHaveBeenCalledWith(person(42));
  });

  it('shows a disabled search index as a failure, without claiming an empty successful search', async () => {
    vi.mocked(searchCasts).mockRejectedValue(new Error('Cast search is not enabled on this Hypersnap node.'));
    await render(<SearchView query="hello" kind="casts" onSearch={vi.fn()} onProfile={vi.fn()} renderCast={() => null} />);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('not enabled');
    expect(container.textContent).not.toContain('No casts found.');
    expect(button('Try again')).toBeDefined();
  });

  it('saves activity read status locally and keeps different account read state separate', async () => {
    const items = [activity('first', '2026-10-19T12:00:00.000Z'), activity('second', '2026-10-19T12:01:00.000Z')];
    vi.mocked(getNotifications).mockResolvedValue({ notifications: items, next: {} });
    const props = { onConnect: vi.fn(), onProfile: vi.fn(), onCast: vi.fn() };
    await render(<NotificationsView {...props} fid={10} />);
    expect(container.querySelectorAll('[data-unread]')).toHaveLength(2);
    await click(button('Mark read'));
    expect(container.querySelectorAll('[data-unread]')).toHaveLength(0);
    expect(localStorage.getItem('arca.hypersnap.activity.read.v1.10')).toBe(String(Date.parse(items[1].timestamp)));
    expect(localStorage.length).toBe(1);
    await render(<NotificationsView {...props} fid={11} />);
    expect(container.querySelectorAll('[data-unread]')).toHaveLength(2);
    expect(localStorage.getItem('arca.hypersnap.activity.read.v1.11')).toBeNull();
    await render(<NotificationsView {...props} fid={10} />);
    expect(container.querySelectorAll('[data-unread]')).toHaveLength(0);
    expect(button('Mark read').disabled).toBe(true);
    expect(getNotifications).toHaveBeenCalledTimes(3);
  });

  it('keeps read activity usable when browser storage is unavailable', async () => {
    vi.mocked(getNotifications).mockResolvedValue({ notifications: [activity('one', '2026-10-19T12:00:00.000Z')], next: {} });
    await render(<NotificationsView fid={10} onConnect={vi.fn()} onProfile={vi.fn()} onCast={vi.fn()} />);
    const storage = localStorage;
    vi.stubGlobal('localStorage', { getItem: storage.getItem.bind(storage), clear: storage.clear.bind(storage), setItem: () => { throw new DOMException('Unavailable', 'QuotaExceededError'); } });
    await click(button('Mark read'));
    expect(container.querySelectorAll('[data-unread]')).toHaveLength(0);
    expect(container.textContent).toContain('for this visit');
    expect(container.textContent).toContain('could not save read status');
  });

  it('filters loaded activity locally, keeps continuation available and marks loaded results read across filters', async () => {
    const first = activity('reaction', '2026-10-19T12:00:00.000Z');
    const mention: ActivityItem = { ...activity('mention', '2026-10-19T12:01:00.000Z'), type: 'mentions' };
    vi.mocked(getNotifications).mockResolvedValueOnce({ notifications: [first], next: { cursor: 'older' } }).mockResolvedValueOnce({ notifications: [mention], next: {} });
    await render(<NotificationsView fid={10} onConnect={vi.fn()} onProfile={vi.fn()} onCast={vi.fn()} />);
    await click(button('Mentions'));
    expect(button('Mentions').getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('No mentions in the loaded results.');
    expect(container.textContent).toContain('Load more activity to check earlier events');
    expect(getNotifications).toHaveBeenCalledOnce();
    await click(button('Load more activity'));
    expect(vi.mocked(getNotifications).mock.calls[1][0].cursor).toBe('older');
    expect(container.querySelectorAll('.feature-activity > li')).toHaveLength(1);
    expect(container.querySelector('.feature-activity')?.textContent).toContain('mentioned you');
    await click(button('Unread'));
    expect(container.querySelectorAll('.feature-activity > li')).toHaveLength(2);
    await click(button('Mark read'));
    expect(container.querySelectorAll('.feature-activity > li')).toHaveLength(0);
    expect(container.textContent).toContain('No unread activity in the loaded results.');
    await click(button('All'));
    expect(container.querySelectorAll('.feature-activity > li')).toHaveLength(2);
    expect(container.querySelectorAll('[data-unread]')).toHaveLength(0);
    expect(getNotifications).toHaveBeenCalledTimes(2);
  });

  it('uses the actual activity types and resets a filter when changing accounts', async () => {
    const types: ActivityItem['type'][] = ['mentions', 'replies', 'reactions', 'follows', 'unknown'];
    const items = types.map((type, index) => ({ ...activity(String(index), '2026-10-19T12:00:00.000Z'), type }));
    vi.mocked(getNotifications).mockResolvedValue({ notifications: items, next: {} });
    const props = { onConnect: vi.fn(), onProfile: vi.fn(), onCast: vi.fn() };
    await render(<NotificationsView {...props} fid={10} />);
    for (const [label, text] of [['Replies', 'replied to your cast'], ['Reactions', 'reacted to your cast'], ['Follows', 'followed you']]) {
      await click(button(label));
      expect(container.querySelectorAll('.feature-activity > li')).toHaveLength(1);
      expect(container.querySelector('.feature-activity')?.textContent).toContain(text);
    }
    await click(button('All'));
    expect(container.querySelectorAll('.feature-activity > li')).toHaveLength(5);
    await click(button('Mentions'));
    await render(<NotificationsView {...props} fid={11} />);
    expect(button('All').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('.feature-activity > li')).toHaveLength(5);
    expect(getNotifications).toHaveBeenCalledTimes(2);
  });

  it('does not request account activity before a wallet is connected', async () => {
    const onConnect = vi.fn();
    await render(<NotificationsView onConnect={onConnect} onProfile={vi.fn()} onCast={vi.fn()} />);
    expect(getNotifications).not.toHaveBeenCalled();
    await click(button('Sign in')); expect(onConnect).toHaveBeenCalledOnce();
  });

  it.each(['failed', 'cancelled'] as const)('retries a %s refresh from the beginning instead of the previous continuation', async outcome => {
    const oldItem = activity('old', '2026-10-19T12:00:00.000Z');
    const freshItem = { ...activity('fresh', '2026-10-19T12:02:00.000Z'), actors: [person(3)] };
    const refreshing = deferred<{ notifications: ActivityItem[]; next: {} }>();
    const api = vi.mocked(getNotifications);
    api.mockResolvedValueOnce({ notifications: [oldItem], next: { cursor: 'older-page' } });
    if (outcome === 'failed') api.mockRejectedValueOnce(new Error('Refresh temporarily failed.'));
    else api.mockReturnValueOnce(refreshing.promise);
    api.mockResolvedValueOnce({ notifications: [freshItem], next: {} });
    await render(<NotificationsView fid={10} onConnect={vi.fn()} onProfile={vi.fn()} onCast={vi.fn()} />);
    await click(container.querySelector('button[aria-label="Refresh activity"]')!);
    if (outcome === 'cancelled') await click(button('Cancel'));
    await click(button('Try again'));
    expect(api.mock.calls[2][0].cursor).toBeUndefined();
    expect(container.querySelector('a[href="/profile/3"]')).not.toBeNull();
    expect(container.querySelector('a[href="/profile/2"]')).toBeNull();
    if (outcome === 'cancelled') {
      expect(api.mock.calls[1][0].signal?.aborted).toBe(true);
      await act(async () => refreshing.resolve({ notifications: [oldItem], next: {} }));
      expect(container.querySelector('a[href="/profile/2"]')).toBeNull();
    }
  });

  it('keeps the directory continuation after an empty filtered page, deduplicates and stops repeated cursors', async () => {
    const channel = { id: 'isolated', name: 'Isolated channel', url: 'https://example.com/channel/isolated', member_count: 2 };
    vi.mocked(getChannels).mockResolvedValueOnce({ channels: [], next: {} });
    await render(<ChannelsView onChannel={vi.fn()} />);
    vi.mocked(getChannels).mockResolvedValueOnce({ channels: [], next: { cursor: 'page2' } })
      .mockResolvedValueOnce({ channels: [channel, channel], next: { cursor: 'page2' } });
    await click(button('All channels'));
    expect(container.textContent).toContain('No named channels on this page.');
    await click(button('Load more channels'));
    expect(container.querySelectorAll('a[href="/channel/isolated"]')).toHaveLength(1);
    expect(button('Load more channels')).toBeUndefined();
    expect(container.textContent).toContain('end of the available results');
    expect(container.textContent).toContain('2 participants');
  });

  it('opens saved channel shortcuts without a node request and ignores a late directory response', async () => {
    const remote = deferred<{ channels: Channel[]; next: {} }>();
    vi.mocked(getChannels).mockReturnValueOnce(remote.promise);
    const saved: Channel = { id: 'saved', name: 'Saved channel', url: 'https://example.com/saved' };
    const onChannel = vi.fn(); const onToggleSave = vi.fn();
    await render(<ChannelsView onChannel={onChannel} savedChannels={[saved]} onToggleSave={onToggleSave} />);
    const signal = vi.mocked(getChannels).mock.calls[0][0].signal!;
    await click(button('Saved channels'));
    expect(signal.aborted).toBe(true);
    expect(container.querySelector('a[href="/channel/saved"]')).not.toBeNull();
    expect(container.textContent).toContain('shortcuts on this browser');
    expect(getChannels).toHaveBeenCalledOnce();
    await click(container.querySelector('button[aria-label="Remove /saved from saved channels"]')!);
    expect(onToggleSave).toHaveBeenCalledWith(saved); expect(onChannel).not.toHaveBeenCalled();
    await click(container.querySelector('a[href="/channel/saved"]')!);
    expect(onChannel).toHaveBeenCalledWith(saved);
    await act(async () => remote.resolve({ channels: [{ id: 'late', name: 'Late channel', url: '' }], next: {} }));
    expect(container.querySelector('a[href="/channel/late"]')).toBeNull();
    expect(container.querySelector('a[href="/channel/saved"]')).not.toBeNull();
    await render(<ChannelsView onChannel={onChannel} savedChannels={[]} onToggleSave={onToggleSave} />);
    expect(container.textContent).toContain('Keep your favorite channels nearby.');
    expect(getChannels).toHaveBeenCalledOnce();
  });

  it('offers channel saving in the header without representing a network subscription', async () => {
    const channel: Channel = { id: 'quorum', name: 'Quorum', url: 'https://example.com/quorum' };
    const onToggleSave = vi.fn();
    await render(<ChannelHeader channel={channel} onToggleSave={onToggleSave} />);
    await click(button('Save channel'));
    expect(onToggleSave).toHaveBeenCalledWith(channel);
    await render(<ChannelHeader channel={channel} saved onToggleSave={onToggleSave} />);
    expect(button('Saved on this browser').getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('local shortcuts on this browser');
  });

  it('gives each profile tab a shareable URL and intercepts only an ordinary click', async () => {
    const onChange = vi.fn();
    await render(<ProfileTabs fid={10} tab="replies" onChange={onChange} />);
    const reply = container.querySelector<HTMLAnchorElement>('a[href="/profile/10?tab=replies"]')!;
    const photos = container.querySelector<HTMLAnchorElement>('a[href="/profile/10?tab=media"]')!;
    expect(reply.getAttribute('aria-current')).toBe('page');
    expect(photos.textContent).toBe('Photos');
    expect(await click(photos, { ctrlKey: true })).toBe(true); expect(onChange).not.toHaveBeenCalled();
    expect(await click(photos)).toBe(false); expect(onChange).toHaveBeenCalledWith('media');
    const likes = container.querySelector<HTMLAnchorElement>('a[href="/profile/10?tab=likes"]')!;
    const recasts = container.querySelector<HTMLAnchorElement>('a[href="/profile/10?tab=recasts"]')!;
    expect(likes.textContent).toBe('Likes'); expect(recasts.textContent).toBe('Recasts');
    expect(await click(recasts)).toBe(false); expect(onChange).toHaveBeenLastCalledWith('recasts');
  });
});
