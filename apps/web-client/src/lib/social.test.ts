import { describe, expect, it } from 'vitest';
import { profileChanges } from './social';

describe('editable Hypersnap profile fields', () => {
  it('maps supported public fields to exact protocol values and permits explicit clearing', () => {
    expect(profileChanges({ displayName: 'Alice', bio: '', pfpUrl: 'https://quorum.arca.computer/media/avatar.png' })).toEqual([
      { field: 'displayName', type: 2, value: 'Alice' }, { field: 'bio', type: 3, value: '' },
      { field: 'pfpUrl', type: 1, value: 'https://quorum.arca.computer/media/avatar.png' },
    ]);
  });
  it('applies protocol UTF-8 byte limits before any write', () => {
    expect(profileChanges({ displayName: '😀'.repeat(8), bio: 'é'.repeat(128) })).toHaveLength(2);
    expect(() => profileChanges({ displayName: '😀'.repeat(9) })).toThrow('32 UTF-8');
    expect(() => profileChanges({ bio: 'é'.repeat(129) })).toThrow('256 UTF-8');
    expect(() => profileChanges({ pfpUrl: `https://example.com/${'x'.repeat(256)}` })).toThrow('256 UTF-8');
  });
  it('rejects unimplemented, privileged and unsafe content fields', () => {
    for (const patch of [{ username: 'admin' }, { custody: 'x' }, { bannerUrl: 'https://example.com/banner.png' }, { displayName: 3 }, { pfpUrl: 'http://example.com/x' }, { pfpUrl: 'javascript:alert(1)' }, { pfpUrl: 'https://user:pass@example.com/x' }]) {
      expect(() => profileChanges(patch as Parameters<typeof profileChanges>[0])).toThrow();
    }
  });
});
