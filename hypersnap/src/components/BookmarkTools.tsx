import { useEffect, useId, useState } from 'react';
import { IconBookmark, IconSearch, IconTrash, IconX } from '@tabler/icons-react';
import type { BookmarkSort } from '../lib/bookmarks';
import { Button, Input } from './ui';
import '../bookmarks.scss';

export interface BookmarkToolsProps {
  query: string;
  onQueryChange(query: string): void;
  sort: BookmarkSort;
  onSortChange(sort: BookmarkSort): void;
  count: number;
  total: number;
  onClear(): void;
}
export default function BookmarkTools({ query, onQueryChange, sort, onSortChange, count, total, onClear }: BookmarkToolsProps) {
  const id = useId(); const [confirmationCount, setConfirmationCount] = useState<number | null>(null);
  useEffect(() => { setConfirmationCount(null); }, [total]);
  const confirming = confirmationCount === total && total > 0;
  function search(value: string) { setConfirmationCount(null); onQueryChange(value); }
  return <section className="bookmark-tools" aria-label="Manage local bookmarks">
    <div className="bookmark-tools__intro"><IconBookmark size={19} aria-hidden="true" /><div><strong>Saved for later, on this browser.</strong><p>Search your saved snapshots. Bookmarks stay on this device and are not synced to your account.</p></div></div>
    <form className="bookmark-tools__search" role="search" onSubmit={event => event.preventDefault()}><label className="visually-hidden" htmlFor={id}>Search saved casts</label><IconSearch size={17} aria-hidden="true" /><Input id={id} type="search" value={query} maxLength={256} placeholder="Search text, people or channels…" onChange={event => search(event.target.value)} />{query && <Button variant="ghost" aria-label="Clear bookmark search" onClick={() => search('')}><IconX size={17} /></Button>}</form>
    <div className="bookmark-tools__toolbar"><nav aria-label="Bookmark order"><Button data-analytics="bookmarks-sort" variant="ghost" aria-pressed={sort === 'newest'} onClick={() => { setConfirmationCount(null); onSortChange('newest'); }}>Newest saved</Button><Button data-analytics="bookmarks-sort" variant="ghost" aria-pressed={sort === 'oldest'} onClick={() => { setConfirmationCount(null); onSortChange('oldest'); }}>Oldest saved</Button></nav><span role="status">{query.trim() ? `${count} of ${total} saved` : `${total} saved ${total === 1 ? 'cast' : 'casts'}`}</span><Button variant="ghost" disabled={total === 0} onClick={() => setConfirmationCount(total)}><IconTrash size={15} />Clear bookmarks</Button></div>
    {confirming && <div className="bookmark-tools__confirm" role="group" aria-label="Confirm clearing bookmarks"><p>Clear all {total} saved {total === 1 ? 'bookmark' : 'bookmarks'} from this browser? This removes the local snapshots. Your casts, reactions and uploaded images stay unchanged.</p><Button data-analytics="bookmarks-clear" variant="secondary" onClick={() => { setConfirmationCount(null); onClear(); }}>Clear all {total} {total === 1 ? 'bookmark' : 'bookmarks'}</Button><Button variant="ghost" onClick={() => setConfirmationCount(null)}>Keep bookmarks</Button></div>}
  </section>;
}
