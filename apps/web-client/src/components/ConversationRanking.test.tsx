// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cast, ConversationNode } from '@opencaster/client-core/api';
import { getReplyRanking, type ReplyRanking } from '@opencaster/client-core/replyRanking';
import { ConversationReplies, MAX_CONVERSATION_CASTS } from './Conversation';

vi.mock('@opencaster/client-core/replyRanking', async original => ({
  ...await original<typeof import('@opencaster/client-core/replyRanking')>(), getReplyRanking: vi.fn(),
}));
const hash = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const cast = (n: number) => ({ hash: hash(n), text: `Reply ${n}` }) as Cast;
const node = (n: number, replies: ConversationNode[] = []) => ({ cast: cast(n), replies });
let container: HTMLDivElement; let root: Root;
const render = async (nodes: ConversationNode[], parent = cast(999)) => act(async () => root.render(<ConversationReplies nodes={nodes} parent={parent} renderCard={(c, p) => <article data-hash={c.hash} data-parent={p.hash}>{c.text}</article>} />));
const hashes = () => [...container.querySelectorAll('article')].map(c => c.getAttribute('data-hash'));
const choose = async (value: string) => act(async () => { const select = container.querySelector('select')!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.resetAllMocks();
  vi.mocked(getReplyRanking).mockResolvedValue({ status: 'off', suspected: [] });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('reply ranking presentation', () => {
  it('renders immediately, then moves suspected siblings with their descendants, preserving every card and parent', async () => {
    let resolve!: (r: ReplyRanking) => void;
    vi.mocked(getReplyRanking).mockReturnValue(new Promise(r => { resolve = r; }));
    const nodes = [node(1, [node(11), node(12)]), node(2, [node(21), node(22)]), node(3)];
    await render(nodes);
    expect(hashes()).toEqual([1, 11, 12, 2, 21, 22, 3].map(hash));
    const cards = [...container.querySelectorAll('article')];
    await act(async () => resolve({ status: 'ready', suspected: [hash(1), hash(21)] }));
    expect(hashes()).toEqual([2, 22, 21, 3, 1, 11, 12].map(hash));
    expect(new Set(container.querySelectorAll('article'))).toEqual(new Set(cards));
    expect(container.querySelector(`[data-hash="${hash(21)}"]`)?.getAttribute('data-parent')).toBe(hash(2));
    expect(container.querySelector('[hidden]')).toBeNull();
    await choose('node'); expect(hashes()).toEqual([1, 11, 12, 2, 21, 22, 3].map(hash));
  });

  it('applies existing render limits before partitioning so no card is displaced beyond the cap', async () => {
    vi.mocked(getReplyRanking).mockResolvedValue({ status: 'ready', suspected: [hash(1)] });
    await render(Array.from({ length: MAX_CONVERSATION_CASTS + 5 }, (_, i) => node(i + 1)));
    expect(hashes()).toHaveLength(MAX_CONVERSATION_CASTS);
    expect(new Set(hashes())).toEqual(new Set(Array.from({ length: MAX_CONVERSATION_CASTS }, (_, i) => hash(i + 1))));
    expect(hashes().at(-1)).toBe(hash(1));
  });

  it('fails open and ignores stale results from an earlier conversation or a cancelled ranking choice', async () => {
    let old!: (r: ReplyRanking) => void;
    vi.mocked(getReplyRanking).mockReturnValueOnce(new Promise(r => { old = r; })).mockRejectedValueOnce(new Error('Unavailable'));
    await render([node(1), node(2)], cast(999));
    await render([node(3), node(4)], cast(998));
    await act(async () => old({ status: 'ready', suspected: [hash(3)] }));
    expect(hashes()).toEqual([hash(3), hash(4)]);
    await choose('node'); expect(hashes()).toEqual([hash(3), hash(4)]);
  });

  it('aborts polling on unmount and stops after a bounded number of pending reads', async () => {
    vi.useFakeTimers(); vi.mocked(getReplyRanking).mockResolvedValue({ status: 'pending', suspected: [] });
    await render([node(1)]);
    await act(async () => vi.advanceTimersByTimeAsync(11 * 60000));
    expect(getReplyRanking).toHaveBeenCalledTimes(60);
    expect(hashes()).toEqual([hash(1)]);
    const signal = vi.mocked(getReplyRanking).mock.calls[0][1]!;
    await act(async () => root.unmount()); expect(signal.aborted).toBe(true);
    root = createRoot(container);
  });
});
