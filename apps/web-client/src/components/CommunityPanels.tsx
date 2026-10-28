import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { IconChevronRight, IconRefresh, IconUsers } from '@tabler/icons-react';
import { getCastQuotes, getChannelMembers, getSuggestedUsers, type Cast, type Channel, type User } from '@opencaster/client-core/api';
import { profilePath } from '@opencaster/client-core/navigation';
import { Button, Modal } from './ui';
import '../community.scss';

type CommunityPage<T> = { items: T[]; cursor?: string | null };
const MAX_PARTICIPANTS = 500;
function useCommunityRead<T>(key: string, enabled: boolean, read: (cursor: string | undefined, signal: AbortSignal) => Promise<CommunityPage<T>>, identity: (item: T) => string) {
  const [state, setState] = useState({ key, items: [] as T[], cursor: undefined as string | undefined, busy: enabled, loaded: false, error: '', status: '' });
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const requesting = useRef(false);
  const seen = useRef(new Set<string>());
  const lastAttempt = useRef<{ cursor?: string; replace: boolean }>({ replace: true });
  const currentKey = useRef(key); currentKey.current = key;
  const reader = useRef(read); reader.current = read;
  const id = useRef(identity); id.current = identity;
  const load = useCallback(async (cursor?: string, replace = true) => {
    if (!enabled || requesting.current) return;
    requesting.current = true; controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const run = ++generation.current; const capturedKey = key;
    lastAttempt.current = { cursor, replace };
    setState(current => ({ ...current, key, busy: true, error: '', status: '' }));
    try {
      const page = await reader.current(cursor, request.signal);
      if (request.signal.aborted || run !== generation.current || currentKey.current !== capturedKey) return;
      if (cursor) seen.current.add(cursor);
      const repeated = Boolean(page.cursor && (page.cursor === cursor || seen.current.has(page.cursor)));
      setState(current => {
        const entries = new Map((replace ? [] : current.items).map(item => [id.current(item), item]));
        for (const item of page.items) entries.set(id.current(item), item);
        const capped = entries.size >= MAX_PARTICIPANTS;
        return { key, items: [...entries.values()].slice(0, MAX_PARTICIPANTS), cursor: repeated || capped ? undefined : page.cursor || undefined, busy: false, loaded: true, error: '', status: repeated ? 'The node repeated its continuation. Refresh to check the available list again.' : capped ? 'Showing the first 500 participants. Refresh to start again.' : '' };
      });
    } catch (cause) {
      if (!request.signal.aborted && run === generation.current && currentKey.current === capturedKey) setState(current => ({ ...current, busy: false, error: cause instanceof Error ? cause.message.slice(0, 240) : 'These public results are unavailable.' }));
    } finally { if (run === generation.current) requesting.current = false; }
  }, [enabled, key]);
  useEffect(() => {
    generation.current += 1; controller.current?.abort(); requesting.current = false; seen.current.clear();
    setState({ key, items: [], cursor: undefined, busy: enabled, loaded: false, error: '', status: '' });
    if (enabled) void load();
    return () => { generation.current += 1; controller.current?.abort(); requesting.current = false; };
  }, [key, enabled, load]);
  function cancel() { generation.current += 1; controller.current?.abort(); requesting.current = false; setState(current => ({ ...current, busy: false, status: 'Loading cancelled.' })); }
  return { ...(state.key === key ? state : { key, items: [] as T[], cursor: undefined, busy: enabled, loaded: false, error: '', status: '' }),
    cancel, refresh: () => { seen.current.clear(); void load(); }, more: () => void load(state.cursor, false), retry: () => void load(lastAttempt.current.cursor, lastAttempt.current.replace) };
}
function localProfile(event: MouseEvent<HTMLAnchorElement>, visit: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  event.preventDefault(); visit();
}
function Person({ user, onProfile }: { user: User; onProfile(user: User): void }) {
  const [failedImage, setFailedImage] = useState('');
  let image: string | undefined;
  try { const url = new URL(user.pfp_url ?? ''); if (url.protocol === 'https:' && !url.username && !url.password) image = url.href; } catch { /* Initials remain available. */ }
  return <li className="community-person"><a href={profilePath(user.fid)} onClick={event => localProfile(event, () => onProfile(user))}>
    {image && image !== failedImage ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedImage(image!)} /> : <span className="community-person__avatar" aria-hidden="true">{(user.display_name || user.username || String(user.fid)).slice(0, 1).toUpperCase()}</span>}
    <span className="community-person__identity"><strong>{user.display_name || user.username || `FID ${user.fid}`}</strong><span>@{user.username || user.fid}</span>{user.profile?.bio?.text ? <small>{user.profile.bio.text}</small> : null}</span><IconChevronRight size={16} aria-hidden="true" />
  </a></li>;
}
function ReadControls({ state }: { state: Pick<ReturnType<typeof useCommunityRead>, 'busy' | 'error' | 'status' | 'cancel' | 'retry'> }) {
  return <>{state.busy ? <p className="community-status" role="status"><IconRefresh size={15} className="spin" aria-hidden="true" />Loading public results…<Button variant="ghost" onClick={state.cancel}>Cancel</Button></p> : null}
    {state.error ? <div className="community-error"><p role="alert">{state.error}</p><Button variant="secondary" onClick={state.retry}>Try again</Button></div> : null}
    {!state.busy && state.status ? <p className="community-status" role="status">{state.status}{state.status === 'Loading cancelled.' ? <Button variant="ghost" onClick={state.retry}>Try again</Button> : null}</p> : null}</>;
}

export function SuggestedPeople({ fid, onProfile }: { fid?: number; onProfile(user: User): void }) {
  const state = useCommunityRead<User>(String(fid), Boolean(fid), async (_cursor, signal) => ({ items: (await getSuggestedUsers(fid!, 6, signal)).users }), user => String(user.fid));
  if (!fid) return null;
  return <section className="community-panel" aria-label="Suggested people"><div className="community-heading"><h3><IconUsers size={18} aria-hidden="true" />People to discover</h3><Button variant="ghost" aria-label="Refresh suggested people" disabled={state.busy} onClick={state.refresh}><IconRefresh size={16} /></Button></div>
    <p className="community-note">A small friends-of-friends sample from Hypersnap.</p>
    <ul className="community-people">{state.items.map(user => <Person key={user.fid} user={user} onProfile={onProfile} />)}</ul>
    <ReadControls state={state} />
    {state.loaded && !state.busy && !state.error && !state.items.length ? <p className="community-note">No suggested profiles were returned in this sample.</p> : null}
  </section>;
}

export function ChannelPeopleDialog({ channel, onProfile, onClose }: { channel: Channel; onProfile(user: User): void; onClose(): void }) {
  const state = useCommunityRead<User>(channel.id, true, async (cursor, signal) => { const page = await getChannelMembers(channel.id, { cursor, limit: 25, signal }); return { items: page.users, cursor: page.next.cursor }; }, user => String(user.fid));
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
  const state = useCommunityRead<Cast>(cast.hash, true, async (_cursor, signal) => ({ items: (await getCastQuotes(cast.hash, 25, signal)).casts }), item => item.hash.replace(/^0x/, '').toLowerCase());
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
