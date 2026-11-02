import type { Cast, ConversationNode } from '@opencaster/client-core/api';
import { isHiddenTarget, type HiddenContent } from './localContent';

export interface ConversationRow {
  cast: Cast;
  depth: number;
}

export interface ConversationTraversalLimits {
  maxDepth?: number;
  maxVisibleRows?: number;
  maxVisitedNodes?: number;
}

export function visibleConversationRows(
  root: ConversationNode,
  hidden: HiddenContent,
  limits: ConversationTraversalLimits = {},
): ConversationRow[] {
  const maxDepth = limits.maxDepth ?? 5;
  const maxVisibleRows = limits.maxVisibleRows ?? 100;
  const maxVisitedNodes = limits.maxVisitedNodes ?? 1000;
  const rows: ConversationRow[] = [];
  const seen = new Set<string>();
  let visitedNodes = 0;

  const visit = (node: ConversationNode, depth: number) => {
    if (depth > maxDepth || rows.length >= maxVisibleRows || visitedNodes >= maxVisitedNodes) return;
    visitedNodes += 1;
    if (seen.has(node.cast.hash)) return;
    seen.add(node.cast.hash);

    if (!isHiddenTarget(hidden, { fid: node.cast.author.fid, hash: node.cast.hash })) {
      rows.push({ cast: node.cast, depth });
    }

    if (depth >= maxDepth || rows.length >= maxVisibleRows || visitedNodes >= maxVisitedNodes) return;
    for (const reply of node.replies) {
      if (rows.length >= maxVisibleRows || visitedNodes >= maxVisitedNodes) break;
      visit(reply, depth + 1);
    }
  };

  visit(root, 0);
  return rows;
}
