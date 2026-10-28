import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha256.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes, keyAddDigest, keyRemoveDigest, signedKeyRequestDigest } from '@opencaster/protocol/signedKeyRequest';
import { APP_ORIGINS } from './appOrigins';

export const PAIRING_SCOPES = [1, 3, 4] as const;
/** Requested only through an explicit "Enable social features" approval. */
export const FULL_SOCIAL_SCOPES = [1, 3, 4, 5, 6, 11] as const;
/** Cast removal is added only after a separate, explicit wallet approval. */
export const FULL_CLIENT_SCOPES = [1, 2, 3, 4, 5, 6, 11] as const;
export function validatePairingScopes(value: unknown): number[] {
  if (!Array.isArray(value) || ![PAIRING_SCOPES, FULL_SOCIAL_SCOPES, FULL_CLIENT_SCOPES].some(allowed => allowed.length === value.length && allowed.every((scope, index) => value[index] === scope))) {
    throw new Error('Arca only approves the displayed casting permissions or the explicit social and cast-deletion permissions.');
  }
  return [...value];
}
export const PAIRING_TTL_SECONDS = 7 * 24 * 60 * 60;
export const PAIRING_REQUEST_MAX_BYTES = 16_384;
export const PAIRING_WINDOW_SECONDS = 15 * 60;
export const FARCASTER_EPOCH_SECONDS = 1_609_459_200;
export const PAIRING_ORIGINS = APP_ORIGINS;

export interface PairingRequest {
  kind: 'arca.hypersnap.signer.request';
  version: 1;
  origin: string;
  requestId: string;
  createdAt: number;
  fid: number;
  custodyAddress: string;
  publicKey: string;
  scopes: number[];
  /** Sliding inactivity window, refreshed by protocol activity; not a fixed lifetime. */
  ttl: number;
  nonce: number;
  /** Farcaster epoch seconds. */
  deadline: number;
}

export interface PairingApproval {
  kind: 'arca.hypersnap.signer.approval';
  version: 1;
  requestId: string;
  requestHash: string;
  custodyAddress: string;
  custodySignature: string;
  requestSignature: string;
}

/** A separate transfer kind prevents a grant from being presented as removal. */
export interface RevocationRequest {
  kind: 'arca.hypersnap.signer.revoke.request';
  version: 1;
  origin: string;
  requestId: string;
  createdAt: number;
  fid: number;
  custodyAddress: string;
  publicKey: string;
  nonce: number;
  /** Farcaster epoch seconds; the request is usable for 15 minutes. */
  deadline: number;
}

export interface RevocationApproval {
  kind: 'arca.hypersnap.signer.revoke.approval';
  version: 1;
  requestId: string;
  requestHash: string;
  custodyAddress: string;
  custodySignature: string;
  /** Hypersnap KeyRemoveBody type 1 is custody EIP-712 authorization. */
  signatureType: 1;
}

export type SignerRequest = PairingRequest | RevocationRequest;
export type SignerApproval = PairingApproval | RevocationApproval;

const REQUEST_KEYS = ['kind', 'version', 'origin', 'requestId', 'createdAt', 'fid', 'custodyAddress', 'publicKey', 'scopes', 'ttl', 'nonce', 'deadline'];
const APPROVAL_KEYS = ['kind', 'version', 'requestId', 'requestHash', 'custodyAddress', 'custodySignature', 'requestSignature'];
const REVOCATION_REQUEST_KEYS = REQUEST_KEYS.filter(key => key !== 'scopes' && key !== 'ttl');
const REVOCATION_APPROVAL_KEYS = ['kind', 'version', 'requestId', 'requestHash', 'custodyAddress', 'custodySignature', 'signatureType'];
const HEX32 = /^[0-9a-f]{64}$/;
const HEX65 = /^[0-9a-f]{130}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function objectWithKeys(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) {
    throw new Error('Invalid authorization file. Use an unmodified Arca authorization request or approval.');
  }
}
function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function checkString(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}

/** Validate a public, narrowly scoped request. The origin is a display hint,
 * not proof of the requesting website: Hypersnap's EIP-712 schema has no origin. */
export function validatePairingRequest(value: unknown, nowMs = Date.now()): PairingRequest {
  objectWithKeys(value, REQUEST_KEYS);
  const now = Math.floor(nowMs / 1000);
  if (value.kind !== 'arca.hypersnap.signer.request' || value.version !== 1 || typeof value.origin !== 'string' || !PAIRING_ORIGINS.includes(value.origin as typeof PAIRING_ORIGINS[number])) throw new Error('This authorization is not for a supported Arca client.');
  if (!checkString(value.requestId, HEX32) || !checkString(value.publicKey, HEX32) || !checkString(value.custodyAddress, ADDRESS)) throw new Error('The authorization contains an invalid account, request ID, or posting key.');
  if (!integer(value.fid, 1) || !integer(value.nonce, 1, 0xffffffff) || !integer(value.createdAt, FARCASTER_EPOCH_SECONDS) || !integer(value.deadline, 1)) throw new Error('The authorization contains invalid account or timing fields.');
  if (value.createdAt > now + 60 || value.deadline !== value.createdAt - FARCASTER_EPOCH_SECONDS + PAIRING_WINDOW_SECONDS) throw new Error('The authorization has invalid timing. Check your device clock and create a new request.');
  if (value.deadline <= now - FARCASTER_EPOCH_SECONDS) throw new Error('This authorization request has expired. Create a new request in Opencaster.');
  const scopes = validatePairingScopes(value.scopes);
  if (value.ttl !== PAIRING_TTL_SECONDS) throw new Error('Arca Signer only approves a seven-day inactivity window.');
  return { kind: value.kind, version: 1, origin: value.origin, requestId: value.requestId, createdAt: value.createdAt, fid: value.fid, custodyAddress: value.custodyAddress.toLowerCase(), publicKey: value.publicKey, scopes, ttl: PAIRING_TTL_SECONDS, nonce: value.nonce, deadline: value.deadline };
}

export function validatePairingApproval(value: unknown): PairingApproval {
  objectWithKeys(value, APPROVAL_KEYS);
  if (value.kind !== 'arca.hypersnap.signer.approval' || value.version !== 1 || !checkString(value.requestId, HEX32) || !checkString(value.requestHash, HEX32) || !checkString(value.custodyAddress, ADDRESS) || !checkString(value.custodySignature, HEX65) || !checkString(value.requestSignature, HEX65)) throw new Error('Invalid signer approval. Import the approval file exported by Arca Signer.');
  return { kind: value.kind, version: 1, requestId: value.requestId, requestHash: value.requestHash, custodyAddress: value.custodyAddress.toLowerCase(), custodySignature: value.custodySignature, requestSignature: value.requestSignature };
}

/** Canonical order for a public transfer-file checksum. This checksum binds
 * the response to the browser's pending request; it is not a publisher signature. */
export function hashPairingRequest(request: PairingRequest): string {
  const ordered = {
    kind: request.kind, version: request.version, origin: request.origin,
    requestId: request.requestId, createdAt: request.createdAt, fid: request.fid,
    custodyAddress: request.custodyAddress.toLowerCase(), publicKey: request.publicKey,
    scopes: request.scopes, ttl: request.ttl, nonce: request.nonce, deadline: request.deadline,
  };
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(ordered))));
}

function recoverAddress(signatureHex: string, digest: Uint8Array): string {
  const bytes = hexToBytes(signatureHex);
  const recovery = bytes[64] - 27;
  if (recovery !== 0 && recovery !== 1) throw new Error('The approval has an invalid signature recovery ID.');
  const signature = secp256k1.Signature.fromBytes(bytes.subarray(0, 64), 'compact').addRecoveryBit(recovery);
  if (signature.hasHighS()) throw new Error('The approval has a non-canonical signature.');
  const publicKey = signature.recoverPublicKey(digest).toBytes(false);
  return `0x${bytesToHex(keccak_256(publicKey.subarray(1)).subarray(12))}`;
}

export function verifyPairingApproval(requestValue: PairingRequest, approvalValue: PairingApproval, nowMs = Date.now()): void {
  const request = validatePairingRequest(requestValue, nowMs);
  const approval = validatePairingApproval(approvalValue);
  if (approval.requestId !== request.requestId || approval.requestHash !== hashPairingRequest(request) || approval.custodyAddress !== request.custodyAddress) throw new Error('This approval belongs to a different request or wallet. Do not reuse it.');
  const key = hexToBytes(request.publicKey);
  const custodyDigest = keyAddDigest({ fid: request.fid, key, keyType: 1, scopes: request.scopes, ttl: request.ttl, nonce: request.nonce, deadline: request.deadline });
  const metadataDigest = signedKeyRequestDigest({ requestFid: request.fid, key, deadline: request.deadline });
  try {
    if (recoverAddress(approval.custodySignature, custodyDigest) !== request.custodyAddress || recoverAddress(approval.requestSignature, metadataDigest) !== request.custodyAddress) throw new Error('custody mismatch');
  } catch {
    throw new Error('The approval signatures do not authorize this wallet and posting key.');
  }
}

/** Revocation has no configurable permissions or lifetime, only the target key. */
export function validateRevocationRequest(value: unknown, nowMs = Date.now()): RevocationRequest {
  objectWithKeys(value, REVOCATION_REQUEST_KEYS);
  if (value.kind !== 'arca.hypersnap.signer.revoke.request') throw new Error('Invalid signer revocation request.');
  // Reuse the same identity, trusted display-origin, nonce and timing rules.
  const valid = validatePairingRequest({ ...value, kind: 'arca.hypersnap.signer.request', scopes: [...PAIRING_SCOPES], ttl: PAIRING_TTL_SECONDS }, nowMs);
  return {
    kind: 'arca.hypersnap.signer.revoke.request', version: 1,
    origin: valid.origin, requestId: valid.requestId, createdAt: valid.createdAt,
    fid: valid.fid, custodyAddress: valid.custodyAddress, publicKey: valid.publicKey,
    nonce: valid.nonce, deadline: valid.deadline,
  };
}

export function validateRevocationApproval(value: unknown): RevocationApproval {
  objectWithKeys(value, REVOCATION_APPROVAL_KEYS);
  if (value.kind !== 'arca.hypersnap.signer.revoke.approval' || value.version !== 1 || value.signatureType !== 1
      || !checkString(value.requestId, HEX32) || !checkString(value.requestHash, HEX32)
      || !checkString(value.custodyAddress, ADDRESS) || !checkString(value.custodySignature, HEX65)) {
    throw new Error('Invalid signer revocation approval. Import the file exported by Arca Signer.');
  }
  return {
    kind: value.kind, version: 1, requestId: value.requestId,
    requestHash: value.requestHash, custodyAddress: value.custodyAddress.toLowerCase(),
    custodySignature: value.custodySignature, signatureType: 1,
  };
}

export function hashRevocationRequest(request: RevocationRequest): string {
  const ordered = {
    kind: request.kind, version: request.version, origin: request.origin,
    requestId: request.requestId, createdAt: request.createdAt, fid: request.fid,
    custodyAddress: request.custodyAddress.toLowerCase(), publicKey: request.publicKey,
    nonce: request.nonce, deadline: request.deadline,
  };
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(ordered))));
}

export function verifyRevocationApproval(requestValue: RevocationRequest, approvalValue: RevocationApproval, nowMs = Date.now()): void {
  const request = validateRevocationRequest(requestValue, nowMs);
  const approval = validateRevocationApproval(approvalValue);
  if (approval.requestId !== request.requestId || approval.requestHash !== hashRevocationRequest(request) || approval.custodyAddress !== request.custodyAddress) throw new Error('This revocation belongs to a different request or wallet. Do not reuse it.');
  const digest = keyRemoveDigest({ fid: request.fid, key: hexToBytes(request.publicKey), nonce: request.nonce, deadline: request.deadline });
  try {
    if (recoverAddress(approval.custodySignature, digest) !== request.custodyAddress) throw new Error('custody mismatch');
  } catch {
    throw new Error('The revocation signature does not authorize removal of this wallet and posting key.');
  }
}

export function validateSignerRequest(value: unknown, nowMs = Date.now()): SignerRequest {
  if (value && typeof value === 'object' && 'kind' in value && value.kind === 'arca.hypersnap.signer.revoke.request') return validateRevocationRequest(value, nowMs);
  return validatePairingRequest(value, nowMs);
}

export function hashSignerRequest(request: SignerRequest): string {
  return request.kind === 'arca.hypersnap.signer.revoke.request' ? hashRevocationRequest(request) : hashPairingRequest(request);
}
