// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CastReactionPeople from './CastReactionPeople';
import { getCastReactionPeople, type Cast, type FollowsResponse, type User } from '@opencaster/client-core/api';
vi.mock('@opencaster/client-core/api', () => ({ getCastReactionPeople: vi.fn() }));
const person = (fid: number): User => ({ fid, username: `person${fid}`, display_name: `Person ${fid}`, custody_address: '', profile: { bio: { text: 'Public profile' } }, follower_count: 0, following_count: 0 });
const cast = { hash: `0x${'a'.repeat(40)}`, author: person(3) } as Cast;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.resetAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async (value: Parameters<Root['render']>[0]) => { await act(async () => root.render(value)); };
const button = (text: string) => [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === text)!;
async function click(value: Element, options: MouseEventInit = {}) { let native = true; await act(async () => { native = value.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...options })); }); return native; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const props = () => ({ cast, onClose: vi.fn(), onProfile: vi.fn() });

describe('cast reaction people', () => {
  it('loads real pages with deduplication and closes before local profile navigation', async () => {
    vi.mocked(getCastReactionPeople).mockResolvedValueOnce({ users: [person(7)], next: { cursor: 'cGFnZTE=' } }).mockResolvedValueOnce({ users: [person(7), person(8)], next: {} });
    const options = props(); const order: string[] = []; options.onClose.mockImplementation(() => order.push('close')); options.onProfile.mockImplementation(() => order.push('profile'));
    await render(<CastReactionPeople {...options} />);
    expect(vi.mocked(getCastReactionPeople).mock.calls[0][0]).toMatchObject({ target: { fid: 3, hash: cast.hash }, type: 'likes', limit: 25 });
    expect(host.textContent).toContain('current view can change or be incomplete');
    await click(button('Load more profiles'));
    expect(host.querySelectorAll('li')).toHaveLength(2); expect(button('Load more profiles')).toBeUndefined();
    expect(vi.mocked(getCastReactionPeople).mock.calls[1][0].cursor).toBe('cGFnZTE=');
    const link = host.querySelector('a[href="/profile/8"]')!;
    expect(await click(link, { metaKey: true })).toBe(true); expect(options.onProfile).not.toHaveBeenCalled();
    expect(await click(link)).toBe(false); expect(order).toEqual(['close', 'profile']); expect(options.onProfile).toHaveBeenCalledWith(person(8));
  });
  it('keeps failures distinct from empty and retries the failed continuation explicitly', async () => {
    vi.mocked(getCastReactionPeople).mockResolvedValueOnce({ users: [person(7)], next: { cursor: 'cGFnZTE=' } }).mockRejectedValueOnce(new Error('Node unavailable')).mockResolvedValueOnce({ users: [person(8)], next: {} });
    await render(<CastReactionPeople {...props()} initialType="recasts" />);
    await click(button('Load more profiles'));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Node unavailable'); expect(host.textContent).toContain('Person 7'); expect(host.textContent).not.toContain('No recasts');
    await click(button('Try again'));
    expect(host.querySelectorAll('li')).toHaveLength(2); expect(vi.mocked(getCastReactionPeople).mock.calls[2][0]).toMatchObject({ type: 'recasts', cursor: 'cGFnZTE=' });
  });
  it('aborts old tabs and ignores their late results', async () => {
    const pending = deferred<FollowsResponse>();
    vi.mocked(getCastReactionPeople).mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ users: [person(8)], next: {} });
    await render(<CastReactionPeople {...props()} />);
    const signal = vi.mocked(getCastReactionPeople).mock.calls[0][0].signal!;
    await click(button('Recasts')); expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve({ users: [person(7)], next: { cursor: 'b2xk' } }));
    expect(host.textContent).toContain('Person 8'); expect(host.textContent).not.toContain('Person 7'); expect(button('Recasts').getAttribute('aria-pressed')).toBe('true');
    expect(vi.mocked(getCastReactionPeople).mock.calls[1][0].type).toBe('recasts');
  });
  it('aborts old cast reads and resets a new target to its requested initial tab', async () => {
    const pending = deferred<FollowsResponse>();
    vi.mocked(getCastReactionPeople).mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ users: [], next: {} }).mockResolvedValueOnce({ users: [person(9)], next: {} });
    const options = props(); await render(<CastReactionPeople {...options} />);
    const signal = vi.mocked(getCastReactionPeople).mock.calls[0][0].signal!;
    await click(button('Recasts'));
    await render(<CastReactionPeople {...options} cast={{ ...cast, hash: 'b'.repeat(40) }} />);
    await act(async () => pending.resolve({ users: [person(7)], next: {} }));
    expect(signal.aborted).toBe(true); expect(host.textContent).not.toContain('Person 7'); expect(host.textContent).toContain('Person 9');
    expect(vi.mocked(getCastReactionPeople).mock.calls[2][0]).toMatchObject({ type: 'likes', target: { hash: 'b'.repeat(40) } });
  });
  it('cancels without an automatic retry and ignores a response after close', async () => {
    const pending = deferred<FollowsResponse>(); const later = deferred<FollowsResponse>();
    vi.mocked(getCastReactionPeople).mockReturnValueOnce(pending.promise).mockReturnValueOnce(later.promise);
    const options = props(); await render(<CastReactionPeople {...options} />);
    await click(button('Cancel')); expect(vi.mocked(getCastReactionPeople).mock.calls[0][0].signal?.aborted).toBe(true); expect(host.textContent).toContain('Loading cancelled.');
    await act(async () => pending.resolve({ users: [person(7)], next: {} })); expect(host.textContent).not.toContain('Person 7'); expect(getCastReactionPeople).toHaveBeenCalledOnce();
    await click(button('Try again')); await click(button('Close'));
    expect(vi.mocked(getCastReactionPeople).mock.calls[1][0].signal?.aborted).toBe(true); expect(options.onClose).toHaveBeenCalledOnce();
    await act(async () => later.resolve({ users: [person(8)], next: {} })); expect(host.textContent).not.toContain('Person 8');
  });
  it('stops cursor cycles, keeps the people already loaded, and permits a fresh read', async () => {
    vi.mocked(getCastReactionPeople).mockResolvedValueOnce({ users: [person(7)], next: { cursor: 'b25l' } }).mockResolvedValueOnce({ users: [], next: { cursor: 'dHdv' } }).mockResolvedValueOnce({ users: [person(8)], next: { cursor: 'b25l' } }).mockResolvedValueOnce({ users: [], next: {} });
    await render(<CastReactionPeople {...props()} />); await click(button('Load more profiles')); await click(button('Load more profiles'));
    expect(host.querySelectorAll('li')).toHaveLength(2); expect(host.textContent).toContain('repeated an earlier page'); expect(button('Load more profiles')).toBeUndefined();
    await click(button('Refresh profiles')); expect(host.querySelectorAll('li')).toHaveLength(0); expect(host.textContent).toContain('No likes were returned in this node view.');
    expect(vi.mocked(getCastReactionPeople).mock.calls[3][0].cursor).toBeUndefined();
  });
  it('bounds large node views without presenting discarded profiles as another page', async () => {
    vi.mocked(getCastReactionPeople).mockResolvedValueOnce({ users: Array.from({ length: 600 }, (_, index) => person(index + 10)), next: { cursor: 'b25l' } }).mockResolvedValueOnce({ users: Array.from({ length: 600 }, (_, index) => person(index + 610)), next: { cursor: 'dHdv' } });
    await render(<CastReactionPeople {...props()} />); await click(button('Load more profiles'));
    expect(host.querySelectorAll('li')).toHaveLength(1000); expect(button('Load more profiles')).toBeUndefined(); expect(host.textContent).toContain('reached its limit');
  });
  it('bounds empty continuing shard pages even when every cursor is different', async () => {
    let pages = 0;
    vi.mocked(getCastReactionPeople).mockImplementation(async () => ({ users: [], next: { cursor: btoa(`page-${++pages}`) } }));
    await render(<CastReactionPeople {...props()} />);
    for (let page = 1; page < 40; page++) await click(button('Load more profiles'));
    expect(getCastReactionPeople).toHaveBeenCalledTimes(40); expect(button('Load more profiles')).toBeUndefined(); expect(host.textContent).toContain('40 node pages');
  });
});
