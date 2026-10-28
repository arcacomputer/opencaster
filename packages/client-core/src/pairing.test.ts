import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { bytesToHex, hexToBytes, addressFromCustodyPrivateKey, keyAddDigest, keyRemoveDigest, signedKeyRequestDigest, signEip712Digest } from '@opencaster/protocol/signedKeyRequest';
import { FULL_CLIENT_SCOPES, FULL_SOCIAL_SCOPES, hashPairingRequest, validatePairingRequest, validatePairingApproval, verifyPairingApproval, type PairingRequest, type PairingApproval, PAIRING_TTL_SECONDS, type RevocationRequest, type RevocationApproval, hashRevocationRequest, validateRevocationRequest, validateRevocationApproval, verifyRevocationApproval, validateSignerRequest, hashSignerRequest } from './pairing';

const now = Date.UTC(2026, 9, 19, 12);
const custody = hexToBytes('1111111111111111111111111111111111111111111111111111111111111111');
function request(): PairingRequest {
  return { kind: 'arca.hypersnap.signer.request', version: 1, origin: 'https://opencaster.org', requestId: bytesToHex(randomBytes(32)), createdAt: now / 1000, fid: 1234, custodyAddress: addressFromCustodyPrivateKey(custody), publicKey: bytesToHex(randomBytes(32)), scopes: [1, 3, 4], ttl: PAIRING_TTL_SECONDS, nonce: 9, deadline: now / 1000 - 1609459200 + 900 };
}
function approve(req: PairingRequest): PairingApproval {
  const key = hexToBytes(req.publicKey);
  return { kind: 'arca.hypersnap.signer.approval', version: 1, requestId: req.requestId, requestHash: hashPairingRequest(req), custodyAddress: req.custodyAddress, custodySignature: bytesToHex(signEip712Digest(keyAddDigest({ fid: req.fid, key, keyType: 1, scopes: req.scopes, ttl: req.ttl, nonce: req.nonce, deadline: req.deadline }), custody)), requestSignature: bytesToHex(signEip712Digest(signedKeyRequestDigest({ requestFid: req.fid, key, deadline: req.deadline }), custody)) };
}
describe('offline authorization transfer boundary', () => {
  it.each(['https://opencaster.org', 'https://quorum.arca.computer', 'https://hypersnap-quorum.lf-e32.workers.dev'])('retains narrow current and historic request display origins: %s', origin => {
    const req = { ...request(), origin };
    expect(validatePairingRequest(req, now).origin).toBe(origin);
    expect(() => verifyPairingApproval(req, approve(req), now)).not.toThrow();
    for (const untrusted of [`${origin}.evil.test`, `${origin}/`, `${origin}:443`]) expect(() => validatePairingRequest({ ...req, origin: untrusted }, now)).toThrow('supported Arca client');
  });
  it('binds cast deletion to a distinct explicit approval and rejects escalation of existing social signatures', () => {
    const req = { ...request(), scopes: [...FULL_CLIENT_SCOPES] };
    expect(validatePairingRequest(req, now).scopes).toEqual(FULL_CLIENT_SCOPES);
    const approval = approve(req);
    expect(() => verifyPairingApproval(req, approval, now)).not.toThrow();
    const oldRequest = { ...req, scopes: [...FULL_SOCIAL_SCOPES] };
    const oldApproval = approve(oldRequest);
    expect(() => verifyPairingApproval(req, { ...oldApproval, requestHash: hashPairingRequest(req) }, now)).toThrow('signatures');
    for (const scopes of [[1, 2, 3, 4], [...FULL_CLIENT_SCOPES, 16], [1, 3, 2, 4, 5, 6, 11], [1, 2, 2, 3, 4, 5, 6, 11]]) expect(() => validatePairingRequest({ ...req, scopes }, now)).toThrow();
  });
  it('binds an explicit social grant to its exact scope set and rejects privilege mutation', () => {
    const req = { ...request(), scopes: [...FULL_SOCIAL_SCOPES] };
    expect(validatePairingRequest(req, now).scopes).toEqual(FULL_SOCIAL_SCOPES);
    const approval = approve(req);
    expect(() => verifyPairingApproval(req, approval, now)).not.toThrow();
    expect(() => verifyPairingApproval({ ...req, scopes: [1, 3, 4] }, approval, now)).toThrow('different request');
    for (const scopes of [[1, 3, 4, 5], [1, 3, 4, 5, 6, 11, 16], [1, 3, 4, 5, 6, 17], [11, 6, 5, 4, 3, 1]]) expect(() => validatePairingRequest({ ...req, scopes }, now)).toThrow();
  });
  it('verifies both independent custody signatures and canonicalizes property order', () => {
    const req = request(); const approval = approve(req);
    expect(() => verifyPairingApproval(req, approval, now)).not.toThrow();
    expect(hashPairingRequest(Object.fromEntries(Object.entries(req).reverse()) as unknown as PairingRequest)).toBe(hashPairingRequest(req));
  });
  it('rejects changed privileges, arbitrary origins, stale requests, future requests, and unknown fields', () => {
    const req = request();
    for (const altered of [{ ...req, scopes: [1, 3, 4, 16] }, { ...req, ttl: 7776000 }, { ...req, origin: 'https://evil.example' }, { ...req, seed: 'must never exist' }, { ...req, nonce: 0 }, { ...req, publicKey: 'https://evil.example' }]) expect(() => validatePairingRequest(altered, now)).toThrow();
    expect(() => validatePairingRequest(req, now + 901000)).toThrow('expired');
    expect(() => validatePairingRequest(req, now - 61000)).toThrow('timing');
  });
  it('refuses approval replay across request IDs, keys, FIDs, and nonces', () => {
    const req = request(); const approval = approve(req);
    for (const altered of [{ ...req, requestId: bytesToHex(randomBytes(32)) }, { ...req, publicKey: bytesToHex(randomBytes(32)) }, { ...req, fid: 42 }, { ...req, nonce: 10 }]) expect(() => verifyPairingApproval(altered, approval, now)).toThrow();
  });
  it('does not trust a rewritten checksum or matching display address without valid signatures', () => {
    const req = request(); const approval = approve(req); const changed = { ...req, nonce: req.nonce + 1 };
    expect(() => verifyPairingApproval(changed, { ...approval, requestHash: hashPairingRequest(changed) }, now)).toThrow('signatures');
    expect(() => verifyPairingApproval(req, { ...approval, custodySignature: `${approval.custodySignature.slice(0, -2)}00` }, now)).toThrow();
  });
  it('rejects extra approval fields and non-signature content before use', () => {
    const approval = approve(request());
    expect(() => validatePairingApproval({ ...approval, mnemonic: 'must never exist' })).toThrow();
    expect(() => validatePairingApproval({ ...approval, requestSignature: 'not a signature' })).toThrow();
  });
});

function revocationRequest(): RevocationRequest {
  const { scopes: _scopes, ttl: _ttl, ...base } = request();
  return { ...base, kind: 'arca.hypersnap.signer.revoke.request' };
}
function revocationApproval(req: RevocationRequest): RevocationApproval {
  return {
    kind: 'arca.hypersnap.signer.revoke.approval', version: 1,
    requestId: req.requestId, requestHash: hashRevocationRequest(req),
    custodyAddress: req.custodyAddress, signatureType: 1,
    custodySignature: bytesToHex(signEip712Digest(keyRemoveDigest({ fid: req.fid, key: hexToBytes(req.publicKey), nonce: req.nonce, deadline: req.deadline }), custody)),
  };
}

describe('offline custody revocation transfer', () => {
  it('verifies a real KEY_REMOVE custody signature and dispatches its separate transfer kind', () => {
    const req = revocationRequest();
    const approval = revocationApproval(req);
    expect(() => verifyRevocationApproval(req, approval, now)).not.toThrow();
    expect(validateSignerRequest(req, now)).toEqual(validateRevocationRequest(req, now));
    expect(hashSignerRequest(req)).toBe(hashRevocationRequest(req));
    expect(hashRevocationRequest(Object.fromEntries(Object.entries(req).reverse()) as unknown as RevocationRequest)).toBe(hashRevocationRequest(req));
  });

  it('requires a narrowly shaped revocation request without grant permissions or arbitrary payloads', () => {
    const req = revocationRequest();
    for (const changed of [{ ...req, scopes: [1, 3, 4] }, { ...req, ttl: PAIRING_TTL_SECONDS }, { ...req, kind: 'arca.hypersnap.signer.request' }, { ...req, transaction: {} }, { ...req, nonce: 0 }, { ...req, origin: 'https://evil.example' }]) expect(() => validateRevocationRequest(changed, now)).toThrow();
    expect(() => validateRevocationRequest(req, now + 901_000)).toThrow('expired');
    expect(() => validateRevocationRequest(req, now - 61_000)).toThrow('timing');
    expect(() => validatePairingRequest(req, now)).toThrow();
  });

  it('rejects rewritten target, FID, nonce and deadline even when a checksum is rewritten', () => {
    const req = revocationRequest();
    const approval = revocationApproval(req);
    for (const changed of [{ ...req, fid: 42 }, { ...req, publicKey: bytesToHex(randomBytes(32)) }, { ...req, nonce: req.nonce + 1 }, { ...req, createdAt: req.createdAt + 1, deadline: req.deadline + 1 }]) {
      expect(() => verifyRevocationApproval(changed, { ...approval, requestHash: hashRevocationRequest(changed) }, now)).toThrow('signature');
    }
  });

  it('never accepts grant signatures, another signature type or additional secret fields', () => {
    const req = revocationRequest();
    const approval = revocationApproval(req);
    const grantRequest = { ...req, kind: 'arca.hypersnap.signer.request' as const, scopes: [1, 3, 4], ttl: PAIRING_TTL_SECONDS };
    const grantApproval = approve(grantRequest);
    expect(() => verifyRevocationApproval(req, { ...approval, custodySignature: grantApproval.custodySignature }, now)).toThrow('signature');
    expect(() => validateRevocationApproval({ ...approval, signatureType: 2 })).toThrow();
    expect(() => validateRevocationApproval({ ...approval, seed: 'must never exist' })).toThrow();
    expect(() => validateRevocationApproval(grantApproval)).toThrow();
    expect(() => validatePairingApproval(approval)).toThrow();
  });
});
