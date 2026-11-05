import { useEffect, useRef, useState } from 'react';
import { deleteSavedSession, getSavedSessionMethod, type WalletSession } from '../lib/auth';
import { notifySessionChange, readSessionPersistence, writeSessionPersistence, type SessionPersistence } from '../lib/sessionPersistence';
import { errorMessage } from '../lib/errors';
import { Button } from './ui';

export default function SessionSettings({ session }: { session: WalletSession | null }) {
  const [mode, setMode] = useState(readSessionPersistence);
  const [remembered, setRemembered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const run = ++generation.current;
    setRemembered(false); setBusy(false); setNotice(''); setError(''); setMode(readSessionPersistence());
    if (session) void getSavedSessionMethod(session.publicKey).then(method => {
      if (run === generation.current) setRemembered(method === 'browser');
    }).catch(() => { if (run === generation.current) setError('Saved device storage could not be read.'); });
    return () => { generation.current += 1; controller.current?.abort(); };
  }, [session?.publicKey]);

  async function choose(next: SessionPersistence) {
    if (busy) return;
    const run = ++generation.current;
    controller.current = new AbortController();
    setBusy(true); setError(''); setNotice('');
    try {
      writeSessionPersistence(next);
      setMode(next);
      if (next === 'tab') {
        notifySessionChange('sign-out');
        try { await deleteSavedSession(session?.publicKey, { notify: false }); }
        catch {
          if (run === generation.current) setError('Tab-only is selected, so automatic sign-in is disabled, but the saved key could not be removed. Clear this site’s data before leaving this shared browser profile.');
          return;
        }
        if (run !== generation.current) return;
        setRemembered(false);
      } else if (session) {
        setRemembered(false);
        await session.rememberOnDevice({ signal: controller.current.signal });
      }
      if (run !== generation.current) return;
      setRemembered(next === 'remember' && !!session);
      setNotice(next === 'remember'
        ? session ? 'This account will stay signed in after you close and reopen your browser.' : 'Your next sign-in will be remembered on this browser.'
        : 'Sessions are now tab-only. Closing or reloading the tab ends its session. Other tabs have been signed out.');
    } catch (cause) {
      if (run === generation.current) setError(errorMessage(cause, 'Could not change session settings.'));
    } finally { if (run === generation.current) setBusy(false); }
  }

  return <section className="settings-shortcuts" aria-label="Sign-in settings">
    <h2>Sign-in</h2>
    <p>Choose how long this browser keeps you signed in.</p>
    <div className="pairing-storage__choices">
      <Button variant={mode === 'remember' ? 'secondary' : 'ghost'} aria-pressed={mode === 'remember'} disabled={busy} onClick={() => void choose('remember')}>Stay signed in</Button>
      <Button variant={mode === 'tab' ? 'secondary' : 'ghost'} aria-pressed={mode === 'tab'} disabled={busy} onClick={() => void choose('tab')}>Tab only</Button>
    </div>
    <p>{mode === 'remember' ? 'Continue across tabs and browser restarts without another wallet approval or unlock prompt.' : 'Keep the active key in this tab only. Closing or reloading it ends the session.'}</p>
    <p className="fine-print">Remembered sessions use encrypted browser storage, without a separate password or passkey prompt. Anyone using this browser profile can use your account. Choose tab-only on a shared device. Clearing site data or an expired or revoked device authorization requires signing in again.</p>
    {session && mode === 'remember' && !remembered && <p className="fine-print">This active session is not yet saved for automatic sign-in. Choose “Stay signed in” to save it, replacing any previous saved key or password/passkey protection in this browser.</p>}
    {busy && <p role="status">Updating sign-in settings…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
