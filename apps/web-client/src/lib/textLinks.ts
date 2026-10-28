export type TextLinkSegment = { text: string; href?: string };

/** Literal web links only. No remote preview fetches or HTML interpretation. */
export function textLinks(text: string): TextLinkSegment[] {
  const segments: TextLinkSegment[] = [];
  let consumed = 0;
  // eslint-disable-next-line no-control-regex -- Control characters must terminate a rendered URL token.
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'“”‘’\u0000-\u001f\u007f]+/gi)) {
    const at = match.index!;
    if (at && /[\p{L}\p{N}_]$/u.test(text.slice(0, at))) continue;
    let value = match[0];
    const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
    const counts: Record<string, number> = { '(': 0, ')': 0, '[': 0, ']': 0, '{': 0, '}': 0 };
    for (const character of value) if (Object.hasOwn(counts, character)) counts[character]++;
    let end = value.length;
    while (end) {
      const close = value[end - 1];
      if ('.,!?:;'.includes(close)) { end--; continue; }
      const open = pairs[close];
      if (!open || counts[close] <= counts[open]) break;
      counts[close]--; end--;
    }
    value = value.slice(0, end);
    let url: URL;
    try { url = new URL(value); } catch { continue; }
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) continue;
    if (at > consumed) segments.push({ text: text.slice(consumed, at) });
    segments.push({ text: value, href: url.href });
    consumed = at + value.length;
  }
  if (consumed < text.length) segments.push({ text: text.slice(consumed) });
  return segments.length ? segments : [{ text }];
}
