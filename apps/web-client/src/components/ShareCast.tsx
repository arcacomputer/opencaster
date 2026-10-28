import { useId, useRef, useState } from 'react';
import { IconArrowUpRight, IconCopy, IconShare } from '@tabler/icons-react';
import type { Cast } from '@opencaster/client-core/api';
import { castPermalink, matchesCastRoute, parseLocalPath, publicUrl } from '@opencaster/client-core/navigation';
import { Button, Input, Modal } from './ui';

/** Shares public cast content only. This dialog never reads account or wallet state. */
export function ShareCastDialog({ cast, path, onClose, notify }: { cast: Cast; path?: string; onClose(): void; notify(text: string): void }) {
  const target = path ? parseLocalPath(path) : undefined;
  // Newly shared links identify the exact cast, including older posts whose
  // short hash is outside the preview crawler's bounded recent-history scan.
  const exact = target && matchesCastRoute(target, cast)
    && (target.kind === 'cast' || (target.kind === 'cast-alias' && target.hashPrefix.length === 42));
  const link = publicUrl(exact ? path! : castPermalink(cast, { fullHash: true }));
  const inputId = useId();
  const statusId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const nativeShareAvailable = typeof navigator.share === 'function';

  function selectLink() {
    input.current?.focus();
    input.current?.select();
    input.current?.setSelectionRange(0, link.length);
    setStatus('Link selected. Use your device’s Copy command, or press Control+C (Command+C on Mac).');
  }

  async function copyLink() {
    if (!navigator.clipboard?.writeText) { selectLink(); return; }
    setBusy(true);
    try {
      await navigator.clipboard.writeText(link);
      setStatus('Cast link copied.');
      notify('Cast link copied.');
    } catch {
      selectLink();
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    setBusy(true);
    try {
      await navigator.share({
        title: `Cast by ${cast.author.display_name || cast.author.username || `FID ${cast.author.fid}`}`,
        text: cast.text.slice(0, 280),
        url: link,
      });
      setStatus('Cast shared.');
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        setStatus('The share sheet could not open. Copy the link below instead.');
      }
    } finally {
      setBusy(false);
    }
  }

  return <Modal title="Share cast" onClose={onClose}>
    <div className="share-cast">
      <p className="share-cast__intro">Anyone with this link can open the public cast on Opencaster.</p>
      <label className="field-label" htmlFor={inputId}>Cast link</label>
      <Input ref={input} id={inputId} value={link} readOnly aria-describedby={statusId} autoComplete="off" spellCheck={false} onFocus={event => event.currentTarget.select()} />
      <div className="share-cast__actions">
        <Button data-analytics="share-copy" onClick={() => void copyLink()} disabled={busy}><IconCopy size={17} />Copy link</Button>
        {nativeShareAvailable && <Button data-analytics="share-native" variant="secondary" onClick={() => void share()} disabled={busy}><IconShare size={17} />Share via…</Button>}
        <a className="button button--secondary" href={link} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open cast<IconArrowUpRight size={17} /></a>
      </div>
      <p id={statusId} className="share-cast__status" role="status">{status || 'You can also select the link and copy it manually.'}</p>
    </div>
  </Modal>;
}

export default ShareCastDialog;
