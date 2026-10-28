import { useEffect, useRef, useState } from 'react';
import { IconRefresh, IconTrash } from '@tabler/icons-react';
import { ApiError, type Cast } from '@opencaster/client-core/api';
import type { WalletSession } from '../lib/auth';
import { Button, Modal } from './ui';

type Phase = 'idle' | 'pending' | 'unknown' | 'failed' | 'invalidated';

export default function DeleteCastDialog({ cast, session, onEnable, onDeleted, onClose }: {
  cast: Cast;
  session: WalletSession | null;
  onEnable(): void;
  onDeleted(cast: Cast): void;
  onClose(): void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const targetKey = `${cast.author.fid}:${cast.hash.toLowerCase()}`;
  const contextKey = `${targetKey}:${session?.fid ?? ''}:${session?.publicKey ?? ''}`;
  const activeContext = useRef(contextKey);
  activeContext.current = contextKey;
  const generation = useRef(0);
  const busy = useRef(false);
  const attempted = useRef<{ context: string; target: string } | null>(null);
  const ownCast = session?.fid === cast.author.fid;
  const authorized = ownCast && !!session?.scopes.includes(2);

  useEffect(() => {
    busy.current = false;
    if (attempted.current && attempted.current.target === targetKey && attempted.current.context !== contextKey) {
      setPhase('invalidated');
      setError('The connected device changed while deletion was being checked. Close this dialog and check the cast before taking another action.');
    } else {
      setPhase('idle');
      setError('');
    }
    return () => { generation.current += 1; };
  }, [contextKey, targetKey]);

  function close() { if (!busy.current) onClose(); }
  async function remove() {
    if (!session || !authorized || busy.current || phase === 'invalidated') return;
    const connected = session;
    const run = generation.current;
    const context = contextKey;
    const target = cast;
    busy.current = true;
    attempted.current = { context, target: targetKey };
    setPhase('pending');
    setError('');
    try {
      // An uncertain request remains in this exact session's reconciliation
      // state. Calling again checks status; auth never replays that write.
      await connected.deleteCast({ fid: target.author.fid, hash: target.hash });
      if (run !== generation.current || activeContext.current !== context) return;
      attempted.current = null;
      busy.current = false;
      onDeleted(target);
    } catch (cause) {
      if (run !== generation.current || activeContext.current !== context) return;
      const unknown = cause instanceof ApiError && cause.code === 'submission_unknown';
      if (!unknown) attempted.current = null;
      setPhase(unknown ? 'unknown' : 'failed');
      setError(cause instanceof Error ? cause.message : 'The cast could not be deleted.');
    } finally {
      if (run === generation.current && activeContext.current === context) busy.current = false;
    }
  }

  return <Modal title="Delete cast" onClose={close}>
    <div className="delete-cast-dialog" aria-busy={phase === 'pending'}>
      <p className="pairing-copy">Deleting your cast cannot be undone. We confirm its removal on Hypersnap before removing it here. Other nodes may take time to update, and quotes, screenshots, or other copies may remain.</p>
      <blockquote className="delete-cast-preview"><strong>@{cast.author.username || cast.author.fid}</strong><p>{cast.text || 'Cast with attachments'}</p></blockquote>
      <p className="fine-print">Uploaded images remain public after the cast is deleted.</p>
      {!session && <p className="pairing-copy">Connect the wallet for this cast’s account to delete it.</p>}
      {session && !ownCast && <p className="error" role="alert">You can delete only casts published by your own account.</p>}
      {ownCast && !authorized && <p className="pairing-copy">This device key does not have cast deletion permission. Review and approve a separate device key in your custody wallet, then confirm deletion here.</p>}
      {phase === 'pending' && <p role="status" className="pairing-copy"><IconRefresh size={16} className="spin" />Confirming deletion on Hypersnap… Keep this dialog open.</p>}
      {phase === 'unknown' && <p className="fine-print">A deletion may already have been submitted. Checking status only reads Hypersnap; it will not submit another deletion.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="delete-cast-actions">
        <Button variant="secondary" disabled={phase === 'pending'} onClick={close}>Cancel</Button>
        {(!session || (ownCast && !authorized)) && phase !== 'invalidated' && <Button disabled={phase === 'pending'} onClick={onEnable}>{session ? 'Enable deletion' : 'Connect wallet'}</Button>}
        {authorized && phase !== 'invalidated' && <Button className="delete-cast-confirm" disabled={phase === 'pending'} onClick={() => void remove()}>{phase === 'pending' ? <IconRefresh size={16} className="spin" /> : <IconTrash size={16} />}{phase === 'unknown' ? 'Check deletion status' : phase === 'pending' ? 'Checking deletion…' : 'Delete cast'}</Button>}
      </div>
    </div>
  </Modal>;
}
