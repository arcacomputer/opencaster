// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { getCast, getChannels, getConversation, getFeed, getInfo, getProfileFeed, getUser, type Cast, type ConversationNode, type User } from './lib/api';
import { contentPreferencesKey, emptyContentPreferences, hideCast } from './lib/contentPreferences';

// Exercise the production conversation, cards, mention rendering and quotes.
// All public responses are isolated fixtures; no account is connected.
vi.mock('./lib/api', async original => ({
  ...await original<typeof import('./lib/api')>(),
  getCast: vi.fn(), getChannels: vi.fn(), getConversation: vi.fn(), getFeed: vi.fn(), getInfo: vi.fn(), getProfileFeed: vi.fn(), getUser: vi.fn(),
}));

const person = (fid: number): User => ({ fid, username: `person${fid}.eth`, display_name: `Person ${fid}`, custody_address: '', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 });
const cast = (letter: string, author: number, text: string): Cast => ({ hash: `0x${letter.repeat(40)}`, author: person(author), text, timestamp: '2026-10-23T12:00:00.000Z', embeds: [], reactions: { likes_count: 5, recasts_count: 1 }, replies: { count: 1 } });
const imageUrl = 'https://images.example/attached.png';
const videoUrl = 'https://video.example/watch?id=123';
let conversationCast: Cast;
let replies: ConversationNode[];
let quotedCasts: Map<string, Cast>;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('opencaster.explore', '1');
  history.replaceState(null, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  conversationCast = cast('a', 20, 'An isolated public conversation');
  replies = [];
  quotedCasts = new Map();
  vi.mocked(getFeed).mockResolvedValue({ casts: [], next: {} });
  vi.mocked(getProfileFeed).mockResolvedValue({ casts: [], next: {} });
  vi.mocked(getUser).mockImplementation(async lookup => person(lookup.fid ?? 20));
  vi.mocked(getChannels).mockResolvedValue({ channels: [], next: {} });
  vi.mocked(getInfo).mockResolvedValue({ version: 'isolated-conversation-test' });
  vi.mocked(getConversation).mockImplementation(async () => ({ cast: conversationCast, replies }));
  vi.mocked(getCast).mockImplementation(async hash => {
    const quoted = quotedCasts.get(hash.replace(/^0x/, ''));
    if (!quoted) throw new Error('This isolated quoted cast is unavailable.');
    return quoted;
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); localStorage.clear(); sessionStorage.clear();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function until(ready: () => boolean) {
  for (let attempt = 0; attempt < 100 && !ready(); attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  expect(ready()).toBe(true);
}

async function start() {
  history.replaceState(null, '', `/cast/${conversationCast.hash}`);
  await act(async () => root.render(<App />));
  await until(() => Boolean(container.querySelector('.conversation-page article.cast')));
}

async function startFeed(casts: Cast[]) {
  vi.mocked(getFeed).mockResolvedValue({ casts, next: {} });
  await act(async () => root.render(<App />));
  await until(() => Boolean(container.querySelector('.feed article.cast')));
}

async function click(element: Element) {
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
}

function replyTo(reply: Cast, parent: Cast): Cast {
  return { ...reply, parent_hash: parent.hash, parent_author: { fid: parent.author.fid } };
}

function makeAvailable(value: Cast) { quotedCasts.set(value.hash.replace(/^0x/, ''), value); }

const featured = () => container.querySelector<HTMLElement>('.conversation-page .cast--featured')!;
const bodyText = () => featured().querySelector<HTMLElement>('.cast__text')!;
function addQuote(quoted: Cast) {
  conversationCast.embeds = [{ cast_id: { fid: quoted.author.fid, hash: quoted.hash } }];
  quotedCasts.set(quoted.hash.replace(/^0x/, ''), quoted);
}

describe('isolated conversation presentation', () => {
  it('shows the complete featured cast below its author header while replies remain compact', async () => {
    conversationCast.text = Array.from({ length: 12 }, (_, index) => `Public conversation line ${index + 1}.`).join('\n');
    const reply = cast('b', 30, 'A long reply. '.repeat(40));
    replies = [{ cast: reply, replies: [] }];
    await start();

    const article = featured();
    expect(article).not.toBeNull();
    const header = article.querySelector('.cast__header')!;
    expect(header.querySelector('.avatar-button')).not.toBeNull();
    expect(header.querySelector('.cast__meta')).not.toBeNull();
    expect(header.querySelector('button[aria-label="More cast options"]')).not.toBeNull();
    expect(header.contains(bodyText())).toBe(false);
    expect(bodyText().textContent).toBe(conversationCast.text);
    expect(bodyText().classList.contains('cast__text--clamp')).toBe(false);
    expect(article.querySelector('.cast__more')).toBeNull();
    const replyArticle = container.querySelector('.conversation-replies article.cast')!;
    expect(replyArticle.classList.contains('cast--featured')).toBe(false);
    expect(replyArticle.querySelector('.cast__text--clamp')).not.toBeNull();
    expect(replyArticle.querySelector('.cast__more')?.textContent).toBe('Show more');
  });

  it('presents image and website attachments together without duplicating standalone URL text', async () => {
    conversationCast.text = `Watch this public conversation.\n\n${videoUrl}`;
    conversationCast.embeds = [{ url: videoUrl }, { url: imageUrl }];
    const original = JSON.stringify(conversationCast);
    await start();

    expect(bodyText().textContent?.trim()).toBe('Watch this public conversation.');
    const attachments = featured().querySelector('.cast__attachments')!;
    expect(attachments).not.toBeNull();
    expect(attachments.querySelector<HTMLImageElement>('.embed img')?.getAttribute('src')).toBe(imageUrl);
    expect(attachments.querySelector<HTMLAnchorElement>('.link-embed')?.href).toBe(videoUrl);
    expect(JSON.stringify(conversationCast)).toBe(original);
  });

  it('retains inline links and UTF-8 protocol mentions after a matching standalone attachment URL', async () => {
    const beforeMention = `${videoUrl}\n🌈 Hello `;
    conversationCast.text = `${beforeMention}, read ${videoUrl} for context.`;
    const byte = new TextEncoder().encode(beforeMention).length;
    conversationCast.mentioned_profiles = [person(42)];
    conversationCast.mentioned_profiles_ranges = [{ start: byte, end: byte }];
    conversationCast.embeds = [{ url: videoUrl }];
    const original = JSON.stringify(conversationCast);
    await start();

    expect(bodyText().textContent?.trim()).toBe(`🌈 Hello @person42.eth, read ${videoUrl} for context.`);
    const mention = bodyText().querySelector<HTMLAnchorElement>('.cast-mention')!;
    expect(mention.textContent).toBe('@person42.eth');
    expect(mention.getAttribute('href')).toBe('/profile/42');
    expect([...bodyText().querySelectorAll<HTMLAnchorElement>('a')].filter(link => link.href === videoUrl)).toHaveLength(1);
    expect(JSON.stringify(conversationCast)).toBe(original);
  });

  it('keeps a standalone authored URL when there is no corresponding rendered attachment', async () => {
    const otherUrl = 'https://other.example/source';
    conversationCast.text = `The original source:\n${otherUrl}`;
    conversationCast.embeds = [{ url: imageUrl }];
    await start();

    expect(bodyText().textContent).toBe(conversationCast.text);
    expect(bodyText().querySelector<HTMLAnchorElement>('a')?.href).toBe(otherUrl);
  });

  it('keeps an attachment URL inline with an inserted mention on the same line', async () => {
    conversationCast.text = ` ${videoUrl}`;
    conversationCast.mentioned_profiles = [person(42)];
    conversationCast.mentioned_profiles_ranges = [{ start: 0, end: 0 }];
    conversationCast.embeds = [{ url: videoUrl }];
    await start();

    expect(bodyText().textContent).toBe(`@person42.eth ${videoUrl}`);
    expect(bodyText().querySelector<HTMLAnchorElement>('a:not(.cast-mention)')?.href).toBe(videoUrl);
  });

  it('shows a compact quoted author, timestamp and image while preserving quoted source text', async () => {
    const quoted = cast('c', 40, `Original quoted text with @literal and ${videoUrl}\nA second line.`);
    quoted.author.pfp_url = 'https://images.example/quote-author.png';
    quoted.embeds = [{ url: imageUrl }];
    addQuote(quoted);
    const original = JSON.stringify(quoted);
    await start();
    await until(() => Boolean(featured().querySelector('.quoted-cast time')));

    const quote = featured().querySelector('.quoted-cast')!;
    expect(quote.textContent).toContain(quoted.author.username);
    expect(quote.textContent).toContain(quoted.text);
    expect(quote.querySelector('time')?.getAttribute('datetime')).toBe(quoted.timestamp);
    expect(quote.querySelector('.avatar')).not.toBeNull();
    expect([...quote.querySelectorAll('img')].map(image => image.getAttribute('src'))).toContain(imageUrl);
    expect(quote.querySelector('a a')).toBeNull();
    if (quote.tagName === 'A') expect(quote.querySelector('a')).toBeNull();
    expect(quote.textContent).not.toContain('Open quoted cast');
    expect(JSON.stringify(quoted)).toBe(original);
  });

  it('restores protocol mentions in quoted text without placing links inside the quote anchor', async () => {
    const beforeMention = '🌈 Hello ';
    const quoted = cast('c', 40, `${beforeMention}!`);
    const byte = new TextEncoder().encode(beforeMention).length;
    quoted.mentioned_profiles = [person(42)];
    quoted.mentioned_profiles_ranges = [{ start: byte, end: byte }];
    addQuote(quoted);
    const original = JSON.stringify(quoted);
    await start();
    await until(() => Boolean(featured().querySelector('.quoted-cast time')));

    const quote = featured().querySelector('.quoted-cast')!;
    expect(quote.querySelector('.quoted-cast__text')?.textContent).toBe('🌈 Hello @person42.eth!');
    expect(quote.querySelector('a')).toBeNull();
    expect(JSON.stringify(quoted)).toBe(original);
  });

  it.each([
    'http://images.example/insecure.png',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'https://images.example/vector.svg',
    'https://user:password@images.example/credentialed.png',
  ])('renders no quote thumbnail for an unsupported image URL: %s', async unsafeUrl => {
    const quoted = cast('c', 40, 'Keep the quoted text even when its attachment cannot be displayed.');
    quoted.embeds = [{ url: unsafeUrl }, { url: imageUrl }];
    addQuote(quoted);
    await start();
    await until(() => Boolean(featured().querySelector('.quoted-cast time')));

    const quote = featured().querySelector('.quoted-cast')!;
    expect(quote.textContent).toContain(quoted.text);
    expect([...quote.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual([imageUrl]);
  });
});

describe('reply context in the timeline and conversation', () => {
  it('shows who a timeline reply addresses and a parent excerpt that opens the parent cast', async () => {
    const parent = cast('b', 7, 'The earlier cast that explains this reply.');
    const reply = replyTo(cast('d', 8, 'This only makes sense with its parent.'), parent);
    makeAvailable(parent);
    await startFeed([reply]);
    await until(() => container.querySelector('.feed .cast-reply-context__preview')?.textContent?.includes(parent.text) === true);

    const context = container.querySelector('.feed .cast-reply-context')!;
    expect(context.textContent).toContain('Replying to @person7.eth');
    expect(context.querySelector<HTMLAnchorElement>('a[href="/profile/7"]')?.textContent).toBe('@person7.eth');
    const preview = context.querySelector<HTMLAnchorElement>('.cast-reply-context__preview')!;
    expect(preview.textContent).toContain(parent.text);
    expect(preview.getAttribute('href')).toContain(parent.hash.slice(0, 10));
    expect(preview.querySelector('a')).toBeNull();

    conversationCast = parent;
    await click(preview);
    await until(() => featured()?.querySelector('.cast__text')?.textContent === parent.text);
    expect(getConversation).toHaveBeenLastCalledWith(parent.hash, expect.any(AbortSignal));
  });

  it.each(['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const)('preserves native %s clicks on a timeline parent preview', async modifier => {
    const parent = cast('b', 7, 'The parent can open with native browser controls.');
    const reply = replyTo(cast('d', 8, 'A timeline reply.'), parent);
    makeAvailable(parent);
    await startFeed([reply]);
    await until(() => container.querySelector('.feed .cast-reply-context__preview')?.textContent?.includes(parent.text) === true);

    const preview = container.querySelector<HTMLAnchorElement>('.feed .cast-reply-context__preview')!;
    const push = vi.spyOn(history, 'pushState');
    const replace = vi.spyOn(history, 'replaceState');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, [modifier]: true });
    await act(async () => { preview.dispatchEvent(event); });

    expect(event.defaultPrevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(container.querySelector('.conversation-page')).toBeNull();
    expect(getConversation).not.toHaveBeenCalled();
    expect(preview.getAttribute('href')).toContain(parent.hash.slice(0, 10));
  });

  it('does not mistake a channel parent URL for a reply or request a parent cast', async () => {
    const channelCast = { ...cast('d', 8, 'An original channel post.'), parent_url: 'https://warpcast.com/~/channel/testing' };
    await startFeed([channelCast]);

    expect(container.querySelector('.feed .cast-reply-context')).toBeNull();
    expect(getCast).not.toHaveBeenCalled();
    expect(container.querySelector('.feed .cast__text')?.textContent).toBe(channelCast.text);
  });

  it('opens an unresolved parent author through local profile navigation', async () => {
    const parent = cast('b', 7, 'An unavailable parent.');
    const reply = replyTo(cast('d', 8, 'A reply whose recipient is known by FID.'), parent);
    await startFeed([reply]);
    await until(() => container.querySelector('.feed .cast-reply-context__preview')?.textContent?.includes('unavailable') === true);

    const recipient = container.querySelector<HTMLAnchorElement>('.feed .cast-reply-context__label a')!;
    expect(recipient.textContent).toBe('FID 7');
    expect(recipient.getAttribute('href')).toBe('/profile/7');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => { recipient.dispatchEvent(event); });

    expect(event.defaultPrevented).toBe(true);
    expect(location.pathname).toBe('/profile/7');
    expect(getUser).toHaveBeenCalledWith({ fid: 7 }, expect.any(AbortSignal));
  });

  it('places every available ancestor above the featured reply in oldest-first order', async () => {
    const oldest = cast('c', 6, 'The original topic.');
    const parent = replyTo(cast('b', 7, 'The intermediate reply.'), oldest);
    conversationCast = replyTo(conversationCast, parent);
    makeAvailable(oldest); makeAvailable(parent);
    await start();
    await until(() => container.querySelectorAll('.conversation-context article.cast').length === 2);

    const context = container.querySelector('.conversation-context[aria-label="Earlier casts in this conversation"]')!;
    expect(context).not.toBeNull();
    expect([...context.querySelectorAll('article.cast .cast__text')].map(item => item.textContent)).toEqual([oldest.text, parent.text]);
    expect(context.querySelector('.cast--featured')).toBeNull();
    expect(context.compareDocumentPosition(featured()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bodyText().textContent).toBe(conversationCast.text);
  });

  it('uses already loaded parents for nested replies instead of looking them up again', async () => {
    const child = replyTo(cast('b', 30, 'A direct reply to the featured cast.'), conversationCast);
    const grandchild = replyTo(cast('c', 40, 'A nested reply to the direct reply.'), child);
    replies = [{ cast: child, replies: [{ cast: grandchild, replies: [] }] }];
    await start();
    await until(() => container.querySelectorAll('.conversation-replies .cast-reply-context').length === 2);

    const contexts = [...container.querySelectorAll('.conversation-replies .cast-reply-context')];
    expect(contexts[0].textContent).toContain('Replying to @person20.eth');
    expect(contexts[1].textContent).toContain('Replying to @person30.eth');
    expect(container.querySelector('.conversation-replies .cast-reply-context__preview')).toBeNull();
    expect(getCast).not.toHaveBeenCalled();
  });

  it('preserves the featured reply when its parent is unavailable and lets the reader retry', async () => {
    const parent = cast('b', 7, 'The parent becomes available after retry.');
    conversationCast = replyTo(conversationCast, parent);
    await start();
    await until(() => container.querySelector('.conversation-context')?.textContent?.includes('Earlier context is unavailable on this Hypersnap node.') === true);

    const context = container.querySelector('.conversation-context')!;
    expect(bodyText().textContent).toBe(conversationCast.text);
    expect(container.querySelector('.guest-prompt')?.textContent).toContain('Sign in to reply.');
    const retry = [...context.querySelectorAll('button')].find(button => /retry|try again/i.test(button.textContent ?? ''))!;
    expect(retry).not.toBeUndefined();
    makeAvailable(parent);
    await click(retry);
    await until(() => container.querySelector('.conversation-context .cast__text')?.textContent === parent.text);
    expect(bodyText().textContent).toBe(conversationCast.text);
  });

  it('clears a cached parent with the wrong author and loads corrected context after retry', async () => {
    const parent = cast('b', 7, 'The corrected parent from the expected author.');
    const wrongAuthor = { ...parent, author: person(99), text: 'A cached response from the wrong author.' };
    conversationCast = replyTo(conversationCast, parent);
    quotedCasts.set(parent.hash.replace(/^0x/, ''), wrongAuthor);
    await start();
    await until(() => container.querySelector('.conversation-context')?.textContent?.includes('Earlier context is unavailable on this Hypersnap node.') === true);
    expect(container.querySelector('.conversation-page')?.textContent).not.toContain(wrongAuthor.text);
    expect(getCast).toHaveBeenCalledTimes(1);

    makeAvailable(parent);
    const retry = [...container.querySelectorAll('.conversation-context button')].find(button => button.textContent?.trim() === 'Retry')!;
    await click(retry);
    await until(() => container.querySelector('.conversation-context .cast__text')?.textContent === parent.text);

    expect(getCast).toHaveBeenCalledTimes(2);
    expect(featured().querySelector('.cast-reply-context')?.textContent).toContain('Replying to @person7.eth');
    expect(container.querySelector('.conversation-context')?.textContent).not.toContain('Earlier context is unavailable');
    expect(bodyText().textContent).toBe(conversationCast.text);
  });

  it.each(['hash', 'author'] as const)('does not display context when the parent response has a different %s', async mismatch => {
    const expectedParent = cast('b', 7, 'The expected parent.');
    const wrongParent = mismatch === 'hash' ? cast('c', 7, 'Unrelated response must not be shown.') : cast('b', 99, 'Unrelated response must not be shown.');
    conversationCast = replyTo(conversationCast, expectedParent);
    quotedCasts.set(expectedParent.hash.replace(/^0x/, ''), wrongParent);
    await startFeed([conversationCast]);
    await until(() => container.querySelector('.feed .cast-reply-context__preview')?.textContent?.includes('unavailable') === true);
    expect(container.querySelector('.feed .cast-reply-context')?.textContent).not.toContain(wrongParent.text);
    await click(container.querySelector('.feed .cast-permalink')!);
    await until(() => container.querySelector('.conversation-context')?.textContent?.includes('Earlier context is unavailable on this Hypersnap node.') === true);

    expect(container.querySelector('.conversation-context')?.textContent).not.toContain(wrongParent.text);
    expect(container.querySelector('.conversation-context article.cast')).toBeNull();
    expect(bodyText().textContent).toBe(conversationCast.text);
  });

  it('honors hidden parents in both timeline previews and the ancestor context', async () => {
    const parent = cast('b', 7, 'Hidden parent text must stay hidden.');
    conversationCast = replyTo(conversationCast, parent);
    makeAvailable(parent);
    localStorage.setItem(contentPreferencesKey(), JSON.stringify(hideCast(emptyContentPreferences(), parent.hash)));
    await startFeed([conversationCast]);
    await until(() => vi.mocked(getCast).mock.calls.length > 0);
    expect(container.querySelector('.feed .cast-reply-context')?.textContent).not.toContain(parent.text);

    await click(container.querySelector('.feed .cast-permalink')!);
    await until(() => Boolean(container.querySelector('.conversation-context .filtered-cast')));
    const context = container.querySelector('.conversation-context')!;
    expect(context.textContent).toContain('Hidden on this browser');
    expect(context.textContent).not.toContain(parent.text);
    expect(bodyText().textContent).toBe(conversationCast.text);
  });

  it('ignores a late parent response after navigating to another conversation', async () => {
    const parent = cast('b', 7, 'Late context from the previous conversation.');
    const next = cast('d', 9, 'The newly opened conversation.');
    conversationCast = replyTo({ ...conversationCast, text: `Continue at https://farcaster.xyz/~/conversations/${next.hash}` }, parent);
    let resolveParent!: (value: Cast) => void;
    const pendingParent = new Promise<Cast>(resolve => { resolveParent = resolve; });
    vi.mocked(getCast).mockReturnValue(pendingParent);
    const source = conversationCast;
    vi.mocked(getConversation).mockImplementation(async hash => ({ cast: hash === source.hash ? source : next, replies: [] }));
    await start();
    await until(() => vi.mocked(getCast).mock.calls.length > 0);
    expect(container.querySelector('.conversation-context [role="status"]')?.textContent).toBe('Loading earlier casts…');
    expect(bodyText().textContent?.startsWith('Continue at ')).toBe(true);
    expect(bodyText().querySelector<HTMLAnchorElement>('a')?.getAttribute('href')).toBe(`/cast/${next.hash}`);
    const parentSignals = vi.mocked(getCast).mock.calls.map(([, signal]) => signal);
    await click(bodyText().querySelector('a')!);
    await until(() => featured()?.querySelector('.cast__text')?.textContent === next.text);
    expect(parentSignals.every(signal => signal?.aborted)).toBe(true);
    await act(async () => resolveParent(parent));

    expect(bodyText().textContent).toBe(next.text);
    expect(container.querySelector('.conversation-context')).toBeNull();
    expect(container.querySelector('.conversation-page')?.textContent).not.toContain(parent.text);
  });
});
