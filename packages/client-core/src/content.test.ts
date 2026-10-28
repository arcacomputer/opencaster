import { describe, expect, it } from 'vitest';
import type { Cast, User } from './api';
import { composeCastContent, renderMentionSegments } from './content';

const alice = { fid: 123, username: 'alice' } as User;
const bob = { fid: 456, username: 'bob.eth' } as User;
const cast = (text: string, profiles: User[], positions: Array<{ start: number; end: number }>) => ({ text, mentioned_profiles: profiles, mentioned_profiles_ranges: positions });
const displayed = (value: ReturnType<typeof renderMentionSegments>) => value.map(segment => segment.kind === 'text' ? segment.text : `@${segment.user.username || segment.user.fid}`).join('');

describe('Hypersnap mention rendering', () => {
  it('inserts protocol mentions at UTF-8 boundaries without changing the raw text', () => {
    const raw = '🌈 hello, 你好 !';
    const segments = renderMentionSegments(cast(raw, [alice, bob], [{ start: 5, end: 5 }, { start: 19, end: 19 }]));
    expect(displayed(segments)).toBe('🌈 @alicehello, 你好 @bob.eth!');
    expect(segments.filter(item => item.kind === 'mention')).toEqual([{ kind: 'mention', user: alice }, { kind: 'mention', user: bob }]);
    expect(segments.filter(item => item.kind === 'text').map(item => item.text).join('')).toBe(raw);
  });

  it('preserves mentions at the same insertion byte and at either edge', () => {
    expect(displayed(renderMentionSegments(cast('hi', [alice, bob, alice], [{ start: 0, end: 0 }, { start: 0, end: 0 }, { start: 2, end: 2 }])))).toBe('@alice@bob.ethhi@alice');
    expect(displayed(renderMentionSegments(cast('', [alice], [{ start: 0, end: 0 }])))).toBe('@alice');
  });

  it.each([
    { range: { start: 1, end: 1 } }, // Inside a four-byte emoji.
    { range: { start: -1, end: -1 } },
    { range: { start: 99, end: 99 } },
    { range: { start: 0.5, end: 0.5 } },
    { range: { start: 0, end: 1 } }, // Ranges are insertion points on this node.
  ])('keeps complete raw text for malformed mention ranges $range', ({ range }) => {
    expect(renderMentionSegments(cast('🌈 message', [alice], [range]))).toEqual([{ kind: 'text', text: '🌈 message' }]);
  });

  it('falls back as a whole for inconsistent, descending, or invalid profile metadata', () => {
    const raw = 'hello';
    const fixtures = [
      cast(raw, [alice, bob], [{ start: 0, end: 0 }]),
      cast(raw, [alice, bob], [{ start: 3, end: 3 }, { start: 1, end: 1 }]),
      cast(raw, [{ ...alice, fid: -1 }], [{ start: 0, end: 0 }]),
      cast(raw, [{ ...alice, username: '<invalid>' }], [{ start: 0, end: 0 }]),
      { text: raw, mentioned_profiles: [alice] },
    ];
    for (const fixture of fixtures) expect(renderMentionSegments(fixture)).toEqual([{ kind: 'text', text: raw }]);
  });

  it('does not discover or link arbitrary textual @names without mention metadata', () => {
    expect(renderMentionSegments({ text: 'Hello @alice' } as Cast)).toEqual([{ kind: 'text', text: 'Hello @alice' }]);
  });
  it('keeps profiles without usernames linkable through their verified FID', () => {
    expect(displayed(renderMentionSegments(cast(' hello', [{ ...alice, username: '' }], [{ start: 0, end: 0 }])))).toBe('@123 hello');
  });
});

describe('explicit mention composition', () => {
  it('allows an explicitly selected account without a username to be mentioned by FID', () => {
    expect(composeCastContent('🌈 @123!', [{ ...alice, username: '' }])).toEqual({ text: '🌈 !', mentions: [123], mentionsPositions: [5] });
  });
  it('supports the node’s fid: placeholder only when it matches that exact identity', () => {
    expect(composeCastContent('Hi @fid:123!', [{ ...alice, username: 'fid:123' }])).toEqual({ text: 'Hi !', mentions: [123], mentionsPositions: [3] });
    expect(() => composeCastContent('Hi @fid:456', [{ ...alice, username: 'fid:456' }])).toThrow('invalid profile');
  });
  it('counts UTF-8 bytes of stripped text before each selected token', () => {
    const result = composeCastContent('🌈 @alice, 你好 @bob.eth!', [alice, bob]);
    expect(result).toEqual({ text: '🌈 , 你好 !', mentions: [123, 456], mentionsPositions: [5, 14] });
    expect(displayed(renderMentionSegments(cast(result.text, [alice, bob], result.mentionsPositions.map(start => ({ start, end: start })))))).toBe('🌈 @alice, 你好 @bob.eth!');
  });

  it('supports repeated identities and adjacent insertion bytes separated by punctuation', () => {
    expect(composeCastContent('@alice @alice @bob.eth', [alice, bob])).toEqual({ text: '  ', mentions: [123, 123, 456], mentionsPositions: [0, 1, 2] });
  });

  it('keeps unselected names and edited labels literal', () => {
    expect(composeCastContent('@alicedao @alice.eth @alice-2 @bob.eth @alice', [alice])).toEqual({ text: '@alicedao @alice.eth @alice-2 @bob.eth ', mentions: [123], mentionsPositions: [39] });
  });

  it('matches complete dotted names, case variations, and sentence punctuation', () => {
    expect(composeCastContent('(@ALICE), @bob.eth. @alice… @alice..', [alice, bob])).toEqual({ text: '(), . … ..', mentions: [123, 456, 123, 123], mentionsPositions: [1, 4, 6, 10] });
  });

  it('does not remove token-like content inside email addresses, URLs, or other words', () => {
    const raw = 'mail@alice foo.@alice @@alice é@alice https://example.com/x,@alice www.example.com/@alice mailto:person@alice user=@alice +@alice';
    expect(composeCastContent(raw, [alice])).toEqual({ text: raw, mentions: [], mentionsPositions: [] });
  });

  it('selects the longer explicit identity when usernames overlap', () => {
    const aliceEth = { fid: 789, username: 'alice.eth' } as User;
    expect(composeCastContent('@alice.eth @alice', [alice, aliceEth])).toEqual({ text: ' ', mentions: [789, 123], mentionsPositions: [0, 1] });
  });

  it('rejects unsafe or ambiguous FIDs and changed selected identity labels', () => {
    for (const fid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER]) expect(() => composeCastContent('@alice', [{ ...alice, fid }])).toThrow('invalid profile');
    expect(() => composeCastContent('@alice', [alice, { ...alice, fid: 222 }])).toThrow('identities changed');
    expect(() => composeCastContent('@alice', [alice, { ...alice, username: 'renamed' }])).toThrow('identities changed');
  });

  it('bounds actual mentions and rejects incomplete Unicode before calculating offsets', () => {
    expect(() => composeCastContent(Array(11).fill('@alice').join(' '), [alice])).toThrow('up to 10');
    expect(() => composeCastContent('hello', Array(11).fill(alice))).toThrow('up to 10');
    expect(() => composeCastContent('\ud83d@alice\ude00', [alice])).toThrow('incomplete Unicode');
    expect(composeCastContent('literal @alice', [])).toEqual({ text: 'literal @alice', mentions: [], mentionsPositions: [] });
  });
});
