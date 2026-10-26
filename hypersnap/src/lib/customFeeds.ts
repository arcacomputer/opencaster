import type { Cast, TrendingTimeWindow } from './api';
import { APP_ORIGIN, LEGACY_APP_ORIGIN } from './appOrigins';

/** Public feed recipes only; saved recipes are shared by this browser's accounts. */
export const CUSTOM_FEED_SOURCE_LIMIT = 8;
export const SAVED_FEED_LIMIT = 30;
export const CUSTOM_FEED_NAME_LIMIT = 64;
export const CUSTOM_FEED_PHRASE_LIMIT = 10;
export const CUSTOM_FEED_PHRASE_LENGTH_LIMIT = 64;
export const CUSTOM_FEED_TOKEN_LIMIT = 6000;
export const SAVED_FEED_STORAGE_KEY = 'arca.hypersnap.feeds.v1';
const STORAGE_BYTE_LIMIT = 256 * 1024;
const encoder = new TextEncoder();
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const validFid = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const control = /[\u0000-\u001f\u007f]/;
const normalizedText = (value: string) => value.normalize('NFKC').toLowerCase();
type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;

export type FeedSource = { kind: 'trending'; timeWindow: TrendingTimeWindow } | { kind: 'following' | 'user'; fid: number } | { kind: 'channel'; channel: string };
export interface FeedDefinition {
  version: 1;
  name: string;
  sources: FeedSource[];
  order: 'source' | 'newest';
  filters: { includeWords: string[]; excludeWords: string[]; hideReplies: boolean; imagesOnly: boolean };
}
export interface SavedFeed { id: string; definition: FeedDefinition; pinned: boolean }

export function sourceKey(source: FeedSource): string {
  if (source.kind === 'trending') return `trending:${source.timeWindow}`;
  if (source.kind === 'channel') return `channel:${source.channel}`;
  return `${source.kind}:${source.fid}`;
}

function normalizeSource(value: unknown): FeedSource | undefined {
  if (!object(value)) return;
  if (value.kind === 'trending' && typeof value.timeWindow === 'string' && ['1h', '6h', '12h', '24h', '7d'].includes(value.timeWindow)) return { kind: 'trending', timeWindow: value.timeWindow as TrendingTimeWindow };
  if ((value.kind === 'following' || value.kind === 'user') && validFid(value.fid)) return { kind: value.kind, fid: value.fid };
  if (value.kind === 'channel' && typeof value.channel === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value.channel)) return { kind: 'channel', channel: value.channel };
}

function phrases(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > CUSTOM_FEED_PHRASE_LIMIT) return;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const phrase of value) {
    if (typeof phrase !== 'string' || control.test(phrase)) return;
    const trimmed = phrase.trim();
    if (!trimmed || trimmed.length > CUSTOM_FEED_PHRASE_LENGTH_LIMIT) return;
    const key = normalizedText(trimmed);
    if (!seen.has(key)) { result.push(trimmed); seen.add(key); }
  }
  return result;
}

/** Rebuild the public schema, never retaining unknown metadata or credentials. */
export function normalizeFeedDefinition(value: unknown): FeedDefinition | undefined {
  if (!object(value) || value.version !== 1 || typeof value.name !== 'string' || control.test(value.name)) return;
  const name = value.name.trim();
  if (!name || name.length > CUSTOM_FEED_NAME_LIMIT || !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > CUSTOM_FEED_SOURCE_LIMIT) return;
  if ((value.order !== 'source' && value.order !== 'newest') || !object(value.filters)) return;
  const includeWords = phrases(value.filters.includeWords);
  const excludeWords = phrases(value.filters.excludeWords);
  if (!includeWords || !excludeWords || typeof value.filters.hideReplies !== 'boolean' || typeof value.filters.imagesOnly !== 'boolean') return;
  const sources: FeedSource[] = [];
  const seen = new Set<string>();
  for (const candidate of value.sources) {
    const source = normalizeSource(candidate);
    if (!source) return;
    const key = sourceKey(source);
    if (!seen.has(key)) { sources.push(source); seen.add(key); }
  }
  const definition: FeedDefinition = { version: 1, name, sources, order: value.order, filters: { includeWords, excludeWords, hideReplies: value.filters.hideReplies, imagesOnly: value.filters.imagesOnly } };
  // Every accepted or saved recipe must also fit its public share URL budget.
  // This catches long multibyte phrases even when individual fields fit.
  if (encodeToken(definition).length > CUSTOM_FEED_TOKEN_LIMIT) return;
  return definition;
}

function hasImage(cast: Cast): boolean {
  return cast.embeds.some(embed => {
    if (!('url' in embed)) return false;
    try {
      const url = new URL(embed.url);
      return url.protocol === 'https:' && (/\.(png|jpe?g|webp|gif)$/i.test(url.pathname)
        || ['imagedelivery.net', 'imagedelivery.cloud'].includes(url.hostname)
        || ([APP_ORIGIN, LEGACY_APP_ORIGIN].includes(url.origin) && /^\/media\/[a-f0-9]{64}$/.test(url.pathname)));
    } catch { return false; }
  });
}

/** Phrase inclusion means any matching literal phrase in this cast's own text. */
export function feedMatches(cast: Cast, definition: FeedDefinition): boolean {
  if (definition.filters.hideReplies && cast.parent_hash) return false;
  if (definition.filters.imagesOnly && !hasImage(cast)) return false;
  const text = normalizedText(cast.text);
  return (!definition.filters.includeWords.length || definition.filters.includeWords.some(phrase => text.includes(normalizedText(phrase))))
    && !definition.filters.excludeWords.some(phrase => text.includes(normalizedText(phrase)));
}

/** Newest sorts only loaded casts; neither mode claims a complete global order. */
export function orderFeedCasts(casts: readonly Cast[], definition: FeedDefinition): Cast[] {
  const seen = new Set<string>();
  const unique = casts.filter(cast => {
    const key = cast.hash.replace(/^0x/i, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  return definition.order === 'newest' ? unique.sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0)) : unique;
}

function encodeToken(value: unknown): string {
  const bytes = encoder.encode(JSON.stringify(value));
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function encodeFeed(definition: FeedDefinition): string {
  const normalized = normalizeFeedDefinition(definition);
  if (!normalized) throw new Error('Choose a valid feed name, sources and filters.');
  const token = encodeToken(normalized);
  if (token.length > CUSTOM_FEED_TOKEN_LIMIT) throw new Error('This feed recipe is too large to share. Shorten its name or phrases.');
  return token;
}

export function decodeFeed(token: string): FeedDefinition | undefined {
  try {
    if (typeof token !== 'string' || !token || token.length > CUSTOM_FEED_TOKEN_LIMIT || !/^[A-Za-z0-9_-]+$/.test(token) || token.length % 4 === 1) return;
    const binary = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, character => character.charCodeAt(0))));
    // Reject alternate encodings and trailing bits, while rebuilding the schema.
    if (encodeToken(value) !== token) return;
    return normalizeFeedDefinition(value);
  } catch { return; }
}

function savedFeed(value: unknown): SavedFeed | undefined {
  if (!object(value) || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id) || typeof value.pinned !== 'boolean') return;
  const definition = normalizeFeedDefinition(value.definition);
  return definition ? { id: value.id, definition, pinned: value.pinned } : undefined;
}

export function readSavedFeeds(storage?: Reader): SavedFeed[] {
  try {
    const raw = (storage ?? localStorage).getItem(SAVED_FEED_STORAGE_KEY);
    if (!raw || encoder.encode(raw).length > STORAGE_BYTE_LIMIT) return [];
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.version !== 1 || !Array.isArray(value.feeds) || value.feeds.length > SAVED_FEED_LIMIT) return [];
    const feeds: SavedFeed[] = []; const seen = new Set<string>();
    for (const candidate of value.feeds) {
      const feed = savedFeed(candidate);
      if (feed && !seen.has(feed.id)) { feeds.push(feed); seen.add(feed.id); }
    }
    return feeds;
  } catch { return []; }
}

/** Atomic local write: invalid input or unavailable storage leaves the old record. */
export function writeSavedFeeds(feeds: readonly SavedFeed[], storage?: Writer): boolean {
  try {
    if (!Array.isArray(feeds) || feeds.length > SAVED_FEED_LIMIT) return false;
    const normalized = feeds.map(savedFeed);
    if (normalized.some(feed => !feed) || new Set(normalized.map(feed => feed!.id)).size !== normalized.length) return false;
    const raw = JSON.stringify({ version: 1, feeds: normalized });
    if (encoder.encode(raw).length > STORAGE_BYTE_LIMIT) return false;
    (storage ?? localStorage).setItem(SAVED_FEED_STORAGE_KEY, raw); return true;
  } catch { return false; }
}

export function newSavedFeed(definition: FeedDefinition): SavedFeed {
  const normalized = normalizeFeedDefinition(definition);
  if (!normalized) throw new Error('This feed recipe is invalid.');
  return { id: crypto.randomUUID(), definition: normalized, pinned: false };
}
