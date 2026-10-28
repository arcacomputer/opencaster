import { useState } from 'react';
import { analyticsDisabled, analyticsPrivacySignal, setAnalyticsDisabled } from '../lib/analytics';
import { Button } from './ui';

export default function AnalyticsSettings() {
  const [disabled, setDisabled] = useState(analyticsDisabled);
  const [status, setStatus] = useState('');
  const signal = analyticsPrivacySignal();
  return <section className="settings-shortcuts" aria-labelledby="analytics-settings-heading">
    <h2 id="analytics-settings-heading">Privacy &amp; analytics</h2>
    <p>Opencaster uses Cloudflare to count visits, page categories and selected button actions, and measure page performance and error counts. Visits are estimates, not a count of unique people.</p>
    <p>Browser usage analytics uses no cookies or visitor IDs. It does not collect account names, wallet data, cast text, search text or the profile, channel or cast you open. No session recording is used.</p>
    <p>This setting controls browser usage analytics. Cloudflare still processes requests to serve the site and measure aggregate request health. Browser Do Not Track and Global Privacy Control signals are also honored by the site’s custom request counters.</p>
    <p>{signal ? 'Your browser’s Do Not Track or Global Privacy Control signal has disabled browser usage analytics.' : disabled ? 'Browser usage analytics is off in this browser.' : 'Browser usage analytics is on. You can turn it off for this browser.'}</p>
    <Button variant="secondary" aria-pressed={disabled} disabled={signal} onClick={() => {
      const next = !disabled;
      const saved = setAnalyticsDisabled(next);
      setDisabled(next);
      setStatus(saved ? 'Preference saved on this browser.' : 'Preference applies to this tab. Browser storage is unavailable.');
    }}>{disabled ? 'Turn on site analytics' : 'Turn off site analytics'}</Button>
    {status && <p role="status">{status}</p>}
  </section>;
}
