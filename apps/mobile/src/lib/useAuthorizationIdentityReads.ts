import { getUser } from '@opencaster/client-core/api';
import { useCallback } from 'react';
import {
  parseAuthorizationIdentityQuery,
  validateAuthorizationIdentity,
  validateSavedAuthorizationIdentity,
} from './authorizationIdentity';
import { usePublicRead } from './usePublicRead';

export function useAuthorizationIdentityReads(submittedLookup: string | null, savedFid: number | undefined) {
  const readLookup = useCallback((signal: AbortSignal) => {
    if (!submittedLookup) return Promise.reject(new Error('Enter a username or positive FID.'));
    const query = parseAuthorizationIdentityQuery(submittedLookup);
    if (!query) return Promise.reject(new Error('Enter a username or positive FID.'));
    return getUser(query.lookup, signal).then(user => validateAuthorizationIdentity(query, user));
  }, [submittedLookup]);
  const lookup = usePublicRead(
    `device-access:${submittedLookup ?? ''}`,
    submittedLookup ? readLookup : null,
  );

  const readSavedIdentity = useCallback((signal: AbortSignal) => {
    if (savedFid === undefined) return Promise.reject(new Error('Unlock the saved device first.'));
    return getUser({ fid: savedFid }, signal).then(user => validateSavedAuthorizationIdentity(savedFid, user));
  }, [savedFid]);
  const savedIdentity = usePublicRead(
    `device-access-record:${savedFid ?? ''}`,
    savedFid === undefined ? null : readSavedIdentity,
  );

  return { lookup, savedIdentity };
}
