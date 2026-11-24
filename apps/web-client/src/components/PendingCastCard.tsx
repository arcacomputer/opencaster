import type { CastPublication } from '../lib/pendingCasts';
import { Button } from './ui';
import RemoteImage from './RemoteImage';
import '../pending-casts.scss';
import { safeHttpsUrl } from '@opencaster/client-core/safeUrl';

const statusMessages: Record<CastPublication['status'], string> = {
  publishing: 'Publishing…',
  submitted: 'Submitted · waiting to appear',
  unknown: 'Submission status unknown. Check your profile before retrying.',
  failed: 'Not submitted.',
};

export default function PendingCastCard({ publication, onDismiss }: { publication: CastPublication; onDismiss(): void }) {
  const { author, quote } = publication;
  const initials = (author.display_name || author.username || 'O').slice(0, 2).toUpperCase();
  const images = [...new Set(publication.images.map(url => safeHttpsUrl(url)).filter((url): url is string => Boolean(url)))].slice(0, quote ? 1 : 2);
  const timestamp = new Date(publication.timestamp);
  return <article className={`cast pending-cast pending-cast--${publication.status}`} aria-label="Pending cast">
    <span className="avatar" aria-hidden="true"><RemoteImage src={author.pfp_url} alt="" fallback={initials} /></span>
    <div className="cast__body">
      <div className="cast__meta"><strong className="author">{author.display_name || author.username || `FID ${author.fid}`}</strong>{author.username && <span className="pending-cast__handle">@{author.username}</span>}{Number.isFinite(timestamp.getTime()) && <time dateTime={timestamp.toISOString()}>{timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}</div>
      {publication.parent ? <p className="pending-cast__context">Reply to FID {publication.parent.fid}</p> : publication.parentUrl ? <p className="pending-cast__context">Channel cast</p> : null}
      {publication.text && <p className="cast__text">{publication.text}</p>}
      {images.length > 0 && <div className="pending-cast__images">{images.map(url => <RemoteImage key={url} src={url} alt="Image attached to pending cast" loading="lazy" fallback={<span className="muted">Image unavailable</span>} />)}</div>}
      {quote && <div className="quoted-cast pending-cast__quote"><strong>{quote.author.display_name || quote.author.username || `FID ${quote.author.fid}`}</strong><span>{quote.text || 'Cast with attachments'}</span></div>}
      <div className="pending-cast__footer"><p className="pending-cast__status" role="status" aria-live="polite">{statusMessages[publication.status]}</p><Button variant="ghost" className="pending-cast__hide" aria-label="Hide pending cast" disabled={publication.status === 'publishing'} onClick={onDismiss}>Hide</Button></div>
    </div>
  </article>;
}
