import { createContext, memo, useContext, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { IconArrowUpRight, IconBookmark, IconDots, IconHeart, IconMessageCircle, IconRepeat, IconShare, IconTrash } from '@tabler/icons-react';
import { Button } from './ui';
import { getCast, hasImageEmbed, type Cast, type User } from '@opencaster/client-core/api';
import { castPath, castPermalink, profilePath } from '@opencaster/client-core/navigation';
import { renderMentionSegments } from '@opencaster/client-core/content';
import type { WalletSession } from '../lib/auth';
import CastReactions from './CastReactions';
import type { CastImage } from './MediaViewer';
import LinkEmbed from './LinkEmbed';
import { localClick, NavLink } from './NavLink';
import { bookmarkHash } from '../lib/bookmarks';
import { emptyContentPreferences, getContentFilterReason, type ContentPreferences } from '../lib/contentPreferences';
import { matchesParentCast, parentCastReference } from '../lib/castContext';
import { textLinks } from '../lib/textLinks';
import { quorumSocialPath } from '../lib/socialLinks';
import { castPreviewText, relativeTime, safeUrl, short } from '../lib/castDisplay';

export const ContentControls = createContext<{ preferences: ContentPreferences; revealed: ReadonlySet<string>; reveal(hash: string): void }>({ preferences: emptyContentPreferences(), revealed: new Set(), reveal() {} });
export const ParentCastRead = createContext<typeof getCast>(getCast);
export type ReplyPresentation = { parent?: Cast; replyPreview?: boolean };
export function Avatar({ user, large = false }: { user?: User; large?: boolean }) {
  const [failedUrl, setFailedUrl] = useState('');
  const url = safeUrl(user?.pfp_url);
  return <span className={`avatar ${large ? 'avatar--large' : ''}`}>{url && failedUrl !== url ? <img src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} /> : (user?.display_name || user?.username || 'O').slice(0, 2).toUpperCase()}</span>;
}
export function LinkedText({ text, onNavigate }: { text: string; onNavigate(path: string): void }) {
  const parts = useMemo(() => textLinks(text), [text]);
  return <>{parts.map((part, i) => {
    if (!part.href) return part.text;
    // Classify the original token before URL normalization can hide escapes,
    // backslashes, or dot segments that should remain external links.
    const localPath = quorumSocialPath(part.text);
    const label = part.text.length > 65 ? `${part.text.slice(0, 62)}…` : part.text;
    return localPath ? <NavLink key={i} href={localPath} title={`Open on Opencaster. Original link: ${part.text}`} onNavigate={onNavigate}>{label}</NavLink>
      : <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">{label}</a>;
  })}</>;
}
function CastText({ cast, onProfile, onNavigate }: { cast: Cast; onProfile(user: User): void; onNavigate(path: string): void }) {
  const attachmentUrls = useMemo(() => cast.embeds?.filter((embed): embed is { url: string } => 'url' in embed && !!safeUrl(embed.url)).slice(0, 2).map(embed => safeUrl(embed.url)) ?? [], [cast.embeds]);
  const { text, mentioned_profiles: mentionedProfiles, mentioned_profiles_ranges: mentionedRanges } = cast;
  const segments = useMemo(() => renderMentionSegments({ text, mentioned_profiles: mentionedProfiles, mentioned_profiles_ranges: mentionedRanges }), [text, mentionedProfiles, mentionedRanges]);
  const hiddenLines = useMemo(() => new Set(segments.map(segment => segment.kind === 'text' ? segment.text : '\ufffc').join('').split('\n').flatMap((line, index) => {
    const url = safeUrl(line.trim());
    return url && attachmentUrls.includes(url) ? [index] : [];
  })), [segments, attachmentUrls]);
  let lineIndex = 0;
  return <>{segments.map((segment, index) => {
    if (segment.kind !== 'text') return <a data-analytics="profile-open" className="cast-mention" key={index} href={profilePath(segment.user.fid)} onClick={event => localClick(event, () => onProfile(segment.user))}>@{segment.user.username || segment.user.fid}</a>;
    // Remove only standalone attachment lines, after resolving protocol mention
    // positions. Inline authored links and the original cast text stay intact.
    let text = segment.text.split('\n').map((line, part, lines) => {
      const hidden = hiddenLines.has(lineIndex);
      if (part === lines.length - 1) return hidden ? '' : line;
      lineIndex += 1;
      return hidden ? '' : `${line}\n`;
    }).join('');
    if (hiddenLines.size && index === 0) text = text.trimStart();
    if (hiddenLines.size && index === segments.length - 1) text = text.trimEnd();
    return <LinkedText key={index} text={text} onNavigate={onNavigate} />;
  })}</>;
}
function ReplyContext({ cast, parent, preview = true, getCastPath, onProfile, onNavigate, onThread, onCastHash }: { cast: Cast; parent?: Cast; preview?: boolean; getCastPath(cast: Cast): string; onProfile(user: User): void; onNavigate(path: string): void; onThread(cast: Cast): void; onCastHash(hash: string): void }) {
  const controls = useContext(ContentControls);
  const readCast = useContext(ParentCastRead);
  const reference = parentCastReference(cast);
  const hash = reference?.hash;
  const fid = reference?.fid;
  const known = parent && matchesParentCast(cast, parent) ? parent : undefined;
  const [loaded, setLoaded] = useState<Cast | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setLoaded(null); setUnavailable(false);
    if (hash && preview && !known) readCast(hash, controller.signal).then(value => {
      if (!controller.signal.aborted) {
        if (bookmarkHash(value?.hash) === bookmarkHash(hash) && Number.isSafeInteger(value?.author?.fid) && value.author.fid > 0 && (fid === undefined || value.author.fid === fid) && typeof value.text === 'string') setLoaded(value);
        else setUnavailable(true);
      }
    }).catch(() => { if (!controller.signal.aborted) setUnavailable(true); });
    return () => controller.abort();
  }, [hash, fid, preview, known, readCast]);
  if (!reference) return null;
  const resolved = known ?? (loaded && matchesParentCast(cast, loaded) ? loaded : undefined);
  const reason = resolved && !controls.revealed.has(bookmarkHash(resolved.hash)!) ? getContentFilterReason(resolved, controls.preferences) : undefined;
  if (reason) return <div className="cast-reply-context cast-reply-context--filtered"><p>Parent cast filtered: {reason}</p><Button variant="ghost" onClick={() => controls.reveal(resolved!.hash)}>Show parent for this view</Button></div>;
  const recipient = resolved?.author;
  const label = recipient?.username ? `@${recipient.username}` : recipient?.display_name || (recipient || fid ? `FID ${recipient?.fid ?? fid}` : 'a cast');
  const path = resolved ? getCastPath(resolved) : castPath(reference.hash);
  return <div className="cast-reply-context">
    <div className="cast-reply-context__label"><IconMessageCircle size={13} aria-hidden="true" /><span>Replying to {recipient ? <a data-analytics="profile-open" href={profilePath(recipient.fid)} onClick={event => localClick(event, () => onProfile(recipient))}>{label}</a> : fid ? <NavLink data-analytics="profile-open" href={profilePath(fid)} onNavigate={onNavigate}>{label}</NavLink> : <a href={path} onClick={event => localClick(event, () => onCastHash(reference.hash))}>{label}</a>}</span></div>
    {preview && <a data-analytics="cast-parent-open" className="cast-reply-context__preview" href={path} onClick={event => localClick(event, () => resolved ? onThread(resolved) : onCastHash(reference.hash))}>{resolved ? castPreviewText(resolved) : unavailable ? 'Parent cast unavailable on this node · View parent cast' : 'Loading parent cast…'}</a>}
    {!preview && !resolved && <a data-analytics="cast-parent-open" className="cast-reply-context__open" href={path} onClick={event => localClick(event, () => onCastHash(reference.hash))}>View parent cast<IconArrowUpRight size={13} /></a>}
  </div>;
}
function QuotedCast({ target, onThread, getCastPath }: { getCastPath(cast: Cast): string; target: { fid: number; hash: string }; onThread(cast: Cast): void }) {
  const readParentCast = useContext(ParentCastRead);
  const controls = useContext(ContentControls);
  const [cast, setCast] = useState<Cast | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setCast(null); setUnavailable(false);
    readParentCast(target.hash, controller.signal).then(value => {
      if (!controller.signal.aborted) { if (value.author.fid === target.fid) setCast(value); else setUnavailable(true); }
    }).catch(() => { if (!controller.signal.aborted) setUnavailable(true); });
    return () => controller.abort();
  }, [readParentCast, target.hash, target.fid]);
  const reason = cast && !controls.revealed.has(bookmarkHash(cast.hash)!) ? getContentFilterReason(cast, controls.preferences) : undefined;
  if (reason) return <div className="filtered-cast"><p>Quoted cast filtered: {reason}</p><Button variant="ghost" onClick={() => controls.reveal(cast!.hash)}>Show this quote for this view</Button></div>;
  const quoteImages = cast?.embeds.filter((embed): embed is { url: string } => 'url' in embed && !!safeUrl(embed.url) && hasImageEmbed({ ...cast, embeds: [embed] })).slice(0, 2) ?? [];
  return <a data-analytics="cast-open" className="quoted-cast" href={cast ? getCastPath(cast) : castPath(target.hash)} onClick={event => { if (cast) localClick(event, () => onThread(cast)); }}>
      {cast ? <><span className="quoted-cast__author"><Avatar user={cast.author} /><strong>{cast.author.username || cast.author.display_name || `FID ${target.fid}`}</strong><time dateTime={cast.timestamp}>{relativeTime(cast.timestamp)}</time></span><span className="quoted-cast__text">{castPreviewText(cast)}</span>{quoteImages.length > 0 && <span className="quoted-cast__images">{quoteImages.map(embed => <img key={embed.url} src={embed.url} alt="Image attached to quoted cast" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />)}</span>}</> : <span>{unavailable ? 'Quoted cast unavailable or deleted' : 'Loading quoted cast…'}</span>}
  </a>;
}
export const CastCard = memo(function CastCard({ cast, dark, featured = false, fullHashLinks = false, parent, replyPreview = true, getCastPath, onProfile, onNavigate, onThread, onShare, onQuote, onDelete, reactionActor, onCastHash, onImages, onOptions, session, onSignIn, saved, onSave, notify }: { cast: Cast; dark: boolean; featured?: boolean; fullHashLinks?: boolean; getCastPath(cast: Cast): string; onProfile(user: User): void; onNavigate(path: string): void; onThread(cast: Cast): void; onShare(cast: Cast): void; onQuote(cast: Cast): void; onDelete(cast: Cast): void; reactionActor?: User; onCastHash(hash: string): void; onImages(images: CastImage[], initialIndex: number): void; onOptions(cast: Cast): void; session: WalletSession | null; onSignIn(): void; saved: boolean; onSave(cast: Cast): void; notify(text: string): void } & ReplyPresentation) {
  const urls = useMemo(() => cast.embeds?.filter((embed): embed is { url: string } => 'url' in embed && !!safeUrl(embed.url)).slice(0, 2) ?? [], [cast.embeds]);
  const isImage = (url: string) => hasImageEmbed({ ...cast, embeds: [{ url }] });
  const images = useMemo(() => urls.filter(embed => isImage(embed.url)).map((embed, index) => ({ url: embed.url, alt: `Image ${index + 1} attached to cast by @${cast.author.username || cast.author.fid}` })), [urls, cast]);
  const [expanded, setExpanded] = useState(false);
  const collapsed = !featured && !expanded && ((cast.text?.length ?? 0) > 420 || (cast.text?.split('\n').length ?? 0) > 9);
  function openFromCard(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if ((event.target as Element).closest('a, button, input, textarea, select, label, video, audio, dialog')) return;
    if (window.getSelection?.()?.toString()) return;
    onThread(cast);
  }
  return <article className={`cast ${featured ? 'cast--featured' : 'cast--openable'}`} onClick={featured ? undefined : openFromCard}>
    <div className="cast__header">
    <a data-analytics="profile-open" className="button button--ghost avatar-button" href={profilePath(cast.author.fid)} aria-label={`View ${cast.author.username}'s profile`} onClick={event => localClick(event, () => onProfile(cast.author))}><Avatar user={cast.author} /></a>
    <div className="cast__meta"><a data-analytics="profile-open" className="button button--ghost author" href={profilePath(cast.author.fid)} title={cast.author.display_name} onClick={event => localClick(event, () => onProfile(cast.author))}>{cast.author.username || cast.author.display_name || `FID ${cast.author.fid}`}</a><a data-analytics="cast-open" className="cast-permalink" href={fullHashLinks ? castPermalink(cast, { fullHash: true }) : getCastPath(cast)} aria-label="Open cast" onClick={event => localClick(event, () => onThread(cast))}><time dateTime={cast.timestamp} title={new Date(cast.timestamp).toLocaleString()}>{relativeTime(cast.timestamp)}</time></a>{cast.channel && <span className="channel-tag">/{cast.channel.id}</span>}</div>
    <Button data-analytics="cast-options-open" variant="ghost" className="cast__options" aria-label="More cast options" onClick={() => onOptions(cast)}><IconDots size={20} /></Button>
    </div>
    <div className="cast__body">
      {cast.reaction_context && <div className="cast-activity">{cast.reaction_context.type === 'like' ? <IconHeart size={14} aria-hidden="true" /> : <IconRepeat size={14} aria-hidden="true" />}<a data-analytics="profile-open" href={profilePath(cast.reaction_context.fid)} onClick={event => { if (reactionActor) localClick(event, () => onProfile(reactionActor)); }}>{reactionActor?.display_name || reactionActor?.username || `FID ${cast.reaction_context.fid}`}</a>{cast.reaction_context.type === 'like' ? 'liked' : 'recasted'}<time dateTime={cast.reaction_context.timestamp} title={new Date(cast.reaction_context.timestamp).toLocaleString()}>{relativeTime(cast.reaction_context.timestamp)}</time></div>}
      <ReplyContext cast={cast} parent={parent} preview={replyPreview} getCastPath={getCastPath} onProfile={onProfile} onNavigate={onNavigate} onThread={onThread} onCastHash={onCastHash} />
      <p className={`cast__text ${collapsed ? 'cast__text--clamp' : ''}`}><CastText cast={cast} onProfile={onProfile} onNavigate={onNavigate} /></p>
      {collapsed && <Button variant="ghost" className="cast__more" onClick={() => setExpanded(true)}>Show more</Button>}
      {urls.length > 0 && <div className={`cast__attachments ${urls.length > 1 ? 'cast__attachments--multiple' : ''}`} aria-label="Cast attachments">{[...urls].sort((a, b) => Number(isImage(b.url)) - Number(isImage(a.url))).map(embed => isImage(embed.url) ? <a href={embed.url} key={embed.url} target="_blank" rel="noopener noreferrer" data-analytics="cast-image-open" className="embed" aria-label="View attached image" onClick={event => localClick(event, () => onImages(images, images.findIndex(image => image.url === embed.url)))}><img src={embed.url} loading="lazy" decoding="async" alt="Image attached to cast" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} /></a> : <LinkEmbed key={embed.url} url={embed.url} dark={dark} onNavigate={onNavigate} />)}</div>}
      {cast.embeds?.filter((embed): embed is { cast_id: { fid: number; hash: string } } => 'cast_id' in embed && !!embed.cast_id && Number.isSafeInteger(embed.cast_id.fid) && embed.cast_id.fid > 0 && /^(?:0x)?[a-fA-F0-9]{40}$/.test(embed.cast_id.hash)).slice(0, 2).map(embed => <QuotedCast key={embed.cast_id.hash} target={embed.cast_id} onThread={onThread} getCastPath={getCastPath} />)}
      <div className="cast__actions">
        <Button data-analytics="cast-replies-open" variant="ghost" aria-label="Open replies" onClick={() => onThread(cast)}><IconMessageCircle size={18} /><span>{short(cast.replies?.count)}</span></Button>
        <CastReactions key={`${cast.hash}:${session?.publicKey ?? 'guest'}`} cast={cast} session={session} onSignIn={onSignIn} notify={notify} onQuote={() => onQuote(cast)} />
        <Button data-analytics={saved ? 'bookmark-remove' : 'bookmark-add'} variant="ghost" aria-label={saved ? 'Remove bookmark' : 'Bookmark cast'} aria-pressed={saved} className={saved ? 'is-saved' : ''} onClick={() => onSave(cast)}><IconBookmark size={18} fill={saved ? 'currentColor' : 'none'} /></Button>
        {session?.fid === cast.author.fid && <Button data-analytics="cast-delete-open" variant="ghost" aria-label="Delete cast" onClick={() => onDelete(cast)}><IconTrash size={18} /></Button>}
        <Button data-analytics="cast-share-open" variant="ghost" aria-label="Share cast" onClick={() => onShare(cast)}><IconShare size={18} /></Button>
      </div>
    </div>
  </article>;
});
