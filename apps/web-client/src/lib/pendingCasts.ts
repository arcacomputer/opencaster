import type { Cast, User } from '@opencaster/client-core/api';

/** Public draft information only. Kept in memory for this session. */
export interface CastPublication {
  id: string;
  sessionKey: string;
  author: User;
  text: string;
  images: string[];
  parent?: { fid: number; hash: string };
  parentUrl?: string;
  quote?: Cast;
  timestamp: string;
  status: 'publishing' | 'submitted' | 'unknown' | 'failed';
  hash?: string;
}

export type CastPublicationEvent =
  | { type: 'started'; publication: CastPublication }
  | { type: 'submitted'; id: string; hash: string }
  | { type: 'unknown' | 'failed'; id: string };

function canonicalHash(hash: string | undefined): string | undefined {
  return hash && /^(?:0x)?[a-f0-9]{40}$/i.test(hash) ? hash.replace(/^0x/i, '').toLowerCase() : undefined;
}

export function updatePublications(current: CastPublication[], event: CastPublicationEvent): CastPublication[] {
  if (event.type === 'started') {
    if (current.some(publication => publication.id === event.publication.id)) return current;
    return [event.publication, ...current];
  }
  const index = current.findIndex(publication => publication.id === event.id);
  // Late completions must not recreate dismissed cards or overwrite a settled
  // attempt. Publishing again always starts a separate publication identifier.
  if (index === -1 || current[index].status !== 'publishing') return current;
  const next = [...current];
  next[index] = {
    ...current[index],
    status: event.type,
    ...(event.type === 'submitted' ? { hash: canonicalHash(event.hash) ?? event.hash } : {}),
  };
  return next;
}

export function reconcilePublications(current: CastPublication[], observed: Cast[]): CastPublication[] {
  const visible = new Set<string>();
  for (const cast of observed) {
    const hash = canonicalHash(cast.hash);
    if (hash && Number.isSafeInteger(cast.author.fid) && cast.author.fid > 0) visible.add(`${cast.author.fid}:${hash}`);
  }
  const next = current.filter(publication => {
    if (publication.status !== 'submitted' && publication.status !== 'unknown') return true;
    const hash = canonicalHash(publication.hash);
    return !hash || !visible.has(`${publication.author.fid}:${hash}`);
  });
  return next.length === current.length ? current : next;
}
