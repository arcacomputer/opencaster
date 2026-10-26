// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Composer, { type ComposerProps } from './Composer';
import { ApiError, getUser, searchUsers, type User } from '../lib/api';
import type { WalletSession } from '../lib/auth';
import { uploadMedia } from '../lib/media';
import { composerDraftScope, readComposerDraft, saveComposerDraft } from '../lib/composerDraft';
import type { CastPublicationEvent } from '../lib/pendingCasts';

vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(), getUser: vi.fn(), searchUsers: vi.fn() }));
vi.mock('../lib/media', () => ({ uploadMedia: vi.fn() }));
const user = (fid: number, username: string): User => ({ fid, username, custody_address: '', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 });
const imageUrl = `https://opencaster.org/media/${'c'.repeat(64)}`;
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((value, fail) => { resolve = value; reject = fail; }); return { promise, resolve, reject }; };
let container: HTMLDivElement; let root: Root; let session: WalletSession; let props: ComposerProps;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.resetAllMocks(); sessionStorage.clear();
  session = { fid: 1234, publicKey: 'a'.repeat(64), user: user(1234, 'isolated'), cast: vi.fn().mockResolvedValue({ hash: 'd'.repeat(40) }), authorizeMediaUpload: vi.fn() } as unknown as WalletSession;
  props = { session, onSignIn: vi.fn(), onPosted: vi.fn(), notify: vi.fn() };
  vi.mocked(searchUsers).mockResolvedValue({ users: [] }); vi.mocked(getUser).mockResolvedValue(user(20, 'alice')); vi.mocked(uploadMedia).mockResolvedValue({ url: imageUrl });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); sessionStorage.clear(); vi.unstubAllGlobals(); });
async function render(overrides: Partial<ComposerProps> = {}, key = 'same') { await act(async () => root.render(<Composer key={key} {...props} {...overrides} />)); }
const field = () => container.querySelector<HTMLTextAreaElement>('textarea')!;
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent?.trim() === label)!;
const tool = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
async function click(value: HTMLElement) { await act(async () => value.click()); }
async function drafts() { if (tool('Drafts').getAttribute('aria-expanded') !== 'true') await click(tool('Drafts')); }
async function type(value: string, caret = value.length) { const input = field(); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!; await act(async () => { setter.call(input, value); input.setSelectionRange(caret, caret); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function key(value: string, options: KeyboardEventInit = {}) { let native = true; await act(async () => { native = field().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options })); }); return native; }
async function waitSuggestions() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 230)); }); }
async function paste(files: File[]) { await act(async () => { const event = new Event('paste', { bubbles: true, cancelable: true }); Object.defineProperty(event, 'clipboardData', { value: { files } }); field().dispatchEvent(event); }); }

describe('isolated familiar composer behavior', () => {
  it('starts with one editor and compact tools while keeping the upload warning available before any action', async () => {
    await render();
    expect(container.querySelectorAll('textarea')).toHaveLength(1); expect(container.querySelector('input:not([type="file"])')).toBeNull(); expect(container.querySelector('.composer-panel')).toBeNull();
    expect(container.querySelector('[role="group"][aria-label="Composer tools"]')).not.toBeNull();
    for (const label of ['Add image', 'Mention a person', 'Insert emoji', 'Drafts']) { expect(tool(label)).toBeDefined(); expect(tool(label).title).not.toBe(''); }
    expect(button('Save draft')).toBeUndefined(); expect(container.textContent).not.toContain('Saved only in this browser tab');
    const notice = container.querySelector('.composer-media-note > p')!;
    expect(notice.textContent).toBe('Uploads are public immediately; photo metadata is kept.');
    expect(tool('Add image').getAttribute('aria-describedby')).toBe(notice.id);
    expect(container.querySelector('input[type="file"]')?.getAttribute('aria-describedby')).toBe(notice.id);
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.tabIndex).toBe(-1);
    expect(uploadMedia).not.toHaveBeenCalled(); expect(session.cast).not.toHaveBeenCalled();
  });
  it('keeps the guest editor simple and requests sign-in only on an explicit write or attachment action', async () => {
    await render({ session: null }); expect(field().readOnly).toBe(true); expect(props.onSignIn).not.toHaveBeenCalled();
    expect(await key('Tab')).toBe(true); expect(props.onSignIn).not.toHaveBeenCalled();
    await key('h'); expect(props.onSignIn).toHaveBeenCalledOnce();
    await click(tool('Add image')); expect(props.onSignIn).toHaveBeenCalledTimes(2);
    await click(tool('Media info')); expect(container.querySelector('.composer-panel')?.textContent).toContain('5 MiB'); expect(props.onSignIn).toHaveBeenCalledTimes(2);
    expect(uploadMedia).not.toHaveBeenCalled(); expect(session.cast).not.toHaveBeenCalled();
  });
  it('finds an exact FID only in the disclosed mention panel and returns the selected mention to the editor', async () => {
    await render(); await type('Hello '); await click(tool('Mention a person'));
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Mention a username or FID"]')!;
    expect(document.activeElement).toBe(input);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '20'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })); });
    expect(getUser).not.toHaveBeenCalled();
    await click(button('Find mention')); expect(getUser).toHaveBeenCalledWith({ fid: 20 }, expect.any(AbortSignal));
    expect(session.cast).not.toHaveBeenCalled(); await click(button('Add @alice'));
    expect(field().value).toBe('Hello @alice '); expect(container.querySelector('.composer-panel')).toBeNull();
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); }); expect(document.activeElement).toBe(field());
    await click(button('Cast')); expect(session.cast).toHaveBeenCalledWith('Hello  ', undefined, expect.objectContaining({ mentions: [20], mentionsPositions: [6] }));
  });
  it('inserts a local emoji at the selected text range and preserves the editor caret without a network request', async () => {
    await render(); await type('Before OLD after'); field().setSelectionRange(7, 10);
    await click(tool('Insert emoji')); await click(tool('Insert heart'));
    expect(field().value).toBe('Before ❤️ after'); expect(container.querySelector('.composer-panel')).toBeNull();
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    expect(document.activeElement).toBe(field()); expect(field().selectionStart).toBe('Before ❤️'.length); expect(field().selectionEnd).toBe('Before ❤️'.length);
    expect(searchUsers).not.toHaveBeenCalled(); expect(getUser).not.toHaveBeenCalled(); expect(uploadMedia).not.toHaveBeenCalled(); expect(session.cast).not.toHaveBeenCalled();
  });
  it('dismisses composer panels with Escape locally, restores trigger focus, and cancels a hidden mention lookup', async () => {
    const escaped = vi.fn(); const lookup = deferred<User>(); vi.mocked(getUser).mockReturnValue(lookup.promise);
    await act(async () => root.render(<div onKeyDown={escaped}><Composer {...props} /></div>)); await type('Keep my current draft');
    const emoji = tool('Insert emoji'); emoji.focus(); await click(emoji);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => { emoji.dispatchEvent(escape); });
    expect(escape.defaultPrevented).toBe(true); expect(escaped).not.toHaveBeenCalled(); expect(document.activeElement).toBe(tool('Insert emoji')); expect(field().value).toBe('Keep my current draft');
    await click(tool('Mention a person')); const input = container.querySelector<HTMLInputElement>('input[aria-label="Mention a username or FID"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'alice'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await click(button('Find mention')); const signal = vi.mocked(getUser).mock.calls[0][1]!;
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(signal.aborted).toBe(true); expect(document.activeElement).toBe(tool('Mention a person')); expect(escaped).not.toHaveBeenCalled();
    await act(async () => lookup.resolve(user(20, 'alice'))); expect(button('Add @alice')).toBeUndefined(); expect(container.querySelector('.composer-panel')).toBeNull(); expect(field().value).toBe('Keep my current draft');
  });
  it('keeps the UTF-8 limit authoritative when an emoji pushes the editor over its byte budget', async () => {
    await render(); await type('🙂'.repeat(256)); expect(button('Cast').disabled).toBe(false);
    await click(tool('Insert emoji')); await click(tool('Insert fire'));
    expect(container.querySelector('.composer-size')?.getAttribute('aria-label')).toBe('1028 of 1024 UTF-8 bytes'); expect(button('Cast').disabled).toBe(true);
    await key('Enter', { ctrlKey: true }); expect(session.cast).not.toHaveBeenCalled();
  });
  it('debounces inline mentions, selects with arrows/Enter, and submits only the explicitly selected FID', async () => {
    vi.mocked(searchUsers).mockResolvedValue({ users: [user(20, 'bob'), user(21, 'bobby')] });
    await render(); await type('Hi @bo'); expect(searchUsers).not.toHaveBeenCalled(); await waitSuggestions();
    expect(searchUsers).toHaveBeenCalledWith(expect.objectContaining({ query: 'bo', limit: 5, signal: expect.any(AbortSignal) }));
    await key('ArrowDown'); await key('Enter');
    expect(field().value).toBe('Hi @bobby '); expect(session.cast).not.toHaveBeenCalled();
    await click(button('Cast'));
    expect(session.cast).toHaveBeenCalledWith('Hi  ', undefined, expect.objectContaining({ mentions: [21], mentionsPositions: [3] }));
  });
  it('cancels old mention searches and ignores a late response after the query changes', async () => {
    const first = deferred<{ users: User[] }>(); const second = deferred<{ users: User[] }>();
    vi.mocked(searchUsers).mockImplementation(options => options.query === 'al' ? first.promise : second.promise);
    await render(); await type('@al'); await waitSuggestions(); const oldSignal = vi.mocked(searchUsers).mock.calls[0][0].signal!;
    await type('@bo'); await waitSuggestions(); expect(oldSignal.aborted).toBe(true);
    await act(async () => second.resolve({ users: [user(20, 'bob')] })); await act(async () => first.resolve({ users: [user(21, 'alice')] }));
    expect(container.querySelector('[role="listbox"]')?.textContent).toContain('@bob'); expect(container.querySelector('[role="listbox"]')?.textContent).not.toContain('@alice');
  });
  it('preserves literal emails and URLs instead of searching them as mentions', async () => {
    await render(); await type('mail@example'); await waitSuggestions(); await type('https://example.com/@alice'); await waitSuggestions(); expect(searchUsers).not.toHaveBeenCalled();
  });
  it('dismisses a pending mention menu with Escape and preserves native Shift+Tab navigation', async () => {
    const pending = deferred<{ users: User[] }>(); vi.mocked(searchUsers).mockReturnValue(pending.promise);
    await render(); await type('@al'); await waitSuggestions(); await key('Escape');
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    await act(async () => pending.resolve({ users: [user(20, 'alice')] })); expect(container.querySelector('[role="listbox"]')).toBeNull();
    vi.mocked(searchUsers).mockResolvedValue({ users: [user(20, 'alice')] }); await type('@ali'); await waitSuggestions();
    expect(await key('Tab', { shiftKey: true })).toBe(true); expect(field().value).toBe('@ali'); expect(session.cast).not.toHaveBeenCalled();
  });
  it('supports Cmd/Ctrl+Enter while ignoring IME composition, repeats, empty drafts and a second pending submission', async () => {
    const posting = deferred<{ hash: string }>(); vi.mocked(session.cast).mockReturnValue(posting.promise);
    await render(); await key('Enter', { ctrlKey: true }); expect(session.cast).not.toHaveBeenCalled();
    await type('An isolated keyboard cast'); await key('Enter', { metaKey: true, isComposing: true }); await key('Enter', { ctrlKey: true, repeat: true }); expect(session.cast).not.toHaveBeenCalled();
    expect(await key('Enter')).toBe(true); await key('Enter', { metaKey: true }); await key('Enter', { ctrlKey: true }); expect(session.cast).toHaveBeenCalledOnce();
    await act(async () => posting.resolve({ hash: 'd'.repeat(40) })); expect(props.onPosted).toHaveBeenCalledOnce();
  });
  it('reports a local publication before awaiting the cast and replaces its pending status with the canonical receipt', async () => {
    const posting = deferred<{ hash: string }>(); const onPublication = vi.fn();
    const quote = { hash: 'e'.repeat(40), author: user(20, 'alice'), text: 'Quoted text' } as ComposerProps['quote'];
    vi.mocked(session.cast).mockImplementation(() => { expect(onPublication).toHaveBeenCalledOnce(); return posting.promise; });
    await render({ onPublication, quote, parentUrl: 'https://example.com/channel/one' });
    await paste([new File(['synthetic'], 'image.png', { type: 'image/png' })]);
    await type('An immediate local cast'); const before = Date.now(); await click(button('Quote'));
    const event = onPublication.mock.calls[0][0] as CastPublicationEvent;
    expect(event.type).toBe('started'); if (event.type !== 'started') throw new Error('Expected a started event.');
    expect(event.publication).toEqual({ id: expect.any(String), sessionKey: session.publicKey, author: session.user, text: 'An immediate local cast', images: [imageUrl], parentUrl: 'https://example.com/channel/one', quote, timestamp: expect.any(String), status: 'publishing' });
    expect(event.publication.id).not.toBe(''); expect(Date.parse(event.publication.timestamp)).toBeGreaterThanOrEqual(before); expect(Date.parse(event.publication.timestamp)).toBeLessThanOrEqual(Date.now());
    expect(props.onPosted).not.toHaveBeenCalled(); expect(field().value).toBe('An immediate local cast');
    await act(async () => posting.resolve({ hash: '0x' + 'f'.repeat(40) }));
    expect(onPublication.mock.calls[1][0]).toEqual({ type: 'submitted', id: event.publication.id, hash: '0x' + 'f'.repeat(40) });
    expect(onPublication).toHaveBeenCalledTimes(2); expect(field().value).toBe(''); expect(props.onPosted).toHaveBeenCalledOnce();
  });
  it('keeps human mention text and the reply destination in its local publication snapshot', async () => {
    const onPublication = vi.fn(); const parent = { hash: 'e'.repeat(40), author: user(20, 'alice') } as ComposerProps['parent'];
    vi.mocked(searchUsers).mockResolvedValue({ users: [user(21, 'bob')] });
    await render({ onPublication, parent }); await type('Hello @bo'); await waitSuggestions(); await key('Enter'); await click(button('Reply'));
    expect(session.cast).toHaveBeenCalledWith('Hello  ', { fid: 20, hash: 'e'.repeat(40) }, expect.objectContaining({ mentions: [21], mentionsPositions: [6] }));
    expect(onPublication.mock.calls[0][0]).toMatchObject({ type: 'started', publication: { text: 'Hello @bob ', parent: { fid: 20, hash: 'e'.repeat(40) } } });
  });
  it.each([
    ['failed', new ApiError('This cast was rejected.', 400, 'invalid_cast')],
    ['unknown', new ApiError('Unknown receipt.', 504, 'submission_unknown')],
  ] as const)('reports %s without clearing the draft or automatically submitting again', async (typeOfEvent, error) => {
    const onPublication = vi.fn(); vi.mocked(session.cast).mockRejectedValue(error);
    await render({ onPublication }); await type('Retain this draft'); await drafts(); await click(button('Save draft')); await click(button('Cast'));
    const started = onPublication.mock.calls[0][0] as Extract<CastPublicationEvent, { type: 'started' }>;
    expect(onPublication.mock.calls[1][0]).toEqual({ type: typeOfEvent, id: started.publication.id });
    expect(onPublication).toHaveBeenCalledTimes(2); expect(field().value).toBe('Retain this draft'); expect(readComposerDraft(composerDraftScope(session))?.text).toBe('Retain this draft');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(typeOfEvent === 'unknown' ? 'Check your profile' : 'This cast was rejected.');
    expect(session.cast).toHaveBeenCalledOnce(); expect(props.onPosted).not.toHaveBeenCalled();
  });
  it('reports the existing publication after its composer unmounts without invoking stale draft callbacks', async () => {
    const posting = deferred<{ hash: string }>(); const onPublication = vi.fn(); vi.mocked(session.cast).mockReturnValue(posting.promise);
    await render({ onPublication }); await type('Finish after closing'); await click(button('Cast'));
    const started = onPublication.mock.calls[0][0] as Extract<CastPublicationEvent, { type: 'started' }>;
    await act(async () => root.render(null)); await act(async () => posting.resolve({ hash: 'd'.repeat(40) }));
    expect(onPublication.mock.calls[1][0]).toEqual({ type: 'submitted', id: started.publication.id, hash: 'd'.repeat(40) });
    expect(onPublication).toHaveBeenCalledTimes(2); expect(props.notify).not.toHaveBeenCalled(); expect(props.onPosted).not.toHaveBeenCalled();
  });
  it.each(['submitted', 'unknown', 'failed'] as const)('reports %s to the original publication callback after an account and destination change', async outcome => {
    const posting = deferred<{ hash: string }>(); const onPublication = vi.fn(); const newerPublication = vi.fn(); vi.mocked(session.cast).mockReturnValue(posting.promise);
    await render({ onPublication, parentUrl: 'https://example.com/channel/one' }); await type('Original account and channel'); await click(button('Cast'));
    const started = onPublication.mock.calls[0][0] as Extract<CastPublicationEvent, { type: 'started' }>;
    await render({ onPublication: newerPublication, session: { ...session, fid: 1235, publicKey: 'b'.repeat(64), user: user(1235, 'another') }, parentUrl: 'https://example.com/channel/two' }); await type('New account draft');
    await act(async () => { if (outcome === 'submitted') posting.resolve({ hash: 'd'.repeat(40) }); else posting.reject(new ApiError('Submission ended.', outcome === 'unknown' ? 504 : 400, outcome === 'unknown' ? 'submission_unknown' : 'invalid_cast')); });
    expect(onPublication.mock.calls[1][0]).toEqual({ type: outcome, id: started.publication.id, ...(outcome === 'submitted' ? { hash: 'd'.repeat(40) } : {}) });
    expect(onPublication).toHaveBeenCalledTimes(2); expect(newerPublication).not.toHaveBeenCalled(); expect(field().value).toBe('New account draft'); expect(props.notify).not.toHaveBeenCalled(); expect(props.onPosted).not.toHaveBeenCalled();
  });
  it('emits a single publication for repeated clicks and keyboard shortcuts while a cast is pending', async () => {
    const posting = deferred<{ hash: string }>(); const onPublication = vi.fn(); vi.mocked(session.cast).mockReturnValue(posting.promise);
    await render({ onPublication }); await type('Only one explicit attempt');
    await act(async () => { button('Cast').click(); button('Cast').click(); field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(session.cast).toHaveBeenCalledOnce(); expect(onPublication).toHaveBeenCalledOnce();
    await act(async () => posting.resolve({ hash: 'd'.repeat(40) })); expect(onPublication).toHaveBeenCalledTimes(2); expect(props.onPosted).toHaveBeenCalledOnce();
  });
  it('keeps publication callback errors from preventing a cast or turning its acknowledgement into an error', async () => {
    const onPublication = vi.fn<(event: CastPublicationEvent) => void>(() => { throw new Error('Local publication display failed.'); });
    await render({ onPublication }); await type('Network result remains authoritative'); await click(button('Cast'));
    expect(session.cast).toHaveBeenCalledOnce(); expect(onPublication).toHaveBeenCalledTimes(2); expect(onPublication.mock.calls.map(([event]) => event.type)).toEqual(['started', 'submitted']);
    expect(field().value).toBe(''); expect(container.querySelector('[role="alert"]')).toBeNull(); expect(props.onPosted).toHaveBeenCalledOnce();
  });
  it('uploads one pasted image through the existing signed upload helper and respects quote attachment slots', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'clipboard.png', { type: 'image/png' });
    const quote = { hash: 'e'.repeat(40), author: user(20, 'alice'), text: 'Quoted text' } as ComposerProps['quote'];
    await render({ quote }); await paste([file]); expect(uploadMedia).toHaveBeenCalledWith(file, expect.any(Function), expect.any(AbortSignal));
    expect(button('Add image').disabled).toBe(true); await paste([file]); expect(uploadMedia).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('maximum number of images'); expect(container.textContent).toContain('Uploads are public immediately');
  });
  it('rejects a multi-image paste without silently uploading a subset', async () => {
    const file = new File(['synthetic'], 'clipboard.png', { type: 'image/png' }); await render(); await paste([file, file]);
    expect(uploadMedia).not.toHaveBeenCalled(); expect(container.querySelector('[role="alert"]')?.textContent).toContain('one image at a time');
  });
  it('lets a cancelled upload retry and ignores the old uploader’s late public URL', async () => {
    const old = deferred<{ url: string }>(); const newer = `https://opencaster.org/media/${'f'.repeat(64)}`;
    vi.mocked(uploadMedia).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ url: newer });
    await render(); await paste([new File(['old'], 'old.png', { type: 'image/png' })]);
    const signal = vi.mocked(uploadMedia).mock.calls[0][2]!; expect(tool('Add image').disabled).toBe(true);
    await click(button('Cancel upload')); expect(signal.aborted).toBe(true); expect(tool('Add image').disabled).toBe(false);
    await paste([new File(['new'], 'new.png', { type: 'image/png' })]); await act(async () => old.resolve({ url: imageUrl }));
    expect([...container.querySelectorAll('.composer-attachment > img')].map(image => image.getAttribute('src'))).toEqual([newer]); expect(session.cast).not.toHaveBeenCalled();
  });
  it('aborts an old upload when the destination changes and never inserts its late URL into the new draft', async () => {
    const uploading = deferred<{ url: string }>(); vi.mocked(uploadMedia).mockReturnValue(uploading.promise);
    await render({ parentUrl: 'https://example.com/channel/one' }); await paste([new File(['synthetic'], 'image.png', { type: 'image/png' })]);
    const signal = vi.mocked(uploadMedia).mock.calls[0][2]!;
    await render({ parentUrl: 'https://example.com/channel/two' }); expect(signal.aborted).toBe(true);
    await act(async () => uploading.resolve({ url: imageUrl })); expect(container.querySelector('.composer-attachment')).toBeNull(); expect(field().value).toBe('');
  });
  it('offers an explicit restore without automatically filling, uploading or publishing a saved draft', async () => {
    const scope = composerDraftScope(session); saveComposerDraft(scope, { text: 'Hello @alice', mentions: [{ fid: 20, username: 'alice' }], images: [imageUrl] });
    await render(); expect(field().value).toBe(''); expect(session.cast).not.toHaveBeenCalled(); expect(uploadMedia).not.toHaveBeenCalled();
    expect(tool('Drafts').title).toContain('saved draft available'); await drafts();
    await click(button('Restore saved draft')); expect(field().value).toBe('Hello @alice'); expect(container.querySelector('.composer-attachment img')?.getAttribute('src')).toBe(imageUrl); expect(session.cast).not.toHaveBeenCalled();
    await click(button('Discard saved draft')); expect(readComposerDraft(scope)).toBeUndefined(); expect(field().value).toBe('Hello @alice'); expect(uploadMedia).not.toHaveBeenCalled();
  });
  it('requires confirmation before replacing current work with a saved draft', async () => {
    saveComposerDraft(composerDraftScope(session), { text: 'Saved text', mentions: [], images: [] });
    await render(); await type('Unsaved current text'); await drafts(); await click(button('Restore saved draft'));
    expect(field().value).toBe('Unsaved current text'); await click(button('Replace current draft')); expect(field().value).toBe('Saved text'); expect(session.cast).not.toHaveBeenCalled();
  });
  it('keeps saved drafts isolated by account and exact composer context', async () => {
    await render(); await type('Explicitly saved text'); await drafts(); await click(button('Save draft'));
    expect(readComposerDraft(composerDraftScope(session))?.text).toBe('Explicitly saved text');
    await render({ session: { ...session, publicKey: 'f'.repeat(64) } }); await drafts(); expect(button('Restore saved draft')).toBeDefined(); expect(field().value).toBe('');
    await click(button('Restore saved draft')); expect(field().value).toBe('Explicitly saved text'); expect(session.cast).not.toHaveBeenCalled();
    const other = { ...session, fid: 1235, publicKey: 'b'.repeat(64), user: user(1235, 'another') };
    await render({ session: other }); await drafts(); expect(field().value).toBe(''); expect(button('Restore saved draft')).toBeUndefined();
    await render({ parentUrl: 'https://example.com/channel/another' }); await drafts(); expect(button('Restore saved draft')).toBeUndefined();
    await render(); await drafts(); expect(button('Restore saved draft')).toBeDefined(); expect(field().value).toBe('');
  });
  it('retains text and its saved copy after an uncertain network submission and never retries itself', async () => {
    vi.mocked(session.cast).mockRejectedValue(new ApiError('Unknown receipt.', 504, 'submission_unknown'));
    await render(); await type('Keep this uncertain draft'); await drafts(); await click(button('Save draft')); await click(button('Cast'));
    expect(field().value).toBe('Keep this uncertain draft'); expect(readComposerDraft(composerDraftScope(session))?.text).toBe('Keep this uncertain draft'); expect(container.querySelector('[role="alert"]')?.textContent).toContain('Check your profile'); expect(session.cast).toHaveBeenCalledOnce(); expect(props.onPosted).not.toHaveBeenCalled();
  });
  it('keeps editing and publishing available when browser draft storage cannot save', async () => {
    const storage = sessionStorage;
    vi.stubGlobal('sessionStorage', { getItem: storage.getItem.bind(storage), clear: storage.clear.bind(storage), setItem: () => { throw new DOMException('Draft storage unavailable.', 'QuotaExceededError'); }, removeItem: storage.removeItem.bind(storage) });
    await render(); await type('A draft with unavailable storage'); await drafts(); await click(button('Save draft'));
    expect(container.textContent).toContain('Draft storage unavailable.'); expect(field().value).toBe('A draft with unavailable storage');
    await click(button('Cast')); expect(session.cast).toHaveBeenCalledOnce(); expect(props.onPosted).toHaveBeenCalledOnce();
  });
  it('does not remove a newer saved revision or call a stale completion handler after an older composer unmounts', async () => {
    const posting = deferred<{ hash: string }>(); vi.mocked(session.cast).mockReturnValue(posting.promise); const scope = composerDraftScope(session);
    saveComposerDraft(scope, { text: 'Older saved draft', mentions: [], images: [] }); await render(); await drafts(); await click(button('Restore saved draft')); await click(button('Cast'));
    saveComposerDraft(scope, { text: 'Newer saved draft', mentions: [], images: [] }); await render({}, 'replacement');
    await act(async () => posting.resolve({ hash: 'd'.repeat(40) })); expect(readComposerDraft(scope)?.text).toBe('Newer saved draft'); expect(props.onPosted).not.toHaveBeenCalled(); expect(field().value).toBe('');
  });
});
