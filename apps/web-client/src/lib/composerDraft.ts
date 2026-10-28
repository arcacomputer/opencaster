/** Local, explicit draft storage; no signer secrets or network operations.
 * Platform-independent validation is a future mobile migration candidate.
 */
import { isUploadedMediaUrl } from '@opencaster/client-core/appOrigins';

export interface DraftMention { fid: number; username: string }
export interface DraftContent { text: string; mentions: DraftMention[]; images: string[] }
export interface SavedComposerDraft extends DraftContent { version: 1; id: string; scope: string; updatedAt: number }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const COMPOSER_DRAFT_KEY = 'arca.hypersnap.composer.drafts.v1';
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_DRAFTS = 20;
const MAX_STORAGE_BYTES = 128 * 1024;
const encoder = new TextEncoder();
const validFid = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 0xffffffff;
const hash = (value: string) => { if (!/^(?:0x)?[a-fA-F0-9]{40}$/.test(value)) throw new Error('This draft has an invalid cast destination.'); return value.replace(/^0x/, '').toLowerCase(); };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function composerDraftScope(identity: { fid: number; publicKey: string }, destination: { parent?: { fid: number; hash: string }; parentUrl?: string; quote?: { fid: number; hash: string } } = {}): string {
  if (!validFid(identity.fid) || !/^[a-f0-9]{64}$/.test(identity.publicKey)) throw new Error('Reconnect this account before saving a draft.');
  const target = (value: { fid: number; hash: string }) => { if (!validFid(value.fid)) throw new Error('This draft has an invalid cast destination.'); return `${value.fid}:${hash(value.hash)}`; };
  let channel = '';
  if (destination.parentUrl) {
    try { const url = new URL(destination.parentUrl); if (url.protocol !== 'https:' || url.username || url.password || encoder.encode(destination.parentUrl).length > 256) throw new Error(); channel = destination.parentUrl; }
    catch { throw new Error('This draft has an invalid channel destination.'); }
  }
  if (channel && destination.parent) throw new Error('Choose one draft destination.');
  return JSON.stringify([identity.fid, destination.parent ? `reply:${target(destination.parent)}` : channel ? `channel:${channel}` : 'root', destination.quote ? `quote:${target(destination.quote)}` : '']);
}

function validContent(value: unknown): value is DraftContent {
  return object(value) && typeof value.text === 'string' && encoder.encode(value.text).length <= 16_384
    && Array.isArray(value.mentions) && value.mentions.length <= 10 && value.mentions.every(mention => object(mention) && validFid(mention.fid) && typeof mention.username === 'string' && (mention.username === '' || mention.username === `fid:${mention.fid}` || /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(mention.username)))
    && Array.isArray(value.images) && value.images.length <= 2 && value.images.every(isUploadedMediaUrl);
}
function records(storage: StoragePort, now: number): SavedComposerDraft[] {
  const raw = storage.getItem(COMPOSER_DRAFT_KEY);
  if (!raw) return [];
  if (encoder.encode(raw).length > MAX_STORAGE_BYTES) throw new Error('Saved draft storage is too large. Discard old drafts before saving another.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Saved drafts could not be read in this browser.'); }
  if (!Array.isArray(parsed)) throw new Error('Saved drafts could not be read in this browser.');
  return parsed.filter((value): value is SavedComposerDraft => validContent(value) && object(value) && value.version === 1 && typeof value.id === 'string' && /^[a-f0-9]{32}$/.test(value.id) && typeof value.scope === 'string' && value.scope.length <= 1024 && Number.isSafeInteger(value.updatedAt) && Number(value.updatedAt) <= now + 60_000 && Number(value.updatedAt) > now - DRAFT_TTL_MS).slice(-MAX_DRAFTS);
}
export function readComposerDraft(scope: string, storage: StoragePort = sessionStorage, now = Date.now()): SavedComposerDraft | undefined {
  return records(storage, now).filter(value => value.scope === scope).sort((a, b) => b.updatedAt - a.updatedAt)[0];
}
export function saveComposerDraft(scope: string, content: DraftContent, storage: StoragePort = sessionStorage, now = Date.now()): SavedComposerDraft {
  if (typeof scope !== 'string' || scope.length > 1024 || !validContent(content)) throw new Error('This draft cannot be saved. Keep text under 16 KiB and up to two uploaded images.');
  const random = crypto.getRandomValues(new Uint8Array(16));
  const draft: SavedComposerDraft = { version: 1, id: Array.from(random, byte => byte.toString(16).padStart(2, '0')).join(''), scope, updatedAt: now, text: content.text, mentions: content.mentions.map(({ fid, username }) => ({ fid, username })), images: [...content.images] };
  const next = records(storage, now).filter(value => value.scope !== scope).sort((a, b) => a.updatedAt - b.updatedAt);
  next.push(draft);
  while (next.length > MAX_DRAFTS || encoder.encode(JSON.stringify(next)).length > MAX_STORAGE_BYTES) next.shift();
  storage.setItem(COMPOSER_DRAFT_KEY, JSON.stringify(next));
  return draft;
}
/** An old posting receipt must never remove a newer saved revision. */
export function removeComposerDraft(scope: string, expectedId?: string, storage: StoragePort = sessionStorage, now = Date.now()): void {
  const next = records(storage, now).filter(value => value.scope !== scope || (expectedId !== undefined && value.id !== expectedId));
  if (next.length) storage.setItem(COMPOSER_DRAFT_KEY, JSON.stringify(next)); else storage.removeItem(COMPOSER_DRAFT_KEY);
}

export interface MentionQuery { start: number; end: number; query: string }
export function inlineMentionQuery(text: string, caret: number): MentionQuery | undefined {
  if (!Number.isInteger(caret) || caret < 0 || caret > text.length) return;
  const match = /(?:^|[\s([{])@([a-zA-Z0-9_.-]{1,64})$/.exec(text.slice(0, caret));
  if (!match || /[a-zA-Z0-9_.-]/.test(text[caret] ?? '')) return;
  return { start: caret - match[1].length - 1, end: caret, query: match[1] };
}
