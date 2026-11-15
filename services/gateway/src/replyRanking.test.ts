import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplyRanking, observeConversation, suspectedPredictions, SPAM_ARTIFACT, SPAM_MODEL, type RankingEnv, type RankingStorage } from './replyRanking';
import { SPAM_OPTIONS } from './spamContext';
import { handleRequest, type Env } from './index';
import { FARCASTER_EPOCH_SECONDS } from '@opencaster/client-core/farcasterEpoch';

const h = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
class Storage implements RankingStorage {
  values = new Map<string, unknown>(); alarm: number | null = null; lock = Promise.resolve();
  async get<T>(key: string) { return structuredClone(this.values.get(key)) as T | undefined; }
  async put(key: string, value: unknown) { this.values.set(key, structuredClone(value)); }
  async delete(key: string) { return this.values.delete(key); }
  async getAlarm() { return this.alarm; }
  async setAlarm(t: number) { this.alarm = t; }
  async deleteAlarm() { this.alarm = null; }
  transaction<T>(fn: (txn: RankingStorage) => Promise<T>): Promise<T> {
    const result = this.lock.then(() => fn(this)); this.lock = result.then(() => {}, () => {}); return result;
  }
}
const result = (probs = [[0.05, 0.9, 0.05]]) => ({ model_identity: SPAM_ARTIFACT, finish_reason: 'stop', truncated: false, content_clipped: false,
  predictions: probs.map((probabilities, i) => ({ key: String(i), model_identity: SPAM_ARTIFACT, kind: 'choice', options: SPAM_OPTIONS, probabilities })) });
let storage: Storage; let coordinator: ReplyRanking; let env: RankingEnv; let key: string; let posts: unknown[]; let messages: unknown[];
const timestamp = Math.floor(Date.now() / 1000) - FARCASTER_EPOCH_SECONDS - 60;
const message = (hash: string, secondsBefore = 0, text = 'Claim at https://example.invalid/offer') => ({ hash,
  data: { fid: 123, timestamp: timestamp - secondsBefore, network: 'FARCASTER_NETWORK_MAINNET', type: 'MESSAGE_TYPE_CAST_ADD',
    castAddBody: { text, mentions: [], embeds: [{ url: 'https://example.invalid/offer' }], parentCastId: { fid: 456, hash: h(900) } } } });
const receipt = (status: string) => ({ id: '11111111-1111-4111-8111-111111111111', status, request_key: key, model_id: SPAM_MODEL, result: status === 'succeeded' ? result() : {} });
const observe = (hash = h(1)) => coordinator.fetch(new Request('https://ranking/observe', { method: 'POST', body: JSON.stringify({ root: h(900), casts: [{ hash, fid: 123 }] }) }));
const view = async () => (await coordinator.fetch(new Request(`https://ranking/result?root=${h(900)}`))).json();
const fire = async () => { storage.alarm = null; await coordinator.alarm(); };

beforeEach(() => {
  storage = new Storage(); posts = []; key = ''; messages = [message(h(1)), message(h(2), 60, 'A previous reply'), message(h(3), -60, 'A future reply')];
  env = { SPAM_RANKING: 'enabled', SPAM_MONTHLY_BUDGET_CENTS: '50', OVERMIND_API_KEY: 'synthetic-project-key',
    REPLY_RANKING: { idFromName: name => name, get: () => ({ fetch: request => coordinator.fetch(request) }) } };
  coordinator = new ReplyRanking({ storage }, env);
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === '/v1/castsByFid') return json({ messages });
    if (url.pathname === '/v2/farcaster/cast') return json({ cast: { hash: h(900), author: { fid: 456 }, text: 'Photos of a hike', embeds: [] } });
    if (init?.method === 'POST') { const body = JSON.parse(String(init.body)); posts.push(body); key = body.request_key; return json(receipt('queued'), 202); }
    return json(receipt('succeeded'));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('background reply ranking', () => {
  it('shares queued work, hydrates node history, verifies the artifact, and reuses cached scores', async () => {
    await Promise.all([observe(), observe()]);
    expect(await view()).toEqual({ status: 'pending', suspected: [] });
    await fire(); expect(posts).toHaveLength(1);
    const payload = posts[0] as { decisions: { state: string }[] };
    const state = JSON.parse(payload.decisions[0].state);
    expect(state.earlier_author_casts.map((c: { text: string }) => c.text)).toEqual(['A previous reply']);
    expect(state.observed_prior_author_casts_last_hour).toBe(1);
    expect(JSON.stringify(payload)).not.toMatch(/synthetic-project-key|target_probabilities|teacher_label|author_fid/);
    expect(payload.decisions[0].state).not.toContain(h(1));
    expect(await view()).toEqual({ status: 'pending', suspected: [] });
    // A new coordinator instance recovers the exact persisted operation.
    coordinator = new ReplyRanking({ storage }, env);
    await fire(); expect(await view()).toEqual({ status: 'ready', suspected: [h(1)] });
    await observe(); await fire(); expect(posts).toHaveLength(1); expect(storage.alarm).toBeNull();
  });

  it('keeps a stable request key and reservation when the submission acknowledgement is lost', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    let lost = false;
    vi.mocked(fetch).mockImplementation(async (...args) => { const response = await original(...args); if (args[1]?.method === 'POST' && !lost) { lost = true; throw new Error('Acknowledgement lost'); } return response; });
    await observe(); await fire(); await fire(); await fire();
    expect(posts).toHaveLength(2); expect(posts[0]).toEqual(posts[1]);
    expect(storage.values.get(`reserved:${new Date().toISOString().slice(0, 7)}`)).toBe(50);
    expect(await view()).toEqual({ status: 'ready', suspected: [h(1)] });
  });

  it('halts unresolved submissions after three identical recovery attempts without admitting more paid work', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => { const response = await original(...args); if (args[1]?.method === 'POST') throw new Error('Unknown acknowledgement'); return response; });
    env.SPAM_MONTHLY_BUDGET_CENTS = '500';
    await observe(); await fire(); await fire(); await fire(); await observe(h(2)); await fire();
    expect(posts).toHaveLength(3); expect(new Set(posts.map(p => JSON.stringify(p))).size).toBe(1);
    expect(await view()).toEqual({ status: 'ready', suspected: [] });
    expect(storage.alarm).toBeNull();
  });

  it('stops new model calls at the monthly reservation allowance and renews it only next month', async () => {
    await observe(); await fire(); await fire();
    messages = [message(h(4))]; await observe(h(4)); await fire();
    expect(posts).toHaveLength(1); expect(await view()).toEqual({ status: 'ready', suspected: [] });
    vi.useFakeTimers(); vi.setSystemTime(new Date('2027-01-15T18:00:00Z'));
    await observe(h(4)); await fire(); expect(posts).toHaveLength(2);
  });

  it('does not score absent history, own-profile roots, failed node reads, or disabled configuration', async () => {
    messages = []; await observe(); await fire(); expect(posts).toHaveLength(0);
    expect(await view()).toEqual({ status: 'ready', suspected: [] });
    messages = [{ ...message(h(4)), data: { ...message(h(4)).data, castAddBody: { text: 'Reward/game update', embeds: [], mentions: [] } } }];
    await observe(h(4)); await fire(); expect(posts).toHaveLength(0);
    env.SPAM_RANKING = 'disabled'; await observe(h(5)); await fire(); expect(posts).toHaveLength(0);
  });

  it('rejects mismatched or malformed probabilities and abstains for ambiguous evidence', () => {
    expect(suspectedPredictions(result([[0.05, 0.9, 0.05], [0.2, 0.6, 0.2], [0.9, 0.05, 0.05]]), 3)).toEqual([true, false, false]);
    expect(() => suspectedPredictions({ ...result(), model_identity: 'wrong-artifact' }, 1)).toThrow();
    expect(() => suspectedPredictions(result([[0.1, 0.95, 0.1]]), 1)).toThrow();
    const swapped = result(); swapped.predictions[0].options = ['spam', 'normal', 'insufficient'];
    expect(() => suspectedPredictions(swapped, 1)).toThrow();
    expect(() => suspectedPredictions(result(), 2)).toThrow();
  });

  it('only admits replies from a matching validated node conversation, never the root', async () => {
    const root = { hash: h(900), author: { fid: 456 }, direct_replies: [{ hash: h(1), author: { fid: 123 } }] };
    await observeConversation({ conversation: { cast: root } }, h(901), env);
    expect(storage.values.size).toBe(0);
    await observeConversation({ conversation: { cast: root } }, h(900), env); await fire();
    expect(posts).toHaveLength(1);
  });
});

describe('public gateway ranking boundary', () => {
  const base: Env = { ASSETS: { fetch: async () => new Response('assets') } };
  it('fails open when unconfigured and still applies origin, query, method and security controls', async () => {
    const path = `https://opencaster.org/api/reply-ranking?identifier=${h(900)}`;
    const response = await handleRequest(new Request(path), base);
    expect(await response.json()).toEqual({ status: 'off', suspected: [] });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
    expect((await handleRequest(new Request(path, { headers: { Origin: 'https://other.example' } }), base)).status).toBe(403);
    expect((await handleRequest(new Request(`${path}&state=browser-supplied`), base)).status).toBe(400);
    expect((await handleRequest(new Request(path, { method: 'POST', body: 'arbitrary paid input' }), base)).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns the conversation without waiting for scoring or a failed background queue', async () => {
    const cast = { hash: h(900), author: { fid: 456 }, direct_replies: [{ hash: h(1), author: { fid: 123 } }] };
    vi.mocked(fetch).mockResolvedValue(json({ conversation: { cast } }));
    const stalled = new Promise<Response>(() => {});
    env.REPLY_RANKING = { idFromName: name => name, get: () => ({ fetch: () => stalled }) };
    const pending: Promise<unknown>[] = [];
    const response = await handleRequest(new Request(`https://opencaster.org/api/v2/farcaster/cast/conversation?identifier=${h(900)}&type=hash&reply_depth=2`), { ...base, ...env }, { waitUntil: promise => { pending.push(promise); } });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ conversation: { cast } }); expect(pending.length).toBeGreaterThan(0);
  });
});
