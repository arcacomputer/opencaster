/** Isolated passkey-vault checks. The authenticator alone is synthetic.
 * Real app WebAuthn validation, AES/HKDF/PBKDF2, in-memory IndexedDB and the
 * production Worker execute against the actual loopback Hypersnap registry.
 * No OS passkey, production account, signature submission or server auth.
 * Build from apps/web-client/: yarn esbuild scripts/e2e-passkey-checks.ts --bundle
 * --platform=node --format=esm --define:import.meta.env.DEV=false
 * --outfile=/tmp/arca-passkey-checks.mjs
 * Run: ARCA_WRANGLER_PATH=/PATH/TO/wrangler node /tmp/arca-passkey-checks.mjs
 * --identity-file /tmp/arca-hypersnap-e2e-features/identity.json
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import 'fake-indexeddb/auto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { getUser } from '@opencaster/client-core/api';
import { getSavedSessionMethod, unlockSavedSession, unlockSavedSessionWithPasskey, type WalletSession } from '../src/lib/auth';
import { FULL_CLIENT_SCOPES } from '@opencaster/client-core/pairing';
import { bytesToHex, hexToBytes } from '@opencaster/protocol/signedKeyRequest';
import { decryptSignerVaultWithPasskey, deleteSavedVault, encryptSignerVault, readSavedVault, writeSavedVault, type PasskeySignerVault } from '../src/lib/vault';

const ORIGIN = 'https://opencaster.org';
const args = process.argv.slice(2);
assert.equal(args.length, 2); assert.equal(args[0], '--identity-file');
const identityFile = path.resolve(args[1]);
assert.match(identityFile, /^\/(?:private\/)?tmp\/arca-hypersnap-e2e(?:-[a-z0-9-]+)?\/identity\.json$/);
const fixture = JSON.parse(await fs.readFile(identityFile, 'utf8'));
assert.equal(fixture.kind, 'arca.hypersnap.e2e.identity'); assert.equal(fixture.version, 1);
assert.equal(fixture.fid, 1234); assert.equal(fixture.devicePrivateKeyHex, '03'.repeat(32));
const node = new URL(fixture.nodeOrigin);
assert.equal(node.origin, 'http://127.0.0.1:13381');
assert.equal(node.pathname + node.search + node.hash, '/');
const project = process.cwd();
assert.equal(JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8')).name, '@opencaster/web-client');
const { createMediaRuntime } = await import(pathToFileURL(path.join(project, 'scripts/e2e-media-runtime.mjs')).href);
const runtime = await createMediaRuntime({ nodeUrl: node.origin });
const nativeFetch = globalThis.fetch;
const nativeDescriptors = new Map(['location', 'navigator', 'PublicKeyCredential', 'isSecureContext'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const sessions: WalletSession[] = [];
let reads = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? new URL(input, ORIGIN) : input instanceof URL ? input : new URL(input.url);
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  assert.equal(method, 'GET', 'Passkey setup, migration and unlock must never submit a network write.');
  if (url.origin === ORIGIN) { reads++; return runtime.fetch(url.href, init); }
  assert.equal(url.origin, node.origin, 'External requests are forbidden in this isolated check.');
  return nativeFetch(input, init);
};

// A deterministic browser-facing interface, never a real user authenticator.
// Secrets remain only in this test process. Native signature verification and
// physical biometrics/provider interoperability are not claimed by this run.
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer;
const b64 = (value: Uint8Array) => Buffer.from(value).toString('base64url');
const view = (value: BufferSource) => value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
class SyntheticCredential {
  readonly type = 'public-key';
  readonly id: string;
  constructor(readonly rawId: ArrayBuffer, readonly response: unknown, private readonly extensions: unknown) { this.id = b64(new Uint8Array(rawId)); }
  getClientExtensionResults() { return this.extensions; }
}
const providers = new Map<string, { id: Uint8Array<ArrayBuffer>; user: Uint8Array; secret: Uint8Array; rp: string }>();
let mode: 'ok' | 'unsupported' | 'cancel' = 'ok';
let gets = 0;
let creates = 0;
async function authenticatorData(rp: string, id?: Uint8Array): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(id ? 55 + id.length : 37);
  bytes.set(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rp))));
  bytes[32] = id ? 0x45 : 0x05;
  if (id) { bytes[53] = id.length >> 8; bytes[54] = id.length & 255; bytes.set(id, 55); }
  return bytes.buffer;
}
Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: ORIGIN } });
Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: SyntheticCredential });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { credentials: {
  async create({ publicKey, signal }: CredentialCreationOptions) {
    creates++;
    assert(publicKey); assert.equal(publicKey.authenticatorSelection?.userVerification, 'required');
    if (signal?.aborted || mode === 'cancel') throw new DOMException('Synthetic cancellation', 'NotAllowedError');
    const id = crypto.getRandomValues(new Uint8Array(32));
    const rp = publicKey.rp.id!;
    providers.set(b64(id), { id, rp, user: Uint8Array.from(view(publicKey.user.id)), secret: crypto.getRandomValues(new Uint8Array(32)) });
    const data = await authenticatorData(rp, id);
    return new SyntheticCredential(id.buffer, { clientDataJSON: encode({ type: 'webauthn.create', origin: ORIGIN, challenge: b64(view(publicKey.challenge)), crossOrigin: false }), getAuthenticatorData: () => data }, { prf: { enabled: mode === 'ok' }, credProps: { rk: true } });
  },
  async get({ publicKey, signal }: CredentialRequestOptions) {
    gets++;
    assert(publicKey); assert.equal(publicKey.userVerification, 'required');
    if (signal?.aborted || mode === 'cancel') throw new DOMException('Synthetic cancellation', 'NotAllowedError');
    const selected = providers.get(b64(view(publicKey.allowCredentials![0].id)));
    assert(selected); assert.equal(publicKey.rpId, selected.rp);
    const key = await crypto.subtle.importKey('raw', Uint8Array.from(selected.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const output = await crypto.subtle.sign('HMAC', key, publicKey.extensions!.prf!.eval!.first);
    return new SyntheticCredential(selected.id.buffer.slice(0), {
      clientDataJSON: encode({ type: 'webauthn.get', origin: ORIGIN, challenge: b64(view(publicKey.challenge)), crossOrigin: false }),
      authenticatorData: await authenticatorData(selected.rp), userHandle: Uint8Array.from(selected.user).buffer,
      signature: new Uint8Array(64).fill(7).buffer,
    }, mode === 'ok' ? { prf: { results: { first: output } } } : { prf: {} });
  },
} } });

try {
  const user = await getUser({ fid: fixture.fid });
  const privateKey = hexToBytes(fixture.devicePrivateKeyHex);
  const publicKey = bytesToHex(ed25519.getPublicKey(privateKey));
  try {
    await writeSavedVault(await encryptSignerVault(privateKey, { origin: ORIGIN, fid: fixture.fid, custodyAddress: user.custody_address.toLowerCase(), publicKey, requestFid: fixture.fid, scopes: [...FULL_CLIENT_SCOPES], ttl: 604800 }, 'Synthetic local passkey migration 2026'));
  } finally { privateKey.fill(0); }
  const previous = await readSavedVault();
  const session = await unlockSavedSession('Synthetic local passkey migration 2026', { origin: ORIGIN }); sessions.push(session);
  assert.equal(await getSavedSessionMethod(), 'password');
  mode = 'unsupported';
  await assert.rejects(session.saveToDeviceWithPasskey(), /cannot encrypt/);
  assert.deepEqual(await readSavedVault(), previous);
  mode = 'cancel';
  await assert.rejects(session.saveToDeviceWithPasskey(), /cancelled/);
  assert.deepEqual(await readSavedVault(), previous);
  mode = 'ok';
  await session.saveToDeviceWithPasskey();
  assert.equal(await getSavedSessionMethod(), 'passkey');
  const saved = await readSavedVault() as PasskeySignerVault;
  assert.equal(saved.version, 2); assert.equal(saved.passkey.origin, ORIGIN);
  assert(!JSON.stringify(saved).includes(fixture.devicePrivateKeyHex));
  session.dispose();
  const unlocked = await unlockSavedSessionWithPasskey({ origin: ORIGIN }); sessions.push(unlocked);
  assert.equal(unlocked.fid, fixture.fid); assert.equal(unlocked.publicKey, publicKey);
  assert.deepEqual(unlocked.scopes, FULL_CLIENT_SCOPES);
  const getsBefore = gets;
  await assert.rejects(unlockSavedSessionWithPasskey({ origin: 'https://hypersnap-quorum.lf-e32.workers.dev' }));
  assert.equal(gets, getsBefore, 'Wrong-origin vaults must fail before invoking a passkey.');
  const wrongPrf = new Uint8Array(32).fill(33);
  try { await assert.rejects(decryptSignerVaultWithPasskey(saved, wrongPrf, ORIGIN, ORIGIN)); }
  finally { wrongPrf.fill(0); }
  assert.deepEqual(await readSavedVault(), saved);
  unlocked.dispose();
  const again = await unlockSavedSessionWithPasskey({ origin: ORIGIN }); sessions.push(again);
  assert.equal(again.publicKey, publicKey);
  const proof = { kind: 'isolated-passkey-vault-checks', actualNode: node.origin, productionWrites: 0, networkWrites: 0,
    actualWorker: true, actualRegistry: true, realVaultCrypto: true, indexedDB: 'in-memory fake-indexeddb',
    authenticator: 'synthetic WebAuthn/PRF provider, not a physical device', legacyPasswordUnlock: true,
    failedSetupPreservesOldVault: true, migration: true, lockAndPasskeyUnlock: true, originBinding: true,
    wrongPrfRejected: true, scopesUnchanged: true, creates, gets, publicReads: reads };
  await fs.writeFile(path.join(path.dirname(identityFile), 'passkey-checks-proof.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
} finally {
  sessions.forEach(session => session.dispose());
  for (const provider of providers.values()) provider.secret.fill(0);
  providers.clear(); await deleteSavedVault(); await runtime.dispose();
  globalThis.fetch = nativeFetch;
  for (const [name, descriptor] of nativeDescriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
}
