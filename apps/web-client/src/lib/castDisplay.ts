import { renderMentionSegments } from '@opencaster/client-core/content';
import type { Cast } from '@opencaster/client-core/api';

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const short = (value: number = 0) => compactNumber.format(value);
export function relativeTime(timestamp: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
/** Plain-text preview of a cast with mentions rendered as @handles. */
export function castPreviewText(cast: Cast): string {
  return renderMentionSegments(cast).map(segment => segment.kind === 'text' ? segment.text : `@${segment.user.username || segment.user.fid}`).join('') || 'Cast with attachments';
}
