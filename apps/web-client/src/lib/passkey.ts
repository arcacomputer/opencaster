/** Local vault unlock through WebAuthn PRF, never through an assertion signature.
 * This module contacts no application backend. The chosen browser/OS provider
 * independently controls its passkey storage and possible synchronization.
 * The caller must HKDF the returned secret and wipe it in a finally block.
 * PRF support depends on the selected provider as well as the browser.
 * https://www.w3.org/TR/webauthn-3/#prf-extension
 */
import { sha256 } from '@noble/hashes/sha256.js';

export interface PasskeyDescriptor {
  origin: string;
  rpId: string;
  /** Canonical base64url credential ID; this and the other fields are public. */
  credentialId: string;
  prfSalt: string;
  userHandle: string;
}

export interface PasskeyOptions { origin: string; signal?: AbortSignal }
export interface EnrollPasskeyOptions extends PasskeyOptions { account: { fid: number; publicKey: string } }
export interface EnrolledPasskey { descriptor: PasskeyDescriptor; prfSecret: Uint8Array }
export class PasskeyError extends Error {
  constructor(message: string, public readonly code: 'unsupported' | 'invalid_response' | 'origin_changed' | 'timeout') {
    super(message); this.name = 'PasskeyError';
  }
}

const TIMEOUT_MS = 60_000;
const HEX_32 = /^[0-9a-f]{64}$/;
const UNSUPPORTED = 'This browser or selected passkey provider cannot encrypt this device signer. Use a compatible passkey provider or reconnect your wallet.';
const INVALID = 'The passkey response could not be verified. Try again or reconnect your wallet.';

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function invalid(): never { throw new PasskeyError(INVALID, 'invalid_response'); }
function unsupported(): never { throw new PasskeyError(UNSUPPORTED, 'unsupported'); }
function hex(bytes: Uint8Array): string { return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''); }
function unhex(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(value.match(/../g)!, byte => parseInt(byte, 16)); }
function base64url(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decodeId(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,1366}$/.test(value)) invalid();
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0)); }
  catch { return invalid(); }
  if (bytes.length < 1 || bytes.length > 1024 || base64url(bytes) !== value) invalid();
  return bytes;
}

function originUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 200) invalid();
  let url: URL;
  try { url = new URL(value); } catch { return invalid(); }
  if (url.origin !== value || url.username || url.password || (url.protocol !== 'https:'
    && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) invalid();
  return url;
}

/** Pure schema validation; vault code can bind the actual origin in its AAD.
 * A caller passing expectedOrigin additionally requires that exact origin.
 */
export function validatePasskeyDescriptor(value: unknown, expectedOrigin?: string): PasskeyDescriptor {
  if (!object(value) || Object.keys(value).length !== 5 || !['origin', 'rpId', 'credentialId', 'prfSalt', 'userHandle'].every(key => Object.hasOwn(value, key))
    || typeof value.rpId !== 'string' || typeof value.prfSalt !== 'string' || !HEX_32.test(value.prfSalt)
    || typeof value.userHandle !== 'string' || !HEX_32.test(value.userHandle)) invalid();
  const url = originUrl(value.origin);
  if (url.hostname !== value.rpId || (expectedOrigin !== undefined && value.origin !== expectedOrigin)) invalid();
  decodeId(value.credentialId);
  return { origin: value.origin as string, rpId: value.rpId, credentialId: value.credentialId as string, prfSalt: value.prfSalt, userHandle: value.userHandle };
}

/** API availability only. An actual ceremony must still prove PRF support. */
export function passkeysAvailable(origin = globalThis.location?.origin): boolean {
  try {
    originUrl(origin);
    return origin === globalThis.location?.origin && globalThis.isSecureContext === true
      && typeof globalThis.PublicKeyCredential === 'function' && typeof globalThis.navigator?.credentials?.create === 'function'
      && typeof globalThis.navigator?.credentials?.get === 'function' && !!globalThis.crypto?.subtle && typeof globalThis.crypto.getRandomValues === 'function';
  } catch { return false; }
}

function assertContext(origin: string, signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('Passkey request cancelled.', 'AbortError');
  if (globalThis.location?.origin !== origin) throw new PasskeyError('The website origin changed. Start the passkey request again.', 'origin_changed');
  if (!passkeysAvailable(origin)) unsupported();
}

function operation(options: PasskeyOptions) {
  originUrl(options.origin);
  const controller = new AbortController();
  const abort = () => controller.abort(new DOMException('Passkey request cancelled.', 'AbortError'));
  if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new PasskeyError('The passkey request timed out. Try again.', 'timeout')), TIMEOUT_MS);
  return {
    signal: controller.signal,
    check() { assertContext(options.origin, controller.signal); },
    finish() { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); },
    error(error: unknown): Error {
      if (controller.signal.aborted) return controller.signal.reason;
      if (error instanceof PasskeyError) return error;
      if (error instanceof DOMException && ['NotAllowedError', 'AbortError'].includes(error.name)) return new DOMException('Passkey request cancelled or not approved.', 'AbortError');
      if (error instanceof DOMException && ['NotSupportedError', 'ConstraintError'].includes(error.name)) return new PasskeyError(UNSUPPORTED, 'unsupported');
      return new PasskeyError(INVALID, 'invalid_response');
    },
  };
}

/** Borrow a bounded native output view so it can be cleared after copying. */
function bufferView(value: unknown, maximum: number): Uint8Array | undefined {
  if (value instanceof ArrayBuffer) return value.byteLength <= maximum ? new Uint8Array(value) : undefined;
  if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer && value.byteLength <= maximum) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return undefined;
}
function requiredBuffer(value: unknown, minimum: number, maximum: number): Uint8Array {
  const bytes = bufferView(value, maximum);
  if (!bytes || bytes.length < minimum) invalid();
  return bytes;
}
function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}
function credential(value: Credential | null): PublicKeyCredential {
  if (!(value instanceof PublicKeyCredential) || value.type !== 'public-key' || typeof value.getClientExtensionResults !== 'function') invalid();
  const raw = requiredBuffer(value.rawId, 1, 1024);
  if (value.id !== base64url(raw)) invalid();
  return value;
}
function extensionOutputs(value: Credential | null): AuthenticationExtensionsClientOutputs | undefined {
  return value instanceof PublicKeyCredential && typeof value.getClientExtensionResults === 'function' ? value.getClientExtensionResults() : undefined;
}
function clearOutputs(outputs?: AuthenticationExtensionsClientOutputs): void {
  // No toJSON/serialization: PRF extension results contain encryption material.
  for (const value of [outputs?.prf?.results?.first, outputs?.prf?.results?.second]) {
    if (value instanceof ArrayBuffer) new Uint8Array(value).fill(0);
    else if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) new Uint8Array(value.buffer, value.byteOffset, value.byteLength).fill(0);
  }
}

/** Bound even a provider that resolves late after cancellation. Such a result
 * never reaches the caller, and any exposed PRF output is cleared on arrival.
 */
function credentialResult(pending: Promise<Credential | null>, signal: AbortSignal): Promise<Credential | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => { if (!settled) { settled = true; reject(signal.reason ?? new DOMException('Passkey request cancelled.', 'AbortError')); } };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    pending.then(value => {
      signal.removeEventListener('abort', abort);
      if (settled) {
        try { clearOutputs(extensionOutputs(value)); } catch { /* No result is retained or returned. */ }
      } else { settled = true; resolve(value); }
    }, error => {
      signal.removeEventListener('abort', abort);
      if (!settled) { settled = true; reject(error); }
    });
  });
}

function checkClientData(response: AuthenticatorResponse, type: 'webauthn.create' | 'webauthn.get', challenge: Uint8Array, origin: string): void {
  const bytes = requiredBuffer(response.clientDataJSON, 1, 4096);
  let data: unknown;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return invalid(); }
  if (!object(data) || data.type !== type || data.origin !== origin || data.challenge !== base64url(challenge)
    || (data.crossOrigin !== undefined && data.crossOrigin !== false) || data.topOrigin !== undefined) invalid();
}

function checkAuthenticatorData(value: unknown, rpId: string, creationId?: Uint8Array): void {
  const bytes = requiredBuffer(value, 37, 16_384);
  // This existing audited hash dependency keeps validation synchronous after
  // the native response; cancellation never waits on a second async operation.
  const expected = sha256(new TextEncoder().encode(rpId));
  // RP hash, User Present and User Verified are required even if a provider
  // ignored the requested userVerification setting in its native UI.
  if (!equal(bytes.subarray(0, 32), expected) || (bytes[32] & 0x05) !== 0x05) invalid();
  if (creationId) {
    if (!(bytes[32] & 0x40) || bytes.length < 55) invalid();
    const length = bytes[53] * 256 + bytes[54];
    if (length !== creationId.length || bytes.length < 55 + length || !equal(bytes.subarray(55, 55 + length), creationId)) invalid();
  } else if (bytes[32] & 0x40) invalid();
}

async function evaluate(descriptor: PasskeyDescriptor, origin: string, current: ReturnType<typeof operation>): Promise<Uint8Array> {
  current.check();
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  let outputs: AuthenticationExtensionsClientOutputs | undefined;
  let secret: Uint8Array | undefined;
  try {
    const result = await credentialResult(navigator.credentials.get({ signal: current.signal, publicKey: {
      challenge, rpId: descriptor.rpId, timeout: TIMEOUT_MS, userVerification: 'required',
      allowCredentials: [{ type: 'public-key', id: decodeId(descriptor.credentialId) }],
      extensions: { prf: { eval: { first: unhex(descriptor.prfSalt) } } },
    } }), current.signal);
    outputs = extensionOutputs(result);
    current.check();
    const chosen = credential(result);
    if (!equal(requiredBuffer(chosen.rawId, 1, 1024), decodeId(descriptor.credentialId))) invalid();
    const response = chosen.response as AuthenticatorAssertionResponse;
    checkClientData(response, 'webauthn.get', challenge, origin);
    checkAuthenticatorData(response.authenticatorData, descriptor.rpId);
    current.check();
    requiredBuffer(response.signature, 1, 1024); // Validation only, never KDF input.
    if (response.userHandle !== null && !equal(requiredBuffer(response.userHandle, 32, 32), unhex(descriptor.userHandle))) invalid();
    if (outputs?.prf?.enabled === false) unsupported();
    const prf = bufferView(outputs?.prf?.results?.first, 32);
    if (!prf || prf.length !== 32) unsupported();
    secret = Uint8Array.from(prf);
    current.check();
    return secret;
  } catch (error) { secret?.fill(0); throw error; }
  finally { clearOutputs(outputs); }
}

/** Must be called from an explicit user action. Always evaluate with get() after
 * create(): providers can support PRF without returning an output at creation.
 */
export async function enrollPasskey(options: EnrollPasskeyOptions): Promise<EnrolledPasskey> {
  const current = operation(options);
  let outputs: AuthenticationExtensionsClientOutputs | undefined;
  let prfSecret: Uint8Array | undefined;
  try {
    current.check();
    if (!Number.isSafeInteger(options.account.fid) || options.account.fid < 1 || !/^[a-f0-9]{64}$/.test(options.account.publicKey)) invalid();
    const rpId = originUrl(options.origin).hostname;
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userHandle = crypto.getRandomValues(new Uint8Array(32));
    const result = await credentialResult(navigator.credentials.create({ signal: current.signal, publicKey: {
      challenge, rp: { id: rpId, name: 'Opencaster on Hypersnap' },
      user: { id: userHandle, name: `Hypersnap FID ${options.account.fid}`, displayName: `Opencaster FID ${options.account.fid}` },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      attestation: 'none', timeout: TIMEOUT_MS, extensions: { prf: {}, credProps: true },
    } }), current.signal);
    outputs = extensionOutputs(result);
    current.check();
    const created = credential(result);
    const response = created.response as AuthenticatorAttestationResponse;
    checkClientData(response, 'webauthn.create', challenge, options.origin);
    if (typeof response.getAuthenticatorData !== 'function') unsupported();
    checkAuthenticatorData(response.getAuthenticatorData(), rpId, requiredBuffer(created.rawId, 1, 1024));
    current.check();
    if (outputs?.prf?.enabled !== true || outputs.credProps?.rk === false) unsupported();
    const descriptor = validatePasskeyDescriptor({ origin: options.origin, rpId, credentialId: base64url(new Uint8Array(created.rawId)), prfSalt: hex(crypto.getRandomValues(new Uint8Array(32))), userHandle: hex(userHandle) }, options.origin);
    clearOutputs(outputs); outputs = undefined;
    prfSecret = await evaluate(descriptor, options.origin, current);
    current.check();
    return { descriptor, prfSecret };
  } catch (error) { prfSecret?.fill(0); throw current.error(error); }
  finally { clearOutputs(outputs); current.finish(); }
}

/** No persistence or backend authentication. Only the exact saved credential may
 * evaluate the saved salt, and the returned output belongs to this actual origin.
 */
export async function evaluatePasskey(value: unknown, options: PasskeyOptions): Promise<Uint8Array> {
  const current = operation(options);
  let secret: Uint8Array | undefined;
  try {
    current.check();
    const descriptor = validatePasskeyDescriptor(value, options.origin);
    secret = await evaluate(descriptor, options.origin, current);
    current.check();
    return secret;
  } catch (error) { secret?.fill(0); throw current.error(error); }
  finally { current.finish(); }
}
