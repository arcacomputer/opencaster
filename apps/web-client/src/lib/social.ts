import { UserDataType } from '@opencaster/protocol/messageBuilder';

export type ProfileField = 'displayName' | 'bio' | 'pfpUrl';
export type ProfilePatch = Partial<Record<ProfileField, string>>;
export interface ProfileUpdateResult {
  saved: ProfileField[];
  failed?: Array<{ field: ProfileField; message: string; unknown: boolean }>;
}
export interface ProfileChange { field: ProfileField; type: UserDataType; value: string }

/** Matches Hypersnap validations at 2e8733d; limits count UTF-8 bytes. Banner
 * updates require protocol Pro status and are not exposed by this client. */
export function profileChanges(patch: ProfilePatch): ProfileChange[] {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)
    || Object.keys(patch).some(key => !['displayName', 'bio', 'pfpUrl'].includes(key))) throw new Error('Unsupported profile field.');
  const fields = [
    ['displayName', UserDataType.DISPLAY, 32],
    ['bio', UserDataType.BIO, 256],
    ['pfpUrl', UserDataType.PFP, 256],
  ] as const;
  return fields.flatMap(([field, type, max]) => {
    const value = patch[field];
    if (value === undefined) return [];
    if (typeof value !== 'string' || new TextEncoder().encode(value).length > max) throw new Error(`${field === 'displayName' ? 'Display name' : field === 'bio' ? 'Bio' : 'Profile picture URL'} exceeds ${max} UTF-8 bytes.`);
    if (field === 'pfpUrl' && value !== '') {
      let url: URL;
      try { url = new URL(value); } catch { throw new Error('Use an HTTPS profile picture URL.'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.href !== value) throw new Error('Use a complete HTTPS profile picture URL without credentials.');
    }
    return [{ field, type, value }];
  });
}
