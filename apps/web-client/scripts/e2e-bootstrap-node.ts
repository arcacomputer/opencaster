/** Synthetic-only fixture bootstrap for an actual, isolated Hypersnap node.
 * Build: yarn esbuild scripts/e2e-bootstrap-node.ts --bundle --platform=node
 *   --format=esm --outfile=/tmp/arca-e2e-bootstrap.mjs
 * Run only while the node uses Devnet; the app test runs after a Mainnet-mode
 * restart of the same isolated database. These are public test keys, not users.
 */
import assert from 'node:assert/strict';
import http2 from 'node:http2';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { buildSignedMessage, FarcasterNetwork, MessageType, SignatureScheme, farcasterTimestamp, blake3_20, encodeMessageEnvelope } from '@opencaster/protocol/messageBuilder';
import { ProtoWriter } from '@opencaster/protocol/protoWire';
import { abiEncodeSignedKeyRequestMetadata, addressFromCustodyPrivateKey, bytesToHex, hexToBytes, keyAddDigest, signedKeyRequestDigest, signEip712Digest } from '@opencaster/protocol/signedKeyRequest';

const HTTP = 'http://127.0.0.1:13381';
const RPC = 'http://127.0.0.1:13383';
const fixtureArg = process.argv.indexOf('--fixture-dir');
const fixtureDir = resolve(fixtureArg >= 0 ? process.argv[fixtureArg + 1] ?? '' : '/tmp/arca-hypersnap-e2e');
assert.match(fixtureDir, /^\/(?:private\/)?tmp\/arca-hypersnap-e2e(?:-[a-z0-9-]+)?$/, 'Use a dedicated synthetic fixture directory under /tmp.');
const FIXTURE = `${fixtureDir}/identity.json`;
const scopes = [1, 2, 3, 4, 5, 6, 11];
const legacyKey = hexToBytes('05'.repeat(32));
let eventNumber = 100;

async function json(path: string) {
  const response = await fetch(`${HTTP}${path}`);
  const value = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(`Local read ${path} returned ${response.status}: ${JSON.stringify(value)}`);
  return value;
}
async function until(label: string, test: () => Promise<boolean>, ms = 45_000) {
  const end = Date.now() + ms;
  do { if (await test().catch(() => false)) return; await new Promise(resolve => setTimeout(resolve, 250)); } while (Date.now() < end);
  throw new Error(`Local node did not confirm ${label}.`);
}
async function adminEvent(fid: number, type: number, bodyField: number, body: Uint8Array) {
  const writer = new ProtoWriter();
  writer.writeVarintField(1, type); writer.writeVarintField(2, 10);
  writer.writeVarintField(3, eventNumber++); writer.writeBytesField(4, randomBytes(32));
  writer.writeVarintField(5, Math.floor(Date.now() / 1000) - 5); writer.writeBytesField(6, randomBytes(32));
  writer.writeVarintField(7, 0); writer.writeVarintField(8, fid); writer.writeSubMessage(bodyField, body);
  writer.writeVarintField(14, 1);
  const payload = writer.bytes(); const frame = Buffer.alloc(payload.length + 5);
  frame.writeUInt32BE(payload.length, 1); frame.set(payload, 5);
  const client = http2.connect(RPC);
  try {
    await new Promise<void>((resolve, reject) => {
      let status = ''; let message = '';
      const stream = client.request({ ':method': 'POST', ':path': '/AdminService/SubmitOnChainEvent', 'content-type': 'application/grpc', te: 'trailers', 'grpc-timeout': '20S', authorization: `Basic ${Buffer.from('arca-e2e:synthetic-test-only').toString('base64')}` });
      stream.on('response', headers => { if (headers['grpc-status']) status = String(headers['grpc-status']); });
      stream.on('trailers', headers => { status = String(headers['grpc-status']); message = String(headers['grpc-message'] || ''); });
      stream.on('data', () => {}); stream.on('error', reject);
      stream.on('end', () => status === '0' ? resolve() : reject(new Error(`Local devnet admin RPC ${status}: ${message}`)));
      stream.end(frame);
    });
  } finally { client.close(); }
}
async function submit(envelope: Uint8Array) {
  const response = await fetch(`${HTTP}/v1/submitMessage`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(envelope).buffer });
  const value = await response.json();
  assert.equal(response.ok, true, `Local submit rejected: ${response.status} ${JSON.stringify(value)}`);
  return value;
}
async function seed(fid: number, custodyHex: string, deviceHex: string) {
  const custody = hexToBytes(custodyHex); const device = hexToBytes(deviceHex);
  const address = addressFromCustodyPrivateKey(custody);
  const registration = new ProtoWriter(); registration.writeBytesField(1, hexToBytes(address)); registration.writeVarintField(2, 1);
  await adminEvent(fid, 3, 11, registration.bytes());
  const rent = new ProtoWriter(); rent.writeBytesField(1, hexToBytes(address)); rent.writeVarintField(2, 100); rent.writeVarintField(3, Math.floor(Date.now() / 1000) + 31_536_000);
  await adminEvent(fid, 4, 12, rent.bytes());
  // A separate legacy fixture key can produce compact-state fixtures. The app's
  // scoped device key receives exactly its reviewed client scopes, never type 14.
  const legacy = new ProtoWriter(); legacy.writeBytesField(1, ed25519.getPublicKey(legacyKey)); legacy.writeVarintField(2, 1); legacy.writeVarintField(3, 1); legacy.writeVarintField(5, 1);
  await adminEvent(fid, 1, 9, legacy.bytes());
  await until(`synthetic FID ${fid} registration`, async () => (await json(`/v1/onChainIdRegistryEventByAddress?address=${address}`)).fid === fid);
  await until(`synthetic FID ${fid} legacy signer`, async () => (await json(`/v1/signersByFid?fid=${fid}`)).signers?.some((signer: any) => signer.key.replace(/^0x/, '') === bytesToHex(ed25519.getPublicKey(legacyKey))));
  const registry = await json(`/v1/signersByFid?fid=${fid}`);
  const key = ed25519.getPublicKey(device); const deadline = farcasterTimestamp() + 900;
  const requestSignature = signEip712Digest(signedKeyRequestDigest({ requestFid: fid, key, deadline }), custody);
  const nonce = registry.currentUserNonce + 1;
  const metadata = abiEncodeSignedKeyRequestMetadata({ requestFid: fid, requestSigner: address, signature: requestSignature, deadline });
  const signed = await buildSignedMessage({ type: MessageType.KEY_ADD, fid, network: FarcasterNetwork.DEVNET, body: { keyAddBody: { key, custodySignature: signEip712Digest(keyAddDigest({ fid, key, keyType: 1, scopes, ttl: 604800, nonce, deadline }), custody), deadline, nonce, metadata, scopes, ttl: 604800 } } }, { scheme: SignatureScheme.ED25519, publicKey: key, sign: async hash => ed25519.sign(hash, device) });
  await submit(signed.envelope);
  await until(`synthetic FID ${fid} scoped device key`, async () => (await json(`/v1/signersByFid?fid=${fid}`)).signers?.some((signer: any) => signer.key.replace(/^0x/, '') === bytesToHex(key) && signer.source === 'SIGNER_SOURCE_OFFCHAIN'));
}

async function main() {
  assert.equal(new URL(HTTP).hostname, '127.0.0.1'); assert.equal(new URL(RPC).hostname, '127.0.0.1');
  await json('/v1/info');
  if (process.argv.includes('--rate-limit-probe')) {
    const before = await json('/v1/signersByFid?fid=1234');
    const custody = hexToBytes('01'.repeat(32)); const fid = 1234;
    const results: Array<{ status: number; response: unknown; publicKey: string; nonce: number }> = [];
    const nextWindow = process.argv.includes('--next-window');
    const admissionOnly = process.argv.includes('--admission-only');
    const worker = nextWindow ? 'http://127.0.0.1:5188' : undefined;
    for (const [index, fixtureByte] of (nextWindow ? ['07', '08'] : ['06', '07']).entries()) {
      const device = hexToBytes(fixtureByte.repeat(32)); const key = ed25519.getPublicKey(device);
      assert(!before.signers.some((signer: any) => signer.key.replace(/^0x/, '') === bytesToHex(key)), 'Rate-limit probe requires fresh fixture keys.');
      const deadline = farcasterTimestamp() + 900; const nonce = before.currentUserNonce + index + 1;
      const requestSignature = signEip712Digest(signedKeyRequestDigest({ requestFid: fid, key, deadline }), custody);
      const metadata = abiEncodeSignedKeyRequestMetadata({ requestFid: fid, requestSigner: addressFromCustodyPrivateKey(custody), signature: requestSignature, deadline });
      const signed = await buildSignedMessage({ type: MessageType.KEY_ADD, fid, body: { keyAddBody: { key, custodySignature: signEip712Digest(keyAddDigest({ fid, key, keyType: 1, scopes, ttl: 604800, nonce, deadline }), custody), deadline, nonce, metadata, scopes, ttl: 604800 } } }, { scheme: SignatureScheme.ED25519, publicKey: key, sign: async hash => ed25519.sign(hash, device) });
      const viaWorker = index === 1 && worker;
      const response = await fetch(viaWorker ? `${worker}/api/v1/submitMessage` : `${HTTP}/v1/submitMessage`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...(viaWorker ? { Origin: worker } : {}) }, body: new Uint8Array(signed.envelope).buffer });
      const value = await response.json();
      results.push({ status: response.status, response: value, publicKey: bytesToHex(key), nonce });
      if (index === 0) {
        assert.equal(response.status, 200, `First fresh local KEY_ADD was not accepted: ${JSON.stringify(value)}`);
        if (!admissionOnly) {
          await until('rate-limit probe first key inclusion', async () => (await json('/v1/signersByFid?fid=1234')).signers?.some((signer: any) => signer.key.replace(/^0x/, '') === bytesToHex(key)));
          console.log(JSON.stringify({ firstCommitted: true, nonce, publicKey: bytesToHex(key), confirmedAt: new Date().toISOString() }));
        }
      }
    }
    const after = await json('/v1/signersByFid?fid=1234');
    const proof = { actualNode: HTTP, worker, firstStatus: results[0].status, firstCommittedNonce: admissionOnly ? null : results[0].nonce, firstAdmittedNonce: results[0].nonce, secondStatus: results[1].status, secondRawResponse: results[1].response, storedNonceAfter: after.currentUserNonce, automaticRetries: 0 };
    await writeFile(`${fixtureDir}/${nextWindow ? 'rate-limit-worker-proof' : 'rate-limit-proof'}.json`, JSON.stringify(proof, null, 2));
    console.log(JSON.stringify(proof));
    return;
  }
  if (process.argv.includes('--validate-social')) {
    const custody = hexToBytes('01'.repeat(32)); const device = hexToBytes('07'.repeat(32));
    const fid = 1234; const key = ed25519.getPublicKey(device); const deadline = farcasterTimestamp() + 900;
    const registry = await json(`/v1/signersByFid?fid=${fid}`); const nonce = registry.currentUserNonce + 1;
    const requestSignature = signEip712Digest(signedKeyRequestDigest({ requestFid: fid, key, deadline }), custody);
    const metadata = abiEncodeSignedKeyRequestMetadata({ requestFid: fid, requestSigner: addressFromCustodyPrivateKey(custody), signature: requestSignature, deadline });
    const signed = await buildSignedMessage({ type: MessageType.KEY_ADD, fid, body: { keyAddBody: { key, custodySignature: signEip712Digest(keyAddDigest({ fid, key, keyType: 1, scopes, ttl: 604800, nonce, deadline }), custody), deadline, nonce, metadata, scopes, ttl: 604800 } } }, { scheme: SignatureScheme.ED25519, publicKey: key, sign: async hash => ed25519.sign(hash, device) });
    const response = await fetch(`${HTTP}/v1/validateMessage`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(signed.envelope).buffer });
    console.log(JSON.stringify({ validationOnly: true, status: response.status, nodeResult: await response.json() }));
    return;
  }
  if (process.argv.includes('--compact')) {
    const body = new ProtoWriter(); body.writeStringField(1, 'follow'); body.writePackedVarint(2, [1235n]);
    const data = new ProtoWriter(); data.writeVarintField(1, 14); data.writeVarintField(2, 1234); data.writeVarintField(3, farcasterTimestamp()); data.writeVarintField(4, FarcasterNetwork.MAINNET); data.writeSubMessage(17, body.bytes());
    const dataBytes = data.bytes(); const hash = blake3_20(dataBytes);
    await submit(encodeMessageEnvelope({ dataBytes, hash, signature: ed25519.sign(hash, legacyKey), signatureScheme: SignatureScheme.ED25519, signer: ed25519.getPublicKey(legacyKey) }));
    await until('compact-state-only effective follow', async () => (await json('/v2/farcaster/user/following?fid=1234&cursor=1234&limit=1')).users?.[0]?.fid === 1235);
    const absent = await fetch(`${HTTP}/v1/linkById?fid=1234&link_type=follow&target_fid=1235`);
    assert.equal(absent.status, 400, 'Expected individual LINK_ADD to be absent after compaction.');
    assert.match((await absent.json() as { error_detail: string }).error_detail, /^status: NotFound,/);
    console.log(JSON.stringify({ compactStateOnlyFollow: true, effectiveFollowingFid: 1235, individualLinkAddAbsent: true }));
    return;
  }
  if (process.argv.includes('--compact-remove')) {
    const device = hexToBytes('03'.repeat(32));
    const message = await buildSignedMessage({ type: MessageType.LINK_REMOVE, fid: 1234, timestamp: farcasterTimestamp() + 1, body: { linkBody: { type: 'follow', targetFid: 1235 } } }, { scheme: SignatureScheme.ED25519, publicKey: ed25519.getPublicKey(device), sign: async hash => ed25519.sign(hash, device) });
    await submit(message.envelope);
    await until('removal after compact-state follow', async () => (await json('/v2/farcaster/user/following?fid=1234&cursor=1234&limit=1')).users?.[0]?.fid !== 1235);
    console.log(JSON.stringify({ compactFollowRemoval: true, effectiveFollowingAbsent: true }));
    return;
  }
  await seed(1234, '01'.repeat(32), '03'.repeat(32));
  await seed(1235, '02'.repeat(32), '04'.repeat(32));
  const device = hexToBytes('03'.repeat(32));
  for (const [type, value] of [[2, 'Isolated Arca'], [3, 'Synthetic local fixture.'], [1, 'ipfs://legacy-avatar']] as const) {
    const message = await buildSignedMessage({ type: MessageType.USER_DATA_ADD, fid: 1234, network: FarcasterNetwork.DEVNET, body: { userDataBody: { type, value } } }, { scheme: SignatureScheme.ED25519, publicKey: ed25519.getPublicKey(device), sign: async hash => ed25519.sign(hash, device) });
    await submit(message.envelope);
  }
  await until('synthetic legacy profile', async () => (await json('/v2/farcaster/user?fid=1234')).user?.pfp_url === 'ipfs://legacy-avatar');
  const fixture = { kind: 'arca.hypersnap.e2e.identity', version: 1, fid: 1234, custodyPrivateKeyHex: '01'.repeat(32), devicePrivateKeyHex: '03'.repeat(32), otherFid: 1235, otherDevicePrivateKeyHex: '04'.repeat(32), legacyPrivateKeyHex: '05'.repeat(32), nodeOrigin: HTTP };
  await writeFile(FIXTURE, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ isolatedNode: HTTP, fixtureFile: FIXTURE, registeredFids: [1234, 1235], scopes, registration: 'actual Devnet admin events', authorization: 'actual custody EIP-712 and Ed25519' }));
}
await main();
