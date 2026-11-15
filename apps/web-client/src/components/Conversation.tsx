import { useContext, useEffect, useState, type ReactNode } from 'react';
import { IconArrowUpRight } from '@tabler/icons-react';
import { Button } from './ui';
import type { Cast, ConversationNode } from '@opencaster/client-core/api';
import { castPath } from '@opencaster/client-core/navigation';
import { getCastAncestors, parentCastReference, type CastAncestors } from '../lib/castContext';
import { ParentCastRead, type ReplyPresentation } from './CastCard';
import { NavLink } from './NavLink';
import { canonicalReplyHash, getReplyRanking, rankReplySiblings, type ReplyRanking } from '@opencaster/client-core/replyRanking';

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
  const [order, setOrder] = useState<'ranked' | 'node'>('ranked');
  const [ranking, setRanking] = useState<{ hash: string; value: ReplyRanking } | null>(null);
  const visible = visibleConversationReplies(nodes);
  // Hashes, not score updates or incidental card rerenders, identify this read.
  const fingerprint = replyFingerprint(visible);
  useEffect(() => {
    if (order === 'node') return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const poll = async () => {
      try {
        const value = await getReplyRanking(parent.hash, AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]));
        if (controller.signal.aborted) return;
        setRanking({ hash: parent.hash, value });
        if (value.status === 'pending' && ++attempts < 60) timer = setTimeout(poll, 10000);
      } catch { /* Fail open: keep every reply in node order; no retry storm. */ }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [parent.hash, fingerprint, order]);
  const suspected = new Set(order === 'ranked' && ranking?.hash === parent.hash ? ranking.value.suspected.map(canonicalReplyHash) : []);
  // Apply the existing render limits BEFORE ranking, so reordering cannot
  // displace a visible reply beyond the cap or bring a different subtree in.
  let remaining = MAX_CONVERSATION_CASTS;
  const render = (items: ConversationNode[], depth: number, parent: Cast): ReactNode => rankReplySiblings(items, suspected).map(node => {
    if (remaining-- <= 0) return null;
    return <section key={node.cast.hash} className="conversation-reply">{renderCard(node.cast, parent)}{depth < 5 && node.replies?.length > 0 && <div className="conversation-children">{render(node.replies, depth + 1, node.cast)}</div>}</section>;
  });
  return <div className="conversation-replies" aria-label="Conversation replies">
    <div className="conversation-order"><label>Reply order <select value={order} onChange={event => setOrder(event.target.value as 'ranked' | 'node')}><option value="ranked">Less spam first</option><option value="node">Node order</option></select></label>
      <p>{order === 'node' ? 'Replies appear in the order supplied by the node.' : 'Suspected spam moves lower. Every reply stays available.'}</p>
    </div>
    {render(visible, 0, parent)}<p className="thread-empty">Open a reply to continue its conversation.</p></div>;
}

function replyFingerprint(nodes: ConversationNode[]): string {
  return nodes.map(node => `${node.cast.hash}[${replyFingerprint(node.replies)}]`).join(',');
}

export function visibleConversationReplies(nodes: ConversationNode[]): ConversationNode[] {
  let remaining = MAX_CONVERSATION_CASTS;
  const visit = (items: ConversationNode[], depth: number): ConversationNode[] => items.slice(0, MAX_CONVERSATION_CASTS).flatMap(node => {
    if (remaining-- <= 0) return [];
    return [{ ...node, replies: depth < 5 ? visit(node.replies ?? [], depth + 1) : [] }];
  });
  return visit(nodes, 0);
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
