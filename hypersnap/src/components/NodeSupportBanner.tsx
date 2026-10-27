import { useId, useState } from 'react';
import { IconArrowUpRight, IconServer, IconX } from '@tabler/icons-react';
import { Button } from './ui';
import { NODE_SUPPORT_URL } from '../lib/nodeSupport';
import './node-support.scss';

const dismissalKey = 'opencaster.nodeSupport.dismissed.v1';

export default function NodeSupportBanner({ visible }: { visible: boolean }) {
  const titleId = useId();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(dismissalKey) === 'true'; } catch { return false; }
  });
  if (!visible || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(dismissalKey, 'true'); } catch { /* Still dismiss for this app session when storage is unavailable. */ }
  }

  return <section className="node-support" aria-labelledby={titleId}>
    <IconServer className="node-support__icon" size={22} aria-hidden="true" />
    <div className="node-support__body">
      <h2 id={titleId}>Help us run our own Hypersnap node</h2>
      <p>Support our open-source work and help Arca Computer fund an independently operated node for Opencaster.</p>
      <div className="node-support__actions">
        <a data-analytics="node-support-open" className="button button--secondary" href={NODE_SUPPORT_URL} target="_blank" rel="noopener noreferrer">Support the node <IconArrowUpRight size={16} aria-hidden="true" /><span className="node-support__sr-only"> (opens Stripe in a new tab)</span></a>
        <small>Optional one-time support · Processed by Stripe</small>
      </div>
    </div>
    <Button variant="ghost" className="node-support__dismiss" aria-label="Dismiss node support banner" onClick={dismiss}><IconX size={18} aria-hidden="true" /></Button>
  </section>;
}
