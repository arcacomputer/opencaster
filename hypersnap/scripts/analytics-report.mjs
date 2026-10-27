#!/usr/bin/env node
/** Read-only operator report. Credentials are used only in the API request header. */
import { readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { collectReport, renderReport } from '../analytics/report.mjs';
export { ACCOUNT_ID, DATASET, buildQueries, queryAnalytics, collectReport, escapeHtml, renderReport } from '../analytics/report.mjs';

export function parseArguments(args, now = new Date()) {
  const result = { days: 7, out: path.join(tmpdir(), `opencaster-analytics-${now.toISOString().replace(/[:.]/g, '-')}.html`), help: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--help' || option === '-h') { result.help = true; continue; }
    if (!['--days', '--out'].includes(option) || seen.has(option)) throw new Error('Use --days 1..90 and --out /path/report.html.');
    seen.add(option);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}.`);
    if (option === '--days') {
      if (!/^(?:[1-9]|[1-8][0-9]|90)$/.test(value)) throw new Error('--days must be an integer from 1 to 90.');
      result.days = Number(value);
    } else {
      if (value.includes('\0') || !/\.html?$/i.test(value)) throw new Error('--out must name an HTML file.');
      result.out = path.resolve(value);
    }
  }
  return result;
}

export async function readCredential({ env = process.env, home = homedir(), read = readFile } = {}) {
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  if (token) {
    if (/[\r\n]/.test(token)) throw new Error('The Cloudflare credential is invalid.');
    return token;
  }
  const locations = [path.join(home, 'Library/Preferences/.wrangler/config/default.toml'), path.join(home, '.config/.wrangler/config/default.toml')];
  for (const location of locations) {
    let source;
    try { source = await read(location, 'utf8'); } catch { continue; }
    const match = source.match(/^\s*oauth_token\s*=\s*"([^"\r\n]+)"\s*(?:#.*)?$/m);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  throw new Error('No Cloudflare credential is available. Sign in with Wrangler or set CLOUDFLARE_API_TOKEN.');
}

const numeric = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const number = value => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(numeric(value));
const sum = rows => rows.reduce((total, row) => total + numeric(row.events), 0);

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const options = parseArguments(args);
  if (options.help) {
    (dependencies.print ?? console.log)('Usage: node scripts/analytics-report.mjs [--days 1..90] [--out /path/report.html]\nReads Cloudflare Analytics Engine using CLOUDFLARE_API_TOKEN or an existing Wrangler login. Writes a private local HTML snapshot; no server is started.');
    return;
  }
  const token = await (dependencies.credential ?? readCredential)();
  const report = await (dependencies.collect ?? collectReport)(options.days, token);
  const html = renderReport(report, { days: options.days });
  try {
    // The parent directory must already exist. Refuse to replace a prior report.
    await (dependencies.write ?? writeFile)(options.out, html, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } catch { throw new Error('Unable to write the report. Choose a new HTML filename in an existing writable directory.'); }
  const count = kind => sum((report.totals ?? []).filter(row => row.kind === kind));
  (dependencies.print ?? console.log)(`${options.out}\n${number(count('visit'))} document visits · ${number(count('pageview'))} page views · ${number(count('click'))} clicks`);
  return options.out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Unable to create the analytics report.'); process.exitCode = 1; });
}
