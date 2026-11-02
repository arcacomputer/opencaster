import { ed25519 } from '@noble/curves/ed25519.js';
import type { getUser, getSigners, submitMessage, Signer, SignersResponse, User } from '@opencaster/client-core/api';
import { APP_ORIGIN } from '@opencaster/client-core/appOrigins';
import {
  FARCASTER_EPOCH_SECONDS, PAIRING_SCOPES, PAIRING_TTL_SECONDS, PAIRING_WINDOW_SECONDS,
  validatePairingRequest, validatePairingApproval, verifyPairingApproval,
  validateRevocationRequest, validateRevocationApproval, verifyRevocationApproval,
  type PairingRequest, type RevocationRequest,
} from '@opencaster/client-core/pairing';
import { buildSignedMessage, MessageType, SignatureScheme, type MessageDataInput } from '@opencaster/protocol/messageBuilder';
import { abiEncodeSignedKeyRequestMetadata, bytesToHex, hexToBytes } from '@opencaster/protocol/signedKeyRequest';

export interface ProtectedDeviceStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}

export interface AuthorizationDependencies {
  storage: ProtectedDeviceStorage;
  randomBytes(): Promise<Uint8Array>;
  api: { getUser: typeof getUser; getSigners: typeof getSigners; submitMessage: typeof submitMessage };
  now?: () => number;
}

type Stage = 'prepared' | 'registering' | 'registered' | 'revoke-prepared' | 'revoking';
interface DeviceRecord {
  version: 1;
  seed: string;
  request: PairingRequest;
  stage: Stage;
  revocation?: RevocationRequest;
}

export interface AuthorizationSnapshot {
  phase: 'locked' | 'empty' | Stage;
  busy: boolean;
  authorized: boolean;
  request?: PairingRequest;
  revocation?: RevocationRequest;
  error: string | null;
  notice: string | null;
}

const SCOPE_NAMES = ['MESSAGE_TYPE_CAST_ADD', 'MESSAGE_TYPE_REACTION_ADD', 'MESSAGE_TYPE_REACTION_REMOVE'];
const MAX_RECORD_BYTES = 2048;
const MAX_APPROVAL_BYTES = 16_384;

class AuthorizationError extends Error {}
function fail(message: string): never { throw new AuthorizationError(message); }
function nonceAfter(nonce: number): number {
  if (!Number.isInteger(nonce) || nonce < 0 || nonce >= 0xffffffff) fail('The node did not return a usable authorization nonce.');
  return nonce + 1;
}
function custody(user: User): string {
  if (!Number.isSafeInteger(user.fid) || user.fid < 1 || user.fid > 0xffffffff || !/^0x[0-9a-fA-F]{40}$/.test(user.custody_address)) fail('This identity has no usable custody wallet.');
  return user.custody_address.toLowerCase();
}
function findSigner(registry: SignersResponse, key: string): Signer | undefined {
  return registry.signers.find(signer => typeof signer.key === 'string' && signer.key.replace(/^0x/i, '').toLowerCase() === key);
}
function assertSigner(signer: Signer | undefined, request: PairingRequest, now: number): void {
  if (!signer || signer.source !== 'SIGNER_SOURCE_OFFCHAIN' || signer.requestFid !== request.fid
    || !Number.isSafeInteger(signer.expiresAt) || Number(signer.expiresAt) <= Math.floor(now / 1000) + 30
    || !Array.isArray(signer.scopes) || signer.scopes.length !== SCOPE_NAMES.length
    || !SCOPE_NAMES.every(scope => signer.scopes!.includes(scope))) {
    fail('The node has not confirmed this exact unexpired device authorization. Access remains locked; check status or revoke the device.');
  }
}
function parseApproval(text: string): unknown {
  if (new TextEncoder().encode(text).length > MAX_APPROVAL_BYTES) fail('Approval files must be at most 16 KiB.');
  try { return JSON.parse(text); } catch { fail('Choose a public approval JSON file from the separate signer.'); }
}
function decodeRecord(text: string, now: number): DeviceRecord {
  if (new TextEncoder().encode(text).length > MAX_RECORD_BYTES) fail('The protected device record is invalid. Forget it before reconnecting.');
  try {
    const value = JSON.parse(text) as DeviceRecord;
    const keys = Object.keys(value).sort().join(',');
    if (keys !== 'request,seed,stage,version' && keys !== 'request,revocation,seed,stage,version') throw new Error();
    if (value.version !== 1 || typeof value.seed !== 'string' || !/^[0-9a-f]{64}$/.test(value.seed)
      || !['prepared', 'registering', 'registered', 'revoke-prepared', 'revoking'].includes(value.stage)
      || !Number.isSafeInteger(value.request?.createdAt) || value.request.createdAt > Math.floor(now / 1000) + 60) throw new Error();
    // Historical requests remain inspectable after expiry; submission revalidates against now.
    const request = validatePairingRequest(value.request, value.request.createdAt * 1000);
    if (request.origin !== APP_ORIGIN || request.fid > 0xffffffff || request.scopes.join(',') !== PAIRING_SCOPES.join(',')) throw new Error();
    const seed = hexToBytes(value.seed);
    try { if (bytesToHex(ed25519.getPublicKey(seed)) !== request.publicKey) throw new Error(); }
    finally { seed.fill(0); }
    const removing = value.stage === 'revoke-prepared' || value.stage === 'revoking';
    if (removing !== (value.revocation !== undefined)) throw new Error();
    const revocation = removing ? validateRevocationRequest(value.revocation, value.revocation!.createdAt * 1000) : undefined;
    if (revocation && (revocation.fid !== request.fid || revocation.publicKey !== request.publicKey
      || revocation.custodyAddress !== request.custodyAddress || revocation.origin !== APP_ORIGIN
      || revocation.createdAt > Math.floor(now / 1000) + 60)) throw new Error();
    return { version: 1, seed: value.seed, request, stage: value.stage, ...(revocation ? { revocation } : {}) };
  } catch { fail('The protected device record is invalid. Forget it before reconnecting.'); }
}

export class DeviceAuthorization {
  private record: DeviceRecord | undefined;
  private generation = 0;
  private controller: AbortController | undefined;
  private listeners = new Set<() => void>();
  private snapshot: AuthorizationSnapshot = { phase: 'locked', busy: false, authorized: false, error: null, notice: null };
  private readonly now: () => number;

  constructor(private readonly dependencies: AuthorizationDependencies) { this.now = dependencies.now ?? Date.now; }
  getSnapshot = (): AuthorizationSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private publish(update: Partial<AuthorizationSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of this.listeners) listener();
  }
  private showRecord(record: DeviceRecord, authorized = false): void {
    this.record = record;
    this.publish({ phase: record.stage, authorized, request: { ...record.request, scopes: [...record.request.scopes] }, revocation: record.revocation ? { ...record.revocation } : undefined });
  }
  private check(generation: number): void {
    if (generation !== this.generation || this.controller?.signal.aborted) fail('The operation was cancelled or the app was locked. Unlock to check its status.');
  }
  private async operation(work: (generation: number, signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.snapshot.busy) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ busy: true, error: null, notice: null });
    try { await work(generation, controller.signal); }
    catch (error) {
      if (generation === this.generation) this.publish({ error: error instanceof AuthorizationError ? error.message : 'This operation could not be completed. No success is assumed. Check the connection and retry the indicated status or approval action.' });
    } finally {
      if (this.controller === controller) this.controller = undefined;
      this.publish({ busy: false });
    }
  }
  private async save(record: DeviceRecord, generation: number): Promise<void> {
    this.check(generation);
    const serialized = JSON.stringify(record);
    if (new TextEncoder().encode(serialized).length > MAX_RECORD_BYTES) fail('This device record exceeds the protected storage limit.');
    try { await this.dependencies.storage.write(serialized); }
    catch {
      this.lock();
      this.publish({ error: 'Protected storage could not be updated. No network request was started by this step. Unlock to inspect the saved state.' });
      fail('Protected storage failed.');
    }
    this.check(generation);
    this.showRecord(record);
  }
  private async fresh(request: PairingRequest, generation: number, signal: AbortSignal): Promise<SignersResponse> {
    const [user, registry] = await Promise.all([
      this.dependencies.api.getUser({ fid: request.fid }, signal),
      this.dependencies.api.getSigners(request.fid, signal),
    ]);
    this.check(generation);
    if (user.fid !== request.fid || custody(user) !== request.custodyAddress) fail('Current custody differs from this saved device. Use the current custody wallet to recover access; local forgetting is not revocation.');
    return registry;
  }
  private assertCapacity(registry: SignersResponse): void {
    if (registry.gaslessSignerLimit !== undefined && registry.gaslessSignerCount !== undefined
      && registry.gaslessSignerCount >= registry.gaslessSignerLimit) fail('This identity has reached its device-key limit. Revoke an unused key first.');
    const now = Math.floor(this.now() / 1000);
    if (registry.signers.some(signer => signer.source === 'SIGNER_SOURCE_OFFCHAIN' && Number.isSafeInteger(signer.addedAt)
      && Number(signer.addedAt) <= now && Number(signer.addedAt) + 60 > now)) fail('Hypersnap allows one new device key per minute. Wait before creating or submitting another approval.');
  }
  private current(): DeviceRecord {
    if (!this.record) fail('Unlock the saved device first.');
    return this.record;
  }
  private async envelope(record: DeviceRecord, data: MessageDataInput): Promise<Uint8Array> {
    const seed = hexToBytes(record.seed);
    try {
      const { envelope } = await buildSignedMessage(data, {
        scheme: SignatureScheme.ED25519, publicKey: hexToBytes(record.request.publicKey),
        sign: async digest => ed25519.sign(digest, seed),
      });
      return envelope;
    } finally { seed.fill(0); }
  }

  lock = (): void => {
    this.generation++;
    this.controller?.abort();
    this.record = undefined;
    this.publish({ phase: 'locked', authorized: false, request: undefined, revocation: undefined, error: null, notice: null });
  };

  unlock = (): Promise<void> => this.operation(async (generation, signal) => {
    const saved = await this.dependencies.storage.read();
    this.check(generation);
    if (!saved) { this.record = undefined; this.publish({ phase: 'empty', authorized: false, request: undefined, revocation: undefined }); return; }
    const record = decodeRecord(saved, this.now());
    this.showRecord(record);
    const registry = await this.fresh(record.request, generation, signal);
    if (record.stage === 'registered') {
      assertSigner(findSigner(registry, record.request.publicKey), record.request, this.now());
      this.publish({ authorized: true });
    }
  });

  prepare = (reviewed: { fid: number; custodyAddress: string }): Promise<void> => this.operation(async (generation, signal) => {
    if (await this.dependencies.storage.read()) fail('A saved device already exists. Unlock it or explicitly forget it before creating another.');
    this.check(generation);
    const user = await this.dependencies.api.getUser({ fid: reviewed.fid }, signal);
    this.check(generation);
    if (user.fid !== reviewed.fid || custody(user) !== reviewed.custodyAddress.toLowerCase()) fail('The identity changed since your review. Look it up again.');
    const registry = await this.dependencies.api.getSigners(user.fid, signal);
    this.check(generation);
    this.assertCapacity(registry);
    const nonce = nonceAfter(registry.currentUserNonce);
    const seed = await this.dependencies.randomBytes();
    try {
      this.check(generation);
      if (!(seed instanceof Uint8Array) || seed.length !== 32) fail('Native secure randomness is unavailable.');
      const requestId = await this.dependencies.randomBytes();
      this.check(generation);
      if (!(requestId instanceof Uint8Array) || requestId.length !== 32) fail('Native secure randomness is unavailable.');
      const createdAt = Math.floor(this.now() / 1000);
      const request = validatePairingRequest({
        kind: 'arca.hypersnap.signer.request', version: 1, origin: APP_ORIGIN,
        requestId: bytesToHex(requestId), createdAt, fid: user.fid, custodyAddress: custody(user),
        publicKey: bytesToHex(ed25519.getPublicKey(seed)), scopes: [...PAIRING_SCOPES], ttl: PAIRING_TTL_SECONDS,
        nonce, deadline: createdAt - FARCASTER_EPOCH_SECONDS + PAIRING_WINDOW_SECONDS,
      }, this.now());
      await this.save({ version: 1, seed: bytesToHex(seed), request, stage: 'prepared' }, generation);
    } finally { seed.fill(0); }
  });

  approve = (text: string): Promise<void> => this.operation(async (generation, signal) => {
    const record = this.current();
    if (record.stage !== 'prepared') fail('This request cannot be submitted. Use Check authorization status instead.');
    let approval;
    try { approval = validatePairingApproval(parseApproval(text)); verifyPairingApproval(record.request, approval, this.now()); }
    catch { fail('This approval is invalid, expired or for another device/wallet. No request was submitted.'); }
    const registry = await this.fresh(record.request, generation, signal);
    if (nonceAfter(registry.currentUserNonce) !== record.request.nonce) fail('The custody nonce changed. Cancel this unsubmitted request and create a fresh approval.');
    this.assertCapacity(registry);
    const request = record.request;
    const metadata = abiEncodeSignedKeyRequestMetadata({ requestFid: request.fid, requestSigner: request.custodyAddress, signature: hexToBytes(approval.requestSignature), deadline: request.deadline });
    const envelope = await this.envelope(record, {
      type: MessageType.KEY_ADD, fid: request.fid,
      body: { keyAddBody: { key: hexToBytes(request.publicKey), custodySignature: hexToBytes(approval.custodySignature),
        deadline: request.deadline, nonce: request.nonce, metadata, scopes: [...PAIRING_SCOPES], ttl: PAIRING_TTL_SECONDS } },
    });
    this.check(generation);
    verifyPairingApproval(request, approval, this.now());
    await this.save({ ...record, stage: 'registering' }, generation);
    this.check(generation);
    try { await this.dependencies.api.submitMessage(envelope, signal); }
    catch { fail('Authorization submission has unknown status. Check authorization status; this key will not be submitted again.'); }
    this.check(generation);
    await this.confirmRegistration(generation, signal);
  });

  private async confirmRegistration(generation: number, signal: AbortSignal): Promise<void> {
    const record = this.current();
    const registry = await this.fresh(record.request, generation, signal);
    assertSigner(findSigner(registry, record.request.publicKey), record.request, this.now());
    await this.save({ ...record, stage: 'registered' }, generation);
    this.publish({ authorized: true, notice: 'The node confirms this scoped device key. Protocol permissions are separate from store distribution signing.' });
  }
  checkAuthorization = (): Promise<void> => this.operation(async (generation, signal) => {
    if (!['registering', 'registered'].includes(this.current().stage)) fail('No submitted authorization is awaiting confirmation.');
    this.publish({ authorized: false });
    await this.confirmRegistration(generation, signal);
  });

  prepareRevocation = (): Promise<void> => this.operation(async (generation, signal) => {
    const record = this.current();
    if (!['registered', 'registering', 'revoke-prepared'].includes(record.stage)) fail('Check the pending authorization or revocation status first.');
    const registry = await this.fresh(record.request, generation, signal);
    const signer = findSigner(registry, record.request.publicKey);
    // An unknown KEY_ADD can still arrive later; absence is not cancellation proof.
    if (!signer && record.stage === 'registering') fail('Registration is still unknown. Check authorization status before revoking or explicitly forget the local key.');
    if (!signer) { await this.finishRevocation(generation); return; }
    if (signer.source !== 'SIGNER_SOURCE_OFFCHAIN' || signer.requestFid !== record.request.fid) fail('The node returned different signer ownership.');
    const requestId = await this.dependencies.randomBytes();
    this.check(generation);
    if (requestId.length !== 32) fail('Native secure randomness is unavailable.');
    const createdAt = Math.floor(this.now() / 1000);
    const revocation = validateRevocationRequest({
      kind: 'arca.hypersnap.signer.revoke.request', version: 1, origin: APP_ORIGIN,
      requestId: bytesToHex(requestId), createdAt, fid: record.request.fid, custodyAddress: record.request.custodyAddress,
      publicKey: record.request.publicKey, nonce: nonceAfter(registry.currentUserNonce),
      deadline: createdAt - FARCASTER_EPOCH_SECONDS + PAIRING_WINDOW_SECONDS,
    }, this.now());
    await this.save({ ...record, stage: 'revoke-prepared', revocation }, generation);
  });

  approveRevocation = (text: string): Promise<void> => this.operation(async (generation, signal) => {
    const record = this.current();
    if (record.stage !== 'revoke-prepared' || !record.revocation) fail('Create a revocation request first.');
    const request = record.revocation;
    let approval;
    try { approval = validateRevocationApproval(parseApproval(text)); verifyRevocationApproval(request, approval, this.now()); }
    catch { fail('This revocation approval is invalid, expired or for another device/wallet. Nothing was submitted.'); }
    const registry = await this.fresh(record.request, generation, signal);
    const signer = findSigner(registry, request.publicKey);
    if (!signer) { await this.finishRevocation(generation); return; }
    if (signer.source !== 'SIGNER_SOURCE_OFFCHAIN' || signer.requestFid !== request.fid) fail('The node returned different signer ownership.');
    if (nonceAfter(registry.currentUserNonce) !== request.nonce) fail('The custody nonce changed. Create a fresh revocation request.');
    const envelope = await this.envelope(record, {
      type: MessageType.KEY_REMOVE, fid: request.fid,
      body: { keyRemoveBody: { key: hexToBytes(request.publicKey), signature: hexToBytes(approval.custodySignature), signatureType: 1, deadline: request.deadline, nonce: request.nonce } },
    });
    this.check(generation);
    verifyRevocationApproval(request, approval, this.now());
    await this.save({ ...record, stage: 'revoking' }, generation);
    this.check(generation);
    try { await this.dependencies.api.submitMessage(envelope, signal); }
    catch { fail('Revocation submission has unknown status. Check revocation status; no duplicate removal will be sent.'); }
    this.check(generation);
    await this.confirmRevocation(generation, signal);
  });

  private async finishRevocation(generation: number): Promise<void> {
    this.check(generation);
    try { await this.dependencies.storage.remove(); }
    catch { fail('The node reports this key absent, but protected local storage could not be cleared. Retry status checking to finish cleanup.'); }
    this.check(generation);
    this.record = undefined;
    this.publish({ phase: 'empty', authorized: false, request: undefined, revocation: undefined, notice: 'The node reports this key absent and its protected local copy was removed.' });
  }
  private async confirmRevocation(generation: number, signal: AbortSignal): Promise<void> {
    const record = this.current();
    const registry = await this.fresh(record.request, generation, signal);
    if (findSigner(registry, record.request.publicKey)) fail('Revocation is not yet confirmed. Check status again; expiry alone is not removal.');
    await this.finishRevocation(generation);
  }
  checkRevocation = (): Promise<void> => this.operation(async (generation, signal) => {
    if (this.current().stage !== 'revoking') fail('No submitted revocation is awaiting confirmation.');
    await this.confirmRevocation(generation, signal);
  });

  forget = (): Promise<void> => this.operation(async generation => {
    try { await this.dependencies.storage.remove(); }
    catch { fail('Protected storage could not be removed. This device has not been forgotten.'); }
    this.check(generation);
    this.record = undefined;
    this.publish({ phase: 'empty', authorized: false, request: undefined, revocation: undefined,
      notice: 'Local device credentials were removed. This does not revoke a submitted or registered key on Hypersnap.' });
  });
}
