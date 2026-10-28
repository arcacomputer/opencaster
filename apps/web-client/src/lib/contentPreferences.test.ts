import { describe, expect, it, vi, afterEach } from 'vitest';
import type { Cast } from '@opencaster/client-core/api';
import { addMutedWord, contentPreferencesKey, emptyContentPreferences, getContentFilterReason, hideCast, muteAccount, normalizeContentPreferences, normalizeMutedWord, readContentPreferences, removeMutedWord, unhideCast, unmuteAccount, writeContentPreferences } from './contentPreferences';

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const cast = (patch: Partial<Cast> = {}): Cast => ({ hash: 'a'.repeat(40), author: { fid: 3, username: 'alice', custody_address: '', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 }, text: 'Coffee and CAFÉ', timestamp: '2026-10-21T12:00:00Z', embeds: [], reactions: { likes_count: 0, recasts_count: 0 }, replies: { count: 0 }, ...patch });
afterEach(() => vi.unstubAllGlobals());

describe('browser content preferences', () => {
  it('separates guest and each account and never falls back from an invalid account', () => {
    const store = storage(); const prefs = addMutedWord(emptyContentPreferences(), 'coffee');
    expect(writeContentPreferences(prefs, 3, store)).toBe(true);
    expect(readContentPreferences(3, store)).toEqual(prefs);
    expect(readContentPreferences(4, store)).toEqual(emptyContentPreferences());
    expect(readContentPreferences(undefined, store)).toEqual(emptyContentPreferences());
    expect(writeContentPreferences(prefs, undefined, store)).toBe(true);
    expect(readContentPreferences(undefined, store)).toEqual(prefs);
    for (const fid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => contentPreferencesKey(fid)).toThrow('valid account');
      expect(writeContentPreferences(prefs, fid, store)).toBe(false);
      expect(readContentPreferences(fid, store)).toEqual(emptyContentPreferences());
    }
    expect(new Set([...store.values.keys()]).size).toBe(2);
  });
  it('stores a versioned whitelist of bounded public content without arbitrary account fields', () => {
    const store = storage();
    const input = { version: 1, mutedAccounts: [{ fid: 3, username: ' alice ', display_name: 'Alice', privateKey: 'must not persist' }, { fid: 3 }, { fid: '4' }, { fid: 5, username: 'bad\nlabel' }], mutedWords: [' cafe\u0301 ', 'CAFÉ', '', 'x\nline', 'x'.repeat(81)], hiddenCasts: ['0x' + 'A'.repeat(40), 'a'.repeat(40), 'invalid'], custodyAddress: 'must not persist', signer: 'must not persist' };
    expect(writeContentPreferences(input as never, 3, store)).toBe(true);
    const raw = store.values.get(contentPreferencesKey(3))!;
    expect(raw).not.toContain('must not persist'); expect(raw).not.toContain('privateKey');
    expect(JSON.parse(raw)).toEqual({ version: 1, mutedAccounts: [{ fid: 3, username: 'alice', display_name: 'Alice' }, { fid: 5 }], mutedWords: ['café'], hiddenCasts: ['a'.repeat(40)] });
    const bounded = normalizeContentPreferences({ version: 1, mutedAccounts: Array.from({ length: 110 }, (_, i) => ({ fid: i + 1, display_name: '😀'.repeat(200) })), mutedWords: Array.from({ length: 110 }, (_, i) => `word${i}`), hiddenCasts: Array.from({ length: 510 }, (_, i) => i.toString(16).padStart(40, '0')) });
    expect(bounded.mutedAccounts).toHaveLength(100); expect(Array.from(bounded.mutedAccounts[0].display_name!)).toHaveLength(128);
    expect(bounded.mutedWords).toHaveLength(100); expect(bounded.hiddenCasts).toHaveLength(500);
  });
  it('rejects corrupt versions, wrong list shapes and oversized UTF-8 JSON; handles unavailable storage', () => {
    const store = storage(); const key = contentPreferencesKey();
    for (const raw of ['invalid JSON', 'null', '[]', '{"version":2,"mutedAccounts":[],"mutedWords":[],"hiddenCasts":[]}', '{"version":1,"mutedAccounts":{},"mutedWords":[],"hiddenCasts":[]}']) {
      store.values.set(key, raw); expect(readContentPreferences(undefined, store)).toEqual(emptyContentPreferences());
    }
    store.values.set(key, JSON.stringify({ ...emptyContentPreferences(), unused: '😀'.repeat(70_000) }));
    expect(readContentPreferences(undefined, store)).toEqual(emptyContentPreferences());
    const unavailable = { getItem() { throw new Error('Disabled'); }, setItem() { throw new Error('Full'); } };
    expect(readContentPreferences(undefined, unavailable)).toEqual(emptyContentPreferences());
    expect(writeContentPreferences(emptyContentPreferences(), 3, unavailable)).toBe(false);
    vi.stubGlobal('localStorage', undefined);
    expect(readContentPreferences()).toEqual(emptyContentPreferences()); expect(writeContentPreferences(emptyContentPreferences())).toBe(false);
  });
  it('normalizes Unicode and enforces both character and UTF-8 word limits without regex execution', () => {
    expect(normalizeMutedWord(' cafe\u0301 ')).toBe('café');
    expect(normalizeMutedWord('😀'.repeat(64))).toHaveLength(128);
    expect(() => normalizeMutedWord('😀'.repeat(65))).toThrow('256 UTF-8');
    expect(() => normalizeMutedWord('a'.repeat(81))).toThrow('80 characters');
    const prefs = addMutedWord(emptyContentPreferences(), '.*');
    expect(getContentFilterReason(cast(), prefs)).toBeUndefined();
    expect(getContentFilterReason(cast({ text: 'Literal .* punctuation' }), prefs)).toContain('word or phrase');
    expect(getContentFilterReason(cast({ text: 'CAFE\u0301 noir' }), addMutedWord(emptyContentPreferences(), 'café'))).toContain('word or phrase');
    expect(() => addMutedWord(addMutedWord(emptyContentPreferences(), 'Café'), 'cafe\u0301')).toThrow('already muted');
  });
  it('keeps mutations pure, validates identities and refuses additions beyond each limit', () => {
    const original = emptyContentPreferences();
    const withWord = addMutedWord(original, 'Coffee'); expect(original.mutedWords).toEqual([]);
    expect(removeMutedWord(withWord, 'COFFEE')).toEqual(original);
    const withAccount = muteAccount(original, { fid: 3, username: 'alice' });
    expect(muteAccount(withAccount, { fid: 3 })).toEqual(withAccount); expect(unmuteAccount(withAccount, 3)).toEqual(original);
    expect(() => muteAccount(original, { fid: -1 })).toThrow('valid Farcaster ID');
    const hidden = hideCast(original, '0x' + 'A'.repeat(40)); expect(hidden.hiddenCasts).toEqual(['a'.repeat(40)]);
    expect(unhideCast(hidden, 'A'.repeat(40))).toEqual(original); expect(() => hideCast(original, 'bad')).toThrow('valid hash');
    expect(() => addMutedWord({ ...original, mutedWords: Array.from({ length: 100 }, (_, i) => `word${i}`) }, 'another')).toThrow('100 words');
    expect(() => muteAccount({ ...original, mutedAccounts: Array.from({ length: 100 }, (_, i) => ({ fid: i + 1 })) }, { fid: 101 })).toThrow('100 accounts');
    expect(() => hideCast({ ...original, hiddenCasts: Array.from({ length: 500 }, (_, i) => i.toString(16).padStart(40, '0')) }, 'f'.repeat(40))).toThrow('500 casts');
  });
  it('honors hidden and muted quoted cast IDs without guessing text or muting mentions', () => {
    const quote = cast({ embeds: [{ cast_id: { fid: 8, hash: '0x' + 'B'.repeat(40) } }] });
    expect(getContentFilterReason(cast(), hideCast(emptyContentPreferences(), 'a'.repeat(40)))).toContain('Hidden');
    expect(getContentFilterReason(cast(), muteAccount(emptyContentPreferences(), { fid: 3 }))).toContain('Muted account');
    expect(getContentFilterReason(quote, hideCast(emptyContentPreferences(), 'b'.repeat(40)))).toContain('Quotes a cast');
    expect(getContentFilterReason(quote, muteAccount(emptyContentPreferences(), { fid: 8 }))).toContain('Quotes an account');
    expect(getContentFilterReason(quote, addMutedWord(emptyContentPreferences(), 'unknown quoted text'))).toBeUndefined();
    expect(getContentFilterReason(cast({ text: 'A mention @bob', mentioned_profiles: [cast({ author: { ...cast().author, fid: 8 } }).author] }), muteAccount(emptyContentPreferences(), { fid: 8 }))).toBeUndefined();
  });
  it('reuses compiled preferences per object and still sees list replacements or in-place additions', () => {
    const prefs = emptyContentPreferences();
    expect(getContentFilterReason(cast(), prefs)).toBeUndefined();
    prefs.mutedWords.push('coffee');
    expect(getContentFilterReason(cast(), prefs)).toContain('word or phrase');
    prefs.hiddenCasts = ['a'.repeat(40)];
    expect(getContentFilterReason(cast(), prefs)).toContain('Hidden');
    prefs.hiddenCasts = []; prefs.mutedAccounts.push({ fid: 3 });
    expect(getContentFilterReason(cast(), prefs)).toContain('Muted account');
    expect(getContentFilterReason(cast({ author: { ...cast().author, fid: 4 }, text: 'tea' }), prefs)).toBeUndefined();
  });
});
