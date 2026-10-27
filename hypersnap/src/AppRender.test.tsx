// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { getChannels, getFeed, getInfo, getSuggestedUsers, searchCasts, searchUsers, type Cast, type User } from './lib/api';
import { renderMentionSegments } from './lib/content';

vi.mock('./lib/api', async original => ({ ...await original<typeof import('./lib/api')>(), getChannels: vi.fn(), getFeed: vi.fn(), getInfo: vi.fn(), getSuggestedUsers: vi.fn(), searchCasts: vi.fn(), searchUsers: vi.fn() }));
vi.mock('./lib/content', async original => {
  const actual = await original<typeof import('./lib/content')>();
  return { ...actual, renderMentionSegments: vi.fn(actual.renderMentionSegments) };
});

const person = (fid: number): User => ({ fid, username: `person${fid}`, display_name: `Person ${fid}`, custody_address: '0x1111111111111111111111111111111111111111', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 });
const casts: Cast[] = Array.from({ length: 100 }, (_, index) => ({ hash: `0x${index.toString(16).padStart(40, '0')}`, author: person(index + 1), text: `Cast ${index} with https://example.com/${index}`, timestamp: '2026-10-19T12:00:00.000Z', embeds: [], reactions: { likes_count: 1200, recasts_count: 0 }, replies: { count: 0 } }));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); localStorage.clear(); localStorage.setItem('opencaster.explore', '1');
  history.replaceState(null, '', '/');
  vi.mocked(getFeed).mockResolvedValue({ casts, next: {} });
  vi.mocked(getChannels).mockResolvedValue({ channels: [], next: {} });
  vi.mocked(getInfo).mockResolvedValue({ version: 'isolated-test' });
  vi.mocked(getSuggestedUsers).mockResolvedValue({ users: [] });
  vi.mocked(searchCasts).mockResolvedValue({ casts: [], next: {} });
  vi.mocked(searchUsers).mockResolvedValue({ users: [] });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); vi.unstubAllGlobals(); });
const searchInputs = () => [...container.querySelectorAll<HTMLInputElement>('input[aria-label="Search casts or people"]')];
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('feed rendering while typing a search', () => {
  it('does not re-render loaded cast cards per keystroke and keeps both search boxes in sync', async () => {
    await act(async () => root.render(<App />));
    expect(container.querySelectorAll('main .feed article.cast')).toHaveLength(100);
    expect(container.textContent).toContain('1.2K');
    const [header, rail] = searchInputs();
    expect(header).toBeDefined(); expect(rail).toBeDefined();
    const parses = vi.mocked(renderMentionSegments).mock.calls.length;
    const query = 'open social';
    for (let length = 1; length <= query.length; length += 1) await type(header, query.slice(0, length));
    expect(vi.mocked(renderMentionSegments).mock.calls.length).toBe(parses);
    expect(header.value).toBe(query); expect(rail.value).toBe(query);
    await act(async () => { rail.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(location.pathname + location.search).toBe('/search?q=open+social');
  // Real DOM work for 100 cards plus lazy route loading exceeds five seconds
  // on shared development hosts; keep this budget local to the integration case.
  }, 15_000);
});
