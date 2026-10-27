import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ApiError, clearReactionStatusCache, getCast, getFollowStatus, getReactionStatus, getSigners, getUser, invalidateReactionStatus, primeReactionStatus, submitMessage, type Cast, type SignersResponse, type User } from './api';
import { deleteSavedSession, getSavedSessionMethod, hasSavedSession, preparePairing, unlockSavedSession, unlockSavedSessionWithPasskey, type PendingPairing, type PendingRevocation } from './auth';
import { FULL_CLIENT_SCOPES, FULL_SOCIAL_SCOPES, hashPairingRequest, hashRevocationRequest, type PairingApproval, type RevocationApproval } from './pairing';
import { blake3_20 } from './protocol/messageBuilder';
import { addressFromCustodyPrivateKey, bytesToHex, hexToBytes, keyAddDigest, keyRemoveDigest, signedKeyRequestDigest, signEip712Digest } from './protocol/signedKeyRequest';
import { compareAndSwapSavedVault, deleteSavedVault, readSavedVault, writeSavedVault } from './vault';
import * as vaultModule from './vault';
import { enrollPasskey, evaluatePasskey, type PasskeyDescriptor } from './passkey';
import { mediaGrantPayload } from './media';

vi.mock('./api', async importOriginal => ({ ...await importOriginal<typeof import('./api')>(), getCast: vi.fn(), getFollowStatus: vi.fn(), getReactionStatus: vi.fn(), getSigners: vi.fn(), getUser: vi.fn(), submitMessage: vi.fn(), clearReactionStatusCache: vi.fn(), invalidateReactionStatus: vi.fn(), primeReactionStatus: vi.fn() }));
vi.mock('./vault', async importOriginal => ({ ...await importOriginal<typeof import('./vault')>(), compareAndSwapSavedVault: vi.fn(), readSavedVault: vi.fn(), writeSavedVault: vi.fn(), deleteSavedVault: vi.fn() }));
vi.mock('./passkey', async importOriginal => ({ ...await importOriginal<typeof import('./passkey')>(), enrollPasskey: vi.fn(), evaluatePasskey: vi.fn() }));

const ORIGIN = 'https://opencaster.org';
const CUSTODY_KEY = hexToBytes('01'.repeat(32)); // synthetic test fixture; no real account
const CUSTODY = addressFromCustodyPrivateKey(CUSTODY_KEY);
const user = { fid: 1234, username: 'test', display_name: 'Test', custody_address: CUSTODY } as User;
const scopes = ['MESSAGE_TYPE_CAST_ADD', 'MESSAGE_TYPE_REACTION_ADD', 'MESSAGE_TYPE_REACTION_REMOVE'];
let registry: SignersResponse;
let currentProfile: User;
let currentCast: Cast | undefined;
const target = { fid: user.fid, hash: 'ab'.repeat(20) };
const descriptor = (origin = ORIGIN): PasskeyDescriptor => ({ origin, rpId: new URL(origin).hostname, credentialId: 'c3ludGhldGlj', prfSalt: '23'.repeat(32), userHandle: '34'.repeat(32) });
const prfSecret = () => new Uint8Array(32).fill(25); // Public synthetic PRF fixture.

function approvalFor(pending: PendingPairing): PairingApproval {
  const request = pending.request;
  const key = hexToBytes(request.publicKey);
  return {
    kind: 'arca.hypersnap.signer.approval', version: 1, requestId: request.requestId,
    requestHash: hashPairingRequest(request), custodyAddress: CUSTODY,
    custodySignature: bytesToHex(signEip712Digest(keyAddDigest({ fid: request.fid, key, keyType: 1, scopes: request.scopes, ttl: 604800, nonce: request.nonce, deadline: request.deadline }), CUSTODY_KEY)),
    requestSignature: bytesToHex(signEip712Digest(signedKeyRequestDigest({ requestFid: request.fid, key, deadline: request.deadline }), CUSTODY_KEY)),
  };
}
function revocationApprovalFor(pending: PendingRevocation): RevocationApproval {
  const request = pending.request;
  return {
    kind: 'arca.hypersnap.signer.revoke.approval', version: 1, requestId: request.requestId,
    requestHash: hashRevocationRequest(request), custodyAddress: CUSTODY, signatureType: 1,
    custodySignature: bytesToHex(signEip712Digest(keyRemoveDigest({ fid: request.fid, key: hexToBytes(request.publicKey), nonce: request.nonce, deadline: request.deadline }), CUSTODY_KEY)),
  };
}

function fields(bytes: Uint8Array): Map<number, Uint8Array | number> {
  let offset = 0;
  const result = new Map<number, Uint8Array | number>();
  const varint = () => { let n = 0, shift = 0, byte: number; do { byte = bytes[offset++]; n += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128); return n; };
  while (offset < bytes.length) {
    const tag = varint();
    if ((tag & 7) === 0) result.set(tag >> 3, varint());
    else if ((tag & 7) === 2) { const length = varint(); result.set(tag >> 3, bytes.slice(offset, offset += length)); }
    else throw new Error('Unexpected wire type');
  }
  return result;
}

function mergeProfileMessage(envelope: Uint8Array): void {
  const data = fields(fields(envelope).get(1) as Uint8Array);
  if (data.get(1) !== 11) return;
  const body = fields(data.get(12) as Uint8Array);
  const value = new TextDecoder().decode(body.get(2) as Uint8Array ?? new Uint8Array());
  if (body.get(1) === 2) currentProfile = { ...currentProfile, display_name: value };
  else if (body.get(1) === 1) currentProfile = { ...currentProfile, pfp_url: value };
  else if (body.get(1) === 3) currentProfile = { ...currentProfile, profile: { ...currentProfile.profile, bio: { text: value } } };
}

async function connect(requestedScopes?: readonly number[]) {
  const pending = await preparePairing({ fid: user.fid }, { origin: ORIGIN, requestedScopes });
  const approval = approvalFor(pending);
  const session = await pending.complete(approval);
  return { pending, approval, session };
}

describe('offline approved per-device authentication', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('location', { origin: ORIGIN });
    registry = { signers: [], currentUserNonce: 4, gaslessSignerCount: 0, gaslessSignerLimit: 1000, requesterFidNonces: { '1234': 8 } };
    currentProfile = structuredClone(user);
    currentCast = { hash: `0x${target.hash}`, author: user, text: 'Synthetic cast' } as Cast;
    vi.mocked(getUser).mockImplementation(async () => structuredClone(currentProfile));
    vi.mocked(getCast).mockImplementation(async () => {
      if (!currentCast) throw new ApiError('Cast not found.', 404, 'cast_not_found');
      return structuredClone(currentCast);
    });
    vi.mocked(getSigners).mockImplementation(async () => structuredClone(registry));
    vi.mocked(getReactionStatus).mockResolvedValue(false);
    vi.mocked(readSavedVault).mockResolvedValue(undefined);
    vi.mocked(writeSavedVault).mockImplementation(async vault => { vi.mocked(readSavedVault).mockResolvedValue(vault); });
    vi.mocked(deleteSavedVault).mockImplementation(async expected => {
      const saved = await readSavedVault();
      if (expected === undefined || saved && typeof saved === 'object' && 'metadata' in saved && saved.metadata && typeof saved.metadata === 'object' && 'publicKey' in saved.metadata && saved.metadata.publicKey === expected) vi.mocked(readSavedVault).mockResolvedValue(undefined);
    });
    vi.mocked(compareAndSwapSavedVault).mockImplementation(async (expected, next) => {
      if (JSON.stringify(await readSavedVault()) !== JSON.stringify(expected)) return false;
      if (next === undefined) await deleteSavedVault(expected?.metadata.publicKey);
      else await writeSavedVault(next);
      return true;
    });
    vi.mocked(enrollPasskey).mockImplementation(async options => ({ descriptor: descriptor(options.origin), prfSecret: prfSecret() }));
    vi.mocked(evaluatePasskey).mockImplementation(async () => prfSecret());
    vi.mocked(submitMessage).mockImplementation(async envelope => {
      const data = fields(fields(envelope).get(1) as Uint8Array);
      if (data.get(1) === 16) {
        const key = fields(data.get(19) as Uint8Array).get(1) as Uint8Array;
        const encodedScopes = fields(data.get(19) as Uint8Array).get(9) as Uint8Array;
        const names: Record<number, string> = { 1: 'MESSAGE_TYPE_CAST_ADD', 2: 'MESSAGE_TYPE_CAST_REMOVE', 3: 'MESSAGE_TYPE_REACTION_ADD', 4: 'MESSAGE_TYPE_REACTION_REMOVE', 5: 'MESSAGE_TYPE_LINK_ADD', 6: 'MESSAGE_TYPE_LINK_REMOVE', 11: 'MESSAGE_TYPE_USER_DATA_ADD' };
        registry = { ...registry, currentUserNonce: 5, gaslessSignerCount: 1, signers: [{ key: bytesToHex(key), source: 'SIGNER_SOURCE_OFFCHAIN', scopes: Array.from(encodedScopes, scope => names[scope]), requestFid: user.fid, expiresAt: Math.floor(Date.now() / 1000) + 604800 }] };
      } else if (data.get(1) === 17) registry = { ...registry, signers: [], gaslessSignerCount: 0 };
      else if (data.get(1) === 2) currentCast = undefined;
      else mergeProfileMessage(envelope);
      return {};
    });
  });

  it('migrates an already approved signer to PRF storage and unlocks it with fresh read-only authorization checks', async () => {
    const { session } = await connect(FULL_CLIENT_SCOPES);
    await session.saveToDevice('synthetic-device-password');
    expect(await getSavedSessionMethod()).toBe('password');
    const enrollmentSecret = prfSecret(); const unlockSecret = prfSecret();
    vi.mocked(enrollPasskey).mockResolvedValueOnce({ descriptor: descriptor(), prfSecret: enrollmentSecret });
    await session.saveToDeviceWithPasskey();
    expect(enrollPasskey).toHaveBeenCalledWith({ origin: ORIGIN, account: { fid: session.fid, publicKey: session.publicKey }, signal: expect.any(AbortSignal) });
    expect(enrollmentSecret.every(byte => byte === 0)).toBe(true);
    expect(await getSavedSessionMethod(session.publicKey)).toBe('passkey');
    expect(await getSavedSessionMethod('ff'.repeat(32))).toBeUndefined();
    expect(submitMessage).toHaveBeenCalledOnce(); // Migration never creates another KEY_ADD.
    await expect(unlockSavedSession('synthetic-device-password', { origin: ORIGIN })).rejects.toThrow('uses a passkey');
    session.dispose();
    vi.mocked(evaluatePasskey).mockResolvedValueOnce(unlockSecret);
    const beforeReads = vi.mocked(getUser).mock.calls.length;
    const unlocked = await unlockSavedSessionWithPasskey({ origin: ORIGIN });
    expect(unlocked.publicKey).toBe(session.publicKey); expect(unlocked.scopes).toEqual(FULL_CLIENT_SCOPES);
    expect(vi.mocked(getUser).mock.calls.length).toBe(beforeReads + 1);
    expect(evaluatePasskey).toHaveBeenCalledWith(descriptor(), { origin: ORIGIN, signal: undefined });
    expect(unlockSecret.every(byte => byte === 0)).toBe(true);
    expect(submitMessage).toHaveBeenCalledOnce(); unlocked.dispose();
  });

  it('starts passkey enrollment in the initial click stack while the old-vault read is pending', async () => {
    const { session } = await connect();
    let finish!: (value: unknown) => void;
    vi.mocked(readSavedVault).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const saving = session.saveToDeviceWithPasskey();
    expect(enrollPasskey).toHaveBeenCalledOnce(); // No awaited IndexedDB/network prerequisite.
    finish(undefined); await saving;
    expect(await getSavedSessionMethod()).toBe('passkey'); session.dispose();
  });

  it('preserves the legacy password vault on missing PRF support, cancellation, malformed output and concurrent save rejection', async () => {
    const { session } = await connect();
    await session.saveToDevice('synthetic-device-password');
    const original = await readSavedVault();
    for (const failure of [new Error('PRF not supported.'), new DOMException('Cancelled.', 'AbortError')]) {
      vi.mocked(enrollPasskey).mockRejectedValueOnce(failure);
      await expect(session.saveToDeviceWithPasskey()).rejects.toThrow();
      expect(await readSavedVault()).toEqual(original);
    }
    const missing = new Uint8Array(31).fill(25);
    vi.mocked(enrollPasskey).mockResolvedValueOnce({ descriptor: descriptor(), prfSecret: missing });
    await expect(session.saveToDeviceWithPasskey()).rejects.toThrow('32-byte');
    expect(missing.every(byte => byte === 0)).toBe(true); expect(await readSavedVault()).toEqual(original);
    vi.mocked(compareAndSwapSavedVault).mockResolvedValueOnce(false);
    await expect(session.saveToDeviceWithPasskey()).rejects.toThrow('changed in another tab');
    expect(await readSavedVault()).toEqual(original); expect(submitMessage).toHaveBeenCalledOnce();
    session.dispose();
  });

  it('wipes a late enrollment result after cancellation or disposal and never persists it', async () => {
    for (const dispose of [false, true]) {
      const { session } = await connect();
      await session.saveToDevice('synthetic-device-password');
      const original = await readSavedVault();
      const controller = new AbortController();
      const late = prfSecret(); let finish!: (value: Awaited<ReturnType<typeof enrollPasskey>>) => void;
      vi.mocked(enrollPasskey).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const saving = session.saveToDeviceWithPasskey({ signal: controller.signal });
      const rejection = expect(saving).rejects.toThrow();
      await expect(session.saveToDeviceWithPasskey()).rejects.toThrow('already being saved');
      if (dispose) session.dispose(); else controller.abort();
      expect(vi.mocked(enrollPasskey).mock.calls.at(-1)![0].signal?.aborted).toBe(true);
      finish({ descriptor: descriptor(), prfSecret: late }); await rejection;
      expect(late.every(byte => byte === 0)).toBe(true); expect(await readSavedVault()).toEqual(original);
      session.dispose();
    }
  });

  it('restores the old vault after a late committed cancellation and preserves a newer concurrent wrapper', async () => {
    const { session } = await connect();
    await session.saveToDevice('synthetic-device-password');
    const original = await readSavedVault();
    const controller = new AbortController();
    vi.mocked(writeSavedVault).mockImplementationOnce(async value => { vi.mocked(readSavedVault).mockResolvedValue(value); controller.abort(); });
    await expect(session.saveToDeviceWithPasskey({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readSavedVault()).toEqual(original);
    const newer = structuredClone(original) as vaultModule.SignerVault;
    newer.cipher.iv = 'ab'.repeat(12); // Public wrapper-only concurrent-record fixture; never decrypted.
    const nextController = new AbortController();
    vi.mocked(compareAndSwapSavedVault).mockImplementationOnce(async (_expected, _next) => {
      vi.mocked(readSavedVault).mockResolvedValue(newer); nextController.abort(); return true;
    });
    await expect(session.saveToDeviceWithPasskey({ signal: nextController.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readSavedVault()).toEqual(newer); session.dispose();
  });

  it('does not commit a password wrapper after its dialog is cancelled during PBKDF2', async () => {
    const { session } = await connect();
    const controller = new AbortController();
    const saving = session.saveToDevice('synthetic-device-password', { signal: controller.signal });
    controller.abort();
    await expect(saving).rejects.toMatchObject({ name: 'AbortError' });
    expect(writeSavedVault).not.toHaveBeenCalled(); expect(await readSavedVault()).toBeUndefined();
    await session.cast('The active tab remains usable after cancelling local storage.');
    expect(submitMessage).toHaveBeenCalledTimes(2); session.dispose();
  });

  it('uses the actual localhost WebAuthn origin without changing canonical network-approval metadata', async () => {
    const { session } = await connect(); const local = 'http://127.0.0.1:5173';
    vi.stubGlobal('location', { origin: local });
    await session.saveToDeviceWithPasskey();
    const saved = await readSavedVault() as vaultModule.PasskeySignerVault;
    expect(saved.metadata.origin).toBe(ORIGIN); expect(saved.passkey.origin).toBe(local); expect(saved.passkey.rpId).toBe('127.0.0.1');
    expect(vi.mocked(enrollPasskey).mock.calls.at(-1)![0].origin).toBe(local);
    session.dispose(); const unlocked = await unlockSavedSessionWithPasskey();
    expect(vi.mocked(evaluatePasskey).mock.calls.at(-1)![1].origin).toBe(local);
    expect(unlocked.publicKey).toBe(session.publicKey); expect(submitMessage).toHaveBeenCalledOnce(); unlocked.dispose();
  });

  it('rejects revoked, expired, scope-changed and custody-transferred saved keys after PRF decryption, wiping failed plaintext', async () => {
    const { session } = await connect(FULL_CLIENT_SCOPES);
    await session.saveToDeviceWithPasskey(); session.dispose();
    const original = structuredClone(registry);
    const real = await vi.importActual<typeof import('./vault')>('./vault');
    const plaintexts: Uint8Array[] = [];
    vi.spyOn(vaultModule, 'decryptSignerVaultWithPasskey').mockImplementation(async (...args) => {
      const unlocked = await real.decryptSignerVaultWithPasskey(...args); plaintexts.push(unlocked.privateKey); return unlocked;
    });
    for (const variant of ['revoked', 'expired', 'scopes', 'custody']) {
      registry = structuredClone(original); currentProfile = structuredClone(user);
      if (variant === 'revoked') registry.signers = [];
      if (variant === 'expired') registry.signers[0].expiresAt = 1;
      if (variant === 'scopes') registry.signers[0].scopes = scopes;
      if (variant === 'custody') currentProfile.custody_address = `0x${'ff'.repeat(20)}`;
      const result = prfSecret(); vi.mocked(evaluatePasskey).mockResolvedValueOnce(result);
      await expect(unlockSavedSessionWithPasskey({ origin: ORIGIN })).rejects.toThrow();
      expect(result.every(byte => byte === 0)).toBe(true);
      expect(plaintexts.at(-1)!.every(byte => byte === 0)).toBe(true);
    }
    expect(submitMessage).toHaveBeenCalledOnce();
  });

  it('rejects wrong origins, password-only and corrupt records before any passkey prompt', async () => {
    const { session } = await connect();
    await session.saveToDevice('synthetic-device-password');
    await expect(unlockSavedSessionWithPasskey({ origin: ORIGIN })).rejects.toThrow('uses a password');
    expect(evaluatePasskey).not.toHaveBeenCalled();
    await session.saveToDeviceWithPasskey();
    await expect(unlockSavedSessionWithPasskey({ origin: 'https://elsewhere.example' })).rejects.toThrow('different website');
    expect(evaluatePasskey).not.toHaveBeenCalled();
    vi.mocked(readSavedVault).mockResolvedValue({ corrupt: true });
    await expect(getSavedSessionMethod()).rejects.toThrow('invalid');
    await expect(unlockSavedSessionWithPasskey({ origin: ORIGIN })).rejects.toThrow('invalid');
    expect(evaluatePasskey).not.toHaveBeenCalled(); session.dispose();
  });

  it('preserves existing storage when the newly created passkey wrapper belongs to another browser origin', async () => {
    const { session } = await connect();
    await session.saveToDevice('synthetic-device-password'); const original = await readSavedVault();
    const result = prfSecret(); vi.mocked(enrollPasskey).mockResolvedValueOnce({ descriptor: descriptor('https://other.example'), prfSecret: result });
    await expect(session.saveToDeviceWithPasskey()).rejects.toThrow();
    expect(result.every(byte => byte === 0)).toBe(true); expect(await readSavedVault()).toEqual(original);
    session.dispose();
  });

  it('wipes decrypted signer and PRF buffers when unlock is cancelled during its fresh authorization read', async () => {
    const { session } = await connect();
    await session.saveToDeviceWithPasskey(); session.dispose();
    const original = await readSavedVault(); const controller = new AbortController();
    const real = await vi.importActual<typeof import('./vault')>('./vault');
    let plaintext: Uint8Array | undefined;
    vi.spyOn(vaultModule, 'decryptSignerVaultWithPasskey').mockImplementation(async (...args) => {
      const unlocked = await real.decryptSignerVaultWithPasskey(...args); plaintext = unlocked.privateKey; return unlocked;
    });
    const result = prfSecret(); vi.mocked(evaluatePasskey).mockResolvedValueOnce(result);
    let started!: () => void; const reading = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(getUser).mockImplementationOnce(async (_lookup, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Cancelled.', 'AbortError')), { once: true }); started();
      expect(result.every(byte => byte === 0)).toBe(true); // Already erased while the network read is still blocked.
    }));
    const unlocking = unlockSavedSessionWithPasskey({ signal: controller.signal });
    const rejection = expect(unlocking).rejects.toMatchObject({ name: 'AbortError' });
    await reading; controller.abort(); await rejection;
    expect(plaintext!.every(byte => byte === 0)).toBe(true); expect(result.every(byte => byte === 0)).toBe(true);
    expect(await readSavedVault()).toEqual(original); expect(submitMessage).toHaveBeenCalledOnce();
  });

  it('checks authorization after passkey enrollment and preserves the previous wrapper if the signer is now revoked', async () => {
    const { session } = await connect();
    await session.saveToDevice('synthetic-device-password'); const original = await readSavedVault();
    registry.signers = [];
    const result = prfSecret(); vi.mocked(enrollPasskey).mockResolvedValueOnce({ descriptor: descriptor(), prfSecret: result });
    await expect(session.saveToDeviceWithPasskey()).rejects.toThrow('no longer authorized');
    expect(result.every(byte => byte === 0)).toBe(true); expect(await readSavedVault()).toEqual(original);
    expect(submitMessage).toHaveBeenCalledOnce(); session.dispose();
  });

  it('wipes a wrong PRF result without querying authorization or writing to Hypersnap', async () => {
    const { session } = await connect(); await session.saveToDeviceWithPasskey(); session.dispose();
    const beforeReads = vi.mocked(getUser).mock.calls.length;
    const wrong = new Uint8Array(32).fill(26); vi.mocked(evaluatePasskey).mockResolvedValueOnce(wrong);
    await expect(unlockSavedSessionWithPasskey()).rejects.toThrow('Could not unlock');
    expect(wrong.every(byte => byte === 0)).toBe(true); expect(vi.mocked(getUser).mock.calls.length).toBe(beforeReads);
    expect(submitMessage).toHaveBeenCalledOnce();
  });

  it('publishes signed cast-ID quotes and channel parent URLs using the Hypersnap protobuf fields', async () => {
    const { session } = await connect();
    await session.cast('A quote', undefined, { embeds: [{ castId: { fid: 3, hash: target.hash } }, { url: 'https://example.com/photo.png' }], parentUrl: 'https://warpcast.com/~/channel/quilibrium' });
    const encoded = fields(vi.mocked(submitMessage).mock.calls[1][0]);
    const data = fields(encoded.get(1) as Uint8Array);
    const body = fields(data.get(5) as Uint8Array);
    expect(data.get(1)).toBe(1);
    expect(new TextDecoder().decode(body.get(7) as Uint8Array)).toBe('https://warpcast.com/~/channel/quilibrium');
    expect(body.has(3)).toBe(false);
    expect(ed25519.verify(encoded.get(4) as Uint8Array, encoded.get(2) as Uint8Array, hexToBytes(session.publicKey))).toBe(true);
    // Parse a quote on its own because this tiny test reader retains the last
    // occurrence of repeated fields. Embeds use field6, CastId uses field2.
    await session.cast('', undefined, { embeds: [{ castId: { fid: 3, hash: target.hash } }] });
    const quote = fields(fields(fields(vi.mocked(submitMessage).mock.calls[2][0]).get(1) as Uint8Array).get(5) as Uint8Array);
    const quotedId = fields(fields(quote.get(6) as Uint8Array).get(2) as Uint8Array);
    expect(quotedId.get(1)).toBe(3);
    expect(bytesToHex(quotedId.get(2) as Uint8Array)).toBe(target.hash);
    for (const options of [
      { embeds: [{ castId: { fid: 0, hash: target.hash } }] },
      { embeds: [{ castId: { fid: 3, hash: 'bad' } }] },
      { embeds: [{ url: 'https://example.com', castId: target }] },
      { embeds: [{ castId: { ...target, injected: true } }] },
      { parentUrl: 'javascript:alert(1)' }, { parentUrl: 'https://user:password@example.com' },
    ]) await expect(session.cast('Invalid', undefined, options)).rejects.toThrow();
    await expect(session.cast('Ambiguous', target, { parentUrl: 'https://example.com/channel' })).rejects.toThrow('either a reply or a channel');
    expect(submitMessage).toHaveBeenCalledTimes(3);
    session.dispose();
  });

  it('requires a fresh explicit deletion grant and verifies cast ownership before signing CAST_REMOVE', async () => {
    for (const selected of [undefined, FULL_SOCIAL_SCOPES]) {
      const { session } = await connect(selected);
      await expect(session.deleteCast(target)).rejects.toThrow('Approve cast deletion');
      session.dispose();
    }
    const { session, pending } = await connect(FULL_CLIENT_SCOPES);
    expect(pending.request.scopes).toEqual(FULL_CLIENT_SCOPES);
    const beforeWrites = vi.mocked(submitMessage).mock.calls.length;
    await expect(session.deleteCast({ fid: 3, hash: target.hash })).rejects.toThrow('own account');
    await expect(session.deleteCast({ ...target, hash: 'bad' })).rejects.toThrow('Invalid cast hash');
    currentCast = { ...currentCast!, author: { ...user, fid: 3 } };
    await expect(session.deleteCast(target)).rejects.toThrow('did not confirm');
    currentCast = { ...currentCast!, author: user, hash: `0x${'cd'.repeat(20)}` };
    await expect(session.deleteCast(target)).rejects.toThrow('did not confirm');
    expect(submitMessage).toHaveBeenCalledTimes(beforeWrites);
    currentCast = { ...currentCast!, hash: `0x${target.hash}` };
    const receipt = await session.deleteCast({ ...target, hash: `0x${target.hash.toUpperCase()}` });
    const encoded = fields(vi.mocked(submitMessage).mock.calls.at(-1)![0]);
    const data = fields(encoded.get(1) as Uint8Array);
    expect(data.get(1)).toBe(2); expect(data.get(2)).toBe(user.fid);
    expect(bytesToHex(fields(data.get(6) as Uint8Array).get(1) as Uint8Array)).toBe(target.hash);
    expect(receipt.hash).toBe(bytesToHex(encoded.get(2) as Uint8Array));
    expect(ed25519.verify(encoded.get(4) as Uint8Array, encoded.get(2) as Uint8Array, hexToBytes(session.publicKey))).toBe(true);
    expect(currentCast).toBeUndefined();
    session.dispose();
  });

  it('does not report a mempool-acknowledged deletion as complete until the cast is visibly absent', async () => {
    const { session } = await connect(FULL_CLIENT_SCOPES);
    vi.useFakeTimers();
    vi.mocked(submitMessage).mockResolvedValueOnce({});
    let finished = false;
    const deleting = session.deleteCast(target).then(receipt => { finished = true; return receipt; });
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);
    await expect(session.deleteCast(target)).rejects.toThrow('already being checked');
    currentCast = undefined;
    await vi.advanceTimersByTimeAsync(1500);
    expect((await deleting).hash).toMatch(/^[a-f0-9]{40}$/);
    expect(submitMessage).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it('quarantines uncertain cast removals and only reconciles subsequent checks without replaying the write', async () => {
    const { session } = await connect(FULL_CLIENT_SCOPES);
    vi.mocked(submitMessage).mockRejectedValueOnce(new ApiError('Submission unknown.', 502, 'submission_unknown'));
    await expect(session.deleteCast(target)).rejects.toMatchObject({ code: 'submission_unknown' });
    expect(submitMessage).toHaveBeenCalledTimes(2);
    vi.mocked(getCast).mockRejectedValueOnce(new ApiError('Proxy route missing.', 404, 'upstream_error'));
    await expect(session.deleteCast(target)).rejects.toMatchObject({ code: 'submission_unknown' });
    currentCast = undefined;
    expect((await session.deleteCast(target)).hash).toMatch(/^[a-f0-9]{40}$/);
    expect(submitMessage).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it('preserves deletion quarantine after an unclassified transport error and permits a fresh attempt only after a definite rejection', async () => {
    const { session } = await connect(FULL_CLIENT_SCOPES);
    vi.mocked(submitMessage).mockRejectedValueOnce(new ApiError('Rate limit.', 429, 'rate_limited'));
    await expect(session.deleteCast(target)).rejects.toMatchObject({ code: 'rate_limited' });
    vi.mocked(submitMessage).mockRejectedValueOnce(new Error('Connection closed.'));
    await expect(session.deleteCast(target)).rejects.toMatchObject({ code: 'submission_unknown' });
    currentCast = undefined;
    await session.deleteCast(target);
    expect(submitMessage).toHaveBeenCalledTimes(3); // KEY_ADD and two explicitly requested attempts.
    session.dispose();
  });

  it('bounds deletion confirmation and preserves its original receipt for a later read-only check', async () => {
    const { session } = await connect(FULL_CLIENT_SCOPES);
    vi.useFakeTimers();
    vi.mocked(submitMessage).mockResolvedValueOnce({});
    const deleting = expect(session.deleteCast(target)).rejects.toMatchObject({ code: 'submission_unknown' });
    await vi.advanceTimersByTimeAsync(45_000);
    await deleting;
    expect(submitMessage).toHaveBeenCalledTimes(2);
    currentCast = undefined;
    await session.deleteCast(target);
    expect(submitMessage).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it('rechecks active deletion authorization and rejects revoked, expired or changed-custody device keys', async () => {
    const { session } = await connect(FULL_CLIENT_SCOPES);
    registry.signers[0].scopes = registry.signers[0].scopes!.filter(scope => scope !== 'MESSAGE_TYPE_CAST_REMOVE');
    await expect(session.deleteCast(target)).rejects.toThrow('no longer authorized');
    registry.signers[0].scopes!.splice(1, 0, 'MESSAGE_TYPE_CAST_REMOVE');
    registry.signers[0].expiresAt = 1;
    await expect(session.deleteCast(target)).rejects.toThrow('no longer authorized');
    registry.signers[0].expiresAt = Math.floor(Date.now() / 1000) + 604800;
    currentProfile = { ...user, custody_address: `0x${'ff'.repeat(20)}` };
    await expect(session.deleteCast(target)).rejects.toThrow('no longer authorized');
    expect(submitMessage).toHaveBeenCalledOnce();
    session.dispose();
    await expect(session.deleteCast(target)).rejects.toThrow('session has ended');
  });

  it('enables social writes only after a separately approved expanded-scope KEY_ADD', async () => {
    const { session, pending } = await connect(FULL_SOCIAL_SCOPES);
    expect(pending.request.scopes).toEqual([1, 3, 4, 5, 6, 11]);
    expect(session.scopes).toEqual(FULL_SOCIAL_SCOPES);
    expect(Object.isFrozen(session.scopes)).toBe(true);
    expect(Array.from(fields(fields(fields(vi.mocked(submitMessage).mock.calls[0][0]).get(1) as Uint8Array).get(19) as Uint8Array).get(9) as Uint8Array)).toEqual(FULL_SOCIAL_SCOPES);
    await session.follow(3);
    await session.follow(3, true);
    const add = fields(fields(vi.mocked(submitMessage).mock.calls[1][0]).get(1) as Uint8Array);
    const remove = fields(fields(vi.mocked(submitMessage).mock.calls[2][0]).get(1) as Uint8Array);
    expect(add.get(1)).toBe(5); expect(remove.get(1)).toBe(6);
    expect(new TextDecoder().decode(fields(add.get(14) as Uint8Array).get(1) as Uint8Array)).toBe('follow');
    expect(fields(add.get(14) as Uint8Array).get(3)).toBe(3);
    expect(Number(remove.get(3))).toBeGreaterThan(Number(add.get(3)));
    const result = await session.updateProfile({ displayName: 'Alice', bio: 'Hello', pfpUrl: 'https://example.com/avatar.png' });
    expect(result).toEqual({ saved: ['displayName', 'bio', 'pfpUrl'] });
    const profileMessages = vi.mocked(submitMessage).mock.calls.slice(3).map(([bytes]) => fields(fields(bytes).get(1) as Uint8Array));
    expect(profileMessages.map(data => data.get(1))).toEqual([11, 11, 11]);
    expect(profileMessages.map(data => fields(data.get(12) as Uint8Array).get(1))).toEqual([2, 3, 1]);
    session.dispose();
  });

  it('blocks a recent offchain KEY_ADD before creating another request while preserving the current session', async () => {
    const { session } = await connect();
    vi.useFakeTimers();
    registry.signers[0].addedAt = Math.floor(Date.now() / 1000) - 20;
    const random = vi.spyOn(crypto, 'getRandomValues');
    try {
      await expect(preparePairing({ fid: session.fid }, { origin: ORIGIN, requestedScopes: FULL_SOCIAL_SCOPES })).rejects.toMatchObject({
        code: 'key_approval_cooldown', status: 429, message: 'Hypersnap allows one device-key approval per minute. Wait 40 seconds, then find your account again. Existing device access is unchanged.',
      });
      expect(random).not.toHaveBeenCalled();
      expect(submitMessage).toHaveBeenCalledOnce();
      await session.cast('The current device remains usable.');
      expect(submitMessage).toHaveBeenCalledTimes(2);
    } finally { random.mockRestore(); session.dispose(); }
  });

  it('uses the latest offchain addition across requesting apps and ignores onchain additions', async () => {
    vi.useFakeTimers();
    const now = Math.floor(Date.now() / 1000);
    registry.signers = [
      { key: 'old-offchain', source: 'SIGNER_SOURCE_OFFCHAIN', addedAt: now - 52 },
      { key: 'other-app', source: 'SIGNER_SOURCE_OFFCHAIN', addedAt: now - 15, requestFid: 999 },
      { key: 'onchain', source: 'SIGNER_SOURCE_ONCHAIN', addedAt: now },
    ];
    await expect(preparePairing({ fid: user.fid }, { origin: ORIGIN })).rejects.toThrow('Wait 45 seconds');
    expect(submitMessage).not.toHaveBeenCalled();
    registry.signers = [{ key: 'onchain', source: 'SIGNER_SOURCE_ONCHAIN', addedAt: now }];
    const pending = await preparePairing({ fid: user.fid }, { origin: ORIGIN });
    expect(pending.request.scopes).toEqual([1, 3, 4]);
    pending.dispose();
  });

  it.each([60, 61])('allows a fresh request once an offchain addition is %i seconds old', async age => {
    vi.useFakeTimers();
    registry.signers = [{ key: 'old-offchain', source: 'SIGNER_SOURCE_OFFCHAIN', addedAt: Math.floor(Date.now() / 1000) - age }];
    const pending = await preparePairing({ fid: user.fid }, { origin: ORIGIN, requestedScopes: FULL_SOCIAL_SCOPES });
    expect(pending.request.scopes).toEqual(FULL_SOCIAL_SCOPES);
    expect(submitMessage).not.toHaveBeenCalled();
    pending.dispose();
  });

  it('keeps older-node timestamp omissions and invalid or future timestamp metadata as node-checked fallbacks', async () => {
    vi.useFakeTimers();
    const now = Math.floor(Date.now() / 1000);
    registry.signers = [
      { key: 'no-timestamp', source: 'SIGNER_SOURCE_OFFCHAIN' },
      { key: 'bad-timestamp', source: 'SIGNER_SOURCE_OFFCHAIN', addedAt: Number.NaN },
      { key: 'negative', source: 'SIGNER_SOURCE_OFFCHAIN', addedAt: -1 },
      { key: 'future', source: 'SIGNER_SOURCE_OFFCHAIN', addedAt: now + 3600 },
    ];
    const pending = await preparePairing({ fid: user.fid }, { origin: ORIGIN });
    expect(pending.request.fid).toBe(user.fid);
    expect(submitMessage).not.toHaveBeenCalled();
    pending.dispose();
  });

  it('does not grant social permissions to existing casting-only keys or unknown scope sets', async () => {
    const { session } = await connect();
    await expect(session.follow(3)).rejects.toThrow('Enable social features');
    expect((await session.updateProfile({ bio: 'Hello' })).failed?.[0].message).toContain('Enable social features');
    expect(submitMessage).toHaveBeenCalledOnce();
    await expect(preparePairing({ fid: 1234 }, { origin: ORIGIN, requestedScopes: [1, 3, 4, 5] })).rejects.toThrow('only approves');
    await expect(preparePairing({ fid: 1234 }, { origin: ORIGIN, requestedScopes: [1, 3, 4, 5, 6, 11, 16] })).rejects.toThrow('only approves');
    session.dispose();
  });

  it('retains expanded permissions in an opt-in vault and checks them again when unlocking', async () => {
    const { session } = await connect(FULL_SOCIAL_SCOPES);
    await session.saveToDevice('synthetic-device-password');
    expect(vi.mocked(writeSavedVault).mock.calls[0][0].metadata.scopes).toEqual(FULL_SOCIAL_SCOPES);
    const unlocked = await unlockSavedSession('synthetic-device-password', { origin: ORIGIN });
    expect(unlocked.scopes).toEqual(FULL_SOCIAL_SCOPES);
    registry.signers[0].scopes = scopes;
    await expect(unlocked.follow(3)).rejects.toThrow('no longer authorized');
    await expect(unlockSavedSession('synthetic-device-password', { origin: ORIGIN })).rejects.toThrow('expired or revoked');
    session.dispose(); unlocked.dispose();
  });

  it('stops partial profile writes and quarantines unknown fields across repeated attempts until visibly confirmed', async () => {
    const { session } = await connect(FULL_SOCIAL_SCOPES);
    vi.mocked(submitMessage).mockImplementationOnce(async envelope => { mergeProfileMessage(envelope); return {}; }).mockRejectedValueOnce(new ApiError('Submission status is unknown', 502, 'submission_unknown'));
    expect(await session.updateProfile({ displayName: 'Alice', bio: 'New bio', pfpUrl: 'https://example.com/avatar.png' })).toEqual({ saved: ['displayName'], failed: [{ field: 'bio', message: 'Submission status is unknown', unknown: true }, { field: 'pfpUrl', message: 'Not submitted because the previous change did not complete.', unknown: false }] });
    expect(submitMessage).toHaveBeenCalledTimes(3);
    await expect(session.updateProfile({ bio: 'New bio' })).rejects.toThrow('unknown status');
    await session.refreshProfile();
    await expect(session.updateProfile({ bio: 'Different bio' })).rejects.toThrow('unknown status');
    currentProfile = { ...currentProfile, profile: { bio: { text: 'New bio' } } };
    await session.refreshProfile();
    expect(await session.updateProfile({ bio: 'Another bio' })).toEqual({ saved: ['bio'] });
    session.dispose();
  });

  it('waits for each profile field to become visible before reporting saved or sending the next field', async () => {
    const { session } = await connect(FULL_SOCIAL_SCOPES);
    vi.useFakeTimers();
    vi.mocked(submitMessage).mockResolvedValueOnce({}); // Mempool ack; no committed name yet.
    let finished = false;
    const saving = session.updateProfile({ displayName: 'Alice', bio: 'Hello' }).then(result => { finished = true; return result; });
    await vi.advanceTimersByTimeAsync(0);
    expect(submitMessage).toHaveBeenCalledTimes(2); // KEY_ADD and the name only.
    expect(finished).toBe(false);
    currentProfile = { ...currentProfile, display_name: 'Alice' };
    await vi.advanceTimersByTimeAsync(1500);
    expect(await saving).toEqual({ saved: ['displayName', 'bio'] });
    expect(submitMessage).toHaveBeenCalledTimes(3);
    expect(currentProfile.profile.bio.text).toBe('Hello');
    session.dispose();
  });

  it('quarantines an acknowledged profile edit when indexing never confirms it and never replays its write', async () => {
    const { session } = await connect(FULL_SOCIAL_SCOPES);
    vi.useFakeTimers();
    vi.mocked(submitMessage).mockResolvedValueOnce({});
    const beforeReads = vi.mocked(getUser).mock.calls.length;
    const saving = session.updateProfile({ bio: 'Not visible', pfpUrl: 'https://example.com/new.png' });
    await vi.advanceTimersByTimeAsync(45_000);
    const result = await saving;
    expect(result.saved).toEqual([]);
    expect(result.failed).toEqual([
      { field: 'bio', message: 'Profile save status is unknown. Check the public profile before editing this field again.', unknown: true },
      { field: 'pfpUrl', message: 'Not submitted because the previous change did not complete.', unknown: false },
    ]);
    expect(vi.mocked(getUser).mock.calls.length - beforeReads).toBeGreaterThan(2);
    expect(submitMessage).toHaveBeenCalledTimes(2);
    await expect(session.updateProfile({ bio: 'Not visible' })).rejects.toThrow('unknown status');
    await session.refreshProfile();
    await expect(session.updateProfile({ bio: 'Different' })).rejects.toThrow('unknown status');
    currentProfile = { ...currentProfile, profile: { bio: { text: 'Not visible' } } };
    await session.refreshProfile();
    expect(await session.updateProfile({ bio: 'Confirmed next edit' })).toEqual({ saved: ['bio'] });
    expect(submitMessage).toHaveBeenCalledTimes(3);
    session.dispose();
  });

  it('bounds a stalled profile confirmation read and treats custody changes or read failures as unknown writes', async () => {
    const { session } = await connect(FULL_SOCIAL_SCOPES);
    vi.useFakeTimers();
    vi.mocked(submitMessage).mockResolvedValueOnce({});
    vi.mocked(getUser).mockImplementationOnce(async () => structuredClone(currentProfile)).mockImplementationOnce(async (_lookup, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
    }));
    const saving = session.updateProfile({ bio: 'Pending' });
    await vi.advanceTimersByTimeAsync(45_000);
    expect((await saving).failed?.[0].unknown).toBe(true);
    expect(submitMessage).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it.each(['custody', 'read-error', 'lock'])('does not claim a profile save after confirmation encounters %s', async failure => {
    const { session } = await connect(FULL_SOCIAL_SCOPES);
    vi.mocked(submitMessage).mockImplementationOnce(async () => {
      if (failure === 'custody') currentProfile = { ...currentProfile, custody_address: `0x${'12'.repeat(20)}` };
      else if (failure === 'read-error') vi.mocked(getUser).mockRejectedValueOnce(new ApiError('Unavailable', 502));
      else session.dispose();
      return {};
    });
    const result = await session.updateProfile({ displayName: 'Alice', bio: 'Never sent' });
    expect(result.saved).toEqual([]);
    expect(result.failed?.[0]).toMatchObject({ field: 'displayName', unknown: true });
    expect(result.failed?.[1]).toMatchObject({ field: 'bio', unknown: false });
    expect(submitMessage).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it('validates the complete profile edit before writing even the first field', async () => {
    const { session } = await connect(FULL_SOCIAL_SCOPES);
    await expect(session.updateProfile({ displayName: 'Fine', bio: '😀'.repeat(65) })).rejects.toThrow('256 UTF-8');
    expect(submitMessage).toHaveBeenCalledOnce();
    session.dispose();
  });

  it('does not replay uncertain follow writes and waits for the requested relationship before another change', async () => {
    const { session } = await connect(FULL_SOCIAL_SCOPES);
    vi.mocked(submitMessage).mockRejectedValueOnce(new ApiError('Unknown', 502, 'submission_unknown'));
    await expect(session.follow(3)).rejects.toThrow('Unknown');
    vi.mocked(getFollowStatus).mockResolvedValue(false);
    await expect(session.follow(3)).rejects.toThrow('unknown status');
    expect(submitMessage).toHaveBeenCalledTimes(2);
    vi.mocked(getFollowStatus).mockResolvedValue(true);
    await session.follow(3, true);
    expect(submitMessage).toHaveBeenCalledTimes(3);
    session.dispose();
  });

  it('encodes real mentions at UTF-8 positions with media and rejects misaligned or unsafe input before submitting', async () => {
    const { session } = await connect();
    await session.cast('😀 hi ', undefined, { mentions: [3], mentionsPositions: [8], embeds: [{ url: 'https://example.com/image.png' }] });
    const data = fields(fields(vi.mocked(submitMessage).mock.calls[1][0]).get(1) as Uint8Array);
    const body = fields(data.get(5) as Uint8Array);
    expect(Array.from(body.get(2) as Uint8Array)).toEqual([3]);
    expect(Array.from(body.get(5) as Uint8Array)).toEqual([8]);
    expect(new TextDecoder().decode(fields(body.get(6) as Uint8Array).get(1) as Uint8Array)).toBe('https://example.com/image.png');
    for (const options of [{ mentions: [3], mentionsPositions: [1] }, { mentions: [3], mentionsPositions: [] }, { mentions: [0], mentionsPositions: [0] }, { mentions: [3], mentionsPositions: [99] }, { embeds: [{ url: 'javascript:alert(1)' }] }, { embeds: Array(3).fill({ url: 'https://example.com/image.png' }) }]) {
      await expect(session.cast('😀 hi ', undefined, options)).rejects.toThrow();
    }
    expect(submitMessage).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it('creates independent random keys and immutable public requests without writes or persistence', async () => {
    const first = await preparePairing({ fid: 1234 }, { origin: ORIGIN });
    const second = await preparePairing({ username: 'test' }, { origin: ORIGIN });
    expect(first.request.publicKey).not.toBe(second.request.publicKey);
    expect(first.request.requestId).not.toBe(second.request.requestId);
    expect(Object.isFrozen(first.request)).toBe(true);
    expect(Object.isFrozen(first.request.scopes)).toBe(true);
    expect(first.request.ttl).toBe(604800);
    expect(first.request.nonce).toBe(5);
    expect(submitMessage).not.toHaveBeenCalled();
    expect(writeSavedVault).not.toHaveBeenCalled();
    expect(Object.keys(first)).toEqual(['request', 'user', 'submitted', 'complete', 'dispose']);
    first.dispose(); second.dispose();
  });

  it('authorizes only a bounded domain-separated media grant with an active casting key and never exposes its signer', async () => {
    const { session } = await connect();
    const grant = await session.authorizeMediaUpload({ origin: ORIGIN, sha256: 'ab'.repeat(32), size: 123, contentType: 'image/png' });
    expect(ed25519.verify(hexToBytes(grant.signature), mediaGrantPayload(grant), hexToBytes(session.publicKey))).toBe(true);
    expect(grant.fid).toBe(user.fid);
    expect(grant.expiresAt - grant.issuedAt).toBe(120);
    expect(submitMessage).toHaveBeenCalledOnce();
    await expect(session.authorizeMediaUpload({ origin: 'https://evil.example', sha256: 'ab'.repeat(32), size: 123, contentType: 'image/png' })).rejects.toThrow('Choose a JPEG');
    registry.signers = [];
    await expect(session.authorizeMediaUpload({ origin: ORIGIN, sha256: 'ab'.repeat(32), size: 123, contentType: 'image/png' })).rejects.toThrow('no longer authorized');
    session.dispose();
    await expect(session.authorizeMediaUpload({ origin: ORIGIN, sha256: 'ab'.repeat(32), size: 123, contentType: 'image/png' })).rejects.toThrow('session has ended');
  });

  it('verifies real synthetic custody signatures and submits scoped KEY_ADD, then waits for confirmed inclusion', async () => {
    const { session, pending } = await connect();
    const envelope = vi.mocked(submitMessage).mock.calls[0][0];
    const decoded = fields(envelope);
    expect(ed25519.verify(decoded.get(4) as Uint8Array, decoded.get(2) as Uint8Array, hexToBytes(session.publicKey))).toBe(true);
    const data = fields(decoded.get(1) as Uint8Array);
    const body = fields(data.get(19) as Uint8Array);
    expect(data.get(1)).toBe(16);
    expect(body.get(5)).toBe(5);
    expect(Array.from(body.get(9) as Uint8Array)).toEqual([1, 3, 4]);
    expect(body.get(10)).toBe(604800);
    expect(getSigners).toHaveBeenCalledTimes(3);
    expect(writeSavedVault).not.toHaveBeenCalled();
    pending.dispose(); // transferred key survives UI cleanup
    await session.cast('Hello Hypersnap');
    const cast = fields(vi.mocked(submitMessage).mock.calls[1][0]);
    expect(bytesToHex(blake3_20(cast.get(7) as Uint8Array))).toBe(bytesToHex(cast.get(2) as Uint8Array));
    expect(ed25519.verify(cast.get(4) as Uint8Array, cast.get(2) as Uint8Array, hexToBytes(session.publicKey))).toBe(true);
    session.dispose();
    await expect(session.cast('After logout')).rejects.toThrow('session has ended');
  });

  it('rejects altered approvals, stale nonces, and custody changes without sending any message', async () => {
    const pending = await preparePairing({ fid: 1234 }, { origin: ORIGIN });
    const approval = approvalFor(pending);
    await expect(pending.complete({ ...approval, requestHash: '00'.repeat(32) })).rejects.toThrow();
    registry.currentUserNonce = 5;
    await expect(pending.complete(approval)).rejects.toThrow('fresh request');
    registry.currentUserNonce = 4;
    vi.mocked(getUser).mockResolvedValueOnce({ ...user, custody_address: `0x${'12'.repeat(20)}` });
    await expect(pending.complete(approval)).rejects.toThrow('custody changed');
    expect(submitMessage).not.toHaveBeenCalled();
    pending.dispose();
  });

  it('retains the approved key after a verified rate rejection and retries only when explicitly requested', async () => {
    const pending = await preparePairing({ fid: 1234 }, { origin: ORIGIN });
    const approval = approvalFor(pending);
    vi.mocked(submitMessage).mockRejectedValueOnce(new ApiError('Rate limit exceeded.', 429, 'rate_limited'));
    await expect(pending.complete(approval)).rejects.toMatchObject({ status: 429, code: 'rate_limited', message: 'Hypersnap allows one new device key per account per minute. Wait at least one minute, then submit this approved key again.' });
    expect(pending.submitted).toBe(false);
    expect(submitMessage).toHaveBeenCalledOnce();
    expect(getSigners).toHaveBeenCalledTimes(2);
    expect(getUser).toHaveBeenCalledTimes(2);
    const session = await pending.complete(approval);
    expect(session.publicKey).toBe(pending.request.publicKey);
    expect(pending.submitted).toBe(true);
    expect(submitMessage).toHaveBeenCalledTimes(2);
    expect(getSigners).toHaveBeenCalledTimes(4);
    expect(getUser).toHaveBeenCalledTimes(4);
    session.dispose();
  });

  it('checks the current nonce before an explicit retry after a verified rate rejection', async () => {
    const pending = await preparePairing({ fid: 1234 }, { origin: ORIGIN });
    const approval = approvalFor(pending);
    vi.mocked(submitMessage).mockRejectedValueOnce(new ApiError('Rate limit exceeded.', 429, 'rate_limited'));
    await expect(pending.complete(approval)).rejects.toThrow('Wait at least one minute');
    registry.currentUserNonce = pending.request.nonce;
    await expect(pending.complete(approval)).rejects.toThrow('fresh request');
    expect(pending.submitted).toBe(false);
    expect(submitMessage).toHaveBeenCalledOnce();
    pending.dispose();
  });

  it('keeps the pending key after unknown submission and subsequent completion performs reads only', async () => {
    const pending = await preparePairing({ fid: 1234 }, { origin: ORIGIN });
    const approval = approvalFor(pending);
    vi.mocked(submitMessage).mockRejectedValueOnce(new Error('Submission status is unknown'));
    await expect(pending.complete(approval)).rejects.toThrow('unknown');
    expect(pending.submitted).toBe(true);
    registry.signers = [{ key: pending.request.publicKey, source: 'SIGNER_SOURCE_OFFCHAIN', scopes, requestFid: 1234, expiresAt: Math.floor(Date.now() / 1000) + 604800 }];
    const session = await pending.complete(approval);
    expect(session.publicKey).toBe(pending.request.publicKey);
    expect(submitMessage).toHaveBeenCalledOnce();
    session.dispose();
  });

  it('accepts posts only while custody and the signer registry remain valid', async () => {
    const { session } = await connect();
    registry.signers[0].expiresAt = 1;
    await expect(session.cast('Expired')).rejects.toThrow('no longer authorized');
    expect(submitMessage).toHaveBeenCalledOnce();
    registry.signers[0].expiresAt = Math.floor(Date.now() / 1000) + 604800;
    await session.react({ fid: 3, hash: 'ab'.repeat(20) }, 'like');
    expect(fields(fields(vi.mocked(submitMessage).mock.calls[1][0]).get(1) as Uint8Array).get(1)).toBe(3);
    await expect(session.cast('😀'.repeat(257))).rejects.toThrow('1,024 UTF-8 bytes');
    await expect(session.react({ fid: 3, hash: 'bad' }, 'recast')).rejects.toThrow('Invalid cast hash');
    session.dispose();
  });

  it('reads reaction status for this session and rejects invalid runtime reaction kinds before reads or writes', async () => {
    const { session } = await connect();
    vi.mocked(getReactionStatus).mockResolvedValue(true);
    expect(await session.reactionStatus({ ...target, hash: `0x${target.hash.toUpperCase()}` }, 'like')).toBe(true);
    expect(getReactionStatus).toHaveBeenCalledWith(session.fid, target, 'like', undefined);
    for (const kind of ['LIKE', '', 'block'] as unknown as Array<'like'>) {
      await expect(session.react(target, kind)).rejects.toThrow('Invalid reaction type');
      await expect(session.reactionStatus(target, kind)).rejects.toThrow('Invalid reaction type');
    }
    expect(getReactionStatus).toHaveBeenCalledOnce();
    expect(submitMessage).toHaveBeenCalledOnce();
    session.dispose();
    await expect(session.reactionStatus(target, 'like')).rejects.toThrow('session has ended');
    expect(getReactionStatus).toHaveBeenCalledOnce();
  });

  it('primes shared reaction status after an acknowledged write, invalidates attempted failures, and reads fresh while uncertain', async () => {
    const { session } = await connect();
    expect(clearReactionStatusCache).toHaveBeenCalled();
    await session.react(target, 'like');
    expect(invalidateReactionStatus).toHaveBeenCalledWith(session.fid, target, 'like');
    expect(primeReactionStatus).toHaveBeenCalledWith(session.fid, target, 'like', true);
    vi.mocked(submitMessage).mockRejectedValueOnce(new ApiError('Unknown.', 504, 'submission_unknown'));
    await expect(session.react(target, 'recast', true)).rejects.toMatchObject({ code: 'submission_unknown' });
    expect(primeReactionStatus).toHaveBeenCalledOnce();
    expect(invalidateReactionStatus).toHaveBeenLastCalledWith(session.fid, target, 'recast');
    expect(await session.reactionStatus(target, 'recast')).toBe(false);
    expect(getReactionStatus).toHaveBeenLastCalledWith(session.fid, target, 'recast', undefined, { fresh: true });
    await session.reactionStatus(target, 'like');
    expect(getReactionStatus).toHaveBeenLastCalledWith(session.fid, target, 'like', undefined);
    vi.mocked(clearReactionStatusCache).mockClear();
    session.dispose();
    expect(clearReactionStatusCache).toHaveBeenCalledOnce();
  });

  it.each([false, true])('keeps an uncertain reaction remove=%s blocked across new view reads until its actual intent is visible', async remove => {
    const { session } = await connect();
    vi.mocked(submitMessage).mockRejectedValueOnce(new ApiError('Submission status is unknown.', 504, 'submission_unknown'));
    await expect(session.react(target, 'like', remove)).rejects.toMatchObject({ code: 'submission_unknown' });
    const attempted = { hash: bytesToHex(fields(vi.mocked(submitMessage).mock.calls[1][0]).get(2) as Uint8Array) };
    const readAfterRemount = session.reactionStatus;
    vi.mocked(getReactionStatus).mockResolvedValue(remove); // Still the old state, before inclusion.
    await expect(readAfterRemount(target, 'like')).rejects.toMatchObject({ code: 'submission_unknown' });
    await expect(session.react(target, 'like', remove)).rejects.toMatchObject({ code: 'submission_unknown' });
    await expect(session.react(target, 'like', !remove)).rejects.toMatchObject({ code: 'submission_unknown' });
    expect(submitMessage).toHaveBeenCalledTimes(2);
    vi.mocked(getReactionStatus).mockResolvedValue(!remove);
    expect(await readAfterRemount(target, 'like')).toBe(!remove);
    expect(await session.react(target, 'like', remove)).toEqual(attempted); // A confirmed repeat is a receipt, not a new write.
    expect(submitMessage).toHaveBeenCalledTimes(2);
    await session.react(target, 'like', !remove);
    expect(submitMessage).toHaveBeenCalledTimes(3);
    expect(fields(fields(vi.mocked(submitMessage).mock.calls[2][0]).get(1) as Uint8Array).get(1)).toBe(remove ? 3 : 4);
    session.dispose();
  });

  it('isolates uncertain reactions by target and kind and does not quarantine definitive or preflight failures', async () => {
    const { session } = await connect();
    vi.mocked(submitMessage).mockRejectedValueOnce(new ApiError('Unknown.', 502, 'submission_unknown'));
    await expect(session.react(target, 'like')).rejects.toMatchObject({ code: 'submission_unknown' });
    await session.react(target, 'recast');
    await session.react({ ...target, hash: 'cd'.repeat(20) }, 'like');
    expect(getReactionStatus).not.toHaveBeenCalled();
    vi.mocked(submitMessage).mockRejectedValueOnce(new ApiError('Rejected.', 400, 'upstream_error'));
    await expect(session.react(target, 'recast', true)).rejects.toMatchObject({ code: 'upstream_error' });
    await session.react(target, 'recast', true);
    vi.mocked(getUser).mockRejectedValueOnce(new ApiError('Read unavailable.', 502, 'submission_unknown'));
    await expect(session.react(target, 'recast')).rejects.toThrow('Read unavailable');
    await session.react(target, 'recast');
    expect(getReactionStatus).not.toHaveBeenCalled();
    await expect(session.react(target, 'like')).rejects.toMatchObject({ code: 'submission_unknown' });
    expect(submitMessage).toHaveBeenCalledTimes(7);
    session.dispose();
  });

  it('allows only one in-flight write for a reaction shared by multiple visible cards', async () => {
    const { session } = await connect();
    let submitted!: () => void; const entered = new Promise<void>(resolve => { submitted = resolve; });
    let complete!: (value: {}) => void;
    vi.mocked(submitMessage).mockImplementationOnce(async () => { submitted(); return new Promise(resolve => { complete = resolve; }); });
    const first = session.react(target, 'like');
    await entered;
    await expect(session.react({ ...target, hash: `0x${target.hash}` }, 'like', true)).rejects.toThrow('already being submitted');
    expect(submitMessage).toHaveBeenCalledTimes(2);
    complete({}); await first;
    session.dispose();
  });

  it('keeps uncertainty after a failed or cancelled read instead of trusting a late response', async () => {
    const { session } = await connect();
    vi.mocked(submitMessage).mockRejectedValueOnce(new ApiError('Unknown.', 504, 'submission_unknown'));
    await expect(session.react(target, 'like')).rejects.toMatchObject({ code: 'submission_unknown' });
    vi.mocked(getReactionStatus).mockRejectedValueOnce(new Error('Read unavailable.'));
    await expect(session.reactionStatus(target, 'like')).rejects.toThrow('Read unavailable');
    let finish!: (value: boolean) => void;
    vi.mocked(getReactionStatus).mockImplementationOnce(async () => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const read = session.reactionStatus(target, 'like', controller.signal);
    const rejected = expect(read).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); finish(true); await rejected;
    await expect(session.react(target, 'like')).rejects.toMatchObject({ code: 'submission_unknown' });
    expect(submitMessage).toHaveBeenCalledTimes(2);
    vi.mocked(getReactionStatus).mockResolvedValue(true);
    expect(await session.reactionStatus(target, 'like')).toBe(true);
    await session.react(target, 'like');
    expect(submitMessage).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it('does not use a read started before an uncertain write to reconcile that later attempt', async () => {
    const { session } = await connect();
    let finish!: (value: boolean) => void;
    vi.mocked(getReactionStatus).mockImplementationOnce(async () => new Promise(resolve => { finish = resolve; }));
    const oldRead = session.reactionStatus(target, 'like');
    const oldRejected = expect(oldRead).rejects.toMatchObject({ code: 'submission_unknown' });
    vi.mocked(submitMessage).mockRejectedValueOnce(new ApiError('Unknown.', 504, 'submission_unknown'));
    await expect(session.react(target, 'like')).rejects.toMatchObject({ code: 'submission_unknown' });
    finish(true); await oldRejected;
    await expect(session.react(target, 'like')).rejects.toMatchObject({ code: 'submission_unknown' });
    expect(submitMessage).toHaveBeenCalledTimes(2);
    vi.mocked(getReactionStatus).mockResolvedValue(true);
    await session.react(target, 'like');
    expect(submitMessage).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it('persists only with explicit encryption opt-in, unlocks against current custody, and keeps vault on signout', async () => {
    const { session } = await connect();
    await expect(session.saveToDevice('short')).rejects.toThrow('12');
    expect(writeSavedVault).not.toHaveBeenCalled();
    await session.saveToDevice('synthetic-device-password');
    const saved = vi.mocked(writeSavedVault).mock.calls[0][0];
    expect(saved.metadata.publicKey).toBe(session.publicKey);
    expect(saved.ciphertext).toHaveLength(96);
    expect(JSON.stringify(saved)).not.toContain('synthetic-device-password');
    session.dispose();
    expect(deleteSavedVault).not.toHaveBeenCalled();
    expect(await hasSavedSession(session.publicKey)).toBe(true);
    expect(await hasSavedSession('00'.repeat(32))).toBe(false);
    const unlocked = await unlockSavedSession('synthetic-device-password', { origin: ORIGIN });
    expect(unlocked.publicKey).toBe(session.publicKey);
    unlocked.dispose();
    registry.signers = [];
    await expect(unlockSavedSession('synthetic-device-password', { origin: ORIGIN })).rejects.toThrow('expired or revoked');
  });

  it('self-revokes with app nonce and verifies actual removal before deleting the matching vault', async () => {
    const { session } = await connect();
    await session.saveToDevice('synthetic-device-password');
    await session.revoke();
    const decoded = fields(vi.mocked(submitMessage).mock.calls[1][0]);
    const data = fields(decoded.get(1) as Uint8Array);
    const remove = fields(data.get(20) as Uint8Array);
    expect(data.get(1)).toBe(17);
    expect(remove.get(3)).toBe(2);
    expect(remove.get(5)).toBe(9); // app namespace, not custody nonce
    expect(ed25519.verify(decoded.get(4) as Uint8Array, decoded.get(2) as Uint8Array, hexToBytes(session.publicKey))).toBe(true);
    expect(deleteSavedVault).toHaveBeenCalledOnce();
    await expect(session.cast('Revoked')).rejects.toThrow('session has ended');
  });

  it('does not retry uncertain revocation or destroy its recovery key', async () => {
    const { session } = await connect();
    vi.mocked(submitMessage).mockRejectedValueOnce(new Error('Submission status is unknown'));
    await expect(session.revoke()).rejects.toThrow('unknown');
    expect(deleteSavedVault).not.toHaveBeenCalled();
    registry.signers = [];
    await session.revoke();
    expect(submitMessage).toHaveBeenCalledTimes(2); // KEY_ADD plus one KEY_REMOVE
  });

  it('does not mistake an expired registry record for a confirmed revocation', async () => {
    const { session } = await connect();
    registry.signers[0].expiresAt = 1;
    vi.mocked(submitMessage).mockResolvedValueOnce({}); // node has not merged removal
    const controller = new AbortController();
    let reads = 0;
    vi.mocked(getSigners).mockImplementation(async () => {
      if (++reads === 2) controller.abort();
      return structuredClone(registry);
    });
    await expect(session.revoke({ signal: controller.signal })).rejects.toThrow('cancelled');
    expect(deleteSavedVault).not.toHaveBeenCalled();
    expect(registry.signers).toHaveLength(1);
    session.dispose();
  });

  it('rejects wrong returned identities and never submits after pending disposal', async () => {
    vi.mocked(getUser).mockResolvedValueOnce({ ...user, fid: 4321 });
    await expect(preparePairing({ fid: 1234 }, { origin: ORIGIN })).rejects.toThrow('different identity');
    const pending = await preparePairing({ fid: 1234 }, { origin: ORIGIN });
    const approval = approvalFor(pending);
    pending.dispose();
    await expect(pending.complete(approval)).rejects.toThrow('request has ended');
    expect(submitMessage).not.toHaveBeenCalled();
  });

  it('delegates matching-key deletion atomically and can explicitly forget corrupt vaults', async () => {
    vi.mocked(readSavedVault).mockResolvedValue({ corrupt: true });
    expect(await hasSavedSession()).toBe(true);
    await deleteSavedSession('ab'.repeat(32));
    expect(deleteSavedVault).toHaveBeenLastCalledWith('ab'.repeat(32));
    await deleteSavedSession();
    expect(deleteSavedVault).toHaveBeenLastCalledWith(undefined);
    expect(deleteSavedVault).toHaveBeenCalledTimes(2);
  });

  it('uses offline custody-approved revocation when the live node omits app nonces', async () => {
    const { session } = await connect();
    delete registry.requesterFidNonces;
    await expect(session.revoke()).rejects.toThrow('usable signer nonce');
    expect(submitMessage).toHaveBeenCalledOnce();
    const pending = await session.prepareRevocation();
    expect(pending.request.nonce).toBe(6); // KEY_ADD advanced the custody namespace
    expect(pending.submitted).toBe(false);
    expect(Object.isFrozen(pending.request)).toBe(true);
    await pending.complete(revocationApprovalFor(pending));
    const decoded = fields(vi.mocked(submitMessage).mock.calls[1][0]);
    const data = fields(decoded.get(1) as Uint8Array);
    const body = fields(data.get(20) as Uint8Array);
    expect(data.get(1)).toBe(17);
    expect(body.get(3)).toBe(1);
    expect(body.get(5)).toBe(6);
    expect((body.get(2) as Uint8Array).length).toBe(65);
    expect(ed25519.verify(decoded.get(4) as Uint8Array, decoded.get(2) as Uint8Array, hexToBytes(session.publicKey))).toBe(true);
    expect(pending.submitted).toBe(true);
    await expect(session.cast('Revoked')).rejects.toThrow('session has ended');
    pending.dispose();
  });

  it('rejects mismatched or stale offline revocation approvals before writing', async () => {
    const { session } = await connect();
    const pending = await session.prepareRevocation();
    const approval = revocationApprovalFor(pending);
    await expect(pending.complete({ ...approval, requestHash: '00'.repeat(32) })).rejects.toThrow();
    registry.currentUserNonce = 6;
    await expect(pending.complete(approval)).rejects.toThrow('fresh revocation request');
    expect(pending.submitted).toBe(false);
    expect(submitMessage).toHaveBeenCalledOnce();
    pending.dispose();
    await expect(pending.complete(approval)).rejects.toThrow('request has ended');
    session.dispose();
  });

  it('resumes unknown offline revocation using only reads even after its modal closes', async () => {
    const { session } = await connect();
    const first = await session.prepareRevocation();
    vi.mocked(submitMessage).mockRejectedValueOnce(new Error('Submission status is unknown'));
    await expect(first.complete(revocationApprovalFor(first))).rejects.toThrow('unknown');
    expect(first.submitted).toBe(true);
    first.dispose();
    const recovered = await session.prepareRevocation();
    expect(recovered.submitted).toBe(true);
    registry.signers = [];
    await recovered.complete();
    expect(submitMessage).toHaveBeenCalledTimes(2);
    expect(deleteSavedVault).not.toHaveBeenCalled(); // ephemeral key had no saved vault
  });

  it('retries failed local cleanup after confirmed offline revocation without another submission', async () => {
    const { session } = await connect();
    await session.saveToDevice('synthetic-device-password');
    const pending = await session.prepareRevocation();
    vi.mocked(deleteSavedVault).mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(pending.complete(revocationApprovalFor(pending))).rejects.toThrow('Revocation is confirmed on Hypersnap');
    expect(pending.submitted).toBe(true);
    expect(registry.signers).toHaveLength(0);
    await pending.complete();
    expect(submitMessage).toHaveBeenCalledTimes(2);
    expect(deleteSavedVault).toHaveBeenCalledTimes(2);
    await expect(session.cast('Revoked')).rejects.toThrow('session has ended');
  });

  it('clears an already removed key using read-only confirmation without custody import', async () => {
    const { session } = await connect();
    registry.signers = [];
    const pending = await session.prepareRevocation();
    expect(pending.submitted).toBe(true);
    await pending.complete();
    expect(submitMessage).toHaveBeenCalledOnce();
    await expect(session.cast('Revoked')).rejects.toThrow('session has ended');
  });

  it('waits for a committing save before clearing its vault after revocation', async () => {
    const { session } = await connect();
    let releaseWrite!: () => void;
    let writeStarted!: () => void;
    const started = new Promise<void>(resolve => { writeStarted = resolve; });
    const blocked = new Promise<void>(resolve => { releaseWrite = resolve; });
    vi.mocked(writeSavedVault).mockImplementationOnce(async vault => {
      writeStarted();
      await blocked;
      vi.mocked(readSavedVault).mockResolvedValue(vault);
    });
    const saving = session.saveToDevice('synthetic-device-password');
    // Attach the rejection handler before a concurrent revocation invalidates it.
    const rejectedSave = expect(saving).rejects.toThrow('session has ended');
    await started;
    const pending = await session.prepareRevocation();
    const revoking = pending.complete(revocationApprovalFor(pending));
    await vi.waitFor(() => expect(submitMessage).toHaveBeenCalledTimes(2));
    expect(deleteSavedVault).not.toHaveBeenCalled();
    releaseWrite();
    await rejectedSave;
    await revoking;
    expect(deleteSavedVault).toHaveBeenCalledOnce();
    await expect(session.cast('Revoked')).rejects.toThrow('session has ended');
  });

  it('removes a save that commits after the session was disposed', async () => {
    const { session } = await connect();
    let releaseWrite!: () => void;
    let writeStarted!: () => void;
    const started = new Promise<void>(resolve => { writeStarted = resolve; });
    const blocked = new Promise<void>(resolve => { releaseWrite = resolve; });
    vi.mocked(writeSavedVault).mockImplementationOnce(async vault => {
      writeStarted();
      await blocked;
      vi.mocked(readSavedVault).mockResolvedValue(vault);
    });
    const saving = session.saveToDevice('synthetic-device-password');
    const rejectedSave = expect(saving).rejects.toThrow('session has ended');
    await started;
    session.dispose();
    releaseWrite();
    await rejectedSave;
    expect(deleteSavedVault).toHaveBeenCalledOnce();
  });
});
