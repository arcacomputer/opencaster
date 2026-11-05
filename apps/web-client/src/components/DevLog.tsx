import { useState } from 'react';
import { IconArrowDown, IconArrowUpRight, IconChevronDown, IconCode, IconHistory, IconShieldLock, IconWorld } from '@tabler/icons-react';
import { DEV_LOG, PROJECT_STARTED_AT, type DevLogMilestone } from '../lib/devLog';
import { Button } from './ui';
import '../devlog.scss';

const source = 'https://github.com/arcacomputer/opencaster';
const categories = ['Launch', 'Wallets', 'Security', 'Social', 'Reliability'] as const;
const labels = { Launch: 'The beginning', Wallets: 'Wallets', Security: 'Security', Social: 'Features', Reliability: 'Reliability' };
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
// Compare instants, since author timestamps can use different UTC offsets.
const chronologicalEntries = [...DEV_LOG].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
function dateLabel(timestamp: string) {
  return dateTimeFormatter.format(new Date(timestamp));
}

export default function DevLog() {
  const [category, setCategory] = useState<DevLogMilestone['tag'] | 'all'>('all');
  const [oldestFirst, setOldestFirst] = useState(false);
  const entries = chronologicalEntries.filter(entry => category === 'all' || entry.tag === category);
  const visible = oldestFirst ? [...entries].reverse() : entries;
  return <div className="devlog">
    <section className="devlog-intro" aria-labelledby="devlog-story">
      <span className="devlog-kicker"><IconHistory size={15} aria-hidden="true" />OPENCASTER DEV LOG</span>
      <h2 id="devlog-story">What’s changed<span>✳</span></h2>
      <p>Features, fixes and notes from building Opencaster. Open an update for the details.</p>
      <dl className="devlog-facts"><div><dt>First commit</dt><dd><time dateTime={PROJECT_STARTED_AT}>{dateLabel(PROJECT_STARTED_AT)}</time></dd></div><div><dt>Updates</dt><dd>{DEV_LOG.length}</dd></div><div><dt>Latest update</dt><dd><time dateTime={chronologicalEntries[0].timestamp}>{dateLabel(chronologicalEntries[0].timestamp)}</time></dd></div></dl>
      <p className="devlog-timezone">Times come from the linked commits, shown in your local timezone.</p>
      <div className="devlog-intro__actions"><Button variant="secondary" aria-pressed={oldestFirst} onClick={() => { setOldestFirst(value => !value); setCategory('all'); }}><IconArrowDown size={16} aria-hidden="true" />{oldestFirst ? 'Show latest first' : 'Show oldest first'}</Button><a href={`${source}/commits/main/hypersnap`} target="_blank" rel="noopener noreferrer">Browse commits<IconArrowUpRight size={15} aria-hidden="true" /></a></div>
    </section>

    <nav className="devlog-filters" aria-label="Dev log topics"><Button variant="ghost" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>All updates</Button>{categories.map(tag => <Button key={tag} variant="ghost" aria-pressed={category === tag} onClick={() => setCategory(tag)}>{labels[tag]}</Button>)}</nav>
    <div className="devlog-order" role="status"><span>{category === 'all' ? 'All updates' : labels[category]}</span><span>{oldestFirst ? 'Oldest first' : 'Latest first'} · {visible.length} updates</span></div>

    <ol className="devlog-timeline" aria-label="Project milestones">{visible.map(entry => <li key={entry.id}>
      <article className="devlog-entry" id={entry.id} aria-labelledby={`${entry.id}-title`}>
        <div className="devlog-entry__meta"><time dateTime={entry.timestamp}>{dateLabel(entry.timestamp)}</time><span className={`devlog-tag devlog-tag--${entry.tag.toLowerCase()}`}>{labels[entry.tag]}</span></div>
        <h3 id={`${entry.id}-title`}>{entry.title}</h3><p>{entry.summary}</p>
        <details className="devlog-entry__details">
          <summary aria-label={`More details: ${entry.title}`}>More details<IconChevronDown size={14} aria-hidden="true" /></summary>
          <ul>{entry.changes.map(change => <li key={change}>{change}</li>)}</ul>
          <a className="devlog-commit" href={entry.commit} target="_blank" rel="noopener noreferrer" aria-label={`View code for ${entry.title}`}><IconCode size={14} aria-hidden="true" />View the change<span>{entry.commit.split('/').pop()!.slice(0, 7)}</span><IconArrowUpRight size={14} aria-hidden="true" /></a>
        </details>
      </article>
    </li>)}</ol>

    <section className="devlog-principles" aria-labelledby="devlog-principles-title"><h2 id="devlog-principles-title">A few things to know</h2><div><IconShieldLock size={20} aria-hidden="true" /><p><strong>Your recovery phrase stays in your wallet.</strong>You approve a device key with your wallet. If you save that key in this browser, a compatible passkey can protect it.</p></div><div><IconWorld size={20} aria-hidden="true" /><p><strong>Opencaster runs on Hypersnap.</strong>Our Cloudflare gateway connects to the community-run Hypersnap node. WalletConnect also relies on an external relay if you choose to use it.</p></div><div><IconCode size={20} aria-hidden="true" /><p><strong>Every update links to the code.</strong>This is beta software. The tests don’t cover every device, and an independent security audit is still pending.</p></div>
      <div className="devlog-reference-links"><a href={`${source}/blob/main/apps/web-client/FEATURE_SUPPORT.md`} target="_blank" rel="noopener noreferrer">Supported features & limits<IconArrowUpRight size={14} /></a><a href={`${source}/blob/main/apps/web-client/VERIFICATION.md`} target="_blank" rel="noopener noreferrer">Testing notes<IconArrowUpRight size={14} /></a><a href={`${source}/blob/main/apps/web-client/THIRD_PARTY_NOTICES.md`} target="_blank" rel="noopener noreferrer">Dependencies & licenses<IconArrowUpRight size={14} /></a></div>
    </section>
    <p className="devlog-end">Thanks for trying Opencaster.<span aria-hidden="true">♡</span></p>
  </div>;
}
