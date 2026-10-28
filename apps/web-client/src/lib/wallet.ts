import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import {
  hashPairingRequest, hashRevocationRequest, validatePairingRequest, validateRevocationRequest,
  verifyPairingApproval, verifyRevocationApproval,
  type PairingRequest, type PairingApproval, type RevocationRequest, type RevocationApproval,
} from '@opencaster/client-core/pairing';
import {
  bytesToHex, hexToBytes, KEY_DOMAIN_NAME, KEY_DOMAIN_VERSION, SIGNED_KEY_REQUEST_CHAIN_ID,
  keyAddDigest, keyRemoveDigest,
} from '@opencaster/protocol/signedKeyRequest';

/** EIP-1193 transport only: wallet keys never enter this interface. */
export interface WalletProvider {
  request(args: { readonly method: string; readonly params?: readonly unknown[] | object }): Promise<unknown>;
}
export interface InjectedWallet { readonly id: string; readonly name: string; readonly provider: WalletProvider; readonly rdns?: string }
export interface WalletApprovalOptions { signal?: AbortSignal; onProgress?: (stage: string) => void }
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RDNS = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_WALLETS = 16;
const MAX_LEGACY_PROVIDERS = 32;
const ACCOUNT_TIMEOUT_MS = 30_000;
const SIGN_TIMEOUT_MS = 120_000;

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function isProvider(value: unknown): value is WalletProvider {
  try { return value !== null && (typeof value === 'object' || typeof value === 'function') && !Array.isArray(value) && typeof property(value, 'request') === 'function'; } catch { return false; }
}
function property(value: unknown, key: string | number): unknown {
  try { return value !== null && (typeof value === 'object' || typeof value === 'function') ? (value as Record<string | number, unknown>)[key] : undefined; } catch { return undefined; }
}
interface LegacyLabel { name: string; rdns?: string; id: string }
const LEGACY_LABELS = {
  coinbase: { name: 'Coinbase Wallet', rdns: 'com.coinbase.wallet', id: 'coinbase-legacy' },
  rainbow: { name: 'Rainbow', rdns: 'me.rainbow', id: 'rainbow-legacy' },
  rabby: { name: 'Rabby', rdns: 'io.rabby', id: 'rabby-legacy' },
  brave: { name: 'Brave Wallet', rdns: 'com.brave.wallet', id: 'brave-legacy' },
  phantom: { name: 'Phantom', rdns: 'app.phantom', id: 'phantom-legacy' },
  trust: { name: 'Trust Wallet', rdns: 'com.trustwallet.app', id: 'trust-legacy' },
  okx: { name: 'OKX Wallet', rdns: 'com.okex.wallet', id: 'okx-legacy' },
  metamask: { name: 'MetaMask', rdns: 'io.metamask', id: 'metamask-legacy' },
} satisfies Record<string, LegacyLabel>;

function legacyLabel(provider: WalletProvider): LegacyLabel | undefined {
  // Many competing wallets also set isMetaMask for compatibility. Their more
  // specific flags must take precedence. Every label remains self-asserted.
  if (property(provider, 'isCoinbaseWallet') === true || property(provider, 'isCoinbaseBrowser') === true) return LEGACY_LABELS.coinbase;
  if (property(provider, 'isRainbow') === true) return LEGACY_LABELS.rainbow;
  if (property(provider, 'isRabby') === true) return LEGACY_LABELS.rabby;
  if (property(provider, 'isBraveWallet') === true) return LEGACY_LABELS.brave;
  if (property(provider, 'isPhantom') === true) return LEGACY_LABELS.phantom;
  if (property(provider, 'isTrust') === true || property(provider, 'isTrustWallet') === true) return LEGACY_LABELS.trust;
  if (property(provider, 'isOkxWallet') === true || property(provider, 'isOKExWallet') === true) return LEGACY_LABELS.okx;
  if (property(provider, 'isMetaMask') === true) return LEGACY_LABELS.metamask;
}
function boundedProviders(value: unknown): unknown[] {
  try {
    if (!Array.isArray(value)) return [];
    const length = property(value, 'length');
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return [];
    const result: unknown[] = [];
    for (let index = 0; index < Math.min(length, MAX_LEGACY_PROVIDERS); index++) result.push(property(value, index));
    return result;
  } catch { return []; }
}

/** Names, rdns and legacy flags are self-asserted labels, never authentication. */
export function discoverInjectedWallets(onWallets: (wallets: InjectedWallet[]) => void): () => void {
  if (typeof window === 'undefined') { onWallets([]); return () => {}; }
  const discovered = new Map<string, InjectedWallet>();
  const providerIds = new WeakMap<WalletProvider, string>();
  const uuidOwners = new Map<string, WalletProvider>();
  const ranks = new Map<string, number>();
  let closed = false;
  const publish = () => { if (!closed) onWallets([...discovered.values()]); };
  const add = (provider: WalletProvider, preferredId: string, name: string, rdns: string | undefined, rank: number) => {
    if (closed) return;
    const existingId = providerIds.get(provider);
    if (existingId) {
      if ((ranks.get(existingId) ?? 0) > rank) return;
      const existing = discovered.get(existingId)!;
      if (existing.name === name && existing.rdns === rdns) return;
      // Metadata may improve; the ID and provider capability never change.
      discovered.set(existingId, Object.freeze({ id: existingId, name, provider, ...(rdns ? { rdns } : {}) }));
      ranks.set(existingId, rank); publish(); return;
    }
    if (discovered.size >= MAX_WALLETS) return;
    let id = preferredId;
    for (let suffix = 2; discovered.has(id); suffix++) id = `${preferredId}-${suffix}`;
    providerIds.set(provider, id);
    discovered.set(id, Object.freeze({ id, name, provider, ...(rdns ? { rdns } : {}) }));
    ranks.set(id, rank); publish();
  };
  const announce = (event: Event) => {
    try {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      if (!object(detail)) return;
      const info = property(detail, 'info'); const provider = property(detail, 'provider');
      if (!object(info) || !isProvider(provider)) return;
      const uuid = property(info, 'uuid'); const name = property(info, 'name');
      // eslint-disable-next-line no-control-regex -- Untrusted provider labels must exclude controls and bidi overrides.
      if (typeof uuid !== 'string' || !UUID.test(uuid) || typeof name !== 'string' || name.length < 1 || name.length > 80 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name)) return;
      const rdnsValue = property(info, 'rdns');
      const rdns = typeof rdnsValue === 'string' && rdnsValue.length <= 253 && RDNS.test(rdnsValue.toLowerCase()) ? rdnsValue.toLowerCase() : undefined;
      const id = uuid.toLowerCase();
      // A conflicting UUID must never replace an already selected provider.
      const owner = uuidOwners.get(id);
      if (owner && owner !== provider) return;
      const existingId = providerIds.get(provider);
      if (existingId && (ranks.get(existingId) ?? 0) === 3) return;
      add(provider, id, name.trim() || 'Browser wallet', rdns, 3);
      // At most one UUID is retained per displayed provider, keeping this map
      // bounded even when a page dispatches repeated announcement aliases.
      if (providerIds.has(provider)) uuidOwners.set(id, provider);
    } catch { /* An announcement is untrusted extension/page input. */ }
  };
  const fallback = () => {
    if (closed) return;
    const known = (value: unknown, label: LegacyLabel) => { if (isProvider(value)) add(value, label.id, `${label.name} (legacy)`, label.rdns, 2); };
    // Public extension namespaces keep wallets available when a different
    // extension owns window.ethereum. No wallet methods are invoked here.
    known(property(window, 'coinbaseWalletExtension'), LEGACY_LABELS.coinbase);
    known(property(window, 'walletLinkExtension'), LEGACY_LABELS.coinbase);
    known(property(window, 'rainbow'), LEGACY_LABELS.rainbow);
    known(property(window, 'braveEthereum'), LEGACY_LABELS.brave);
    known(property(property(window, 'phantom'), 'ethereum'), LEGACY_LABELS.phantom);
    known(property(property(window, 'trustwallet'), 'ethereum'), LEGACY_LABELS.trust);
    known(property(window, 'trustwallet'), LEGACY_LABELS.trust);
    known(property(window, 'okxwallet'), LEGACY_LABELS.okx);
    const ethereum = property(window, 'ethereum');
    const router = property(window, 'rnbwWalletRouter');
    const candidates = [...boundedProviders(property(ethereum, 'providers')), ...boundedProviders(property(router, 'providers')), property(router, 'rainbowProvider'), property(router, 'lastInjectedProvider'), property(router, 'currentProvider'), ethereum];
    for (const candidate of candidates) {
      if (!isProvider(candidate)) continue;
      const label = legacyLabel(candidate);
      const existingId = providerIds.get(candidate);
      const ordinal = existingId ? [...discovered.keys()].indexOf(existingId) + 1 : discovered.size + 1;
      // A documented direct namespace is a better display hint than generic
      // compatibility flags such as isMetaMask. Neither establishes trust.
      add(candidate, label?.id ?? (candidate === ethereum ? 'injected-fallback' : 'injected-legacy'), label ? `${label.name} (legacy)` : candidate === ethereum ? 'Browser wallet (default provider)' : `Browser wallet ${ordinal} (legacy)`, label?.rdns, label ? 1 : 0);
    }
  };
  window.addEventListener('eip6963:announceProvider', announce);
  window.addEventListener('ethereum#initialized', fallback);
  publish();
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  // Keep legacy providers beside EIP-6963 choices instead of letting one named
  // wallet suppress all other extensions. Refreshing the UI repeats this scan.
  const timer = setTimeout(fallback, 300);
  return () => { closed = true; clearTimeout(timer); window.removeEventListener('eip6963:announceProvider', announce); window.removeEventListener('ethereum#initialized', fallback); discovered.clear(); };
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Wallet approval cancelled.', 'AbortError');
}
function rpcError(error: unknown): Error {
  const code = property(error, 'code');
  if (code === 4001) return new Error('You declined the wallet request. No authorization was submitted.');
  if (code === 4100) return new Error('Allow this site to use the imported Farcaster custody account in your wallet’s connected-site permissions, then try again.');
  if (code === 4200 || code === -32601) return new Error('This wallet does not support the required EIP-712 typed-data signatures.');
  if (code === -32002) return new Error('A wallet request is already open or pending. Open the wallet extension and approve or reject that request before trying again.');
  if (code === 4900 || code === 4901) return new Error('Your wallet is disconnected. Unlock the extension and connect the custody account on Ethereum Mainnet, then try again.');
  return new Error('The wallet could not complete the request. Check its connection and selected custody account.');
}

function transport(provider: WalletProvider, options: WalletApprovalOptions) {
  if (!isProvider(provider)) throw new Error('Choose an available browser wallet.');
  const method = property(provider, 'request');
  if (typeof method !== 'function') throw new Error('This wallet provider is no longer available. Refresh wallet detection and choose it again.');
  // Hold the selected provider and its request capability for this attempt;
  // neither window.ethereum changes nor subsequent discovery can reroute it.
  const request = (args: Parameters<WalletProvider['request']>[0]): unknown => Reflect.apply(method, provider, [args]);
  return async (method: string, params?: readonly unknown[], timeout = ACCOUNT_TIMEOUT_MS): Promise<unknown> => {
    assertActive(options.signal);
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error: Error | null, value?: unknown) => {
        if (done) return;
        done = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value);
      };
      const abort = () => finish(new DOMException('Wallet approval cancelled.', 'AbortError'));
      const timer = setTimeout(() => finish(new Error('The wallet took too long. Finish or reject its open request before trying again. No authorization was submitted.')), timeout);
      options.signal?.addEventListener('abort', abort, { once: true });
      try {
        const pending: unknown = request({ method, ...(params ? { params } : {}) });
        if (!pending || (typeof pending !== 'object' && typeof pending !== 'function') || typeof (pending as { then?: unknown }).then !== 'function') { finish(new Error('The wallet returned an invalid response.')); return; }
        Promise.resolve(pending).then(value => finish(null, value), error => finish(rpcError(error)));
      } catch (error) { finish(rpcError(error)); }
    });
  };
}

function requireCustodyAccount(value: unknown, custody: string): void {
  const invalid = () => new Error('The wallet returned invalid connected accounts.');
  let length: number;
  try {
    const count = property(value, 'length');
    if (!Array.isArray(value) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || count > 32) throw invalid();
    length = count;
  } catch { throw invalid(); }
  let matched = false;
  for (let index = 0; index < length; index++) {
    const account = property(value, index);
    if (typeof account !== 'string' || !ADDRESS.test(account)) throw invalid();
    if (account.toLowerCase() === custody) matched = true;
  }
  if (!matched) throw new Error('Connect the imported Farcaster account whose custody address is shown here. If your wallet keeps returning another account, change this site’s connected accounts or disconnect and reconnect this site in the wallet. A different verified wallet cannot authorize this account.');
}
function requireSigningChain(value: unknown): void {
  if (typeof value !== 'string' || value.length > 66 || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) throw new Error('The wallet returned an invalid network ID.');
  if (BigInt(value) !== 1n) throw new Error('Select Ethereum Mainnet in your wallet, then try again. No transaction or ETH is needed.');
}

function signature(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(value)) throw new Error('The wallet returned an invalid typed-data signature.');
  const bytes = hexToBytes(value);
  if (bytes[64] === 0 || bytes[64] === 1) bytes[64] += 27;
  if (bytes[64] !== 27 && bytes[64] !== 28) throw new Error('The wallet returned an invalid signature recovery ID.');
  return bytesToHex(bytes);
}

function verifyCustodySignature(signatureHex: string, digest: Uint8Array, custody: string): void {
  try {
    const bytes = hexToBytes(signatureHex);
    const sig = secp256k1.Signature.fromBytes(bytes.subarray(0, 64), 'compact').addRecoveryBit(bytes[64] - 27);
    if (sig.hasHighS()) throw new Error('Noncanonical signature');
    const key = sig.recoverPublicKey(digest).toBytes(false);
    const recovered = `0x${bytesToHex(keccak_256(key.subarray(1)).subarray(12))}`;
    if (recovered !== custody) throw new Error('Wrong custody');
  } catch { throw new Error('The wallet signature does not match the account’s custody address.'); }
}

const DOMAIN_TYPES = [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }];
const DOMAIN = { name: KEY_DOMAIN_NAME, version: KEY_DOMAIN_VERSION, chainId: SIGNED_KEY_REQUEST_CHAIN_ID };
function typedData(primaryType: string, fields: Array<{ name: string; type: string }>, message: Record<string, unknown>): string {
  return JSON.stringify({ types: { EIP712Domain: DOMAIN_TYPES, [primaryType]: fields }, primaryType, domain: DOMAIN, message });
}
const KEY_ADD_TYPES = [{ name: 'fid', type: 'uint256' }, { name: 'key', type: 'bytes' }, { name: 'keyType', type: 'uint32' }, { name: 'scopes', type: 'uint32[]' }, { name: 'ttl', type: 'uint32' }, { name: 'nonce', type: 'uint32' }, { name: 'deadline', type: 'uint256' }];
const KEY_REQUEST_TYPES = [{ name: 'requestFid', type: 'uint256' }, { name: 'key', type: 'bytes' }, { name: 'deadline', type: 'uint256' }];
const KEY_REMOVE_TYPES = [{ name: 'fid', type: 'uint256' }, { name: 'key', type: 'bytes' }, { name: 'nonce', type: 'uint32' }, { name: 'deadline', type: 'uint256' }];

/** Two explicit wallet signatures; no wallet transactions or hosted login service. */
export async function approvePairingWithWallet(requestValue: PairingRequest, provider: WalletProvider, options: WalletApprovalOptions = {}): Promise<PairingApproval> {
  const request = validatePairingRequest(requestValue);
  const rpc = transport(provider, options);
  options.onProgress?.('Connect the custody account in your wallet…');
  requireCustodyAccount(await rpc('eth_requestAccounts'), request.custodyAddress);
  requireSigningChain(await rpc('eth_chainId'));
  validatePairingRequest(request);
  const key = hexToBytes(request.publicKey);
  options.onProgress?.('Approve the posting-key permissions in your wallet (1 of 2)…');
  const custodySignature = signature(await rpc('eth_signTypedData_v4', [request.custodyAddress, typedData('KeyAdd', KEY_ADD_TYPES, { fid: String(request.fid), key: `0x${request.publicKey}`, keyType: 1, scopes: [...request.scopes], ttl: request.ttl, nonce: request.nonce, deadline: String(request.deadline) })], SIGN_TIMEOUT_MS));
  verifyCustodySignature(custodySignature, keyAddDigest({ fid: request.fid, key, keyType: 1, scopes: request.scopes, ttl: request.ttl, nonce: request.nonce, deadline: request.deadline }), request.custodyAddress);
  requireCustodyAccount(await rpc('eth_accounts'), request.custodyAddress);
  requireSigningChain(await rpc('eth_chainId'));
  validatePairingRequest(request);
  options.onProgress?.('Approve the Hypersnap key request in your wallet (2 of 2)…');
  const requestSignature = signature(await rpc('eth_signTypedData_v4', [request.custodyAddress, typedData('SignedKeyRequest', KEY_REQUEST_TYPES, { requestFid: String(request.fid), key: `0x${request.publicKey}`, deadline: String(request.deadline) })], SIGN_TIMEOUT_MS));
  requireCustodyAccount(await rpc('eth_accounts'), request.custodyAddress);
  const approval: PairingApproval = { kind: 'arca.hypersnap.signer.approval', version: 1, requestId: request.requestId, requestHash: hashPairingRequest(request), custodyAddress: request.custodyAddress, custodySignature, requestSignature };
  verifyPairingApproval(request, approval);
  assertActive(options.signal);
  return approval;
}

/** Custody-approved removal also works through desktop and mobile wallet providers. */
export async function approveRevocationWithWallet(requestValue: RevocationRequest, provider: WalletProvider, options: WalletApprovalOptions = {}): Promise<RevocationApproval> {
  const request = validateRevocationRequest(requestValue);
  const rpc = transport(provider, options);
  options.onProgress?.('Connect the custody account in your wallet…');
  requireCustodyAccount(await rpc('eth_requestAccounts'), request.custodyAddress);
  requireSigningChain(await rpc('eth_chainId'));
  validateRevocationRequest(request);
  options.onProgress?.('Approve removal of this posting key in your wallet…');
  const custodySignature = signature(await rpc('eth_signTypedData_v4', [request.custodyAddress, typedData('KeyRemove', KEY_REMOVE_TYPES, { fid: String(request.fid), key: `0x${request.publicKey}`, nonce: request.nonce, deadline: String(request.deadline) })], SIGN_TIMEOUT_MS));
  verifyCustodySignature(custodySignature, keyRemoveDigest({ fid: request.fid, key: hexToBytes(request.publicKey), nonce: request.nonce, deadline: request.deadline }), request.custodyAddress);
  requireCustodyAccount(await rpc('eth_accounts'), request.custodyAddress);
  const approval: RevocationApproval = { kind: 'arca.hypersnap.signer.revoke.approval', version: 1, requestId: request.requestId, requestHash: hashRevocationRequest(request), custodyAddress: request.custodyAddress, custodySignature, signatureType: 1 };
  verifyRevocationApproval(request, approval);
  assertActive(options.signal);
  return approval;
}
