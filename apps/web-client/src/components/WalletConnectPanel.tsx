import { useEffect, useRef, useState } from 'react';
import { IconArrowUpRight, IconRefresh, IconShieldLock, IconWallet, IconX } from '@tabler/icons-react';
import QRCode from 'qrcode';
import { Button } from './ui';
import WalletConnectLogo from './WalletConnectLogo';
import { approvePairingWithWallet, approveRevocationWithWallet } from '../lib/wallet';
import { withWalletConnect, WALLETCONNECT_SETUP_TIMEOUT_MS, WALLETCONNECT_PAIRING_TIMEOUT_MS, WALLETCONNECT_SIGN_TIMEOUT_MS } from '../lib/walletConnect';
import type { PairingApproval, PairingRequest, RevocationApproval, RevocationRequest } from '@opencaster/client-core/pairing';

type Phase = 'starting' | 'pairing' | 'signing' | 'error';
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '';
// Fixed, reviewed wallet routes. Never follow redirects supplied by a session.
const walletLinks = {
  MetaMask: { pair: 'https://link.metamask.io/wc?uri=', reopen: 'metamask://home' },
  'Trust Wallet': { pair: 'https://link.trustwallet.com/wc?uri=', reopen: 'trust://' },
  // Rainbow's universal pairing link and pending WalletConnect request route.
  // https://github.com/rainbow-me/rainbowkit/blob/main/packages/rainbowkit/src/wallets/walletConnectors/rainbowWallet/rainbowWallet.ts
  Rainbow: { pair: 'https://rnbwapp.com/wc?uri=', reopen: 'rainbow://wc' },
} as const;
type WalletName = keyof typeof walletLinks;
const walletNames = Object.keys(walletLinks) as WalletName[];

export default function WalletConnectPanel({ request, onApproved, onBusy, onError, onClose }: {
  request: PairingRequest | RevocationRequest;
  onApproved(approval: PairingApproval | RevocationApproval, walletName: string): void;
  onBusy(value: boolean): void;
  onError(value: string): void;
  onClose(): void;
}) {
  const [uri, setUri] = useState('');
  const [qr, setQr] = useState('');
  const [qrError, setQrError] = useState(false);
  const [phase, setPhase] = useState<Phase>('starting');
  const [progress, setProgress] = useState('Starting wallet connection…');
  const [error, setError] = useState('');
  const [selectedWallet, setSelectedWallet] = useState<WalletName | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [signRequest, setSignRequest] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const callbacks = useRef({ onApproved, onBusy, onError, onClose });
  callbacks.current = { onApproved, onBusy, onError, onClose };

  useEffect(() => {
    const run = ++generation.current;
    const abort = new AbortController(); controller.current = abort;
    setUri(''); setQr(''); setQrError(false); setSelectedWallet(null); setSignRequest(0); setError(''); setPhase('starting');
    setProgress('Starting wallet connection…'); callbacks.current.onError('');
    if (!projectId) {
      setError('Wallet app connections are not configured on this site yet. You can still use a compatible browser wallet below.');
      setPhase('error'); callbacks.current.onBusy(false);
      return () => { generation.current += 1; abort.abort(); };
    }
    callbacks.current.onBusy(true); callbacks.current.onError('');
    const updateProgress = (text: string) => { if (run === generation.current) setProgress(text); };
    void withWalletConnect({
      projectId, request, custodyAddress: request.custodyAddress, signal: abort.signal,
      onUri(value: string | null) { if (run === generation.current) { setUri(value ?? ''); if (value) setPhase('pairing'); } },
      onSignRequest() { if (run === generation.current) { setPhase('signing'); setSignRequest(value => value + 1); } },
      onProgress: updateProgress,
    }, async provider => {
      if (run !== generation.current || abort.signal.aborted) throw new DOMException('Wallet connection cancelled.', 'AbortError');
      setPhase('signing'); setUri(''); setQr('');
      return request.kind === 'arca.hypersnap.signer.request'
        ? approvePairingWithWallet(request, provider, { signal: abort.signal, onProgress: updateProgress })
        : approveRevocationWithWallet(request, provider, { signal: abort.signal, onProgress: updateProgress });
    }).then(approval => {
      if (run !== generation.current || abort.signal.aborted) return;
      callbacks.current.onApproved(approval, 'WalletConnect');
      callbacks.current.onBusy(false); callbacks.current.onClose();
    }).catch(() => {
      if (run !== generation.current || abort.signal.aborted) return;
      // Wallet SDK errors may contain a pairing URI. Keep them out of the UI,
      // console, telemetry, and error boundaries.
      setUri(''); setQr(''); setError('The wallet connection or signature request did not finish. Check that you selected the custody account, chose Ethereum Mainnet, and approved each request. You can retry with a fresh connection.');
      setPhase('error'); callbacks.current.onBusy(false);
    });
    return () => { generation.current += 1; abort.abort(); };
  }, [request, attempt]);

  useEffect(() => {
    let active = true; setQr(''); setQrError(false);
    if (uri) QRCode.toDataURL(uri, { width: 280, margin: 3, errorCorrectionLevel: 'M' })
      .then(value => { if (active) setQr(value); })
      .catch(() => { if (active) setQrError(true); });
    return () => { active = false; };
  }, [uri]);

  function close() {
    generation.current += 1; controller.current?.abort(); setUri(''); setQr('');
    callbacks.current.onBusy(false); callbacks.current.onClose();
  }
  function walletHref(wallet: WalletName): string {
    return phase === 'pairing' && uri ? `${walletLinks[wallet].pair}${encodeURIComponent(uri)}` : walletLinks[wallet].reopen;
  }
  const signing = phase === 'signing';
  return <div className="walletconnect-panel" aria-label="WalletConnect connection">
    <div className="walletconnect-heading"><h4><WalletConnectLogo size={24} />WalletConnect</h4><Button variant="ghost" aria-label="Cancel WalletConnect" onClick={close}><IconX size={18} /></Button></div>
    {phase !== 'error' && <p className="walletconnect-progress" role="status"><IconRefresh size={15} className="spin" />{progress}</p>}
    {phase === 'pairing' && <>
      <p>On desktop, scan this QR code with your wallet’s WalletConnect scanner. On this phone, tap your installed wallet below. Keep this browser tab open.</p>
      <div className="walletconnect-qr">{qr ? <img src={qr} alt="WalletConnect pairing QR code. Scan with your wallet app." width={280} height={280} /> : <span role="status">{qrError ? 'QR code could not be displayed. Use an app button below or retry.' : 'Generating QR code on this device…'}</span>}</div>
    </>}
    {(phase === 'pairing' || signing) && <div className="walletconnect-apps">
      {((selectedWallet && signing) ? [selectedWallet] : walletNames).map(wallet => <a key={wallet} className="button button--secondary" href={walletHref(wallet)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={() => setSelectedWallet(wallet)}><IconWallet size={16} />{signing ? `Open ${wallet} to approve` : `Open ${wallet}`}<IconArrowUpRight size={15} /></a>)}
    </div>}
    {signing && <p className="walletconnect-return">Signature {signRequest || 1}{request.kind === 'arca.hypersnap.signer.request' ? ' of 2' : ' of 1'}. Approve the current request in your wallet, then return here. For each new signature prompt, tap <strong>Open wallet to approve</strong> again if your phone does not switch automatically.</p>}
    {phase !== 'error' && <p className="pairing-release">Setup times out after {WALLETCONNECT_SETUP_TIMEOUT_MS / 1000} seconds, pairing after {WALLETCONNECT_PAIRING_TIMEOUT_MS / 60000} minutes, and each signature request after {WALLETCONNECT_SIGN_TIMEOUT_MS / 60000} minutes. Canceling disconnects this wallet session. Reject any request still visible in your wallet; this website cannot close the wallet app.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {phase === 'error' && projectId && <Button variant="secondary" className="full-width" onClick={() => setAttempt(value => value + 1)}><IconRefresh size={16} />Retry wallet connection</Button>}
    <p className="walletconnect-privacy"><IconShieldLock size={16} />WalletConnect uses an external encrypted relay for connection and signing messages, with connection metadata. Your recovery phrase stays in your wallet. The wallet session disconnects when approval finishes; the separate posting key is submitted only when you choose Submit below.</p>
    <p className="pairing-release">Portions © 2025 Reown, Inc. All Rights Reserved · <a href="/licenses/walletconnect-2.26.0-LICENSE.txt" target="_blank" rel="noopener noreferrer">Community license</a> · <a href="https://github.com/arcacomputer/opencaster/blob/main/apps/web-client/SIGNER.md" target="_blank" rel="noopener noreferrer">Connection privacy</a></p>
    <Button variant="ghost" className="full-width" onClick={close}>{phase === 'error' ? 'Use another connection method' : 'Cancel wallet connection'}</Button>
  </div>;
}
