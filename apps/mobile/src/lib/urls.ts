import type { Cast } from '@opencaster/client-core/api';

export function safeHttpUrl(value: string): string | null {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function safeHttpsUrl(value: string): string | null {
  const safeUrl = safeHttpUrl(value);
  return safeUrl && new URL(safeUrl).protocol === 'https:' ? safeUrl : null;
}

export function safeMediaEmbedUrls(embeds: Cast['embeds']): string[] {
  return embeds.slice(0, 2).flatMap(embed => {
    if (!('url' in embed)) return [];
    const url = safeHttpsUrl(embed.url);
    return url ? [url] : [];
  });
}

export interface TextPart {
  text: string;
  url?: string;
}

export function splitSafeLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const pattern = /https?:\/\/[^\s<>"']+/gi;
  let offset = 0;

  for (const match of text.matchAll(pattern)) {
    const candidate = match[0];
    let end = candidate.length;
    while (end > 0 && /[.,!?;:)\]}]/.test(candidate[end - 1])) end--;
    const url = safeHttpsUrl(candidate.slice(0, end));
    if (!url) continue;
    const start = match.index ?? 0;
    if (start > offset) parts.push({ text: text.slice(offset, start) });
    parts.push({ text: candidate.slice(0, end), url });
    offset = start + end;
  }

  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts.length ? parts : [{ text }];
}
