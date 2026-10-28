import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashTypedData } from 'viem';
import { approvePairingWithWallet, approveRevocationWithWallet, type WalletProvider } from './wallet';
import { addressFromCustodyPrivateKey, bytesToHex, hexToBytes, signEip712Digest } from '@opencaster/protocol/signedKeyRequest';
import { FULL_CLIENT_SCOPES, FULL_SOCIAL_SCOPES, verifyPairingApproval, verifyRevocationApproval, type PairingRequest, type RevocationRequest } from '@opencaster/client-core/pairing';
import { withWalletConnect, WALLETCONNECT_SETUP_TIMEOUT_MS, WalletConnectMemoryStorage, type WalletConnectClient, type WalletConnectClientFactory, type WalletConnectClientOptions, type WalletConnectSession } from './walletConnect';

const privateKey = hexToBytes('01'.repeat(32)); // synthetic fixture, no real account
const custody = addressFromCustodyPrivateKey(privateKey);
const PROJECT = '12'.repeat(16);
const TOPIC = 'ab'.repeat(32);
const PAIRING = 'cd'.repeat(32);
const URI = `wc:${PAIRING}@2?relay-protocol=irn&symKey=${'ef'.repeat(32)}`;
function request(): PairingRequest {
  const createdAt = Math.floor(Date.now() / 1000);
  return { kind: 'arca.hypersnap.signer.request', version: 1, origin: 'https://opencaster.org', requestId: '23'.repeat(32), createdAt, fid: 1234, custodyAddress: custody, publicKey: '34'.repeat(32), scopes: [1, 3, 4], ttl: 604800, nonce: 9, deadline: createdAt - 1609459200 + 900 };
}
function harness() {
  let connected = false;
  let paired = true;
  const session: WalletConnectSession = { topic: TOPIC, expiry: Math.floor(Date.now() / 1000) + 3600, namespaces: { eip155: { accounts: [`eip155:1:${custody}`], methods: ['eth_signTypedData_v4'], chains: ['eip155:1'], events: [] } } };
  const listeners = new Map<string, (event: unknown) => void>();
  let configuration!: WalletConnectClientOptions;
  const approve = vi.fn(async () => { connected = true; return session; });
  const connect = vi.fn(async () => ({ uri: URI, approval: approve }));
  const sdkRequest = vi.fn<WalletConnectClient['request']>(async params => {
    const typed = JSON.parse(params.request.params[1] as string);
    return `0x${bytesToHex(signEip712Digest(hexToBytes(hashTypedData(typed)), privateKey))}`;
  });
  const disconnect = vi.fn(async () => { connected = false; });
  const pairingDisconnect = vi.fn(async () => { paired = false; });
  const close = vi.fn(async () => {});
  const stop = vi.fn();
  const clear = vi.fn(async () => { connected = false; paired = false; });
  const client: WalletConnectClient = {
    session: { getAll: () => connected ? [session] : [], get: () => session },
    core: { pairing: { getPairings: () => paired ? [{ topic: PAIRING }] : [], disconnect: pairingDisconnect }, relayer: { transportClose: close }, heartbeat: { stop } },
    connect, request: sdkRequest, disconnect,
    on: (event, listener) => { listeners.set(event, listener); }, off: event => { listeners.delete(event); },
    clearLocalState: clear,
  };
  const factory = vi.fn<WalletConnectClientFactory>(async options => { configuration = options; await options.storage.setItem('ephemeral-relay-key', 'synthetic'); return client; });
  return { session, client, factory, approve, connect, sdkRequest, disconnect, pairingDisconnect, close, stop, clear, listeners, configuration: () => configuration, restoreSession: () => { connected = true; } };
}
afterEach(() => { vi.useRealTimers(); });

describe('temporary signature-only WalletConnect sessions', () => {
  it.each([{ selected: FULL_SOCIAL_SCOPES }, { selected: FULL_CLIENT_SCOPES }])('permits the exact reviewed scope set %j and erases the temporary connection afterwards', async ({ selected }) => {
    const h = harness(); const req = { ...request(), scopes: [...selected] };
    const approval = await withWalletConnect({ projectId: PROJECT, custodyAddress: custody, request: req, onUri: () => {} }, provider => approvePairingWithWallet(req, provider), h.factory);
    expect(() => verifyPairingApproval(req, approval)).not.toThrow();
    expect(JSON.parse(h.sdkRequest.mock.calls[0][0].request.params[1] as string).message.scopes).toEqual(selected);
    expect(h.sdkRequest).toHaveBeenCalledTimes(2);
    expect(h.clear).toHaveBeenCalledOnce();
  });
  it('authorizes the exact posting key with real synthetic signatures and disconnects/erases everything after approval', async () => {
    const h = harness(); const req = request(); const uris: Array<string | null> = []; const sign = vi.fn();
    const approval = await withWalletConnect({ projectId: PROJECT, custodyAddress: custody, request: req, onUri: uri => uris.push(uri), onSignRequest: sign }, provider => approvePairingWithWallet(req, provider), h.factory);
    expect(() => verifyPairingApproval(req, approval)).not.toThrow();
    expect(h.connect).toHaveBeenCalledWith({ optionalNamespaces: { eip155: { chains: ['eip155:1'], methods: ['eth_signTypedData_v4'], events: [] } } });
    expect(h.sdkRequest).toHaveBeenCalledTimes(2);
    expect(h.sdkRequest.mock.calls.every(([params]) => params.chainId === 'eip155:1' && params.expiry === 300)).toBe(true);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(uris[0]).toBe(URI); expect(uris.at(-1)).toBeNull();
    expect(h.disconnect).toHaveBeenCalledOnce(); expect(h.pairingDisconnect).toHaveBeenCalledOnce();
    expect(h.close).toHaveBeenCalledOnce(); expect(h.stop).toHaveBeenCalledOnce(); expect(h.clear).toHaveBeenCalledOnce();
    expect(h.listeners.size).toBe(0);
    const config = h.configuration();
    expect(config.metadata).toEqual({ name: 'Opencaster', description: 'Approve one Hypersnap posting-key operation. No wallet transaction.', url: req.origin, icons: [`${req.origin}/opencaster-symbol.svg`] });
    expect(config.telemetryEnabled).toBe(false); expect(config.logger).toBe('silent');
    expect(config.customStoragePrefix).toMatch(/^arca-/);
    expect(await config.storage.getKeys()).toEqual([]);
    await config.storage.setItem('late-sdk-write', 'must not persist');
    expect(await config.storage.getKeys()).toEqual([]);
  });

  it('uses the same isolated flow for custody revocation and the actual request origin', async () => {
    const h = harness(); const { scopes: _scopes, ttl: _ttl, ...base } = request();
    const req: RevocationRequest = { ...base, origin: 'https://hypersnap-quorum.lf-e32.workers.dev', kind: 'arca.hypersnap.signer.revoke.request' };
    const approval = await withWalletConnect({ projectId: PROJECT, custodyAddress: custody, request: req, onUri: () => {} }, provider => approveRevocationWithWallet(req, provider), h.factory);
    expect(() => verifyRevocationApproval(req, approval)).not.toThrow();
    expect(h.sdkRequest).toHaveBeenCalledOnce();
    expect(JSON.parse(h.sdkRequest.mock.calls[0][0].request.params[1] as string).primaryType).toBe('KeyRemove');
    expect(h.configuration().metadata.url).toBe(req.origin);
  });

  it('fails closed before loading the SDK when the public project ID or request account is wrong', async () => {
    const h = harness(); const action = vi.fn();
    await expect(withWalletConnect({ projectId: '', custodyAddress: custody, request: request(), onUri: () => {} }, action, h.factory)).rejects.toThrow('not configured');
    await expect(withWalletConnect({ projectId: PROJECT, custodyAddress: `0x${'00'.repeat(20)}`, request: request(), onUri: () => {} }, action, h.factory)).rejects.toThrow('does not match');
    expect(h.factory).not.toHaveBeenCalled(); expect(action).not.toHaveBeenCalled();
  });

  it('rejects wrong custody, non-mainnet sessions and broader transaction/event permissions before any signing', async () => {
    for (const variant of ['custody', 'chain', 'method', 'event', 'namespace', 'expired']) {
      const h = harness(); const ns = h.session.namespaces.eip155;
      if (variant === 'custody') ns.accounts = [`eip155:1:0x${'00'.repeat(20)}`];
      if (variant === 'chain') ns.chains = ['eip155:8453'];
      if (variant === 'method') ns.methods.push('eth_sendTransaction');
      if (variant === 'event') ns.events.push('chainChanged');
      if (variant === 'namespace') h.session.namespaces.solana = ns;
      if (variant === 'expired') h.session.expiry = 1;
      const action = vi.fn();
      await expect(withWalletConnect({ projectId: PROJECT, custodyAddress: custody, request: request(), onUri: () => {} }, action, h.factory)).rejects.toThrow();
      expect(action).not.toHaveBeenCalled(); expect(h.sdkRequest).not.toHaveBeenCalled();
      expect(h.close).toHaveBeenCalled(); expect(h.clear).toHaveBeenCalled();
    }
  });

  it('rejects restored hidden sessions and never reuses an earlier connection', async () => {
    const h = harness(); h.restoreSession();
    const action = vi.fn();
    await expect(withWalletConnect({ projectId: PROJECT, custodyAddress: custody, request: request(), onUri: () => {} }, action, h.factory)).rejects.toThrow('restored');
    expect(h.connect).not.toHaveBeenCalled(); expect(action).not.toHaveBeenCalled();
    expect(h.disconnect).toHaveBeenCalledOnce(); expect(h.clear).toHaveBeenCalledOnce();
  });

  it('never permits transactions, arbitrary fund permits or additional signing after the reviewed operation', async () => {
    const tx = harness();
    await expect(withWalletConnect({ projectId: PROJECT, custodyAddress: custody, request: request(), onUri: () => {} }, provider => provider.request({ method: 'eth_sendTransaction', params: [] }), tx.factory)).rejects.toThrow('only the displayed');
    expect(tx.sdkRequest).not.toHaveBeenCalled();
    const permit = harness();
    await expect(withWalletConnect({ projectId: PROJECT, custodyAddress: custody, request: request(), onUri: () => {} }, provider => provider.request({ method: 'eth_signTypedData_v4', params: [custody, JSON.stringify({ primaryType: 'Permit', message: { spender: custody } })] }), permit.factory)).rejects.toThrow('only signs');
    expect(permit.sdkRequest).not.toHaveBeenCalled();
    const repeated = harness(); const req = request();
    await expect(withWalletConnect({ projectId: PROJECT, custodyAddress: custody, request: req, onUri: () => {} }, async provider => {
      await approvePairingWithWallet(req, provider);
      return provider.request({ method: 'eth_signTypedData_v4', params: repeated.sdkRequest.mock.calls[0][0].request.params });
    }, repeated.factory)).rejects.toThrow('once');
    expect(repeated.sdkRequest).toHaveBeenCalledTimes(2);
  });

  it('retains no usable provider after a callback returns', async () => {
    const h = harness(); let retained!: WalletProvider;
    await withWalletConnect({ projectId: PROJECT, custodyAddress: custody, request: request(), onUri: () => {} }, async provider => { retained = provider; }, h.factory);
    await expect(retained.request({ method: 'eth_accounts' })).rejects.toThrow();
    expect(h.sdkRequest).not.toHaveBeenCalled();
  });

  it('clears local session/key state even when the relay cannot acknowledge disconnection', async () => {
    const h = harness(); const req = request();
    h.disconnect.mockRejectedValueOnce(new Error('untrusted relay output must never be surfaced'));
    h.pairingDisconnect.mockRejectedValueOnce(new Error('relay offline'));
    await withWalletConnect({ projectId: PROJECT, custodyAddress: custody, request: req, onUri: () => {} }, provider => approvePairingWithWallet(req, provider), h.factory);
    expect(h.close).toHaveBeenCalledOnce(); expect(h.stop).toHaveBeenCalledOnce(); expect(h.clear).toHaveBeenCalledOnce();
    expect(await h.configuration().storage.getKeys()).toEqual([]);
  });

  it('cancels pairing and also cleans up a late wallet approval without invoking the signing callback', async () => {
    const h = harness(); const controller = new AbortController(); const action = vi.fn();
    let finishPairing!: (value: WalletConnectSession) => void;
    const paired = new Promise<WalletConnectSession>(resolve => { finishPairing = resolve; });
    h.approve.mockImplementationOnce(() => paired);
    const operation = expect(withWalletConnect({ projectId: PROJECT, custodyAddress: custody, request: request(), signal: controller.signal, onUri: () => {} }, action, h.factory)).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(h.approve).toHaveBeenCalledOnce());
    controller.abort(); await operation;
    h.restoreSession(); finishPairing(h.session);
    await vi.waitFor(() => expect(h.disconnect).toHaveBeenCalledOnce());
    expect(action).not.toHaveBeenCalled(); expect(h.sdkRequest).not.toHaveBeenCalled();
  });

  it('aborts the first signature prompt without issuing the second and invalidates changed sessions', async () => {
    const h = harness(); const req = request(); const controller = new AbortController();
    h.sdkRequest.mockImplementationOnce(() => new Promise(() => {}));
    const operation = expect(withWalletConnect({ projectId: PROJECT, custodyAddress: custody, request: req, signal: controller.signal, onUri: () => {} }, provider => approvePairingWithWallet(req, provider, { signal: controller.signal }), h.factory)).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(h.sdkRequest).toHaveBeenCalledOnce());
    controller.abort(); await operation;
    expect(h.sdkRequest).toHaveBeenCalledOnce(); expect(h.clear).toHaveBeenCalledOnce();
    // Reuse the reviewed request: regenerating it inside the callback can
    // change its deadline across a second boundary and correctly fail before
    // the SDK receives the signature prompt this test intends to invalidate.
    const changed = harness(); const changedRequest = request(); changed.sdkRequest.mockImplementationOnce(() => new Promise(() => {}));
    const changedOperation = expect(withWalletConnect({ projectId: PROJECT, custodyAddress: custody, request: changedRequest, onUri: () => {} }, provider => approvePairingWithWallet(changedRequest, provider), changed.factory)).rejects.toThrow('session changed');
    await vi.waitFor(() => expect(changed.sdkRequest).toHaveBeenCalledOnce());
    changed.listeners.get('session_update')!({ topic: TOPIC }); await changedOperation;
    expect(changed.sdkRequest).toHaveBeenCalledOnce(); expect(changed.clear).toHaveBeenCalledOnce();
  });

  it('bounds SDK startup and cleans up an SDK that resolves after the UI timed out', async () => {
    vi.useFakeTimers(); const h = harness(); let finish!: (client: WalletConnectClient) => void;
    const factory: WalletConnectClientFactory = async options => { await options.storage.setItem('late', 'ephemeral'); return new Promise(resolve => { finish = resolve; }); };
    const operation = expect(withWalletConnect({ projectId: PROJECT, custodyAddress: custody, request: request(), onUri: () => {} }, vi.fn(), factory)).rejects.toThrow('could not initialize');
    await vi.advanceTimersByTimeAsync(WALLETCONNECT_SETUP_TIMEOUT_MS + 1); await operation;
    finish(h.client); await vi.runAllTimersAsync();
    expect(h.close).toHaveBeenCalledOnce(); expect(h.clear).toHaveBeenCalledOnce();
  });
});

describe('ephemeral relay storage', () => {
  it('clones records and drops all entries permanently when closed', async () => {
    const storage = new WalletConnectMemoryStorage(); const value = { nested: { key: 'synthetic' } };
    await storage.setItem('item', value); value.nested.key = 'changed';
    expect(await storage.getItem('item')).toEqual({ nested: { key: 'synthetic' } });
    const entries = await storage.getEntries<typeof value>(); entries[0][1].nested.key = 'changed again';
    expect(await storage.getItem('item')).toEqual({ nested: { key: 'synthetic' } });
    storage.close(); await storage.setItem('late', 'ignored');
    expect(await storage.getKeys()).toEqual([]); expect(await storage.getItem('item')).toBeUndefined();
  });
});
