import { ed25519 } from '@noble/curves/ed25519.js';
import { ApiError, clearReactionStatusCache, getCast, getFollowStatus, getReactionStatus, getSigners, getUser, invalidateReactionStatus, primeReactionStatus, submitMessage, type Signer, type SignersResponse, type User } from '@opencaster/client-core/api';
import { PAIRING_SCOPES, PAIRING_TTL_SECONDS, validatePairingRequest, validatePairingScopes, verifyPairingApproval, validateRevocationRequest, verifyRevocationApproval, type PairingApproval, type PairingRequest, type RevocationRequest, type RevocationApproval } from '@opencaster/client-core/pairing';
import { buildSignedMessage, CastType, farcasterTimestamp, MessageType, ReactionType, SignatureScheme, type MessageDataInput } from '@opencaster/protocol/messageBuilder';
import { abiEncodeSignedKeyRequestMetadata, bytesToHex, hexToBytes } from '@opencaster/protocol/signedKeyRequest';
import { compareAndSwapSavedVault, decryptSignerVault, decryptSignerVaultWithPasskey, deleteSavedVault, encryptSignerVault, encryptSignerVaultWithPasskey, passkeyVault, readSavedVault, savedVaultMethod, validateSignerVault, type SavedSessionMethod, type StoredSignerVault, type VaultMetadata } from './vault';
import { enrollPasskey, evaluatePasskey } from './passkey';
import { profileChanges, type ProfileField, type ProfilePatch, type ProfileUpdateResult } from './social';
import { createMediaUploadGrant, type MediaUploadInput, type MediaUploadGrant } from '@opencaster/client-core/media';
import { APP_ORIGIN } from '@opencaster/client-core/appOrigins';

export const SIGNER_TTL_SECONDS = PAIRING_TTL_SECONDS;
const SIGNER_SCOPE_NAMES: Record<number, string> = { 1: 'MESSAGE_TYPE_CAST_ADD', 2: 'MESSAGE_TYPE_CAST_REMOVE', 3: 'MESSAGE_TYPE_REACTION_ADD', 4: 'MESSAGE_TYPE_REACTION_REMOVE', 5: 'MESSAGE_TYPE_LINK_ADD', 6: 'MESSAGE_TYPE_LINK_REMOVE', 11: 'MESSAGE_TYPE_USER_DATA_ADD' };
const CONFIRMATION_TIMEOUT_MS = 45_000;
const KEY_ADD_COOLDOWN_SECONDS = 60;

export interface CastTarget { fid: number; hash: string }
export interface WriteReceipt { hash: string }
export type CastEmbed = { url: string } | { castId: CastTarget };
export interface CastOptions { embeds?: CastEmbed[]; mentions?: number[]; mentionsPositions?: number[]; parentUrl?: string }
export interface ConnectOptions { signal?: AbortSignal; onProgress?: (stage: string) => void }
export interface PairingOptions extends ConnectOptions { origin: string; requestedScopes?: readonly number[] }
export interface PendingPairing {
  readonly request: PairingRequest;
  readonly user: User;
  readonly submitted: boolean;
  /** After submission this only checks status; it never submits again. */
  complete(approval: PairingApproval, options?: ConnectOptions): Promise<WalletSession>;
  /** Completed sessions own their key; this only clears an untransferred key. */
  dispose(): void;
}
export interface PendingRevocation {
  readonly request: RevocationRequest;
  readonly submitted: boolean;
  /** Approval is required only before the first submission. */
  complete(approval?: RevocationApproval, options?: ConnectOptions): Promise<void>;
  /** Cancels this request without erasing the session's device key. */
  dispose(): void;
}

export interface WalletSession {
  readonly user: User;
  readonly fid: number;
  readonly custodyAddress: string;
  readonly publicKey: string;
  readonly scopes: readonly number[];
  cast(text: string, parent?: CastTarget, options?: CastOptions): Promise<WriteReceipt>;
  /** Removes only this account's cast; resolves after Hypersnap confirms absence. */
  deleteCast(target: CastTarget): Promise<WriteReceipt>;
  react(target: CastTarget, type: 'like' | 'recast', remove?: boolean): Promise<WriteReceipt>;
  /** Read-only; an uncertain reaction stays blocked until its intent is visible. */
  reactionStatus(target: CastTarget, type: 'like' | 'recast', signal?: AbortSignal, options?: { castTimestamp?: string }): Promise<boolean>;
  follow(targetFid: number, remove?: boolean): Promise<WriteReceipt>;
  updateProfile(patch: ProfilePatch): Promise<ProfileUpdateResult>;
  refreshProfile(): Promise<User>;
  authorizeMediaUpload(input: MediaUploadInput): Promise<MediaUploadGrant>;
  /** Explicit opt-in: only the app signer is encrypted. */
  saveToDevice(password: string, options?: ConnectOptions): Promise<void>;
  /** Explicit local wrapping only; this never grants new network permissions. */
  saveToDeviceWithPasskey(options?: ConnectOptions): Promise<void>;
  /** Offline custody approval works even when the node omits app nonces. */
  prepareRevocation(options?: ConnectOptions): Promise<PendingRevocation>;
  /** Self-revoke on Hypersnap, confirm removal, then clear local signer/vault. */
  revoke(options?: ConnectOptions): Promise<void>;
  /** Local sign-out leaves an opted-in encrypted vault available to unlock. */
  dispose(): void;
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Sign-in cancelled.', 'AbortError');
}
function assertFid(fid: number): void {
  if (!Number.isSafeInteger(fid) || fid <= 0 || fid > 0xffffffff) throw new Error('Invalid Farcaster ID.');
}
function hashBytes(hash: string): Uint8Array {
  if (!/^(?:0x)?[0-9a-fA-F]{40}$/.test(hash)) throw new Error('Invalid cast hash.');
  return hexToBytes(hash);
}
function assertHttpsUrl(value: unknown): asserts value is string {
  if (typeof value !== 'string' || new TextEncoder().encode(value).length > 256) throw new Error('Use an HTTPS URL up to 256 UTF-8 bytes.');
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
  } catch { throw new Error('Use an HTTPS URL up to 256 UTF-8 bytes.'); }
}
function nonceAfter(value: number | undefined): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) >= 0xffffffff) throw new Error('The node did not return a usable signer nonce. Please try again later.');
  return Number(value) + 1;
}
function custodyAddress(user: User): string {
  assertFid(user.fid);
  if (!/^0x[0-9a-fA-F]{40}$/.test(user.custody_address)) throw new Error('This identity has no usable custody wallet.');
  return user.custody_address.toLowerCase();
}
function clientOrigin(origin: string): string {
  // A local development browser requests approval for the published site.
  // Vite removes this branch from production builds.
  if (import.meta.env.DEV) {
    try {
      const url = new URL(origin);
      if (origin === url.origin && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return APP_ORIGIN;
    } catch { /* The strict pairing validator supplies the user-facing error. */ }
  }
  return origin;
}
function signerIn(registry: SignersResponse, key: string): Signer | undefined {
  return registry.signers.find(signer => signer.key.replace(/^0x/i, '').toLowerCase() === key);
}
function usableSigner(signer: Signer | undefined, fid: number, scopes: readonly number[] = PAIRING_SCOPES): boolean {
  return !!signer && signer.source === 'SIGNER_SOURCE_OFFCHAIN' && signer.requestFid === fid &&
    Number.isSafeInteger(signer.expiresAt) && Number(signer.expiresAt) > Math.floor(Date.now() / 1000) + 30 &&
    scopes.every(scope => SIGNER_SCOPE_NAMES[scope] && signer.scopes?.includes(SIGNER_SCOPE_NAMES[scope]));
}
async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  assertActive(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('Sign-in cancelled.', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
async function confirmSigner(fid: number, publicKey: string, present: boolean, options: ConnectOptions, scopes: readonly number[] = PAIRING_SCOPES): Promise<void> {
  const deadline = Date.now() + CONFIRMATION_TIMEOUT_MS;
  do {
    assertActive(options.signal);
    const registry = await getSigners(fid, options.signal);
    const found = signerIn(registry, publicKey);
    // The node includes expired records: revocation requires actual absence.
    if (present ? usableSigner(found, fid, scopes) : !found) return;
    await delay(1500, options.signal);
  } while (Date.now() < deadline);
  throw new Error(present
    ? 'Authorization status is still unknown. Keep this window open and check authorization status again. Do not approve a second request yet.'
    : 'Revocation is not confirmed. Keep this device key and check revocation again before forgetting it.');
}

/** Browser authentication never accepts a recovery phrase or custody private key. */
export async function preparePairing(lookup: { fid?: number; username?: string; custodyAddress?: string }, options: PairingOptions): Promise<PendingPairing> {
  assertActive(options.signal);
  const requestedScopes = validatePairingScopes(options.requestedScopes ? [...options.requestedScopes] : [...PAIRING_SCOPES]);
  options.onProgress?.('Finding your Hypersnap identity…');
  const user = await getUser(lookup, options.signal);
  const custody = custodyAddress(user);
  if ((lookup.fid !== undefined && user.fid !== lookup.fid) || (lookup.custodyAddress !== undefined && custody !== lookup.custodyAddress.toLowerCase())) throw new Error('The node returned a different identity.');
  const registry = await getSigners(user.fid, options.signal);
  assertActive(options.signal);
  if (registry.gaslessSignerLimit !== undefined && registry.gaslessSignerCount !== undefined && registry.gaslessSignerCount >= registry.gaslessSignerLimit) throw new Error('This identity has reached its app signer limit. Revoke an unused signer before connecting.');
  // Hypersnap admits only one KEY_ADD per minute per FID. Inspect the complete
  // fresh registry before generating a key or asking the custody wallet to sign.
  // On-chain additions do not consume this quota, and older nodes may omit the
  // public timestamp. The node remains authoritative in those fallback cases.
  const now = Math.floor(Date.now() / 1000);
  const latestAdd = registry.signers.reduce((latest, signer) => signer.source === 'SIGNER_SOURCE_OFFCHAIN'
    && Number.isSafeInteger(signer.addedAt) && Number(signer.addedAt) > 0 && Number(signer.addedAt) <= now
    ? Math.max(latest, Number(signer.addedAt)) : latest, 0);
  const waitSeconds = latestAdd + KEY_ADD_COOLDOWN_SECONDS - now;
  if (waitSeconds > 0) throw new ApiError(`Hypersnap allows one device-key approval per minute. Wait ${waitSeconds} ${waitSeconds === 1 ? 'second' : 'seconds'}, then find your account again. Existing device access is unchanged.`, 429, 'key_approval_cooldown');
  let privateKey: Uint8Array | undefined = crypto.getRandomValues(new Uint8Array(32));
  try {
    const createdAt = Math.floor(Date.now() / 1000);
    const request = validatePairingRequest({
      kind: 'arca.hypersnap.signer.request', version: 1, origin: clientOrigin(options.origin),
      requestId: bytesToHex(crypto.getRandomValues(new Uint8Array(32))), createdAt,
      fid: user.fid, custodyAddress: custody, publicKey: bytesToHex(ed25519.getPublicKey(privateKey)),
      scopes: requestedScopes, ttl: PAIRING_TTL_SECONDS,
      nonce: nonceAfter(registry.currentUserNonce), deadline: createdAt - 1609459200 + 900,
    });
    Object.freeze(request.scopes);
    Object.freeze(request);
    let disposed = false;
    let submitted = false;
    let completing = false;
    let session: WalletSession | undefined;
    return {
      request, user,
      get submitted() { return submitted; },
      async complete(approval, completionOptions = {}) {
        if (session) return session;
        if (disposed || !privateKey) throw new Error('This authorization request has ended. Create a new request.');
        if (completing) throw new Error('Authorization is already being checked.');
        completing = true;
        try {
          assertActive(completionOptions.signal);
          if (!submitted) {
            verifyPairingApproval(request, approval);
            if (bytesToHex(ed25519.getPublicKey(privateKey)) !== request.publicKey) throw new Error('The authorization request does not match this device signer.');
            completionOptions.onProgress?.('Checking current custody and authorization nonce…');
            const [currentUser, current] = await Promise.all([getUser({ fid: request.fid }, completionOptions.signal), getSigners(request.fid, completionOptions.signal)]);
            if (currentUser.fid !== request.fid || custodyAddress(currentUser) !== request.custodyAddress) throw new Error('Account custody changed. Create a new authorization request.');
            if (nonceAfter(current.currentUserNonce) !== request.nonce) throw new Error('Account authorization changed. Create and approve a fresh request.');
            if (current.gaslessSignerLimit !== undefined && current.gaslessSignerCount !== undefined && current.gaslessSignerCount >= current.gaslessSignerLimit) throw new Error('This identity has reached its app signer limit.');
            const publicKeyBytes = hexToBytes(request.publicKey);
            const metadata = abiEncodeSignedKeyRequestMetadata({ requestFid: request.fid, requestSigner: request.custodyAddress, signature: hexToBytes(approval.requestSignature), deadline: request.deadline });
            const { envelope } = await buildSignedMessage({
              type: MessageType.KEY_ADD, fid: request.fid,
              body: { keyAddBody: { key: publicKeyBytes, custodySignature: hexToBytes(approval.custodySignature), deadline: request.deadline, nonce: request.nonce, metadata, scopes: [...request.scopes], ttl: PAIRING_TTL_SECONDS } },
            }, { scheme: SignatureScheme.ED25519, publicKey: publicKeyBytes, sign: async digest => ed25519.sign(digest, privateKey!) });
            assertActive(completionOptions.signal);
            if (disposed) throw new Error('This authorization request has ended.');
            completionOptions.onProgress?.('Submitting your approved device signer…');
            submitted = true; // An uncertain outcome must never retry the write.
            try {
              await submitMessage(envelope, completionOptions.signal);
            } catch (error) {
              // A verified admission-rate rejection proves this attempt was not
              // accepted. An explicit retry keeps the approval but rechecks the
              // current custody and nonce above; unknown outcomes stay read-only.
              if (error instanceof ApiError && error.status === 429 && error.code === 'rate_limited') {
                submitted = false;
                throw new ApiError('Hypersnap allows one new device key per account per minute. Wait at least one minute, then submit this approved key again.', 429, 'rate_limited');
              }
              throw error;
            }
          }
          completionOptions.onProgress?.('Checking signer confirmation…');
          await confirmSigner(request.fid, request.publicKey, true, completionOptions, request.scopes);
          const currentUser = await getUser({ fid: request.fid }, completionOptions.signal);
          assertActive(completionOptions.signal);
          if (disposed || !privateKey) throw new Error('This authorization request has ended.');
          if (currentUser.fid !== request.fid || custodyAddress(currentUser) !== request.custodyAddress) throw new Error('Account custody changed. Authorize a new device signer.');
          session = createSession(currentUser, privateKey, {
            origin: request.origin, fid: request.fid, custodyAddress: request.custodyAddress,
            publicKey: request.publicKey, requestFid: request.fid, scopes: [...request.scopes], ttl: 604800,
          });
          privateKey = undefined; // Session now owns the key.
          return session;
        } finally { completing = false; }
      },
      dispose() { disposed = true; privateKey?.fill(0); privateKey = undefined; },
    };
  } catch (error) { privateKey?.fill(0); throw error; }
}

function savedPublicKey(saved: unknown): string | undefined {
  if (saved && typeof saved === 'object' && 'metadata' in saved && saved.metadata && typeof saved.metadata === 'object' && 'publicKey' in saved.metadata && typeof saved.metadata.publicKey === 'string') return saved.metadata.publicKey;
}
export async function hasSavedSession(publicKey?: string): Promise<boolean> {
  const saved = await readSavedVault();
  return publicKey ? savedPublicKey(saved) === publicKey : saved !== undefined;
}
export async function getSavedSessionMethod(publicKey?: string): Promise<SavedSessionMethod | undefined> {
  const saved = await readSavedVault();
  if (saved === undefined) return undefined;
  const vault = validateSignerVault(saved);
  if (publicKey && vault.metadata.publicKey !== publicKey) return undefined;
  return savedVaultMethod(vault);
}
export async function deleteSavedSession(publicKey?: string): Promise<void> {
  await deleteSavedVault(publicKey);
}
export async function unlockSavedSession(password: string, options: ConnectOptions & { origin?: string } = {}): Promise<WalletSession> {
  assertActive(options.signal);
  const saved = await readSavedVault();
  if (saved === undefined) throw new Error('There is no saved device signer. Authorize this device first.');
  if (validateSignerVault(saved).version !== 1) throw new Error('This device vault uses a passkey. Choose passkey unlock.');
  const origin = options.origin ?? globalThis.location?.origin;
  if (!origin) throw new Error('Could not determine this website’s origin.');
  const { privateKey, metadata } = await decryptSignerVault(saved, password, clientOrigin(origin));
  let transferred = false;
  try {
    options.onProgress?.('Checking custody and saved signer authorization…');
    const [user, registry] = await Promise.all([getUser({ fid: metadata.fid }, options.signal), getSigners(metadata.fid, options.signal)]);
    assertActive(options.signal);
    if (user.fid !== metadata.fid || custodyAddress(user) !== metadata.custodyAddress) throw new Error('Account custody changed. Forget this vault and authorize a new device signer.');
    if (!usableSigner(signerIn(registry, metadata.publicKey), metadata.fid, metadata.scopes)) throw new Error('This device signer is expired or revoked. Forget this vault and authorize the device again.');
    const session = createSession(user, privateKey, metadata, true);
    transferred = true;
    return session;
  } finally { if (!transferred) privateKey.fill(0); }
}

export async function unlockSavedSessionWithPasskey(options: ConnectOptions & { origin?: string } = {}): Promise<WalletSession> {
  assertActive(options.signal);
  const saved = await readSavedVault();
  if (saved === undefined) throw new Error('There is no saved device signer. Authorize this device first.');
  const origin = options.origin ?? globalThis.location?.origin;
  if (!origin) throw new Error('Could not determine this website’s origin.');
  const vault = passkeyVault(saved, clientOrigin(origin), origin);
  assertActive(options.signal);
  options.onProgress?.('Unlock your saved device key with its passkey…');
  let secret: Uint8Array | undefined;
  let privateKey: Uint8Array | undefined;
  let transferred = false;
  try {
    secret = await evaluatePasskey(vault.passkey, { origin, signal: options.signal });
    assertActive(options.signal);
    const unlocked = await decryptSignerVaultWithPasskey(vault, secret, clientOrigin(origin), origin);
    privateKey = unlocked.privateKey;
    secret.fill(0); secret = undefined;
    assertActive(options.signal);
    options.onProgress?.('Checking custody and saved signer authorization…');
    const [user, registry] = await Promise.all([getUser({ fid: vault.metadata.fid }, options.signal), getSigners(vault.metadata.fid, options.signal)]);
    assertActive(options.signal);
    if (user.fid !== vault.metadata.fid || custodyAddress(user) !== vault.metadata.custodyAddress) throw new Error('Account custody changed. Forget this vault and authorize a new device signer.');
    if (!usableSigner(signerIn(registry, vault.metadata.publicKey), vault.metadata.fid, vault.metadata.scopes)) throw new Error('This device signer is expired or revoked. Forget this vault and authorize the device again.');
    const session = createSession(user, privateKey, vault.metadata, true);
    transferred = true;
    return session;
  } finally { secret?.fill(0); if (!transferred) privateKey?.fill(0); }
}

function createSession(user: User, privateKey: Uint8Array, metadata: VaultMetadata, persisted = false): WalletSession {
  clearReactionStatusCache();
  const publicKey = hexToBytes(metadata.publicKey);
  let disposed = false;
  let revoking = false;
  let revokeSubmitted = false;
  let saving: Promise<void> | undefined;
  let saveController: AbortController | undefined;
  let profileSaving = false;
  const uncertainProfileFields = new Map<ProfileField, string>();
  const followingBusy = new Set<number>();
  const uncertainFollows = new Map<number, boolean>();
  const reacting = new Set<string>();
  const uncertainReactions = new Map<string, { desired: boolean; receipt: WriteReceipt }>();
  const confirmedReactionIntents = new Map<string, { desired: boolean; receipt: WriteReceipt }>();
  const reactionVersions = new Map<string, number>();
  const deletingCasts = new Set<string>();
  const pendingDeletions = new Map<string, WriteReceipt>();
  let lastWriteTimestamp = 0;
  const assertSession = () => { if (disposed || revoking || revokeSubmitted) throw new Error('Your session has ended or is being revoked. Unlock or authorize your device again.'); };
  const sign = async (digest: Uint8Array) => { if (disposed) throw new Error('Your session has ended.'); return ed25519.sign(digest, privateKey); };
  const dispose = () => { disposed = true; saveController?.abort(); privateKey.fill(0); clearReactionStatusCache(); };
  const saveWrappedVault = async (wrap: (signal: AbortSignal) => Promise<StoredSignerVault>, options: ConnectOptions = {}) => {
    assertSession();
    assertActive(options.signal);
    if (saving) throw new Error('This device signer is already being saved.');
    const controller = new AbortController(); saveController = controller;
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const active = () => { assertSession(); assertActive(controller.signal); };
    // Start both before the first await: the explicit click must reach WebAuthn
    // creation while Safari still has the user's transient activation.
    const snapshot = readSavedVault();
    const wrapping = wrap(controller.signal);
    const operation = (async () => {
      let previous: StoredSignerVault | undefined;
      let vault: StoredSignerVault | undefined;
      try {
        const [saved, wrapped] = await Promise.all([snapshot, wrapping]);
        previous = saved === undefined ? undefined : validateSignerVault(saved);
        vault = wrapped;
        active();
        if (!await compareAndSwapSavedVault(previous, vault, controller.signal)) throw new Error('The saved device changed in another tab. Nothing was replaced. Check saved devices before trying again.');
        persisted = true;
        try { active(); }
        catch (cause) {
          // A commit can complete just before a cancellation or local lock.
          // Restore only our exact wrapper; never remove another tab's save.
          const restored = await compareAndSwapSavedVault(vault, previous);
          persisted = !restored || previous?.metadata.publicKey === metadata.publicKey;
          throw cause;
        }
      } catch (cause) {
        controller.abort();
        throw cause;
      } finally { options.signal?.removeEventListener('abort', abort); }
    })();
    saving = operation;
    try { await operation; }
    finally { if (saving === operation) saving = undefined; if (saveController === controller) saveController = undefined; }
  };
  const finishRevocation = async () => {
    // A save may already be committing when revocation starts. Wait for its
    // transaction before deciding whether there is a matching vault to clear.
    await saving?.catch(() => undefined);
    // A fresh ephemeral key cannot have a matching saved vault. This also
    // lets revocation work in browsers where IndexedDB is unavailable.
    if (persisted) {
      try { await deleteSavedSession(metadata.publicKey); }
      catch { throw new Error('Revocation is confirmed on Hypersnap, but the local encrypted vault could not be cleared. Check revocation status again to retry local cleanup.'); }
    }
    dispose();
  };
  const assertAuthorized = async (type: MessageType, signal?: AbortSignal) => {
    assertSession();
    assertActive(signal);
    if (!metadata.scopes.includes(type)) throw new Error(type === MessageType.CAST_REMOVE
      ? 'Approve cast deletion with your custody wallet before deleting casts. Existing device permissions do not include deletion.'
      : 'Enable social features with your custody wallet before following accounts or editing your profile.');
    const [currentUser, registry] = await Promise.all([getUser({ fid: metadata.fid }, signal), getSigners(metadata.fid, signal)]);
    assertSession();
    assertActive(signal);
    if (currentUser.fid !== metadata.fid || custodyAddress(currentUser) !== metadata.custodyAddress || !usableSigner(signerIn(registry, metadata.publicKey), metadata.fid, metadata.scopes)) throw new Error('This device signer is no longer authorized. Reconnect before posting.');
  };
  const send = async (data: MessageDataInput, onAttempt?: (receipt: WriteReceipt) => void): Promise<WriteReceipt> => {
    await assertAuthorized(data.type);
    // Consecutive follow/unfollow and profile updates need a later timestamp
    // even when the user acts twice in a second (the protocol uses LWW sets).
    lastWriteTimestamp = Math.max(farcasterTimestamp(), lastWriteTimestamp + 1);
    const { envelope, hash } = await buildSignedMessage({ ...data, timestamp: lastWriteTimestamp }, { scheme: SignatureScheme.ED25519, publicKey, sign });
    assertSession();
    const receipt = { hash: bytesToHex(hash) };
    onAttempt?.(receipt);
    await submitMessage(envelope);
    return receipt;
  };
  const reactionIdentity = (target: CastTarget, type: 'like' | 'recast') => {
    assertSession();
    assertFid(target.fid);
    if (type !== 'like' && type !== 'recast') throw new Error('Invalid reaction type.');
    const normalized = { fid: target.fid, hash: bytesToHex(hashBytes(target.hash)) };
    return { target: normalized, key: `${normalized.fid}:${normalized.hash}:${type}` };
  };
  const reactionUnknown = () => new ApiError('An earlier reaction has unknown status. Check reaction status again; no second reaction will be submitted until its intended state is visible.', 504, 'submission_unknown');
  // Confirmation reads and uncertain writes bypass the shared receipt cache.
  const readReactionStatus = async (target: CastTarget, type: 'like' | 'recast', signal?: AbortSignal, fresh = false, options?: { castTimestamp?: string }): Promise<boolean> => {
    const identity = reactionIdentity(target, type);
    assertActive(signal);
    const version = reactionVersions.get(identity.key) ?? 0;
    const observed = fresh || uncertainReactions.has(identity.key)
      ? await getReactionStatus(metadata.fid, identity.target, type, signal, { fresh: true })
      : options
        ? await getReactionStatus(metadata.fid, identity.target, type, signal, options)
        : await getReactionStatus(metadata.fid, identity.target, type, signal);
    assertSession(); assertActive(signal);
    const pending = uncertainReactions.get(identity.key);
    // A read begun before a submission cannot reconcile that later write,
    // even if its old value happens to match the newly requested intent.
    if (version !== (reactionVersions.get(identity.key) ?? 0)) {
      if (pending) throw reactionUnknown();
      throw new ApiError('Reaction state changed while it was being checked. Check reaction status again.', 409, 'reaction_status_changed');
    }
    if (pending) {
      if (observed !== pending.desired) throw reactionUnknown();
      uncertainReactions.delete(identity.key);
      confirmedReactionIntents.set(identity.key, pending);
    }
    const confirmed = confirmedReactionIntents.get(identity.key);
    if (confirmed && observed !== confirmed.desired) confirmedReactionIntents.delete(identity.key);
    return observed;
  };
  const confirmCastDeletion = async (target: CastTarget): Promise<void> => {
    const controller = new AbortController();
    const deadline = Date.now() + CONFIRMATION_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), CONFIRMATION_TIMEOUT_MS);
    try {
      do {
        assertSession();
        try {
          const observed = await getCast(target.hash, controller.signal);
          assertSession();
          if (observed.author?.fid !== metadata.fid || bytesToHex(hashBytes(observed.hash)) !== target.hash) throw new Error('The node returned a different cast.');
        } catch (error) {
          if (error instanceof ApiError && error.status === 404 && error.code === 'cast_not_found' && !controller.signal.aborted && Date.now() < deadline) return;
          throw error;
        }
        await delay(1500, controller.signal);
      } while (Date.now() < deadline);
      throw new Error('Cast deletion is not visible yet.');
    } catch {
      throw new ApiError('Cast deletion status is unknown. Check deletion status again; this will not submit another deletion.', 504, 'submission_unknown');
    } finally { clearTimeout(timer); }
  };
  const confirmProfileField = async (field: ProfileField, attempted: string): Promise<void> => {
    // submitMessage acknowledges the mempool. Only a fresh read of the matching
    // custody account can establish that its visible profile contains the edit.
    // This timer also bounds an in-flight read, not just the gaps between polls.
    const controller = new AbortController();
    const deadline = Date.now() + CONFIRMATION_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), CONFIRMATION_TIMEOUT_MS);
    try {
      do {
        assertSession();
        const observed = await getUser({ fid: metadata.fid }, controller.signal);
        assertSession();
        if (controller.signal.aborted || Date.now() >= deadline) throw new Error('Profile confirmation timed out.');
        if (observed.fid !== metadata.fid || custodyAddress(observed) !== metadata.custodyAddress) throw new Error('Account custody changed during profile confirmation.');
        const visible = field === 'displayName' ? observed.display_name ?? '' : field === 'bio' ? observed.profile?.bio?.text ?? '' : observed.pfp_url ?? '';
        if (visible === attempted) return;
        await delay(1500, controller.signal);
      } while (Date.now() < deadline);
      throw new Error('The profile update is not visible yet.');
    } catch {
      // Once submitted, even a read error or local lock cannot prove a failure.
      // The caller quarantines this field and never submits it automatically.
      throw new ApiError('Profile save status is unknown. Check the public profile before editing this field again.', 504, 'submission_unknown');
    } finally { clearTimeout(timer); }
  };
  return {
    user, fid: metadata.fid, custodyAddress: metadata.custodyAddress, publicKey: metadata.publicKey, scopes: Object.freeze([...metadata.scopes]),
    async cast(text, parent, options = {}) {
      const textBytes = new TextEncoder().encode(text);
      const bytes = textBytes.length;
      const { embeds = [], mentions = [], mentionsPositions = [], parentUrl } = options;
      if (!text.trim() && !embeds.length && !mentions.length) throw new Error('Write something before casting.');
      if (bytes > 1024) throw new Error('Casts can contain up to 1,024 UTF-8 bytes.');
      if (!Array.isArray(embeds) || embeds.length > 2) throw new Error('Use at most two embeds, including quoted casts and HTTPS media.');
      const protocolEmbeds = embeds.map(embed => {
        if (!embed || typeof embed !== 'object' || Object.keys(embed).length !== 1) throw new Error('Choose an HTTPS media URL or a cast to quote.');
        if ('url' in embed) { assertHttpsUrl(embed.url); return { url: embed.url }; }
        if (!('castId' in embed) || !embed.castId || typeof embed.castId !== 'object' || Object.keys(embed.castId).length !== 2) throw new Error('Choose a valid cast to quote.');
        assertFid(embed.castId.fid);
        return { castId: { fid: embed.castId.fid, hash: hashBytes(embed.castId.hash) } };
      });
      if (!Array.isArray(mentions) || !Array.isArray(mentionsPositions) || mentions.length > 10 || mentions.length !== mentionsPositions.length) throw new Error('Use at most ten mentions with matching positions.');
      mentions.forEach(assertFid);
      if (mentionsPositions.some((position, index) => !Number.isSafeInteger(position) || position < 0 || position > bytes
        || (index > 0 && position < mentionsPositions[index - 1]) || (position < bytes && (textBytes[position] & 0xc0) === 0x80))) throw new Error('Mention positions must be sorted UTF-8 boundaries in the cast text.');
      if (parent) assertFid(parent.fid);
      if (parentUrl !== undefined) { assertHttpsUrl(parentUrl); if (parent) throw new Error('Choose either a reply or a channel destination.'); }
      return send({ type: MessageType.CAST_ADD, fid: metadata.fid, body: { castAddBody: { text, embeds: protocolEmbeds, mentions, mentionsPositions, type: bytes > 320 ? CastType.LONG_CAST : CastType.CAST, ...(parent ? { parent: { castId: { fid: parent.fid, hash: hashBytes(parent.hash) } } } : parentUrl !== undefined ? { parent: { url: parentUrl } } : {}) } } });
    },
    async deleteCast(target) {
      assertSession();
      assertFid(target.fid);
      if (target.fid !== metadata.fid) throw new Error('You can delete only casts published by your own account.');
      if (!metadata.scopes.includes(MessageType.CAST_REMOVE)) throw new Error('Approve cast deletion with your custody wallet before deleting casts. Existing device permissions do not include deletion.');
      const targetHash = bytesToHex(hashBytes(target.hash));
      if (deletingCasts.has(targetHash)) throw new Error('This cast deletion is already being checked.');
      deletingCasts.add(targetHash);
      try {
        if (!pendingDeletions.has(targetHash)) {
          const observed = await getCast(targetHash);
          assertSession();
          if (observed.author?.fid !== metadata.fid || bytesToHex(hashBytes(observed.hash)) !== targetHash) throw new Error('The node did not confirm that this cast belongs to your account.');
          try {
            await send({ type: MessageType.CAST_REMOVE, fid: metadata.fid, body: { castRemoveBody: { targetHash: hashBytes(targetHash) } } }, receipt => pendingDeletions.set(targetHash, receipt));
          } catch (error) {
            if (pendingDeletions.has(targetHash) && !(error instanceof ApiError && error.status < 500 && error.code !== 'submission_unknown')) {
              throw new ApiError('Cast deletion status is unknown. Check deletion status again; this will not submit another deletion.', 504, 'submission_unknown');
            }
            pendingDeletions.delete(targetHash);
            throw error;
          }
        }
        await confirmCastDeletion({ fid: metadata.fid, hash: targetHash });
        const receipt = pendingDeletions.get(targetHash)!;
        pendingDeletions.delete(targetHash);
        return receipt;
      } finally { deletingCasts.delete(targetHash); }
    },
    async react(target, type, remove = false) {
      const identity = reactionIdentity(target, type);
      if (typeof remove !== 'boolean') throw new Error('Invalid reaction action.');
      if (reacting.has(identity.key)) throw new Error('This reaction change is already being submitted.');
      reacting.add(identity.key);
      let attempted: WriteReceipt | undefined;
      try {
        const desired = !remove;
        const pending = uncertainReactions.get(identity.key);
        if (pending) {
          await readReactionStatus(identity.target, type, undefined, true);
          if (pending.desired === desired) return pending.receipt;
        } else {
          const confirmed = confirmedReactionIntents.get(identity.key);
          if (confirmed?.desired === desired && await readReactionStatus(identity.target, type, undefined, true) === desired) return confirmed.receipt;
        }
        confirmedReactionIntents.delete(identity.key);
        const receipt = await send({ type: remove ? MessageType.REACTION_REMOVE : MessageType.REACTION_ADD, fid: metadata.fid, body: { reactionBody: { type: type === 'like' ? ReactionType.LIKE : ReactionType.RECAST, target: { castId: { fid: identity.target.fid, hash: hashBytes(identity.target.hash) } } } } }, receipt => {
          attempted = receipt;
          reactionVersions.set(identity.key, (reactionVersions.get(identity.key) ?? 0) + 1);
          invalidateReactionStatus(metadata.fid, identity.target, type);
        });
        if (!disposed) primeReactionStatus(metadata.fid, identity.target, type, desired);
        return receipt;
      } catch (error) {
        if (attempted) invalidateReactionStatus(metadata.fid, identity.target, type);
        if (attempted && error instanceof ApiError && error.code === 'submission_unknown') {
          uncertainReactions.set(identity.key, { desired: !remove, receipt: attempted });
          reactionVersions.set(identity.key, (reactionVersions.get(identity.key) ?? 0) + 1);
        }
        throw error;
      } finally { reacting.delete(identity.key); }
    },
    reactionStatus: (target, type, signal, options) => readReactionStatus(target, type, signal, false, options),
    async follow(targetFid, remove = false) {
      assertSession();
      assertFid(targetFid);
      if (targetFid === metadata.fid) throw new Error('You cannot follow your own account.');
      if (followingBusy.has(targetFid)) throw new Error('This follow change is already being submitted.');
      followingBusy.add(targetFid);
      try {
        if (uncertainFollows.has(targetFid)) {
          const confirmed = await getFollowStatus(metadata.fid, targetFid);
          if (confirmed !== uncertainFollows.get(targetFid)) throw new Error('An earlier follow change has unknown status. Wait until its requested relationship is visible before another change.');
          uncertainFollows.delete(targetFid);
        }
        return await send({ type: remove ? MessageType.LINK_REMOVE : MessageType.LINK_ADD, fid: metadata.fid, body: { linkBody: { type: 'follow', targetFid } } });
      } catch (error) {
        if (error instanceof ApiError && error.code === 'submission_unknown') uncertainFollows.set(targetFid, !remove);
        throw error;
      } finally { followingBusy.delete(targetFid); }
    },
    async updateProfile(patch) {
      assertSession();
      const changes = profileChanges(patch); // Validate the whole edit before any write.
      if (profileSaving) throw new Error('Profile changes are already being submitted.');
      if (changes.some(change => uncertainProfileFields.has(change.field))) throw new Error('A previous profile change has unknown status. Refresh and verify it before editing that field again.');
      const result: ProfileUpdateResult = { saved: [] };
      profileSaving = true;
      try {
        for (let index = 0; index < changes.length; index += 1) {
          const change = changes[index];
          try {
            await send({ type: MessageType.USER_DATA_ADD, fid: metadata.fid, body: { userDataBody: { type: change.type, value: change.value } } });
            await confirmProfileField(change.field, change.value);
            result.saved.push(change.field);
          } catch (error) {
            const unknown = error instanceof ApiError && error.code === 'submission_unknown';
            if (unknown) uncertainProfileFields.set(change.field, change.value);
            result.failed = [{ field: change.field, message: error instanceof Error ? error.message : 'This profile change could not be submitted.', unknown }, ...changes.slice(index + 1).map(next => ({ field: next.field, message: 'Not submitted because the previous change did not complete.', unknown: false }))];
            break;
          }
        }
        return result;
      } finally { profileSaving = false; }
    },
    async refreshProfile() {
      assertSession();
      const refreshed = await getUser({ fid: metadata.fid });
      assertSession();
      if (refreshed.fid !== metadata.fid || custodyAddress(refreshed) !== metadata.custodyAddress) throw new Error('Account custody changed. Reconnect with the current custody wallet.');
      const values: Record<ProfileField, string> = { displayName: refreshed.display_name || '', bio: refreshed.profile?.bio?.text || '', pfpUrl: refreshed.pfp_url || '' };
      for (const [field, attempted] of uncertainProfileFields) if (values[field] === attempted) uncertainProfileFields.delete(field);
      return refreshed;
    },
    async authorizeMediaUpload(input) {
      await assertAuthorized(MessageType.CAST_ADD);
      const grant = await createMediaUploadGrant(input, { fid: metadata.fid, publicKey: metadata.publicKey }, sign);
      assertSession();
      return grant;
    },
    async saveToDevice(password, options = {}) {
      try { await saveWrappedVault(() => encryptSignerVault(privateKey, metadata, password), options); }
      finally { password = ''; }
    },
    async saveToDeviceWithPasskey(options = {}) {
      const origin = globalThis.location?.origin;
      if (!origin) throw new Error('Could not determine this website’s origin.');
      await saveWrappedVault(async signal => {
        options.onProgress?.('Create a passkey to protect this device’s existing signing key…');
        let secret: Uint8Array | undefined;
        try {
          const enrolled = await enrollPasskey({ origin, account: { fid: metadata.fid, publicKey: metadata.publicKey }, signal });
          secret = enrolled.prfSecret;
          assertSession(); assertActive(signal);
          const vault = await encryptSignerVaultWithPasskey(privateKey, metadata, enrolled.descriptor, secret);
          passkeyVault(vault, metadata.origin, origin);
          secret.fill(0); secret = undefined;
          options.onProgress?.('Checking current custody and device authorization before saving…');
          await assertAuthorized(MessageType.CAST_ADD, signal);
          assertSession(); assertActive(signal);
          return vault;
        } finally { secret?.fill(0); }
      }, options);
    },
    async prepareRevocation(options = {}) {
      if (disposed) throw new Error('Your session has ended. Unlock this device before revoking it.');
      if (revoking) throw new Error('Revocation is already being checked.');
      assertActive(options.signal);
      options.onProgress?.('Checking current custody and signer state…');
      const [currentUser, registry] = await Promise.all([getUser({ fid: metadata.fid }, options.signal), getSigners(metadata.fid, options.signal)]);
      assertActive(options.signal);
      if (disposed) throw new Error('Your session has ended.');
      if (currentUser.fid !== metadata.fid || custodyAddress(currentUser) !== metadata.custodyAddress) throw new Error('Account custody changed. Device revocation needs approval from the current custody wallet.');
      const existing = signerIn(registry, metadata.publicKey);
      if (existing && (existing.source !== 'SIGNER_SOURCE_OFFCHAIN' || existing.requestFid !== metadata.requestFid)) throw new Error('The node returned different signer ownership. Revocation was not submitted.');
      // If a previous modal closed during an uncertain submission, or the node
      // already removed this key, a replacement request only checks status.
      if (!existing) revokeSubmitted = true;
      const createdAt = Math.floor(Date.now() / 1000);
      const request = validateRevocationRequest({
        kind: 'arca.hypersnap.signer.revoke.request', version: 1,
        origin: metadata.origin, requestId: bytesToHex(crypto.getRandomValues(new Uint8Array(32))), createdAt,
        fid: metadata.fid, custodyAddress: metadata.custodyAddress, publicKey: metadata.publicKey,
        nonce: nonceAfter(registry.currentUserNonce), deadline: createdAt - 1609459200 + 900,
      });
      Object.freeze(request);
      let ended = false;
      let completed = false;
      let completing = false;
      return {
        request,
        get submitted() { return revokeSubmitted; },
        async complete(approval, completionOptions = {}) {
          if (completed) return;
          if (ended || disposed) throw new Error('This revocation request has ended. Open device settings again.');
          if (completing || revoking) throw new Error('Revocation is already being checked.');
          completing = true;
          revoking = true;
          try {
            assertActive(completionOptions.signal);
            if (!revokeSubmitted) {
              if (!approval) throw new Error('Import the signed revocation approval from Arca Signer.');
              verifyRevocationApproval(request, approval);
              const [freshUser, freshRegistry] = await Promise.all([getUser({ fid: metadata.fid }, completionOptions.signal), getSigners(metadata.fid, completionOptions.signal)]);
              if (freshUser.fid !== metadata.fid || custodyAddress(freshUser) !== metadata.custodyAddress) throw new Error('Account custody changed. Create a fresh revocation request.');
              if (signerIn(freshRegistry, metadata.publicKey)) {
                if (nonceAfter(freshRegistry.currentUserNonce) !== request.nonce) throw new Error('Account authorization changed. Create and approve a fresh revocation request.');
                const { envelope } = await buildSignedMessage({
                  type: MessageType.KEY_REMOVE, fid: metadata.fid,
                  body: { keyRemoveBody: { key: publicKey, signature: hexToBytes(approval.custodySignature), signatureType: 1, deadline: request.deadline, nonce: request.nonce } },
                }, { scheme: SignatureScheme.ED25519, publicKey, sign });
                assertActive(completionOptions.signal);
                if (ended || disposed) throw new Error('This revocation request has ended.');
                completionOptions.onProgress?.('Submitting your approved device revocation…');
                revokeSubmitted = true;
                await submitMessage(envelope, completionOptions.signal);
              } else revokeSubmitted = true;
            }
            completionOptions.onProgress?.('Checking that Hypersnap removed this signer…');
            await confirmSigner(metadata.fid, metadata.publicKey, false, completionOptions);
            // Cancellation preserves the key so the next modal can check status.
            assertActive(completionOptions.signal);
            if (ended) throw new Error('This revocation request has ended. Check its status from device settings.');
            await finishRevocation();
            completed = true;
          } finally { completing = false; revoking = false; }
        },
        dispose() { ended = true; },
      };
    },
    async revoke(options = {}) {
      if (disposed) throw new Error('Your session has ended. Unlock this device before revoking it.');
      if (revoking) throw new Error('Revocation is already being checked.');
      revoking = true;
      try {
        assertActive(options.signal);
        const registry = await getSigners(metadata.fid, options.signal);
        const existing = signerIn(registry, metadata.publicKey);
        if (existing && !revokeSubmitted) {
          if (existing.source !== 'SIGNER_SOURCE_OFFCHAIN' || existing.requestFid !== metadata.requestFid) throw new Error('The node returned different signer ownership. Revocation was not submitted.');
          const nonce = nonceAfter(registry.requesterFidNonces?.[String(metadata.requestFid)]);
          const { envelope } = await buildSignedMessage({
            type: MessageType.KEY_REMOVE, fid: metadata.fid,
            body: { keyRemoveBody: { key: publicKey, signature: new Uint8Array(), signatureType: 2, deadline: farcasterTimestamp() + 900, nonce } },
          }, { scheme: SignatureScheme.ED25519, publicKey, sign });
          assertActive(options.signal);
          if (disposed) throw new Error('Your session has ended.');
          revokeSubmitted = true;
          options.onProgress?.('Submitting device revocation…');
          await submitMessage(envelope, options.signal);
        }
        options.onProgress?.('Checking that the node removed this signer…');
        await confirmSigner(metadata.fid, metadata.publicKey, false, options);
        await finishRevocation();
      } finally { revoking = false; }
    },
    dispose,
  };
}
