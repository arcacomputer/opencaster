/** Read-only aggregate analytics shared by the local report and private Worker. No runtime-specific imports. */
export const ACCOUNT_ID = 'e320a5a80611f9a30148d452929b1fb1';
export const DATASET = 'opencaster_activity';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export function buildQueries(days) {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('Invalid analytics date range.');
  const window = `timestamp >= NOW() - INTERVAL '${days}' DAY`;
  const count = 'SUM(_sample_interval) AS events';
  const value = 'SUM(_sample_interval * double2) / SUM(_sample_interval) AS mean';
  const query = (select, where, group, limit = 200) => `SELECT ${select}, ${count}, ${value} FROM ${DATASET} WHERE ${window}${where ? ` AND ${where}` : ''} GROUP BY ${group} ORDER BY events DESC LIMIT ${limit} FORMAT JSON`;
  return {
    totals: query('blob1 AS kind', '', 'kind', 20),
    trend: query('intDiv(toUInt32(timestamp), 86400) * 86400 AS day, blob1 AS kind', '', 'day, kind', 900),
    pages: query('blob2 AS page', "blob1 = 'pageview'", 'page'),
    clicks: query('blob2 AS page, blob3 AS name', "blob1 = 'click'", 'page, name'),
    countries: query('blob4 AS country', "blob1 = 'visit'", 'country', 300),
    sources: query('blob3 AS name', "blob1 = 'visit'", 'name', 20),
    devices: query('blob5 AS device, blob6 AS browser', "blob1 = 'visit'", 'device, browser'),
    vitals: query('blob2 AS page, blob3 AS name', "blob1 = 'vital'", 'page, name'),
    requests: query('blob2 AS page, blob3 AS name', "blob1 = 'request'", 'page, name'),
    errors: query('blob2 AS page, blob3 AS name', "blob1 = 'error'", 'page, name'),
  };
}

export async function queryAnalytics(sql, token, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/analytics_engine/sql`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain; charset=utf-8' },
      body: sql, redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new Error('Unable to reach Cloudflare analytics. Check your connection and credential.'); }
  if (!response.ok) throw new Error(`Cloudflare analytics query failed (HTTP ${response.status}). Check analytics permission and whether data has arrived.`);
  const declaredLength = Number(response.headers.get('Content-Length'));
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error('Cloudflare analytics response exceeded the report limit.');
  let text;
  try {
    if (!response.body) throw new Error();
    const reader = response.body.getReader();
    const chunks = []; let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    text = new TextDecoder().decode(bytes);
  } catch { throw new Error('Cloudflare analytics response could not be read within the report limit.'); }
  try {
    const result = JSON.parse(text);
    if (!Array.isArray(result.data) || result.data.length > 1_000 || result.data.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error();
    return result.data;
  } catch { throw new Error('Cloudflare analytics returned an unexpected response.'); }
}

export async function collectReport(days, token, query = queryAnalytics) {
  const pending = Object.entries(buildQueries(days));
  const result = {};
  // Bound API concurrency even when additional charts are introduced.
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (pending.length) {
      const [name, sql] = pending.shift();
      result[name] = await query(sql, token);
    }
  }));
  return result;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

const numeric = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const number = value => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(numeric(value));
const measurement = row => new Intl.NumberFormat('en', { maximumFractionDigits: String(row.name).toLowerCase() === 'cls' ? 3 : 1 }).format(numeric(row.mean));
const sum = rows => rows.reduce((total, row) => total + numeric(row.events), 0);

function table(headers, rows, empty = 'No measurements received in this period.') {
  if (!rows.length) return `<p class="empty">${escapeHtml(empty)}</p>`;
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="${escapeHtml(headers.join(', '))}"><table><thead><tr>${headers.map(header => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function breakdown(rows, label, unit = 'visits') {
  const maximum = Math.max(1, ...rows.map(row => numeric(row.events)));
  return rows.length ? `<div class="breakdown">${rows.map(row => `<div class="bar-row"><div class="bar-label"><span>${escapeHtml(label(row))}</span><strong>${number(row.events)} <small>${escapeHtml(unit)}</small></strong></div><div class="bar-track" aria-hidden="true"><div style="width:${(numeric(row.events) / maximum * 100).toFixed(2)}%"></div></div></div>`).join('')}</div>` : '<p class="empty">No measurements received in this period.</p>';
}

function trendChart(rows) {
  const days = new Map();
  for (const row of rows) {
    const timestamp = numeric(row.day) * 1000;
    if (timestamp < Date.UTC(2020, 0, 1) || timestamp > Date.UTC(2100, 0, 1)) continue;
    const key = new Date(timestamp).toISOString().slice(0, 10);
    if (!days.has(key)) days.set(key, { visit: 0, pageview: 0, click: 0, error: 0 });
    if (Object.hasOwn(days.get(key), row.kind)) days.get(key)[row.kind] += numeric(row.events);
  }
  const values = [...days].sort(([left], [right]) => left.localeCompare(right));
  if (!values.length) return '<p class="empty">No daily activity received in this period.</p>';
  const maximum = Math.max(1, ...values.map(([, day]) => Math.max(day.visit, day.pageview)));
  return `<div class="daily" role="img" aria-label="Daily document visits and page views, UTC">${values.map(([day, value]) => `<div class="daily-column" title="${escapeHtml(`${day}: ${number(value.visit)} visits, ${number(value.pageview)} page views`)}"><div class="daily-bars"><span style="height:${Math.max(1, value.visit / maximum * 100).toFixed(2)}%"></span><span style="height:${Math.max(1, value.pageview / maximum * 100).toFixed(2)}%"></span></div><small>${escapeHtml(day.slice(5))}</small></div>`).join('')}</div><p class="legend"><span>● Visits</span><span>● Page views</span></p>${table(['Day (UTC)', 'Visits', 'Page views', 'Clicks', 'Errors'], values.map(([day, value]) => [day, number(value.visit), number(value.pageview), number(value.click), number(value.error)]))}`;
}

const PAGE_NAMES = {
  discover: 'Discover', following: 'Following', bookmarks: 'Bookmarks', notifications: 'Notifications',
  channels: 'Channels', devlog: 'Dev log', settings: 'Settings', connect: 'Connect', search: 'Search',
  channel: 'Channel', profile: 'Profile', cast: 'Cast conversation', 'not-found': 'Not found',
  api: 'API', asset: 'Static assets', page: 'Website pages', media: 'Media', other: 'Other',
};
const SOURCE_NAMES = {
  direct: 'Direct / unknown referrer', search: 'Search engines', social: 'Social websites',
  github: 'GitHub', internal: 'Within Opencaster', other: 'Other websites',
};
const ACTION_NAMES = {
  'connect-open': 'Open Connect', 'landing-explore': 'Explore the site',
  'theme-toggle': 'Change theme', 'composer-open': 'Open composer',
  'node-support-open': 'Open support options', 'source-open': 'Open source code',
  'hypersnap-open': 'Open Hypersnap', 'shortcuts-open': 'Open keyboard shortcuts',
  'cast-open': 'Open a cast', 'cast-parent-open': 'Open parent cast',
  'cast-replies-open': 'Open replies', 'cast-quote-open': 'Open a quoted cast',
  'cast-delete-open': 'Open cast deletion', 'cast-share-open': 'Open cast sharing',
  'cast-options-open': 'Open cast options', 'cast-image-open': 'Open cast image',
  'cast-quotes-open': 'Open quotes', 'cast-reactions-open': 'Open reactions',
  'cast-copy-text': 'Copy cast text', 'cast-like': 'Like a cast', 'cast-unlike': 'Unlike a cast',
  'cast-recast-menu-open': 'Open recast menu', 'cast-recast': 'Recast', 'cast-unrecast': 'Undo recast',
  'bookmark-add': 'Add bookmark', 'bookmark-remove': 'Remove bookmark',
  'bookmarks-clear': 'Clear bookmarks', 'bookmarks-sort': 'Sort bookmarks',
  'profile-open': 'Open a profile', 'profile-share-open': 'Open profile sharing',
  'profile-follow': 'Follow a profile', 'profile-unfollow': 'Unfollow a profile',
  'profile-followers-open': 'Open followers', 'profile-following-open': 'Open following',
  'profile-edit-open': 'Open profile editor', 'device-access-open': 'Open device access',
  'session-lock': 'Lock session', 'feed-refresh': 'Refresh feed', 'feed-more': 'Load more casts',
  'feed-window': 'Change feed period', 'search-submit': 'Submit search',
  'search-kind-casts': 'Search casts', 'search-kind-users': 'Search people',
  'notifications-refresh': 'Refresh notifications', 'notifications-mark-read': 'Mark notifications read',
  'notifications-filter': 'Filter notifications', 'channel-search': 'Search channels',
  'channel-directory': 'Open channel directory', 'channel-save': 'Save channel',
  'channel-unsave': 'Unsave channel', 'channel-participants-open': 'Open channel participants',
  'composer-image': 'Add image', 'composer-mentions': 'Open mention picker',
  'composer-emoji': 'Open emoji picker', 'composer-drafts': 'Open drafts',
  'composer-info': 'Open media information', 'draft-save': 'Save draft',
  'draft-restore': 'Restore draft', 'draft-discard': 'Discard draft',
  'publish-cast': 'Submit cast', 'publish-reply': 'Submit reply', 'publish-quote': 'Submit quote',
  'share-copy': 'Copy sharing link', 'share-native': 'Open device sharing',
  'content-controls-open': 'Open content controls', 'content-reveal': 'Reveal content',
};
const friendly = (value, names = {}) => Object.hasOwn(names, value) ? names[value] : (value ? String(value) : 'Unknown');
const pageName = value => friendly(value, PAGE_NAMES);
const actionName = value => {
  if (Object.hasOwn(ACTION_NAMES, value)) return ACTION_NAMES[value];
  if (String(value).startsWith('nav-') && Object.hasOwn(PAGE_NAMES, String(value).slice(4))) return `Open ${pageName(String(value).slice(4))}`;
  if (String(value).startsWith('profile-tab-')) {
    const tab = String(value).slice(12);
    if (['casts', 'replies', 'media', 'likes', 'recasts'].includes(tab)) return `View profile ${tab}`;
  }
  return friendly(value);
};
function countryName(value) {
  if (!value || value === 'XX') return 'Unknown country';
  if (!/^[A-Z]{2}$/.test(value)) return String(value);
  try { return new Intl.DisplayNames('en', { type: 'region' }).of(value) || value; }
  catch { return value; }
}
const categoryName = value => friendly(value, { chrome: 'Chrome', safari: 'Safari', firefox: 'Firefox', edge: 'Edge', desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet', other: 'Other', uncaught: 'Uncaught error', 'unhandled-rejection': 'Unhandled rejection' });

/** Render a standalone snapshot or an authenticated, script-free dashboard. */
export function renderReport(report, { days = 7, generatedAt = new Date(), dashboard = false } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('Invalid analytics date range.');
  const rows = key => Array.isArray(report[key]) ? report[key] : [];
  const total = kind => sum(rows('totals').filter(row => row.kind === kind));
  const requestRows = rows('requests');
  const requestCount = sum(requestRows);
  const requestMean = requestCount ? requestRows.reduce((value, row) => value + numeric(row.mean) * numeric(row.events), 0) / requestCount : 0;
  const serverErrors = sum(requestRows.filter(row => row.name === '5xx'));
  const cards = [['Document visits', total('visit'), 'Page loads, including reloads'], ['Page views', total('pageview'), 'Loads and navigation within the app'], ['Recorded clicks', total('click'), 'Interface actions, not confirmed outcomes'], ['Browser errors', total('error'), 'Counts only; no messages or stacks']];
  const section = (title, description, contents, wide = false) => `<section class="panel${wide ? ' wide' : ''}"><h2>${escapeHtml(title)}</h2><p class="description">${escapeHtml(description)}</p>${contents}</section>`;
  const timestamp = generatedAt.toISOString();
  const readableTime = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(generatedAt);
  const period = days === 1 ? 'Last 24 hours' : `Last ${number(days)} days`;
  const controls = dashboard
    ? `<form class="controls" method="get" action=""><div class="range"><label for="period">Reporting period</label><select id="period" name="days">${[1, 7, 30, 90].map(value => `<option value="${value}"${days === value ? ' selected' : ''}>${value === 1 ? 'Last 24 hours' : `Last ${value} days`}</option>`).join('')}</select></div><button type="submit">Refresh report <span aria-hidden="true">↻</span></button></form>`
    : `<span class="period">${escapeHtml(period)}</span>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action '${dashboard ? 'self' : 'none'}'"><title>Opencaster · ${dashboard ? 'Private analytics' : 'Analytics report'}</title><style>
*{box-sizing:border-box}html{color-scheme:light}body{margin:0;background:#f5f5f1;color:#162b27;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:#285d4c;text-underline-offset:3px}a:hover{color:#143e30}button,select{font:inherit}button,select,a{touch-action:manipulation}:focus-visible{outline:3px solid #287a58;outline-offset:4px}.skip{position:absolute;top:-100px;left:20px;background:#fff;padding:12px;z-index:1}.skip:focus{top:10px}main{max-width:1280px;margin:auto;padding:34px 30px 60px}.topline{display:flex;justify-content:space-between;align-items:center;gap:18px;margin-bottom:30px}.eyebrow{font-size:11px;font-weight:800;letter-spacing:.15em;color:#45675b;text-transform:uppercase}.account{display:flex;align-items:center;gap:16px;font-size:12px}.private{display:inline-flex;align-items:center;gap:7px;color:#416451}.private:before{content:'';height:6px;width:6px;border-radius:50%;background:#43875d}header{display:flex;justify-content:space-between;gap:28px;align-items:center;margin-bottom:28px}h1{font-size:clamp(30px,4vw,44px);letter-spacing:-.05em;line-height:1.1;margin:0 0 12px}header p{margin:0;color:#536b62;font-size:13px}.freshness{margin-top:7px;font-size:11px;color:#536b62}.period{padding:10px 15px;border:1px solid #c3d3c8;border-radius:99px;white-space:nowrap;font-weight:700;font-size:13px}.controls{display:flex;gap:10px;align-items:flex-end;flex-shrink:0}.range label{display:block;font-size:11px;font-weight:600;color:#52695e;margin-bottom:5px}select{display:block;min-height:43px;border:1px solid #b6c9bd;border-radius:8px;background:#fff;color:#163e2e;padding:9px 30px 9px 12px;font-size:12px}button{min-height:43px;border:1px solid #183e34;border-radius:8px;background:#183e34;color:#fff;font-size:12px;font-weight:650;padding:10px 15px;cursor:pointer;white-space:nowrap}button span{font-size:16px;margin-left:8px}button:hover{background:#285b47}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px}.card{background:#183e34;color:#fff;border-radius:15px;padding:22px}.card span{font-size:12px;color:#c3e1d2}.card strong{display:block;font-size:38px;letter-spacing:-.05em;margin:5px 0;font-variant-numeric:tabular-nums}.card p{margin:0;font-size:11px;color:#c3e1d2}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.panel{border:1px solid #dce4da;border-radius:16px;background:#fff;padding:25px;min-width:0}.wide{grid-column:1/-1}h2{font-size:19px;letter-spacing:-.025em;margin:0 0 4px}.description,.empty{font-size:12px;color:#536b60;margin:0 0 20px}.empty{padding:25px 0}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:12px;text-align:left}th{color:#536b60;font-weight:600;font-size:11px}th,td{border-bottom:1px solid #e8eee5;padding:11px 10px;overflow-wrap:anywhere}th:first-child,td:first-child{padding-left:0}td{font-variant-numeric:tabular-nums}tbody tr:last-child td{border-bottom:0}.bar-row{margin-top:16px}.bar-label{display:flex;justify-content:space-between;gap:10px;font-size:12px;margin-bottom:7px}.bar-label span{overflow-wrap:anywhere}.bar-label strong{white-space:nowrap;font-variant-numeric:tabular-nums}.bar-label small{font-size:10px;font-weight:400;color:#536b60}.bar-track{height:7px;border-radius:8px;background:#edf3ed;overflow:hidden}.bar-track div{height:100%;background:#438f6e;border-radius:8px}.daily{height:145px;display:flex;gap:8px;align-items:flex-end;overflow-x:auto;margin-top:26px}.daily-column{height:100%;flex:1;min-width:24px;text-align:center}.daily-bars{height:120px;display:flex;gap:3px;justify-content:center;align-items:flex-end}.daily-bars span{background:#235c49;min-height:1px;width:38%;max-width:35px;border-radius:3px 3px 0 0}.daily-bars span+span{background:#9ad2b3}.daily-column small{font-size:9px;color:#536b60;white-space:nowrap}.legend{display:flex;justify-content:flex-end;gap:17px;font-size:11px;color:#235c49}.legend span+span{color:#487c5b}.stats{display:flex;gap:25px;flex-wrap:wrap;margin:17px 0 22px}.stats strong{display:block;font-size:25px;letter-spacing:-.04em}.stats span{font-size:11px;color:#536b60}.note{margin:24px 0 0;padding:24px;border-radius:15px;background:#e9eee4;color:#415a41;font-size:12px}.note h2{font-size:14px;color:#2b462e;margin-bottom:8px}.note p{margin:7px 0}footer{font-size:11px;color:#536b60;margin-top:22px;overflow-wrap:anywhere}@media(max-width:920px){header{align-items:flex-start;flex-direction:column;gap:20px}.controls{width:100%;justify-content:flex-start}}@media(max-width:620px){main{padding:24px 16px 40px}.topline{align-items:flex-start;flex-direction:column;gap:10px;margin-bottom:25px}.account{justify-content:space-between;width:100%}.cards{grid-template-columns:1fr 1fr;gap:10px}.grid{grid-template-columns:1fr;gap:15px}.wide{grid-column:auto}.card{padding:17px}.card strong{font-size:31px}.panel{padding:20px}.card p{font-size:10px}.controls{gap:8px}.range{flex:1}select{width:100%}button{padding:10px 12px}}@media(prefers-reduced-motion:no-preference){button{transition:background .15s ease}}@media print{body{background:white}main{padding:15px}.controls,.account,.skip{display:none}.panel,.card{break-inside:avoid}.card{border:1px solid #cbd7ce;color:#183e34;background:#f5faf5}.card span,.card p{color:#385b46}.daily{height:110px}.daily-bars{height:85px}}
</style></head><body><a class="skip" href="#activity">Skip to analytics</a><main><div class="topline"><div class="eyebrow">OPENCASTER / ${dashboard ? 'PRIVATE ANALYTICS' : 'OPERATOR ANALYTICS'}</div>${dashboard ? '<div class="account"><span class="private">Signed in with Cloudflare Access</span><a href="/cdn-cgi/access/logout">Sign out</a></div>' : '<span class="private">Private local snapshot</span>'}</div><header><div><h1>A clearer view of activity.</h1><p>opencaster.org · Aggregate usage and service performance</p><p class="freshness">${dashboard ? 'Updated' : 'Generated'} <time datetime="${escapeHtml(timestamp)}">${escapeHtml(readableTime)} UTC</time>${dashboard ? ' · Refresh for the latest available data' : ''}</p></div>${controls}</header><div class="cards" id="activity">${cards.map(([label, value, caption]) => `<div class="card"><span>${escapeHtml(label)}</span><strong>${number(value)}</strong><p>${escapeHtml(caption)}</p></div>`).join('')}</div><div class="grid">
${section('Activity over time', 'UTC calendar days. The current day and first day can be partial. Data appears after collection begins.', trendChart(rows('trend')), true)}
${section('Countries', 'Country-level location for document visits. No IP addresses are stored in this analytics dataset.', breakdown(rows('countries'), row => countryName(row.country)))}
${section('Traffic sources', 'Direct / unknown referrer includes apps and browsers that hide where a visit came from. Only broad source categories are retained.', breakdown(rows('sources'), row => friendly(row.name, SOURCE_NAMES)))}
${section('Pages people open', 'Page categories contain no profile, cast or channel identifiers.', breakdown(rows('pages'), row => pageName(row.page), 'views'))}
${section('What people do', 'Recorded interface clicks measure intent. Opening Connect is not a completed sign-in; publishing or social clicks do not confirm a successful operation.', table(['Page', 'Action', 'Clicks'], rows('clicks').map(row => [pageName(row.page), actionName(row.name), number(row.events)])))}
${section('Devices & browsers', 'Broad categories observed on document visits.', table(['Device', 'Browser', 'Visits'], rows('devices').map(row => [categoryName(row.device), categoryName(row.browser), number(row.events)])))}
${section('Browser performance', 'Weighted arithmetic means. Timing values are milliseconds; CLS is unitless. These are diagnostic averages, not Core Web Vitals pass/fail scores.', table(['Page', 'Measurement', 'Samples', 'Mean'], rows('vitals').map(row => [pageName(row.page), row.name, number(row.events), measurement(row)])))}
${section('Browser errors', 'Fixed error categories only. Error messages, stacks and page contents are excluded.', table(['Page', 'Category', 'Events'], rows('errors').map(row => [pageName(row.page), categoryName(row.name), number(row.events)])))}
${section('Service health', 'Worker requests include automated traffic and are separate from browser visits. Latency measures response creation, excluding response-body streaming.', `<div class="stats"><div><strong>${number(requestCount)}</strong><span>requests</span></div><div><strong>${number(requestMean)} ms</strong><span>mean response latency</span></div><div><strong>${number(serverErrors)}</strong><span>5xx responses</span></div></div>${table(['Route category', 'Status', 'Requests', 'Mean latency (ms)'], requestRows.map(row => [pageName(row.page), row.name, number(row.events), number(row.mean)]))}<p class="description"><a href="https://dash.cloudflare.com/${ACCOUNT_ID}/workers/services/view/hypersnap-quorum/production/metrics" target="_blank" rel="noopener noreferrer">Open Cloudflare Worker metrics</a> for request outcomes, CPU time and platform limits. Cloudflare account sign-in is required.</p>`, true)}
</div><aside class="note"><h2>How to read these numbers</h2><p>Visits count document loads, including reloads. They do not identify unique people, returning visitors or individual sessions. Page views also include navigation within the app.</p><p>Counts are approximate: Analytics Engine can sample data, and this report applies Cloudflare’s sample weights. Browser submissions are untrusted, so bots, our testing or fabricated requests may affect the numbers. Missing measurements are not proof of zero activity.</p><p>Browser activity is absent when Do Not Track, Global Privacy Control or the site’s analytics opt-out is enabled, when scripts or reporting requests are blocked, or when a browser does not support a measurement.</p><p>Analytics Engine retains data for about 90 days. ${dashboard ? 'This dashboard shows aggregates to authorized operators and refreshes when you submit the reporting period. It does not provide a visitor list or individual browsing history.' : 'This local snapshot contains aggregate statistics only; it has no credential, script, external asset or live data connection.'}</p></aside><footer>${dashboard ? 'Private dashboard · Read-only aggregate analytics' : `Generated ${escapeHtml(timestamp)} · Dataset ${escapeHtml(DATASET)} · Read-only Cloudflare Analytics Engine report`} · Daily date bins use UTC</footer></main></body></html>`;
}

