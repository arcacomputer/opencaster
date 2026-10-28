import { castAliasPath, castPath, parseRoute, routePath } from '@opencaster/client-core/navigation';

// Platform-independent migration candidate for a future shared Hypersnap client.
const SOURCE_AUTHORITY = /^(?:www\.)?(?:farcaster\.xyz|warpcast\.com)(?::443)?$/i;
const CLIENT_AUTHORITY = /^(?:opencaster\.org|quorum\.arca\.computer)(?::443)?$/i;
const RAW_HTTPS_URL = /^https:\/\/([^/?#]+)(\/[^?#]*)?(?:\?([^#]*))?(?:#.*)?$/i;

/** Recognize public social links without resolving or normalizing their URL.
 * Call with the original text: URL constructors can erase hostile dot segments.
 * Unsupported links retain their existing external behavior at the call site.
 */
export function quorumSocialPath(value: string): string | undefined {
  if (/[\s\p{Cc}\\]/u.test(value)) return;
  const source = RAW_HTTPS_URL.exec(value);
  if (!source || (!SOURCE_AUTHORITY.test(source[1]) && !CLIENT_AUTHORITY.test(source[1]))) return;
  const client = CLIENT_AUTHORITY.test(source[1]);
  let path = source[2] ?? '/';
  if (path.includes('%') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) return;
  if (path.endsWith('/')) path = path.slice(0, -1);
  // Farcaster's Conversation.tsx uses this full-hash fallback for a cast
  // without a username. A short hash here has no author scope and is unsafe.
  const conversation = /^\/~\/conversations\/(0x[a-fA-F0-9]{40})$/.exec(path);
  if (!client && conversation) return castPath(conversation[1]);
  const segments = path.split('/');
  let search = '';
  if (client && source[3] !== undefined) {
    if (source[3].length > 2047) return;
    const parameters = new URLSearchParams(source[3]);
    if (path === '') {
      if (parameters.size !== 1 || !parameters.has('cast')) return;
      const legacy = parseRoute({ pathname: '/', search: `?${source[3]}` });
      return legacy.kind === 'cast' ? routePath(legacy) : undefined;
    }
    // Preserve only the native profile tab. Tracking and authorization fields
    // never become parameters on a local destination.
    const tabs = parameters.getAll('tab');
    if (tabs.length) search = `?${new URLSearchParams(tabs.map(tab => ['tab', tab]))}`;
  }
  const route = parseRoute({ pathname: path, search });
  if (client && segments.length === 3 && (route.kind === 'cast' || (segments[1] === 'profile' && route.kind === 'profile' && route.identifier))) return routePath(route);
  if (segments.length === 2 && route.kind === 'profile' && route.identifier) return routePath(route);
  if (segments.length === 3 && route.kind === 'cast-alias') return castAliasPath(route.authorIdentifier, route.hashPrefix);
}
