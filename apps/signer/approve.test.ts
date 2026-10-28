import { describe, expect, it } from 'vitest';
import { HDKey } from '@scure/bip32';
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { ed25519 } from '@noble/curves/ed25519.js';
import { approvePairingRequest, approveRevocationRequest, approveSignerRequest, CUSTODY_DERIVATION_PATH } from './approve';
import { isAllowedResource, validateApproveInput } from './policy';
import { FARCASTER_EPOCH_SECONDS, PAIRING_TTL_SECONDS, verifyPairingApproval, verifyRevocationApproval, type PairingRequest, type RevocationRequest } from '@opencaster/client-core/pairing';
import { addressFromCustodyPrivateKey, bytesToHex } from '@opencaster/protocol/signedKeyRequest';

// Public, all-zero synthetic entropy. Never a funded wallet or live account.
const phrase = entropyToMnemonic(new Uint8Array(32), wordlist);
const now = Date.UTC(2026, 9, 19, 12);

function requestFixture(): PairingRequest {
  const seed = mnemonicToSeedSync(phrase);
  const root = HDKey.fromMasterSeed(seed);
  const account = root.derive(CUSTODY_DERIVATION_PATH);
  try {
    return {
      kind: 'arca.hypersnap.signer.request', version: 1,
      origin: 'https://opencaster.org', requestId: '12'.repeat(32),
      createdAt: Math.floor(now / 1000), fid: 123,
      custodyAddress: addressFromCustodyPrivateKey(account.privateKey!),
      publicKey: bytesToHex(ed25519.getPublicKey(new Uint8Array(32).fill(2))),
      scopes: [1, 3, 4], ttl: PAIRING_TTL_SECONDS, nonce: 1,
      deadline: Math.floor(now / 1000) - FARCASTER_EPOCH_SECONDS + 900,
    };
  } finally { seed.fill(0); root.wipePrivateData(); account.wipePrivateData(); }
}

describe('offline signer approval', () => {
  it('produces verifiable custody and request signatures for only the selected public key', () => {
    const request = requestFixture();
    const approval = approvePairingRequest(request, phrase, now);
    expect(() => verifyPairingApproval(request, approval, now)).not.toThrow();
    expect(approval.requestId).toBe(request.requestId);
    expect(Object.keys(approval).sort()).toEqual(['kind', 'version', 'requestId', 'requestHash', 'custodyAddress', 'custodySignature', 'requestSignature'].sort());
    expect(JSON.stringify(approval).includes(phrase)).toBe(false);
    expect(() => verifyPairingApproval({ ...request, publicKey: 'ff'.repeat(32) }, approval, now)).toThrow();
    expect(() => verifyPairingApproval({ ...request, fid: 124 }, approval, now)).toThrow();
  });

  it('rejects the wrong custody wallet before producing an approval', () => {
    expect(() => approvePairingRequest({ ...requestFixture(), custodyAddress: `0x${'00'.repeat(20)}` }, phrase, now)).toThrow('does not match');
  });

  it('requires exactly 24 English words with a valid BIP39 checksum', () => {
    const request = requestFixture();
    const twelveWords = entropyToMnemonic(new Uint8Array(16), wordlist);
    expect(() => approvePairingRequest(request, twelveWords, now)).toThrow('24-word');
    expect(() => approvePairingRequest(request, Array(24).fill('abandon').join(' '), now)).toThrow('24-word');
    expect(() => approvePairingRequest(request, 'x'.repeat(513), now)).toThrow('24-word');
    const normalizedApproval = approvePairingRequest(request, `  ${phrase.toUpperCase().split(' ').join('  ')}  `, now);
    expect(() => verifyPairingApproval(request, normalizedApproval, now)).not.toThrow();
  });

  it('refuses expired requests and broader permissions', () => {
    const request = requestFixture();
    expect(() => approvePairingRequest(request, phrase, now + 901_000)).toThrow('expired');
    expect(() => approvePairingRequest({ ...request, scopes: [1, 3, 4, 5] }, phrase, now)).toThrow('only approves');
    expect(() => approvePairingRequest({ ...request, scopes: [1, 3, 4, 5, 6, 11] }, phrase, now)).toThrow('Use your wallet');
    expect(() => approvePairingRequest({ ...request, scopes: [1, 2, 3, 4, 5, 6, 11] }, 'not a recovery phrase', now)).toThrow('Use your wallet');
    expect(() => approvePairingRequest({ ...request, ttl: 90 * 86400 }, phrase, now)).toThrow('only approves');
    expect(() => approvePairingRequest({ ...request, payload: 'arbitrary typed data' }, phrase, now)).toThrow('Invalid authorization file');
  });

  it('signs only custody KEY_REMOVE for a separately identified revocation request', () => {
    const { scopes: _scopes, ttl: _ttl, ...base } = requestFixture();
    const request: RevocationRequest = { ...base, kind: 'arca.hypersnap.signer.revoke.request' };
    const approval = approveRevocationRequest(request, phrase, now);
    expect(approval.kind).toBe('arca.hypersnap.signer.revoke.approval');
    expect(approval.signatureType).toBe(1);
    expect(Object.hasOwn(approval, 'requestSignature')).toBe(false);
    expect(() => verifyRevocationApproval(request, approval, now)).not.toThrow();
    expect(approveSignerRequest(request, phrase, now)).toEqual(approval);
    expect(() => approvePairingRequest(request, phrase, now)).toThrow();
    expect(() => approveRevocationRequest(requestFixture(), phrase, now)).toThrow();
  });

  it('refuses revocation of a mismatched wallet or an expired request', () => {
    const { scopes: _scopes, ttl: _ttl, ...base } = requestFixture();
    const request: RevocationRequest = { ...base, kind: 'arca.hypersnap.signer.revoke.request' };
    expect(() => approveRevocationRequest({ ...request, custodyAddress: `0x${'00'.repeat(20)}` }, phrase, now)).toThrow('does not match');
    expect(() => approveRevocationRequest(request, phrase, now + 901_000)).toThrow('expired');
  });
});

describe('native signing boundary', () => {
  it('accepts only the narrow approval IPC shape and bounded phrase input', () => {
    const input = { phrase, requestId: '12'.repeat(32) };
    expect(validateApproveInput(input).requestId).toBe(input.requestId);
    for (const invalid of [null, [], { ...input, path: '/etc/passwd' }, { ...input, phrase: 'x'.repeat(513) }, { ...input, requestId: 'invalid' }]) {
      expect(() => validateApproveInput(invalid)).toThrow('Invalid approval input');
    }
  });

  it('blocks network and arbitrary local files while allowing exact bundled assets', () => {
    const allowed = new Set(['arca-signer://app/index.html', 'arca-signer://app/renderer.js']);
    for (const url of allowed) expect(isAllowedResource(url, allowed)).toBe(true);
    for (const url of ['https://quorum.arca.computer', 'http://127.0.0.1', 'wss://example.org', 'file:///etc/passwd', 'arca-signer://app/index.html?remote=1', 'arca-signer://untrusted/index.html', 'arca-signer://app/../etc/passwd', 'data:text/html,hello']) {
      expect(isAllowedResource(url, allowed)).toBe(false);
    }
  });
});
