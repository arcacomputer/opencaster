import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Input } from '@opencaster/web-ui/ui';
import type { PairingDisplay } from './bridge';

function Icon({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

function Shield() { return <Icon><path d="m12 3 8 3v5c0 5-8 10-8 10S4 16 4 11V6l8-3Z" /><path d="m8 12 2.5 2.5L16 9" /></Icon>; }
function Folder() { return <Icon><path d="M3 6h6l2 2h10v12H3V6Z" /><path d="M3 6V4h6l2 2h8v2" /></Icon>; }
function Arrow() { return <Icon><path d="M5 12h14m-5-5 5 5-5 5" /></Icon>; }

export function Signer() {
  const [display, setDisplay] = useState<PairingDisplay | null>(null);
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [exported, setExported] = useState(false);
  const [revocation, setRevocation] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [words, setWords] = useState(0);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const phraseInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  function clearPhrase() {
    if (phraseInput.current) phraseInput.current.value = '';
    setWords(0);
  }

  useEffect(() => {
    mounted.current = true;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const clear = () => {
      if (phraseInput.current) phraseInput.current.value = '';
      void window.arcaSigner?.clear();
    };
    window.addEventListener('pagehide', clear);
    const stopDrop = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', stopDrop);
    window.addEventListener('drop', stopDrop);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('dragover', stopDrop);
      window.removeEventListener('drop', stopDrop);
      clear();
    };
  }, []);

  // Request deadline is the Farcaster epoch; createdAt is regular Unix time.
  const remaining = display ? Math.max(0, display.request.deadline + 1609459200 - Math.floor(now / 1000)) : 0;
  const expired = display !== null && remaining <= 0;

  async function loadRequest() {
    clearPhrase();
    setDisplay(null); setApproved(false); setExported(false); setRevocation(false); setAcknowledged(false); setError(''); setBusy(true);
    try {
      const result = await window.arcaSigner.importRequest();
      if (result.ok) { setDisplay(result.value); setRevocation(result.value?.request.kind === 'arca.hypersnap.signer.revoke.request'); }
      else setError(result.error);
    } catch { setError('The native signer could not open the request. Restart the app and try again.'); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!display || busy || !acknowledged || expired) return;
    setError(''); setBusy(true);
    let phrase = phraseInput.current?.value ?? '';
    clearPhrase();
    try {
      const pending = window.arcaSigner.approve({ phrase, requestId: display.request.requestId });
      phrase = '';
      const result = await pending;
      if (result.ok) setApproved(true);
      else setError(result.error);
    } catch { setError('Approval did not finish. The phrase field has been cleared.'); }
    // eslint-disable-next-line no-useless-assignment -- Best-effort local reference release; JavaScript strings cannot be reliably erased.
    finally { phrase = ''; clearPhrase(); if (mounted.current) setBusy(false); }
  }

  async function exportApproval() {
    setBusy(true); setError('');
    try {
      const result = await window.arcaSigner.exportApproval();
      if (result.ok && result.value) { setExported(true); setDisplay(null); }
      else if (!result.ok) setError(result.error);
    } catch { setError('The approval could not be saved. Try again.'); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function reset() {
    clearPhrase();
    await window.arcaSigner.clear();
    setDisplay(null); setApproved(false); setExported(false); setRevocation(false); setAcknowledged(false); setError('');
  }

  return <div className="signer-shell">
    <header className="topbar">
      <div className="brand"><img src="./quorum-symbol.svg" width="29" height="29" alt="" /><span>ARCA <strong>Signer</strong></span></div>
      <span className="offline-badge"><span className="status-dot" />Offline by design</span>
    </header>
    <main>
      <div className="intro">
        <div className="eyebrow">QUORUM · HYPERSNAP</div>
        <h1>{revocation ? <>Revoke access.<br /><span>Keep control.</span></> : <>Your account.<br /><span>Your keys.</span></>}</h1>
        <p>{revocation ? 'Remove a browser’s posting authorization without giving a website your recovery phrase.' : 'Approve or revoke browser posting keys without giving a website your recovery phrase.'}</p>
      </div>

      <div className="security-strip"><Shield /><p><strong>All signing happens on this device.</strong> This app loads only bundled code and blocks network requests. No recovery phrase is saved.</p></div>

      <ol className="steps" aria-label={revocation ? 'Revocation progress' : 'Pairing progress'}>
        <li className={!display && !exported ? 'active' : 'complete'}><span>1</span>Import request</li>
        <li className={display && !approved ? 'active' : approved ? 'complete' : ''}><span>2</span>{revocation ? 'Review & revoke' : 'Review & approve'}</li>
        <li className={approved ? 'active' : ''}><span>3</span>Return approval</li>
      </ol>

      {error && <div className="notice notice--error" role="alert">{error}</div>}

      {exported ? <section className="panel success-panel">
        <div className="success-icon"><Shield /></div>
        <h2>{revocation ? 'Your revocation approval is ready' : 'Your approval is ready'}</h2>
        <p>Return to the same browser tab and import the approval JSON. It contains public {revocation ? 'revocation' : 'authorization'} signatures, never your recovery phrase or private keys.</p>
        {revocation && <div className="notice notice--warning"><strong>Network revocation is still pending.</strong> The browser must submit this approval and confirm the key’s removal before its access ends.</div>}
        <p className="muted">Close Arca Signer now to release the app’s memory. JavaScript cannot guarantee erasure of every temporary copy.</p>
        <div className="actions"><Button onClick={() => void window.arcaSigner.quit()}>Close Arca Signer</Button><Button variant="secondary" onClick={() => void reset()}>Open another request</Button></div>
      </section> : !display ? <section className="panel import-panel">
        <div className="folder-icon"><Folder /></div>
        <h2>Start with your browser</h2>
        <p>On <strong>opencaster.org</strong>, select “Connect with Arca Signer” to authorize a browser, or “Revoke this device” to remove access. Download the request and open its JSON file here.</p>
        <Button onClick={() => void loadRequest()} disabled={busy}><Folder />{busy ? 'Opening…' : 'Import request JSON'}<Arrow /></Button>
        <p className="small muted">Only public account and posting-key details are imported.</p>
      </section> : <>
        <section className={`panel review-panel ${revocation ? 'review-panel--revoke' : ''}`} aria-labelledby="review-title">
          {revocation && <div className="revoke-label">REVOKE POSTING KEY</div>}
          <div className="panel-heading"><h2 id="review-title">{revocation ? 'Remove this browser’s network access' : 'Review this browser’s request'}</h2><span className={expired ? 'expiry expiry--expired' : 'expiry'}>{expired ? 'Request expired' : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} to ${revocation ? 'sign' : 'approve'}`}</span></div>
          <dl className="details"><div><dt>Account</dt><dd>FID {display.request.fid.toLocaleString('en-US')}</dd></div><div><dt>Custody address</dt><dd className="mono">{display.request.custodyAddress}</dd></div><div><dt>Claimed website</dt><dd>{display.request.origin}</dd></div>{revocation ? <div><dt>Operation</dt><dd><strong>Revoke the posting key shown below</strong></dd></div> : <><div><dt>Permissions</dt><dd>Casts, replies, likes & recasts</dd></div><div><dt>Network lifetime</dt><dd>7 days of inactivity <span className="muted">· resets with use</span></dd></div></>}</dl>
          <div className="fingerprint"><span className="label">Posting public key {revocation ? 'to revoke ' : ''}· compare all characters with your browser</span><code>{display.request.publicKey.match(/.{1,8}/g)?.join(' ')}</code></div>
          <details className="technical"><summary>Request fingerprint and technical details</summary><dl className="details"><div><dt>SHA-256</dt><dd className="mono">{display.requestHash}</dd></div><div><dt>Request ID</dt><dd className="mono">{display.request.requestId}</dd></div><div><dt>Key nonce</dt><dd>{display.request.nonce}</dd></div><div><dt>Derivation</dt><dd className="mono">m/44'/60'/0'/0/0</dd></div></dl></details>
          <div className="notice notice--warning"><strong>Confirm this in your browser.</strong> The website name and account details come from the file. This offline app cannot verify which website created it or confirm the live FID registry. Compare the posting key and custody address with the intended browser before {revocation ? 'revoking. The browser must submit the signed removal and confirm network revocation.' : 'approving. An active posting key can keep extending its 7-day inactivity lifetime.'}</div>
        </section>

        {approved ? <section className="panel approval-panel"><div className="panel-heading"><h2>{revocation ? 'Revocation signed locally' : 'Approval signed locally'}</h2><Shield /></div><p>Your recovery phrase field has been cleared. Save the public {revocation ? 'revocation ' : ''}approval file, then import it into the browser tab that created this request.</p><div className="actions"><Button onClick={() => void exportApproval()} disabled={busy || expired}>{busy ? 'Saving…' : `Save ${revocation ? 'revocation ' : ''}approval JSON`}<Arrow /></Button><Button variant="secondary" onClick={() => void reset()} disabled={busy}>Discard</Button></div></section> : <form className="panel approve-panel" onSubmit={event => void approve(event)} autoComplete="off">
          <h2>{revocation ? 'Confirm revocation with your recovery phrase' : 'Authorize with your recovery phrase'}</h2>
          <p>The derived wallet must match the custody address above. This signs {revocation ? 'removal of the shown posting key' : 'a posting-key approval'}; it cannot send a wallet transaction.</p>
          <label className="acknowledgement"><Input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={busy || expired} /><span>{revocation ? 'I checked the account and full posting key, and I want to revoke this key’s access.' : 'I checked the account, posting key, permissions and inactivity lifetime.'}</span></label>
          <div className="phrase-label"><label htmlFor="phrase">24-word English recovery phrase</label><span className="muted">{words} / 24 words</span></div>
          <Input ref={phraseInput} id="phrase" name="local-recovery" type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={512} placeholder="Enter your 24 words in order" disabled={busy || expired} required onChange={event => setWords(event.target.value.trim() ? event.target.value.trim().split(/\s+/u).length : 0)} aria-describedby="phrase-note" />
          <p id="phrase-note" className="small muted">Used once, in memory. Cleared immediately when you approve. Never stored, sent, or included in the approval file.</p>
          <div className="actions"><Button type="submit" className={revocation ? 'button--danger' : ''} disabled={busy || expired || !acknowledged || words !== 24}><Shield />{busy ? 'Signing on this device…' : revocation ? 'Sign key revocation' : 'Approve posting key'}</Button><Button variant="secondary" onClick={() => void reset()} disabled={busy}>Cancel & clear</Button></div>
        </form>}
      </>}

      <footer><span>Open source. No telemetry. No auto-updates.</span><span>A compromised device can still expose secrets.</span></footer>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Signer />);
