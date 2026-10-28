import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enrollPasskey, evaluatePasskey, passkeysAvailable, validatePasskeyDescriptor, type PasskeyDescriptor } from './passkey';

const ORIGIN = 'https://opencaster.org';
const ID = new Uint8Array(32).fill(7);
const ACCOUNT = { fid: 1234, publicKey: '03'.repeat(32) };
const b64 = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (value: Uint8Array) => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer;
const descriptor = (): PasskeyDescriptor => ({ origin: ORIGIN, rpId: 'opencaster.org', credentialId: b64(ID), prfSalt: '08'.repeat(32), userHandle: '09'.repeat(32) });

class SyntheticCredential {
  type = 'public-key';
  id = b64(ID);
  rawId = ID.slice().buffer;
  response: Record<string, unknown> = {};
  outputs: AuthenticationExtensionsClientOutputs = {};
  getClientExtensionResults() { return this.outputs; }
}
async function authenticator(rpId: string, flags: number, creation = false): Promise<ArrayBuffer> {
  const value = new Uint8Array(creation ? 56 + ID.length : 37);
  value.set(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId))));
  value[32] = flags;
  if (creation) { value[54] = ID.length; value.set(ID, 55); value[value.length - 1] = 0xa0; }
  return value.buffer;
}

let create: ReturnType<typeof vi.fn>, get: ReturnType<typeof vi.fn>, fetch: ReturnType<typeof vi.fn>;
let userHandle: ArrayBuffer;
let first: Uint8Array<ArrayBuffer>, second: Uint8Array<ArrayBuffer>;
let lastAssertion: SyntheticCredential;

beforeEach(() => {
  vi.stubGlobal('PublicKeyCredential', SyntheticCredential);
  vi.stubGlobal('location', { origin: ORIGIN });
  vi.stubGlobal('isSecureContext', true);
  userHandle = new Uint8Array(32).fill(9).buffer;
  first = new Uint8Array(32).fill(42); second = new Uint8Array(32).fill(43);
  create = vi.fn().mockImplementation(async (options: CredentialCreationOptions) => {
    const requested = options.publicKey!;
    userHandle = new Uint8Array(requested.user.id as ArrayBuffer).slice().buffer;
    const result = new SyntheticCredential();
    const data = await authenticator(requested.rp.id!, 0x45, true);
    result.response = { clientDataJSON: json({ type: 'webauthn.create', origin: ORIGIN, challenge: b64(new Uint8Array(requested.challenge as ArrayBuffer)), crossOrigin: false }), getAuthenticatorData: () => data };
    result.outputs = { prf: { enabled: true }, credProps: { rk: true } };
    return result;
  });
  get = vi.fn().mockImplementation(async (options: CredentialRequestOptions) => {
    const requested = options.publicKey!;
    const result = new SyntheticCredential();
    result.response = { clientDataJSON: json({ type: 'webauthn.get', origin: ORIGIN, challenge: b64(new Uint8Array(requested.challenge as ArrayBuffer)), crossOrigin: false }), authenticatorData: await authenticator(requested.rpId!, 0x05), signature: new Uint8Array(64).fill(11).buffer, userHandle: userHandle.slice(0) };
    result.outputs = { prf: { results: { first: first.buffer, second: second.buffer } } };
    lastAssertion = result;
    return result;
  });
  vi.stubGlobal('navigator', { credentials: { create, get } });
  fetch = vi.fn(() => { throw new Error('Passkeys must not call a server.'); });
  vi.stubGlobal('fetch', fetch);
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('local WebAuthn PRF unlock', () => {
  it('requests a resident UV passkey immediately on the button stack, then proves PRF with a fresh get challenge', async () => {
    const pending = enrollPasskey({ origin: ORIGIN, account: ACCOUNT });
    expect(create).toHaveBeenCalledOnce(); // No async work precedes the native prompt.
    const { descriptor: saved, prfSecret } = await pending;
    expect(saved).toMatchObject({ origin: ORIGIN, rpId: 'opencaster.org', credentialId: b64(ID) });
    expect(saved.prfSalt).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.userHandle).toBe(hex(new Uint8Array(userHandle)));
    expect(prfSecret).toEqual(new Uint8Array(32).fill(42));
    expect(first.every(byte => byte === 0) && second.every(byte => byte === 0)).toBe(true);
    const creation = create.mock.calls[0][0].publicKey;
    const assertion = get.mock.calls[0][0].publicKey;
    expect(creation.rp).toEqual({ id: 'opencaster.org', name: 'Opencaster on Hypersnap' });
    expect(creation.user.displayName).toBe('Opencaster FID 1234');
    expect(creation.authenticatorSelection).toEqual({ residentKey: 'required', requireResidentKey: true, userVerification: 'required' });
    expect(creation.attestation).toBe('none');
    expect(creation.extensions).toEqual({ prf: {}, credProps: true });
    expect(assertion.userVerification).toBe('required');
    expect(assertion.allowCredentials).toEqual([{ type: 'public-key', id: ID }]);
    expect(hex(assertion.extensions.prf.eval.first)).toBe(saved.prfSalt);
    expect(assertion.challenge).not.toEqual(creation.challenge);
    prfSecret.fill(0);
  });

  it('uses only PRF output, never the assertion signature, and invokes get synchronously', async () => {
    const pending = evaluatePasskey(descriptor(), { origin: ORIGIN });
    expect(get).toHaveBeenCalledOnce();
    const secret = await pending;
    expect(secret).toEqual(new Uint8Array(32).fill(42));
    expect(secret).not.toEqual(new Uint8Array(lastAssertion.response.signature as ArrayBuffer).slice(0, 32));
    secret.fill(0);
  });

  it('validates public descriptors without touching browser APIs and binds the exact origin including port', () => {
    const local = { ...descriptor(), origin: 'http://localhost:5173', rpId: 'localhost' };
    expect(validatePasskeyDescriptor(local)).toEqual(local);
    expect(() => validatePasskeyDescriptor(local, 'http://localhost:5187')).toThrow();
    for (const bad of [
      { ...descriptor(), extra: 'untrusted' }, { ...descriptor(), rpId: 'arca.computer' },
      { ...descriptor(), origin: 'http://opencaster.org' }, { ...descriptor(), credentialId: b64(ID) + '=' },
      { ...descriptor(), credentialId: 'A' }, { ...descriptor(), prfSalt: '01' }, { ...descriptor(), userHandle: '01' },
    ]) expect(() => validatePasskeyDescriptor(bad)).toThrow();
    expect(create).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  });

  it('does not reuse a legacy-domain passkey on the new canonical website', async () => {
    const legacy = { ...descriptor(), origin: 'https://quorum.arca.computer', rpId: 'quorum.arca.computer' };
    expect(validatePasskeyDescriptor(legacy)).toEqual(legacy);
    expect(() => validatePasskeyDescriptor(legacy, ORIGIN)).toThrow();
    await expect(evaluatePasskey(legacy, { origin: ORIGIN })).rejects.toThrow();
    expect(get).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });

  it('reports generic API availability without claiming that every provider supports PRF', async () => {
    expect(passkeysAvailable()).toBe(true);
    const original = create.getMockImplementation()!;
    create.mockImplementation(async options => { const result = await original(options); result.outputs = { prf: { enabled: false } }; return result; });
    await expect(enrollPasskey({ origin: ORIGIN, account: ACCOUNT })).rejects.toMatchObject({ code: 'unsupported' });
    expect(get).not.toHaveBeenCalled();
    vi.stubGlobal('isSecureContext', false);
    expect(passkeysAvailable()).toBe(false);
    await expect(evaluatePasskey(descriptor(), { origin: ORIGIN })).rejects.toMatchObject({ code: 'unsupported' });
  });

  it.each(['missing', 'short', 'disabled'])('rejects a provider without a usable PRF output: %s', async mode => {
    const original = get.getMockImplementation()!;
    get.mockImplementation(async options => {
      const result = await original(options);
      if (mode === 'missing') result.outputs = { prf: {} };
      else if (mode === 'short') { first = new Uint8Array(31).fill(42); result.outputs = { prf: { results: { first: first.buffer } } }; }
      else result.outputs.prf!.enabled = false;
      return result;
    });
    await expect(evaluatePasskey(descriptor(), { origin: ORIGIN })).rejects.toMatchObject({ code: 'unsupported' });
    if (mode !== 'missing') expect(first.every(byte => byte === 0)).toBe(true);
  });

  it.each(['type', 'challenge', 'origin', 'crossOrigin', 'topOrigin'])('rejects mismatched client data and clears PRF output: %s', async field => {
    const original = get.getMockImplementation()!;
    get.mockImplementation(async options => {
      const result = await original(options);
      const data = JSON.parse(new TextDecoder().decode(result.response.clientDataJSON as ArrayBuffer));
      data[field] = field === 'crossOrigin' ? true : field === 'type' ? 'webauthn.create' : field === 'challenge' ? b64(new Uint8Array(32)) : 'https://attacker.test';
      result.response.clientDataJSON = json(data);
      return result;
    });
    await expect(evaluatePasskey(descriptor(), { origin: ORIGIN })).rejects.toMatchObject({ code: 'invalid_response' });
    expect(first.every(byte => byte === 0)).toBe(true);
  });

  it.each([0x00, 0x01, 0x04, 0x45])('rejects assertion data without both UP/UV or with creation-only flags: %i', async flags => {
    const original = get.getMockImplementation()!;
    get.mockImplementation(async options => { const result = await original(options); result.response.authenticatorData = await authenticator('opencaster.org', flags); return result; });
    await expect(evaluatePasskey(descriptor(), { origin: ORIGIN })).rejects.toMatchObject({ code: 'invalid_response' });
    expect(first.every(byte => byte === 0)).toBe(true);
  });

  it('rejects incorrect RP hashes, credential IDs and user handles', async () => {
    const original = get.getMockImplementation()!;
    for (const mismatch of ['rp', 'id', 'handle']) {
      first = new Uint8Array(32).fill(42);
      get.mockImplementation(async options => {
        const result = await original(options);
        if (mismatch === 'rp') result.response.authenticatorData = await authenticator('attacker.test', 0x05);
        if (mismatch === 'id') { result.rawId = new Uint8Array(32).fill(6).buffer; result.id = b64(new Uint8Array(result.rawId)); }
        if (mismatch === 'handle') result.response.userHandle = new Uint8Array(32).fill(6).buffer;
        return result;
      });
      await expect(evaluatePasskey(descriptor(), { origin: ORIGIN })).rejects.toMatchObject({ code: 'invalid_response' });
      expect(first.every(byte => byte === 0)).toBe(true);
    }
  });

  it('accepts a null optional assertion userHandle only with the exact allowlisted credential', async () => {
    const original = get.getMockImplementation()!;
    get.mockImplementation(async options => { const result = await original(options); result.response.userHandle = null; return result; });
    const secret = await evaluatePasskey(descriptor(), { origin: ORIGIN });
    expect(secret).toEqual(new Uint8Array(32).fill(42)); secret.fill(0);
  });

  it('requires registration UP/UV and a matching attested credential ID before getting any secret', async () => {
    const original = create.getMockImplementation()!;
    for (const flags of [0x41, 0x44, 0x05]) {
      create.mockImplementation(async options => {
        const result = await original(options);
        const data = await authenticator('opencaster.org', flags, true);
        result.response.getAuthenticatorData = () => data;
        return result;
      });
      await expect(enrollPasskey({ origin: ORIGIN, account: ACCOUNT })).rejects.toMatchObject({ code: 'invalid_response' });
    }
    create.mockImplementation(async options => {
      const result = await original(options);
      const data = new Uint8Array(await authenticator('opencaster.org', 0x45, true)); data[55] ^= 1;
      result.response.getAuthenticatorData = () => data.buffer;
      return result;
    });
    await expect(enrollPasskey({ origin: ORIGIN, account: ACCOUNT })).rejects.toMatchObject({ code: 'invalid_response' });
    expect(get).not.toHaveBeenCalled();
  });

  it('clears any creation-time PRF output and still evaluates the credential separately', async () => {
    const creationSecret = new Uint8Array(32).fill(55);
    const original = create.getMockImplementation()!;
    create.mockImplementation(async options => { const result = await original(options); result.outputs.prf!.results = { first: creationSecret.buffer }; return result; });
    const result = await enrollPasskey({ origin: ORIGIN, account: ACCOUNT });
    expect(creationSecret.every(byte => byte === 0)).toBe(true);
    expect(result.prfSecret).toEqual(new Uint8Array(32).fill(42)); result.prfSecret.fill(0);
  });

  it('rejects changed origins after a response without retaining its PRF output', async () => {
    const original = get.getMockImplementation()!;
    get.mockImplementation(async options => { const result = await original(options); vi.stubGlobal('location', { origin: 'https://attacker.test' }); return result; });
    await expect(evaluatePasskey(descriptor(), { origin: ORIGIN })).rejects.toMatchObject({ code: 'origin_changed' });
    expect(first.every(byte => byte === 0)).toBe(true);
  });

  it('does not start a prompt for an already-cancelled request', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(enrollPasskey({ origin: ORIGIN, account: ACCOUNT, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(create).not.toHaveBeenCalled();
  });

  it('cancels immediately even when a provider resolves late, and clears late output', async () => {
    const original = get.getMockImplementation()!;
    let deliver!: (value: SyntheticCredential) => void;
    let requested: CredentialRequestOptions;
    get.mockImplementation(options => { requested = options; return new Promise(resolve => { deliver = resolve; }); });
    const controller = new AbortController();
    const pending = evaluatePasskey(descriptor(), { origin: ORIGIN, signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await assertion;
    const result = await original(requested!); deliver(result);
    await Promise.resolve();
    expect(first.every(byte => byte === 0) && second.every(byte => byte === 0)).toBe(true);
  });

  it('ignores a late cancelled creation, wipes its output and never starts an unlock or returns a descriptor', async () => {
    const original = create.getMockImplementation()!;
    const lateSecret = new Uint8Array(32).fill(55);
    let requested: CredentialCreationOptions;
    let deliver!: (value: SyntheticCredential) => void;
    create.mockImplementation(options => { requested = options; return new Promise(resolve => { deliver = resolve; }); });
    const controller = new AbortController();
    const pending = enrollPasskey({ origin: ORIGIN, account: ACCOUNT, signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await assertion;
    const created = await original(requested!); created.outputs.prf!.results = { first: lateSecret.buffer };
    deliver(created); await Promise.resolve();
    expect(lateSecret.every(byte => byte === 0)).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  it('copies and clears a typed PRF result view without retaining its secret buffer', async () => {
    const original = get.getMockImplementation()!;
    const storage = new Uint8Array(34).fill(7); const view = storage.subarray(1, 33); view.fill(42);
    get.mockImplementation(async options => { const result = await original(options); result.outputs = { prf: { results: { first: view } } }; return result; });
    const secret = await evaluatePasskey(descriptor(), { origin: ORIGIN });
    expect(secret).toEqual(new Uint8Array(32).fill(42));
    expect(view.every(byte => byte === 0)).toBe(true);
    expect(storage[0]).toBe(7); expect(storage[33]).toBe(7);
    secret.fill(0);
  });

  it('bounds ignored native prompts with a 60-second timeout', async () => {
    vi.useFakeTimers();
    get.mockImplementation(() => new Promise(() => {}));
    const pending = evaluatePasskey(descriptor(), { origin: ORIGIN });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(60_001); await assertion;
    expect(get.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it('turns a native user rejection into cancellation without calling get afterwards', async () => {
    create.mockRejectedValue(new DOMException('Cancelled', 'NotAllowedError'));
    await expect(enrollPasskey({ origin: ORIGIN, account: ACCOUNT })).rejects.toMatchObject({ name: 'AbortError' });
    expect(get).not.toHaveBeenCalled();
  });
});
