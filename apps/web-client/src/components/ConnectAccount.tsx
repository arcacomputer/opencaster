import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { IconArrowDown, IconArrowLeft, IconArrowUpRight, IconCheck, IconCode, IconDeviceDesktop, IconFileCheck, IconKey, IconLock, IconRefresh, IconShieldLock, IconTrash, IconWallet } from '@tabler/icons-react';
import { Button, Input, Modal } from './ui';
import WalletConnectLogo from './WalletConnectLogo';
import { deleteSavedSession, getSavedSessionMethod, preparePairing, unlockSavedSession, unlockSavedSessionWithPasskey, type PendingPairing, type PendingRevocation, type WalletSession } from '../lib/auth';
import { PAIRING_SCOPES, hashPairingRequest, hashRevocationRequest, validatePairingScopes, validatePairingApproval, verifyPairingApproval, validateRevocationApproval, verifyRevocationApproval, type PairingApproval, type PairingRequest, type RevocationApproval, type RevocationRequest } from '@opencaster/client-core/pairing';
import { approvePairingWithWallet, approveRevocationWithWallet, discoverInjectedWallets, type InjectedWallet } from '../lib/wallet';
import { passkeysAvailable } from '../lib/passkey';
import { ApiError, getUser } from '@opencaster/client-core/api';
import { normalizeReviewIdentity, parseAccountLookup, sameReviewIdentity, type ReviewIdentity } from '../lib/accountLookup';
import '../onboarding.scss';

const sourceUrl = 'https://github.com/arcacomputer/opencaster';
const releaseTag = 'arca-signer-v0.2.2';
const signerUrl = `${sourceUrl}/releases/download/${releaseTag}/Arca-Signer-mac-arm64.zip`;
const approvalLimitBytes = 16 * 1024;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'This action could not be completed.';
const fingerprint = (key: string) => key.match(/.{1,8}/g)?.join(' ') ?? key;

const WalletConnectPanel = lazy(() => import('./WalletConnectPanel'));

function WalletApproval({ request, disabled, expired = false, onApproved, onBusy, onError }: {
  request: PairingRequest | RevocationRequest;
  disabled: boolean;
  expired?: boolean;
  onApproved(approval: PairingApproval | RevocationApproval, walletName: string): void;
  onBusy(value: boolean): void;
  onError(value: string): void;
}) {
  const [wallets, setWallets] = useState<InjectedWallet[]>([]);
  const [selection, setSelection] = useState<{ wallet: InjectedWallet; explicit: boolean } | null>(null);
  const [waiting, setWaiting] = useState<InjectedWallet | null>(null);
  const [progress, setProgress] = useState('');
  const [walletError, setWalletError] = useState('');
  const [retry, setRetry] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [walletConnect, setWalletConnect] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(false);
  const providerOptions = useRef(new Map<InjectedWallet['provider'], string>());
  function optionValue(wallet: InjectedWallet) {
    let value = providerOptions.current.get(wallet.provider);
    if (!value) { value = `wallet-${providerOptions.current.size + 1}`; providerOptions.current.set(wallet.provider, value); }
    return value;
  }
  const currentRequest = useRef(request.requestId); currentRequest.current = request.requestId;
  const isExpired = useRef(expired); isExpired.current = expired;
  const selectId = useId();
  // Provider references are the authority for selection. An extension can
  // announce upgraded labels later; an ID/brand collision cannot switch it.
  const matching = selection && wallets.find(wallet => wallet.provider === selection.wallet.provider);
  const selected = matching || selection?.wallet;
  const browserWallets = selection && !matching ? [...wallets, selection.wallet] : wallets;
  useEffect(() => discoverInjectedWallets(found => {
    setWallets(found);
    setSelection(current => current?.explicit || active.current ? current : found.length === 1 ? { wallet: found[0], explicit: false } : null);
  }), [refresh]);
  useEffect(() => {
    setWaiting(null); setProgress(''); setWalletError(''); setRetry(false);
    return () => { generation.current += 1; controller.current?.abort(); active.current = false; };
  }, [request.requestId]);
  const cancel = useCallback((message = 'Cancelled on this site. Reject any request still open in your wallet before retrying.') => {
    const ownedBusy = active.current || walletConnect;
    generation.current += 1; controller.current?.abort(); controller.current = null; active.current = false;
    setWaiting(null); setWalletConnect(false); setProgress(message); setWalletError(''); setRetry(true); if (ownedBusy) onBusy(false); onError('');
  }, [walletConnect, onBusy, onError]);
  useEffect(() => {
    if (expired && (active.current || walletConnect)) cancel('This approval request expired. Use another account to start again with a fresh request. Reject any request still open in your wallet.');
  }, [expired, request.requestId, walletConnect, cancel]);
  async function approve(wallet: InjectedWallet) {
    if (disabled || active.current || isExpired.current) return;
    active.current = true; setSelection({ wallet, explicit: true }); setWalletConnect(false);
    const run = ++generation.current; const requestId = request.requestId;
    controller.current?.abort(); const attempt = new AbortController(); controller.current = attempt;
    setWaiting(wallet); setWalletError(''); setProgress(`Connecting ${wallet.name} to the custody account…`); onBusy(true); onError('');
    const current = () => run === generation.current && requestId === currentRequest.current && !attempt.signal.aborted && !isExpired.current;
    const options = { signal: attempt.signal, onProgress: (text: string) => { if (current()) setProgress(text); } };
    try {
      const value = request.kind === 'arca.hypersnap.signer.request'
        ? await approvePairingWithWallet(request, wallet.provider, options)
        : await approveRevocationWithWallet(request, wallet.provider, options);
      if (current()) { setProgress('Wallet signatures received. Review the approval below, then submit it to Hypersnap.'); setRetry(false); onApproved(value, wallet.name); }
    } catch (cause) { if (current()) { const text = errorMessage(cause); setWalletError(text); setProgress(''); setRetry(true); onError(text); } }
    finally { if (run === generation.current) { active.current = false; setWaiting(null); onBusy(false); } }
  }
  function refreshWallets() {
    if (disabled || active.current) return;
    providerOptions.current.clear(); setSelection(null); setWallets([]); setWalletError(''); setProgress('Wallet detection refreshed. Choose the wallet that contains your Farcaster custody account.'); setRetry(false); onError(''); setRefresh(value => value + 1);
  }
  return <section className="wallet-approval">
    <h3><IconWallet size={19} />Approve with your wallet</h3>
    <p>{request.kind === 'arca.hypersnap.signer.request' ? 'After connecting the account that owns this identity, approve two typed-data signatures: posting-key permissions (1 of 2), then the Hypersnap key request (2 of 2).' : 'Connect the custody wallet and approve the typed-data signature to revoke this device’s posting key.'} Review the FID, key, permissions, and deadline. These signatures do not send a transaction, mint an NFT, approve tokens or transfer assets. No transaction fee is required.</p>
    {request.kind === 'arca.hypersnap.signer.request' && <p className="wallet-approval-next">After both signatures, return here and choose <strong>Submit approved device key</strong>. That separate step sends the authorization to Hypersnap.</p>}
    <div className="wallet-browser-heading"><strong>Browser wallet</strong><span>Connect directly with your installed extension.</span></div>
    {!!browserWallets.length && <div className="wallet-list"><label htmlFor={selectId}>Choose your browser wallet</label><select id={selectId} value={selected ? optionValue(selected) : ''} disabled={disabled || !!waiting} onChange={event => {
      const wallet = browserWallets.find(value => optionValue(value) === event.target.value);
      setSelection(wallet ? { wallet, explicit: true } : null); setWalletError(''); setProgress(''); setRetry(false); onError('');
    }}><option value="">Select a browser wallet</option>{browserWallets.map(wallet => <option key={optionValue(wallet)} value={optionValue(wallet)}>{wallet.name}{wallet.rdns ? ` · ${wallet.rdns}` : ''}{selection && !matching && wallet === selection.wallet ? ' (previously selected)' : ''}</option>)}</select><Button disabled={disabled || !!waiting || !selected} onClick={() => { if (selected) void approve(selected); }}>{waiting ? <IconRefresh size={17} className="spin" /> : <IconWallet size={17} />}<span>{waiting ? `Check ${waiting.name}…` : !selected ? 'Choose a browser wallet' : retry ? `Retry ${selected.name} approval` : selected.rdns === 'me.rainbow' ? 'Connect Rainbow extension & approve' : `Connect ${selected.name} & approve`}</span><IconArrowUpRight size={15} /></Button></div>}
    <div className="wallet-not-found">{!browserWallets.length && <p>No browser wallet detected. Unlock or enable your extension in this browser, allow it to access this site, then refresh detection.</p>}<Button variant="secondary" disabled={disabled || !!waiting} onClick={refreshWallets}><IconRefresh size={15} />Refresh browser wallets</Button></div>
    {(waiting || progress || walletError) && <div className="wallet-approval-feedback">{progress && <p className="pairing-copy" role="status" aria-live="polite">{progress}</p>}{walletError && <p className="error" role="alert">{walletError}</p>}{waiting && <><Button variant="secondary" onClick={() => cancel()}>Cancel wallet approval</Button><p className="pairing-release">Open {waiting.name} from your browser toolbar to check its pending requests. Cancelling here cannot close or reject its popup.</p></>}</div>}
    <details className="wallet-account-help"><summary>Wallet shows the wrong account?</summary><p>Use the imported Farcaster recovery account that matches the custody address below. Your everyday wallet or another verified address cannot authorize this identity.</p><p>In Coinbase Wallet or another extension, select that imported account and allow this site to connect to it using the wallet’s connected-site controls. Then retry here. If a request is already pending, finish or reject it in the wallet first. You can also refresh wallet detection or choose another wallet.</p></details>
    <div className="wallet-extension-label">Or connect a mobile wallet</div>
    {!walletConnect ? <><Button aria-label="Connect wallet app" className="full-width walletconnect-start" disabled={disabled || !!waiting} onClick={() => { onBusy(true); onError(''); setWalletConnect(true); }}><WalletConnectLogo size={27} /><span className="walletconnect-start-label"><strong>Connect wallet app</strong><small>WalletConnect</small></span><IconArrowUpRight size={16} /></Button><p className="pairing-release">WalletConnect · scan a QR code on desktop or open your wallet app on mobile. Keep using this browser.</p></> : <Suspense fallback={<div className="walletconnect-panel"><p role="status"><IconRefresh size={16} className="spin" />Loading wallet app connection…</p><Button variant="ghost" onClick={() => { setWalletConnect(false); onBusy(false); }}>Cancel</Button></div>}><WalletConnectPanel request={request} onApproved={onApproved} onBusy={onBusy} onError={onError} onClose={() => setWalletConnect(false)} /></Suspense>}
    <p className="pairing-release">Select Ethereum Mainnet in your wallet for signing (chain ID 1). These signatures use the historical “Farcaster KeyAdd” domain to authorize this key on Hypersnap. No Farcaster login, ETH, or wallet transaction is required.</p>
    <p className="pairing-release">The connected address must match <span className="pairing-mono">{request.custodyAddress}</span>. A verified wallet address alone does not grant account access. Wallet support depends on its provider and signing capabilities.</p>
  </section>;
}

function AccountFacts({ request }: { request: PairingRequest }) {
  return <><dl className="pairing-facts onboarding-permissions">
    <div><dt>Permission</dt><dd>{request.scopes.includes(2) ? 'Publish and delete your own casts, add or remove reactions, follow or unfollow accounts, and edit profile metadata' : request.scopes.includes(11) ? 'Publish casts, add or remove reactions, follow or unfollow accounts, and edit profile metadata' : 'Publish casts and add or remove reactions'}</dd></div>
    <div><dt>Inactivity expiry</dt><dd>7 days, renewed by signing activity</dd></div>
    <div><dt>Approve before</dt><dd>{new Date((request.deadline + 1609459200) * 1000).toLocaleString()}</dd></div>
  </dl><details className="onboarding-protocol"><summary>Device key and protocol details</summary><dl className="pairing-facts">
    <div><dt>Device key fingerprint</dt><dd className="pairing-mono">{fingerprint(request.publicKey)}</dd></div>
    <div><dt>Request checksum</dt><dd className="pairing-mono">{hashPairingRequest(request)}</dd></div>
    <div><dt>Website label</dt><dd className="pairing-mono">{request.origin}<small>Self-reported; this label does not authenticate the website.</small></dd></div>
  </dl></details></>;
}

function IdentitySummary({ identity, ensName }: { identity: ReviewIdentity; ensName?: string }) {
  return <section className="onboarding-identity" aria-label="Account identity"><div className="onboarding-identity__intro"><span aria-hidden="true"><IconWallet size={25} /></span><div><p>YOUR HYPERSNAP IDENTITY</p><h3>{identity.displayName || (identity.username ? `@${identity.username}` : `Account FID ${identity.fid}`)}</h3></div></div><dl>
    {ensName && <div><dt>ENS name used for lookup</dt><dd><span>{ensName}</span><small className="onboarding-identity__note">Lookup label only. The custody wallet below controls this account.</small></dd></div>}
    <div><dt>Username</dt><dd>{identity.username ? `@${identity.username}` : 'Username unavailable on Hypersnap'}</dd></div>
    <div><dt>FID</dt><dd>{identity.fid}</dd></div>
    <div className="onboarding-identity__custody"><dt>Custody wallet</dt><dd><code>{identity.custodyAddress}</code></dd></div>
  </dl></section>;
}
function OnboardingFrame({ presentation, title, onClose, children }: { presentation: 'page' | 'dialog'; title: string; onClose(): void; children: ReactNode }) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (presentation === 'page') heading.current?.focus(); }, [presentation]);
  if (presentation === 'dialog') return <Modal title={title} onClose={onClose}>{children}</Modal>;
  return <main className="onboarding" aria-labelledby={headingId}><header className="onboarding__header"><Button variant="ghost" aria-label="Cancel sign-in" onClick={onClose}><IconArrowLeft size={18} />Back</Button><span>Opencaster <span>Runs on Hypersnap</span></span></header><div className="onboarding__intro"><p>YOUR IDENTITY, YOUR WALLET</p><h1 ref={heading} tabIndex={-1} id={headingId}>{title}</h1><p>Bring your existing account. Keep your recovery phrase in your wallet.</p></div><div className="onboarding__card">{children}</div><p className="onboarding__credit">Powered by <a href="https://arca.computer" target="_blank" rel="noopener noreferrer">Arca Computer</a> · <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Open source</a></p></main>;
}
export interface ConnectAccountProps { onClose(): void; onConnect(session: WalletSession): void; requestedScopes?: readonly number[]; initialFid?: number; presentation?: 'page' | 'dialog' }
export default function ConnectAccount({ onClose, onConnect, requestedScopes, initialFid, presentation = 'page' }: ConnectAccountProps) {
  const [scopes] = useState(() => validatePairingScopes(requestedScopes ? [...requestedScopes] : [...PAIRING_SCOPES]));
  const socialApproval = scopes.includes(11);
  const deletionApproval = scopes.includes(2);
  const [identifier, setIdentifier] = useState(initialFid ? String(initialFid) : '');
  const [lookupEnsName, setLookupEnsName] = useState('');
  const [ensNotFound, setEnsNotFound] = useState(false);
  const [identity, setIdentity] = useState<ReviewIdentity | null>(null);
  const [identityAccepted, setIdentityAccepted] = useState(false);
  const [identityChanged, setIdentityChanged] = useState(false);
  const [request, setRequest] = useState<PairingRequest | null>(null);
  const [approval, setApproval] = useState<PairingApproval | null>(null);
  const [approvalName, setApprovalName] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [savedMethod, setSavedMethod] = useState<'password' | 'passkey' | undefined>();
  const [storageUnreadable, setStorageUnreadable] = useState(false);
  const saved = savedMethod !== undefined;
  const [unlock, setUnlock] = useState(false);
  const [remember, setRemember] = useState(false);
  const [storageMethod, setStorageMethod] = useState<'passkey' | 'password'>('passkey');
  const [canUsePasskeys] = useState(passkeysAvailable);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const pending = useRef<PendingPairing | null>(null);
  const provisionalSession = useRef<WalletSession | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileReadGeneration = useRef(0);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const currentStep = connected ? 4 : request && identityAccepted ? 3 : identity ? 2 : 1;
  const previousStage = useRef({ step: currentStep, unlock });

  useEffect(() => {
    let active = true;
    const initialGeneration = generation.current;
    getSavedSessionMethod().then(value => { if (active && generation.current === initialGeneration) { setSavedMethod(value); setStorageUnreadable(false); if (!socialApproval) setUnlock(value !== undefined); } }).catch(() => { if (active && generation.current === initialGeneration) { setStorageUnreadable(true); setError('Your saved device key could not be read. You can reconnect with your custody wallet for this tab, or explicitly forget the unreadable vault.'); } });
    return () => { active = false; generation.current += 1; controller.current?.abort(); pending.current?.dispose(); provisionalSession.current?.dispose(); };
  }, [socialApproval]);
  useEffect(() => {
    if (!request) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [request]);
  const expired = request !== null && Math.floor(now / 1000) >= request.deadline + 1609459200;
  const passwordValid = password.length >= 12 && password === confirmation;
  useEffect(() => {
    const previous = previousStage.current; previousStage.current = { step: currentStep, unlock };
    if (presentation === 'page' && (currentStep > 1 || previous.step !== currentStep || previous.unlock !== unlock)) stepHeading.current?.focus();
  }, [currentStep, identityChanged, presentation, unlock]);

  function reset() {
    generation.current += 1;
    controller.current?.abort(); pending.current?.dispose(); pending.current = null;
    provisionalSession.current?.dispose(); provisionalSession.current = null;
    setRequest(null); setApproval(null); setApprovalName(''); setAttempted(false); setConnected(false);
    setIdentity(null); setIdentityAccepted(false); setIdentityChanged(false); setRemember(false); setLookupEnsName(''); setEnsNotFound(false);
    setPassword(''); setConfirmation(''); setStorageMethod('passkey'); setError(''); setStage(''); setBusy(false);
  }
  function close() { reset(); onClose(); }
  function acceptSession(session: WalletSession, run: number) {
    if (run !== generation.current) { session.dispose(); return; }
    provisionalSession.current = null;
    setPassword(''); setConfirmation(''); onConnect(session);
  }
  async function findAccount(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const run = ++generation.current;
    controller.current = new AbortController(); setBusy(true); setError(''); setLookupEnsName(''); setEnsNotFound(false); setStage('Looking up your public account…');
    let ensName = '';
    try {
      const lookup = parseAccountLookup(identifier, initialFid);
      if ('ensName' in lookup && typeof lookup.ensName === 'string') ensName = lookup.ensName;
      const user = await getUser(lookup, controller.current.signal);
      if (run !== generation.current) return;
      setIdentity(normalizeReviewIdentity(user, lookup)); setLookupEnsName(ensName); setIdentityAccepted(false); setIdentityChanged(false);
    } catch (cause) {
      if (run === generation.current) {
        const missingName = Boolean(ensName && cause instanceof ApiError && cause.status === 404 && cause.code === 'ens_name_not_found');
        setEnsNotFound(missingName); setError(missingName ? 'No account is linked to this ENS or Base name in this Hypersnap node.' : errorMessage(cause));
      }
    }
    finally { if (run === generation.current) { setBusy(false); setStage(''); } }
  }
  async function prepareReviewedAccount() {
    if (busy || !identity || request) return;
    const reviewed = identity;
    const run = ++generation.current;
    controller.current = new AbortController(); setBusy(true); setError(''); setStage('Checking the account and preparing this device’s key…');
    let value: PendingPairing | undefined;
    try {
      value = await preparePairing({ fid: reviewed.fid }, { origin: location.origin, requestedScopes: scopes, signal: controller.current.signal, onProgress: text => { if (run === generation.current) setStage(text); } });
      if (run !== generation.current) { value.dispose(); return; }
      const fresh = normalizeReviewIdentity(value.user, { fid: reviewed.fid });
      if (value.request.fid !== fresh.fid || value.request.custodyAddress.toLowerCase() !== fresh.custodyAddress) throw new Error('The prepared authorization does not match the account’s current identity. Find the account again.');
      const changed = !sameReviewIdentity(reviewed, fresh);
      setIdentity(fresh); setIdentityChanged(changed); setIdentityAccepted(!changed); setLookupEnsName('');
      pending.current = value; setRequest(value.request); setNow(Date.now());
    } catch (cause) { value?.dispose(); if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) { setBusy(false); setStage(''); } }
  }
  function downloadRequest() {
    if (!request) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(request, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'arca-authorization-request.json';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importApproval(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || busy || attempted) return;
    const run = generation.current;
    const fileRun = ++fileReadGeneration.current;
    setError(''); setApproval(null); setApprovalName('');
    try {
      if (file.size > approvalLimitBytes) throw new Error('Approval files must be smaller than 16 KiB. Choose the JSON exported by Arca Signer.');
      const text = await file.text();
      if (run !== generation.current || fileRun !== fileReadGeneration.current) return;
      const value = validatePairingApproval(JSON.parse(text) as unknown);
      if (!request) return;
      verifyPairingApproval(request, value);
      setApproval(value); setApprovalName(file.name.slice(0, 100));
    } catch (cause) { if (run === generation.current && fileRun === fileReadGeneration.current) setError(cause instanceof SyntaxError ? 'Invalid approval file. Choose the public approval JSON exported by Arca Signer, up to 16 KiB. Never import your recovery phrase here.' : errorMessage(cause)); }
  }
  async function complete(event: FormEvent) {
    event.preventDefault();
    if (busy || connected || !identityAccepted || !pending.current || !approval) return;
    const run = generation.current;
    controller.current = new AbortController(); setBusy(true); setError(''); setAttempted(true);
    try {
      const session = provisionalSession.current ?? await pending.current.complete(approval, { signal: controller.current.signal, onProgress: text => { if (run === generation.current) setStage(text); } });
      if (run !== generation.current) { session.dispose(); return; }
      provisionalSession.current = session; setConnected(true);
      // A separate click starts WebAuthn after authorization has completed,
      // preserving fresh browser activation and an explicit storage choice.
      if (remember) return;
      acceptSession(session, run);
    } catch (cause) { if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) { setAttempted(pending.current?.submitted ?? false); setBusy(false); setStage(''); setPassword(''); setConfirmation(''); } }
  }
  async function saveConfirmedWithPasskey() {
    const session = provisionalSession.current;
    if (busy || !connected || !session || !canUsePasskeys) return;
    const run = generation.current;
    controller.current = new AbortController(); setBusy(true); setError(''); setStage('Check your device to create a passkey…');
    try {
      await session.saveToDeviceWithPasskey({ signal: controller.current.signal, onProgress: text => { if (run === generation.current) setStage(text); } });
      acceptSession(session, run);
    } catch (cause) { if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) { setBusy(false); setStage(''); } }
  }
  async function saveConfirmedWithPassword(event: FormEvent) {
    event.preventDefault();
    const session = provisionalSession.current;
    if (busy || !connected || !session || storageMethod !== 'password' || !passwordValid) return;
    const run = generation.current; controller.current = new AbortController(); setBusy(true); setError(''); setStage('Encrypting this device’s posting key…');
    try { await session.saveToDevice(password, { signal: controller.current.signal, onProgress: text => { if (run === generation.current) setStage(text); } }); acceptSession(session, run); }
    catch (cause) { if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) { setBusy(false); setStage(''); setPassword(''); setConfirmation(''); } }
  }
  async function unlockDevice(event: FormEvent) {
    event.preventDefault(); if (busy || (savedMethod !== 'passkey' && !password)) return;
    const run = ++generation.current;
    controller.current = new AbortController(); setBusy(true); setError(''); setStage('Unlocking your device key…');
    try {
      const options = { signal: controller.current.signal, onProgress: (text: string) => { if (run === generation.current) setStage(text); } };
      const session = savedMethod === 'passkey' ? await unlockSavedSessionWithPasskey(options) : await unlockSavedSession(password, options);
      acceptSession(session, run);
    }
    catch (cause) { if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) { setBusy(false); setPassword(''); } }
  }
  async function forget() {
    if (busy) return;
    const run = generation.current; setBusy(true); setError('');
    try { await deleteSavedSession(); if (run === generation.current) { setSavedMethod(undefined); setStorageUnreadable(false); setUnlock(false); setPassword(''); } }
    catch (cause) { if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) setBusy(false); }
  }

  return <OnboardingFrame presentation={presentation} title={deletionApproval ? 'Enable cast deletion' : socialApproval ? 'Enable social features' : unlock ? 'Welcome back.' : 'Connect your account'} onClose={close}>
    <p className="onboarding-domain-notice">We’ve moved to <strong>opencaster.org</strong>. Saved device keys and passkeys from quorum.arca.computer do not transfer here automatically. Reconnect your existing custody wallet; your seed phrase stays in your wallet.</p>
    <div className="pairing-hero"><span className="pairing-symbol"><IconShieldLock size={27} /></span><div><strong>Your recovery phrase stays out of this website.</strong><p>Approve a separate device key in your own wallet app.</p></div></div>
    {socialApproval && <p className="pairing-copy">Approve a new device key with permission to {deletionApproval ? 'delete your own casts, ' : ''}follow and unfollow accounts and edit your profile, alongside casts and reactions. {deletionApproval && 'Cast deletion cannot be undone. '}Previous keys retain their original network permissions; switching does not revoke them. The app switches only after Hypersnap confirms the new approval.</p>}
    {unlock ? <form onSubmit={unlockDevice}>
      <h2 ref={stepHeading} tabIndex={-1}>Unlock your saved device</h2>
      <p className="pairing-copy">{savedMethod === 'passkey' ? 'Your posting key is encrypted in this browser. Use your passkey and device verification to unlock it.' : 'Your posting key is encrypted on this device. Unlock it to reconnect; your custody wallet is not needed.'}</p>
      {savedMethod === 'passkey' ? <p className="fine-print">Your saved encrypted key must still be present in this browser. A synced passkey alone does not copy it to another device. If you cleared browser data, reconnect with your custody wallet.</p> : <><label className="field-label" htmlFor="device-password">Device vault password</label><Input id="device-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" disabled={busy} required /></>}
      {error && <p className="error" role="alert">{error}</p>}
      <Button type="submit" className="full-width pairing-submit" disabled={busy || (savedMethod !== 'passkey' && !password)}>{busy ? <><IconRefresh size={17} className="spin" />{stage}</> : <><IconLock size={17} />{savedMethod === 'passkey' ? 'Unlock with a passkey' : 'Unlock this device'}</>}</Button>
      <div className="pairing-actions"><Button variant="ghost" disabled={busy} onClick={() => { reset(); setUnlock(false); }}>Connect another account</Button><Button variant="ghost" disabled={busy} onClick={() => void forget()}><IconTrash size={15} />Forget saved key</Button></div>
      <p className="fine-print">Forgetting deletes this browser’s encrypted key. It does not revoke its network authorization. Unlock first to revoke this device.</p>
    </form> : <>
      <ol className="onboarding-steps" aria-label="Connection steps">{['Find account', 'Review identity', 'Approve wallet', 'Save device'].map((label, index) => <li key={label} className={currentStep === index + 1 ? 'active' : currentStep > index + 1 ? 'complete' : ''} aria-current={currentStep === index + 1 ? 'step' : undefined}><span>{currentStep > index + 1 ? <IconCheck size={14} /> : index + 1}</span><div>{label}{index === 3 && <small>Optional</small>}</div></li>)}</ol>
      {!request ? !identity ? <form onSubmit={findAccount} className="onboarding-find">
        <h2 ref={stepHeading} tabIndex={-1}>Find your public account</h2>
        <p className="pairing-copy">Enter your public username, ENS name, FID, or custody wallet address. We’ll show the full account details for you to review before creating a device key.</p>
        <label className="field-label" htmlFor="account-identifier">Username, ENS name, FID, or custody wallet address</label>
        <Input id="account-identifier" placeholder="@username, name.eth, 1234, or 0x…" value={identifier} onChange={event => { setIdentifier(event.target.value); setLookupEnsName(''); setEnsNotFound(false); setError(''); }} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={128} disabled={busy} readOnly={initialFid !== undefined} required />
        <p className="fine-print">Your FID is your account’s numeric ID. The custody wallet controls the account and may differ from a wallet linked to your profile. Do not enter your recovery words.</p>
        <p className="fine-print">ENS and Base names (.eth or .base.eth) must already be linked to an account and indexed on Hypersnap. This lookup does not register names or use an Ethereum wallet address record.</p>
        {error && <p className="error" role="alert">{error}</p>}
        {ensNotFound && <p className="fine-print onboarding-lookup-recovery">Try your account’s FID or exact custody wallet address. A name’s Ethereum address record alone does not link it to a Hypersnap account.</p>}
        {storageUnreadable && <div className="pairing-storage"><p className="fine-print">Forgetting removes this browser’s unreadable encrypted vault. It does not revoke any network authorization. Reconnect with your custody wallet to create or save another device key.</p><Button variant="secondary" disabled={busy} onClick={() => void forget()}><IconTrash size={15} />Forget unreadable saved key</Button></div>}
        <Button type="submit" className="full-width" disabled={busy || !identifier.trim()}>{busy ? <><IconRefresh size={17} className="spin" />{stage}</> : <>Find my account <IconArrowUpRight size={17} /></>}</Button>
        {saved && !socialApproval && <Button className="full-width pairing-back" variant="ghost" disabled={busy} onClick={() => { reset(); setUnlock(true); }}><IconLock size={16} />Unlock saved device instead</Button>}
      </form> : <section className="onboarding-review" aria-label="Review account identity"><h2 ref={stepHeading} tabIndex={-1}>Is this your account?</h2><IdentitySummary identity={identity} ensName={lookupEnsName} /><p className="pairing-copy">Check the username, FID, and full custody address. This is the account your wallet will authorize; a different verified wallet address does not grant access.</p>{error && <p className="error" role="alert">{error}</p>}<Button className="full-width" disabled={busy} onClick={() => void prepareReviewedAccount()}>{busy ? <><IconRefresh size={17} className="spin" />{stage}</> : <>Use this account <IconArrowUpRight size={17} /></>}</Button><Button variant="ghost" className="pairing-back" disabled={busy} onClick={reset}><IconArrowLeft size={16} />Use another account</Button></section> : <>
        <h2 ref={stepHeading} tabIndex={-1} className="onboarding-section-title">{!identityAccepted ? 'Review the updated account' : connected ? 'Choose how to keep this device connected' : 'Approve this device in your wallet'}</h2>
        {identity && <IdentitySummary identity={identity} />}
        {!identityAccepted ? <section className="onboarding-review" aria-label="Review updated account identity">{identityChanged && <p className="onboarding-change" role="alert">The account details changed while preparing this device. Review the updated username, FID, and custody wallet above before continuing.</p>}<AccountFacts request={request} /><Button className="full-width" disabled={busy || expired} onClick={() => { setIdentityAccepted(true); setIdentityChanged(false); setError(''); }}>Use updated account <IconArrowUpRight size={17} /></Button></section> : <>
        <AccountFacts request={request} />
        {!attempted && <WalletApproval request={request} disabled={busy || expired} expired={expired} onBusy={value => { setBusy(value); setStage(value ? 'Check your wallet for approval…' : ''); if (value) { setApproval(null); setApprovalName(''); } }} onError={setError} onApproved={(value, name) => { setApproval(validatePairingApproval(value)); setApprovalName(name); }} />}
        {approval && <div className="wallet-approved" role="status"><IconCheck size={18} /><span>Posting key approved{approvalName ? ` · ${approvalName}` : ''}. Submit below to register it on Hypersnap.</span></div>}
        {!attempted && !socialApproval && <details className="pairing-advanced"><summary>Advanced: approve offline with Arca Signer</summary>
          <section className="pairing-offline"><h3><IconDeviceDesktop size={18} />Optional offline approval</h3><p>If you prefer a separate offline signer, download this public request and open it in Arca Signer. Compare the FID, custody address, complete device fingerprint, and request checksum. Enter your 24 words only in the downloaded signer, then import its public approval file below.</p>
            <div className="pairing-downloads"><Button variant="secondary" onClick={downloadRequest} disabled={busy || expired}><IconArrowDown size={16} />Download request</Button><a href={signerUrl} className="pairing-download-link"><IconArrowDown size={16} />Arca Signer for macOS</a></div>
            <p className="pairing-release">Optional v0.2.2 · macOS Apple Silicon only · <a href={`${sourceUrl}/releases/tag/${releaseTag}`} target="_blank" rel="noopener noreferrer">Release & verification</a></p>
            <p className="pairing-release">Developer ID signed beta. Apple notarization pending. Independent security audit pending. <a href={`${sourceUrl}/tree/${releaseTag}/apps/signer`} target="_blank" rel="noopener noreferrer">Source & build instructions</a></p>
          </section>
          <Input ref={fileInput} type="file" accept="application/json,.json" aria-label="Import public approval JSON" className="pairing-file-input" tabIndex={-1} onChange={event => void importApproval(event)} disabled={busy || expired} />
          <Button className="full-width pairing-import" variant="secondary" onClick={() => fileInput.current?.click()} disabled={busy || expired}><IconFileCheck size={17} />Import offline public approval JSON</Button>
          <p className="pairing-release">Only the signer’s public approval JSON belongs here. It contains signatures, never recovery words or a private key.</p>
        </details>}
        <form onSubmit={connected ? saveConfirmedWithPassword : complete}>
          {!attempted && <label className="pairing-remember"><Input type="checkbox" checked={remember} onChange={event => { setRemember(event.target.checked); setPassword(''); setConfirmation(''); }} disabled={busy || storageUnreadable} /><span><strong>Remember this device</strong><small>After authorization, choose a passkey or password to encrypt only this device’s posting key. Saving replaces a previous vault in this browser if one exists; its network authorization remains active.{storageUnreadable && ' Forget the unreadable vault before saving another key.'}</small></span></label>}
          {connected && <section className="pairing-storage" aria-label="Save this device key"><div className="wallet-approved" role="status"><IconCheck size={18} /><span>Hypersnap confirmed this device’s authorization. Choose how to keep its encrypted key.</span></div><div className="pairing-storage__choices"><Button variant={storageMethod === 'passkey' ? 'secondary' : 'ghost'} aria-pressed={storageMethod === 'passkey'} disabled={busy} onClick={() => { setStorageMethod('passkey'); setPassword(''); setConfirmation(''); setError(''); }}><IconKey size={17} />Passkey{canUsePasskeys && <small>Recommended</small>}</Button><Button variant={storageMethod === 'password' ? 'secondary' : 'ghost'} aria-pressed={storageMethod === 'password'} disabled={busy} onClick={() => { setStorageMethod('password'); setError(''); }}>Use a password instead</Button></div>
            {storageMethod === 'passkey' ? <><p className="pairing-copy">Protect this browser’s encrypted posting key with your device unlock or security key. Your passkey must support secure key encryption; support varies by browser and authenticator.</p>{!canUsePasskeys && <p className="fine-print">Passkeys are unavailable in this browser. Choose password encryption or continue for this tab.</p>}<Button className="full-width pairing-submit" disabled={busy || !canUsePasskeys} onClick={() => void saveConfirmedWithPasskey()}><IconKey size={17} />{busy ? stage || 'Saving…' : 'Save with a passkey'}</Button></> : <div className="pairing-passwords"><label className="field-label" htmlFor="new-device-password">New device vault password · at least 12 characters</label><Input id="new-device-password" type="password" autoComplete="new-password" value={password} minLength={12} onChange={event => setPassword(event.target.value)} disabled={busy} required /><label className="field-label" htmlFor="confirm-device-password">Confirm password</label><Input id="confirm-device-password" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} required />{confirmation && password !== confirmation && <p className="error">Passwords do not match.</p>}<p className="fine-print">Keep this password somewhere safe. It cannot be recovered. Anyone who can unlock this vault can post as you until you revoke this key.</p><Button className="full-width pairing-submit" type="submit" disabled={busy || !passwordValid}>{busy ? stage || 'Saving…' : 'Save with a password'}</Button></div>}
            <p className="fine-print">The encrypted key stays in this browser on this website. Syncing a passkey does not copy this vault to another device. Clearing browser data requires reconnecting with your custody wallet.</p>
          </section>}
          {expired && !attempted && <p className="error" role="alert">This request expired. Start again for a fresh device key and approval.</p>}
          {error && <p className="error" role="alert">{error}</p>}
          {attempted && error && !connected && <p className="fine-print">A submission may already be registered. Check its status using the same approval. This check will not submit it again. Closing or starting again erases this tab’s device key.</p>}
          {!connected && <Button type="submit" formNoValidate={attempted} className="full-width pairing-submit" disabled={busy || !approval || (expired && !attempted)}>{busy ? <><IconRefresh size={17} className="spin" />{stage || 'Checking authorization…'}</> : attempted ? 'Check authorization status' : <>Submit approved device key <IconArrowUpRight size={17} /></>}</Button>}
          {connected && !busy && <Button variant="ghost" className="full-width pairing-back" onClick={() => { const value = provisionalSession.current; if (value) acceptSession(value, generation.current); }}>Continue for this tab without saving</Button>}
        </form>
        </>}
        {expired && !identityAccepted && <p className="error" role="alert">This request expired. Start again for a fresh device key and approval.</p>}
        <p className="pairing-release">{presentation === 'page' ? 'Leaving this page' : 'Closing this dialog'} erases this tab’s pending key. A network authorization already submitted may remain active.</p>
        <Button variant="ghost" className="pairing-back" disabled={busy} onClick={reset}><IconArrowLeft size={15} />{attempted ? 'Discard local key and start again' : 'Use another account'}</Button>
      </>}
    </>}
    <a className="source-note" href={`${sourceUrl}/blob/main/apps/web-client/SIGNER.md`} target="_blank" rel="noopener noreferrer"><IconCode size={15} /> How signing, storage, and revocation work <IconArrowUpRight size={13} /></a>
  </OnboardingFrame>;
}

export function DeviceSettings({ session, onClose, onLock, notify }: { session: WalletSession; onClose(): void; onLock(revoked?: boolean): void; notify(text: string): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedMethod, setSavedMethod] = useState<'password' | 'passkey' | undefined>();
  const [storageUnreadable, setStorageUnreadable] = useState(false);
  const saved = savedMethod !== undefined;
  const [canUsePasskeys] = useState(passkeysAvailable);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [stage, setStage] = useState('');
  const [request, setRequest] = useState<RevocationRequest | null>(null);
  const [approval, setApproval] = useState<RevocationApproval | null>(null);
  const [approvalName, setApprovalName] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<PendingRevocation | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileReadGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    const initialGeneration = generation.current;
    setSavedMethod(undefined); setStorageUnreadable(false);
    setBusy(false); setStage(''); setPassword(''); setConfirmation(''); setPasswordSaving(false);
    setRequest(null); setApproval(null); setApprovalName(''); setAttempted(false); setError('');
    getSavedSessionMethod(session.publicKey).then(value => { if (active && generation.current === initialGeneration) setSavedMethod(value); }).catch(() => { if (active && generation.current === initialGeneration) { setStorageUnreadable(true); setError('The saved vault could not be read. Your active device key stays connected. You can explicitly forget the unreadable vault before saving another encrypted copy.'); } });
    return () => { active = false; generation.current += 1; controller.current?.abort(); pending.current?.dispose(); pending.current = null; };
  }, [session.publicKey]);
  useEffect(() => {
    if (!request) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [request]);
  const expired = request !== null && Math.floor(now / 1000) >= request.deadline + 1609459200;

  function resetRevocation() {
    generation.current += 1; controller.current?.abort(); pending.current?.dispose(); pending.current = null;
    setRequest(null); setApproval(null); setApprovalName(''); setAttempted(false); setBusy(false); setStage(''); setError(''); setPassword(''); setConfirmation(''); setPasswordSaving(false);
  }
  function close() { resetRevocation(); onClose(); }
  async function forget() {
    if (busy || request) return;
    const run = generation.current; setBusy(true); setError('');
    try { await deleteSavedSession(session.publicKey); if (run === generation.current) { setSavedMethod(undefined); setStorageUnreadable(false); notify('Saved encrypted key deleted. This tab is still connected.'); } }
    catch (cause) { if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) setBusy(false); }
  }
  async function forgetUnreadableVault() {
    if (busy || request || !storageUnreadable) return;
    const run = ++generation.current; setBusy(true); setError('');
    try { await deleteSavedSession(); if (run === generation.current) { setSavedMethod(undefined); setStorageUnreadable(false); notify('Unreadable local vault deleted. This tab stays connected; network authorization remains active.'); } }
    catch (cause) { if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) setBusy(false); }
  }
  async function saveWithPasskey() {
    if (busy || request || !canUsePasskeys) return;
    const run = ++generation.current;
    controller.current = new AbortController(); setBusy(true); setError(''); setStage('Check your device to create a passkey…');
    try {
      await session.saveToDeviceWithPasskey({ signal: controller.current.signal, onProgress: text => { if (run === generation.current) setStage(text); } });
      if (run === generation.current) { setSavedMethod('passkey'); setPasswordSaving(false); setPassword(''); setConfirmation(''); notify('This browser’s posting key is encrypted with a passkey. No new network authorization was created.'); }
    } catch (cause) { if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) { setBusy(false); setStage(''); } }
  }
  async function saveWithPassword(event: FormEvent) {
    event.preventDefault();
    if (busy || request || password.length < 12 || password !== confirmation) return;
    const run = ++generation.current; controller.current = new AbortController(); setBusy(true); setError(''); setStage('Encrypting this device’s posting key…');
    try {
      await session.saveToDevice(password, { signal: controller.current.signal, onProgress: text => { if (run === generation.current) setStage(text); } });
      if (run === generation.current) { setSavedMethod('password'); setPasswordSaving(false); notify('This browser’s posting key is encrypted with your password.'); }
    } catch (cause) { if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) { setBusy(false); setStage(''); setPassword(''); setConfirmation(''); } }
  }
  async function prepareRevocation() {
    if (busy || request) return;
    const run = ++generation.current;
    controller.current = new AbortController(); setBusy(true); setError(''); setStage('Preparing public revocation request…');
    try {
      const value = await session.prepareRevocation({ signal: controller.current.signal, onProgress: text => { if (run === generation.current) setStage(text); } });
      if (run !== generation.current) { value.dispose(); return; }
      pending.current = value; setRequest(value.request); setAttempted(value.submitted); setNow(Date.now());
    } catch (cause) { if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) { setBusy(false); setStage(''); } }
  }
  function downloadRevocation() {
    if (!request || busy || expired) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(request, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'arca-revocation-request.json';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importRevocation(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !request || busy || attempted || expired) return;
    const run = generation.current; const fileRun = ++fileReadGeneration.current;
    setApproval(null); setApprovalName(''); setError('');
    try {
      if (file.size > approvalLimitBytes) throw new Error('Revocation approval files must be smaller than 16 KiB. Choose the public JSON exported by Arca Signer.');
      const text = await file.text();
      if (run !== generation.current || fileRun !== fileReadGeneration.current) return;
      const value = validateRevocationApproval(JSON.parse(text) as unknown);
      verifyRevocationApproval(request, value);
      setApproval(value); setApprovalName(file.name.slice(0, 100));
    } catch (cause) { if (run === generation.current && fileRun === fileReadGeneration.current) setError(cause instanceof SyntaxError ? 'Invalid revocation approval. Import the public revocation approval JSON from Arca Signer. Never import your recovery phrase here.' : errorMessage(cause)); }
  }
  async function completeRevocation(event: FormEvent) {
    event.preventDefault();
    if (busy || !pending.current || (!approval && !attempted) || (expired && !attempted)) return;
    const run = generation.current;
    controller.current = new AbortController(); setBusy(true); setError(''); setAttempted(true);
    try {
      await pending.current.complete(approval ?? undefined, { signal: controller.current.signal, onProgress: text => { if (run === generation.current) setStage(text); } });
      // Parent compares this session's key with the active session, so a late
      // confirmed revocation cannot lock an unrelated replacement session.
      onLock(true);
      notify('This device’s network authorization was revoked and its saved key was deleted.');
    } catch (cause) { if (run === generation.current) setError(errorMessage(cause)); }
    finally { if (run === generation.current) { setAttempted(pending.current?.submitted ?? false); setBusy(false); setStage(''); } }
  }
  return <Modal title="This device’s access" onClose={close}>
    <div className="pairing-hero"><span className="pairing-symbol"><IconKey size={27} /></span><div><strong>@{session.user.username || session.fid}</strong><p>FID {session.fid} · {session.scopes.includes(2) ? 'casts, deletion, reactions, follows, and profile edits' : session.scopes.includes(11) ? 'casts, reactions, follows, and profile edits' : 'casting and reactions'}</p></div></div>
    <dl className="pairing-facts"><div><dt>Device key fingerprint</dt><dd className="pairing-mono">{fingerprint(session.publicKey)}</dd></div><div><dt>Storage</dt><dd>{storageUnreadable ? 'Saved vault could not be read; active key stays in this tab' : savedMethod === 'passkey' ? 'Encrypted key saved with a passkey in this browser' : savedMethod === 'password' ? 'Encrypted key saved with a password in this browser' : 'Key held only in this tab'}</dd></div><div><dt>Inactivity expiry</dt><dd>7 days, renewed by signing activity</dd></div></dl>
    {!request && <>
      {storageUnreadable && <section className="pairing-storage"><p className="fine-print">The unreadable vault’s account cannot be verified. Forgetting deletes that local encrypted record only; this tab stays connected and no network permissions are revoked.</p><Button variant="secondary" disabled={busy} onClick={() => void forgetUnreadableVault()}><IconTrash size={15} />Forget unreadable vault</Button></section>}
      {!storageUnreadable && savedMethod !== 'passkey' && <section className="pairing-storage" aria-label="Remember this device"><div className="device-action"><div><strong>Save with a passkey{canUsePasskeys && <span className="pairing-storage__recommended">Recommended when supported</span>}</strong><p>{savedMethod === 'password' ? 'Replace this browser’s password vault after passkey encryption succeeds. Your active posting key and network permissions stay the same.' : 'Encrypt this active posting key using your device unlock or security key. This creates no new Hypersnap authorization.'} Saving replaces any previously saved vault in this browser; it does not revoke that key.</p></div><Button variant="secondary" disabled={busy || !canUsePasskeys} onClick={() => void saveWithPasskey()}><IconKey size={16} />Save with a passkey</Button></div>{!canUsePasskeys && <p className="fine-print">Passkeys are unavailable in this browser. You can use password encryption or keep this key only in the active tab.</p>}<p className="fine-print">The passkey must support secure key encryption. If setup is cancelled or unsupported, your existing saved key stays unchanged.</p><Button variant="ghost" disabled={busy} onClick={() => { setPasswordSaving(value => !value); setPassword(''); setConfirmation(''); }}>{passwordSaving ? 'Cancel password saving' : 'Use password encryption instead'}</Button></section>}
      {passwordSaving && <form className="pairing-passwords" onSubmit={saveWithPassword}><label className="field-label" htmlFor="settings-device-password">New device vault password · at least 12 characters</label><Input id="settings-device-password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} minLength={12} required /><label className="field-label" htmlFor="settings-confirm-password">Confirm password</label><Input id="settings-confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} required />{confirmation && password !== confirmation && <p className="error">Passwords do not match.</p>}<p className="fine-print">Saving replaces this browser’s previous encrypted vault. The password cannot be recovered.</p><Button type="submit" variant="secondary" disabled={busy || password.length < 12 || password !== confirmation}>Save with a password</Button></form>}
      {saved && <p className="fine-print">The encrypted key stays in this browser on this website. A synced passkey does not copy the vault to another device. Clearing browser data requires reconnecting with your custody wallet.</p>}
      <div className="device-action"><div><strong>Lock this tab</strong><p>Clear its active signing key. A saved vault can be unlocked again. Network authorization remains active.</p></div><Button variant="secondary" onClick={() => onLock()} disabled={busy}><IconLock size={16} />Lock</Button></div>
      {saved && <div className="device-action"><div><strong>Forget saved key</strong><p>Delete this browser’s encrypted copy. This tab stays connected; network authorization remains active.</p></div><Button variant="secondary" onClick={() => void forget()} disabled={busy}><IconTrash size={16} />Forget</Button></div>}
      <div className="device-action device-action--revoke"><div><strong>Revoke this device</strong><p>Approve its removal in your custody wallet. We confirm removal on Hypersnap before clearing this key. Other device keys and legacy beta keys are unaffected.</p></div><Button variant="secondary" disabled={busy} onClick={() => void prepareRevocation()}>{busy ? <IconRefresh size={16} className="spin" /> : <IconShieldLock size={16} />}Revoke</Button></div>
    </>}
    {request && <section className="revocation-panel">
      <h3><IconShieldLock size={18} />{attempted ? 'Confirm this device’s removal' : 'Approve this device’s removal'}</h3>
      {!attempted && <p className="pairing-copy">Check the <strong>Revoke device</strong> action, FID, custody wallet, and complete key fingerprint before approving removal in your wallet app.</p>}
      <dl className="pairing-facts"><div><dt>Action</dt><dd>Revoke all permissions granted to this device key</dd></div><div><dt>FID</dt><dd>{request.fid}</dd></div><div><dt>Custody wallet</dt><dd className="pairing-mono">{request.custodyAddress}</dd></div><div><dt>Key to revoke</dt><dd className="pairing-mono">{fingerprint(request.publicKey)}</dd></div><div><dt>Request checksum</dt><dd className="pairing-mono">{hashRevocationRequest(request)}</dd></div><div><dt>Approve before</dt><dd>{new Date((request.deadline + 1609459200) * 1000).toLocaleString()}</dd></div><div><dt>Website label</dt><dd className="pairing-mono">{request.origin}<small>Self-reported; this label does not authenticate the website.</small></dd></div></dl>
      {!attempted && <WalletApproval request={request} disabled={busy || expired} expired={expired} onBusy={value => { setBusy(value); setStage(value ? 'Check your wallet for approval…' : ''); if (value) { setApproval(null); setApprovalName(''); } }} onError={setError} onApproved={(value, name) => { setApproval(validateRevocationApproval(value)); setApprovalName(name); }} />}
      {approval && !attempted && <div className="wallet-approved" role="status"><IconCheck size={18} /><span>Removal approved{approvalName ? ` · ${approvalName}` : ''}. Submit below to revoke this device on Hypersnap.</span></div>}
      {!attempted && <details className="pairing-advanced"><summary>Advanced: approve revocation offline</summary>
        <p className="pairing-copy">Download the public revocation request and open it in Arca Signer. Compare its action, FID, custody address, device key, and checksum. Import the signer’s public approval below. Enter recovery words only in the downloaded signer.</p>
        <div className="pairing-downloads"><Button variant="secondary" disabled={busy || expired} onClick={downloadRevocation}><IconArrowDown size={16} />Download revocation request</Button><a href={signerUrl} className="pairing-download-link"><IconArrowDown size={16} />Arca Signer for macOS</a></div>
        <p className="pairing-release">Optional v0.2.2 · macOS Apple Silicon only · Developer ID signed beta. Apple notarization and independent security audit pending. <a href={`${sourceUrl}/releases/tag/${releaseTag}`} target="_blank" rel="noopener noreferrer">Release & verification</a></p>
        <Input ref={fileInput} type="file" accept="application/json,.json" aria-label="Import public revocation approval JSON" className="pairing-file-input" tabIndex={-1} onChange={event => void importRevocation(event)} disabled={busy || expired} />
        <Button variant="secondary" className="full-width pairing-import" disabled={busy || expired} onClick={() => fileInput.current?.click()}><IconFileCheck size={17} />Import offline revocation approval JSON</Button>
        <p className="pairing-release">Only the signer’s public approval JSON belongs here. It contains a signature, never recovery words or a private key.</p>
      </details>}
      <form onSubmit={completeRevocation}>
        {expired && !attempted && <p className="error" role="alert">This revocation request expired. Cancel it and prepare a new request; your device remains connected.</p>}
        {attempted && <p className="fine-print">The removal was already submitted, or the node reports that the key is absent. This check reads network status; no second submission is sent. Your key and saved vault stay available until removal is confirmed.</p>}
        <Button className="full-width pairing-submit" type="submit" disabled={busy || (!approval && !attempted) || (expired && !attempted)}>{busy ? <><IconRefresh size={16} className="spin" />{stage || 'Checking revocation…'}</> : attempted ? 'Check revocation status' : 'Submit revocation and confirm removal'}</Button>
      </form>
      <Button className="full-width pairing-back" variant="ghost" disabled={busy} onClick={resetRevocation}>{attempted ? 'Close request; keep local key' : 'Cancel revocation; keep this device'}</Button>
      <p className="pairing-release">Closing a request does not undo a network submission. If its outcome is uncertain, keep the local key and check status before creating another request.</p>
    </section>}
    {error && <p className="error" role="alert">{error}</p>}
    {busy && !request && <p className="pairing-copy" role="status">{stage}</p>}
    <a className="source-note" href={`${sourceUrl}/blob/main/apps/web-client/SIGNER.md`} target="_blank" rel="noopener noreferrer"><IconCode size={15} /> How device revocation works <IconArrowUpRight size={13} /></a>
  </Modal>;
}
