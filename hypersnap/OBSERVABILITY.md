# Opencaster statistics

Opencaster records first-party aggregate usage and health measurements in the
Cloudflare Analytics Engine dataset `opencaster_activity`. The existing
[Worker metrics dashboard](https://dash.cloudflare.com/e320a5a80611f9a30148d452929b1fb1/workers/services/view/hypersnap-quorum/production/metrics)
also provides infrastructure request counts, errors and CPU measurements.
The [Worker events dashboard](https://dash.cloudflare.com/e320a5a80611f9a30148d452929b1fb1/workers/services/view/hypersnap-quorum/production/observability/events)
provides persisted platform invocation logs for request diagnostics.

## Private hosted dashboard

Open the [private analytics dashboard](https://analytics.opencaster.org) and
sign in with the approved Cloudflare account. The separate `analytics/worker.ts`
application renders the existing aggregate report on each authenticated request,
with 1-, 7-, 30- and 90-day periods. Choose a period and use **Refresh report**
for current data. No browser analytics token, saved local report or operator
computer is needed. The deployed Access application uses Cloudflare sign-in,
an exact-email Allow rule, a 24-hour session and an HTTP-only authorization cookie.

The hostname must be protected by a Cloudflare Access self-hosted application
covering the entire hostname. Its Allow policy must list the operator's exact
email address; do not use an `Everyone` rule or a broad email-domain rule.
Cloudflare Access handles the sign-in method and session. Before routing or
querying data, the Worker requires Cloudflare's authenticated runtime Access
context to match this application's exact audience. The platform supplies this
context only after authenticating a direct Worker invocation; it cannot be
created by browser headers or cookies. When runtime Access context is absent,
the Worker independently verifies the signed Access assertion's RS256 signature,
issuer, audience, expiry and not-before time. A mismatched runtime audience
denies access without falling back to request assertions. An email header or
an unverified cookie alone never grants access. No identity lookup is needed.

This dashboard has its own `wrangler.analytics.jsonc` configuration. It has no
public-site assets, disables `workers.dev` and preview URLs, and serves only
authenticated GET requests to `/` and `/report`. All responses prevent browser
and CDN caching, indexing, framing and referrer disclosure. The report uses no
JavaScript, third-party resources, client telemetry or individual visitor data.
Invocation logs and automatic traces are disabled for this separate Worker;
the public gateway's existing diagnostic settings remain independent.

Deployment setup:

1. Configure Cloudflare Zero Trust and an Access application for the full
   `analytics.opencaster.org` hostname, with an exact-email Allow policy and a
   suitable session duration. Confirm its authentication method before making
   the dashboard available.
2. In `wrangler.analytics.jsonc`, set `ACCESS_TEAM_DOMAIN` to the bare
   `<team>.cloudflareaccess.com` hostname and `ACCESS_AUD` to this application's
   audience tag. These are public deployment identifiers, not credentials.
   Empty or invalid values deny access. Never substitute a shared password,
   query-string token, browser build variable or Cloudflare API credential.
3. Use Wrangler **4.145.0 or later** to deploy the separate configuration:
   `wrangler deploy --config wrangler.analytics.jsonc`. The native
   `ANALYTICS_SQL` binding queries only the owning account's existing
   `opencaster_activity` dataset; no API token is stored in this Worker. Account
   Analytics Engine entitlement is still required.
4. Verify that a signed-out request reaches Access sign-in, an unauthorized
   account cannot read any report, and the approved operator can load all four
   periods. Confirm missing/invalid assertions cannot reach SQL, alternate
   Worker URLs remain disabled, and report responses have `no-store` headers.
   Follow the repository release/dev-log checks for the accompanying release.

Source configuration alone does not provision an Access policy or establish a
live deployment. Record the actual Access configuration and production checks
when deploying. An unavailable binding or failed query returns a generic
unavailable message rather than stale data or service details. Report queries
have bounded concurrency, result size and execution time.

## Private local snapshot

From `hypersnap/`, with the existing Wrangler Cloudflare connection:

```sh
yarn analytics:report --days 7 --out /tmp/opencaster-analytics.html
```

Open the resulting HTML file to see document visits, page views, clicks,
traffic-source categories, country/device/browser breakdowns, browser error
counts, available page-performance samples and gateway request health. This is
a private local snapshot; rerun the command for current data. The report uses
Cloudflare's authenticated SQL API and contains aggregates, never credentials.
The local file is not served by the public website. A separately supplied
`CLOUDFLARE_API_TOKEN` needs Account Analytics Read permission; never put it in
a `VITE_` variable or the website bundle.

Reports show data received since collection began; they do not backfill earlier
activity. A **visit is a document load**, including reloads, rather than a unique
person or an identified session. Page views also
count client navigation, including Back/Forward. Clicks measure explicitly
marked UI actions, not successful social writes. Browser errors are counts of
uncaught errors or unhandled rejections, without messages or stack traces.
Numeric LCP, CLS and TTFB samples depend on browser support and are reported
when the document first becomes hidden; INP is not currently collected.

Counts can be affected by bots, blockers, privacy choices, interrupted delivery
and Cloudflare sampling. Events are not proof of a human action. Browser
submissions are untrusted, and rate limits are approximate per Cloudflare
location. Cloudflare currently retains Analytics Engine data for three months.
The local snapshot weights aggregates by `_sample_interval`, including numeric
means. The hosted dashboard uses the native SQL API's automatic sample weighting
for `COUNT` and `AVG`, rather than applying those weights a second time.
It does not reconstruct individual browsing sessions or backfill old clicks.

## What is collected

The browser sends bounded batches of fixed labels to `/_analytics/events` on
`opencaster.org`. Allowed events and labels live in
[`src/lib/analyticsEvents.ts`](src/lib/analyticsEvents.ts), shared with the Worker.
Page labels are categories such as `profile`, `cast`, `search` and `connect`.
Traffic sources are reduced in the browser to `direct`, `search`, `social`,
`github`, `internal` or `other`. `direct` means no referrer was available, which
also includes apps and browsers that hide the original source. The Worker adds
a two-letter country and coarse browser/device categories; the original user
agent is not stored.

The Worker also records request-family (`page`, `asset`, `api`, `media`, `other`),
status-class and elapsed-time measurements for the canonical production origin.
These operational aggregates include automated requests and are separate from
browser visits. The ingestion route itself is excluded from request metrics.

No analytics cookies or persistent visitor IDs are created. The Analytics Engine
dataset never stores raw page paths, search queries, referrer URLs, profile
identifiers, cast hashes, channel names, DOM text, form values, wallet identifiers,
pairing links, signing payloads, keys, request/response bodies, error messages or
stacks.
Cloudflare already processes incoming requests as the site's hosting provider;
an IP address is used only for its short-lived ingestion rate-limit counter,
not written into the analytics dataset. The browser sends events without cookies
or authorization and makes no analytics request to an external origin.

Do Not Track and Global Privacy Control disable the site's browser analytics;
the Worker also honors their request headers. **Settings → Privacy & analytics**
lets a visitor turn off browser usage collection on this device. This preference
does not disable the hosting provider's ordinary processing or aggregate
operational request metrics. Local development, previews, the legacy domain and
the offline signer do not send browser usage events to the production dataset.

## Storage schema and operations

| Field | Meaning |
| --- | --- |
| `blob1` | `visit`, `pageview`, `click`, `vital`, `error` or `request` |
| `blob2` | Fixed page category, or fixed request family |
| `blob3` | Fixed action/source/vital/error name, `view`, or HTTP status class |
| `blob4` | Two-letter country, `XX` if unavailable |
| `blob5` | `desktop`, `mobile`, `tablet` or `other` |
| `blob6` | `chrome`, `safari`, `firefox`, `edge` or `other` |
| `double1` | Count, always `1` |
| `double2` | Numeric vital value or elapsed milliseconds; otherwise `0` |
| `index1` | Constant `opencaster` |

The binding in `wrangler.jsonc` creates the dataset after its first write. The
ingestion route accepts up to 20 events and 8 KiB per request, checks the exact
origin and finite schema, and has a dedicated rate limit. Analytics failures
do not change application operations; the client drops failed batches without
retrying. The client also bounds its queue and per-document event volume.

Cloudflare Workers invocation logs are enabled and persisted at 100% sampling.
These platform logs are separate from the aggregate Analytics Engine dataset:
they contain request metadata, including URL paths, response status, execution
outcome and timing. Query strings are redacted. Browser analytics opt-out, Do
Not Track and Global Privacy Control do not disable these hosting logs. The
Worker adds no custom request, body or credential logging.

`wrangler.jsonc` retains these settings so a later deployment does not disable
the dashboard logs. Automatic traces, real-time Issues and the third-party Web
Analytics beacon remain disabled. Explicit Analytics Engine points preserve the
existing self-only script policy and provide the custom clicks that Web Analytics
does not support. Log retention and sampling limits depend on Cloudflare's
current account plan.

Cloudflare references: [Analytics Engine setup](https://developers.cloudflare.com/analytics/analytics-engine/get-started/),
[SQL and sampling](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/),
[native SQL binding](https://developers.cloudflare.com/analytics/sql-api/workers-binding/),
[automatic aggregate sample weighting](https://developers.cloudflare.com/analytics/sql-api/sql-reference/functions/#adaptive-sampling),
[Access runtime context](https://developers.cloudflare.com/workers/configuration/cloudflare-access/),
[Access token validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/),
[retention and limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/),
[rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/),
[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/),
[Web Analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/),
[trace attributes](https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/).
