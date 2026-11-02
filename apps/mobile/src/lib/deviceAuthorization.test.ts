import { describe, expect, it, vi } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { SignersResponse, User } from '@opencaster/client-core/api';
import { hashPairingRequest, hashRevocationRequest, type PairingRequest, type RevocationRequest } from '@opencaster/client-core/pairing';
import { addressFromCustodyPrivateKey, bytesToHex, hexToBytes, keyAddDigest, keyRemoveDigest, signedKeyRequestDigest, signEip712Digest } from '@opencaster/protocol/signedKeyRequest';
import { DeviceAuthorization, type AuthorizationDependencies } from './deviceAuthorization';

const CUSTODY = hexToBytes('11'.repeat(32));
const NOW = 1_793_600_000_000;
const USER = { fid: 1234, username: 'synthetic', custody_address: addressFromCustodyPrivateKey(CUSTODY) } as User;
const SCOPES = ['MESSAGE_TYPE_CAST_ADD', 'MESSAGE_TYPE_REACTION_ADD', 'MESSAGE_TYPE_REACTION_REMOVE'];

function approval(request: PairingRequest): string {
  const key = hexToBytes(request.publicKey);
  return JSON.stringify({ kind: 'arca.hypersnap.signer.approval', version: 1, requestId: request.requestId,
    requestHash: hashPairingRequest(request), custodyAddress: request.custodyAddress,
    custodySignature: bytesToHex(signEip712Digest(keyAddDigest({ fid: request.fid, key, keyType: 1, scopes: request.scopes, ttl: request.ttl, nonce: request.nonce, deadline: request.deadline }), CUSTODY)),
    requestSignature: bytesToHex(signEip712Digest(signedKeyRequestDigest({ requestFid: request.fid, key, deadline: request.deadline }), CUSTODY)),
  });
}
function revokeApproval(request: RevocationRequest): string {
  return JSON.stringify({ kind: 'arca.hypersnap.signer.revoke.approval', version: 1, requestId: request.requestId,
    requestHash: hashRevocationRequest(request), custodyAddress: request.custodyAddress, signatureType: 1,
    custodySignature: bytesToHex(signEip712Digest(keyRemoveDigest({ fid: request.fid, key: hexToBytes(request.publicKey), nonce: request.nonce, deadline: request.deadline }), CUSTODY)),
  });
}
function setup() {
  let saved: string | null = null;
  let now = NOW;
  let randomValue = 23;
  const randomValues: Uint8Array[] = [];
  const registry: SignersResponse = { signers: [], currentUserNonce: 7 };
  const deps: AuthorizationDependencies = {
    now: () => now,
    randomBytes: vi.fn(async () => {
      const value = new Uint8Array(32).fill(randomValue++);
      randomValues.push(value);
      return value;
    }),
    storage: {
      read: vi.fn(async () => saved),
      write: vi.fn(async value => { saved = value; }),
      remove: vi.fn(async () => { saved = null; }),
    },
    api: {
      getUser: vi.fn(async () => ({ ...USER })),
      getSigners: vi.fn(async () => structuredClone(registry)),
      submitMessage: vi.fn(async () => ({ hash: 'ab'.repeat(20) })),
    },
  };
  const controller = new DeviceAuthorization(deps);
  const prepare = async () => {
    await controller.prepare({ fid: USER.fid, custodyAddress: USER.custody_address });
    return controller.getSnapshot().request!;
  };
  const confirm = (request: PairingRequest) => {
    registry.signers = [{ key: request.publicKey, source: 'SIGNER_SOURCE_OFFCHAIN', requestFid: USER.fid,
      scopes: [...SCOPES], expiresAt: now / 1000 + 604800 }];
    registry.currentUserNonce = request.nonce;
  };
  const register = async () => {
    const request = await prepare();
    vi.mocked(deps.api.submitMessage).mockImplementationOnce(async () => { confirm(request); return {}; });
    await controller.approve(approval(request));
    expect(controller.getSnapshot().authorized).toBe(true);
    return request;
  };
  return { deps, controller, registry, randomValues, prepare, confirm, register, saved: () => saved, advance: (ms: number) => { now += ms; } };
}

describe('native protected device authorization', () => {
  it('keeps the seed out of snapshots, validates real custody signatures and unlocks only after fresh node confirmation', async () => {
    const test = setup();
    const request = await test.register();
    expect(request.scopes).toEqual([1, 3, 4]);
    expect(request.publicKey).toBe(bytesToHex(ed25519.getPublicKey(new Uint8Array(32).fill(23))));
    expect(JSON.stringify(test.controller.getSnapshot())).not.toContain('17'.repeat(32));
    expect(test.saved()).toContain('17'.repeat(32));
    const restarted = new DeviceAuthorization(test.deps);
    expect(restarted.getSnapshot().phase).toBe('locked');
    await restarted.unlock();
    expect(restarted.getSnapshot().authorized).toBe(true);
    test.registry.signers[0].scopes!.push('MESSAGE_TYPE_KEY_ADD');
    restarted.lock();
    await restarted.unlock();
    expect(restarted.getSnapshot().authorized).toBe(false);
    expect(restarted.getSnapshot().error).toMatch(/exact unexpired/);
  });

  it.each(['wrong approval', 'expired', 'custody', 'nonce'] as const)('rejects %s without submitting', async scenario => {
    const test = setup();
    const request = await test.prepare();
    let signed = approval(request);
    if (scenario === 'wrong approval') signed = approval({ ...request, requestId: 'ab'.repeat(32) });
    if (scenario === 'expired') test.advance(901_000);
    if (scenario === 'custody') vi.mocked(test.deps.api.getUser).mockResolvedValue({ ...USER, custody_address: `0x${'22'.repeat(20)}` });
    if (scenario === 'nonce') test.registry.currentUserNonce++;
    await test.controller.approve(signed);
    expect(test.deps.api.submitMessage).not.toHaveBeenCalled();
    expect(test.controller.getSnapshot().authorized).toBe(false);
    expect(test.controller.getSnapshot().error).toBeTruthy();
  });

  it('persists uncertainty before a write and never resubmits after transport failure or restart', async () => {
    const test = setup();
    const request = await test.prepare();
    vi.mocked(test.deps.api.submitMessage).mockImplementationOnce(async () => {
      expect(JSON.parse(test.saved()!).stage).toBe('registering');
      throw new Error('transport failure');
    });
    await test.controller.approve(approval(request));
    expect(test.controller.getSnapshot().error).toMatch(/unknown/);
    const restarted = new DeviceAuthorization(test.deps);
    test.advance(901_000);
    await restarted.unlock();
    await restarted.approve(approval(request));
    await restarted.checkAuthorization();
    expect(test.deps.api.submitMessage).toHaveBeenCalledTimes(1);
    expect(restarted.getSnapshot().authorized).toBe(false);
    test.confirm(request);
    await restarted.checkAuthorization();
    expect(restarted.getSnapshot().authorized).toBe(true);
    expect(test.deps.api.submitMessage).toHaveBeenCalledTimes(1);
  });

  it('does not send if protected storage fails while recording submission', async () => {
    const test = setup();
    const request = await test.prepare();
    vi.mocked(test.deps.storage.write).mockRejectedValueOnce(new Error('keystore unavailable'));
    await test.controller.approve(approval(request));
    expect(test.deps.api.submitMessage).not.toHaveBeenCalled();
    expect(test.controller.getSnapshot().phase).toBe('locked');
    expect(test.controller.getSnapshot().error).toMatch(/Protected storage/);
  });

  it('locking during the persistent submission marker prevents the send and session resurrection', async () => {
    const test = setup();
    const request = await test.prepare();
    let finish!: () => void;
    const write = vi.mocked(test.deps.storage.write).getMockImplementation()!;
    vi.mocked(test.deps.storage.write).mockImplementationOnce(async value => {
      await new Promise<void>(resolve => { finish = resolve; });
      // Retain the uncertainty marker as a real native storage operation might.
      await write(value);
      expect(JSON.parse(value).stage).toBe('registering');
    });
    const pending = test.controller.approve(approval(request));
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    test.controller.lock();
    finish();
    await pending;
    expect(test.deps.api.submitMessage).not.toHaveBeenCalled();
    expect(test.controller.getSnapshot()).toMatchObject({ phase: 'locked', authorized: false, busy: false });
  });

  it('zeroes the active seed immediately when locked during an approval read', async () => {
    const test = setup();
    const request = await test.prepare();
    const seed = test.randomValues[0];
    expect([...seed]).toEqual(new Array(32).fill(23));
    let finish!: (value: User) => void;
    vi.mocked(test.deps.api.getUser).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));

    const pending = test.controller.approve(approval(request));
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    test.controller.lock();
    expect([...seed]).toEqual(new Array(32).fill(0));
    finish({ ...USER });
    await pending;

    expect(test.deps.api.submitMessage).not.toHaveBeenCalled();
    expect(test.controller.getSnapshot()).toMatchObject({ phase: 'locked', authorized: false, busy: false });
  });

  it('confirms actual removal rather than expiry, preserving a failed local cleanup for retry', async () => {
    const test = setup();
    await test.register();
    await test.controller.prepareRevocation();
    const request = test.controller.getSnapshot().revocation!;
    await test.controller.approveRevocation(revokeApproval(request));
    expect(test.controller.getSnapshot().phase).toBe('revoking');
    test.registry.signers[0].expiresAt = NOW / 1000 - 1;
    await test.controller.checkRevocation();
    expect(test.deps.storage.remove).not.toHaveBeenCalled();
    test.registry.signers = [];
    vi.mocked(test.deps.storage.remove).mockRejectedValueOnce(new Error('delete failed'));
    await test.controller.checkRevocation();
    expect(test.controller.getSnapshot().error).toMatch(/could not be cleared/);
    await test.controller.checkRevocation();
    expect(test.saved()).toBeNull();
    expect(test.controller.getSnapshot()).toMatchObject({ phase: 'empty', authorized: false });
    expect(test.deps.api.submitMessage).toHaveBeenCalledTimes(2);
  });

  it('cancels only an unsubmitted revocation without deleting or submitting the device key', async () => {
    const test = setup();
    await test.register();
    const seed = JSON.parse(test.saved()!).seed;
    await test.controller.prepareRevocation();
    await test.controller.cancelRevocation();

    expect(JSON.parse(test.saved()!)).toMatchObject({ stage: 'registered', seed });
    expect(JSON.parse(test.saved()!)).not.toHaveProperty('revocation');
    expect(test.controller.getSnapshot()).toMatchObject({ phase: 'registered', authorized: false });
    expect(test.controller.getSnapshot().notice).toMatch(/No network revocation was sent/);
    expect(test.deps.api.submitMessage).toHaveBeenCalledTimes(1);

    await test.controller.prepareRevocation();
    await test.controller.approveRevocation(revokeApproval(test.controller.getSnapshot().revocation!));
    expect(test.controller.getSnapshot().phase).toBe('revoking');
    await test.controller.cancelRevocation();
    expect(test.controller.getSnapshot().error).toMatch(/submitted revocation status/);
    expect(JSON.parse(test.saved()!).stage).toBe('revoking');
    expect(test.deps.api.submitMessage).toHaveBeenCalledTimes(2);
  });

  it('distinguishes local forgetting from network revocation and surfaces deletion failure', async () => {
    const test = setup();
    await test.register();
    vi.mocked(test.deps.storage.remove).mockRejectedValueOnce(new Error('delete failed'));
    await test.controller.forget();
    expect(test.saved()).not.toBeNull();
    expect(test.controller.getSnapshot().error).toMatch(/not been forgotten/);
    await test.controller.forget();
    expect(test.saved()).toBeNull();
    expect(test.registry.signers).toHaveLength(1);
    expect(test.controller.getSnapshot().notice).toMatch(/does not revoke/);
    expect(test.deps.api.submitMessage).toHaveBeenCalledTimes(1);
  });
});
