import { useRef, useState } from 'react';
import { IconCalendar, IconCopy, IconShare, IconWallet } from '@tabler/icons-react';
import type { User } from '../lib/api';
import { profilePath, publicUrl } from '../lib/navigation';
import { Button, Input, Modal } from './ui';

export function ProfileDetails({ user }: { user: User }) {
  const eth = [...new Set((Array.isArray(user.verified_addresses?.eth_addresses) ? user.verified_addresses.eth_addresses : []).filter(value => /^0x[a-fA-F0-9]{40}$/.test(value)))].slice(0, 20);
  const sol = [...new Set((Array.isArray(user.verified_addresses?.sol_addresses) ? user.verified_addresses.sol_addresses : []).filter(value => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)))].slice(0, 20);
  const date = user.registered_at ? new Date(user.registered_at) : null;
  const joined = date && Number.isFinite(date.getTime()) && date.getTime() > 0 && date.getTime() <= Date.now()
    ? date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : null;
  return <div className="profile-details">
    {joined && <p><IconCalendar size={16} aria-hidden="true" />Joined {joined}</p>}
    {(eth.length > 0 || sol.length > 0) && <details><summary><IconWallet size={16} aria-hidden="true" />Linked addresses ({eth.length + sol.length})</summary><p className="muted">Public addresses verified on Hypersnap.</p><ul>{[...eth.map(value => ({ value, network: 'Ethereum' })), ...sol.map(value => ({ value, network: 'Solana' }))].map(({ value, network }) => <li key={`${network}:${value}`}><span>{network}</span><code>{value}</code></li>)}</ul></details>}
  </div>;
}

export function ShareProfileDialog({ user, onClose }: { user: User; onClose(): void }) {
  const link = publicUrl(profilePath(user.fid));
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  function select() { input.current?.focus(); input.current?.select(); setStatus('Link selected. Use your device’s Copy command.'); }
  async function copy() {
    setBusy(true);
    try { if (!navigator.clipboard?.writeText) { select(); return; } await navigator.clipboard.writeText(link); setStatus('Profile link copied.'); }
    catch { select(); } finally { setBusy(false); }
  }
  async function share() {
    setBusy(true);
    try { await navigator.share({ title: `${user.display_name || user.username || `FID ${user.fid}`} on Opencaster`, url: link }); setStatus('Profile shared.'); }
    catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) setStatus('Use Copy link to share this profile.'); }
    finally { setBusy(false); }
  }
  return <Modal title="Share profile" onClose={onClose}><div className="share-cast"><p className="share-cast__intro">This public link stays the same if the username changes.</p><Input ref={input} aria-label="Profile link" readOnly value={link} onFocus={event => event.currentTarget.select()} /><div className="share-cast__actions"><Button data-analytics="share-copy" disabled={busy} onClick={() => void copy()}><IconCopy size={17} />Copy link</Button>{typeof navigator.share === 'function' && <Button data-analytics="share-native" variant="secondary" disabled={busy} onClick={() => void share()}><IconShare size={17} />Share via…</Button>}</div><p className="share-cast__status" role="status">{status || 'Select or copy the link to share this profile.'}</p></div></Modal>;
}
