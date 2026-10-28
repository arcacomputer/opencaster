import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { IconChevronRight, IconRefresh } from '@tabler/icons-react';
import { getCastReactionPeople, type Cast, type CastReactionPeopleType, type User } from '@opencaster/client-core/api';
import { profilePath } from '@opencaster/client-core/navigation';
import { Button, Modal } from './ui';
import '../cast-reaction-people.scss';

export interface CastReactionPeopleProps {
  cast: Pick<Cast, 'hash' | 'author'>;
  initialType?: CastReactionPeopleType;
  onClose(): void;
  onProfile(user: User): void;
}
const MAX_PEOPLE = 1000;
const MAX_PAGES = 40;
function Person({ user, onProfile }: { user: User; onProfile(user: User): void }) {
  const [failedImage, setFailedImage] = useState('');
  let image: string | undefined;
  try { const url = new URL(user.pfp_url ?? ''); if (url.protocol === 'https:' && !url.username && !url.password) image = url.href; } catch { /* Initials remain available. */ }
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
  const [state, setState] = useState({ key, users: [] as User[], cursor: undefined as string | undefined, busy: true, loaded: false, error: '', status: '' });
  const currentKey = useRef(key); currentKey.current = key;
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const requesting = useRef(false);
  const seen = useRef(new Set<string>());
  const pageCount = useRef(0);
  const lastAttempt = useRef<{ cursor?: string; replace: boolean }>({ replace: true });
  const load = useCallback(async (cursor?: string, replace = true) => {
    if (requesting.current) return;
    requesting.current = true;
    const request = new AbortController(); controller.current?.abort(); controller.current = request;
    const run = ++generation.current; const capturedKey = key;
    lastAttempt.current = { cursor, replace };
    setState(current => ({ ...current, key, busy: true, error: '', status: '' }));
    try {
      const page = await getCastReactionPeople({ target: { fid: cast.author.fid, hash: cast.hash }, type, cursor, limit: 25, signal: request.signal });
      if (request.signal.aborted || run !== generation.current || currentKey.current !== capturedKey) return;
      if (cursor) seen.current.add(cursor);
      const repeated = Boolean(page.next.cursor && seen.current.has(page.next.cursor));
      const pages = ++pageCount.current;
      setState(current => {
        const users = new Map((replace ? [] : current.users).map(user => [user.fid, user]));
        for (const user of page.users) users.set(user.fid, user);
        const capped = users.size >= MAX_PEOPLE || (pages >= MAX_PAGES && Boolean(page.next.cursor));
        return { key, users: [...users.values()].slice(0, MAX_PEOPLE), cursor: repeated || capped ? undefined : page.next.cursor || undefined, busy: false, loaded: true, error: '', status: repeated ? 'The node repeated an earlier page. Refresh to check its current view again.' : capped ? 'This view reached its limit of 1,000 profiles or 40 node pages. Refresh to start again.' : '' };
      });
    } catch (cause) {
      if (!request.signal.aborted && run === generation.current && currentKey.current === capturedKey) setState(current => ({ ...current, busy: false, error: cause instanceof Error ? cause.message.slice(0, 240) : 'These public profiles are unavailable.' }));
    } finally { if (run === generation.current) requesting.current = false; }
  }, [cast.author.fid, cast.hash, key, type]);
  useEffect(() => {
    generation.current += 1; controller.current?.abort(); requesting.current = false; seen.current.clear(); pageCount.current = 0;
    setState({ key, users: [], cursor: undefined, busy: true, loaded: false, error: '', status: '' });
    void load();
    return () => { generation.current += 1; controller.current?.abort(); requesting.current = false; };
  }, [key, load]);
  function cancel() {
    generation.current += 1; controller.current?.abort(); requesting.current = false;
    setState(current => ({ ...current, busy: false, status: 'Loading cancelled.' }));
  }
  function refresh() { if (!requesting.current) { seen.current.clear(); pageCount.current = 0; void load(); } }
  const close = () => { cancel(); onClose(); };
  const visible = state.key === key ? state : { key, users: [], cursor: undefined, busy: true, loaded: false, error: '', status: '' };
  return <Modal title="Cast reactions" onClose={close}>
    <section className="cast-reaction-people" aria-label="People who reacted to this cast">
      <div className="cast-reaction-people__tabs" role="group" aria-label="Reaction type">{(['likes', 'recasts'] as const).map(value => <Button key={value} variant={type === value ? 'secondary' : 'ghost'} aria-pressed={type === value} onClick={() => setSelection({ targetKey, type: value })}>{value === 'likes' ? 'Likes' : 'Recasts'}</Button>)}</div>
      <p className="cast-reaction-people__note">Profiles returned by this Hypersnap node. Its current view can change or be incomplete. Shows up to 1,000 profiles across 40 node pages.</p>
      <ul className="cast-reaction-people__list">{visible.users.map(user => <Person key={user.fid} user={user} onProfile={person => { close(); onProfile(person); }} />)}</ul>
      {visible.busy ? <p className="cast-reaction-people__status" role="status"><IconRefresh size={15} className="spin" aria-hidden="true" />Loading profiles…<Button variant="ghost" onClick={cancel}>Cancel</Button></p> : null}
      {visible.error ? <div className="cast-reaction-people__error"><p role="alert">{visible.error}</p><Button variant="secondary" onClick={() => void load(lastAttempt.current.cursor, lastAttempt.current.replace)}>Try again</Button></div> : null}
      {!visible.busy && visible.status ? <p className="cast-reaction-people__status" role="status">{visible.status}{visible.status === 'Loading cancelled.' ? <Button variant="ghost" onClick={() => void load(lastAttempt.current.cursor, lastAttempt.current.replace)}>Try again</Button> : null}</p> : null}
      {visible.loaded && !visible.busy && !visible.error && !visible.users.length ? <p className="cast-reaction-people__note">No {type} were returned in this node view.</p> : null}
      {!visible.busy && !visible.error && visible.cursor ? <Button variant="secondary" className="full-width" onClick={() => void load(visible.cursor, false)}>Load more profiles</Button> : null}
      <div className="cast-reaction-people__actions"><Button variant="secondary" disabled={visible.busy} onClick={refresh}>Refresh profiles</Button><Button variant="ghost" onClick={close}>Close</Button></div>
    </section>
  </Modal>;
}
