import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { recoverTypedDataAddress, type Hex } from 'viem';
import golden from './keyadd-golden.json';
import { buildSignedMessage, FarcasterNetwork, MessageType, SignatureScheme } from './messageBuilder';
import { buildSignedKeyRequestMetadata, bytesToHex, hexToBytes, keyAddDigest, signEip712Digest } from './signedKeyRequest';

// Published test-only vector, independently accepted by Hypersnap's Rust
// validators: src/core/validations/key_quorum_shared_compat_test.rs.
describe('Hypersnap wire compatibility', () => {
  it('matches the node-approved KEY_ADD protobuf, ABI metadata, and signatures byte for byte', async () => {
    const custody = hexToBytes(golden.CUSTODY_PRIV);
    const secret = new Uint8Array(32).fill(0x11);
    const key = ed25519.getPublicKey(secret);
    const scopes = [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15];
    const payload = { fid: 1234, key, keyType: 1, scopes, ttl: 86400, nonce: 1700000000, deadline: 1893456000 };
    const digest = keyAddDigest(payload);
    expect(bytesToHex(digest)).toBe(golden.KEY_ADD_DIGEST_HEX);
    const custodySignature = signEip712Digest(digest, custody);
    const { metadata } = buildSignedKeyRequestMetadata({ requestFid: 1234, signerPublicKey: key, deadline: payload.deadline, custodyPrivateKey: custody });
    const { envelope } = await buildSignedMessage({
      type: MessageType.KEY_ADD, fid: 1234, timestamp: 100000000, network: FarcasterNetwork.MAINNET,
      body: { keyAddBody: { key, custodySignature, deadline: payload.deadline, nonce: payload.nonce, metadata, scopes, ttl: payload.ttl } },
    }, { scheme: SignatureScheme.ED25519, publicKey: key, sign: async (hash) => ed25519.sign(hash, secret) });
    expect(bytesToHex(envelope)).toBe(golden.ENVELOPE_HEX);
    expect(bytesToHex(key)).toBe(golden.SIGNER_PUB_HEX);
    const recovered = await recoverTypedDataAddress({
      domain: { name: 'Farcaster KeyAdd', version: '1', chainId: 1 },
      types: { KeyAdd: [
        { name: 'fid', type: 'uint256' }, { name: 'key', type: 'bytes' },
        { name: 'keyType', type: 'uint32' }, { name: 'scopes', type: 'uint32[]' },
        { name: 'ttl', type: 'uint32' }, { name: 'nonce', type: 'uint32' }, { name: 'deadline', type: 'uint256' },
      ] },
      primaryType: 'KeyAdd',
      message: { ...payload, fid: 1234n, deadline: BigInt(payload.deadline), key: `0x${bytesToHex(key)}` as Hex },
      signature: `0x${bytesToHex(custodySignature)}`,
    });
    expect(recovered.toLowerCase()).toBe(golden.CUSTODY_ADDR);
  });
});
