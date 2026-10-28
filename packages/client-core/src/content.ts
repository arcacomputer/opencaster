import type { Cast, User } from './api';

// Platform independent protocol text helpers; migration candidates for a future
// shared Hypersnap client package. They never resolve identities over a network.
export type MentionSegment = { kind: 'text'; text: string } | { kind: 'mention'; user: User };
export interface ComposedCastContent { text: string; mentions: number[]; mentionsPositions: number[] }
const MAX_MENTIONS = 10;
const USERNAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const encoder = new TextEncoder();

function validMentionUser(user: User): boolean {
  return !!user && Number.isSafeInteger(user.fid) && user.fid > 0 && user.fid <= 0xffffffff
    && typeof user.username === 'string' && (user.username === '' || user.username === `fid:${user.fid}` || USERNAME.test(user.username));
}

/** Hypersnap returns raw protocol text with zero-width UTF-8 insertion ranges.
 * Validate the entire mention set before inserting anything. Invalid metadata
 * falls back to the complete raw text instead of losing or rewriting content. */
export function renderMentionSegments(cast: Pick<Cast, 'text' | 'mentioned_profiles' | 'mentioned_profiles_ranges'>): MentionSegment[] {
  const plain: MentionSegment[] = [{ kind: 'text', text: cast.text }];
  const profiles = cast.mentioned_profiles;
  const ranges = cast.mentioned_profiles_ranges;
  if (!Array.isArray(profiles) || !profiles.length || !Array.isArray(ranges)
    || profiles.length !== ranges.length || profiles.length > MAX_MENTIONS || !profiles.every(validMentionUser)) return plain;

  const indicesByByte = new Map<number, number>([[0, 0]]);
  let byte = 0;
  let index = 0;
  for (const character of cast.text) {
    byte += encoder.encode(character).length;
    index += character.length;
    indicesByByte.set(byte, index);
  }

  let previous = 0;
  for (const range of ranges) {
    if (!range || !Number.isSafeInteger(range.start) || range.start !== range.end
      || range.start < previous || !indicesByByte.has(range.start)) return plain;
    previous = range.start;
  }

  const result: MentionSegment[] = [];
  let consumed = 0;
  for (let item = 0; item < profiles.length; item += 1) {
    const insertion = indicesByByte.get(ranges[item].start)!;
    if (insertion > consumed) result.push({ kind: 'text', text: cast.text.slice(consumed, insertion) });
    result.push({ kind: 'mention', user: profiles[item] });
    consumed = insertion;
  }
  if (consumed < cast.text.length) result.push({ kind: 'text', text: cast.text.slice(consumed) });
  return result;
}

function startsToken(text: string, at: number): boolean {
  // Preserve email addresses, URL paths, double-@ tokens and larger words.
  return !/[\p{L}\p{N}\p{M}_.@/\\%+=&#-]$/u.test(text.slice(0, at));
}

function endsToken(text: string, at: number): boolean {
  const after = text.slice(at);
  // Dots may terminate a sentence, but .eth or any longer dotted username must
  // not turn into a shorter selected account. Match the longest selected name.
  return !/^[\p{L}\p{N}\p{M}_@-]/u.test(after)
    && !/^\.+[\p{L}\p{N}\p{M}_@-]/u.test(after);
}

/** Strip only explicit selected identities' unchanged @username tokens.
 * Offsets count UTF-8 bytes in the stripped protocol text, including repeated
 * mentions at one insertion point. Unselected or edited labels remain literal. */
export function composeCastContent(text: string, mentionedUsers: User[]): ComposedCastContent {
  if (typeof text !== 'string' || !Array.isArray(mentionedUsers) || mentionedUsers.length > MAX_MENTIONS) throw new Error('Select up to 10 profiles to mention.');
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (character.length === 1 && code >= 0xd800 && code <= 0xdfff) throw new Error('The cast contains an incomplete Unicode character.');
  }
  const usersByName = new Map<string, User>();
  const namesByFid = new Map<number, string>();
  for (const user of mentionedUsers) {
    if (!validMentionUser(user)) throw new Error('A selected mention has an invalid profile. Select that profile again.');
    const name = (user.username || String(user.fid)).toLowerCase();
    const existing = usersByName.get(name);
    if ((existing && existing.fid !== user.fid) || (namesByFid.has(user.fid) && namesByFid.get(user.fid) !== name)) throw new Error('Mention identities changed. Select the profiles again.');
    usersByName.set(name, user); namesByFid.set(user.fid, name);
  }
  const candidates = [...usersByName.entries()].sort((left, right) => right[0].length - left[0].length);
  const blocked = [...text.matchAll(/(?:https?:\/\/|www\.|mailto:)[^\s<>"']+/gi)].map(match => ({ start: match.index!, end: match.index! + match[0].length }));
  const mentions: number[] = [];
  const mentionsPositions: number[] = [];
  let stripped = '';
  let consumed = 0;
  let bytes = 0;
  for (const match of text.matchAll(/@/g)) {
    const at = match.index!;
    if (at < consumed || !startsToken(text, at) || blocked.some(range => at >= range.start && at < range.end)) continue;
    const selected = candidates.find(([name]) => text.slice(at + 1, at + 1 + name.length).toLowerCase() === name && endsToken(text, at + 1 + name.length));
    if (!selected) continue;
    if (mentions.length === MAX_MENTIONS) throw new Error('A cast can contain up to 10 mentions.');
    const [name, user] = selected;
    const preceding = text.slice(consumed, at);
    stripped += preceding;
    bytes += encoder.encode(preceding).length;
    mentions.push(user.fid); mentionsPositions.push(bytes);
    consumed = at + name.length + 1;
  }
  stripped += text.slice(consumed);
  return { text: stripped, mentions, mentionsPositions };
}
