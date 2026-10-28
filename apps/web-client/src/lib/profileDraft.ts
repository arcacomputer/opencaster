import { profileChanges, type ProfileField, type ProfilePatch } from './social';

export type ProfileValues = Record<ProfileField, string>;
export const PROFILE_FIELDS: readonly ProfileField[] = ['displayName', 'bio', 'pfpUrl'];

/** Validate the patch, not every hydrated value. The protocol accepts legacy
 * image references that this client will not create (for example HTTP/IPFS).
 * Keeping an existing value must not prevent unrelated profile edits.
 * Platform-independent: a future shared Hypersnap client can reuse this model. */
export function profileDraft(baseline: ProfileValues, values: ProfileValues, blocked: readonly ProfileField[] = []): {
  changes: ProfilePatch;
  errors: Partial<Record<ProfileField, string>>;
} {
  const changes: ProfilePatch = {};
  const errors: Partial<Record<ProfileField, string>> = {};
  for (const field of PROFILE_FIELDS) {
    if (values[field] === baseline[field] || blocked.includes(field)) continue;
    changes[field] = values[field];
    try { profileChanges({ [field]: values[field] }); }
    catch (error) { errors[field] = error instanceof Error ? error.message : 'This profile field is invalid.'; }
  }
  return { changes, errors };
}
