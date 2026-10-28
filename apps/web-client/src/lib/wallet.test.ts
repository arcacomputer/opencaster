import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashTypedData } from 'viem';
import { ed25519 } from '@noble/curves/ed25519.js';
import { approvePairingWithWallet, approveRevocationWithWallet, discoverInjectedWallets, type InjectedWallet, type WalletProvider } from './wallet';
import { FULL_CLIENT_SCOPES, FULL_SOCIAL_SCOPES, verifyPairingApproval, verifyRevocationApproval, type PairingRequest, type RevocationRequest } from '@opencaster/client-core/pairing';
import { addressFromCustodyPrivateKey, bytesToHex, hexToBytes, keyAddDigest, keyRemoveDigest, signedKeyRequestDigest, signEip712Digest } from '@opencaster/protocol/signedKeyRequest';

const custodyKey = hexToBytes('01'.repeat(32)); // synthetic fixture, never a live identity
const otherKey = hexToBytes('02'.repeat(32));
const custody = addressFromCustodyPrivateKey(custodyKey);
const other = addressFromCustodyPrivateKey(otherKey);
function fixture(): PairingRequest {
  const createdAt = Math.floor(Date.now() / 1000);
  return { kind: 'arca.hypersnap.signer.request', version: 1, origin: 'https://quorum.arca.computer', requestId: '12'.repeat(32), createdAt, fid: 1234, custodyAddress: custody, publicKey: bytesToHex(ed25519.getPublicKey(new Uint8Array(32).fill(3))), scopes: [1, 3, 4], ttl: 604800, nonce: 9, deadline: createdAt - 1609459200 + 900 };
}
function revokeFixture(): RevocationRequest {
  const { scopes: _scopes, ttl: _ttl, ...base } = fixture();
  return { ...base, kind: 'arca.hypersnap.signer.revoke.request' };
}
function wallet() {
  const payloads: Record<string, unknown>[] = [];
  const request = vi.fn<WalletProvider['request']>(async args => {
    if (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') return [custody];
    if (args.method === 'eth_chainId') return '0x1';
    if (args.method === 'eth_signTypedData_v4') {
      const params = args.params as readonly unknown[];
      expect(params[0]).toBe(custody);
      const typed = JSON.parse(params[1] as string) as Record<string, unknown>;
      payloads.push(typed);
      const digest = hashTypedData(typed as Parameters<typeof hashTypedData>[0]);
      return `0x${bytesToHex(signEip712Digest(hexToBytes(digest), custodyKey))}`;
    }
    throw new Error('Unexpected wallet method');
  });
  return { provider: { request } as WalletProvider, request, payloads };
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('custody wallet approval without seed import', () => {
  it.each([{ selected: FULL_SOCIAL_SCOPES }, { selected: FULL_CLIENT_SCOPES }])('signs exactly the explicitly selected scope set %j without wallet transactions', async ({ selected }) => {
    const req = { ...fixture(), scopes: [...selected] }; const w = wallet();
    const approval = await approvePairingWithWallet(req, w.provider);
    expect(() => verifyPairingApproval(req, approval)).not.toThrow();
    expect((w.payloads[0].message as { scopes: number[] }).scopes).toEqual(selected);
    expect(w.payloads).toHaveLength(2);
    expect(w.request.mock.calls.every(([args]) => args.method !== 'eth_sendTransaction')).toBe(true);
  });
  it('requests two exact typed-data signatures whose independent viem digests match Hypersnap protocol digests', async () => {
    const req = fixture(); const w = wallet();
    const approval = await approvePairingWithWallet(req, w.provider);
    expect(() => verifyPairingApproval(req, approval)).not.toThrow();
    expect(w.request.mock.calls.map(([arg]) => arg.method)).toEqual(['eth_requestAccounts', 'eth_chainId', 'eth_signTypedData_v4', 'eth_accounts', 'eth_chainId', 'eth_signTypedData_v4', 'eth_accounts']);
    const key = hexToBytes(req.publicKey);
    const keyAdd = w.payloads[0];
    expect(keyAdd.primaryType).toBe('KeyAdd');
    expect(keyAdd.domain).toEqual({ name: 'Farcaster KeyAdd', version: '1', chainId: 1 });
    expect(keyAdd.message).toEqual({ fid: '1234', key: `0x${req.publicKey}`, keyType: 1, scopes: [1, 3, 4], ttl: 604800, nonce: 9, deadline: String(req.deadline) });
    expect(hashTypedData(keyAdd as Parameters<typeof hashTypedData>[0])).toBe(`0x${bytesToHex(keyAddDigest({ fid: req.fid, key, keyType: 1, scopes: req.scopes, ttl: req.ttl, nonce: req.nonce, deadline: req.deadline }))}`);
    const metadata = w.payloads[1];
    expect(metadata.primaryType).toBe('SignedKeyRequest');
    expect(metadata.message).toEqual({ requestFid: '1234', key: `0x${req.publicKey}`, deadline: String(req.deadline) });
    expect(hashTypedData(metadata as Parameters<typeof hashTypedData>[0])).toBe(`0x${bytesToHex(signedKeyRequestDigest({ requestFid: req.fid, key, deadline: req.deadline }))}`);
  });

  it('requires explicit matching custody permission before any signature prompt', async () => {
    for (const accounts of [[other], [], 'not accounts', [custody, 123]]) {
      const w = wallet(); w.request.mockResolvedValueOnce(accounts);
      await expect(approvePairingWithWallet(fixture(), w.provider)).rejects.toThrow();
      expect(w.request).toHaveBeenCalledOnce();
    }
  });

  it('rejects a changed connected account and a signer that cannot prove custody control', async () => {
    const changed = wallet();
    const original = changed.request.getMockImplementation()!;
    changed.request.mockImplementation(async args => args.method === 'eth_accounts' ? [other] : original(args));
    await expect(approvePairingWithWallet(fixture(), changed.provider)).rejects.toThrow('custody address');
    expect(changed.payloads).toHaveLength(1);
    const wrong = wallet();
    wrong.request.mockImplementation(async args => {
      if (args.method === 'eth_chainId') return '0x1';
      if (args.method !== 'eth_signTypedData_v4') return [custody];
      const typed = JSON.parse((args.params as string[])[1]);
      return `0x${bytesToHex(signEip712Digest(hexToBytes(hashTypedData(typed)), otherKey))}`;
    });
    await expect(approvePairingWithWallet(fixture(), wrong.provider)).rejects.toThrow('does not match');
    expect(wrong.request).toHaveBeenCalledTimes(3);
  });

  it('normalizes 0/1 recovery IDs while refusing malformed and unsupported signature responses', async () => {
    const w = wallet(); const original = w.request.getMockImplementation()!;
    w.request.mockImplementation(async args => {
      const value = await original(args);
      if (args.method !== 'eth_signTypedData_v4') return value;
      const bytes = hexToBytes(value as string); bytes[64] -= 27;
      return `0x${bytesToHex(bytes)}`;
    });
    await expect(approvePairingWithWallet(fixture(), w.provider)).resolves.toMatchObject({ custodyAddress: custody });
    for (const value of ['0x1234', { signature: '0x00' }, `0x${'00'.repeat(64)}1d`]) {
      const invalid = wallet(); invalid.request.mockResolvedValueOnce([custody]).mockResolvedValueOnce('0x1').mockResolvedValueOnce(value);
      await expect(approvePairingWithWallet(fixture(), invalid.provider)).rejects.toThrow('invalid');
      expect(invalid.request).toHaveBeenCalledTimes(3);
    }
  });

  it('returns bounded provider errors and never automatically retries a rejected signature', async () => {
    const w = wallet();
    w.request.mockResolvedValueOnce([custody]).mockResolvedValueOnce('0x1').mockRejectedValueOnce({ code: 4001, message: 'private untrusted content' });
    await expect(approvePairingWithWallet(fixture(), w.provider)).rejects.toThrow('declined');
    expect(w.request).toHaveBeenCalledTimes(3);
    const unsupported = wallet(); unsupported.request.mockRejectedValueOnce({ code: 4200, message: 'untrusted' });
    await expect(approvePairingWithWallet(fixture(), unsupported.provider)).rejects.toThrow('does not support');
  });

  it('bounds stalled wallet requests, ignores late results, and supports cancellation without resubmission', async () => {
    vi.useFakeTimers();
    const w = wallet(); w.request.mockImplementationOnce(() => new Promise(() => {}));
    const stalled = expect(approvePairingWithWallet(fixture(), w.provider)).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(30_001);
    await stalled;
    expect(w.request).toHaveBeenCalledOnce();
    const controller = new AbortController();
    const cancelled = wallet(); cancelled.request.mockImplementationOnce(() => new Promise(() => {}));
    const rejected = expect(approvePairingWithWallet(fixture(), cancelled.provider, { signal: controller.signal })).rejects.toThrow('cancelled');
    controller.abort(); await rejected;
    expect(cancelled.request).toHaveBeenCalledOnce();
  });

  it('validates privilege and expiry before exposing any wallet prompt', async () => {
    const w = wallet();
    await expect(approvePairingWithWallet({ ...fixture(), scopes: [1, 3, 4, 16] }, w.provider)).rejects.toThrow();
    const expired = fixture(); expired.createdAt -= 901; expired.deadline -= 901;
    await expect(approvePairingWithWallet(expired, w.provider)).rejects.toThrow('expired');
    expect(w.request).not.toHaveBeenCalled();
  });

  it('signs only custody KEY_REMOVE for revocation and verifies it against the same protocol digest', async () => {
    const req = revokeFixture(); const w = wallet();
    const approval = await approveRevocationWithWallet(req, w.provider);
    expect(() => verifyRevocationApproval(req, approval)).not.toThrow();
    expect(w.payloads).toHaveLength(1);
    expect(w.payloads[0].primaryType).toBe('KeyRemove');
    expect(hashTypedData(w.payloads[0] as Parameters<typeof hashTypedData>[0])).toBe(`0x${bytesToHex(keyRemoveDigest({ fid: req.fid, key: hexToBytes(req.publicKey), nonce: req.nonce, deadline: req.deadline }))}`);
    expect(approval.signatureType).toBe(1);
    expect(w.request.mock.calls.map(([arg]) => arg.method)).toEqual(['eth_requestAccounts', 'eth_chainId', 'eth_signTypedData_v4', 'eth_accounts']);
  });

  it('requires Ethereum Mainnet for the fixed EIP-712 domain and never asks to transact or switches networks', async () => {
    const w = wallet(); w.request.mockResolvedValueOnce([custody]).mockResolvedValueOnce('0x2105');
    await expect(approvePairingWithWallet(fixture(), w.provider)).rejects.toThrow('Select Ethereum Mainnet');
    expect(w.request.mock.calls.map(([arg]) => arg.method)).toEqual(['eth_requestAccounts', 'eth_chainId']);
    const invalid = wallet(); invalid.request.mockResolvedValueOnce([custody]).mockResolvedValueOnce('1');
    await expect(approveRevocationWithWallet(revokeFixture(), invalid.provider)).rejects.toThrow('invalid network ID');
    expect(invalid.payloads).toHaveLength(0);
  });

  it('does not issue a second signature request after a first open prompt is cancelled', async () => {
    const controller = new AbortController();
    const w = wallet(); const original = w.request.getMockImplementation()!;
    let resolvePrompt!: (value: unknown) => void;
    let promptStarted!: () => void;
    const started = new Promise<void>(resolve => { promptStarted = resolve; });
    const prompt = new Promise<unknown>(resolve => { resolvePrompt = resolve; });
    w.request.mockImplementation(args => {
      if (args.method === 'eth_signTypedData_v4') { promptStarted(); return prompt; }
      return original(args);
    });
    const pending = expect(approvePairingWithWallet(fixture(), w.provider, { signal: controller.signal })).rejects.toThrow('cancelled');
    await started;
    controller.abort(); await pending;
    resolvePrompt('0xlate ignored');
    await Promise.resolve();
    expect(w.request.mock.calls.filter(([arg]) => arg.method === 'eth_signTypedData_v4')).toHaveLength(1);
    expect(w.request.mock.calls.at(-1)?.[0].method).toBe('eth_signTypedData_v4');
  });

  it('explicitly signs with the custody account even when a wallet exposes its ordinary account first', async () => {
    const w = wallet(); const original = w.request.getMockImplementation()!;
    w.request.mockImplementation(args => args.method === 'eth_requestAccounts' || args.method === 'eth_accounts' ? Promise.resolve([other, custody]) : original(args));
    const request = fixture();
    const approval = await approvePairingWithWallet(request, w.provider);
    expect(() => verifyPairingApproval(request, approval)).not.toThrow();
    expect(w.request.mock.calls.filter(([args]) => args.method === 'eth_signTypedData_v4').every(([args]) => (args.params as readonly unknown[])[0] === custody)).toBe(true);
    expect(w.request.mock.calls.every(([args]) => ['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'eth_signTypedData_v4'].includes(args.method))).toBe(true);
  });

  it('provides a recoverable pending-request error without repeating or downgrading the wallet request', async () => {
    const w = wallet();
    w.request.mockRejectedValueOnce({ code: -32002, message: 'untrusted account or signature data' });
    await expect(approvePairingWithWallet(fixture(), w.provider)).rejects.toThrow('Open the wallet extension and approve or reject');
    expect(w.request).toHaveBeenCalledOnce();
    expect(w.request.mock.calls[0][0].method).toBe('eth_requestAccounts');
  });

  it('isolates hostile wallet error/account getters and settles the UI promise without waiting for timeout', async () => {
    vi.useFakeTimers();
    const hostileError = Object.defineProperty({}, 'code', { get: () => { throw new Error('must never surface secret diagnostics'); } });
    const w = wallet(); w.request.mockRejectedValueOnce(hostileError);
    await expect(approvePairingWithWallet(fixture(), w.provider)).rejects.toThrow('could not complete');
    expect(vi.getTimerCount()).toBe(0);
    const accounts = [custody];
    Object.defineProperty(accounts, 0, { get: () => { throw new Error('private wallet response'); } });
    const invalid = wallet(); invalid.request.mockResolvedValueOnce(accounts);
    await expect(approvePairingWithWallet(fixture(), invalid.provider)).rejects.toThrow('invalid connected accounts');
    expect(invalid.request).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('holds the chosen request capability through the whole approval instead of following replacement globals or methods', async () => {
    const w = wallet(); const replacement = vi.fn(async () => [other]);
    const request = fixture();
    const approval = await approvePairingWithWallet(request, w.provider, { onProgress: () => { w.provider.request = replacement; } });
    expect(() => verifyPairingApproval(request, approval)).not.toThrow();
    expect(replacement).not.toHaveBeenCalled();
    expect(w.payloads).toHaveLength(2);
  });
});

describe('injected wallet discovery', () => {
  function target() { const target = new EventTarget(); vi.stubGlobal('window', target); return target; }
  function announce(target: EventTarget, provider: WalletProvider, id = '12345678-1234-4234-8234-123456789abc', name = 'Test Wallet', rdns?: unknown) {
    target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: id, name, icon: '<script>never rendered</script>', rdns }, provider } }));
  }
  it('announces discovery, deduplicates provider/UUID conflicts, retains late injections, and cleans up', async () => {
    vi.useFakeTimers();
    const win = target(); const seen: InjectedWallet[][] = []; let requests = 0;
    win.addEventListener('eip6963:requestProvider', () => { requests++; });
    const cleanup = discoverInjectedWallets(wallets => seen.push(wallets));
    expect(requests).toBe(1);
    const first = wallet().provider; announce(win, first);
    announce(win, wallet().provider); // UUID collision must not replace original
    announce(win, first, 'abcdefab-1234-4234-8234-123456789abc'); // duplicate provider
    expect(seen.at(-1)).toHaveLength(1);
    expect(seen.at(-1)?.[0].provider).toBe(first);
    await vi.advanceTimersByTimeAsync(20_000);
    announce(win, wallet().provider, 'abcdefab-1234-4234-8234-123456789abc', 'Late Wallet');
    expect(seen.at(-1)).toHaveLength(2);
    expect(Object.keys(seen.at(-1)![0])).toEqual(['id', 'name', 'provider']);
    cleanup(); const count = seen.length;
    announce(win, wallet().provider, 'aaaabbbb-1234-4234-8234-123456789abc');
    expect(seen).toHaveLength(count);
  });

  it('keeps a legacy provider identity stable when its later EIP-6963 metadata arrives', async () => {
    vi.useFakeTimers();
    const win = target(); const provider = wallet().provider;
    Object.assign(win, { ethereum: provider });
    let latest: InjectedWallet[] = [];
    const cleanup = discoverInjectedWallets(wallets => { latest = wallets; });
    expect(latest).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(301);
    expect(latest[0].id).toBe('injected-fallback');
    const original = latest[0];
    announce(win, provider);
    expect(latest).toHaveLength(1);
    expect(latest[0].name).toBe('Test Wallet');
    expect(latest[0].id).toBe(original.id);
    expect(latest[0].provider).toBe(original.provider);
    cleanup();
  });

  it('ignores malformed or misleading metadata and caps the number of untrusted announcements', () => {
    const win = target(); let latest: InjectedWallet[] = [];
    const cleanup = discoverInjectedWallets(wallets => { latest = wallets; });
    announce(win, wallet().provider, 'invalid');
    announce(win, wallet().provider, undefined, 'Misleading\u202e Wallet');
    expect(latest).toHaveLength(0);
    for (let i = 0; i < 100; i++) announce(win, wallet().provider, `${String(i).padStart(8, '0')}-1234-4234-8234-123456789abc`);
    expect(latest).toHaveLength(16);
    cleanup();
  });

  it('detects delayed legacy provider injection and removes its initialization listener on cleanup', async () => {
    vi.useFakeTimers();
    const win = target(); let latest: InjectedWallet[] = [];
    const cleanup = discoverInjectedWallets(wallets => { latest = wallets; });
    await vi.advanceTimersByTimeAsync(1000);
    Object.assign(win, { ethereum: wallet().provider });
    win.dispatchEvent(new Event('ethereum#initialized'));
    expect(latest).toHaveLength(1);
    cleanup(); latest = [];
    win.dispatchEvent(new Event('ethereum#initialized'));
    expect(latest).toHaveLength(0);
  });

  it('retains only bounded rdns label metadata and recognizes the official Rainbow announcement', () => {
    const win = target(); let latest: InjectedWallet[] = [];
    const cleanup = discoverInjectedWallets(wallets => { latest = wallets; });
    const rainbow = wallet().provider;
    announce(win, rainbow, undefined, 'Rainbow Wallet', 'ME.RAINBOW');
    expect(latest).toHaveLength(1);
    expect(latest[0]).toEqual({ id: '12345678-1234-4234-8234-123456789abc', name: 'Rainbow Wallet', rdns: 'me.rainbow', provider: rainbow });
    expect(Object.isFrozen(latest[0])).toBe(true);
    for (const rdns of ['https://rainbow.me', 'me.rainbow\u202e', 'x'.repeat(254), { toString: () => 'me.rainbow' }]) {
      const id = `${String(latest.length).padStart(8, '0')}-1234-4234-8234-123456789abc`;
      announce(win, wallet().provider, id, 'Other Wallet', rdns);
      expect(latest.at(-1)?.rdns).toBeUndefined();
    }
    cleanup();
  });

  it.each(['direct', 'ethereum', 'providers'] as const)('discovers legacy Rainbow through %s beside an already announced competing extension', async injection => {
    vi.useFakeTimers();
    const win = target(); const rainbow = Object.assign(wallet().provider, { isRainbow: true, isMetaMask: true });
    const competing = wallet().provider;
    Object.assign(win, { ethereum: injection === 'ethereum' ? rainbow : Object.assign(competing, { providers: injection === 'providers' ? [competing, rainbow] : undefined }), ...(injection === 'direct' ? { rainbow } : {}) });
    let latest: InjectedWallet[] = [];
    const cleanup = discoverInjectedWallets(wallets => { latest = wallets; });
    announce(win, competing, undefined, 'Other Extension', 'com.other');
    await vi.advanceTimersByTimeAsync(301);
    expect(latest).toHaveLength(2);
    const choice = latest.find(item => item.rdns === 'me.rainbow');
    expect(choice).toMatchObject({ id: 'rainbow-legacy', name: 'Rainbow (legacy)' });
    expect(choice?.provider).toBe(rainbow);
    expect(choice?.provider).not.toBe(competing);
    expect((rainbow.request as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    cleanup();
  });

  it('never replaces a provider capability just because a different object claims the same wallet brand', async () => {
    vi.useFakeTimers();
    const win = target(); const rainbow = Object.assign(wallet().provider, { isRainbow: true });
    Object.assign(win, { rainbow, ethereum: wallet().provider });
    let latest: InjectedWallet[] = [];
    const cleanup = discoverInjectedWallets(wallets => { latest = wallets; });
    await vi.advanceTimersByTimeAsync(301);
    const captured = latest[0];
    const announcedCopy = Object.assign(wallet().provider, { isRainbow: true, isMetaMask: false });
    announce(win, announcedCopy, undefined, 'Rainbow', 'me.rainbow');
    expect(latest).toHaveLength(3); // legacy Rainbow, generic default, and the distinct EIP provider
    expect(latest.find(item => item.provider === announcedCopy)?.id).not.toBe(captured.id);
    expect(latest.find(item => item.id === captured.id)).toBe(captured);
    expect(captured.provider).toBe(rainbow);
    expect(captured.name).toBe('Rainbow (legacy)');
    await vi.advanceTimersByTimeAsync(500);
    win.dispatchEvent(new Event('ethereum#initialized'));
    expect(latest).toHaveLength(3);
    cleanup();
  });

  it('upgrades an existing generic fallback when the same provider later identifies as Rainbow', async () => {
    vi.useFakeTimers();
    const win = target(); const provider = wallet().provider;
    Object.assign(win, { ethereum: provider });
    let latest: InjectedWallet[] = [];
    const cleanup = discoverInjectedWallets(wallets => { latest = wallets; });
    await vi.advanceTimersByTimeAsync(301);
    const generic = latest[0];
    expect(generic.id).toBe('injected-fallback');
    Object.assign(provider, { isRainbow: true });
    win.dispatchEvent(new Event('ethereum#initialized'));
    expect(latest).toHaveLength(1);
    expect(latest[0]).toEqual({ id: generic.id, name: 'Rainbow (legacy)', rdns: 'me.rainbow', provider });
    expect(generic).toEqual({ id: 'injected-fallback', name: 'Browser wallet (default provider)', provider });
    cleanup();
  });

  it('keeps a conflicting announcement from replacing legacy or named providers and respects the wallet cap', async () => {
    vi.useFakeTimers();
    const win = target(); Object.assign(win, { rainbow: Object.assign(wallet().provider, { isRainbow: true }) });
    let latest: InjectedWallet[] = [];
    const cleanup = discoverInjectedWallets(wallets => { latest = wallets; });
    for (let i = 0; i < 16; i++) announce(win, wallet().provider, `${String(i).padStart(8, '0')}-1234-4234-8234-123456789abc`);
    const first = latest[0];
    announce(win, wallet().provider, first.id, 'Rainbow', 'me.rainbow');
    await vi.advanceTimersByTimeAsync(301);
    expect(latest).toHaveLength(16);
    expect(latest[0]).toBe(first);
    expect(latest.some(item => item.rdns === 'me.rainbow')).toBe(false);
    cleanup();
  });

  it('isolates throwing legacy getters and scans only a bounded provider list', async () => {
    vi.useFakeTimers();
    const win = target(); const rainbow = Object.assign(wallet().provider, { isRainbow: true });
    const providers = new Array(1_000);
    Object.defineProperty(providers, 0, { get: () => { throw new Error('untrusted provider getter'); } });
    providers[1] = rainbow;
    const distant = vi.fn(() => wallet().provider);
    Object.defineProperty(providers, 999, { get: distant });
    Object.defineProperty(win, 'rainbow', { get: () => { throw new Error('untrusted namespace getter'); } });
    Object.assign(win, { ethereum: Object.assign(wallet().provider, { providers }) });
    let latest: InjectedWallet[] = [];
    const cleanup = discoverInjectedWallets(wallets => { latest = wallets; });
    await vi.advanceTimersByTimeAsync(301);
    expect(latest).toHaveLength(2);
    expect(latest[0].provider).toBe(rainbow);
    expect(distant).not.toHaveBeenCalled();
    cleanup();
  });

  it('labels documented namespaces without trusting truthy flags on other generic providers', async () => {
    vi.useFakeTimers();
    const win = target();
    const generic = wallet().provider;
    const impostor = Object.assign(wallet().provider, { isRainbow: 'true' });
    const throwing = Object.defineProperty(wallet().provider, 'isRainbow', { get: () => { throw new Error('untrusted flag'); } });
    Object.assign(win, { rainbow: impostor, ethereum: Object.assign(generic, { providers: [impostor, throwing] }) });
    let latest: InjectedWallet[] = [];
    const cleanup = discoverInjectedWallets(wallets => { latest = wallets; });
    await vi.advanceTimersByTimeAsync(301);
    expect(latest).toHaveLength(3);
    expect(latest.find(item => item.provider === generic)).toMatchObject({ name: 'Browser wallet (default provider)' });
    expect(latest.find(item => item.provider === throwing)?.rdns).toBeUndefined();
    expect(latest.find(item => item.provider === impostor)).toMatchObject({ name: 'Rainbow (legacy)', rdns: 'me.rainbow' });
    cleanup();
  });

  it('discovers Coinbase’s direct extension provider without flags beside a different EIP-6963 wallet', async () => {
    vi.useFakeTimers();
    const win = target(); const coinbase = wallet(); const metamask = wallet();
    // A compatibility flag must not relabel the documented Coinbase namespace.
    Object.assign(coinbase.provider, { isMetaMask: true });
    Object.assign(win, { coinbaseWalletExtension: coinbase.provider, ethereum: metamask.provider });
    let latest: InjectedWallet[] = [];
    const cleanup = discoverInjectedWallets(wallets => { latest = wallets; });
    announce(win, metamask.provider, undefined, 'MetaMask', 'io.metamask');
    await vi.advanceTimersByTimeAsync(301);
    expect(latest).toHaveLength(2);
    const selected = latest.find(item => item.rdns === 'com.coinbase.wallet')!;
    expect(selected.name).toBe('Coinbase Wallet (legacy)');
    expect(selected.provider).toBe(coinbase.provider);
    expect(coinbase.request).not.toHaveBeenCalled(); expect(metamask.request).not.toHaveBeenCalled();
    await approvePairingWithWallet(fixture(), selected.provider);
    expect(coinbase.payloads).toHaveLength(2); expect(metamask.request).not.toHaveBeenCalled();
    cleanup();
  });

  it('finds Coinbase, Rainbow and MetaMask from a generic provider array without any EIP announcement', async () => {
    vi.useFakeTimers();
    const win = target();
    const coinbase = Object.assign(wallet().provider, { isCoinbaseWallet: true, isMetaMask: true });
    const rainbow = Object.assign(wallet().provider, { isRainbow: true, isMetaMask: true });
    const metamask = Object.assign(wallet().provider, { isMetaMask: true, providers: [coinbase, rainbow, coinbase] });
    Object.assign(win, { ethereum: metamask });
    let latest: InjectedWallet[] = [];
    const cleanup = discoverInjectedWallets(wallets => { latest = wallets; });
    await vi.advanceTimersByTimeAsync(301);
    expect(latest).toHaveLength(3);
    expect(latest.map(item => item.name)).toEqual(['Coinbase Wallet (legacy)', 'Rainbow (legacy)', 'MetaMask (legacy)']);
    expect(new Set(latest.map(item => item.provider)).size).toBe(3);
    for (const choice of latest) expect(choice.provider.request).not.toHaveBeenCalled();
    cleanup();
  });

  it('preserves Coinbase and other extensions routed behind Rainbow instead of only finding Rainbow', async () => {
    vi.useFakeTimers();
    const win = target();
    const rainbow = Object.assign(wallet().provider, { isRainbow: true });
    const coinbase = Object.assign(wallet().provider, { isCoinbaseWallet: true });
    const otherWallet = wallet().provider;
    Object.assign(win, { ethereum: rainbow, rainbow, rnbwWalletRouter: { providers: [rainbow, coinbase, otherWallet], currentProvider: rainbow, lastInjectedProvider: coinbase, rainbowProvider: rainbow } });
    let latest: InjectedWallet[] = [];
    const cleanup = discoverInjectedWallets(wallets => { latest = wallets; });
    await vi.advanceTimersByTimeAsync(301);
    expect(latest).toHaveLength(3);
    expect(latest.find(item => item.provider === coinbase)?.name).toBe('Coinbase Wallet (legacy)');
    expect(latest.find(item => item.provider === otherWallet)?.name).toMatch(/^Browser wallet/);
    cleanup();
  });

  it('deduplicates aliases by provider identity while preserving different providers that share a brand', async () => {
    vi.useFakeTimers();
    const win = target();
    const first = Object.assign(wallet().provider, { isCoinbaseWallet: true });
    const second = Object.assign(wallet().provider, { isCoinbaseWallet: true });
    Object.assign(win, { coinbaseWalletExtension: first, walletLinkExtension: first, ethereum: Object.assign(first, { providers: [first, second, first] }) });
    let latest: InjectedWallet[] = [];
    const cleanup = discoverInjectedWallets(wallets => { latest = wallets; });
    await vi.advanceTimersByTimeAsync(301);
    const original = [...latest];
    expect(latest).toHaveLength(2);
    expect(new Set(latest.map(item => item.id)).size).toBe(2);
    win.dispatchEvent(new Event('ethereum#initialized'));
    expect(latest).toEqual(original);
    announce(win, first, undefined, 'Coinbase Wallet', 'com.coinbase.wallet');
    expect(latest).toHaveLength(2);
    expect(latest.find(item => item.provider === first)?.id).toBe(original[0].id);
    expect(original[0].provider).toBe(first);
    cleanup();
  });

  it('detects delayed Coinbase injection beside named wallets and rescan cleanup leaves no old callbacks', async () => {
    vi.useFakeTimers();
    const win = target(); const metamask = wallet().provider; const coinbase = wallet().provider;
    const seen = vi.fn(); let latest: InjectedWallet[] = [];
    const cleanup = discoverInjectedWallets(wallets => { latest = wallets; seen(); });
    announce(win, metamask, undefined, 'MetaMask', 'io.metamask');
    await vi.advanceTimersByTimeAsync(20_000);
    Object.assign(win, { coinbaseWalletExtension: coinbase });
    win.dispatchEvent(new Event('ethereum#initialized'));
    expect(latest).toHaveLength(2);
    expect(latest.find(item => item.provider === coinbase)).toBeDefined();
    cleanup(); const count = seen.mock.calls.length;
    win.dispatchEvent(new Event('ethereum#initialized'));
    expect(seen).toHaveBeenCalledTimes(count);
    const nextCleanup = discoverInjectedWallets(wallets => { latest = wallets; });
    await vi.advanceTimersByTimeAsync(301);
    expect(latest.find(item => item.provider === coinbase)).toBeDefined();
    expect(seen).toHaveBeenCalledTimes(count);
    nextCleanup();
  });

  it('recognizes only request-capable EVM providers in documented direct namespaces', async () => {
    vi.useFakeTimers();
    const win = target(); const brave = wallet().provider; const phantom = wallet().provider; const trust = wallet().provider; const okx = wallet().provider;
    Object.assign(win, { braveEthereum: brave, phantom: { ethereum: phantom }, trustwallet: { ethereum: trust }, okxwallet: okx, coinbaseWalletExtension: { signMessage: vi.fn() } });
    let latest: InjectedWallet[] = [];
    const cleanup = discoverInjectedWallets(wallets => { latest = wallets; });
    await vi.advanceTimersByTimeAsync(301);
    expect(latest.map(item => item.name)).toEqual(['Brave Wallet (legacy)', 'Phantom (legacy)', 'Trust Wallet (legacy)', 'OKX Wallet (legacy)']);
    cleanup();
  });

  it('isolates revoked proxies and hostile getters across namespaces, provider arrays, and announcement metadata', async () => {
    vi.useFakeTimers();
    const win = target(); const valid = wallet().provider;
    const badProvider = Proxy.revocable({ request: vi.fn() }, {}); badProvider.revoke();
    const badArray = Proxy.revocable([], {}); badArray.revoke();
    Object.defineProperty(win, 'coinbaseWalletExtension', { get: () => { throw new Error('private diagnostics'); } });
    Object.assign(win, { walletLinkExtension: badProvider.proxy, rainbow: badProvider.proxy, ethereum: Object.assign(valid, { providers: badArray.proxy }) });
    let latest: InjectedWallet[] = [];
    const cleanup = discoverInjectedWallets(wallets => { latest = wallets; });
    win.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: Object.defineProperty({}, 'uuid', { get: () => { throw new Error('private announcement'); } }), provider: valid } }));
    await vi.advanceTimersByTimeAsync(301);
    expect(latest).toHaveLength(1); expect(latest[0].provider).toBe(valid);
    expect(valid.request).not.toHaveBeenCalled();
    cleanup();
  });
});
