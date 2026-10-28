// Platform-independent migration candidate for a future shared Hypersnap client.
// These are Hypersnap's indexed name-proof limits, not general ENS normalization.
export interface HypersnapEnsName { name: string; type: 'ens' | 'basename' }
export const HYPERSNAP_ENS_LIMITS_MESSAGE = 'Use a Hypersnap-linked name.eth or name.base.eth with a 1–16 character ASCII name: letters, numbers, or hyphens, starting with a letter or number. Unicode names and other subdomains are not supported.';

export function normalizeHypersnapEnsName(input: string): HypersnapEnsName {
  const term = input.trim().replace(/^@/, '');
  // Reject Unicode before case folding, including characters that fold to ASCII.
  // eslint-disable-next-line no-control-regex -- This explicit ASCII range rejects Unicode before case folding.
  if (!/^[\x00-\x7f]*$/.test(term)) throw new Error(HYPERSNAP_ENS_LIMITS_MESSAGE);
  const name = term.toLowerCase();
  const match = /^([a-z0-9][a-z0-9-]{0,15})\.(base\.)?eth$/.exec(name);
  if (!match) throw new Error(HYPERSNAP_ENS_LIMITS_MESSAGE);
  return { name, type: match[2] ? 'basename' : 'ens' };
}
