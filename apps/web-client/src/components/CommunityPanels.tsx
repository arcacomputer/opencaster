import { useState, type MouseEvent, type ReactNode } from 'react';
import { IconChevronRight, IconRefresh, IconUsers } from '@tabler/icons-react';
import { getCastQuotes, getChannelMembers, getSuggestedUsers, type Cast, type Channel, type User } from '@opencaster/client-core/api';
import { profilePath } from '@opencaster/client-core/navigation';
import { LOADING_CANCELLED, usePagedRead, type PagedRead } from '../lib/usePagedRead';
import { Button, Modal } from './ui';
import '../community.scss';
import { safeHttpsUrl } from '@opencaster/client-core/safeUrl';

const COMMUNITY_READ = {
  maxItems: 500,
  repeatedStatus: 'The node repeated its continuation. Refresh to check the available list again.',
  cappedStatus: 'Showing the first 500 participants. Refresh to start again.',
  errorFallback: 'These public results are unavailable.',
};
function localProfile(event: MouseEvent<HTMLAnchorElement>, visit: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  event.preventDefault(); visit();
}
function Person({ user, onProfile }: { user: User; onProfile(user: User): void }) {
  const [failedImage, setFailedImage] = useState('');
  const image = safeHttpsUrl(user.pfp_url);
  return <li className="community-person"><a href={profilePath(user.fid)} onClick={event => localProfile(event, () => onProfile(user))}>
    {image && image !== failedImage ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedImage(image!)} /> : <span className="community-person__avatar" aria-hidden="true">{(user.display_name || user.username || String(user.fid)).slice(0, 1).toUpperCase()}</span>}
    <span className="community-person__identity"><strong>{user.display_name || user.username || `FID ${user.fid}`}</strong><span>@{user.username || user.fid}</span>{user.profile?.bio?.text ? <small>{user.profile.bio.text}</small> : null}</span><IconChevronRight size={16} aria-hidden="true" />
  </a></li>;
}
function ReadControls({ state }: { state: Pick<PagedRead<unknown>, 'busy' | 'error' | 'status' | 'cancel' | 'retry'> }) {
  return <>{state.busy ? <p className="community-status" role="status"><IconRefresh size={15} className="spin" aria-hidden="true" />Loading public results…<Button variant="ghost" onClick={state.cancel}>Cancel</Button></p> : null}
    {state.error ? <div className="community-error"><p role="alert">{state.error}</p><Button variant="secondary" onClick={state.retry}>Try again</Button></div> : null}
    {!state.busy && state.status ? <p className="community-status" role="status">{state.status}{state.status === LOADING_CANCELLED ? <Button variant="ghost" onClick={state.retry}>Try again</Button> : null}</p> : null}</>;
}

export function SuggestedPeople({ fid, onProfile }: { fid?: number; onProfile(user: User): void }) {
  const state = usePagedRead<User>(String(fid), Boolean(fid), async (_cursor, signal) => ({ items: (await getSuggestedUsers(fid!, 6, signal)).users }), user => String(user.fid), COMMUNITY_READ);
  if (!fid) return null;
  return <section className="community-panel" aria-label="Suggested people"><div className="community-heading"><h3><IconUsers size={18} aria-hidden="true" />People to discover</h3><Button variant="ghost" aria-label="Refresh suggested people" disabled={state.busy} onClick={state.refresh}><IconRefresh size={16} /></Button></div>
    <p className="community-note">A small friends-of-friends sample from Hypersnap.</p>
    <ul className="community-people">{state.items.map(user => <Person key={user.fid} user={user} onProfile={onProfile} />)}</ul>
    <ReadControls state={state} />
    {state.loaded && !state.busy && !state.error && !state.items.length ? <p className="community-note">No suggested profiles were returned in this sample.</p> : null}
  </section>;
}

export function ChannelPeopleDialog({ channel, onProfile, onClose }: { channel: Channel; onProfile(user: User): void; onClose(): void }) {
  const state = usePagedRead<User>(channel.id, true, async (cursor, signal) => { const page = await getChannelMembers(channel.id, { cursor, limit: 25, signal }); return { items: page.users, cursor: page.next.cursor }; }, user => String(user.fid), COMMUNITY_READ);
  const close = () => { state.cancel(); onClose(); };
  return <Modal title={`Participants · /${channel.name || channel.id}`} onClose={close}>
    <section className="community-dialog" aria-label="Channel participants"><p className="community-note">Accounts indexed as having posted in this channel. This is a participant list, not a subscription or permission list.</p>
      <ul className="community-people">{state.items.map(user => <Person key={user.fid} user={user} onProfile={person => { close(); onProfile(person); }} />)}</ul>
      <ReadControls state={state} />
      {state.loaded && !state.busy && !state.error && !state.items.length ? <p className="community-note">No participants were returned by this node.</p> : null}
      {!state.busy && !state.error && state.cursor ? <Button variant="secondary" className="full-width" onClick={state.more}>Load more participants</Button> : null}
      <div className="community-actions"><Button variant="ghost" onClick={close}>Close</Button></div>
    </section>
  </Modal>;
}

export function CastQuotesDialog({ cast, onClose, renderCast }: { cast: Cast; onClose(): void; renderCast(cast: Cast): ReactNode }) {
  const state = usePagedRead<Cast>(cast.hash, true, async (_cursor, signal) => ({ items: (await getCastQuotes(cast.hash, 25, signal)).casts }), item => item.hash.replace(/^0x/, '').toLowerCase(), COMMUNITY_READ);
  const close = () => { state.cancel(); onClose(); };
  return <Modal title="Quote casts" onClose={close} wide>
    <section className="community-dialog community-quotes" aria-label="Quote casts"><p className="community-note">Up to 25 quote casts returned by this node. Its quote index can be incomplete or unavailable; this is not an exhaustive archive.</p>
      {state.items.map(item => <div key={item.hash}>{renderCast(item)}</div>)}
      <ReadControls state={state} />
      {state.loaded && !state.busy && !state.error && !state.items.length ? <p className="community-note">No quote casts were returned by this node. Its quote index may be unavailable or incomplete.</p> : null}
      <div className="community-actions"><Button variant="secondary" disabled={state.busy} onClick={state.refresh}>Refresh quotes</Button><Button variant="ghost" onClick={close}>Close</Button></div>
    </section>
  </Modal>;
}
