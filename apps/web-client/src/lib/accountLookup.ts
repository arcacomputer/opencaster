import type { User } from '@opencaster/client-core/api';
import { normalizeHypersnapEnsName } from '@opencaster/client-core/ensName';

// Platform-independent migration candidate for a future shared Hypersnap client.
/** Public lookup only: these identifiers never authenticate an account. */
export type AccountLookup = { fid: number; username?: never; custodyAddress?: never; ensName?: never }
  | { fid?: never; username: string; custodyAddress?: never; ensName?: never }
  | { fid?: never; username?: never; custodyAddress: string; ensName?: never }
  | { fid?: never; username?: never; custodyAddress?: never; ensName: string };

export interface ReviewIdentity {
  fid: number;
  /** Empty when the node has no profile username; `fid:N` is a node fallback. */
  username: string;
  displayName?: string;
  custodyAddress: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const USERNAME = /^[a-z0-9_.-]{1,128}$/i;

function validFid(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 0xffffffff;
}

export function parseAccountLookup(input: string, initialFid?: number): AccountLookup {
  if (initialFid !== undefined) {
    if (!validFid(initialFid)) throw new Error('Enter a valid Farcaster ID from 1 to 4294967295.');
    return { fid: initialFid };
  }
  const term = input.trim();
  if (!term) throw new Error('Enter a username, ENS name, FID, or custody wallet address.');
  // Name proofs must be classified before 0x-prefixed wallet addresses. Other
  // dotted inputs get the native name limits rather than an ambiguous lookup.
  if (term.includes('.')) return { ensName: normalizeHypersnapEnsName(term).name };
  if (/^(?:0x)?(?:[a-f0-9]{64}|[a-f0-9]{128})$/i.test(term.replace(/^@/, ''))) throw new Error('Do not enter a private key. Use your public username, FID, or custody wallet address.');
  if (/^0x/i.test(term)) {
    if (!ADDRESS.test(term)) throw new Error('Enter the complete custody wallet address: 0x followed by 40 hexadecimal characters.');
    return { custodyAddress: term.toLowerCase() };
  }
  if (/^\d+$/.test(term)) {
    const fid = Number(term);
    if (!validFid(fid)) throw new Error('Enter a valid Farcaster ID from 1 to 4294967295.');
    return { fid };
  }
  const username = term.replace(/^@/, '');
  if (!USERNAME.test(username)) throw new Error('Enter a valid Farcaster username. Do not enter recovery words or a private key.');
  return { username: username.toLowerCase() };
}

/** Whitelist the fields shown before the user elects to create a device key.
 * The address endpoint also searches verified addresses upstream: a response
 * is usable for sign-in only when its actual custody address matches exactly.
 * Name proofs and displayed UserData usernames are independent upstream, so a
 * username alias may resolve to a different canonical profile name. The review
 * must show that returned identity, and preparation must use its stable FID.
 */
export function normalizeReviewIdentity(user: User, lookup?: AccountLookup): ReviewIdentity {
  if (!user || typeof user !== 'object' || !validFid(user.fid)) throw new Error('The node returned an invalid account identity.');
  if (typeof user.custody_address !== 'string' || !ADDRESS.test(user.custody_address)) throw new Error('This account has no usable custody wallet on Hypersnap.');
  const custodyAddress = user.custody_address.toLowerCase();
  if ((lookup?.fid !== undefined && user.fid !== lookup.fid)
    || (lookup?.custodyAddress !== undefined && custodyAddress !== lookup.custodyAddress.toLowerCase())) {
    throw new Error('The node returned a different identity. Use the account’s exact FID or custody wallet address.');
  }
  let username = '';
  const rawUsername: unknown = user.username;
  if (rawUsername !== undefined && rawUsername !== null && rawUsername !== '') {
    if (typeof rawUsername !== 'string') throw new Error('The node returned an invalid account username.');
    // Do not turn the node's synthetic label into a claimed @username.
    if (!/^fid:\d+$/.test(rawUsername)) {
      if (!USERNAME.test(rawUsername)) throw new Error('The node returned an invalid account username.');
      username = rawUsername.toLowerCase();
    }
  }
  const displayName = typeof user.display_name === 'string' ? [...user.display_name.trim().normalize('NFC')].slice(0, 128).join('') : '';
  return { fid: user.fid, username, ...(displayName ? { displayName } : {}), custodyAddress };
}

/** A fresh public account read must not silently change reviewed authority. */
export function sameReviewIdentity(left: ReviewIdentity, right: ReviewIdentity): boolean {
  return left.fid === right.fid && left.custodyAddress === right.custodyAddress && left.username === right.username;
}
