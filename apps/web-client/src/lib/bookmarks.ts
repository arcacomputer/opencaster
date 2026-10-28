import type { Cast, Channel, User } from '@opencaster/client-core/api';

// Public local snapshots only. Validation/filtering can move to a future shared
// Hypersnap mobile package; the optional Storage argument is the web adapter.
export const BOOKMARK_LIMIT = 500;
export const BOOKMARK_STORAGE_KEY = 'arca.hypersnap.bookmarks.v1';
export const LEGACY_BOOKMARK_STORAGE_KEY = 'quorum.bookmarks.v1';
export type BookmarkSort = 'newest' | 'oldest';
const MAX_BYTES = 2 * 1024 * 1024;
const encoder = new TextEncoder();
type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const fid = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 0xffffffff;
const text = (value: unknown, length: number) => typeof value === 'string' ? value.slice(0, length) : '';
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
export function bookmarkHash(value: unknown): string | undefined { return typeof value === 'string' && /^(?:0x)?[a-fA-F0-9]{40}$/.test(value) ? `0x${value.replace(/^0x/, '').toLowerCase()}` : undefined; }
function https(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return;
  try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password) return value; } catch { /* Discard an unusable optional URL. */ }
}
function userSnapshot(value: unknown): User | undefined {
  if (!object(value) || !fid(value.fid)) return;
  const username = typeof value.username === 'string' && (value.username === '' || value.username === `fid:${value.fid}` || /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value.username)) ? value.username : '';
  const pfp = https(value.pfp_url);
  const bio = object(value.profile) && object(value.profile.bio) ? text(value.profile.bio.text, 1024) : '';
  return { fid: value.fid, username, ...(typeof value.display_name === 'string' ? { display_name: text(value.display_name, 256) } : {}), ...(pfp ? { pfp_url: pfp } : {}), custody_address: '', profile: { bio: { text: bio } }, follower_count: count(value.follower_count), following_count: count(value.following_count) };
}
function channelSnapshot(value: unknown): Channel | undefined {
  if (!object(value) || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.id)) return;
  const url = https(value.url); const parent = https(value.parent_url); const image = https(value.image_url);
  return { id: value.id, name: text(value.name, 128) || value.id, url: url ?? '', ...(parent ? { parent_url: parent } : {}), ...(image ? { image_url: image } : {}), ...(typeof value.description === 'string' ? { description: text(value.description, 512) } : {}) };
}
function snapshot(value: unknown): Cast | undefined {
  if (!object(value)) return;
  const hash = bookmarkHash(value.hash); const author = userSnapshot(value.author);
  if (!hash || !author || typeof value.text !== 'string' || value.text.length > 16_384 || typeof value.timestamp !== 'string' || value.timestamp.length > 64 || !Number.isFinite(Date.parse(value.timestamp))) return;
  const embeds: Cast['embeds'] = [];
  if (Array.isArray(value.embeds)) for (const embed of value.embeds.slice(0, 2)) {
    if (!object(embed)) continue;
    const url = https(embed.url);
    if (url) embeds.push({ url });
    else if (object(embed.cast_id) && fid(embed.cast_id.fid)) { const target = bookmarkHash(embed.cast_id.hash); if (target) embeds.push({ cast_id: { fid: embed.cast_id.fid, hash: target } }); }
  }
  const parentHash = bookmarkHash(value.parent_hash); const parentUrl = https(value.parent_url); const rootUrl = https(value.root_parent_url);
  const channel = channelSnapshot(value.channel);
  const result: Cast = { hash, author, text: value.text, timestamp: value.timestamp, embeds, reactions: { likes_count: object(value.reactions) ? count(value.reactions.likes_count) : 0, recasts_count: object(value.reactions) ? count(value.reactions.recasts_count) : 0 }, replies: { count: object(value.replies) ? count(value.replies.count) : 0 }, ...(parentHash ? { parent_hash: parentHash } : {}), ...(parentUrl ? { parent_url: parentUrl } : {}), ...(rootUrl ? { root_parent_url: rootUrl } : {}), ...(object(value.parent_author) && fid(value.parent_author.fid) ? { parent_author: { fid: value.parent_author.fid } } : {}), ...(channel ? { channel } : {}) };
  if (Array.isArray(value.mentioned_profiles) && Array.isArray(value.mentioned_profiles_ranges) && value.mentioned_profiles.length > 0 && value.mentioned_profiles.length <= 10 && value.mentioned_profiles.length === value.mentioned_profiles_ranges.length) {
    const profiles = value.mentioned_profiles.map(userSnapshot); const ranges = value.mentioned_profiles_ranges;
    const boundaries = new Set([0]); let bytes = 0; for (const character of value.text) { bytes += encoder.encode(character).length; boundaries.add(bytes); }
    let previous = 0;
    if (profiles.every((person): person is User => Boolean(person)) && ranges.every(range => { if (!object(range) || !Number.isSafeInteger(range.start) || range.start !== range.end || Number(range.start) < previous || !boundaries.has(Number(range.start))) return false; previous = Number(range.start); return true; })) {
      result.mentioned_profiles = profiles; result.mentioned_profiles_ranges = ranges.map(range => ({ start: range.start, end: range.end }));
    }
  }
  return result;
}

export function normalizeBookmarks(values: readonly unknown[]): Cast[] {
  const result: Cast[] = []; const seen = new Set<string>();
  for (const value of values.slice(0, 2500)) {
    let cast: Cast | undefined; try { cast = snapshot(value); } catch { /* A malformed optional record must not break all saved items. */ }
    if (!cast || seen.has(cast.hash)) continue;
    result.push(cast); seen.add(cast.hash); if (result.length === BOOKMARK_LIMIT) break;
  }
  return result;
}
export function readBookmarks(storage?: Reader): Cast[] {
  try {
    const source = storage ?? localStorage;
    const current = source.getItem(BOOKMARK_STORAGE_KEY);
    const raw = current ?? source.getItem(LEGACY_BOOKMARK_STORAGE_KEY);
    if (!raw || encoder.encode(raw).length > MAX_BYTES) return [];
    const value: unknown = JSON.parse(raw);
    // Legacy raw arrays are read without rewriting them. New-format empties
    // take precedence so cleared bookmarks cannot reappear from the old key.
    if (current === null) return Array.isArray(value) ? normalizeBookmarks(value) : [];
    return object(value) && value.version === 1 && Array.isArray(value.casts) ? normalizeBookmarks(value.casts) : [];
  } catch { return []; }
}
export function saveBookmarks(casts: readonly Cast[], storage?: Writer): boolean {
  try {
    const raw = JSON.stringify({ version: 1, casts: normalizeBookmarks(casts) });
    if (encoder.encode(raw).length > MAX_BYTES) return false;
    (storage ?? localStorage).setItem(BOOKMARK_STORAGE_KEY, raw); return true;
  } catch { return false; }
}
export function toggleBookmark(casts: readonly Cast[], cast: Cast): Cast[] {
  const current = normalizeBookmarks(casts); const item = snapshot(cast);
  if (!item) throw new Error('This cast cannot be bookmarked because its public metadata is invalid.');
  return current.some(value => value.hash === item.hash) ? current.filter(value => value.hash !== item.hash) : [item, ...current].slice(0, BOOKMARK_LIMIT);
}
export function filterBookmarks(casts: readonly Cast[], query: string, sort: BookmarkSort = 'newest'): Cast[] {
  const normalized = (value: string) => value.normalize('NFKC').toLowerCase();
  const terms = normalized(query.slice(0, 256)).trim().split(/\s+/).filter(Boolean);
  const filtered = casts.filter(cast => {
    const names = [cast.text, cast.author.display_name ?? '', cast.author.username, `@${cast.author.username}`, `fid:${cast.author.fid}`, cast.channel?.id ?? '', cast.channel ? `/${cast.channel.id}` : '', cast.channel?.name ?? '', ...(cast.mentioned_profiles?.map(person => `@${person.username}`) ?? [])];
    const haystack = normalized(names.join(' ')); return terms.every(term => haystack.includes(term));
  });
  return sort === 'oldest' ? filtered.reverse() : filtered;
}
