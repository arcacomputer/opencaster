import { describe, expect, it } from 'vitest';
import { buildQueries, collectReport, renderReport } from './report.mjs';

describe('shared private analytics dashboard', () => {
  it('renders a script-free period form only for authenticated dashboard responses', () => {
    const html = renderReport({}, { days: 30, dashboard: true });
    expect(html).toContain('method="get" action=""');
    expect(html).toContain('<label for="period">Reporting period</label>');
    expect(html).toContain('<option value="30" selected>Last 30 days</option>');
    for (const days of [1, 7, 30, 90]) expect(html).toContain(`<option value="${days}"`);
    expect(html).toContain('Refresh report');
    expect(html).toContain("form-action 'self'");
    expect(html).toContain('href="/cdn-cgi/access/logout"');
    expect(html).toContain('Signed in with Cloudflare Access');
    expect(html).not.toMatch(/<script|<iframe|onchange=|onclick=/i);
    const snapshot = renderReport({});
    expect(snapshot).toContain("form-action 'none'");
    expect(snapshot).not.toContain('<form');
    expect(snapshot).not.toContain('/cdn-cgi/access/logout');
  });

  it('uses readable country, source, page and action labels without claiming successful outcomes', () => {
    const html = renderReport({
      countries: [{ country: 'CL', events: 8 }, { country: 'US', events: 3 }, { country: 'XX', events: 1 }],
      sources: [{ name: 'direct', events: 12 }], pages: [{ page: 'cast', events: 11 }],
      clicks: [{ page: 'discover', name: 'connect-open', events: 9 }, { page: 'profile', name: 'nav-discover', events: 1 }, { page: 'profile', name: 'profile-tab-replies', events: 2 }],
    }, { dashboard: true });
    for (const label of ['Chile', 'United States', 'Unknown country', 'Direct / unknown referrer', 'Cast conversation', 'Open Connect', 'Open Discover', 'View profile replies']) expect(html).toContain(label);
    expect(html).toContain('includes apps and browsers that hide');
    expect(html).toContain('Opening Connect is not a completed sign-in');
    expect(html).toContain('They do not identify unique people');
  });

  it('displays an explicit UTC freshness timestamp and partial-day explanation', () => {
    const html = renderReport({ trend: [{ day: 1792713600, kind: 'visit', events: 8 }] }, { days: 1, dashboard: true, generatedAt: new Date('2026-10-24T06:49:37-03:00') });
    expect(html).toContain('datetime="2026-10-24T09:49:37.000Z"');
    expect(html).toContain('UTC</time>');
    expect(html).toContain('Last 24 hours');
    expect(html).toContain('current day and first day can be partial');
    expect(html).toContain('Day (UTC)');
    expect(html).toContain('Refresh for the latest available data');
  });

  it('preserves semantic table headers and keyboard access to overflowing tables', () => {
    const html = renderReport({ clicks: [{ page: 'connect', name: 'connect-open', events: 2 }] }, { dashboard: true });
    expect(html).toContain('<th scope="col">Action</th>');
    expect(html).toContain('tabindex="0" role="region" aria-label="Page, Action, Clicks"');
    expect(html).toContain('Skip to analytics');
  });

  it('supports the native Worker query adapter without passing a credential', async () => {
    const calls: Array<{ sql: string; token: string }> = [];
    const report = await collectReport(90, '', async (sql, token) => { calls.push({ sql, token }); return [{ events: '1' }]; });
    expect(calls).toHaveLength(10);
    expect(calls.every(call => call.token === '')).toBe(true);
    expect(Object.keys(report).sort()).toEqual(Object.keys(buildQueries(90)).sort());
    expect(report.countries).toEqual([{ events: '1' }]);
  });
});
