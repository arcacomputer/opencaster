import { PAIRING_ORIGINS, validateSignerRequest, type SignerRequest } from '@opencaster/client-core/pairing';
import { KEY_DOMAIN_NAME, KEY_DOMAIN_VERSION } from '@opencaster/protocol/signedKeyRequest';
import type { WalletProvider } from './wallet';

export const WALLETCONNECT_SETUP_TIMEOUT_MS = 30_000;
export const WALLETCONNECT_PAIRING_TIMEOUT_MS = 180_000;
export const WALLETCONNECT_SIGN_TIMEOUT_MS = 120_000;
const CHAIN = 'eip155:1';
const SIGN_METHOD = 'eth_signTypedData_v4';
const DISCONNECT_REASON = { code: 6000, message: 'This approval is finished.' };

export interface WalletConnectOptions {
  projectId: string;
  custodyAddress: string;
  request: SignerRequest;
  signal?: AbortSignal;
  /** The pairing URI contains an ephemeral secret. Display locally; never log or persist it. */
  onUri(uri: string | null): void;
  onSignRequest?(): void;
  onProgress?(message: string): void;
}

export interface WalletConnectSession {
  topic: string;
  expiry: number;
  namespaces: Record<string, { accounts: string[]; methods: string[]; events: string[]; chains?: string[] }>;
}
export interface WalletConnectClient {
  session: { getAll(): WalletConnectSession[]; get(topic: string): WalletConnectSession };
  core: {
    pairing: { getPairings(): Array<{ topic: string }>; disconnect(params: { topic: string }): Promise<void> };
    relayer: { transportClose(): Promise<void> };
    heartbeat: { stop(): void };
  };
  connect(params: { optionalNamespaces: { eip155: { chains: string[]; methods: string[]; events: string[] } } }): Promise<{ uri?: string; approval(): Promise<WalletConnectSession> }>;
  request(params: { topic: string; chainId: string; request: { method: string; params: readonly unknown[] }; expiry: number }): Promise<unknown>;
  disconnect(params: { topic: string; reason: { code: number; message: string } }): Promise<void>;
  on(event: string, listener: (event: unknown) => void): unknown;
  off(event: string, listener: (event: unknown) => void): unknown;
  /** Drop local SDK session/pairing records and relay keys even if disconnect fails. */
  clearLocalState(): Promise<void>;
}

/** A fresh, nonpersistent SDK store for each individual approval. */
export class WalletConnectMemoryStorage {
  private values = new Map<string, unknown>();
  private closed = false;
  async getKeys(): Promise<string[]> { return [...this.values.keys()]; }
  async getEntries<T>(): Promise<[string, T][]> { return [...this.values.entries()].map(([key, value]) => [key, structuredClone(value) as T]); }
  async getItem<T>(key: string): Promise<T | undefined> { const value = this.values.get(key); return value === undefined ? undefined : structuredClone(value) as T; }
  async setItem<T>(key: string, value: T): Promise<void> { if (!this.closed) this.values.set(key, structuredClone(value)); }
  async removeItem(key: string): Promise<void> { this.values.delete(key); }
  close(): void { this.closed = true; this.values.clear(); }
}
export interface WalletConnectClientOptions {
  projectId: string;
  storage: WalletConnectMemoryStorage;
  customStoragePrefix: string;
  logger: 'silent';
  telemetryEnabled: false;
  metadata: { name: string; description: string; url: string; icons: string[] };
  signal: AbortSignal;
}
export type WalletConnectClientFactory = (options: WalletConnectClientOptions) => Promise<WalletConnectClient>;

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function abortReason(signal: AbortSignal): Error { return signal.reason instanceof Error && signal.reason.name !== 'AbortError' ? signal.reason : new DOMException('Wallet connection cancelled.', 'AbortError'); }
function assertActive(signal: AbortSignal): void { if (signal.aborted) throw abortReason(signal); }
function bounded<T>(pending: Promise<T>, timeoutMs: number, signal: AbortSignal | undefined, message: string, preserveError = false): Promise<T> {
  return new Promise((resolve, reject) => {
    let complete = false;
    const finish = (error?: Error, value?: T) => {
      if (complete) return;
      complete = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value as T);
    };
    const abort = () => finish(abortReason(signal!));
    const timer = setTimeout(() => finish(new Error(message)), timeoutMs);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    pending.then(value => finish(undefined, value), error => finish(preserveError && error instanceof Error ? error : new Error(message)));
  });
}

function validateSession(session: WalletConnectSession, custody: string): void {
  if (!object(session) || typeof session.topic !== 'string' || !/^[a-f0-9]{64}$/i.test(session.topic) || !Number.isSafeInteger(session.expiry) || session.expiry <= Math.floor(Date.now() / 1000) || !object(session.namespaces)) throw new Error('The wallet returned an invalid or expired connection.');
  const keys = Object.keys(session.namespaces);
  if (keys.length !== 1 || (keys[0] !== 'eip155' && keys[0] !== CHAIN)) throw new Error('Connect only Ethereum Mainnet for this signature-only approval.');
  const namespace = session.namespaces[keys[0]];
  if (!object(namespace) || !Array.isArray(namespace.methods) || namespace.methods.length !== 1 || namespace.methods[0] !== SIGN_METHOD || !Array.isArray(namespace.events) || namespace.events.length !== 0 || (namespace.chains !== undefined && (!Array.isArray(namespace.chains) || namespace.chains.length !== 1 || namespace.chains[0] !== CHAIN))) throw new Error('The wallet granted broader permissions than this signature-only approval requested.');
  if (!Array.isArray(namespace.accounts) || namespace.accounts.length !== 1 || typeof namespace.accounts[0] !== 'string' || namespace.accounts[0].toLowerCase() !== `${CHAIN}:${custody}`) throw new Error('Select only the custody address shown for this identity on Ethereum Mainnet in your wallet.');
}

function validateUri(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /\s/u.test(value)) throw new Error('The wallet returned an invalid pairing code.');
  const parsed = new URL(value);
  if (parsed.protocol !== 'wc:' || !/^[a-f0-9]{64}@2$/i.test(parsed.pathname) || parsed.searchParams.get('relay-protocol') !== 'irn' || !/^[a-f0-9]{64}$/i.test(parsed.searchParams.get('symKey') ?? '')) throw new Error('The wallet returned an invalid pairing code.');
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const DOMAIN_FIELDS = [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }];
const KEY_ADD_FIELDS = [{ name: 'fid', type: 'uint256' }, { name: 'key', type: 'bytes' }, { name: 'keyType', type: 'uint32' }, { name: 'scopes', type: 'uint32[]' }, { name: 'ttl', type: 'uint32' }, { name: 'nonce', type: 'uint32' }, { name: 'deadline', type: 'uint256' }];
const KEY_REQUEST_FIELDS = [{ name: 'requestFid', type: 'uint256' }, { name: 'key', type: 'bytes' }, { name: 'deadline', type: 'uint256' }];
const KEY_REMOVE_FIELDS = [{ name: 'fid', type: 'uint256' }, { name: 'key', type: 'bytes' }, { name: 'nonce', type: 'uint32' }, { name: 'deadline', type: 'uint256' }];

function allowedTypedData(value: unknown, request: SignerRequest, used: Set<string>): { primaryType: string; serialized: string } {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('Only the displayed Hypersnap authorization may be signed.');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('Invalid Hypersnap typed data.'); }
  if (!object(parsed) || typeof parsed.primaryType !== 'string') throw new Error('Invalid Hypersnap typed data.');
  const primaryType = parsed.primaryType;
  let fields: Array<{ name: string; type: string }>;
  let message: Record<string, unknown>;
  if (request.kind === 'arca.hypersnap.signer.request' && primaryType === 'KeyAdd' && used.size === 0) {
    fields = KEY_ADD_FIELDS; message = { fid: String(request.fid), key: `0x${request.publicKey}`, keyType: 1, scopes: request.scopes, ttl: request.ttl, nonce: request.nonce, deadline: String(request.deadline) };
  } else if (request.kind === 'arca.hypersnap.signer.request' && primaryType === 'SignedKeyRequest' && used.has('KeyAdd') && used.size === 1) {
    fields = KEY_REQUEST_FIELDS; message = { requestFid: String(request.fid), key: `0x${request.publicKey}`, deadline: String(request.deadline) };
  } else if (request.kind === 'arca.hypersnap.signer.revoke.request' && primaryType === 'KeyRemove' && used.size === 0) {
    fields = KEY_REMOVE_FIELDS; message = { fid: String(request.fid), key: `0x${request.publicKey}`, nonce: request.nonce, deadline: String(request.deadline) };
  } else throw new Error('This wallet connection only signs the displayed Hypersnap operation once.');
  const expected = { types: { EIP712Domain: DOMAIN_FIELDS, [primaryType]: fields }, primaryType, domain: { name: KEY_DOMAIN_NAME, version: KEY_DOMAIN_VERSION, chainId: 1 }, message };
  if (canonical(parsed) !== canonical(expected)) throw new Error('The signing request does not match the account, key and permissions you reviewed.');
  return { primaryType, serialized: value };
}

async function cleanupClient(client: WalletConnectClient): Promise<void> {
  // Cleanup remains bounded even when the relay is unavailable after approval.
  try {
    const sessions = client.session.getAll().slice(0, 16);
    await Promise.allSettled(sessions.map(session => bounded(client.disconnect({ topic: session.topic, reason: DISCONNECT_REASON }), 1500, undefined, 'Disconnect timed out.')));
  } catch { /* Transport closure and memory deletion still happen below. */ }
  try {
    const pairings = client.core.pairing.getPairings().slice(0, 16);
    await Promise.allSettled(pairings.map(pairing => bounded(client.core.pairing.disconnect({ topic: pairing.topic }), 1500, undefined, 'Pairing cleanup timed out.')));
  } catch { /* Never expose pairing material in an error or a log. */ }
  try { client.core.heartbeat.stop(); } catch { /* A failed startup may have no heartbeat. */ }
  try { await bounded(client.core.relayer.transportClose(), 1500, undefined, 'Connection closure timed out.'); } catch { /* Ephemeral memory is cleared by the caller regardless. */ }
  try { await bounded(client.clearLocalState(), 1500, undefined, 'Local connection cleanup timed out.'); } catch { /* The closed memory store still prevents persistence. */ }
}

async function defaultFactory(options: WalletConnectClientOptions): Promise<WalletConnectClient> {
  const { createWalletConnectClient } = await import('./walletConnectSDK');
  return createWalletConnectClient(options);
}
function metadataOrigin(request: SignerRequest): string {
  try {
    const origin = globalThis.location?.origin;
    if (origin && PAIRING_ORIGINS.includes(origin as typeof PAIRING_ORIGINS[number])) return origin;
    if (import.meta.env.DEV && origin) {
      const parsed = new URL(origin);
      if (parsed.origin === origin && parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) return origin;
    }
  } catch { /* Node tests and unsupported hostnames use the validated request origin. */ }
  return request.origin;
}

/** A new, signature-only connection for one approval; never restores a wallet session. */
export async function withWalletConnect<T>(options: WalletConnectOptions, action: (provider: WalletProvider) => Promise<T>, createClient: WalletConnectClientFactory = defaultFactory): Promise<T> {
  if (!/^[a-f0-9]{32}$/i.test(options.projectId)) throw new Error('WalletConnect is not configured. Use an installed wallet or the offline signer.');
  const request = validateSignerRequest(options.request);
  if (options.custodyAddress.toLowerCase() !== request.custodyAddress) throw new Error('The requested wallet does not match this account’s custody address.');
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true });
  const storage = new WalletConnectMemoryStorage();
  let client: WalletConnectClient | undefined;
  let active = true;
  let topic: string | undefined;
  const invalidated = (event: unknown) => { if (object(event) && event.topic === topic) controller.abort(new Error('The wallet session changed or disconnected. Connect again before signing.')); };
  try {
    assertActive(controller.signal);
    options.onProgress?.('Opening a temporary encrypted wallet connection…');
    const origin = metadataOrigin(request);
    const pending = createClient({ projectId: options.projectId, storage, customStoragePrefix: `arca-${crypto.randomUUID()}`, logger: 'silent', telemetryEnabled: false, metadata: { name: 'Opencaster', description: 'Approve one Hypersnap posting-key operation. No wallet transaction.', url: origin, icons: [`${origin}/opencaster-symbol.svg`] }, signal: controller.signal });
    pending.then(late => { if (!active) void cleanupClient(late); }, () => {});
    client = await bounded(pending, WALLETCONNECT_SETUP_TIMEOUT_MS, controller.signal, 'The wallet relay could not initialize. Please try again.');
    if (client.session.getAll().length !== 0) throw new Error('A restored wallet session was rejected. Start a fresh connection.');
    // Current SignClient uses optionalNamespaces for proposals. Validation of
    // the approved namespace below remains strict and never permits omissions.
    const pendingConnect = client.connect({ optionalNamespaces: { eip155: { chains: [CHAIN], methods: [SIGN_METHOD], events: [] } } });
    pendingConnect.then(() => { if (!active && client) void cleanupClient(client); }, () => {});
    const connect = await bounded(pendingConnect, WALLETCONNECT_SETUP_TIMEOUT_MS, controller.signal, 'The wallet pairing request could not start.');
    options.onUri(validateUri(connect.uri));
    options.onProgress?.('Open your wallet or scan the QR code, then select the matching custody account…');
    const pendingApproval = connect.approval();
    pendingApproval.then(() => { if (!active && client) void cleanupClient(client); }, () => {});
    const session = await bounded(pendingApproval, WALLETCONNECT_PAIRING_TIMEOUT_MS, controller.signal, 'Wallet pairing expired or was declined. Start a fresh connection.');
    validateSession(session, request.custodyAddress);
    topic = session.topic;
    for (const event of ['session_delete', 'session_expire', 'session_update', 'session_event']) client.on(event, invalidated);
    options.onUri(null);
    const used = new Set<string>();
    const provider: WalletProvider = Object.freeze({
      async request(args: Parameters<WalletProvider['request']>[0]) {
        assertActive(controller.signal);
        if (!active || !client || !topic) throw new Error('This temporary wallet connection has ended.');
        validateSession(client.session.get(topic), request.custodyAddress);
        if (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') return [request.custodyAddress];
        if (args.method === 'eth_chainId') return '0x1';
        if (args.method !== SIGN_METHOD || !Array.isArray(args.params) || args.params.length !== 2 || typeof args.params[0] !== 'string' || args.params[0].toLowerCase() !== request.custodyAddress) throw new Error('This connection supports only the displayed Hypersnap typed-data signatures.');
        validateSignerRequest(request);
        const typed = allowedTypedData(args.params[1], request, used);
        used.add(typed.primaryType); // Never repeat an uncertain signature request.
        options.onSignRequest?.();
        // WalletConnect requires a minimum five-minute protocol expiry. Our
        // local operation still times out after two minutes and closes its keys.
        return bounded(client.request({ topic, chainId: CHAIN, request: { method: SIGN_METHOD, params: [request.custodyAddress, typed.serialized] }, expiry: 300 }), WALLETCONNECT_SIGN_TIMEOUT_MS, controller.signal, 'The wallet signature timed out or was declined. Finish or reject the open wallet request before reconnecting.');
      },
    });
    return await bounded(action(provider), WALLETCONNECT_SIGN_TIMEOUT_MS * 3, controller.signal, 'The temporary wallet approval expired. Connect again to continue.', true);
  } finally {
    active = false;
    controller.abort();
    options.signal?.removeEventListener('abort', abort);
    try { options.onUri(null); } catch { /* UI teardown must not prevent cleanup. */ }
    if (client) {
      for (const event of ['session_delete', 'session_expire', 'session_update', 'session_event']) { try { client.off(event, invalidated); } catch { /* Continue cleanup after SDK listener errors. */ } }
      await cleanupClient(client);
    }
    storage.close();
  }
}
