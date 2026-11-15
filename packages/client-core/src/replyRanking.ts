import { CAST_HASH } from './apiRules';

/** Presentation hints only. These never authorize a moderation or protocol write. */
export interface ReplyRanking {
  status: 'pending' | 'ready' | 'off';
  suspected: string[];
}

export const canonicalReplyHash = (hash: string): string => `0x${hash.replace(/^0x/, '').toLowerCase()}`;

export async function getReplyRanking(hash: string, signal?: AbortSignal): Promise<ReplyRanking> {
  if (!CAST_HASH.test(hash)) throw new Error('Invalid conversation hash.');
  const response = await fetch(`/api/reply-ranking?identifier=${canonicalReplyHash(hash)}`, {
    signal, credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Reply ranking unavailable.');
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object') throw new Error('Invalid reply ranking.');
  const { status, suspected } = value as ReplyRanking;
  if (!['pending', 'ready', 'off'].includes(status) || !Array.isArray(suspected) || suspected.length > 150
    || suspected.some(hash => typeof hash !== 'string' || !CAST_HASH.test(hash))) throw new Error('Invalid reply ranking.');
  return { status, suspected: [...new Set(suspected.map(canonicalReplyHash))] };
}

/** Stable partition: unscored/normal/ambiguous entries retain node order. */
export function rankReplySiblings<T extends { cast: { hash: string } }>(nodes: readonly T[], suspected: ReadonlySet<string>): T[] {
  return [...nodes.filter(node => !suspected.has(canonicalReplyHash(node.cast.hash))),
    ...nodes.filter(node => suspected.has(canonicalReplyHash(node.cast.hash)))];
}
