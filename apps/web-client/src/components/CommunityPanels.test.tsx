// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CastQuotesDialog, ChannelPeopleDialog, SuggestedPeople } from './CommunityPanels';
import { getCastQuotes, getChannelMembers, getSuggestedUsers, type User, type Cast, type Channel } from '@opencaster/client-core/api';
vi.mock('@opencaster/client-core/api', () => ({ getCastQuotes: vi.fn(), getChannelMembers: vi.fn(), getSuggestedUsers: vi.fn() }));
const person = (fid: number): User => ({ fid, username: `person${fid}`, display_name: `Person ${fid}`, custody_address: '', profile: { bio: { text: 'Public profile' } }, follower_count: 0, following_count: 0 });
const channel: Channel = { id: 'art', name: 'Art', url: 'https://warpcast.com/~/channel/art' };
const cast: Cast = { hash: 'a'.repeat(40), author: person(3), text: 'Original', timestamp: '2026-10-21T12:00:00Z', embeds: [], reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 } };
let container: HTMLDivElement; let root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.resetAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = async (value: Parameters<Root['render']>[0]) => { await act(async () => root.render(value)); };
const button = (text: string) => [...container.querySelectorAll('button')].find(value => value.textContent?.trim() === text)!;
const click = async (value: Element, options: MouseEventInit = {}) => { let native = true; await act(async () => { native = value.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...options })); }); return native; };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('read-only community panels', () => {
  it('does not request guest suggestions and keeps late results isolated to the original account', async () => {
    const first = deferred<{ users: User[] }>();
    vi.mocked(getSuggestedUsers).mockReturnValueOnce(first.promise).mockResolvedValueOnce({ users: [person(9)] });
    const props = { onProfile: vi.fn() };
    await render(<SuggestedPeople {...props} />); expect(getSuggestedUsers).not.toHaveBeenCalled();
    await render(<SuggestedPeople {...props} fid={7} />); const signal = vi.mocked(getSuggestedUsers).mock.calls[0][2]!;
    await render(<SuggestedPeople {...props} fid={8} />); expect(signal.aborted).toBe(true);
    await act(async () => first.resolve({ users: [person(10)] }));
    expect(container.textContent).toContain('Person 9'); expect(container.textContent).not.toContain('Person 10');
    const link = container.querySelector('a[href="/profile/9"]')!;
    expect(await click(link, { metaKey: true })).toBe(true); expect(props.onProfile).not.toHaveBeenCalled();
    expect(await click(link)).toBe(false); expect(props.onProfile).toHaveBeenCalledWith(person(9));
  });
  it('paginates participants with deduplication and does not label them subscribers', async () => {
    vi.mocked(getChannelMembers).mockResolvedValueOnce({ users: [person(3)], next: { cursor: '3' } }).mockResolvedValueOnce({ users: [person(3), person(4)], next: {} });
    await render(<ChannelPeopleDialog channel={channel} onProfile={vi.fn()} onClose={vi.fn()} />);
    expect(container.textContent).toContain('having posted'); expect(container.textContent).toContain('not a subscription');
    await click(button('Load more participants'));
    expect(container.querySelectorAll('.community-person')).toHaveLength(2);
    expect(vi.mocked(getChannelMembers).mock.calls[1][1]).toMatchObject({ cursor: '3', limit: 25 });
    expect(button('Load more participants')).toBeUndefined();
  });
  it('cancels participant reads on close and refuses a stale response after channel changes', async () => {
    const pending = deferred<{ users: User[]; next: {} }>();
    vi.mocked(getChannelMembers).mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ users: [person(4)], next: {} });
    const props = { onProfile: vi.fn(), onClose: vi.fn() };
    await render(<ChannelPeopleDialog channel={channel} {...props} />); const signal = vi.mocked(getChannelMembers).mock.calls[0][1]!.signal!;
    await render(<ChannelPeopleDialog channel={{ ...channel, id: 'dev' }} {...props} />); expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve({ users: [person(5)], next: {} }));
    expect(container.textContent).toContain('Person 4'); expect(container.textContent).not.toContain('Person 5');
    await click(button('Close')); expect(props.onClose).toHaveBeenCalledOnce();
  });
  it('retains cancellation across same-channel rerenders and reloads only after an explicit retry', async () => {
    const pending = deferred<{ users: User[]; next: {} }>();
    vi.mocked(getChannelMembers).mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ users: [person(6)], next: {} });
    await render(<ChannelPeopleDialog channel={channel} onProfile={vi.fn()} onClose={vi.fn()} />);
    await click(button('Cancel'));
    await render(<ChannelPeopleDialog channel={{ ...channel, name: 'Updated channel name' }} onProfile={vi.fn()} onClose={vi.fn()} />);
    expect(getChannelMembers).toHaveBeenCalledOnce(); expect(container.textContent).toContain('Loading cancelled.');
    await act(async () => pending.resolve({ users: [person(5)], next: {} }));
    expect(container.textContent).not.toContain('Person 5');
    await click(button('Try again')); expect(getChannelMembers).toHaveBeenCalledTimes(2); expect(container.textContent).toContain('Person 6');
  });
  it('shows quote-index uncertainty and offers only an explicit sample refresh, never fake pagination', async () => {
    vi.mocked(getCastQuotes).mockResolvedValueOnce({ casts: [], next: {} }).mockResolvedValueOnce({ casts: [{ ...cast, hash: 'b'.repeat(40), text: 'Real quote' }], next: {} });
    await render(<CastQuotesDialog cast={cast} onClose={vi.fn()} renderCast={value => <p>{value.text}</p>} />);
    expect(container.textContent).toContain('index may be unavailable or incomplete'); expect(container.textContent).not.toContain('No one has quoted');
    await click(button('Refresh quotes')); expect(container.textContent).toContain('Real quote');
    expect(vi.mocked(getCastQuotes).mock.calls[0][1]).toBe(25);
    expect(container.textContent).not.toContain('Load more');
  });
  it('keeps unavailable indexes as errors and supports an explicit retry', async () => {
    vi.mocked(getSuggestedUsers).mockRejectedValueOnce(new Error('Suggested profiles unavailable')).mockResolvedValueOnce({ users: [person(3)] });
    await render(<SuggestedPeople fid={7} onProfile={vi.fn()} />);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('unavailable'); expect(container.textContent).not.toContain('No suggested profiles');
    await click(button('Try again')); expect(container.textContent).toContain('Person 3');
  });
});
