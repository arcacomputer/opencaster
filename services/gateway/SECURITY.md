# Public client traffic controls

The application and its gateway serve only `https://opencaster.org`. The Worker
rejects other origins before reading request bodies or calling assets, storage,
preview rendering, analytics ingestion or Hypersnap. The existing
`quorum.arca.computer` route remains a redirect for public links; legacy writes
still return `409 site_moved` without forwarding signed bytes.

Keep both `workers_dev` and `preview_urls` false in `wrangler.jsonc` and in the
live Worker. The obsolete `claude.opencaster.org` custom domain is detached from
`opencaster-preview`; that Worker and its data are retained. The separate
Access-protected analytics dashboard, developer API, node origin, telemetry and
mail DNS records are independent services, not alternate client deployments.
Do not remove those records as client cleanup.

## Request limits

Production sets `CLIENT_RATE_LIMIT=enabled` and binds `CLIENT_RATE_LIMITER` to
120 requests per IP per 10 seconds, shared across `/api/`, `/_share/` and
`/_analytics/` paths. The check runs after the canonical-origin check and before
application work. Excess requests return JSON `429` with `Retry-After: 10` and
`no-store`; a missing or failed enabled limiter returns `503` rather than
silently removing protection. Local/test environments can omit the opt-in.
The existing stricter analytics-ingestion limit remains independent.

The platform-provided IP is used only as a transient counter key. It is never
added to application logs, aggregate analytics or upstream requests. Requests
without a usable platform address share one finite fallback counter.

Cloudflare's [Worker rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
are approximate and local to each Cloudflare location. They protect backend
work after a Worker invocation starts; they are not a global request budget or a
guarantee against invocation costs. Shared connections share a counter. The
client does not automatically replay signed submissions.

## Zone firewall

The manually managed transport settings are recorded in `zone-settings.json`:
Always Use HTTPS is on, minimum TLS is 1.2, and the existing TLS 1.3 setting stays
on. These settings cover the zone's proxied service subdomains as well as the
public client. HTTP requests redirect to HTTPS, and TLS 1.0/1.1 clients cannot
connect. Wrangler does not apply this snapshot; review these values in the
Cloudflare zone dashboard when changing infrastructure.

The `opencaster.org` zone has the following additional active custom Block rule:

```text
(http.host eq "opencaster.org" and (cf.verified_bot_category eq "AI Crawler" or lower(http.user_agent) contains "reflectionbot"))
```

It is named **Block AI training crawlers on Opencaster**. It leaves other
verified-bot categories, including search-engine crawlers and page-preview
services, outside this block. Category accuracy depends on Cloudflare's
classification; a user-agent match alone is not proof of identity. The existing
**Limit optional crawler traffic** rule remains in place.

These zone settings are managed separately from Wrangler. Recheck them after
zone changes. No zone-wide Skip rule, challenge, new logging policy or edge rate
rule is needed for this configuration. In particular, the Free-plan edge rate
expression cannot match a hostname; the Worker limit avoids applying client
limits to service subdomains.

Before deployment, follow the repository release checks. Verify public pages,
read-only API calls, legacy redirects, disabled alternate URLs, and signed-out
analytics denial. Test quota exhaustion with synthetic identities and mocked
bindings, not production bursts or real-account writes.

## Workers Builds

The connected build settings are recorded in `worker-builds.json`; update the
Cloudflare dashboard to match this snapshot when changing the integration.
Builds run `yarn cloudflare:build` from the repository root. That command requires
Cloudflare's build UUID and exact commit metadata, runs the full `yarn verify`
gate, and builds production browser assets into a fresh external directory.
It records a branch- and source-bound asset fingerprint outside the asset directory.

Both production-branch and preview upload commands use `yarn cloudflare:upload`.
It verifies the branch, commit and unchanged asset fingerprint, then uses the
pinned Wrangler dependency to package the Worker. Branch builds use Wrangler's
`--dry-run`: they complete the same tests, typechecks, browser/signer builds,
asset inspection and Worker bundling without creating a Preview or uploading a
version. The `main` branch uploads a staged Worker version without promoting it
to live traffic. Public Worker and preview URLs stay disabled. A staged version
uses its configured bindings and does not itself exercise application writes or
provide an isolated application database.

Existing Previews can retain their own build-command overrides. Select each
active branch from the Worker environment menu and check its Settings > Builds;
updating Previews Base does not update an existing branch's commands.

Production promotion remains the separate manual release procedure, including
the actual deployed base, dev-log guard and exact inspected asset directory.
Merging a pull request does not automatically replace the active release.
