import { describe, expect, it } from 'vitest';
import type { User } from '@opencaster/client-core/api';
import {
  parseAuthorizationIdentityQuery,
  validateAuthorizationIdentity,
  validateSavedAuthorizationIdentity,
} from './authorizationIdentity';

const user = (fid: number, username: string) => ({ fid, username } as User);

describe('authorization identity review', () => {
  it('accepts the exact numeric FID and rejects a mismatched response', () => {
    const query = parseAuthorizationIdentityQuery('1234')!;
    expect(validateAuthorizationIdentity(query, user(1234, 'alice')).fid).toBe(1234);
    expect(() => validateAuthorizationIdentity(query, user(4321, 'alice'))).toThrow(/different FID/);
    expect(() => validateSavedAuthorizationIdentity(1234, user(4321, 'alice'))).toThrow(/different FID/);
  });

  it('matches ordinary usernames case-insensitively', () => {
    const query = parseAuthorizationIdentityQuery('@Alice')!;
    expect(validateAuthorizationIdentity(query, user(1234, 'ALICE')).fid).toBe(1234);
    expect(() => validateAuthorizationIdentity(query, user(1234, 'bob'))).toThrow(/different username/);
  });

  it('uses the existing ENS proof route without comparing the hydrated canonical username', () => {
    const query = parseAuthorizationIdentityQuery('Alice.ETH')!;
    expect(query).toMatchObject({ kind: 'username', ens: true, lookup: { username: 'Alice.ETH' } });
    expect(validateAuthorizationIdentity(query, user(1234, 'canonical-name')).fid).toBe(1234);
  });

  it('bounds numeric FIDs to the protocol uint32 range', () => {
    expect(parseAuthorizationIdentityQuery('4294967295')).toMatchObject({ kind: 'fid', fid: 0xffffffff });
    expect(parseAuthorizationIdentityQuery('4294967296')).toBeNull();
    expect(parseAuthorizationIdentityQuery('0')).toBeNull();
  });
});
