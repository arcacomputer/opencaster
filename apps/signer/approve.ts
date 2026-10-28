/** Pure offline signing. Candidate for a shared library across native clients. */
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import {
  hashPairingRequest,
  hashRevocationRequest,
  validatePairingRequest,
  validateRevocationRequest,
  validateSignerRequest,
  type PairingApproval,
  type RevocationApproval,
  type SignerApproval,
} from '@opencaster/client-core/pairing';
import {
  addressFromCustodyPrivateKey,
  bytesToHex,
  hexToBytes,
  keyAddDigest,
  keyRemoveDigest,
  signEip712Digest,
  signedKeyRequestDigest,
} from '@opencaster/protocol/signedKeyRequest';

export const CUSTODY_DERIVATION_PATH = "m/44'/60'/0'/0/0";
export const PHRASE_MAX_LENGTH = 512;

/**
 * The only seed-handling operation. No network, storage, logging, or wallet
 * transaction API is reachable here. Mutable seed and HD key buffers are wiped
 * in finally. JavaScript strings and library temporaries cannot be reliably
 * erased; closing the app after approval remains recommended.
 */
export function approveSignerRequest(request: unknown, phrase: string, nowMs = Date.now()): SignerApproval {
  let seed: Uint8Array | undefined;
  let root: HDKey | undefined;
  let account: HDKey | undefined;
  let custody: Uint8Array | undefined;
  // eslint-disable-next-line no-useless-assignment -- Initialize sensitive local state empty before validation.
  let normalized = '';
  try {
    const valid = validateSignerRequest(request, nowMs);
    // The signed v0.2.0 desktop beta reviews only its original permissions.
    // Expanded browser approvals must use the user's wallet, never this UI.
    if (valid.kind === 'arca.hypersnap.signer.request' && valid.scopes.join(',') !== '1,3,4') throw new Error('This offline signer only approves casts and reactions. Use your wallet for social permissions.');
    if (typeof phrase !== 'string' || phrase.length > PHRASE_MAX_LENGTH) throw new Error('Enter a valid 24-word English recovery phrase.');
    normalized = phrase.normalize('NFKD').trim().toLowerCase().split(/\s+/u).join(' ');
    phrase = '';
    if (normalized.split(' ').length !== 24 || !validateMnemonic(normalized, wordlist)) {
      throw new Error('Enter a valid 24-word English recovery phrase. Check its spelling and word order.');
    }
    seed = mnemonicToSeedSync(normalized);
    normalized = '';
    root = HDKey.fromMasterSeed(seed);
    account = root.derive(CUSTODY_DERIVATION_PATH);
    if (!account.privateKey) throw new Error('Could not derive the custody wallet.');
    custody = new Uint8Array(account.privateKey);
    const address = addressFromCustodyPrivateKey(custody);
    if (address.toLowerCase() !== valid.custodyAddress.toLowerCase()) {
      throw new Error('This recovery phrase does not match the custody address in the request. No approval was created.');
    }
    const key = hexToBytes(valid.publicKey);
    if (valid.kind === 'arca.hypersnap.signer.revoke.request') {
      return {
        kind: 'arca.hypersnap.signer.revoke.approval', version: 1,
        requestId: valid.requestId, requestHash: hashRevocationRequest(valid),
        custodyAddress: address, signatureType: 1,
        custodySignature: bytesToHex(signEip712Digest(keyRemoveDigest({
          fid: valid.fid, key, nonce: valid.nonce, deadline: valid.deadline,
        }), custody)),
      };
    }
    const custodySignature = signEip712Digest(keyAddDigest({
      fid: valid.fid,
      key,
      keyType: 1,
      scopes: [...valid.scopes],
      ttl: valid.ttl,
      nonce: valid.nonce,
      deadline: valid.deadline,
    }), custody);
    const requestSignature = signEip712Digest(signedKeyRequestDigest({
      requestFid: valid.fid, key, deadline: valid.deadline,
    }), custody);
    return {
      kind: 'arca.hypersnap.signer.approval',
      version: 1,
      requestId: valid.requestId,
      requestHash: hashPairingRequest(valid),
      custodyAddress: address,
      custodySignature: bytesToHex(custodySignature),
      requestSignature: bytesToHex(requestSignature),
    };
  } finally {
    // eslint-disable-next-line no-useless-assignment -- Best-effort local reference release; JavaScript strings cannot be reliably erased.
    phrase = '';
    // eslint-disable-next-line no-useless-assignment -- Best-effort local reference release; JavaScript strings cannot be reliably erased.
    normalized = '';
    custody?.fill(0);
    seed?.fill(0);
    root?.wipePrivateData();
    account?.wipePrivateData();
  }
}

/** Preserve the grant-only API for callers that must not accept revocation. */
export function approvePairingRequest(request: unknown, phrase: string, nowMs = Date.now()): PairingApproval {
  return approveSignerRequest(validatePairingRequest(request, nowMs), phrase, nowMs) as PairingApproval;
}

export function approveRevocationRequest(request: unknown, phrase: string, nowMs = Date.now()): RevocationApproval {
  return approveSignerRequest(validateRevocationRequest(request, nowMs), phrase, nowMs) as RevocationApproval;
}
