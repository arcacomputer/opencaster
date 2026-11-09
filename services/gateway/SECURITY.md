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
