import { useContext, useEffect, useState, type ReactNode } from 'react';
import { IconArrowUpRight } from '@tabler/icons-react';
import { Button } from './ui';
import type { Cast, ConversationNode } from '@opencaster/client-core/api';
import { castPath } from '@opencaster/client-core/navigation';
import { getCastAncestors, parentCastReference, type CastAncestors } from '../lib/castContext';
import { ParentCastRead, type ReplyPresentation } from './CastCard';
import { NavLink } from './NavLink';

/** Upper bound on conversation casts loaded for observation and rendered as replies. */
export const MAX_CONVERSATION_CASTS = 150;
export function conversationCasts(conversation: ConversationNode | null): Cast[] {
  const casts: Cast[] = [];
  const remaining = conversation ? [conversation] : [];
  while (remaining.length && casts.length < MAX_CONVERSATION_CASTS) {
    const node = remaining.shift()!;
    casts.push(node.cast);
    remaining.push(...(node.replies ?? []).slice(0, MAX_CONVERSATION_CASTS - casts.length));
  }
  return casts;
}
export function ConversationReplies({ nodes, parent, renderCard }: { nodes: ConversationNode[]; parent: Cast; renderCard(cast: Cast, parent: Cast): ReactNode }) {
  let remaining = MAX_CONVERSATION_CASTS;
  const render = (items: ConversationNode[], depth: number, parent: Cast): ReactNode => items.slice(0, MAX_CONVERSATION_CASTS).map(node => {
    if (remaining-- <= 0) return null;
    return <section key={node.cast.hash} className="conversation-reply">{renderCard(node.cast, parent)}{depth < 5 && node.replies?.length > 0 && <div className="conversation-children">{render(node.replies, depth + 1, node.cast)}</div>}</section>;
  });
  return <div className="conversation-replies" aria-label="Conversation replies">{render(nodes, 0, parent)}<p className="thread-empty">Open a reply to continue its conversation.</p></div>;
}
export function ConversationContext({ cast, renderCard, onNavigate, onRetry }: { cast: Cast; renderCard(cast: Cast, featured: boolean, context: ReplyPresentation): ReactNode; onNavigate(path: string): void; onRetry(): void }) {
  const readCast = useContext(ParentCastRead);
  const [context, setContext] = useState<CastAncestors | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setContext(null);
    getCastAncestors(cast, controller.signal, { readCast }).then(value => { if (!controller.signal.aborted) setContext(value); }).catch(() => { if (!controller.signal.aborted) setContext({ ancestors: [], status: 'unavailable' }); });
    return () => controller.abort();
  }, [cast, attempt, readCast]);
  const ancestors = context?.ancestors ?? [];
  const earlier = context?.status === 'limited' ? parentCastReference(ancestors[0]) : undefined;
  return <>
    {(cast.parent_hash || ancestors.length > 0) && <section className="conversation-context" aria-label="Earlier casts in this conversation">
      {!context && <p className="conversation-context__notice" role="status">Loading earlier casts…</p>}
      {context?.status === 'unavailable' && <div className="conversation-context__notice"><p>Earlier context is unavailable on this Hypersnap node.</p><Button variant="ghost" onClick={() => { onRetry(); setAttempt(value => value + 1); }}>Retry</Button></div>}
      {earlier && <NavLink className="conversation-context__notice" href={castPath(earlier.hash)} onNavigate={onNavigate}>View earlier casts<IconArrowUpRight size={14} /></NavLink>}
      {ancestors.map((ancestor, index) => <div className="conversation-context__ancestor" key={ancestor.hash}>{renderCard(ancestor, false, { parent: ancestors[index - 1], replyPreview: false })}</div>)}
    </section>}
    {renderCard(cast, true, { parent: ancestors.at(-1), replyPreview: false })}
  </>;
}
