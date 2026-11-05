import type { MouseEvent } from 'react';
import { IconChevronRight, IconRefresh, IconUsers } from '@tabler/icons-react';
import type { User } from '@opencaster/client-core/api';
import { profilePath } from '@opencaster/client-core/navigation';
import { usePagedRead } from '../lib/usePagedRead';
import { Button, Modal } from './ui';
import '../social.scss';

export interface FollowPage { users: User[]; next: { cursor?: string | null } }
export interface FollowPageOptions { fid: number; kind: 'followers' | 'following'; cursor?: string | null; signal?: AbortSignal }
interface Props {
  user: User;
  kind: FollowPageOptions['kind'];
  loadPage(options: FollowPageOptions): Promise<FollowPage>;
  onProfile(user: User): void;
  onClose(): void;
}

const FOLLOW_LIST_READ = {
  repeatedStatus: 'You have reached the end of the available list.',
  errorFallback: 'This list could not be loaded.',
};

function safeImage(url: string): boolean {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password; }
  catch { return false; }
}

export default function FollowListDialog({ user, kind, loadPage, onProfile, onClose }: Props) {
  const { items: users, cursor, busy, error, loaded, status, cancel, more, retry } = usePagedRead<User>(`${user.fid}:${kind}`, true, async (nextCursor, signal) => {
    const result = await loadPage({ fid: user.fid, kind, cursor: nextCursor, signal });
    return { items: result.users, cursor: result.next?.cursor };
  }, person => String(person.fid), FOLLOW_LIST_READ);

  function close() { cancel(); onClose(); }
  function visit(event: MouseEvent<HTMLAnchorElement>, person: User) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); cancel(); onClose(); onProfile(person);
  }

  return <Modal title={`${kind === 'followers' ? 'Followers' : 'Following'} · @${user.username || user.fid}`} onClose={close}>
    <div className="follow-list" aria-busy={busy}>
      <p className="social-intro">{kind === 'followers' ? 'People following this profile on Hypersnap.' : 'People this profile follows on Hypersnap.'}</p>
      {users.length > 0 && <ul className="follow-list__people">{users.map(person => <li key={person.fid}><a href={profilePath(person.fid)} onClick={event => visit(event, person)}>
        {person.pfp_url && safeImage(person.pfp_url) ? <img src={person.pfp_url} alt="" width={44} height={44} loading="lazy" referrerPolicy="no-referrer" /> : <span className="follow-list__fallback" aria-hidden="true">{(person.display_name || person.username || String(person.fid)).slice(0, 1).toUpperCase()}</span>}
        <span className="follow-list__identity"><strong>{person.display_name || person.username || `FID ${person.fid}`}</strong><span>@{person.username || person.fid}</span>{person.profile?.bio?.text && <span className="follow-list__bio">{person.profile.bio.text}</span>}</span><IconChevronRight size={17} aria-hidden="true" />
      </a></li>)}</ul>}
      {loaded && !users.length && !busy && !error && <div className="social-empty"><IconUsers size={28} /><p>{kind === 'followers' ? 'No followers to show yet.' : 'No followed profiles to show yet.'}</p></div>}
      {busy && <p className="social-status" role="status"><IconRefresh size={17} className="spin" />{users.length ? 'Loading more profiles…' : 'Loading profiles…'}</p>}
      {error && <div className="follow-list__error"><p className="error" role="alert">{error}</p><Button variant="secondary" onClick={retry}><IconRefresh size={16} />Try again</Button></div>}
      {!busy && !error && cursor && <Button className="full-width" variant="secondary" onClick={more}>Load more profiles</Button>}
      {!busy && status && <p className="social-status" role="status">{status}</p>}
      <div className="social-actions"><Button variant="ghost" onClick={close}>{busy ? 'Cancel' : 'Close'}</Button></div>
    </div>
  </Modal>;
}
