import { useState } from 'react';
import { IconArrowDown, IconArrowUpRight, IconCode, IconHistory, IconShieldLock, IconWorld } from '@tabler/icons-react';
import { DEV_LOG, PROJECT_STARTED_DATE, type DevLogMilestone } from '../lib/devLog';
import { Button } from './ui';
import '../devlog.scss';

const source = 'https://github.com/arcacomputer/opencaster';
const categories = ['Launch', 'Wallets', 'Security', 'Social', 'Reliability'] as const;
const labels = { Launch: 'The beginning', Wallets: 'Wallets', Security: 'Security', Social: 'Features', Reliability: 'Reliability' };
function dateLabel(date: string) {
  // Milestones are calendar dates, independent of the visitor's timezone.
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

export default function DevLog() {
  const [category, setCategory] = useState<DevLogMilestone['tag'] | 'all'>('all');
  const [oldestFirst, setOldestFirst] = useState(false);
  const entries = DEV_LOG.filter(entry => category === 'all' || entry.tag === category);
  const visible = oldestFirst ? [...entries].reverse() : entries;
  return <div className="devlog">
    <section className="devlog-intro" aria-labelledby="devlog-story">
      <span className="devlog-kicker"><IconHistory size={15} aria-hidden="true" />BUILDING OPENCASTER, IN PUBLIC</span>
      <h2 id="devlog-story">The story so far<span>✳</span></h2>
      <p>From a Quorum fork to Opencaster, an open source client for everyone. Here’s what we’ve shipped on Hypersnap, what changed along the way, and why.</p>
      <dl className="devlog-facts"><div><dt>First commit</dt><dd><time dateTime={PROJECT_STARTED_DATE}>{dateLabel(PROJECT_STARTED_DATE)}</time></dd></div><div><dt>Milestones</dt><dd>{DEV_LOG.length} and counting</dd></div><div><dt>Latest update</dt><dd><time dateTime={DEV_LOG[0].date}>{dateLabel(DEV_LOG[0].date)}</time></dd></div></dl>
      <div className="devlog-intro__actions"><Button variant="secondary" aria-pressed={oldestFirst} onClick={() => { setOldestFirst(value => !value); setCategory('all'); }}><IconArrowDown size={16} aria-hidden="true" />{oldestFirst ? 'Show latest first' : 'Read from the beginning'}</Button><a href={`${source}/commits/main/hypersnap`} target="_blank" rel="noopener noreferrer">Explore the commits<IconArrowUpRight size={15} aria-hidden="true" /></a></div>
    </section>

    <nav className="devlog-filters" aria-label="Dev log topics"><Button variant="ghost" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>All updates</Button>{categories.map(tag => <Button key={tag} variant="ghost" aria-pressed={category === tag} onClick={() => setCategory(tag)}>{labels[tag]}</Button>)}</nav>
    <div className="devlog-order" role="status"><span>{category === 'all' ? 'Every step of the way' : labels[category]}</span><span>{oldestFirst ? 'Oldest first' : 'Latest first'} · {visible.length} updates</span></div>

    <ol className="devlog-timeline" aria-label="Project milestones">{visible.map(entry => <li key={entry.id}>
      <article className="devlog-entry" id={entry.id} aria-labelledby={`${entry.id}-title`}>
        <div className="devlog-entry__meta"><time dateTime={entry.date}>{dateLabel(entry.date)}</time><span className={`devlog-tag devlog-tag--${entry.tag.toLowerCase()}`}>{labels[entry.tag]}</span></div>
        <h3 id={`${entry.id}-title`}>{entry.title}</h3><p>{entry.summary}</p>
        <ul>{entry.changes.map(change => <li key={change}>{change}</li>)}</ul>
        <a className="devlog-commit" href={entry.commit} target="_blank" rel="noopener noreferrer" aria-label={`View code for ${entry.title}`}><IconCode size={14} aria-hidden="true" />View the change<span>{entry.commit.split('/').pop()!.slice(0, 7)}</span><IconArrowUpRight size={14} aria-hidden="true" /></a>
      </article>
    </li>)}</ol>

    <section className="devlog-principles" aria-labelledby="devlog-principles-title"><h2 id="devlog-principles-title">What guides the work</h2><div><IconShieldLock size={20} aria-hidden="true" /><p><strong>Recovery words stay in your wallet.</strong>The current website uses wallet-approved device keys. Optional passkeys protect a saved device key in this browser.</p></div><div><IconWorld size={20} aria-hidden="true" /><p><strong>Social activity runs on Hypersnap.</strong>Our Cloudflare gateway connects to the community-operated Hypersnap node. Optional WalletConnect uses an external relay.</p></div><div><IconCode size={20} aria-hidden="true" /><p><strong>Progress you can inspect.</strong>Every milestone links to its code. This is a beta; isolated tests don’t replace an independent security audit or testing every device.</p></div>
      <div className="devlog-reference-links"><a href={`${source}/blob/main/apps/web-client/FEATURE_SUPPORT.md`} target="_blank" rel="noopener noreferrer">Supported features & limits<IconArrowUpRight size={14} /></a><a href={`${source}/blob/main/apps/web-client/VERIFICATION.md`} target="_blank" rel="noopener noreferrer">Testing notes<IconArrowUpRight size={14} /></a><a href={`${source}/blob/main/apps/web-client/THIRD_PARTY_NOTICES.md`} target="_blank" rel="noopener noreferrer">Dependencies & licenses<IconArrowUpRight size={14} /></a></div>
    </section>
    <p className="devlog-end">Thanks for being here while we build.<span aria-hidden="true">♡</span></p>
  </div>;
}
