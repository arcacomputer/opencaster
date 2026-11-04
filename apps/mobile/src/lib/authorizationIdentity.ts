import type { User } from '@opencaster/client-core/api';

const MAX_FID = 0xffffffff;

export type AuthorizationIdentityQuery =
  | { kind: 'fid'; fid: number; lookup: { fid: number } }
  | { kind: 'username'; username: string; ens: boolean; lookup: { username: string } };

export function parseAuthorizationIdentityQuery(value: string): AuthorizationIdentityQuery | null {
  const normalized = value.trim().replace(/^@/, '');
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) {
    const fid = Number(normalized);
    return Number.isSafeInteger(fid) && fid > 0 && fid <= MAX_FID
      ? { kind: 'fid', fid, lookup: { fid } }
      : null;
  }
  return { kind: 'username', username: normalized, ens: /\.eth$/i.test(normalized), lookup: { username: normalized } };
}

export function validateAuthorizationIdentity(query: AuthorizationIdentityQuery, user: User): User {
  if (!Number.isSafeInteger(user.fid) || user.fid < 1 || user.fid > MAX_FID) {
    throw new Error('The node returned an invalid identity.');
  }
  if (query.kind === 'fid' && user.fid !== query.fid) {
    throw new Error('The node returned a different FID.');
  }
  if (query.kind === 'username' && !query.ens && user.username.toLowerCase() !== query.username.toLowerCase()) {
    throw new Error('The node returned a different username.');
  }
  return user;
}

export function validateSavedAuthorizationIdentity(expectedFid: number, user: User): User {
  return validateAuthorizationIdentity({ kind: 'fid', fid: expectedFid, lookup: { fid: expectedFid } }, user);
}
