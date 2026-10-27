import { useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { IconArrowUpRight, IconAt, IconCheck, IconDeviceFloppy, IconInfoCircle, IconMoodSmile, IconPhoto, IconRefresh, IconTrash, IconX } from '@tabler/icons-react';
import { ApiError, getUser, searchUsers, type Cast, type User } from '../lib/api';
import type { WalletSession } from '../lib/auth';
import { composeCastContent } from '../lib/content';
import { composerDraftScope, inlineMentionQuery, readComposerDraft, removeComposerDraft, saveComposerDraft, type SavedComposerDraft } from '../lib/composerDraft';
import { uploadMedia } from '../lib/media';
import type { CastPublicationEvent } from '../lib/pendingCasts';
import { Button, Input } from './ui';
import '../composer.scss';

export interface ComposerProps { session: WalletSession | null; onSignIn(): void; onPosted?(): void; onPublication?(event: CastPublicationEvent): void; parent?: Cast; parentUrl?: string; quote?: Cast; notify(text: string): void }
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message.slice(0, 240) : 'This action could not be completed.';
function ComposerAvatar({ user }: { user?: User }) {
  const [failed, setFailed] = useState('');
  let url: string | undefined;
  try { const candidate = new URL(user?.pfp_url ?? ''); if (candidate.protocol === 'https:' && !candidate.username && !candidate.password) url = candidate.href; } catch { /* Use initials. */ }
  return <span className="avatar">{url && failed !== url ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(url!)} /> : (user?.display_name || user?.username || 'O').slice(0, 2).toUpperCase()}</span>;
}
const mentionUser = ({ fid, username }: { fid: number; username: string }): User => ({ fid, username, custody_address: '', profile: { bio: { text: '' } }, follower_count: 0, following_count: 0 });
const emojiChoices = [['😀', 'grinning face'], ['😊', 'smiling face'], ['❤️', 'heart'], ['🔥', 'fire'], ['✨', 'sparkles'], ['👍', 'thumbs up'], ['🎉', 'party popper'], ['🌈', 'rainbow'], ['👀', 'eyes'], ['🙏', 'folded hands'], ['💜', 'purple heart'], ['🌐', 'globe']] as const;
type ComposerPanel = 'mentions' | 'emoji' | 'drafts' | 'info';

export default function Composer(props: ComposerProps) {
  const { session, parent, parentUrl, quote } = props;
  let scope = '';
  try { if (session) scope = composerDraftScope(session, { parent: parent ? { fid: parent.author.fid, hash: parent.hash } : undefined, parentUrl, quote: quote ? { fid: quote.author.fid, hash: quote.hash } : undefined }); } catch { /* Editing still works if local draft storage cannot identify this session. */ }
  const context = JSON.stringify([session?.publicKey ?? 'guest', scope || `${parent?.hash ?? ''}:${parentUrl ?? ''}:${quote?.hash ?? ''}`]);
  // Remount before painting a different account/destination, rather than
  // briefly rendering its predecessor's draft until a passive effect runs.
  return <ComposerEditor key={context} {...props} scope={scope} context={context} />;
}
function ComposerEditor({ session, onSignIn, onPosted, onPublication, parent, parentUrl, quote, notify, scope, context }: ComposerProps & { scope: string; context: string }) {
  const attachmentLimit = quote ? 1 : 2;
  const [text, setText] = useState('');
  const [embeds, setEmbeds] = useState<string[]>([]);
  const [mentionedUsers, setMentionedUsers] = useState<User[]>([]);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionCandidate, setMentionCandidate] = useState<User | null>(null);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [draftError, setDraftError] = useState('');
  const [draftStatus, setDraftStatus] = useState('');
  const [savedDraft, setSavedDraft] = useState<SavedComposerDraft | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [caret, setCaret] = useState(0);
  const [suggestions, setSuggestions] = useState<User[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState('');
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [dismissedQuery, setDismissedQuery] = useState('');
  const [panel, setPanel] = useState<ComposerPanel | null>(null);
  const composer = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mentionInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | null>(null);
  const mentionController = useRef<AbortController | null>(null);
  const publishing = useRef(false);
  const uploadingRef = useRef(false);
  const generation = useRef(0);
  const activeContext = useRef(context); activeContext.current = context;
  const listId = useId();
  const panelId = useId();
  const uploadNoticeId = useId();
  const query = session && !busy && !uploading ? inlineMentionQuery(text, caret) : undefined;
  const mentionTerm = query?.query;
  const queryKey = query ? `${query.start}:${query.end}:${query.query}` : '';
  const showSuggestions = Boolean(query && queryKey !== dismissedQuery);

  useEffect(() => {
    generation.current += 1; publishing.current = false; uploadingRef.current = false;
    setText(''); setEmbeds([]); setMentionedUsers([]); setMentionQuery(''); setMentionCandidate(null); setMentionLoading(false); setBusy(false); setUploading(false); setDraftError(''); setDraftStatus(''); setConfirmRestore(false); setCaret(0); setSuggestions([]); setDismissedQuery(''); setPanel(null);
    try { setSavedDraft(scope ? readComposerDraft(scope) ?? null : null); }
    catch (cause) { setSavedDraft(null); setDraftStatus(errorMessage(cause)); }
    return () => { generation.current += 1; uploadController.current?.abort(); mentionController.current?.abort(); };
  }, [context, scope]);
  useLayoutEffect(() => {
    function resize() { const field = textarea.current; if (field) { field.style.height = 'auto'; field.style.height = `${Math.min(288, Math.max(80, field.scrollHeight))}px`; } }
    resize(); window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [text, context]);
  useEffect(() => { if (panel === 'mentions') mentionInput.current?.focus(); }, [panel]);
  useEffect(() => {
    setSuggestions([]); setSuggestionError(''); setSelectedSuggestion(0); setSuggesting(false);
    if (!showSuggestions || mentionTerm === undefined) return;
    const controller = new AbortController(); const capturedContext = context;
    const timer = setTimeout(() => {
      setSuggesting(true);
      searchUsers({ query: mentionTerm, limit: 5, signal: controller.signal }).then(result => {
        if (!controller.signal.aborted && activeContext.current === capturedContext) setSuggestions(result.users.slice(0, 5));
      }).catch(() => { if (!controller.signal.aborted && activeContext.current === capturedContext) setSuggestionError('Suggestions are unavailable. Open the mention tool to look up an exact username or FID.'); })
        .finally(() => { if (!controller.signal.aborted && activeContext.current === capturedContext) setSuggesting(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [showSuggestions, queryKey, mentionTerm, context]);

  let draft = { text, mentions: [] as number[], mentionsPositions: [] as number[] };
  let validationError = '';
  try { draft = composeCastContent(text, mentionedUsers); } catch (cause) { validationError = errorMessage(cause); }
  const bytes = new TextEncoder().encode(draft.text).length;
  const canPublish = Boolean(session && (text.trim() || embeds.length || quote) && bytes <= 1024 && !validationError && !busy && !uploading);
  async function publish() {
    if (!session) { onSignIn(); return; }
    if (!canPublish || publishing.current || uploadingRef.current) return;
    const run = generation.current; const capturedContext = context; const savedRevision = savedDraft?.id;
    publishing.current = true; setBusy(true); setDraftError('');
    mentionController.current?.abort(); setMentionLoading(false); setMentionCandidate(null);
    const publicationId = crypto.randomUUID();
    const reportPublication = (event: CastPublicationEvent) => {
      try { onPublication?.(event); }
      catch { /* Local display callbacks cannot change a network submission's outcome. */ }
    };
    reportPublication({ type: 'started', publication: { id: publicationId, sessionKey: session.publicKey, author: { ...session.user }, text, images: [...embeds], ...(parent ? { parent: { fid: parent.author.fid, hash: parent.hash } } : {}), ...(parentUrl ? { parentUrl } : {}), ...(quote ? { quote } : {}), timestamp: new Date().toISOString(), status: 'publishing' } });
    let submitted = false;
    try {
      const receipt = await session.cast(draft.text, parent ? { fid: parent.author.fid, hash: parent.hash } : undefined, { embeds: [...embeds.map(url => ({ url })), ...(quote ? [{ castId: { fid: quote.author.fid, hash: quote.hash } }] : [])], ...(parentUrl ? { parentUrl } : {}), mentions: draft.mentions, mentionsPositions: draft.mentionsPositions });
      submitted = true;
      reportPublication({ type: 'submitted', id: publicationId, hash: receipt.hash });
      if (scope && savedRevision) { try { removeComposerDraft(scope, savedRevision); } catch { /* A confirmed post must not become an apparent failed write because local storage is unavailable. */ } }
      if (run !== generation.current || activeContext.current !== capturedContext) return;
      setText(''); setEmbeds([]); setMentionedUsers([]); setMentionQuery(''); setMentionCandidate(null); setSavedDraft(null); setDraftStatus(''); setConfirmRestore(false); setCaret(0);
      notify(quote ? 'Quote submitted to Hypersnap. It may take a moment to appear.' : parent ? 'Reply submitted to Hypersnap. It may take a moment to appear.' : 'Cast submitted to Hypersnap. It may take a moment to appear.'); onPosted?.();
    } catch (cause) {
      if (!submitted) reportPublication({ type: cause instanceof ApiError && cause.code === 'submission_unknown' ? 'unknown' : 'failed', id: publicationId });
      if (run === generation.current && activeContext.current === capturedContext) setDraftError(cause instanceof ApiError && cause.code === 'submission_unknown' ? 'Submission status is unknown. Your draft is retained. Check your profile before publishing again to avoid a duplicate cast.' : errorMessage(cause));
    } finally { if (run === generation.current && activeContext.current === capturedContext) { publishing.current = false; setBusy(false); } }
  }
  async function attachImage(file: File | undefined) {
    if (!file || !session || uploadingRef.current || publishing.current || embeds.length >= attachmentLimit) return;
    const run = generation.current; const capturedContext = context;
    const controller = new AbortController(); uploadController.current?.abort(); uploadController.current = controller;
    uploadingRef.current = true; setUploading(true); setUploadName(file.name); setDraftError('');
    try {
      const uploaded = await uploadMedia(file, input => session.authorizeMediaUpload(input), controller.signal);
      if (!controller.signal.aborted && run === generation.current && activeContext.current === capturedContext) setEmbeds(current => [...new Set([...current, uploaded.url])].slice(0, attachmentLimit));
    } catch (cause) { if (!controller.signal.aborted && run === generation.current && activeContext.current === capturedContext) setDraftError(errorMessage(cause)); }
    finally { if (uploadController.current === controller && run === generation.current) { uploadingRef.current = false; setUploading(false); uploadController.current = null; } }
  }
  function pasteImage(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files];
    if (!files.length) for (const item of [...(event.clipboardData.items ?? [])]) { if (item.kind === 'file') { const file = item.getAsFile(); if (file) files.push(file); } }
    if (!files.length) return;
    const images = files.filter(file => file.type.startsWith('image/'));
    if (!images.length) return;
    event.preventDefault();
    if (images.length > 1) { setDraftError('Paste one image at a time so you can review each public upload.'); return; }
    if (embeds.length >= attachmentLimit) { setDraftError(`This ${quote ? 'quote' : 'cast'} already has its maximum number of images.`); return; }
    void attachImage(images[0]);
  }
  async function findMention() {
    if (!mentionQuery.trim() || mentionLoading || busy) return;
    const capturedContext = context; const controller = new AbortController(); mentionController.current?.abort(); mentionController.current = controller;
    setMentionLoading(true); setMentionCandidate(null); setDraftError('');
    const term = mentionQuery.trim().replace(/^@/, '');
    try { const user = await getUser(/^\d+$/.test(term) ? { fid: Number(term) } : { username: term }, controller.signal); if (!controller.signal.aborted && activeContext.current === capturedContext) setMentionCandidate(user); }
    catch (cause) { if (!controller.signal.aborted && activeContext.current === capturedContext) setDraftError(errorMessage(cause)); }
    finally { if (mentionController.current === controller && activeContext.current === capturedContext) setMentionLoading(false); }
  }
  function addMention(user: User, inline = false) {
    if (busy || uploading) return;
    if (mentionedUsers.length >= 10 && !mentionedUsers.some(item => item.fid === user.fid)) { setDraftError('Remove a selected mention before adding another profile. A cast supports up to 10 mentions.'); return; }
    const field = textarea.current; const tokenQuery = inline ? inlineMentionQuery(text, caret) : undefined;
    if (inline && !tokenQuery) return;
    const start = tokenQuery?.start ?? field?.selectionStart ?? text.length; const end = tokenQuery?.end ?? field?.selectionEnd ?? text.length;
    const prefix = start > 0 && !/\s$/.test(text.slice(0, start)) ? ' ' : '';
    const token = `${prefix}@${user.username || user.fid} `;
    setDraftError(''); setText(text.slice(0, start) + token + text.slice(end)); setCaret(start + token.length); setDismissedQuery(queryKey); setSuggestions([]);
    setMentionedUsers(current => [...current.filter(item => item.fid !== user.fid), user]); setMentionCandidate(null); setMentionQuery('');
    if (!inline) setPanel(null);
    requestAnimationFrame(() => { if (activeContext.current === context) { textarea.current?.focus(); textarea.current?.setSelectionRange(start + token.length, start + token.length); } });
  }
  function keyboard(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === 'Enter') { event.preventDefault(); void publish(); return; }
    if (!showSuggestions || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissedQuery(queryKey); return; }
    if (!suggestions.length || event.shiftKey) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelectedSuggestion(value => (value + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length); }
    else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); addMention(suggestions[selectedSuggestion] ?? suggestions[0], true); }
  }
  function saveDraft() {
    if (!scope || busy || uploading) return;
    try { const saved = saveComposerDraft(scope, { text, mentions: mentionedUsers.map(({ fid, username }) => ({ fid, username })), images: embeds }); setSavedDraft(saved); setDraftStatus('Draft saved in this tab for up to 24 hours.'); setConfirmRestore(false); }
    catch (cause) { setDraftStatus(errorMessage(cause)); }
  }
  function restoreDraft(confirm = false) {
    if (!savedDraft || busy || uploading) return;
    if (!confirm && (text || embeds.length || mentionedUsers.length)) { setConfirmRestore(true); return; }
    setText(savedDraft.text); setEmbeds(savedDraft.images.slice(0, attachmentLimit)); setMentionedUsers(savedDraft.mentions.map(mentionUser)); setCaret(savedDraft.text.length); setDraftError(''); setConfirmRestore(false); setDraftStatus('Saved draft restored. Review it before publishing.');
  }
  function discardSavedDraft() {
    if (!scope || busy || uploading) return;
    try { removeComposerDraft(scope, savedDraft?.id); setSavedDraft(null); setConfirmRestore(false); setDraftStatus('Saved draft discarded. Your current text is unchanged. Uploaded images remain public.'); }
    catch (cause) { setDraftStatus(errorMessage(cause)); }
  }
  function togglePanel(value: ComposerPanel) {
    if (!session && value !== 'info') { onSignIn(); return; }
    if (busy || uploading) return;
    if (panel === 'mentions') { mentionController.current?.abort(); setMentionLoading(false); setMentionCandidate(null); }
    setPanel(current => current === value ? null : value);
  }
  function closePanel() {
    if (panel === 'mentions') { mentionController.current?.abort(); setMentionLoading(false); setMentionCandidate(null); }
    setPanel(null);
    composer.current?.querySelector<HTMLButtonElement>(`[data-composer-tool="${panel}"]`)?.focus();
  }
  function insertEmoji(value: string) {
    if (!session || busy || uploading) return;
    const field = textarea.current; const start = field?.selectionStart ?? caret; const end = field?.selectionEnd ?? caret;
    const next = start + value.length;
    setText(text.slice(0, start) + value + text.slice(end)); setCaret(next); setPanel(null); setConfirmRestore(false); setDraftError('');
    requestAnimationFrame(() => { if (activeContext.current === context) { textarea.current?.focus(); textarea.current?.setSelectionRange(next, next); } });
  }
  return <div ref={composer} className="composer" onKeyDown={event => { if (panel && event.key === 'Escape' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); closePanel(); } }}><ComposerAvatar user={session?.user} /><div className="composer__body">
    <p className="composer-context">{parent ? <>Public reply <span>· @{parent.author.username || parent.author.fid}</span></> : parentUrl ? 'Public channel cast' : quote ? 'Public quote' : 'Public cast'}</p>
    <div className="composer-editor"><textarea ref={textarea} aria-label={quote ? 'Write a quote' : parent ? 'Write a reply' : 'Write a cast'} placeholder={quote ? 'Add your thoughts…' : parent ? `Reply to @${parent.author.username}…` : 'What’s on your mind?'} value={text} readOnly={!session} onClick={() => { if (!session) onSignIn(); }} onChange={event => { setText(event.target.value); setCaret(event.target.selectionStart); setConfirmRestore(false); }} onSelect={event => setCaret(event.currentTarget.selectionStart)} onKeyDown={event => {
      if (!session) { if (!event.nativeEvent.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey && (event.key.length === 1 || event.key === 'Enter')) { event.preventDefault(); onSignIn(); } return; }
      keyboard(event);
    }} onPaste={event => { if (!session) { event.preventDefault(); onSignIn(); return; } pasteImage(event); }} disabled={busy} rows={3} aria-describedby={uploadNoticeId} aria-autocomplete="list" aria-controls={showSuggestions ? listId : undefined} aria-expanded={showSuggestions} aria-activedescendant={showSuggestions && suggestions.length ? `${listId}-${selectedSuggestion}` : undefined} />
      {showSuggestions && <div className="composer-suggestions"><span className="composer-suggestions__label">Mention a person</span>{suggesting && <p role="status"><IconRefresh size={14} className="spin" />Finding people…</p>}{suggestionError && <p role="status">{suggestionError}</p>}<ul id={listId} role="listbox" aria-label="Mention suggestions">{suggestions.map((user, index) => <li key={user.fid} role="option" id={`${listId}-${index}`} aria-selected={selectedSuggestion === index}><Button variant="ghost" onMouseDown={event => event.preventDefault()} onClick={() => addMention(user, true)}><strong>{user.display_name || user.username || `FID ${user.fid}`}</strong><span>@{user.username || user.fid}</span></Button></li>)}</ul>{!suggesting && !suggestionError && !suggestions.length && <p>No suggestions yet. Open the mention tool for an exact username or FID.</p>}</div>}
    </div>
      {quote && <div className="quoted-cast quoted-cast--draft"><strong>{quote.author.display_name || quote.author.username || `FID ${quote.author.fid}`}</strong><span>{quote.text || 'Cast with attachments'}</span></div>}
      {embeds.length > 0 && <div className={`composer-media${embeds.length === 1 ? ' composer-media--single' : ''}`}>{embeds.map(url => <div className="composer-attachment" key={url}><img src={url} alt="Image attached to your draft" referrerPolicy="no-referrer" /><Button variant="ghost" aria-label="Remove attached image" title="Remove attached image" disabled={busy || uploading} onClick={() => setEmbeds(current => current.filter(item => item !== url))}><IconX size={16} /></Button></div>)}</div>}
      {mentionedUsers.length > 0 && <div className="composer-selected-mentions" aria-label="Selected mentions">{mentionedUsers.map(user => <Button key={user.fid} variant="ghost" disabled={busy} aria-label={`Remove mention selection for ${user.username || user.fid}`} onClick={() => { setMentionedUsers(current => current.filter(item => item.fid !== user.fid)); setDraftError(''); }}>@{user.username || user.fid}<IconX size={13} /></Button>)}<small>Removing a selection leaves its text in your draft.</small></div>}
      {(draftError || validationError) && <p className="error" role="alert">{draftError || validationError}</p>}
    <input ref={fileInput} className="pairing-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Attach an image" aria-describedby={uploadNoticeId} tabIndex={-1} disabled={!session || busy || uploading || embeds.length >= attachmentLimit} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void attachImage(file); }} />
    <div className="composer__footer"><div className="composer-tools" role="group" aria-label="Composer tools">
      <Button data-analytics="composer-image" variant="ghost" className="composer-tool" aria-label="Add image" aria-describedby={uploadNoticeId} title="Add photo or GIF" disabled={Boolean(session) && (busy || uploading || embeds.length >= attachmentLimit)} onClick={() => session ? fileInput.current?.click() : onSignIn()}><IconPhoto size={20} /><span className="visually-hidden">Add image</span></Button>
      <Button variant="ghost" className="composer-tool" data-analytics="composer-mentions" data-composer-tool="mentions" aria-label="Mention a person" title="Mention a person" aria-expanded={panel === 'mentions'} aria-controls={panel === 'mentions' ? panelId : undefined} disabled={busy || uploading} onClick={() => togglePanel('mentions')}><IconAt size={20} /></Button>
      <Button variant="ghost" className="composer-tool" data-analytics="composer-emoji" data-composer-tool="emoji" aria-label="Insert emoji" title="Insert emoji" aria-expanded={panel === 'emoji'} aria-controls={panel === 'emoji' ? panelId : undefined} disabled={busy || uploading} onClick={() => togglePanel('emoji')}><IconMoodSmile size={20} /></Button>
      <Button variant="ghost" className="composer-tool composer-tool--drafts" data-analytics="composer-drafts" data-composer-tool="drafts" aria-label="Drafts" title={savedDraft ? 'Drafts: saved draft available' : 'Drafts'} aria-expanded={panel === 'drafts'} aria-controls={panel === 'drafts' ? panelId : undefined} disabled={busy || uploading} onClick={() => togglePanel('drafts')}><IconDeviceFloppy size={18} /><span>Drafts</span>{savedDraft && <span className="composer-draft-badge" aria-label="Saved draft available">1</span>}</Button>
    </div><div className="composer__submit">{session && <span className={`composer-size${bytes > 1024 ? ' error' : ''}`} aria-label={`${bytes} of 1024 UTF-8 bytes`} title="Up to 1024 UTF-8 bytes per cast"><progress value={Math.min(bytes, 1024)} max={1024} aria-label="Cast size" /><span>{bytes}/1024</span></span>}<Button data-analytics={quote ? 'publish-quote' : parent ? 'publish-reply' : 'publish-cast'} disabled={Boolean(session) && !canPublish} onClick={() => void publish()}>{busy ? 'Publishing…' : quote ? 'Quote' : parent ? 'Reply' : 'Cast'}<IconArrowUpRight size={16} /></Button></div></div>
    {uploading && <div className="composer-upload" role="status"><span><IconRefresh size={15} className="spin" />Uploading {uploadName}…</span><Button variant="ghost" onClick={() => { uploadController.current?.abort(); uploadingRef.current = false; setUploading(false); }}>Cancel upload</Button></div>}
    {embeds.length > 0 && <p className="composer-attachment-count">{embeds.length}/{attachmentLimit} images{quote && ' · 1 quoted cast'}</p>}
    {panel && <section id={panelId} className="composer-panel" aria-label={panel === 'mentions' ? 'Find a mention' : panel === 'emoji' ? 'Emoji' : panel === 'drafts' ? 'Drafts on this tab' : 'Media info'}>
      <div className="composer-panel__heading"><strong>{panel === 'mentions' ? 'Mention a person' : panel === 'emoji' ? 'Add an emoji' : panel === 'drafts' ? 'Drafts on this tab' : 'Media info'}</strong><Button variant="ghost" aria-label="Close composer tool" title="Close composer tool" onClick={closePanel}><IconX size={16} /></Button></div>
      {panel === 'mentions' && <><p>Type @ in your cast for suggestions, or find an exact username or FID.</p><div className="composer-mentions"><Input ref={mentionInput} aria-label="Mention a username or FID" placeholder="Exact username or FID" value={mentionQuery} onChange={event => { setMentionQuery(event.target.value); setMentionCandidate(null); }} disabled={busy || mentionLoading} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void findMention(); } }} /><Button variant="secondary" disabled={busy || mentionLoading || !mentionQuery.trim()} onClick={() => void findMention()}>{mentionLoading ? 'Finding…' : 'Find mention'}</Button>{mentionCandidate && <Button variant="secondary" disabled={busy || uploading} onClick={() => addMention(mentionCandidate)}>Add @{mentionCandidate.username || mentionCandidate.fid}</Button>}</div></>}
      {panel === 'emoji' && <div className="composer-emoji" role="group" aria-label="Emoji choices">{emojiChoices.map(([value, label]) => <Button key={label} variant="ghost" aria-label={`Insert ${label}`} title={label} disabled={busy || uploading} onClick={() => insertEmoji(value)}>{value}</Button>)}</div>}
      {panel === 'drafts' && <><p>Saved only in this browser tab for up to 24 hours. Drafts are readable on this device, are not synced, and contain no wallet or signing keys.</p><div className="composer-draft-tools"><Button data-analytics="draft-save" variant="ghost" disabled={!scope || busy || uploading || (!text && !embeds.length && !mentionedUsers.length)} onClick={saveDraft}><IconDeviceFloppy size={15} />Save draft</Button>{savedDraft && <><Button data-analytics="draft-restore" variant="ghost" disabled={busy || uploading} onClick={() => restoreDraft()}><IconCheck size={15} />Restore saved draft</Button><Button data-analytics="draft-discard" variant="ghost" disabled={busy || uploading} onClick={discardSavedDraft}><IconTrash size={15} />Discard saved draft</Button></>}</div>{confirmRestore && <div className="composer-restore-confirm" role="status"><span>Replace your current text and attachments with the saved draft?</span><Button variant="secondary" onClick={() => restoreDraft(true)}>Replace current draft</Button><Button variant="ghost" onClick={() => setConfirmRestore(false)}>Keep editing</Button></div>}</>}
      {panel === 'info' && <><p>Upload a JPEG, PNG, WebP or GIF up to 5 MiB, or paste one image at a time. A {quote ? 'quote supports one image alongside its quoted cast' : 'cast supports up to two images'}.</p><p>Uploaded images remain public even if you remove an attachment or discard the draft. Photo metadata is retained.</p><p>Type @ to mention a person. Ctrl / ⌘ + Enter publishes your cast.</p></>}
    </section>}
    {draftStatus && <p className="composer-draft-note" role="status">{draftStatus}</p>}
    <div className="composer-media-note"><p id={uploadNoticeId}>Uploads are public immediately; photo metadata is kept.</p><Button variant="ghost" data-analytics="composer-info" data-composer-tool="info" aria-label="Media info" title="Media info and composer help" aria-expanded={panel === 'info'} aria-controls={panel === 'info' ? panelId : undefined} disabled={busy || uploading} onClick={() => togglePanel('info')}><IconInfoCircle size={15} /><span>Media info</span></Button></div>
  </div></div>;
}
