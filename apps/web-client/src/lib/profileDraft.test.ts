import { describe, expect, it } from 'vitest';
import { profileDraft, type ProfileValues } from './profileDraft';

const baseline: ProfileValues = { displayName: 'Alice', bio: 'Original bio', pfpUrl: 'https://example.com/avatar.png' };

describe('profile edit patch validation', () => {
  it.each(['http://example.com/avatar.png', 'ipfs://bafy-old-profile-image', 'legacy-image-reference'])('preserves an existing %s avatar when editing another field', pfpUrl => {
    const existing = { ...baseline, pfpUrl };
    expect(profileDraft(existing, { ...existing, bio: 'Updated bio' })).toEqual({ changes: { bio: 'Updated bio' }, errors: {} });
    expect(existing.pfpUrl).toBe(pfpUrl);
  });

  it('allows edits beside other unchanged legacy fields without writing those values again', () => {
    const existing = { ...baseline, displayName: 'A legacy display name that exceeds current limits' };
    expect(profileDraft(existing, { ...existing, bio: 'Updated bio' })).toEqual({ changes: { bio: 'Updated bio' }, errors: {} });
  });

  it('continues to reject newly entered non-HTTPS or credential-bearing image references', () => {
    for (const pfpUrl of ['http://example.com/new.png', 'ipfs://new-image', 'https://user:password@example.com/new.png']) {
      const draft = profileDraft(baseline, { ...baseline, pfpUrl });
      expect(draft.changes).toEqual({ pfpUrl });
      expect(draft.errors.pfpUrl).toMatch(/HTTPS/);
    }
  });

  it('allows an explicit image removal while keeping UTF-8 limits on changed fields', () => {
    expect(profileDraft(baseline, { ...baseline, pfpUrl: '' })).toEqual({ changes: { pfpUrl: '' }, errors: {} });
    const draft = profileDraft(baseline, { ...baseline, displayName: '🌈'.repeat(9) });
    expect(draft.errors.displayName).toContain('32 UTF-8 bytes');
  });

  it('excludes uncertain fields from later patches while allowing known unsent changes', () => {
    expect(profileDraft(baseline, { ...baseline, bio: 'Unconfirmed bio', displayName: 'New name' }, ['bio'])).toEqual({ changes: { displayName: 'New name' }, errors: {} });
    expect(profileDraft(baseline, baseline)).toEqual({ changes: {}, errors: {} });
  });
});
