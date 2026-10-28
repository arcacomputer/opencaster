import { describe, expect, it } from 'vitest';
import { HYPERSNAP_ENS_LIMITS_MESSAGE, normalizeHypersnapEnsName } from './ensName';

describe('Hypersnap indexed ENS names', () => {
  it.each([
    [' @Alice.ETH ', 'alice.eth', 'ens'],
    [' JESSE.BASE.ETH ', 'jesse.base.eth', 'basename'],
    ['0xalice.eth', '0xalice.eth', 'ens'],
    ['123.base.eth', '123.base.eth', 'basename'],
    ['a.eth', 'a.eth', 'ens'],
    [`${'a'.repeat(16)}.base.eth`, `${'a'.repeat(16)}.base.eth`, 'basename'],
    ['a-.eth', 'a-.eth', 'ens'],
    ['base.eth', 'base.eth', 'ens'],
  ])('normalizes only the native proof format %s', (input, name, type) => {
    expect(normalizeHypersnapEnsName(input)).toEqual({ name, type });
  });

  it.each(['', 'alice', '.eth', '.base.eth', '-alice.eth', 'alice_name.eth', 'alice..eth', 'sub.alice.eth', 'sub.alice.base.eth', 'alice.com', 'alice.eth.', '@@alice.eth', 'https://alice.eth', 'alice.eth/path', 'alice.eth?fid=1', `${'a'.repeat(17)}.eth`, 'álîce.eth', 'Key.eth', 'alice\u200b.eth', 'alice\n.eth', 'a b.eth'])('rejects unsupported names before any lookup: %j', input => {
    expect(() => normalizeHypersnapEnsName(input)).toThrow(HYPERSNAP_ENS_LIMITS_MESSAGE);
  });
});
