export interface SafeHttpsUrlOptions {
  /** Reject inputs longer than this many UTF-16 code units. */
  readonly maxLength?: number;
  /** Return the input's exact bytes instead of the WHATWG-normalized `href`. */
  readonly preserve?: boolean;
}

/** Returns an HTTPS URL without embedded credentials, or undefined. */
export function safeHttpsUrl(value: unknown, { maxLength, preserve = false }: SafeHttpsUrlOptions = {}): string | undefined {
  if (typeof value !== 'string' || (maxLength !== undefined && value.length > maxLength)) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return preserve ? value : url.href;
  } catch { /* Unparseable URLs are unsafe. */ }
}
