import { useId, useState, type FormEvent } from 'react';
import { IconEye, IconVolumeOff, IconX } from '@tabler/icons-react';
import { addMutedWord, normalizeMutedWord, removeMutedWord, unmuteAccount, type ContentPreferences } from '../lib/contentPreferences';
import { Button, Input } from './ui';
import '../content-settings.scss';

export interface ContentSettingsProps {
  preferences: ContentPreferences;
  onChange(next: ContentPreferences): void;
  fid?: number;
}

/** Controlled presentation: the parent owns account changes and storage errors. */
export function ContentSettings({ preferences, onChange, fid }: ContentSettingsProps) {
  return <ContentSettingsForm key={fid ?? 'guest'} preferences={preferences} onChange={onChange} fid={fid} />;
}

function ContentSettingsForm({ preferences, onChange, fid }: ContentSettingsProps) {
  const prefix = useId();
  const [word, setWord] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  function add(event: FormEvent) {
    event.preventDefault(); setStatus('');
    try {
      const next = addMutedWord(preferences, word);
      onChange(next); setWord(''); setError(''); setStatus('Word or phrase added to these browser preferences.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'This word or phrase could not be added.'); }
  }
  return <section className="content-settings" aria-labelledby={`${prefix}-heading`}>
    <header><p className="content-settings__eyebrow">ON THIS BROWSER</p><h2 id={`${prefix}-heading`}>Content preferences</h2>
      <p>{fid === undefined ? 'Guest preferences' : `Preferences for account FID ${fid}`}. These settings stay in this browser. They filter displayed public casts and do not block accounts on the network, prevent messages or change other clients.</p>
      <p>Words and phrases match anywhere in cast text, ignoring case. Quoted text can be filtered when it is loaded; unknown quoted text is not inspected.</p>
    </header>
    <section aria-labelledby={`${prefix}-words`}>
      <h3 id={`${prefix}-words`}><IconVolumeOff size={19} aria-hidden="true" />Muted words and phrases <span>{preferences.mutedWords.length}/100</span></h3>
      <form onSubmit={add} noValidate>
        <label htmlFor={`${prefix}-word`}>Word or phrase</label>
        <div className="content-settings__add"><Input id={`${prefix}-word`} value={word} maxLength={1_024} onChange={event => {
          const value = event.target.value; setWord(value); setStatus('');
          try { if (value.trim()) normalizeMutedWord(value); setError(''); }
          catch (cause) { setError(cause instanceof Error ? cause.message : 'Use a shorter word or phrase.'); }
        }} aria-describedby={`${prefix}-word-help${error ? ` ${prefix}-error` : ''}`} aria-invalid={Boolean(error)} autoComplete="off" /><Button type="submit">Mute phrase</Button></div>
        <p id={`${prefix}-word-help`} className="content-settings__note">Up to 80 characters and 256 UTF-8 bytes each. Matching uses plain text, including punctuation.</p>
        {error ? <p id={`${prefix}-error`} role="alert" className="content-settings__error">{error}</p> : null}
      </form>
      {preferences.mutedWords.length ? <ul className="content-settings__words">{preferences.mutedWords.map(value => <li key={value}><span>{value}</span><Button variant="ghost" aria-label={`Remove muted phrase ${value}`} onClick={() => { onChange(removeMutedWord(preferences, value)); setStatus('Word or phrase removed from these browser preferences.'); }}><IconX size={16} aria-hidden="true" /></Button></li>)}</ul> : <p className="content-settings__note">No words or phrases muted.</p>}
    </section>
    <section aria-labelledby={`${prefix}-accounts`}>
      <h3 id={`${prefix}-accounts`}><IconVolumeOff size={19} aria-hidden="true" />Muted accounts <span>{preferences.mutedAccounts.length}/100</span></h3>
      <p className="content-settings__note">Use a cast’s menu to mute its author on this browser. Muted accounts can still see and interact with public casts.</p>
      {preferences.mutedAccounts.length ? <ul className="content-settings__accounts">{preferences.mutedAccounts.map(person => <li key={person.fid}><span><strong>{person.display_name || person.username || `FID ${person.fid}`}</strong><small>{person.username ? `@${person.username} · ` : ''}FID {person.fid}</small></span><Button variant="secondary" aria-label={`Unmute ${person.display_name || person.username || `FID ${person.fid}`}`} onClick={() => { onChange(unmuteAccount(preferences, person.fid)); setStatus('Account removed from these browser preferences.'); }}>Unmute</Button></li>)}</ul> : <p className="content-settings__note">No accounts muted.</p>}
    </section>
    <section aria-labelledby={`${prefix}-hidden`}>
      <h3 id={`${prefix}-hidden`}><IconEye size={19} aria-hidden="true" />Hidden casts <span>{preferences.hiddenCasts.length}/500</span></h3>
      <p className="content-settings__note">Hidden casts remain public. Clearing this list lets them appear again when available from the node.</p>
      <Button variant="secondary" disabled={!preferences.hiddenCasts.length} onClick={() => { onChange({ ...preferences, hiddenCasts: [] }); setStatus('The hidden cast list was cleared in these browser preferences.'); }}>Clear hidden casts</Button>
    </section>
    <p className="content-settings__status" role="status" aria-live="polite">{status}</p>
  </section>;
}

export default ContentSettings;
