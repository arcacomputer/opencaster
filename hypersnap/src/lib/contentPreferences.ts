import type { Cast } from './api';

// These public-content snapshots are browser preferences, never protocol writes.
// Pure validation and matching are candidates for a shared Hypersnap package.
export const MUTED_ACCOUNT_LIMIT = 100;
export const MUTED_WORD_LIMIT = 100;
export const HIDDEN_CAST_LIMIT = 500;
export const MUTED_WORD_CHARACTER_LIMIT = 80;
export const MUTED_WORD_BYTE_LIMIT = 256;
const MAX_STORED_BYTES = 256 * 1024;
const HASH = /^(?:0x)?[a-fA-F0-9]{40}$/;
// eslint-disable-next-line no-control-regex -- Stored content settings intentionally reject C0 and C1 control characters.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const bytes = (value: string) => new TextEncoder().encode(value).length;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const validFid = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const fold = (value: string) => value.normalize('NFC').toLowerCase().normalize('NFC');

export interface MutedAccount { fid: number; username?: string; display_name?: string }
export interface ContentPreferences {
  version: 1;
  mutedAccounts: MutedAccount[];
  mutedWords: string[];
  hiddenCasts: string[];
}
interface PreferenceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export function emptyContentPreferences(): ContentPreferences {
  return { version: 1, mutedAccounts: [], mutedWords: [], hiddenCasts: [] };
}

export function contentPreferencesKey(fid?: number): string {
  if (fid !== undefined && !validFid(fid)) throw new Error('Choose a valid account for these browser preferences.');
  return `arca.hypersnap.content-preferences.v1.${fid === undefined ? 'guest' : `account.${fid}`}`;
}

function label(value: unknown, characters: number): string | undefined {
  if (typeof value !== 'string') return;
  const normalized = value.trim().normalize('NFC');
  if (!normalized || CONTROL.test(normalized)) return;
  return Array.from(normalized).slice(0, characters).join('');
}
function account(value: unknown): MutedAccount | undefined {
  if (!object(value) || !validFid(value.fid)) return;
  const username = label(value.username, 64);
  const display = label(value.display_name, 128);
  return { fid: value.fid, ...(username ? { username } : {}), ...(display ? { display_name: display } : {}) };
}
function castHash(value: unknown): string | undefined {
  return typeof value === 'string' && HASH.test(value) ? value.replace(/^0x/, '').toLowerCase() : undefined;
}

/** Throws for an invalid new word; stored corrupt words are skipped on read. */
export function normalizeMutedWord(value: string): string {
  if (typeof value !== 'string') throw new Error('Enter a word or phrase to mute.');
  const word = value.trim().normalize('NFC');
  if (!word) throw new Error('Enter a word or phrase to mute.');
  if (CONTROL.test(word)) throw new Error('Use a single-line word or phrase without control characters.');
  if (Array.from(word).length > MUTED_WORD_CHARACTER_LIMIT || bytes(word) > MUTED_WORD_BYTE_LIMIT) throw new Error('Use up to 80 characters and 256 UTF-8 bytes per word or phrase.');
  return word;
}

/** Whitelists public fields, discards invalid entries and bounds every list. */
export function normalizeContentPreferences(value: unknown): ContentPreferences {
  const result = emptyContentPreferences();
  if (!object(value) || value.version !== 1 || !Array.isArray(value.mutedAccounts) || !Array.isArray(value.mutedWords) || !Array.isArray(value.hiddenCasts)) return result;
  const fids = new Set<number>(); const words = new Set<string>(); const hashes = new Set<string>();
  for (const entry of value.mutedAccounts.slice(0, 1_000)) {
    const parsed = account(entry);
    if (!parsed || fids.has(parsed.fid)) continue;
    result.mutedAccounts.push(parsed); fids.add(parsed.fid);
    if (result.mutedAccounts.length === MUTED_ACCOUNT_LIMIT) break;
  }
  for (const entry of value.mutedWords.slice(0, 1_000)) {
    if (typeof entry !== 'string') continue;
    let word: string;
    try { word = normalizeMutedWord(entry); } catch { continue; }
    const key = fold(word);
    if (words.has(key)) continue;
    result.mutedWords.push(word); words.add(key);
    if (result.mutedWords.length === MUTED_WORD_LIMIT) break;
  }
  for (const entry of value.hiddenCasts.slice(0, 2_000)) {
    const hash = castHash(entry);
    if (!hash || hashes.has(hash)) continue;
    result.hiddenCasts.push(hash); hashes.add(hash);
    if (result.hiddenCasts.length === HIDDEN_CAST_LIMIT) break;
  }
  return result;
}

export function readContentPreferences(fid?: number, storage?: Pick<PreferenceStorage, 'getItem'>): ContentPreferences {
  try {
    const raw = (storage ?? localStorage).getItem(contentPreferencesKey(fid));
    if (!raw || raw.length > MAX_STORED_BYTES || bytes(raw) > MAX_STORED_BYTES) return emptyContentPreferences();
    return normalizeContentPreferences(JSON.parse(raw));
  } catch { return emptyContentPreferences(); }
}

export function writeContentPreferences(preferences: ContentPreferences, fid?: number, storage?: Pick<PreferenceStorage, 'setItem'>): boolean {
  try {
    const key = contentPreferencesKey(fid);
    const raw = JSON.stringify(normalizeContentPreferences(preferences));
    if (bytes(raw) > MAX_STORED_BYTES) return false;
    (storage ?? localStorage).setItem(key, raw);
    return true;
  } catch { return false; }
}

export function addMutedWord(preferences: ContentPreferences, input: string): ContentPreferences {
  const next = normalizeContentPreferences(preferences); const word = normalizeMutedWord(input);
  if (next.mutedWords.some(current => fold(current) === fold(word))) throw new Error('That word or phrase is already muted.');
  if (next.mutedWords.length === MUTED_WORD_LIMIT) throw new Error('Mute up to 100 words or phrases. Remove one before adding another.');
  return { ...next, mutedWords: [...next.mutedWords, word] };
}
export function removeMutedWord(preferences: ContentPreferences, input: string): ContentPreferences {
  const next = normalizeContentPreferences(preferences);
  return { ...next, mutedWords: next.mutedWords.filter(word => fold(word) !== fold(input)) };
}
export function muteAccount(preferences: ContentPreferences, input: MutedAccount): ContentPreferences {
  const next = normalizeContentPreferences(preferences); const parsed = account(input);
  if (!parsed) throw new Error('This profile has no valid Farcaster ID.');
  if (next.mutedAccounts.some(current => current.fid === parsed.fid)) return next;
  if (next.mutedAccounts.length === MUTED_ACCOUNT_LIMIT) throw new Error('Mute up to 100 accounts. Remove one before adding another.');
  return { ...next, mutedAccounts: [...next.mutedAccounts, parsed] };
}
export function unmuteAccount(preferences: ContentPreferences, fid: number): ContentPreferences {
  const next = normalizeContentPreferences(preferences);
  return { ...next, mutedAccounts: next.mutedAccounts.filter(value => value.fid !== fid) };
}
export function hideCast(preferences: ContentPreferences, input: string): ContentPreferences {
  const next = normalizeContentPreferences(preferences); const hash = castHash(input);
  if (!hash) throw new Error('This cast has no valid hash.');
  if (next.hiddenCasts.includes(hash)) return next;
  if (next.hiddenCasts.length === HIDDEN_CAST_LIMIT) throw new Error('Hide up to 500 casts. Clear hidden casts in content settings before hiding another.');
  return { ...next, hiddenCasts: [...next.hiddenCasts, hash] };
}
export function unhideCast(preferences: ContentPreferences, input: string): ContentPreferences {
  const next = normalizeContentPreferences(preferences); const hash = castHash(input);
  return { ...next, hiddenCasts: next.hiddenCasts.filter(value => value !== hash) };
}

interface CompiledPreferences {
  readonly source: Pick<ContentPreferences, 'mutedAccounts' | 'mutedWords' | 'hiddenCasts'>;
  readonly lengths: readonly [number, number, number];
  readonly hidden: ReadonlySet<string>;
  readonly mutedFids: ReadonlySet<unknown>;
  foldedWords?: readonly string[];
}
// Filtering runs per cast on every feed render, so lookups and folded words are
// built once per preferences object. Preference updates return new objects; the
// identity/length check rebuilds after any in-place list replacement or growth.
const compiledPreferences = new WeakMap<ContentPreferences, CompiledPreferences>();
function compile(preferences: ContentPreferences): CompiledPreferences {
  const { mutedAccounts, mutedWords, hiddenCasts } = preferences;
  const cached = compiledPreferences.get(preferences);
  if (cached && cached.source.mutedAccounts === mutedAccounts && cached.source.mutedWords === mutedWords && cached.source.hiddenCasts === hiddenCasts
    && cached.lengths[0] === mutedAccounts.length && cached.lengths[1] === mutedWords.length && cached.lengths[2] === hiddenCasts.length) return cached;
  // Array#includes matches like Set#has; `some(===)` never matches NaN, so NaN FIDs are left out.
  const compiled: CompiledPreferences = {
    source: { mutedAccounts, mutedWords, hiddenCasts },
    lengths: [mutedAccounts.length, mutedWords.length, hiddenCasts.length],
    hidden: new Set(hiddenCasts),
    mutedFids: new Set(mutedAccounts.map(value => value.fid).filter(value => !Number.isNaN(value))),
  };
  compiledPreferences.set(preferences, compiled);
  return compiled;
}

/** Only public cast text is matched. Opaque quoted text is never inferred.
 * Cast-ID quote references can still honor hidden hashes and muted author FIDs. */
export function getContentFilterReason(cast: Cast, preferences: ContentPreferences): string | undefined {
  const compiled = compile(preferences);
  const hash = castHash(cast.hash);
  if (hash && compiled.hidden.has(hash)) return 'Hidden on this browser';
  if (compiled.mutedFids.has(cast.author?.fid)) return 'Muted account on this browser';
  for (const embed of cast.embeds ?? []) {
    if (!('cast_id' in embed)) continue;
    const target = castHash(embed.cast_id.hash);
    if (target && compiled.hidden.has(target)) return 'Quotes a cast hidden on this browser';
    if (compiled.mutedFids.has(embed.cast_id.fid)) return 'Quotes an account muted on this browser';
  }
  const text = fold(cast.text);
  compiled.foldedWords ??= preferences.mutedWords.map(fold);
  return compiled.foldedWords.some(word => text.includes(word)) ? 'Contains a word or phrase muted on this browser' : undefined;
}
