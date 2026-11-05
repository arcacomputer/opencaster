import type { getReactionStatus } from '@opencaster/client-core/api';

export type CastTarget = Parameters<typeof getReactionStatus>[1];
export type ReactionKind = 'like' | 'recast';
export const MAX_CAST_BYTES = 320;

interface Receipt {
  hash: string;
  timestamp: number;
  status: 'pending' | 'confirmed';
}
export type SocialAction = Receipt & (
  | { kind: 'cast'; parent?: CastTarget }
  | { kind: 'reaction'; target: CastTarget; reaction: ReactionKind; desired: boolean }
);

export function castTarget(value: CastTarget): CastTarget {
  if (!value || !Number.isSafeInteger(value.fid) || value.fid < 1 || value.fid > 0xffffffff
    || typeof value.hash !== 'string' || !/^(?:0x)?[0-9a-fA-F]{40}$/.test(value.hash)) {
    throw new Error('Choose a valid public cast first.');
  }
  return { fid: value.fid, hash: value.hash.replace(/^0x/, '').toLowerCase() };
}

export function castText(value: string): string {
  if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value.trim()).length > MAX_CAST_BYTES) {
    throw new Error(`Write between 1 and ${MAX_CAST_BYTES} UTF-8 bytes of text.`);
  }
  return value.trim();
}

export function validateSocialAction(value: SocialAction): SocialAction {
  if (!value || typeof value.hash !== 'string' || !/^[0-9a-f]{40}$/.test(value.hash) || !Number.isSafeInteger(value.timestamp)
    || value.timestamp < 0 || value.timestamp > 0xffffffff || !['pending', 'confirmed'].includes(value.status)) throw new Error();
  const keys = Object.keys(value).sort().join(',');
  const receipt: Receipt = { hash: value.hash, timestamp: value.timestamp, status: value.status };
  if (value.kind === 'cast' && ['hash,kind,status,timestamp', 'hash,kind,parent,status,timestamp'].includes(keys)) {
    return { ...receipt, kind: 'cast', ...(value.parent !== undefined ? { parent: castTarget(value.parent) } : {}) };
  }
  if (value.kind === 'reaction' && keys === 'desired,hash,kind,reaction,status,target,timestamp'
    && ['like', 'recast'].includes(value.reaction) && typeof value.desired === 'boolean') {
    return { ...receipt, kind: 'reaction', target: castTarget(value.target), reaction: value.reaction, desired: value.desired };
  }
  throw new Error();
}
