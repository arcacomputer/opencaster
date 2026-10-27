// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CastLinkLookup, { type CastLinkLookupProps } from './CastLinkLookup';
import { resolveCastAlias, type Cast, type CastAliasContinuation, type CastAliasResult, type User } from '../lib/api';

vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), resolveCastAlias: vi.fn() }));
const author: User = { fid: 20, username: 'alice', custody_address: '', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 };
const candidate = (suffix: string): Cast => ({ hash: `0x12345678${suffix.repeat(32)}`, author, text: `Candidate ${suffix}`, timestamp: '2026-10-22T12:00:00Z', embeds: [], reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 } });
const one = candidate('a'); const two = candidate('b');
const continuation: CastAliasContinuation = { authorIdentifier: 'alice', hashPrefix: '0x12345678', fid: 20, cursor: 'bmV4dA==', seenCursors: [], hashes: [], scanned: 1000 };
const result = (overrides: Partial<CastAliasResult> = {}): CastAliasResult => ({ author, candidates: [one], complete: false, scanned: 1000, continuation, ...overrides });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let container: HTMLDivElement; let root: Root; let props: CastLinkLookupProps;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.resetAllMocks();
  props = { authorIdentifier: 'alice', hashPrefix: '0x12345678', renderCast: cast => <p>{cast.text}</p>, onOpen: vi.fn(), onResolved: vi.fn() };
  vi.mocked(resolveCastAlias).mockResolvedValue(result()); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(overrides: Partial<CastLinkLookupProps> = {}) { await act(async () => root.render(<CastLinkLookup {...props} {...overrides} />)); }
async function click(value: Element) { expect(value).toBeTruthy(); await act(async () => value.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))); }
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent?.trim() === label)!;

describe('direct author-scoped cast link resolution', () => {
  it('opens a verified progress match immediately, aborts before navigation and ignores late progress and completion', async () => {
    const pending = deferred<CastAliasResult>(); vi.mocked(resolveCastAlias).mockReturnValueOnce(pending.promise);
    await render(); const request = vi.mocked(resolveCastAlias).mock.calls[0][0];
    vi.mocked(props.onResolved).mockImplementation(() => expect(request.signal!.aborted).toBe(true));
    await act(async () => request.onProgress!(result({ continuation: undefined, scanned: 250 })));
    expect(props.onResolved).toHaveBeenCalledExactlyOnceWith(one);
    expect(container.textContent).toBe('Opening cast…');
    expect(container.querySelector('a, button')).toBeNull();
    expect(container.textContent).not.toContain('You can open'); expect(container.textContent).not.toContain('Other matches');
    await act(async () => {
      request.onProgress!(result({ candidates: [one, two], continuation: undefined, scanned: 500 }));
      pending.resolve(result({ candidates: [one, two], complete: true, continuation: undefined }));
    });
    expect(props.onResolved).toHaveBeenCalledTimes(1); expect(props.onOpen).not.toHaveBeenCalled();
    expect(container.textContent).toBe('Opening cast…');
  });

  it.each([
    { complete: false, continuation },
    { complete: true, continuation: undefined },
    { complete: false, limited: true, continuation: undefined },
  ])('opens a single final match without requiring exhausted history: %j', async overrides => {
    vi.mocked(resolveCastAlias).mockResolvedValueOnce(result(overrides));
    vi.mocked(props.onResolved).mockImplementation(() => expect(vi.mocked(resolveCastAlias).mock.calls[0][0].signal!.aborted).toBe(true));
    await render(); expect(props.onResolved).toHaveBeenCalledExactlyOnceWith(one);
    expect(container.querySelector('.cast-link-lookup__candidate')).toBeNull(); expect(container.querySelector('a, button')).toBeNull();
  });

  it('handles a rejected lookup promise after successful progress without showing cancellation or retry UI', async () => {
    const pending = deferred<CastAliasResult>(); vi.mocked(resolveCastAlias).mockReturnValueOnce(pending.promise);
    await render(); const request = vi.mocked(resolveCastAlias).mock.calls[0][0];
    await act(async () => request.onProgress!(result({ continuation: undefined, scanned: 250 })));
    await act(async () => pending.reject(new DOMException('Lookup stopped', 'AbortError')));
    expect(props.onResolved).toHaveBeenCalledExactlyOnceWith(one);
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.textContent).toBe('Opening cast…');
  });

  it('ignores malformed progress before opening a valid author/hash match', async () => {
    const pending = deferred<CastAliasResult>(); vi.mocked(resolveCastAlias).mockReturnValueOnce(pending.promise);
    await render(); const progress = vi.mocked(resolveCastAlias).mock.calls[0][0].onProgress!;
    await act(async () => {
      progress(null as unknown as CastAliasResult);
      progress(result({ complete: true, continuation: undefined }));
      progress(result({ candidates: [{ ...one, author: { ...author, fid: 30 } }], continuation: undefined }));
      progress(result({ candidates: [{ ...one, hash: `0x87654321${'a'.repeat(32)}` }], continuation: undefined }));
      progress(result({ candidates: [{ ...one, hash: '0x12345678' }], continuation: undefined }));
      progress(result({ continuation: undefined, scanned: Number.NaN }));
      progress(result());
    });
    expect(props.onResolved).not.toHaveBeenCalled(); expect(container.querySelector('.cast-link-lookup__candidate')).toBeNull();
    await act(async () => progress(result({ continuation: undefined, scanned: 250 })));
    expect(props.onResolved).toHaveBeenCalledExactlyOnceWith(one);
  });

  it('shows a chooser only for multiple returned matches and uses exact full-hash links', async () => {
    const pending = deferred<CastAliasResult>(); vi.mocked(resolveCastAlias).mockReturnValueOnce(pending.promise);
    await render(); const request = vi.mocked(resolveCastAlias).mock.calls[0][0];
    await act(async () => request.onProgress!(result({ candidates: [one, two], continuation: undefined, scanned: 250 })));
    expect(container.textContent).toContain('Choose a cast'); expect(props.onResolved).not.toHaveBeenCalled();
    const links = [...container.querySelectorAll<HTMLAnchorElement>('a')];
    expect(links.map(link => link.getAttribute('href'))).toEqual([`/alice/${one.hash}`, `/alice/${two.hash}`]);
    vi.mocked(props.onOpen).mockImplementation(() => expect(request.signal!.aborted).toBe(true));
    await click(links[1]); expect(props.onOpen).toHaveBeenCalledExactlyOnceWith(two);
    await act(async () => pending.resolve(result({ complete: true, continuation: undefined })));
    expect(props.onResolved).not.toHaveBeenCalled();
  });

  it('keeps modified chooser clicks as exact links without cancelling the lookup', async () => {
    const pending = deferred<CastAliasResult>(); vi.mocked(resolveCastAlias).mockReturnValueOnce(pending.promise);
    await render(); const request = vi.mocked(resolveCastAlias).mock.calls[0][0];
    await act(async () => request.onProgress!(result({ candidates: [one, two], continuation: undefined, scanned: 250 })));
    const link = container.querySelector<HTMLAnchorElement>('a')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    await act(async () => link.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false); expect(link.getAttribute('href')).toBe(`/alice/${one.hash}`);
    expect(request.signal!.aborted).toBe(false); expect(props.onOpen).not.toHaveBeenCalled(); expect(props.onResolved).not.toHaveBeenCalled();
  });

  it('ignores previous-route progress and final results after navigating to another author', async () => {
    const old = deferred<CastAliasResult>(); const current = deferred<CastAliasResult>();
    vi.mocked(resolveCastAlias).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await render(); const request = vi.mocked(resolveCastAlias).mock.calls[0][0];
    await render({ authorIdentifier: 'bob' }); expect(request.signal!.aborted).toBe(true);
    await act(async () => {
      request.onProgress!(result({ continuation: undefined, scanned: 250 }));
      old.resolve(result({ complete: true, continuation: undefined }));
    });
    expect(props.onResolved).not.toHaveBeenCalled(); expect(container.textContent).toContain('Loading cast');
    expect(container.querySelector('.cast-link-lookup__candidate')).toBeNull();
  });

  it('shows an honest exhausted no-match state instead of navigating', async () => {
    vi.mocked(resolveCastAlias).mockResolvedValueOnce(result({ candidates: [], complete: true, continuation: undefined }));
    await render(); expect(container.textContent).toContain('No cast matched'); expect(props.onResolved).not.toHaveBeenCalled();
    expect(button('Search older casts')).toBeUndefined();
  });

  it('searches older history explicitly when no match has been found, then opens the verified result', async () => {
    vi.mocked(resolveCastAlias).mockResolvedValueOnce(result({ candidates: [] })).mockResolvedValueOnce(result({ complete: false, continuation, scanned: 1500 }));
    await render(); expect(props.onResolved).not.toHaveBeenCalled(); await click(button('Search older casts'));
    expect(vi.mocked(resolveCastAlias).mock.calls[1][0].continuation).toBe(continuation);
    expect(props.onResolved).toHaveBeenCalledExactlyOnceWith(one);
  });

  it('preserves actual multiple matches through a later read error and retries the same continuation', async () => {
    vi.mocked(resolveCastAlias).mockResolvedValueOnce(result({ candidates: [one, two] })).mockRejectedValueOnce(new Error('The Hypersnap node is temporarily unavailable.')).mockResolvedValueOnce(result({ candidates: [one, two], complete: true, continuation: undefined }));
    await render(); await click(button('Search older casts'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('temporarily unavailable'); expect(container.textContent).toContain('Candidate a');
    expect(props.onResolved).not.toHaveBeenCalled(); await click(button('Try again'));
    expect(vi.mocked(resolveCastAlias).mock.calls[2][0].continuation).toBe(continuation); expect(container.textContent).toContain('Candidate b');
  });

  it('cancels and resumes the same no-match continuation without accepting stale completion', async () => {
    const old = deferred<CastAliasResult>();
    vi.mocked(resolveCastAlias).mockResolvedValueOnce(result({ candidates: [] })).mockReturnValueOnce(old.promise).mockResolvedValueOnce(result({ candidates: [one, two], complete: true, continuation: undefined }));
    await render(); await click(button('Search older casts')); const signal = vi.mocked(resolveCastAlias).mock.calls[1][0].signal!;
    await click(button('Cancel lookup')); expect(signal.aborted).toBe(true);
    await click(button('Resume lookup')); expect(vi.mocked(resolveCastAlias).mock.calls[2][0].continuation).toBe(continuation);
    await act(async () => old.resolve(result({ complete: true, continuation: undefined })));
    expect(container.textContent).toContain('Candidate b'); expect(props.onResolved).not.toHaveBeenCalled();
  });

  it('discloses a terminal no-match cap and keeps retries separate from automatic opening', async () => {
    vi.mocked(resolveCastAlias).mockResolvedValueOnce(result({ candidates: [], limited: true, continuation: undefined, scanned: 100000 }));
    await render(); expect(container.textContent).toContain('reached its history limit'); expect(button('Search older casts')).toBeUndefined(); expect(props.onResolved).not.toHaveBeenCalled();
  });

  it('keeps one lookup across callback rerenders and delivers only to the current completion handler', async () => {
    const pending = deferred<CastAliasResult>(); vi.mocked(resolveCastAlias).mockReturnValueOnce(pending.promise);
    await render(); const signal = vi.mocked(resolveCastAlias).mock.calls[0][0].signal!;
    const onResolved = vi.fn(); await render({ onResolved });
    expect(resolveCastAlias).toHaveBeenCalledOnce(); expect(signal.aborted).toBe(false);
    await act(async () => pending.resolve(result({ complete: false })));
    expect(onResolved).toHaveBeenCalledExactlyOnceWith(one); expect(props.onResolved).not.toHaveBeenCalled(); expect(signal.aborted).toBe(true);
  });

  it('rejects an unrelated final candidate before rendering or opening it', async () => {
    vi.mocked(resolveCastAlias).mockResolvedValueOnce(result({ candidates: [{ ...one, author: { ...author, fid: 30 } }], complete: true, continuation: undefined }));
    await render(); expect(container.querySelector('[role="alert"]')?.textContent).toContain('does not match this link');
    expect(container.textContent).not.toContain('Candidate a'); expect(props.onResolved).not.toHaveBeenCalled();
  });
});
