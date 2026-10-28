import { useEffect, useRef } from 'react';
import { Button } from './ui';

type FeedPaginationProps = {
  cursor: string;
  busy: boolean;
  error: string;
  paused: boolean;
  onLoad(): void;
};

export default function FeedPagination({ cursor, busy, error, paused, onLoad }: FeedPaginationProps) {
  const sentinel = useRef<HTMLDivElement>(null);
  const current = useRef({ cursor, busy, error, paused, onLoad });
  current.current = { cursor, busy, error, paused, onLoad };
  const automatic = typeof IntersectionObserver === 'function';

  useEffect(() => {
    const target = sentinel.current;
    if (!automatic || !target || busy || error || paused) return;
    let active = true;
    let requested = false;
    const observer = new IntersectionObserver(entries => {
      const latest = current.current;
      if (!active || requested || latest.cursor !== cursor || latest.busy || latest.error || latest.paused) return;
      if (entries.some(entry => entry.target === target && entry.isIntersecting)) {
        requested = true;
        latest.onLoad();
      }
    }, { rootMargin: '600px 0px' });
    observer.observe(target);
    return () => { active = false; observer.disconnect(); };
    // A new cursor or completed request needs a fresh intersection delivery even
    // when a sparse page leaves the sentinel inside the viewport.
  }, [automatic, cursor, busy, error, paused]);

  return <div className="feed-pagination" aria-busy={busy} hidden={paused}>
    <div className="feed-pagination__sentinel" ref={sentinel} aria-hidden="true" />
    {error ? <><p role="alert">{error}</p><Button variant="secondary" onClick={onLoad} disabled={busy || paused}>Try again</Button></>
      : <><p role="status">{busy ? 'Loading more conversations…' : automatic ? 'Scroll to load more conversations.' : 'More conversations are available.'}</p>
        {!automatic && <Button variant="secondary" onClick={onLoad} disabled={busy || paused}>{busy ? 'Loading…' : 'Load more conversations'}</Button>}</>}
  </div>;
}
