import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { IconCheck, IconPhoto, IconRefresh, IconUpload } from '@tabler/icons-react';
import type { User } from '@opencaster/client-core/api';
import { profileChanges, type ProfileField, type ProfilePatch, type ProfileUpdateResult } from '../lib/social';
import { profileDraft, type ProfileValues } from '../lib/profileDraft';
import { Button, Input, Modal } from './ui';
import '../social.scss';

export type { ProfileField } from '../lib/social';
export type ProfileChanges = ProfilePatch;
export type ProfileSaveResult = ProfileUpdateResult;

const FIELDS: ProfileField[] = ['displayName', 'bio', 'pfpUrl'];
const LABELS: Record<ProfileField, string> = { displayName: 'Display name', bio: 'Bio', pfpUrl: 'Profile image' };
const LIMITS: Record<ProfileField, number> = { displayName: 32, bio: 256, pfpUrl: 256 };
type Values = ProfileValues;
const byteLength = (value: string) => new TextEncoder().encode(value).length;
const errorMessage = (error: unknown) => error instanceof Error ? error.message.slice(0, 240) : 'This action could not be completed.';
const profileValues = (user: User): Values => ({ displayName: user.display_name ?? '', bio: user.profile?.bio?.text ?? '', pfpUrl: user.pfp_url ?? '' });

function safeImage(url: string): boolean {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password; }
  catch { return false; }
}

interface Props {
  user: User;
  /** Throws only for preflight failures. Once writing starts, the session
   * reports every success/failure in ProfileUpdateResult, including unknowns. */
  onSave(changes: ProfilePatch): Promise<ProfileUpdateResult>;
  onUpload?(file: File, signal?: AbortSignal): Promise<{ url: string }>;
  onReload?(): Promise<User>;
  onSaved?(changes: ProfilePatch): void;
  onClose(): void;
}

/** Each profile field is a separate signed message; successful fields are never replayed. */
export default function EditProfileDialog({ user, onSave, onUpload, onReload, onSaved, onClose }: Props) {
  const prefix = useId();
  const [baseline, setBaseline] = useState<Values>(() => profileValues(user));
  const [values, setValues] = useState<Values>(() => profileValues(user));
  const [unknown, setUnknown] = useState<Partial<Values>>({});
  const [busy, setBusy] = useState<'save' | 'upload' | 'reload' | ''>('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [failedFields, setFailedFields] = useState<ProfileField[]>([]);
  const [brokenImage, setBrokenImage] = useState('');
  const generation = useRef(0);
  const uploadController = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const writing = useRef(false);
  const uncertainFields = FIELDS.filter(field => unknown[field] !== undefined);
  const draft = profileDraft(baseline, values, uncertainFields);
  const canSave = Object.keys(draft.changes).length > 0 && Object.keys(draft.errors).length === 0 && !busy;

  useEffect(() => () => { generation.current += 1; uploadController.current?.abort(); }, []);

  function close() {
    if (writing.current) { setStatus('Saving is in progress. Wait for the node’s response before closing.'); return; }
    uploadController.current?.abort();
    onClose();
  }

  function update(field: ProfileField, value: string) {
    setValues(current => ({ ...current, [field]: value }));
    setError(''); setStatus('');
    setFailedFields(current => current.filter(item => item !== field));
  }

  async function upload(file: File | undefined) {
    if (!file || !onUpload || busy) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size < 1 || file.size > 5 * 1024 * 1024) {
      setError('Choose a JPEG, PNG, WebP, or GIF image up to 5 MiB.'); return;
    }
    const run = ++generation.current;
    const controller = new AbortController();
    uploadController.current?.abort(); uploadController.current = controller;
    setBusy('upload'); setError(''); setStatus('Uploading your image…');
    try {
      const uploaded = await onUpload(file, controller.signal);
      if (run !== generation.current || controller.signal.aborted) return;
      if (!safeImage(uploaded.url) || byteLength(uploaded.url) > LIMITS.pfpUrl) throw new Error('The uploaded image did not return a usable public URL.');
      setValues(current => ({ ...current, pfpUrl: uploaded.url }));
      setStatus('Image uploaded. Choose Save changes to use it on your profile.');
    } catch (cause) {
      if (run === generation.current && !controller.signal.aborted) { setError(errorMessage(cause)); setStatus(''); }
    } finally {
      if (run === generation.current) { setBusy(''); uploadController.current = null; }
    }
  }

  function cancelUpload() {
    generation.current += 1; uploadController.current?.abort(); uploadController.current = null;
    setBusy(''); setStatus('Upload cancelled. Your profile has not changed.');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canSave || writing.current) return;
    const changes = draft.changes;
    try { profileChanges(changes); }
    catch (cause) { setError(errorMessage(cause)); return; }
    const run = ++generation.current;
    writing.current = true; setBusy('save'); setError(''); setStatus('Saving your profile on Hypersnap…'); setFailedFields([]);
    try {
      const result = await onSave(changes);
      if (run !== generation.current) return;
      const saved: ProfilePatch = {};
      for (const field of result.saved) if (changes[field] !== undefined) saved[field] = changes[field];
      setBaseline(current => ({ ...current, ...saved }));
      const failures = result.failed ?? [];
      setFailedFields(failures.map(failure => failure.field));
      setUnknown(current => {
        const next = { ...current };
        for (const failure of failures) if (failure.unknown && changes[failure.field] !== undefined) next[failure.field] = changes[failure.field];
        return next;
      });
      if (Object.keys(saved).length) onSaved?.(saved);
      if (failures.length) {
        setStatus(result.saved.length ? `${result.saved.length} ${result.saved.length === 1 ? 'field saved' : 'fields saved'}. Other changes need attention.` : 'Your changes need attention.');
        setError(failures.map(failure => `${LABELS[failure.field]}: ${failure.message}`).join(' ').slice(0, 700));
      } else {
        setStatus('Profile saved.');
      }
    } catch (cause) {
      if (run !== generation.current) return;
      // The session throws only before sending anything. Actual write failures
      // are structured above, so a preflight rejection must not quarantine a
      // second field that was never submitted (especially after reopening).
      setError(errorMessage(cause)); setStatus('No new changes were submitted. Check your public profile if an earlier save is still unconfirmed.');
    } finally {
      writing.current = false;
      if (run === generation.current) setBusy('');
    }
  }

  async function reload() {
    if (!onReload || busy) return;
    const run = ++generation.current;
    setBusy('reload'); setError(''); setStatus('Checking the public profile…');
    try {
      const currentUser = await onReload();
      if (run !== generation.current) return;
      if (currentUser.fid !== user.fid) throw new Error('The node returned a different profile.');
      const fresh = profileValues(currentUser);
      const confirmed: ProfilePatch = {};
      for (const field of FIELDS) if (unknown[field] !== undefined && fresh[field] === unknown[field]) confirmed[field] = fresh[field];
      // Keep deliberate local edits, but adopt remote changes to untouched
      // fields so checking one pending write cannot overwrite another device.
      setValues(current => {
        const next = { ...current };
        for (const field of FIELDS) if (unknown[field] === undefined && current[field] === baseline[field]) next[field] = fresh[field];
        return next;
      });
      setBaseline(fresh);
      setUnknown(current => {
        const next = { ...current };
        for (const field of FIELDS) if (confirmed[field] !== undefined) delete next[field];
        return next;
      });
      if (Object.keys(confirmed).length) onSaved?.(confirmed);
      const unresolved = uncertainFields.some(field => confirmed[field] === undefined);
      setStatus(unresolved ? 'Some changes are still unconfirmed. They will not be sent again from this dialog.' : 'Public profile checked.');
    } catch (cause) { if (run === generation.current) { setError(errorMessage(cause)); setStatus(''); } }
    finally { if (run === generation.current) setBusy(''); }
  }

  return <Modal title="Edit profile" onClose={close}>
    <form className="edit-profile" noValidate onSubmit={event => void save(event)}>
      <p className="social-intro">Update how you appear on Hypersnap. Your username and account identity stay the same.</p>
      <div className="edit-profile__image-row">
        <div className="edit-profile__preview">{safeImage(values.pfpUrl) && brokenImage !== values.pfpUrl ? <img src={values.pfpUrl} alt="Profile image preview" referrerPolicy="no-referrer" onError={() => setBrokenImage(values.pfpUrl)} /> : <IconPhoto size={28} />}</div>
        <div><strong>Profile image</strong><p>JPEG, PNG, WebP, or GIF · up to 5 MiB.<br />Images are public. Photo metadata is retained.</p><Input ref={fileInput} type="file" className="visually-hidden" aria-label="Choose a profile image" accept="image/jpeg,image/png,image/webp,image/gif" disabled={!onUpload || !!busy || unknown.pfpUrl !== undefined} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void upload(file); }} />
          {onUpload && <Button variant="secondary" disabled={!!busy || unknown.pfpUrl !== undefined} onClick={() => fileInput.current?.click()}><IconUpload size={16} />Upload image</Button>}
          {values.pfpUrl && <Button variant="ghost" disabled={!!busy || unknown.pfpUrl !== undefined} onClick={() => update('pfpUrl', '')}>Remove image</Button>}
        </div>
      </div>
      {FIELDS.map(field => <div className="social-field" key={field}>
        <label htmlFor={`${prefix}-${field}`}>{field === 'pfpUrl' ? 'Profile image URL' : LABELS[field]}</label>
        {field === 'bio' ? <textarea id={`${prefix}-${field}`} value={values[field]} rows={4} disabled={!!busy || unknown[field] !== undefined} onChange={event => update(field, event.target.value)} aria-describedby={`${prefix}-${field}-help`} aria-invalid={!!draft.errors[field] || failedFields.includes(field)} /> : <Input id={`${prefix}-${field}`} value={values[field]} type={field === 'pfpUrl' ? 'url' : 'text'} disabled={!!busy || unknown[field] !== undefined} onChange={event => update(field, event.target.value)} autoComplete="off" aria-describedby={`${prefix}-${field}-help`} aria-invalid={!!draft.errors[field] || failedFields.includes(field)} />}
        <p id={`${prefix}-${field}-help`} className={draft.errors[field] ? 'error' : 'muted'}>{byteLength(values[field])}/{LIMITS[field]} bytes{draft.errors[field] ? ` · ${draft.errors[field]}` : field === 'pfpUrl' ? ' · new images need a public HTTPS URL; leave blank to remove' : ''}{unknown[field] !== undefined ? ' · waiting for confirmation' : ''}</p>
      </div>)}
      {!!uncertainFields.length && <div className="social-uncertain"><strong>Some saves are not confirmed</strong><p>Successful changes are kept. Unconfirmed fields will not be sent again automatically. A profile check can confirm a change once it appears on the node.</p></div>}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="social-status" role="status">{status && <>{status === 'Profile saved.' && <IconCheck size={16} />}{status}</>}</p>
      {onReload && <Button variant="secondary" disabled={!!busy} onClick={() => void reload()}><IconRefresh size={16} className={busy === 'reload' ? 'spin' : ''} />{busy === 'reload' ? 'Checking profile…' : 'Check public profile'}</Button>}
      <div className="social-actions">{busy === 'upload' ? <Button variant="secondary" onClick={cancelUpload}>Cancel upload</Button> : <Button variant="ghost" disabled={busy === 'save'} onClick={close}>{status === 'Profile saved.' ? 'Done' : 'Cancel'}</Button>}<Button type="submit" disabled={!canSave}>{busy === 'save' ? <><IconRefresh size={16} className="spin" />Saving…</> : 'Save changes'}</Button></div>
    </form>
  </Modal>;
}
