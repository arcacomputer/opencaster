// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FollowListDialog, { type FollowPage } from './FollowListDialog';
import type { User } from '@opencaster/client-core/api';

const person = (fid: number): User => ({ fid, username: `person${fid}`, display_name: `Person ${fid}`, custody_address: '', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async (element: Parameters<Root['render']>[0]) => { await act(async () => root.render(element)); };
const button = (label: string) => [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === label)!;
async function click(element: HTMLButtonElement) { await act(async () => element.click()); }

describe('follow-list request identity', () => {
  it('preserves a pending list on metadata/callback rerenders and uses the current loader only for explicit pagination', async () => {
    const first = deferred<FollowPage>();
    const load = vi.fn().mockReturnValue(first.promise);
    const updatedLoad = vi.fn().mockResolvedValue({ users: [person(8)], next: {} });
    await render(<FollowListDialog user={person(10)} kind="followers" loadPage={load} onProfile={vi.fn()} onClose={vi.fn()} />);
    const signal = load.mock.calls[0][0].signal as AbortSignal;
    await render(<FollowListDialog user={{ ...person(10), display_name: 'Updated name' }} kind="followers" loadPage={updatedLoad} onProfile={vi.fn()} onClose={vi.fn()} />);
    expect(load).toHaveBeenCalledOnce(); expect(updatedLoad).not.toHaveBeenCalled(); expect(signal.aborted).toBe(false);
    await act(async () => first.resolve({ users: [person(7)], next: { cursor: '7' } }));
    expect(host.textContent).toContain('Person 7');
    await click(button('Load more profiles'));
    expect(updatedLoad).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fid: 10, kind: 'followers', cursor: '7' }));
    expect(host.querySelectorAll('.follow-list__people li')).toHaveLength(2);
  });

  it('aborts an old identity read and ignores its completion under another profile', async () => {
    const old = deferred<FollowPage>();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({ users: [person(8)], next: {} });
    const onClose = vi.fn();
    await render(<FollowListDialog user={person(10)} kind="following" loadPage={load} onProfile={vi.fn()} onClose={onClose} />);
    const signal = load.mock.calls[0][0].signal as AbortSignal;
    await render(<FollowListDialog user={person(11)} kind="following" loadPage={load} onProfile={vi.fn()} onClose={onClose} />);
    expect(signal.aborted).toBe(true);
    await act(async () => old.resolve({ users: [person(7)], next: {} }));
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ fid: 11 }));
    expect(host.textContent).toContain('Person 8'); expect(host.textContent).not.toContain('Person 7');
    await click(button('Close')); expect(onClose).toHaveBeenCalledOnce();
  });
});
