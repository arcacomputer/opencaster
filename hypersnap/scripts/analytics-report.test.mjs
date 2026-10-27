import { describe, expect, it } from 'vitest';
import { buildQueries, collectReport, escapeHtml, main, parseArguments, queryAnalytics, readCredential, renderReport } from './analytics-report.mjs';

describe('analytics report operator boundaries', () => {
  it('validates the date window and output filename before accessing credentials', () => {
    expect(parseArguments(['--days', '90', '--out', '/tmp/report.html'])).toMatchObject({ days: 90, out: '/tmp/report.html' });
    for (const value of ['0', '91', '-1', '1.5', '01', "7' OR 1=1"]) expect(() => parseArguments(['--days', value])).toThrow();
    for (const args of [['--unknown'], ['--out'], ['--out', 'report.js'], ['--days', '7', '--days', '2'], ['--out', 'x\0.html']]) expect(() => parseArguments(args)).toThrow();
  });

  it('prefers the environment token without reading Wrangler files', async () => {
    const read = () => { throw new Error('Must not read'); };
    expect(await readCredential({ env: { CLOUDFLARE_API_TOKEN: ' env-test-token ' }, read })).toBe('env-test-token');
    await expect(readCredential({ env: { CLOUDFLARE_API_TOKEN: 'token\nInjected: bad' }, read })).rejects.toThrow('credential is invalid');
  });

  it('reads only the OAuth token from supported Wrangler config paths', async () => {
    const locations = [];
    const read = async location => { locations.push(location); if (location.includes('Library/Preferences')) throw new Error(); return '# other_secret = "never-return"\noauth_token = "oauth-test-token"\n'; };
    expect(await readCredential({ env: {}, home: '/synthetic-home', read })).toBe('oauth-test-token');
    expect(locations).toEqual(['/synthetic-home/Library/Preferences/.wrangler/config/default.toml', '/synthetic-home/.config/.wrangler/config/default.toml']);
  });

  it('does not echo config content or read errors when a credential is missing', async () => {
    const read = async () => { throw new Error('SENSITIVE-CONFIG-CONTENTS'); };
    await expect(readCredential({ env: {}, read })).rejects.toThrow('No Cloudflare credential');
    await expect(readCredential({ env: {}, read })).rejects.not.toThrow('SENSITIVE');
  });

  it('uses sample-weighted counts and means with a bounded, literal date window', () => {
    const queries = buildQueries(7);
    expect(Object.keys(queries)).toHaveLength(10);
    for (const sql of Object.values(queries)) {
      expect(sql).toContain('SUM(_sample_interval) AS events');
      expect(sql).toContain('SUM(_sample_interval * double2) / SUM(_sample_interval) AS mean');
      expect(sql).toContain("timestamp >= NOW() - INTERVAL '7' DAY");
      expect(sql).toContain('FROM opencaster_activity');
      expect(sql).toMatch(/^SELECT .* FORMAT JSON$/);
      expect(sql).not.toMatch(/COUNT\(|INSERT|UPDATE|DELETE/);
    }
    expect(queries.clicks).toContain("blob1 = 'click'");
    expect(queries.devices).toContain('blob5 AS device, blob6 AS browser');
    expect(queries.sources).toContain("blob1 = 'visit'");
    expect(() => buildQueries("7'" )).toThrow();
  });

  it('sends credentials only in the fixed Cloudflare request header', async () => {
    let captured;
    const fetcher = async (url, options) => { captured = { url, options }; return new Response(JSON.stringify({ data: [{ kind: 'visit', events: 3 }] })); };
    expect(await queryAnalytics('SELECT safe', 'PRIVATE-TEST-TOKEN', fetcher)).toEqual([{ kind: 'visit', events: 3 }]);
    expect(captured.url).toBe('https://api.cloudflare.com/client/v4/accounts/e320a5a80611f9a30148d452929b1fb1/analytics_engine/sql');
    expect(captured.options).toMatchObject({ method: 'POST', body: 'SELECT safe', redirect: 'error', headers: { Authorization: 'Bearer PRIVATE-TEST-TOKEN' } });
    expect(captured.url).not.toContain('PRIVATE');
  });

  it('redacts network, HTTP and malformed response failures', async () => {
    const failures = [async () => { throw new Error('PRIVATE-TEST-TOKEN'); }, async () => new Response('PRIVATE-TEST-TOKEN', { status: 403 }), async () => new Response('PRIVATE-TEST-TOKEN'), async () => new Response('{"data":[null]}')];
    for (const fetcher of failures) {
      try { await queryAnalytics('SELECT safe', 'PRIVATE-TEST-TOKEN', fetcher); throw new Error('Expected failure'); }
      catch (error) { expect(error.message).not.toContain('PRIVATE-TEST-TOKEN'); expect(error.message).not.toBe('Expected failure'); }
    }
  });

  it('bounds response bytes before rendering any response data', async () => {
    await expect(queryAnalytics('SELECT safe', 'test', async () => new Response('{}', { headers: { 'Content-Length': '5000000' } }))).rejects.toThrow('report limit');
    await expect(queryAnalytics('SELECT safe', 'test', async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)))).rejects.toThrow('report limit');
  });

  it('bounds independent queries to four concurrent requests and preserves their keys', async () => {
    let running = 0; let maximum = 0; let calls = 0;
    const result = await collectReport(7, 'test', async () => {
      running++; maximum = Math.max(maximum, running); calls++;
      await new Promise(resolve => setTimeout(resolve, 1)); running--; return [];
    });
    expect(maximum).toBe(4); expect(calls).toBe(10);
    expect(Object.keys(result).sort()).toEqual(Object.keys(buildQueries(7)).sort());
  });

  it('escapes every untrusted chart and table label and generates no executable content', () => {
    const attack = '<script>alert("x")</script><img src="https://evil.invalid">&\'';
    const report = { totals: [{ kind: 'visit', events: 4 }], pages: [{ page: attack, events: 4 }], clicks: [{ page: attack, name: attack, events: 1 }], countries: [{ country: attack, events: 2 }], sources: [{ name: attack, events: 2 }], devices: [{ device: attack, browser: attack, events: 2 }], vitals: [{ page: attack, name: attack, events: 1, mean: 50 }], requests: [{ page: attack, name: attack, events: 3, mean: 20 }], errors: [{ page: attack, name: attack, events: 1 }] };
    const html = renderReport(report, { generatedAt: new Date('2026-10-23T12:00:00Z') });
    expect(html).not.toContain(attack); expect(html).toContain(escapeHtml(attack));
    expect(html).not.toMatch(/<script|<img|<iframe|<link|<form|onerror=/i);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('They do not identify unique people');
    expect(html).toContain('Do Not Track'); expect(html).toContain('Global Privacy Control');
  });

  it('calculates combined backend latency with request counts, not a mean of means', () => {
    const html = renderReport({ requests: [{ page: 'api', name: '2xx', events: 90, mean: 100 }, { page: 'api', name: '5xx', events: 10, mean: 1_000 }] });
    expect(html).toContain('190 ms'); expect(html).toContain('<strong>10</strong><span>5xx responses');
    expect(renderReport({})).toContain('No measurements received');
    expect(renderReport({ vitals: [{ page: 'discover', name: 'CLS', events: 100, mean: 0.039 }] })).toContain('0.039');
  });

  it('writes a private create-only snapshot without embedding the credential', async () => {
    let written; const printed = [];
    const output = await main(['--out', '/tmp/isolated-report.html'], {
      credential: async () => 'PRIVATE-TEST-TOKEN', collect: async () => ({ totals: [{ kind: 'visit', events: 12 }] }),
      write: async (...args) => { written = args; }, print: message => printed.push(message),
    });
    expect(output).toBe('/tmp/isolated-report.html');
    expect(written[2]).toEqual({ encoding: 'utf8', mode: 0o600, flag: 'wx' });
    expect(written[1]).not.toContain('PRIVATE-TEST-TOKEN');
    expect(printed.join('')).not.toContain('PRIVATE-TEST-TOKEN');
    expect(printed.join('')).toContain('12 document visits');
  });

  it('reports output failures without exposing filesystem error details', async () => {
    await expect(main(['--out', '/tmp/isolated-report.html'], { credential: async () => 'test', collect: async () => ({}), write: async () => { throw new Error('SECRET-FS-DATA'); } })).rejects.toThrow('Choose a new HTML filename');
  });

  it('help performs no authentication, query or write', async () => {
    let help;
    await main(['--help'], { credential: () => { throw new Error('Must not authenticate'); }, print: value => { help = value; } });
    expect(help).toContain('Usage:');
  });
});
