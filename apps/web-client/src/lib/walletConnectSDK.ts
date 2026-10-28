import type { WalletConnectClient, WalletConnectClientOptions } from './walletConnect';

// WalletConnect Core's documented DISABLE_GLOBAL_CORE flag is read through
// `process.env`, including in its browser bundle. This nonsecret compatibility
// shim is scoped to SDK import/initialization and restores every prior field.
// Initialization is serialized so concurrent approvals cannot restore each
// other's flag or expose SDK Core objects through its default global cache.
let initialization: Promise<void> = Promise.resolve();

function disableGlobalCore(): () => void {
  const target = globalThis as typeof globalThis & { process?: unknown };
  const processDescriptor = Object.getOwnPropertyDescriptor(target, 'process');
  let processValue: unknown;
  try { processValue = target.process; } catch { throw new Error('Wallet connection initialization is unavailable in this browser.'); }
  if (processValue === undefined) {
    if (processDescriptor && !processDescriptor.configurable) throw new Error('Wallet connection initialization is unavailable in this browser.');
    Object.defineProperty(target, 'process', { value: { env: { DISABLE_GLOBAL_CORE: 'true' } }, writable: true, configurable: true, enumerable: false });
    return () => { if (processDescriptor) Object.defineProperty(target, 'process', processDescriptor); else Reflect.deleteProperty(target, 'process'); };
  }
  if (!processValue || typeof processValue !== 'object') throw new Error('Wallet connection initialization is unavailable in this browser.');
  const processObject = processValue as { env?: unknown };
  const envDescriptor = Object.getOwnPropertyDescriptor(processObject, 'env');
  let environment: unknown;
  try { environment = processObject.env; } catch { throw new Error('Wallet connection initialization is unavailable in this browser.'); }
  if (environment === undefined) {
    if (envDescriptor && !envDescriptor.configurable) throw new Error('Wallet connection initialization is unavailable in this browser.');
    Object.defineProperty(processObject, 'env', { value: { DISABLE_GLOBAL_CORE: 'true' }, writable: true, configurable: true, enumerable: true });
    return () => { if (envDescriptor) Object.defineProperty(processObject, 'env', envDescriptor); else Reflect.deleteProperty(processObject, 'env'); };
  }
  if (!environment || typeof environment !== 'object') throw new Error('Wallet connection initialization is unavailable in this browser.');
  const env = environment as Record<string, unknown>;
  const flag = Object.getOwnPropertyDescriptor(env, 'DISABLE_GLOBAL_CORE');
  if (flag && !flag.configurable && (!('value' in flag) || !flag.writable)) {
    if ('value' in flag && flag.value === 'true') return () => {};
    throw new Error('Wallet connection initialization is blocked by an incompatible SDK configuration.');
  }
  // Node's process.env supports writable/configurable/enumerable data entries;
  // preserving its descriptor keeps unrelated fields and real Node tests intact.
  Object.defineProperty(env, 'DISABLE_GLOBAL_CORE', { value: 'true', writable: true, configurable: true, enumerable: true });
  return () => { if (flag) Object.defineProperty(env, 'DISABLE_GLOBAL_CORE', flag); else Reflect.deleteProperty(env, 'DISABLE_GLOBAL_CORE'); };
}

export async function createWalletConnectClient(options: WalletConnectClientOptions): Promise<WalletConnectClient> {
  let release!: () => void;
  const previous = initialization;
  initialization = new Promise(resolve => { release = resolve; });
  await previous;
  let restore: (() => void) | undefined;
  let closeCore: (() => Promise<void>) | undefined;
  let removeAbort: (() => void) | undefined;
  try {
    if (options.signal.aborted) throw new DOMException('Wallet connection cancelled.', 'AbortError');
    const [{ SignClient }, { Core }] = await Promise.all([import('@walletconnect/sign-client'), import('@walletconnect/core')]);
    if (options.signal.aborted) throw new DOMException('Wallet connection cancelled.', 'AbortError');
    // Imports create no Core. Install the guard immediately before construction
    // so a stalled chunk download cannot leave a temporary process shim behind.
    restore = disableGlobalCore();
    const { signal: _signal, ...configuration } = options;
    const core = new Core(configuration);
    const clearKeys = async () => {
      // Published KeyChain APIs drop local relay/session secrets independently
      // of whether the relay acknowledged a disconnection. Strings remain
      // subject to normal JavaScript memory limitations.
      for (const tag of [...core.crypto.keychain.keychain.keys()]) {
        try { await core.crypto.keychain.del(tag); } catch { /* A failed initialization may not have a writable store. */ }
      }
      core.crypto.keychain.keychain.clear();
    };
    closeCore = async () => {
      try { core.heartbeat.stop(); } catch { /* It may not have started. */ }
      try { await core.relayer.transportClose(); } catch { /* Local key erasure must still run. */ }
      await clearKeys();
    };
    const cancelled = () => { void closeCore?.(); };
    options.signal.addEventListener('abort', cancelled, { once: true });
    removeAbort = () => options.signal.removeEventListener('abort', cancelled);
    const initialization = SignClient.init({ ...configuration, core });
    const client = await new Promise<Awaited<typeof initialization>>((resolve, reject) => {
      const abort = () => { options.signal.removeEventListener('abort', abort); reject(new DOMException('Wallet connection cancelled.', 'AbortError')); };
      if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
      initialization.then(value => { options.signal.removeEventListener('abort', abort); if (options.signal.aborted) void closeCore?.(); resolve(value); }, error => { options.signal.removeEventListener('abort', abort); reject(error); });
    });
    // A unique prefix prevents cross-approval collisions. The SDK flag above
    // must also prevent even this private core from entering the page globals.
    const key = `_walletConnectCore_${options.customStoragePrefix}`;
    if (Object.hasOwn(globalThis, key)) { Reflect.deleteProperty(globalThis, key); throw new Error('The SDK global-cache policy could not be enforced.'); }
    return {
      session: { getAll: () => client.session.getAll(), get: topic => client.session.get(topic) },
      core: { pairing: { getPairings: () => core.pairing.getPairings(), disconnect: params => core.pairing.disconnect(params) }, relayer: { transportClose: () => core.relayer.transportClose() }, heartbeat: { stop: () => core.heartbeat.stop() } },
      connect: params => client.connect(params),
      request: params => client.request(params),
      disconnect: params => client.disconnect(params),
      on: (event, listener) => client.on(event as Parameters<typeof client.on>[0], listener),
      off: (event, listener) => client.off(event as Parameters<typeof client.off>[0], listener),
      async clearLocalState() {
        for (const session of client.session.getAll()) { try { await client.session.delete(session.topic, { code: 6000, message: 'This approval is finished.' }); } catch { /* Clear all other records too. */ } }
        for (const pairing of core.pairing.getPairings()) { try { await core.pairing.pairings.delete(pairing.topic, { code: 6000, message: 'This approval is finished.' }); } catch { /* Clear all keys regardless. */ } }
        await clearKeys();
      },
    };
  } catch (error) {
    // This call is intentionally detached: the outer adapter bounds cleanup,
    // while a stalled SDK startup still receives its public close operations.
    void closeCore?.();
    throw error;
  } finally {
    removeAbort?.();
    try { restore?.(); }
    finally { release(); }
  }
}
