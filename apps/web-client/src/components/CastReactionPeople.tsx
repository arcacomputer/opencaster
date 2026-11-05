import { useState, type MouseEvent } from 'react';
import { IconChevronRight, IconRefresh } from '@tabler/icons-react';
import { getCastReactionPeople, type Cast, type CastReactionPeopleType, type User } from '@opencaster/client-core/api';
import { profilePath } from '@opencaster/client-core/navigation';
import { LOADING_CANCELLED, usePagedRead } from '../lib/usePagedRead';
import { Button, Modal } from './ui';
import '../cast-reaction-people.scss';
import { safeHttpsUrl } from '@opencaster/client-core/safeUrl';

export interface CastReactionPeopleProps {
  cast: Pick<Cast, 'hash' | 'author'>;
  initialType?: CastReactionPeopleType;
  onClose(): void;
  onProfile(user: User): void;
}
const REACTION_PEOPLE_READ = {
  maxItems: 1000,
  maxPages: 40,
  repeatedStatus: 'The node repeated an earlier page. Refresh to check its current view again.',
  cappedStatus: 'This view reached its limit of 1,000 profiles or 40 node pages. Refresh to start again.',
  errorFallback: 'These public profiles are unavailable.',
};
function Person({ user, onProfile }: { user: User; onProfile(user: User): void }) {
  const [failedImage, setFailedImage] = useState('');
  const image = safeHttpsUrl(user.pfp_url);
  function visit(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault(); onProfile(user);
  }
  return <li><a href={profilePath(user.fid)} onClick={visit}>
    {image && image !== failedImage ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedImage(image!)} /> : <span className="cast-reaction-people__avatar" aria-hidden="true">{(user.display_name || user.username || String(user.fid)).slice(0, 1).toUpperCase()}</span>}
    <span className="cast-reaction-people__identity"><strong>{user.display_name || user.username || `FID ${user.fid}`}</strong><span>@{user.username || user.fid}</span>{user.profile?.bio?.text ? <small>{user.profile.bio.text}</small> : null}</span><IconChevronRight size={16} aria-hidden="true" />
  </a></li>;
}

export default function CastReactionPeople({ cast, initialType = 'likes', onClose, onProfile }: CastReactionPeopleProps) {
  const targetKey = `${cast.author.fid}:${cast.hash.replace(/^0x/, '').toLowerCase()}`;
  const [selection, setSelection] = useState({ targetKey, type: initialType });
  const type = selection.targetKey === targetKey ? selection.type : initialType;
  const key = `${targetKey}:${type}`;
  const visible = usePagedRead<User>(key, true, async (cursor, signal) => {
    const page = await getCastReactionPeople({ target: { fid: cast.author.fid, hash: cast.hash }, type, cursor, limit: 25, signal });
    return { items: page.users, cursor: page.next.cursor };
  }, user => String(user.fid), REACTION_PEOPLE_READ);
  const close = () => { visible.cancel(); onClose(); };
  return <Modal title="Cast reactions" onClose={close}>
    <section className="cast-reaction-people" aria-label="People who reacted to this cast">
      <div className="cast-reaction-people__tabs" role="group" aria-label="Reaction type">{(['likes', 'recasts'] as const).map(value => <Button key={value} variant={type === value ? 'secondary' : 'ghost'} aria-pressed={type === value} onClick={() => setSelection({ targetKey, type: value })}>{value === 'likes' ? 'Likes' : 'Recasts'}</Button>)}</div>
      <p className="cast-reaction-people__note">Profiles returned by this Hypersnap node. Its current view can change or be incomplete. Shows up to 1,000 profiles across 40 node pages.</p>
      <ul className="cast-reaction-people__list">{visible.items.map(user => <Person key={user.fid} user={user} onProfile={person => { close(); onProfile(person); }} />)}</ul>
      {visible.busy ? <p className="cast-reaction-people__status" role="status"><IconRefresh size={15} className="spin" aria-hidden="true" />Loading profiles…<Button variant="ghost" onClick={visible.cancel}>Cancel</Button></p> : null}
      {visible.error ? <div className="cast-reaction-people__error"><p role="alert">{visible.error}</p><Button variant="secondary" onClick={visible.retry}>Try again</Button></div> : null}
      {!visible.busy && visible.status ? <p className="cast-reaction-people__status" role="status">{visible.status}{visible.status === LOADING_CANCELLED ? <Button variant="ghost" onClick={visible.retry}>Try again</Button> : null}</p> : null}
      {visible.loaded && !visible.busy && !visible.error && !visible.items.length ? <p className="cast-reaction-people__note">No {type} were returned in this node view.</p> : null}
      {!visible.busy && !visible.error && visible.cursor ? <Button variant="secondary" className="full-width" onClick={visible.more}>Load more profiles</Button> : null}
      <div className="cast-reaction-people__actions"><Button variant="secondary" disabled={visible.busy} onClick={visible.refresh}>Refresh profiles</Button><Button variant="ghost" onClick={close}>Close</Button></div>
    </section>
  </Modal>;
}
