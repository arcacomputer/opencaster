import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { IconBell, IconBookmark, IconChevronRight, IconHash, IconHeart, IconMessageCircle, IconRefresh, IconSearch, IconUsers, IconWorld } from '@tabler/icons-react';
import { getChannels, getNotifications, searchCasts, searchUsers, type ActivityItem, type Cast, type Channel, type User } from '../lib/api';
import { castPath, profilePath } from '../lib/navigation';
import { Button, Input } from './ui';
import '../feature.scss';

type Page<T> = { items: T[]; next: { cursor?: string | null } };
type PageOptions = { cursor?: string | null; signal?: AbortSignal; limit?: number };
const MAX_VISIBLE_ITEMS = 1_000;

/** Component-owned request lifecycle. Reusable paging logic is a mobile migration candidate. */
function useFeaturePages<T>(key: string, enabled: boolean, loader: (options: PageOptions) => Promise<Page<T>>, itemKey: (item: T) => string) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const requesting = useRef(false);
  const seen = useRef(new Set<string>());
  const lastAttempt = useRef<{ cursor?: string | null; replace: boolean }>({ replace: true });
  const loaderRef = useRef(loader); loaderRef.current = loader;
  const itemKeyRef = useRef(itemKey); itemKeyRef.current = itemKey;
  const activeKey = useRef(key); activeKey.current = key;

  const load = useCallback(async (nextCursor?: string | null, replace = false) => {
    if (requesting.current || !enabled) return;
    requesting.current = true;
    lastAttempt.current = { cursor: nextCursor, replace };
    const run = ++generation.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setStatus('');
    if (replace) seen.current.clear();
    try {
      const page = await loaderRef.current({ cursor: nextCursor, limit: 25, signal: controller.signal });
      if (run !== generation.current || controller.signal.aborted || activeKey.current !== key) return;
      if (nextCursor) seen.current.add(nextCursor);
      setItems(current => {
        const values = new Map((replace ? [] : current).map(item => [itemKeyRef.current(item), item]));
        for (const item of page.items) values.set(itemKeyRef.current(item), item);
        return [...values.values()].slice(0, MAX_VISIBLE_ITEMS);
      });
      const next = page.next?.cursor || null;
      const repeated = next !== null && (next === nextCursor || seen.current.has(next));
      setCursor(repeated ? null : next);
      if (repeated) setStatus('You have reached the end of the available results.');
      setLoaded(true);
    } catch (cause) {
      if (run === generation.current && !controller.signal.aborted && activeKey.current === key) setError(cause instanceof Error ? cause.message.slice(0, 240) : 'These results could not be loaded.');
    } finally {
      if (run === generation.current) { setBusy(false); requesting.current = false; }
    }
  }, [enabled, key]);

  useEffect(() => {
    generation.current += 1; request.current?.abort(); requesting.current = false;
    setItems([]); setCursor(null); setLoaded(false); setError(''); setStatus(''); setBusy(false); seen.current.clear(); lastAttempt.current = { replace: true };
    if (enabled) void load(undefined, true);
    return () => { generation.current += 1; request.current?.abort(); requesting.current = false; };
  }, [key, enabled, load]);

  function cancel() {
    generation.current += 1; request.current?.abort(); requesting.current = false;
    setBusy(false); setStatus('Loading cancelled.');
  }
  return {
    items, busy, loaded, error, status,
    more: Boolean(cursor) && items.length < MAX_VISIBLE_ITEMS,
    limitReached: items.length >= MAX_VISIBLE_ITEMS,
    loadMore: () => void load(cursor),
    retry: () => void load(lastAttempt.current.cursor, lastAttempt.current.replace),
    refresh: () => void load(undefined, true),
    cancel,
  };
}

type PageState = Pick<ReturnType<typeof useFeaturePages<unknown>>, 'busy' | 'error' | 'status' | 'more' | 'limitReached' | 'loadMore' | 'retry' | 'cancel'>;
function FeaturePager({ state, moreLabel = 'Load more' }: { state: PageState; moreLabel?: string }) {
  return <div className="feature-pager">
    {state.busy && <div className="feature-loading" role="status"><IconRefresh size={17} className="spin" aria-hidden="true" /><span>Loading…</span><Button variant="ghost" onClick={state.cancel}>Cancel</Button></div>}
    {state.error && <div className="feature-error"><p role="alert">{state.error}</p><Button variant="secondary" onClick={state.retry}><IconRefresh size={16} aria-hidden="true" />Try again</Button></div>}
    {!state.busy && !state.error && state.more && <Button variant="secondary" className="full-width" onClick={state.loadMore}>{moreLabel}</Button>}
    {!state.busy && state.status && <p className="feature-note" role="status">{state.status}{state.status === 'Loading cancelled.' && <Button variant="ghost" onClick={state.retry}>Try again</Button>}</p>}
    {state.limitReached && <p className="feature-note">Showing the first {MAX_VISIBLE_ITEMS.toLocaleString()} results. Refine your search or refresh to start again.</p>}
  </div>;
}

function localClick(event: MouseEvent<HTMLAnchorElement>, callback: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); callback();
}
function safeImage(url?: string): boolean {
  if (!url) return false;
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password; }
  catch { return false; }
}
// eslint-disable-next-line no-control-regex -- Search validation intentionally rejects ASCII control characters.
function validQuery(value: string): boolean { return Boolean(value.trim()) && new TextEncoder().encode(value.trim()).length <= 256 && !/[\u0000-\u001f\u007f]/.test(value); }
function ProfileAvatar({ user, size = 44 }: { user: User; size?: number }) {
  return safeImage(user.pfp_url)
    ? <img className="feature-avatar" src={user.pfp_url} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" />
    : <span className="feature-avatar feature-avatar--fallback" aria-hidden="true">{(user.display_name || user.username || String(user.fid)).slice(0, 1).toUpperCase()}</span>;
}
function UserResult({ user, onProfile }: { user: User; onProfile(user: User): void }) {
  return <a className="feature-user" href={profilePath(user.fid)} onClick={event => localClick(event, () => onProfile(user))}>
    <ProfileAvatar user={user} /><span className="feature-user__identity"><strong>{user.display_name || user.username || `FID ${user.fid}`}</strong><span>@{user.username || user.fid}</span>{user.profile?.bio?.text && <p>{user.profile.bio.text}</p>}</span><IconChevronRight size={17} aria-hidden="true" />
  </a>;
}

export type SearchKind = 'casts' | 'users';
export function SearchView({ query, kind, onSearch, onProfile, renderCast, focusRequest = 0 }: {
  query: string;
  kind: SearchKind;
  onSearch(query: string, kind: SearchKind): void;
  onProfile(user: User): void;
  renderCast(cast: Cast): ReactNode;
  focusRequest?: number;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focusRequest > 0) input.current?.focus(); }, [focusRequest]);
  const [draft, setDraft] = useState(query);
  const [formError, setFormError] = useState('');
  useEffect(() => { setDraft(query); setFormError(''); }, [query]);
  const enabled = validQuery(query);
  const result = useFeaturePages<Cast | User>(`${kind}:${query}`, enabled, async options => {
    if (kind === 'users') { const page = await searchUsers({ query, ...options }); return { items: page.users, next: {} }; }
    const page = await searchCasts({ query, ...options }); return { items: page.casts, next: page.next };
  }, item => 'hash' in item ? item.hash : String(item.fid));

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (!validQuery(value)) { setFormError('Enter a search query of up to 256 bytes, without control characters.'); return; }
    setFormError(''); onSearch(value, kind);
    if (value === query) result.refresh();
  }
  return <section className="feature-view" aria-label="Search Hypersnap">
    <div className="feature-intro"><span className="feature-kicker"><IconSearch size={15} aria-hidden="true" />EXPLORE HYPERSNAP</span><h2>Find a conversation.</h2><p>Search public casts and people on Hypersnap.</p></div>
    <form className="feature-search" onSubmit={submit} role="search">
      <label className="visually-hidden" htmlFor={inputId}>Search casts or people</label>
      <Input ref={input} id={inputId} type="search" placeholder={kind === 'casts' ? 'Search casts…' : 'Name or username…'} value={draft} maxLength={256} onChange={event => setDraft(event.target.value)} aria-describedby={formError ? `${inputId}-error` : undefined} aria-invalid={Boolean(formError)} />
      <Button type="submit"><IconSearch size={17} aria-hidden="true" /><span>Search</span></Button>
    </form>
    {formError && <p id={`${inputId}-error`} className="feature-form-error" role="alert">{formError}</p>}
    <nav className="feature-tabs" aria-label="Search result types">
      {(['casts', 'users'] as const).map(value => <a key={value} href={`/search?q=${encodeURIComponent(query)}&type=${value}`} aria-current={kind === value ? 'page' : undefined} onClick={event => localClick(event, () => onSearch(query, value))}>{value === 'casts' ? <IconMessageCircle size={17} aria-hidden="true" /> : <IconUsers size={17} aria-hidden="true" />}{value === 'casts' ? 'Casts' : 'People'}</a>)}
    </nav>
    {enabled && <p className="feature-note feature-note--inset">Showing up to 25 matches from the node’s search index.</p>}
    <div aria-busy={result.busy}>
      {!enabled && <div className="feature-empty"><IconSearch size={32} aria-hidden="true" /><h3>A new discovery starts here.</h3><p>Enter a topic or someone’s name to find them on Hypersnap.</p></div>}
      {enabled && result.items.length > 0 && <div className="feature-results">{result.items.map(item => <div key={'hash' in item ? item.hash : item.fid}>{'hash' in item ? renderCast(item) : <UserResult user={item} onProfile={onProfile} />}</div>)}</div>}
      {result.loaded && !result.items.length && !result.busy && !result.error && <div className="feature-empty"><IconSearch size={30} aria-hidden="true" /><h3>No {kind === 'users' ? 'people' : 'casts'} found.</h3><p>Try another name or a shorter phrase. Results reflect the indexes available on this Hypersnap node.</p></div>}
      {enabled && <FeaturePager state={result} moreLabel="Load more results" />}
    </div>
  </section>;
}

function timestamp(value: string): number { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : 0; }
const activityTimeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function timeLabel(value: string): string {
  const parsed = timestamp(value);
  if (!parsed) return 'Recently';
  return activityTimeFormat.format(parsed);
}
function readTimestamp(fid?: number): number {
  if (!fid) return 0;
  try { const parsed = Number(localStorage.getItem(`arca.hypersnap.activity.read.v1.${fid}`)); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; }
  catch { return 0; }
}
const activityLabels: Record<ActivityItem['type'], string> = { reactions: 'reacted to your cast', follows: 'followed you', replies: 'replied to your cast', mentions: 'mentioned you', unknown: 'shared activity involving your profile' };
const activityFilters = ['all', 'unread', 'mentions', 'replies', 'reactions', 'follows'] as const;
type ActivityFilter = typeof activityFilters[number];
const activityFilterLabels: Record<ActivityFilter, string> = { all: 'All', unread: 'Unread', mentions: 'Mentions', replies: 'Replies', reactions: 'Reactions', follows: 'Follows' };

export function NotificationsView({ fid, onConnect, onProfile, onCast, isActivityFiltered }: { fid?: number; onConnect(): void; onProfile(user: User): void; onCast(hash: string): void; isActivityFiltered?(item: ActivityItem): boolean }) {
  const [readAt, setReadAt] = useState(() => readTimestamp(fid));
  const [readStatus, setReadStatus] = useState('');
  const [filter, setFilter] = useState<ActivityFilter>('all');
  useEffect(() => { setReadAt(readTimestamp(fid)); setReadStatus(''); setFilter('all'); }, [fid]);
  const result = useFeaturePages<ActivityItem>(String(fid), Boolean(fid), async options => {
    const page = await getNotifications({ fid: fid!, ...options }); return { items: page.notifications, next: page.next };
  }, item => item.id);
  const activity = result.items.filter(item => !isActivityFiltered?.(item));
  const unread = activity.filter(item => timestamp(item.timestamp) > readAt).length;
  const visible = activity.filter(item => filter === 'all' || (filter === 'unread' ? timestamp(item.timestamp) > readAt : item.type === filter));
  function markRead() {
    const latest = Math.max(readAt, ...result.items.map(item => timestamp(item.timestamp)));
    setReadAt(latest);
    try { localStorage.setItem(`arca.hypersnap.activity.read.v1.${fid}`, String(latest)); setReadStatus('Loaded activity marked as read on this browser.'); }
    catch { setReadStatus('Loaded activity marked as read for this visit. This browser could not save read status.'); }
  }
  return <section className="feature-view" aria-label="Notifications">
    <div className="feature-intro"><span className="feature-kicker"><IconBell size={15} aria-hidden="true" />YOUR CONVERSATIONS</span><h2>Recent activity.</h2><p>Replies, mentions, reactions and follows reported by Hypersnap. This recent activity view may not include every event.</p></div>
    {!fid ? <div className="feature-empty"><IconBell size={32} aria-hidden="true" /><h3>Keep up with your conversations.</h3><p>Sign in to view activity for your profile.</p><Button onClick={onConnect}>Sign in</Button></div> : <>
      <div className="feature-toolbar"><span>{!result.loaded ? result.error ? 'Activity unavailable' : 'Checking recent activity…' : unread ? `${unread} unread in this view` : 'You’re up to date in this view'}</span><div><Button variant="ghost" disabled={result.busy} onClick={result.refresh} aria-label="Refresh activity"><IconRefresh size={17} aria-hidden="true" /></Button><Button variant="secondary" disabled={!unread} onClick={markRead}>Mark read</Button></div></div>
      <nav className="feature-tabs feature-activity-filters" aria-label="Activity filters">{activityFilters.map(value => <Button key={value} variant="ghost" className={filter === value ? 'feature-tab--active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{activityFilterLabels[value]}</Button>)}</nav>
      <p className="feature-note feature-note--inset">Filters apply to loaded activity. Mark read applies across filters. Read status stays on this browser.</p>
      {activity.length < result.items.length && <p className="feature-note feature-note--inset" role="status">Content preferences hide {result.items.length - activity.length} loaded activity {result.items.length - activity.length === 1 ? 'item' : 'items'} on this browser.</p>}
      {readStatus && <p className="feature-note feature-note--inset" role="status">{readStatus}</p>}
      <div aria-busy={result.busy}>
        {visible.length > 0 && <ul className="feature-activity">{visible.map(item => {
          const actor = item.actors[0];
          const hash = item.targetHash || item.cast?.hash;
          return <li key={item.id} data-unread={timestamp(item.timestamp) > readAt || undefined}>
            <span className={`feature-activity__symbol feature-activity__symbol--${item.type}`} aria-hidden="true">{item.type === 'follows' ? <IconUsers size={18} /> : item.type === 'reactions' ? <IconHeart size={18} /> : <IconMessageCircle size={18} />}</span>
            <div className="feature-activity__body"><div className="feature-activity__actors">{actor && <a href={profilePath(actor.fid)} onClick={event => localClick(event, () => onProfile(actor))}><ProfileAvatar user={actor} /><strong>{actor.display_name || actor.username || `FID ${actor.fid}`}</strong></a>}{item.actors.length > 1 && <span>and {item.actors.length - 1} {item.actors.length === 2 ? 'other' : 'others'}</span>}</div>
              <p>{activityLabels[item.type]} <time dateTime={timestamp(item.timestamp) ? item.timestamp : undefined}>{timeLabel(item.timestamp)}</time></p>
              {hash && <a className="feature-activity__cast" href={castPath(hash)} onClick={event => localClick(event, () => onCast(hash))}>{item.cast?.text ? <span>{item.cast.text}</span> : <span>Open cast</span>}<IconChevronRight size={16} aria-hidden="true" /></a>}
            </div>
          </li>;
        })}</ul>}
        {result.loaded && !visible.length && !result.busy && !result.error && <div className="feature-empty"><IconBell size={30} aria-hidden="true" /><h3>{filter === 'all' ? 'A little quiet for now.' : `No ${filter === 'unread' ? 'unread activity' : activityFilterLabels[filter].toLowerCase()} in the loaded results.`}</h3><p>{result.more ? 'Load more activity to check earlier events, or choose another filter.' : filter === 'all' ? 'Recent activity involving your profile will appear here when it is available on Hypersnap.' : 'Choose another filter or refresh to check for new activity.'}</p></div>}
        <FeaturePager state={result} moreLabel="Load more activity" />
      </div>
    </>}
  </section>;
}

type ChannelKind = 'all' | 'trending' | 'saved';
function ChannelRows({ channels, savedIds, onChannel, onToggleSave }: { channels: readonly Channel[]; savedIds: Set<string>; onChannel(channel: Channel): void; onToggleSave?(channel: Channel): void }) {
  return <ul className="feature-channels">{channels.map(channel => {
    const saved = savedIds.has(channel.id);
    return <li key={channel.id}><a href={`/channel/${encodeURIComponent(channel.id)}`} onClick={event => localClick(event, () => onChannel(channel))}>
      {safeImage(channel.image_url) ? <img src={channel.image_url} alt="" width={46} height={46} loading="lazy" referrerPolicy="no-referrer" /> : <span className="feature-channel-mark" aria-hidden="true"><IconHash size={23} /></span>}
      <span className="feature-channel__body"><strong>{channel.name || channel.id}</strong><span>/{channel.id}</span>{channel.description && <p>{channel.description}</p>}{typeof channel.member_count === 'number' && <small><IconUsers size={13} aria-hidden="true" />{channel.member_count.toLocaleString()} participants</small>}</span><IconChevronRight size={17} aria-hidden="true" />
    </a>{onToggleSave && <Button variant="ghost" className="feature-channel-save" aria-pressed={saved} aria-label={saved ? `Remove /${channel.id} from saved channels` : `Save /${channel.id} on this browser`} onClick={() => onToggleSave(channel)}><IconBookmark size={17} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" /><span>{saved ? 'Saved' : 'Save'}</span></Button>}</li>;
  })}</ul>;
}

export function ChannelsView({ onChannel, savedChannels = [], onToggleSave }: { onChannel(channel: Channel): void; savedChannels?: readonly Channel[]; onToggleSave?(channel: Channel): void }) {
  const inputId = useId();
  const [kind, setKind] = useState<ChannelKind>('trending');
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [formError, setFormError] = useState('');
  const result = useFeaturePages<Channel>(`${kind}:${query}`, kind !== 'saved', async options => {
    const page = await getChannels({ kind: query ? 'search' : kind === 'trending' ? 'trending' : 'all', ...(query ? { query } : {}), ...options }); return { items: page.channels, next: page.next };
  }, channel => channel.id);
  const savedIds = new Set(savedChannels.map(channel => channel.id));
  const visible = kind === 'saved' ? savedChannels.filter(channel => !query || `${channel.id} ${channel.name} ${channel.description ?? ''}`.toLowerCase().includes(query.toLowerCase())) : result.items;
  function search(event: FormEvent) { event.preventDefault(); const next = draft.trim(); if (next && !validQuery(next)) { setFormError('Enter a channel name of up to 256 bytes, without control characters.'); return; } setFormError(''); setQuery(next); if (next === query && kind !== 'saved') result.refresh(); }
  function changeKind(value: ChannelKind) { setKind(value); setQuery(''); setDraft(''); setFormError(''); }
  return <section className="feature-view" aria-label="Browse channels">
    <div className="feature-intro"><span className="feature-kicker"><IconWorld size={15} aria-hidden="true" />FIND YOUR PEOPLE</span><h2>Small worlds. Open conversations.</h2><p>Explore public channels indexed by Hypersnap, then add your voice.</p></div>
    <form className="feature-search" role="search" onSubmit={search}><label className="visually-hidden" htmlFor={inputId}>Search channels</label><Input id={inputId} type="search" maxLength={256} placeholder="Search channels…" value={draft} onChange={event => setDraft(event.target.value)} aria-describedby={formError ? `${inputId}-error` : undefined} aria-invalid={Boolean(formError)} /><Button type="submit"><IconSearch size={17} aria-hidden="true" />Search</Button></form>
    {formError && <p id={`${inputId}-error`} className="feature-form-error" role="alert">{formError}</p>}
    <nav className="feature-tabs" aria-label="Channel directory"><Button variant="ghost" className={kind === 'trending' && !query ? 'feature-tab--active' : ''} aria-pressed={kind === 'trending' && !query} onClick={() => changeKind('trending')}>Active channels</Button><Button variant="ghost" className={kind === 'all' && !query ? 'feature-tab--active' : ''} aria-pressed={kind === 'all' && !query} onClick={() => changeKind('all')}>All channels</Button>{(onToggleSave || savedChannels.length > 0) && <Button variant="ghost" className={kind === 'saved' ? 'feature-tab--active' : ''} aria-pressed={kind === 'saved'} onClick={() => changeKind('saved')}><IconBookmark size={15} aria-hidden="true" />Saved channels</Button>}{query && <span className="feature-tab-label feature-tab--active">Results for “{query}”</span>}</nav>
    <div aria-busy={kind !== 'saved' && result.busy}>
      {visible.length > 0 && <ChannelRows channels={visible} savedIds={savedIds} onChannel={onChannel} onToggleSave={onToggleSave} />}
      {kind === 'saved' && !visible.length && <div className="feature-empty"><IconBookmark size={32} aria-hidden="true" /><h3>{query ? 'No saved channels match.' : 'Keep your favorite channels nearby.'}</h3><p>{query ? 'Try another name or clear your search.' : 'Save a channel from the directory or its channel page to add a shortcut here.'}</p></div>}
      {kind !== 'saved' && result.loaded && !visible.length && !result.busy && !result.error && <div className="feature-empty"><IconHash size={32} aria-hidden="true" /><h3>{result.more ? 'No named channels on this page.' : 'No channels found.'}</h3><p>{result.more ? 'Load more channels to continue browsing.' : query ? 'Try a shorter channel name or browse all channels.' : 'This Hypersnap node has no channels to show yet.'}</p></div>}
      {kind !== 'saved' && <FeaturePager state={result} moreLabel="Load more channels" />}
    </div>
    <p className="feature-note feature-note--inset">Participant totals count accounts that have posted in a channel.</p>
    {(onToggleSave || savedChannels.length > 0) && <p className="feature-note feature-note--inset">Saved channels are shortcuts on this browser. Saving does not subscribe or enable notifications.</p>}
  </section>;
}

export function ChannelHeader({ channel, onCompose, saved = false, onToggleSave, onPeople }: { channel: Channel; onCompose?(): void; saved?: boolean; onToggleSave?(channel: Channel): void; onPeople?(): void }) {
  return <div className="feature-channel-header">
    <div className="feature-channel-header__identity">{safeImage(channel.image_url) ? <img src={channel.image_url} alt="" width={64} height={64} referrerPolicy="no-referrer" /> : <span className="feature-channel-mark" aria-hidden="true"><IconHash size={30} /></span>}<div><span className="feature-kicker">HYPERSNAP CHANNEL</span><h2>{channel.name || channel.id}</h2><p>/{channel.id}</p></div></div>
    {channel.description && <p className="feature-channel-header__description">{channel.description}</p>}
    <div className="feature-channel-header__footer">{typeof channel.member_count === 'number' && <span><IconUsers size={15} aria-hidden="true" />{channel.member_count.toLocaleString()} participants</span>}{onPeople && <Button variant="secondary" onClick={onPeople}><IconUsers size={16} aria-hidden="true" />View participants</Button>}{onCompose && <Button variant="secondary" onClick={onCompose}><IconMessageCircle size={16} aria-hidden="true" />Cast in this channel</Button>}{onToggleSave && <Button variant="secondary" aria-pressed={saved} onClick={() => onToggleSave(channel)}><IconBookmark size={16} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" />{saved ? 'Saved on this browser' : 'Save channel'}</Button>}</div>
    {onToggleSave && <p className="feature-note">Saved channels are local shortcuts on this browser.</p>}
  </div>;
}

export type ProfileTab = 'casts' | 'replies' | 'media' | 'likes' | 'recasts';
export function ProfileTabs({ fid, tab, onChange, hrefForTab }: { fid: number; tab: ProfileTab; onChange(tab: ProfileTab): void; hrefForTab?(tab: ProfileTab): string }) {
  return <nav className="feature-tabs feature-profile-tabs" aria-label="Profile content">{(['casts', 'replies', 'media', 'likes', 'recasts'] as const).map(value => <a key={value} href={hrefForTab?.(value) ?? `${profilePath(fid)}${value === 'casts' ? '' : `?tab=${value}`}`} aria-current={tab === value ? 'page' : undefined} onClick={event => localClick(event, () => onChange(value))}>{value === 'casts' ? 'Casts' : value === 'replies' ? 'Replies' : value === 'media' ? 'Photos' : value === 'likes' ? 'Likes' : 'Recasts'}</a>)}</nav>;
}
