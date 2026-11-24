import { CAST_HASH } from '@opencaster/client-core/apiRules';
import { readLimited } from '@opencaster/client-core/boundedRead';
import { canonicalReplyHash, type ReplyRanking as RankingView } from '@opencaster/client-core/replyRanking';
import { SpamContextReader, SPAM_OPTIONS, type RankingCandidate, type SpamDecision } from './spamContext';
import type { UpstreamEnv } from './upstream';

export const SPAM_DEPLOYMENT = '0f3274f7-a246-48a8-ac3d-00fcba95c6c7';
export const SPAM_MODEL = 'ft-97cea71b-qwen-3-5-0-8b-decision';
export const SPAM_ARTIFACT = '93238185313b1927be8c457ea3437db75bfa325675dcca2899c37597bda94680';
const API = 'https://api.overmindlab.ai';
const DAY = 86400000;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const BATCH_SIZE = 32;
const MAX_NATIVE_DECISIONS = 16;
const MAX_QUEUE = 64;
const MAX_RECORDS = 1024;
// Planning reserve, not a provider-enforced dollar cap. Includes a cold start
// allowance; see REPLY_RANKING.md. Unknown submissions retain the reservation.
const BATCH_RESERVE_CENTS = 50;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export interface RankingEnv extends UpstreamEnv {
  SPAM_RANKING?: string;
  /** Integer USD cents, deliberately zero until the operator enables spending. */
  SPAM_MONTHLY_BUDGET_CENTS?: string;
  OVERMIND_API_KEY?: string;
  REPLY_RANKING?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
}
function budget(env: RankingEnv): number {
  const text = env.SPAM_MONTHLY_BUDGET_CENTS ?? '';
  return /^\d{1,5}$/.test(text) && Number(text) <= 10000 ? Number(text) : 0;
}
export const rankingEnabled = (env: RankingEnv) => env.SPAM_RANKING === 'enabled' && budget(env) >= BATCH_RESERVE_CENTS && !!env.OVERMIND_API_KEY && !!env.REPLY_RANKING;
function stub(env: RankingEnv) { return env.REPLY_RANKING!.get(env.REPLY_RANKING!.idFromName('public-replies-v1')); }

/** Called only after the fixed-origin node response has passed gateway checks.
 * No browser endpoint accepts text, FIDs, decisions, labels or inference jobs. */
export async function observeConversation(value: Record<string, unknown>, rootHash: string, env: RankingEnv): Promise<void> {
  if (!rankingEnabled(env)) return;
  const container = object(value.conversation) ? value.conversation : value;
  const root = container.cast;
  if (!object(root) || typeof root.hash !== 'string' || !CAST_HASH.test(root.hash) || canonicalReplyHash(root.hash) !== canonicalReplyHash(rootHash)) return;
  const casts: RankingCandidate[] = [];
  const seen = new Set<string>([canonicalReplyHash(root.hash)]);
  const visit = (items: unknown, depth: number) => {
    if (!Array.isArray(items) || depth > 5) return;
    for (const item of items.slice(0, 150)) {
      const cast = object(item) && object(item.cast) ? item.cast : item;
      if (!object(cast) || typeof cast.hash !== 'string' || !CAST_HASH.test(cast.hash) || !object(cast.author)
        || !Number.isSafeInteger(cast.author.fid) || Number(cast.author.fid) < 1 || Number(cast.author.fid) > 0xffffffff) continue;
      const hash = canonicalReplyHash(cast.hash);
      if (seen.has(hash) || casts.length >= 150) continue;
      seen.add(hash); casts.push({ hash, fid: Number(cast.author.fid) });
      visit(cast.direct_replies ?? (object(item) ? item.replies : undefined), depth + 1);
    }
  };
  visit(root.direct_replies ?? value.replies, 0);
  if (!casts.length) return;
  const response = await stub(env).fetch(new Request('https://ranking/observe', { method: 'POST', body: JSON.stringify({ root: canonicalReplyHash(rootHash), casts }), signal: AbortSignal.timeout(2000) }));
  void response.body?.cancel().catch(() => undefined);
}

export async function readReplyRanking(root: string, env: RankingEnv): Promise<Response> {
  if (!rankingEnabled(env)) return json({ status: 'off', suspected: [] } satisfies RankingView);
  try { return await stub(env).fetch(new Request(`https://ranking/result?root=${canonicalReplyHash(root)}`, { signal: AbortSignal.timeout(2000) })); }
  catch { return json({ status: 'off', suspected: [] } satisfies RankingView); }
}

export interface RankingStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<unknown>;
  transaction<T>(fn: (txn: RankingStorage) => Promise<T>): Promise<T>;
  getAlarm(): Promise<number | null>;
  setAlarm(time: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}
interface Score { pending: boolean; suspected: boolean; expires: number }
interface JobPart { key: string; offset: number; count: number; attempts: number; id?: string; flags?: boolean[]; failed?: boolean }
interface Job {
  key: string; created: number; candidates: RankingCandidate[]; scored?: RankingCandidate[];
  decisions?: SpamDecision[]; id?: string; attempts: number; reserved?: boolean; halted?: boolean;
  parts?: JobPart[];
}
interface Meta {
  queue: RankingCandidate[]; records: string[]; threads: string[]; job?: Job;
}
const empty = (): Meta => ({ queue: [], records: [], threads: [] });
const recordKey = (hash: string) => `${SPAM_ARTIFACT}:cast:${hash}`;
const threadKey = (hash: string) => `${SPAM_ARTIFACT}:thread:${hash}`;

/** Model identity, row index, option order and the full probability vector must
 * agree. A malformed or mismatched batch cannot demote even a single reply. */
export function suspectedPredictions(result: unknown, count: number): boolean[] {
  if (!object(result) || result.model_identity !== SPAM_ARTIFACT || result.truncated !== false || result.content_clipped === true
    || result.finish_reason !== 'stop' || !Array.isArray(result.predictions) || result.predictions.length !== count) throw new Error('Invalid inference result');
  const rows: boolean[] = [];
  for (const [i, p] of result.predictions.entries()) {
    if (!object(p) || p.key !== String(i) || p.model_identity !== SPAM_ARTIFACT || p.kind !== 'choice'
      || JSON.stringify(p.options) !== JSON.stringify(SPAM_OPTIONS) || !Array.isArray(p.probabilities) || p.probabilities.length !== 3
      || p.probabilities.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)
      || Math.abs(p.probabilities.reduce((a: number, b: number) => a + b, 0) - 1) > 0.00001) throw new Error('Invalid inference probabilities');
    const [normal, spam, insufficient] = p.probabilities as number[];
    // Provisional conservative policy, not a claim of calibrated human truth.
    rows.push(spam >= 0.8 && spam - normal >= 0.65 && insufficient <= 0.1);
  }
  return rows;
}

/** One SQLite-backed coordinator shares work, cache and monthly reservations
 * across viewers/PoPs. Alarms survive browser closure and Worker restarts. */
export class ReplyRanking {
  constructor(private readonly state: { storage: RankingStorage }, private readonly env: RankingEnv) {}
  private async schedule() {
    if (await this.state.storage.getAlarm() === null) await this.state.storage.setAlarm(Date.now() + 30000);
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url), storage = this.state.storage;
    if (url.pathname === '/result' && request.method === 'GET') {
      const root = url.searchParams.get('root') ?? '';
      if (!CAST_HASH.test(root)) return json({}, 400);
      const thread = await storage.get<{ hashes: string[]; expires: number }>(threadKey(root));
      if (!thread || thread.expires <= Date.now()) return json({ status: 'pending', suspected: [] });
      const scores = await Promise.all(thread.hashes.map(hash => storage.get<Score>(recordKey(hash))));
      return json({ status: scores.some(s => s?.pending && s.expires > Date.now()) ? 'pending' : 'ready',
        suspected: thread.hashes.filter((_, i) => scores[i]?.suspected && scores[i]!.expires > Date.now()) } satisfies RankingView);
    }
    if (url.pathname !== '/observe' || request.method !== 'POST') return json({}, 404);
    if (!rankingEnabled(this.env)) return json({ status: 'off' });
    const bytes = await readLimited(request.body, 20000);
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!object(value) || typeof value.root !== 'string' || !CAST_HASH.test(value.root) || !Array.isArray(value.casts) || value.casts.length > 150) return json({}, 400);
    const root = canonicalReplyHash(value.root);
    const candidates: RankingCandidate[] = [];
    for (const c of value.casts) {
      if (!object(c) || typeof c.hash !== 'string' || !CAST_HASH.test(c.hash) || !Number.isSafeInteger(c.fid) || Number(c.fid) < 1 || Number(c.fid) > 0xffffffff) return json({}, 400);
      const hash = canonicalReplyHash(c.hash);
      if (!candidates.some(p => p.hash === hash)) candidates.push({ hash, fid: Number(c.fid) });
    }
    await this.schedule();
    await storage.transaction(async txn => {
      const meta = await txn.get<Meta>('meta') ?? empty();
      if (!meta.threads.includes(root)) meta.threads.push(root);
      while (meta.threads.length > 256) await txn.delete(threadKey(meta.threads.shift()!));
      await txn.put(threadKey(root), { hashes: candidates.map(c => c.hash), expires: Date.now() + DAY });
      const reserved = await txn.get<number>(`reserved:${new Date().toISOString().slice(0, 7)}`) ?? 0;
      for (const c of candidates) {
        if (meta.queue.length >= MAX_QUEUE || meta.job?.halted || reserved + BATCH_RESERVE_CENTS > budget(this.env)) break;
        const score = await txn.get<Score>(recordKey(c.hash));
        if (score && score.expires > Date.now()) continue;
        if (!meta.records.includes(c.hash)) meta.records.push(c.hash);
        // Bounded retention; never evict a queued/in-flight record (which could
        // admit and charge it twice). Expired entries are pruned first below.
        if (meta.records.length > MAX_RECORDS) {
          meta.records.pop(); break;
        }
        await txn.put(recordKey(c.hash), { pending: true, suspected: false, expires: Date.now() + DAY } satisfies Score);
        meta.queue.push(c);
      }
      await txn.put('meta', meta);
    });
    return json({ accepted: true });
  }
  private async api(path: string, payload?: unknown): Promise<Record<string, unknown>> {
    const signal = AbortSignal.timeout(20000);
    const response = await fetch(`${API}${path}`, { method: payload ? 'POST' : 'GET',
      headers: { 'X-Api-Key': this.env.OVERMIND_API_KEY!, Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}), redirect: 'manual', credentials: 'omit', signal });
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) {
      void response.body?.cancel().catch(() => undefined); throw new Error('Inference unavailable');
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(await readLimited(response.body, 128000, { signal })));
    if (!object(value)) throw new Error('Invalid inference receipt');
    return value;
  }
  private async finish(job: Job, flags: boolean[], cacheMs = 7 * DAY) {
    await this.state.storage.transaction(async txn => {
      const meta = await txn.get<Meta>('meta') ?? empty();
      if (meta.job?.key !== job.key) return;
      for (const candidate of job.candidates) {
        const i = job.scored?.findIndex(c => c.hash === candidate.hash) ?? -1;
        await txn.put(recordKey(candidate.hash), { pending: false, suspected: i >= 0 && flags[i] === true, expires: Date.now() + (i >= 0 ? cacheMs : 3600000) } satisfies Score);
      }
      delete meta.job;
      await txn.put('meta', meta);
    });
  }
  async alarm(): Promise<void> {
    if (!rankingEnabled(this.env)) return;
    const storage = this.state.storage;
    // Watchdog precedes any network work. Crash recovery sees the saved key,
    // payload and reservation rather than creating a new paid operation.
    await storage.setAlarm(Date.now() + 30000);
    let job = await storage.transaction(async txn => {
      const meta = await txn.get<Meta>('meta') ?? empty();
      const retained: string[] = [];
      for (const hash of meta.records) {
        const s = await txn.get<Score>(recordKey(hash));
        if (s && s.expires <= Date.now() && !s.pending) await txn.delete(recordKey(hash)); else retained.push(hash);
      }
      meta.records = retained;
      if (!meta.job && meta.queue.length) meta.job = { key: `opencaster-replies-v1-${crypto.randomUUID()}`, created: Date.now(), candidates: meta.queue.splice(0, BATCH_SIZE), attempts: 0 };
      if (!meta.job || meta.job.halted) await txn.deleteAlarm();
      await txn.put('meta', meta);
      return meta.job;
    });
    if (!job || job.halted) return;
    if (!job.decisions) {
      const reader = new SpamContextReader(this.env);
      const decisions: SpamDecision[] = [], scored: RankingCandidate[] = [];
      // Four concurrent node reads at most, with shared author/parent lookups.
      for (let i = 0; i < job.candidates.length; i += 4) {
        const candidates = job.candidates.slice(i, i + 4);
        const results = await Promise.allSettled(candidates.map(c => reader.decision(c)));
        results.forEach((r, index) => { if (r.status === 'fulfilled' && r.value) { decisions.push(r.value); scored.push(candidates[index]); } });
      }
      job = { ...job, decisions, scored };
      await storage.transaction(async txn => {
        const meta = await txn.get<Meta>('meta') ?? empty();
        const month = new Date().toISOString().slice(0, 7);
        const key = `reserved:${month}`;
        const reserved = await txn.get<number>(key) ?? 0;
        if (decisions.length && reserved + BATCH_RESERVE_CENTS <= budget(this.env)) {
          await txn.put(key, reserved + BATCH_RESERVE_CENTS); job!.reserved = true;
        }
        meta.job = job; await txn.put('meta', meta);
      });
    }
    if (!job.reserved || !job.decisions?.length) { await this.finish(job, [], 3600000); return; }
    if (!job.parts) {
      // Preserve the key/input of an already attempted legacy submission. An
      // unknown acknowledgement never authorizes splitting it under new keys.
      const legacy = !!job.id || job.attempts > 0 || job.decisions.length <= MAX_NATIVE_DECISIONS;
      job.parts = legacy ? [{ key: job.key, offset: 0, count: job.decisions.length, attempts: job.attempts, id: job.id }]
        : Array.from({ length: Math.ceil(job.decisions.length / MAX_NATIVE_DECISIONS) }, (_, i) => ({
          key: `${job!.key}-part${i}`, offset: i * MAX_NATIVE_DECISIONS,
          count: Math.min(MAX_NATIVE_DECISIONS, job!.decisions!.length - i * MAX_NATIVE_DECISIONS), attempts: 0,
        }));
    }
    const part = job.parts.find(p => p.flags === undefined);
    if (!part) { await this.finish(job, job.parts.flatMap(p => p.flags!), job.parts.some(p => p.failed) ? 3600000 : 7 * DAY); return; }
    try {
      let receipt: Record<string, unknown>;
      if (part.id) receipt = await this.api(`/api/inference-requests/${part.id}/`);
      else {
        if (part.count > MAX_NATIVE_DECISIONS || part.attempts >= 3) { job.halted = true; throw new Error('Unresolved legacy submission'); }
        part.attempts++;
        await storage.transaction(async txn => { const meta = (await txn.get<Meta>('meta'))!; meta.job = job; await txn.put('meta', meta); });
        receipt = await this.api(`/api/deployed-models/${SPAM_DEPLOYMENT}/inference/`, {
          request_key: part.key, decisions: job.decisions.slice(part.offset, part.offset + part.count),
        });
      }
      if (typeof receipt.id !== 'string' || !UUID.test(receipt.id) || (part.id && receipt.id !== part.id)
        || receipt.request_key !== part.key || receipt.model_id !== SPAM_MODEL) throw new Error('Mismatched inference receipt');
      part.id = receipt.id;
      if (receipt.status === 'succeeded') part.flags = suspectedPredictions(receipt.result, part.count);
      else if (['failed', 'cancelled'].includes(String(receipt.status))) { part.flags = Array(part.count).fill(false); part.failed = true; }
      else if (!['queued', 'running'].includes(String(receipt.status)) || Date.now() - job.created > 55 * 60000) throw new Error('Unresolved inference status');
      if (job.parts.every(p => p.flags !== undefined)) await this.finish(job, job.parts.flatMap(p => p.flags!), job.parts.some(p => p.failed) ? 3600000 : 7 * DAY);
      else await storage.transaction(async txn => { const meta = (await txn.get<Meta>('meta'))!; meta.job = job; await txn.put('meta', meta); });
    } catch {
      // Reconnect using the SAME request key and exact stored inputs only.
      // Unresolved work halts further paid submissions; it is never re-keyed.
      if ((!part.id && part.attempts >= 3) || Date.now() - job.created > 55 * 60000) job.halted = true;
      await storage.transaction(async txn => { const meta = (await txn.get<Meta>('meta'))!; meta.job = job; await txn.put('meta', meta); });
    }
  }
}
