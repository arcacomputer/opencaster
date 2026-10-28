import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWalletConnectClient } from './walletConnectSDK';
import { WalletConnectMemoryStorage, type WalletConnectClientOptions } from './walletConnect';

const sdk = vi.hoisted(() => ({ initialize: vi.fn(), cores: [] as unknown[], flags: [] as unknown[] }));
vi.mock('@walletconnect/core', () => ({ Core: class {
  heartbeat = { stop: vi.fn() };
  relayer = { transportClose: vi.fn(async () => {}) };
  keychain = new Map<string, string>([['seed', 'synthetic relay seed']]);
  crypto = { keychain: { keychain: this.keychain, del: vi.fn(async (key: string) => { this.keychain.delete(key); }) } };
  pairing = { getPairings: () => [], pairings: { delete: vi.fn(async () => {}) }, disconnect: vi.fn(async () => {}) };
  constructor(options: Record<string, unknown>) {
    // Model the exact public Core global-cache guard in the pinned SDK.
    const disabled = typeof process !== 'undefined' && process.env.DISABLE_GLOBAL_CORE === 'true';
    sdk.flags.push(disabled);
    if (!disabled) Object.defineProperty(globalThis, `_walletConnectCore_${String(options.customStoragePrefix)}`, { value: this, configurable: true });
    sdk.cores.push(this);
  }
} }));
vi.mock('@walletconnect/sign-client', () => ({ SignClient: { init: (options: unknown) => sdk.initialize(options) } }));

type FakeCore = { heartbeat: { stop: ReturnType<typeof vi.fn> }; relayer: { transportClose: ReturnType<typeof vi.fn> }; keychain: Map<string, string> };
function client() {
  return { session: { getAll: () => [], get: () => { throw new Error('No session'); }, delete: vi.fn() }, connect: vi.fn(), request: vi.fn(), disconnect: vi.fn(), on: vi.fn(), off: vi.fn() };
}
function options(signal = new AbortController().signal): WalletConnectClientOptions {
  return { projectId: '12'.repeat(16), storage: new WalletConnectMemoryStorage(), customStoragePrefix: `test-${crypto.randomUUID()}`, logger: 'silent', telemetryEnabled: false, metadata: { name: 'Test', description: 'Synthetic test', url: 'https://quorum.arca.computer', icons: [] }, signal };
}
let originalProcess: PropertyDescriptor | undefined;
let originalFlag: PropertyDescriptor | undefined;
beforeEach(() => {
  sdk.cores.length = 0; sdk.flags.length = 0; sdk.initialize.mockReset(); sdk.initialize.mockResolvedValue(client());
  originalProcess = Object.getOwnPropertyDescriptor(globalThis, 'process');
  originalFlag = Object.getOwnPropertyDescriptor(process.env, 'DISABLE_GLOBAL_CORE');
});
afterEach(() => {
  if (originalProcess) Object.defineProperty(globalThis, 'process', originalProcess);
  if (originalFlag) Object.defineProperty(process.env, 'DISABLE_GLOBAL_CORE', originalFlag); else delete process.env.DISABLE_GLOBAL_CORE;
});

describe('WalletConnect SDK global-cache isolation', () => {
  it('sets the documented nonsecret flag only during construction/init and restores the real Node environment', async () => {
    const before = Object.getOwnPropertyDescriptor(process.env, 'DISABLE_GLOBAL_CORE');
    const unrelated = process.env.PATH;
    const configuration = options();
    const result = await createWalletConnectClient(configuration);
    expect(sdk.flags).toEqual([true]);
    expect(Object.hasOwn(globalThis, `_walletConnectCore_${configuration.customStoragePrefix}`)).toBe(false);
    expect(Object.getOwnPropertyDescriptor(globalThis, 'process')).toEqual(originalProcess);
    expect(Object.getOwnPropertyDescriptor(process.env, 'DISABLE_GLOBAL_CORE')).toEqual(before);
    expect(process.env.PATH).toBe(unrelated);
    await result.clearLocalState();
    expect((sdk.cores[0] as FakeCore).keychain.size).toBe(0);
  });

  it('creates and removes the temporary browser shim without retaining a process global', async () => {
    Reflect.deleteProperty(globalThis, 'process');
    let result;
    // eslint-disable-next-line no-useless-assignment -- Keep a fail-closed sentinel until the post-initialization check completes.
    let retainedProcess = true;
    try { result = await createWalletConnectClient(options()); retainedProcess = Object.hasOwn(globalThis, 'process'); }
    finally { if (originalProcess) Object.defineProperty(globalThis, 'process', originalProcess); }
    expect(sdk.flags).toEqual([true]);
    expect(result).toBeDefined();
    expect(retainedProcess).toBe(false);
    expect(Object.getOwnPropertyDescriptor(globalThis, 'process')).toEqual(originalProcess);
  });

  it('restores an existing browser process object whose env was initially absent', async () => {
    const fake = { custom: 'must remain' };
    Object.defineProperty(globalThis, 'process', { value: fake, configurable: true, writable: true });
    try { await createWalletConnectClient(options()); }
    finally { if (originalProcess) Object.defineProperty(globalThis, 'process', originalProcess); }
    expect(fake.custom).toBe('must remain');
    expect(Object.hasOwn(fake, 'env')).toBe(false);
    expect(sdk.flags).toEqual([true]);
  });

  it('fails closed for an immutable conflicting flag and preserves its descriptor', async () => {
    const env = {};
    Object.defineProperty(env, 'DISABLE_GLOBAL_CORE', { value: 'false', writable: false, configurable: false });
    const fake = { env };
    Object.defineProperty(globalThis, 'process', { value: fake, configurable: true, writable: true });
    let failure: unknown;
    try { await createWalletConnectClient(options()); } catch (error) { failure = error; }
    finally { if (originalProcess) Object.defineProperty(globalThis, 'process', originalProcess); }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('incompatible SDK configuration');
    expect(Object.getOwnPropertyDescriptor(env, 'DISABLE_GLOBAL_CORE')).toEqual({ value: 'false', writable: false, configurable: false, enumerable: false });
    expect(sdk.cores).toHaveLength(0);
  });

  it('restores the environment on initialization failure and closes startup transport/keys', async () => {
    sdk.initialize.mockRejectedValueOnce(new Error('Synthetic startup failure'));
    await expect(createWalletConnectClient(options())).rejects.toThrow('Synthetic startup failure');
    expect(Object.getOwnPropertyDescriptor(process.env, 'DISABLE_GLOBAL_CORE')).toEqual(originalFlag);
    const core = sdk.cores[0] as FakeCore;
    await vi.waitFor(() => expect(core.keychain.size).toBe(0));
    expect(core.heartbeat.stop).toHaveBeenCalled(); expect(core.relayer.transportClose).toHaveBeenCalled();
  });

  it('serializes concurrent initializations so flag restoration cannot enable another Core global', async () => {
    let finish!: (value: unknown) => void;
    sdk.initialize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = createWalletConnectClient(options());
    await vi.waitFor(() => expect(sdk.initialize).toHaveBeenCalledOnce());
    const second = createWalletConnectClient(options());
    await Promise.resolve(); expect(sdk.initialize).toHaveBeenCalledOnce();
    finish(client()); await Promise.all([first, second]);
    expect(sdk.flags).toEqual([true, true]);
    expect(Object.getOwnPropertyDescriptor(process.env, 'DISABLE_GLOBAL_CORE')).toEqual(originalFlag);
  });

  it('cancels pending startup promptly, restores the flag, and clears late initialization keys', async () => {
    let finish!: (value: unknown) => void;
    sdk.initialize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const operation = expect(createWalletConnectClient(options(controller.signal))).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(sdk.initialize).toHaveBeenCalledOnce());
    controller.abort(); await operation;
    expect(Object.getOwnPropertyDescriptor(process.env, 'DISABLE_GLOBAL_CORE')).toEqual(originalFlag);
    const core = sdk.cores[0] as FakeCore;
    await vi.waitFor(() => expect(core.keychain.size).toBe(0));
    core.keychain.set('late seed', 'synthetic'); finish(client());
    await vi.waitFor(() => expect(core.keychain.size).toBe(0));
    expect(core.relayer.transportClose).toHaveBeenCalled();
  });
});
