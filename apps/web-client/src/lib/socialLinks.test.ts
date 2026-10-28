import { describe, expect, it } from 'vitest';
import { quorumSocialPath } from './socialLinks';

const fullHash = '0xcfd6d3c3e990cffcb4af8063426d299cf22fab37';

describe('public social links opened in Opencaster', () => {
  it.each(['https://opencaster.org', 'https://quorum.arca.computer'])('opens supported current and historic native social links locally: %s', origin => {
    for (const [path, expected] of [
      ['/profile/1234', '/profile/1234'],
      ['/profile/alice?tab=replies&utm_source=old#ignored', '/profile/alice?tab=replies'],
      ['/alice?tab=likes&scopes=1,2,11&return=https://evil.test', '/profile/alice?tab=likes'],
      ['/ALICE/?tab=recasts', '/profile/alice?tab=recasts'],
      [`/cast/${fullHash}?scopes=1,2,11`, `/cast/${fullHash}`],
      ['/alice/0xcfd6d3c3', '/alice/0xcfd6d3c3'],
      [`/?cast=${fullHash}`, `/cast/${fullHash}`],
    ]) expect(quorumSocialPath(`${origin}${path}`)).toBe(expected);
  });

  it.each(['https://opencaster.org', 'https://quorum.arca.computer'])('does not rewrite native authorization, unsupported handlers or malformed semantic queries: %s', origin => {
    for (const path of [
      '/connect?fid=3&scopes=1,2,11', '/settings', '/profile', '/search?q=alice', '/media/' + 'a'.repeat(64),
      '/alice/../bob', '/%61lice', '/profile/alice?tab=unknown', '/alice?tab=likes&tab=recasts',
      '/?cast=0xcfd6d3c3', `/?cast=${fullHash}&cast=${fullHash}`, `/?cast=${fullHash}&return=/connect`,
      `/?scopes=1,2&cast=${fullHash}`, '/?cast=javascript:alert(1)', '/?tab=likes',
      `/~/conversations/${fullHash}`, `/cast/${fullHash}/extra`,
    ]) expect(quorumSocialPath(`${origin}${path}`)).toBeUndefined();
  });

  it.each([
    ['https://farcaster.xyz/alice', '/profile/alice'],
    ['https://www.farcaster.xyz/Alice/', '/profile/alice'],
    ['https://warpcast.com/410023?utm_source=share#profile', '/profile/410023'],
    ['https://www.warpcast.com/JESSE.BASE.ETH/', '/profile/jesse.base.eth'],
    ['HTTPS://FARCASTER.XYZ:443/Alice.eth?fid=99&scopes=1,2,11&return=https://example.org#ignored', '/profile/alice.eth'],
    ['https://farcaster.xyz/gandhionchain/0xcfd6d3c3', '/gandhionchain/0xcfd6d3c3'],
    ['https://www.farcaster.xyz/GandhiOnChain/0XCFD6D3C3/?utm_source=share#cast', '/gandhionchain/0xcfd6d3c3'],
    ['https://warpcast.com/410023/0xcfd6d3c3e9', '/410023/0xcfd6d3c3e9'],
    ['https://www.warpcast.com/alice.eth/0xcfd6d3c3/?q=ignored', '/alice.eth/0xcfd6d3c3'],
    [`https://farcaster.xyz/alice/${fullHash}`, `/alice/${fullHash}`],
    [`https://farcaster.xyz/~/conversations/${fullHash}`, `/cast/${fullHash}`],
    [`https://warpcast.com/~/conversations/0x${fullHash.slice(2).toUpperCase()}/?utm_source=share#cast`, `/cast/${fullHash}`],
  ])('maps only the public path of %s to %s', (source, expected) => {
    expect(quorumSocialPath(source)).toBe(expected);
  });

  it.each([
    'https://farcaster.xyz.evil.example/alice', 'https://evilfarcaster.xyz/alice', 'https://farcaster.xyz./alice',
    'https://warpcast.com.evil.example/alice', 'https://warpcast.xyz/alice', 'https://m.farcaster.xyz/alice',
    'https://farcaster%2exyz/alice', 'https://farcaster。xyz/alice', 'https://fаrcaster.xyz/alice',
    'https://user@farcaster.xyz/alice', 'https://user:password@warpcast.com/alice', 'https://farcaster.xyz@evil.example/alice',
    'https://farcaster.xyz:8443/alice', 'https://warpcast.com:80/alice', 'https://warpcast.com:0443/alice',
    'https://opencaster.org.evil.example/alice', 'https://opencaster.org./alice', 'https://www.opencaster.org/alice',
    'https://user@opencaster.org/alice', 'https://opencaster.org:8443/alice', 'https://opencaster.org:0443/alice',
    'https://quorum.arca.computer.evil.example/profile/alice', 'https://quorum.arca.computer./alice',
    'https://farcaster.xyz:/alice', 'http://farcaster.xyz/alice', '//farcaster.xyz/alice', 'farcaster.xyz/alice',
    'javascript:https://farcaster.xyz/alice', 'https:////farcaster.xyz/alice',
  ])('keeps unsupported authorities and URL formats external: %j', source => {
    expect(quorumSocialPath(source)).toBeUndefined();
  });

  it.each([
    'https://farcaster.xyz/alice/../bob', 'https://farcaster.xyz/./alice', 'https://farcaster.xyz/alice/.',
    'https://farcaster.xyz/%2e/alice', 'https://farcaster.xyz/alice/%2e%2e/bob', 'https://farcaster.xyz/alice/%252e%252e/bob',
    'https://farcaster.xyz/%61lice', 'https://farcaster.xyz/alice%2f0xcfd6d3c3', 'https://farcaster.xyz/alice/%30xcfd6d3c3',
    'https://warpcast.com/alice%5cbob', 'https://warpcast.com/alice\\bob', 'https://warpcast.com\\@evil.example/alice',
    'https://farcaster.xyz/alice//', 'https://farcaster.xyz//alice', 'https://farcaster.xyz/alice//0xcfd6d3c3',
  ])('rejects raw paths before any URL normalization or decoding: %j', source => {
    expect(quorumSocialPath(source)).toBeUndefined();
  });

  it.each([
    '', 'https://farcaster.xyz', 'https://farcaster.xyz/', 'https://farcaster.xyz/?next=/alice',
    'https://farcaster.xyz/~/compose', 'https://warpcast.com/~/channel/quilibrium', 'https://farcaster.xyz/connect',
    'https://farcaster.xyz/~/conversations/0xcfd6d3c3', `https://farcaster.xyz/~/conversations/${fullHash}0`, `https://farcaster.xyz/~/Conversations/${fullHash}`, `https://farcaster.xyz/~/conversations/${fullHash}/extra`,
    'https://farcaster.xyz/PROFILE', 'https://farcaster.xyz/profile/alice', `https://farcaster.xyz/cast/${fullHash}`,
    'https://warpcast.com/api', 'https://warpcast.com/media/0xcfd6d3c3', 'https://warpcast.com/robots.txt',
    'https://farcaster.xyz/@alice', 'https://farcaster.xyz/0', 'https://farcaster.xyz/9007199254740992',
    'https://farcaster.xyz/álîce', `https://farcaster.xyz/${'a'.repeat(129)}`,
    'https://farcaster.xyz/alice/0xcfd6d3c', 'https://farcaster.xyz/alice/0xcfd6d3c3e',
    `https://farcaster.xyz/alice/0x${'a'.repeat(42)}`, 'https://farcaster.xyz/alice/0xcfd6d3cz',
    'https://farcaster.xyz/alice/0xcfd6d3c3/extra',
  ])('leaves unsupported handlers, authors and cast paths unchanged externally: %j', source => {
    expect(quorumSocialPath(source)).toBeUndefined();
  });

  it.each([' ', '\t', '\n', '\r', '\u0000', '\u007f', '\u0085', '\u00a0'])('rejects raw whitespace or controls anywhere in a URL: %j', value => {
    expect(quorumSocialPath(`${value}https://farcaster.xyz/alice`)).toBeUndefined();
    expect(quorumSocialPath(`https://farcaster.xyz/alice?tracking=${value}`)).toBeUndefined();
    expect(quorumSocialPath(`https://farcaster.xyz/alice#${value}`)).toBeUndefined();
  });
});
