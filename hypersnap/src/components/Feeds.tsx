import { useEffect, useId, useRef, useState } from 'react';
import { IconArrowDown, IconArrowUp, IconCopy, IconEdit, IconPin, IconPinnedOff, IconPlus, IconRss, IconTrash, IconX } from '@tabler/icons-react';
import { getUser, type User } from '../lib/api';
import { parseAccountLookup } from '../lib/accountLookup';
import { encodeFeed, normalizeFeedDefinition, sourceKey, type FeedDefinition, type FeedSource, type SavedFeed } from '../lib/customFeeds';
import { publicUrl } from '../lib/navigation';
import { Button, Input, Modal } from './ui';
import '../feeds.scss';

const WINDOWS = ['1h', '6h', '12h', '24h', '7d'] as const;
const DEFAULT_FEED: FeedDefinition = { version: 1, name: '', sources: [], order: 'source', filters: { includeWords: [], excludeWords: [], hideReplies: false, imagesOnly: false } };
function message(error: unknown) { return error instanceof Error ? error.message.slice(0, 240) : 'This public account could not be loaded. Try again.'; }
function sourceLabel(source: FeedSource) {
  if (source.kind === 'trending') return `Trending · ${source.timeWindow}`;
  if (source.kind === 'channel') return `Channel /${source.channel}`;
  return source.kind === 'following' ? `Following · FID ${source.fid}` : `Casts · FID ${source.fid}`;
}
function phrases(value: string) { return value.split('\n').map(word => word.trim()).filter(Boolean); }
function starter(source: FeedSource, name: string): FeedDefinition { return { ...DEFAULT_FEED, name, sources: [source] }; }

/** Public lookups are explicit and cancelled whenever their input changes. */
function usePublicAccount() {
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function cancel() { controller.current?.abort(); controller.current = null; setBusy(false); setError(''); }
  useEffect(() => () => controller.current?.abort(), []);
  async function resolve(value: string): Promise<User | null> {
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setError(''); setBusy(true);
    try {
      const lookup = parseAccountLookup(value);
      const user = await getUser(lookup, request.signal);
      if (request.signal.aborted || controller.current !== request) return null;
      if (!Number.isSafeInteger(user.fid) || user.fid < 1 || user.fid > 0xffffffff || (lookup.fid !== undefined && user.fid !== lookup.fid)) throw new Error('The node returned a different or invalid FID. Try the account’s exact FID.');
      return user;
    } catch (cause) {
      if (!request.signal.aborted && controller.current === request) setError(message(cause));
      return null;
    } finally { if (controller.current === request && !request.signal.aborted) setBusy(false); }
  }
  return { busy, error, cancel, resolve };
}

export function PublicFollowingPicker({ fid, onOpen }: { fid?: number; onOpen(fid: number): void }) {
  const id = useId(); const [query, setQuery] = useState(''); const lookup = usePublicAccount();
  useEffect(() => { lookup.cancel(); setQuery(''); }, [fid]);
  return <section className="public-following-picker" aria-label="Browse public following feeds">
    <div><strong>Browse anyone’s following feed.</strong><p>Browse an account’s public following feed without connecting a wallet. This uses their public follows, not their personal recommendations.</p></div>
    {fid ? <p className="feeds-note">Viewing the public following feed for FID {fid}.</p> : null}
    <form className="feeds-inline-form" onSubmit={event => { event.preventDefault(); if (!lookup.busy) void lookup.resolve(query).then(user => { if (user) onOpen(user.fid); }); }}>
      <label className="visually-hidden" htmlFor={id}>Account username or FID</label><Input id={id} autoComplete="off" maxLength={128} placeholder="Username or FID" value={query} onChange={event => { lookup.cancel(); setQuery(event.target.value); }} />
      <Button type="submit" variant="secondary" disabled={lookup.busy}>{lookup.busy ? 'Looking up…' : 'Browse following'}</Button>
      {lookup.busy ? <Button variant="ghost" onClick={lookup.cancel}>Cancel</Button> : null}
    </form>
    {lookup.error ? <p className="error" role="alert">{lookup.error}</p> : null}
  </section>;
}

function FeedEditor({ initial = DEFAULT_FEED, existingId, onSave, onClose }: { initial?: FeedDefinition; existingId?: string; onSave(definition: FeedDefinition, existingId?: string): void; onClose(): void }) {
  const id = useId(); const [name, setName] = useState(initial.name); const [sources, setSources] = useState(initial.sources);
  const [kind, setKind] = useState<FeedSource['kind']>('trending'); const [timeWindow, setTimeWindow] = useState<(typeof WINDOWS)[number]>('24h');
  const [target, setTarget] = useState(''); const [order, setOrder] = useState(initial.order);
  const [include, setInclude] = useState(initial.filters.includeWords.join('\n')); const [exclude, setExclude] = useState(initial.filters.excludeWords.join('\n'));
  const [hideReplies, setHideReplies] = useState(initial.filters.hideReplies); const [imagesOnly, setImagesOnly] = useState(initial.filters.imagesOnly);
  const [error, setError] = useState(''); const [status, setStatus] = useState(''); const lookup = usePublicAccount();
  function add(source: FeedSource, identity?: string) {
    if (sources.length >= 8) { setError('A feed can contain up to 8 sources.'); return; }
    if (sources.some(current => sourceKey(current) === sourceKey(source))) { setError('This source is already in your feed.'); return; }
    setSources(current => [...current, source]); setTarget(''); setError(''); setStatus(`${identity ? `${identity} · ` : ''}${sourceLabel(source)} added.`);
  }
  async function addSource() {
    setError(''); setStatus('');
    if (kind === 'trending') { add({ kind, timeWindow }); return; }
    if (kind === 'channel') {
      const channel = target.trim().replace(/^\//, '');
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(channel)) { setError('Enter a channel ID using up to 64 letters, numbers, underscores or hyphens.'); return; }
      add({ kind, channel }); return;
    }
    const sourceKind = kind; const user = await lookup.resolve(target);
    if (user) add({ kind: sourceKind, fid: user.fid }, user.username && !/^fid:/.test(user.username) ? `@${user.username}` : undefined);
  }
  function save() {
    setError('');
    try {
      const definition = normalizeFeedDefinition({ version: 1, name, sources, order, filters: { includeWords: phrases(include), excludeWords: phrases(exclude), hideReplies, imagesOnly } });
      if (!definition) throw new Error('Enter a feed name, 1–8 sources and up to 10 phrases per filter (64 characters each).');
      encodeFeed(definition);
      onSave(definition, existingId); onClose();
    } catch (cause) { setError(message(cause)); }
  }
  function move(index: number, direction: number) { setSources(current => { const next = [...current]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; }); }
  return <Modal title={initial !== DEFAULT_FEED ? 'Customize feed' : 'Create a feed'} onClose={onClose} wide>
    <form className="feed-editor" onSubmit={event => { event.preventDefault(); if (!lookup.busy) save(); }}>
      <p className="feeds-note">Choose public sources and make the timeline yours. Saved feeds and pins stay in this browser; no wallet is needed.</p>
      <label className="feeds-field" htmlFor={`${id}-name`}>Feed name<Input id={`${id}-name`} value={name} onChange={event => setName(event.target.value)} maxLength={64} autoComplete="off" placeholder="My builders, art, daily reading…" required /></label>
      <fieldset className="feed-editor__sources"><legend>Sources <span>{sources.length}/8</span></legend>
        {sources.length ? <ol className="feed-source-list">{sources.map((source, index) => <li key={sourceKey(source)}><span>{sourceLabel(source)}</span><div className="feeds-actions"><Button variant="ghost" aria-label={`Move ${sourceLabel(source)} up`} disabled={index === 0} onClick={() => move(index, -1)}><IconArrowUp size={15} /></Button><Button variant="ghost" aria-label={`Move ${sourceLabel(source)} down`} disabled={index === sources.length - 1} onClick={() => move(index, 1)}><IconArrowDown size={15} /></Button><Button variant="ghost" aria-label={`Remove ${sourceLabel(source)}`} onClick={() => setSources(current => current.filter((_, i) => i !== index))}><IconX size={16} /></Button></div></li>)}</ol> : <p className="feeds-note">Add a source to get started.</p>}
        <div className="feed-editor__source-inputs"><label className="feeds-field" htmlFor={`${id}-kind`}>Source type<select id={`${id}-kind`} value={kind} onChange={event => { lookup.cancel(); setKind(event.target.value as FeedSource['kind']); setTarget(''); setError(''); }}><option value="trending">Trending</option><option value="user">Account’s casts</option><option value="following">Account’s following</option><option value="channel">Channel</option></select></label>
          {kind === 'trending' ? <label className="feeds-field" htmlFor={`${id}-window`}>Time window<select id={`${id}-window`} value={timeWindow} onChange={event => setTimeWindow(event.target.value as (typeof WINDOWS)[number])}>{WINDOWS.map(window => <option key={window} value={window}>{window}</option>)}</select></label> : <label className="feeds-field" htmlFor={`${id}-target`}>{kind === 'channel' ? 'Channel ID' : 'Account username or FID'}<Input id={`${id}-target`} maxLength={128} value={target} autoComplete="off" placeholder={kind === 'channel' ? 'e.g. art' : 'e.g. alice or 123'} onChange={event => { lookup.cancel(); setTarget(event.target.value); }} /></label>}
        </div>
        <div className="feeds-actions"><Button variant="secondary" disabled={lookup.busy || sources.length >= 8} onClick={() => void addSource()}><IconPlus size={15} />{lookup.busy ? 'Looking up account…' : 'Add source'}</Button>{lookup.busy ? <Button variant="ghost" onClick={lookup.cancel}>Cancel lookup</Button> : null}</div>
        {kind === 'following' ? <p className="feeds-note">Uses that account’s public follows, not private preferences.</p> : null}
        {status ? <p className="feeds-note" role="status">{status}</p> : null}{lookup.error ? <p className="error" role="alert">{lookup.error}</p> : null}
      </fieldset>
      <label className="feeds-field" htmlFor={`${id}-order`}>Order<select id={`${id}-order`} value={order} onChange={event => setOrder(event.target.value as FeedDefinition['order'])}><option value="source">Source order</option><option value="newest">Newest loaded first</option></select></label>
      <p className="feeds-note">Source order keeps the node’s ordering. Newest loaded first sorts the casts loaded so far; it cannot guarantee a complete chronological archive.</p>
      <div className="feed-editor__filters"><label className="feeds-field" htmlFor={`${id}-include`}>Include any of these phrases<textarea id={`${id}-include`} value={include} maxLength={2600} rows={2} onChange={event => setInclude(event.target.value)} placeholder={'art\nopen source'} /></label><label className="feeds-field" htmlFor={`${id}-exclude`}>Exclude any of these phrases<textarea id={`${id}-exclude`} value={exclude} maxLength={2600} rows={2} onChange={event => setExclude(event.target.value)} placeholder={'spoilers\ngiveaways'} /></label></div>
      <p className="feeds-note">One literal phrase per line, up to 10 per filter and 64 characters each. Commas stay part of a phrase. Matching ignores case and applies to loaded cast text. Your content settings also apply.</p>
      <div className="feed-editor__checks"><label><input type="checkbox" checked={hideReplies} onChange={event => setHideReplies(event.target.checked)} />Hide replies</label><label><input type="checkbox" checked={imagesOnly} onChange={event => setImagesOnly(event.target.checked)} />Images only</label></div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="feeds-actions feed-editor__footer"><Button type="submit" disabled={lookup.busy}>{existingId ? 'Save changes' : 'Save feed'}</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
    </form>
  </Modal>;
}

export interface FeedsViewProps { feeds: SavedFeed[]; onOpen(definition: FeedDefinition): void; onSave(definition: FeedDefinition, existingId?: string): void; onTogglePin(id: string): void; onDelete(id: string): void; sessionFid?: number }
export function FeedsView({ feeds, onOpen, onSave, onTogglePin, onDelete, sessionFid }: FeedsViewProps) {
  const [editing, setEditing] = useState<SavedFeed | 'new' | null>(null); const [deleting, setDeleting] = useState<string | null>(null); const [error, setError] = useState('');
  const pinned = feeds.filter(feed => feed.pinned); const others = feeds.filter(feed => !feed.pinned);
  function action(callback: () => void) { setError(''); try { callback(); } catch (cause) { setError(message(cause)); } }
  return <div className="feeds-view"><section className="feeds-intro"><span className="feeds-kicker"><IconRss size={17} />YOUR VIEW OF THE CONVERSATION</span><h2>Follow your own curiosity.</h2><p>Mix accounts, channels and public feeds. Choose your filters, save a timeline, and pin the ones you come back to.</p><div className="feeds-actions"><Button onClick={() => setEditing('new')}><IconPlus size={17} />Create feed</Button><span className="feeds-note">No wallet needed.</span></div></section>
    {error ? <p className="error" role="alert">{error}</p> : null}
    <section className="feeds-section" aria-label="Your saved feeds"><div className="feeds-section__head"><h3>Your feeds <span>{feeds.length}</span></h3><span className="feeds-local">ON THIS BROWSER</span></div><p className="feeds-note">Feeds and pins are saved locally and do not sync across devices. Share a feed link to let anyone open or save its public rules.</p>
      {!feeds.length ? <div className="feeds-empty"><IconRss size={27} aria-hidden="true" /><strong>A timeline with your name on it.</strong><p>Add your first feed, then pin it for quick access.</p><Button variant="secondary" onClick={() => setEditing('new')}>Create your first feed</Button></div> : <div className="feed-card-list">{[...pinned, ...others].map(feed => <article className="feed-card" key={feed.id}><div className="feed-card__body"><h4><button type="button" className="feed-card__open" onClick={() => onOpen(feed.definition)}>{feed.definition.name}</button>{feed.pinned ? <IconPin size={15} aria-label="Pinned" /> : null}</h4><p>{feed.definition.sources.map(sourceLabel).join(' · ')}</p><small>{feed.definition.order === 'newest' ? 'Newest loaded first' : 'Source order'}{feed.definition.filters.hideReplies ? ' · Replies hidden' : ''}{feed.definition.filters.imagesOnly ? ' · Images only' : ''}{feed.definition.filters.includeWords.length || feed.definition.filters.excludeWords.length ? ' · Phrase filters' : ''}</small></div><div className="feeds-actions"><Button variant="ghost" aria-label={`${feed.pinned ? 'Unpin' : 'Pin'} ${feed.definition.name}`} onClick={() => action(() => onTogglePin(feed.id))}>{feed.pinned ? <IconPinnedOff size={17} /> : <IconPin size={17} />}</Button><Button variant="ghost" aria-label={`Customize ${feed.definition.name}`} onClick={() => setEditing(feed)}><IconEdit size={17} /></Button><Button variant="ghost" aria-label={`Delete ${feed.definition.name}`} onClick={() => setDeleting(feed.id)}><IconTrash size={17} /></Button></div>
        {deleting === feed.id ? <div className="feed-card__confirm" role="group" aria-label={`Confirm deleting ${feed.definition.name}`}><p>Delete “{feed.definition.name}” from this browser?</p><div className="feeds-actions"><Button variant="secondary" onClick={() => action(() => { onDelete(feed.id); setDeleting(null); })}>Delete feed</Button><Button variant="ghost" onClick={() => setDeleting(null)}>Keep feed</Button></div></div> : null}
      </article>)}</div>}
    </section>
    <section className="feeds-section" aria-label="Explore public feeds"><div className="feeds-section__head"><h3>Start exploring</h3><span className="feeds-local">OPEN TO EVERYONE</span></div><div className="feeds-starters"><article><IconRss size={23} /><h4>Trending now</h4><p>Public conversations getting attention. Choose another time window when you customize.</p><Button variant="secondary" onClick={() => onOpen(starter({ kind: 'trending', timeWindow: '24h' }, 'Trending · 24h'))}>Browse trending</Button></article><article><IconPin size={23} /><h4>Make it personal</h4><p>Combine the accounts and channels you care about, with your own phrase filters.</p><Button variant="secondary" onClick={() => setEditing('new')}>Build a timeline</Button></article></div>{sessionFid ? <Button className="feeds-own-following" variant="secondary" onClick={() => onOpen(starter({ kind: 'following', fid: sessionFid }, `Following · FID ${sessionFid}`))}>Browse my following</Button> : null}<PublicFollowingPicker onOpen={fid => onOpen(starter({ kind: 'following', fid }, `Following · FID ${fid}`))} /></section>
    <p className="feeds-boundary">Public feeds depend on Hypersnap’s available indexes. Filters and ordering work on returned casts, so results can be incomplete.</p>
    {editing ? <FeedEditor initial={editing === 'new' ? undefined : editing.definition} existingId={editing === 'new' ? undefined : editing.id} onClose={() => setEditing(null)} onSave={onSave} /> : null}
  </div>;
}

export function FeedHeader({ definition, saved, onSave, onTogglePin, onNavigate, notify }: { definition: FeedDefinition; saved?: SavedFeed; onSave(definition: FeedDefinition, existingId?: string): void; onTogglePin(id: string): void; onNavigate(path: string): void; notify(message: string): void }) {
  const [editing, setEditing] = useState(false); const [copyFallback, setCopyFallback] = useState(false); const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null); const link = publicUrl(`/feeds/view?feed=${encodeFeed(definition)}`);
  useEffect(() => { if (copyFallback) { input.current?.focus(); input.current?.select(); } }, [copyFallback]);
  useEffect(() => { setCopyFallback(false); setError(''); setEditing(false); }, [link]);
  function action(callback: () => void) { setError(''); try { callback(); } catch (cause) { setError(message(cause)); } }
  async function copy() { try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(link); notify('Feed link copied.'); } catch { setCopyFallback(true); } }
  return <section className="custom-feed-header" aria-label="Timeline settings"><div className="feeds-section__head"><span className="feeds-local">{saved ? 'SAVED IN THIS BROWSER' : 'PUBLIC FEED'}</span><Button variant="ghost" onClick={() => onNavigate('/feeds')}>All feeds</Button></div><h2>{definition.name}</h2><p className="feeds-note">{definition.sources.map(sourceLabel).join(' · ')}</p><p className="feeds-note">{definition.order === 'newest' ? 'Newest loaded first' : 'Source order'}{definition.filters.hideReplies ? ' · Replies hidden' : ''}{definition.filters.imagesOnly ? ' · Images only' : ''}{definition.filters.includeWords.length ? ` · Includes any: ${definition.filters.includeWords.join(', ')}` : ''}{definition.filters.excludeWords.length ? ` · Excludes: ${definition.filters.excludeWords.join(', ')}` : ''}</p><div className="feeds-actions"><Button variant="secondary" onClick={() => setEditing(true)}><IconEdit size={16} />Customize</Button>{saved ? <Button variant="ghost" aria-pressed={saved.pinned} onClick={() => action(() => onTogglePin(saved.id))}>{saved.pinned ? <IconPinnedOff size={16} /> : <IconPin size={16} />}{saved.pinned ? 'Unpin feed' : 'Pin feed'}</Button> : <Button onClick={() => action(() => onSave(definition))}><IconPlus size={16} />Save feed</Button>}<Button variant="ghost" onClick={() => void copy()}><IconCopy size={16} />Copy feed link</Button></div><p className="feeds-note">Anyone can open this link without a wallet. It includes the feed name, public sources and filters. Results depend on the node’s available casts.</p>{copyFallback ? <label className="feeds-field">Feed link<Input ref={input} value={link} readOnly onFocus={event => event.currentTarget.select()} /><span className="feeds-note" role="status">Select the link and use your device’s Copy command.</span></label> : null}{error ? <p className="error" role="alert">{error}</p> : null}
    {editing ? <FeedEditor initial={definition} existingId={saved?.id} onSave={onSave} onClose={() => setEditing(false)} /> : null}
  </section>;
}
