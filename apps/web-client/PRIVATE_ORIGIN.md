# Private Hypersnap origin (Worker integration)

> **⚠️ AI-Generated**: May contain errors. Verify before use.

This is an operator integration contract, not a deployment/readiness claim.
OpenCaster remains public. The node itself can sit behind a Cloudflare Tunnel
and a token-authenticated origin gate; browser callers use the existing bounded
`/api` gateway, not the raw node. CORS, Host, Origin, Referer and a tunnel hostname
alone do not authenticate raw-node access. This contract does **not** use
Cloudflare Access service tokens.

## Server-only settings

Set both Worker runtime bindings together:

- `HYPERSNAP_ORIGIN`: an HTTPS **origin**, e.g. `https://node.example.org`, with
  an optional root slash. A port is allowed. Paths, query strings (including an
  empty `?`), fragments, userinfo, whitespace and backslashes are rejected.
- `HYPERSNAP_ORIGIN_TOKEN`: a secret of at least 32 characters from
  `A–Z`, `a–z`, `0–9`, `_`, `-`. Use a randomly generated credential, store it as
  a Worker secret, and configure the same value in the origin gate. Do not put
  it in Git, `services/gateway/wrangler.jsonc`, browser storage, logs, URLs, cache keys or any
  `VITE_*` variable. No real credential is included in this repository.

Optional server-only opt-in: `HYPERSNAP_AGGREGATE_CACHE=trusted-origin-v1`.
This exact, case-sensitive value permits a narrow override of the origin gate's
transport `no-store` **only** with a valid private origin/token pair and the
gate-generated response hint described below. It is not a browser setting or
permission to cache personalized responses. Absent/unknown values leave the
ordinary `no-store` exclusion in place; no opt-in enables a partial origin pair.

Optional server-only read failover: `HYPERSNAP_READ_FALLBACK=haatz-v1`.
Only this exact value **and a valid private primary origin/token pair** enable
the fixed backup `https://haatz.quilibrium.com`. There is no backup URL setting,
browser override, per-request routing flag or arbitrary-host proxy. Unknown or
absent values disable retry; both origin bindings absent retain the single
public development default below, not a primary/backup retry loop.

The checked-in production configuration uses `HYPERSNAP_READ_FALLBACK=disabled`
to preserve the operational primary-only cutover. Index-readiness guards remain
in place, so unavailable primary indexes do not silently use the backup. The
optional failover contract below applies only when an operator enables it.

If **both bindings are absent**, the unchanged fork/development fallback is
`https://haatz.quilibrium.com`, with no origin-token header. An empty, partial
or invalid pair never falls back: valid API requests return sanitized HTTP 503
`upstream_configuration_unavailable`, with no node fetch or cache access.
Media upload signer checks similarly fail closed with HTTP 503
`registry_unavailable`, without storing an image or reserving quota. Static
assets, legacy redirects and existing public media reads remain independent
of node configuration. Vite's development proxy still uses the public node;
these settings configure the Worker, not the browser/Vite proxy.

The Worker adds exactly `X-Opencaster-Origin-Token: <secret>` to its private
primary requests, never to backup requests. The origin gate must require it
before forwarding to Hypersnap, fail
closed on missing/wrong values, and keep all alternative HTTP/gRPC entry points
private. Do not log this header at the gate. The public gateway is not a private
application: anyone can still call its allowlisted public API routes.

## Request and response boundaries

`services/gateway/src/upstream.ts` is shared by all main API reads/submissions and **both**
media active-signer checks. It constructs fresh allowlisted headers, replacing
any browser-supplied origin-token header. Browser cookies, Authorization,
Origin and Cloudflare Access credentials are never forwarded. The helper
forces `redirect: 'manual'`, `credentials: 'omit'` and `cache: 'no-store'`.
Redirects are failures, not a second authenticated request. Upstream headers,
Location and raw errors are never returned to the browser. Even a successful
JSON response reflecting the configured secret is rejected before returning
or caching it.

Existing route/query validation, signed-message bytes, 64-KiB submission limit,
4-MiB main response limit, **20-second main deadline**, 1-MiB registry limit,
**10-second registry deadline**, media grant/signer/revocation checks and quota
rules remain in force. No write is retried automatically; an interrupted
submission still reports its status as unknown. Existing analytics bindings
and coarse request metrics remain intact and receive neither origin settings
nor node headers/payloads.

## Bounded read failover and guarded migration

Validated main-API GETs prefer the private primary (including its eligible
aggregate cache). With the read-failover opt-in, a **cold primary fetch plus body
read has a 4-second deadline**. Retry once against Haatz only on a transport
failure, that primary deadline, or HTTP 500–599. The existing **20-second absolute
deadline** covers both cache lookups, the primary and the backup including body
reads; it is not restarted for backup. Optional cache lookups each retain their
200-ms combined lookup/body bound inside that total. Abandoned and late response
streams are cancelled without awaiting cancellation, and late failures handled.

Never retry HTTP 4xx (including 401/403/404/408/429), redirects, semantic auth
denials, invalid content type/JSON, reflected secrets or size-limit failures.
A known nonretryable status cannot become failover because its error body stalls
or fails. Backup failures are not retried. Fresh backup headers contain only
`Accept: application/json`; no private origin token, cookies, Authorization,
browser routing/cache hints or Cloudflare Access credentials reach Haatz. Both
origins use manual redirects. Signed POSTs are never failed over or replayed,
and keep the 20-second bound and unknown-submission result. Both media signer
checks remain private-primary-only, uncached and fail-closed at 10 seconds even
when read failover is enabled.

Main-API responses selected from an upstream or its cache get a locally
generated `X-Opencaster-Upstream: primary|backup`. A cache hit is attributed to
the origin in its actual key, not to a stored/upstream header. Validation and
configuration failures before upstream selection do not claim an upstream.
Neither this header nor coarse request analytics disclose a node URL or secret.

For the guarded migration, the protected origin gate returns truthful HTTP 503
`primary_index_not_ready` with `no-store` for **all `/v2/` routes** until those
indices pass independent freshness/correctness acceptance. Unauthorized gate
requests must still return 403. Generic GET 5xx failover makes those authorized
v2 reads use backup immediately, avoiding stale or expensive primary scans.
`/v1/` core API, signer checks, raw history and signed writes remain on the
private node. This is not a claim that the private v2 indices are ready, nor
route-specific routing logic in the Worker. The release owner owns gate rollout,
cold-read acceptance, canary and any later removal of that readiness guard.

## Bounded aggregate cache

Only these validated GET reads are eligible, and only without a cursor:

- `/v1/info` (15-second TTL)
- `/v2/farcaster/feed/trending` (first page; supported window/limit only; 30-second TTL)
- `/v2/farcaster/channel/all` (first page; 60-second TTL)
- `/v2/farcaster/channel/trending` (60-second TTL)
- `/v2/farcaster/channel` (exact validated ID; 60-second TTL)

The Worker uses `caches.default` and schedules writes with the optional
`ExecutionContext.waitUntil`. Without either API it skips caching; there is no
production in-memory fallback. Cache API failures do not fail API reads.
One **200-ms fallback budget** bounds both `cache.match` and cached-body
validation together. A stalled lookup/body falls back to authenticated upstream;
abandoned readers and responses arriving after that budget are cancelled without
waiting for cancellation. Late failures are handled, not unhandled rejections.
This budget is inside the unchanged **20-second main deadline**, not an extension
to it. Optional cache latency therefore leaves less time for the cold node.

The edge-only copy uses the route-specific **15–60-second TTLs** above. Keys include a version namespace,
application origin, **actual selected upstream origin**, exact endpoint, window, channel ID/type and
normalized limit, never tokens or browser headers. Changing the node origin
isolates old entries; rotating its token can reuse the same short-lived public
data. Validate origin configuration and every method/path/query/origin rule
before any lookup. Size-bound and validate JSON before every put, retaining the original validated bytes;
recheck cached status/JSON/size/aggregate shape on hits. Upstream headers are
not cached or returned. Browser API responses remain `Cache-Control: no-store`.

Always consult the primary namespace first. Consult/populate the backup
namespace only after a genuine eligible primary failure. A warm backup cannot
mask a recovered primary or bypass a primary 4xx/redirect. Backup public data
never populates the private-primary key. Trusted-primary no-store opt-in/hints
do not apply to backup, even if the public backup sends the same hint header.

Only HTTP 200 JSON objects with no top-level error/code marker are stored.
Feed/list responses require the appropriate `casts`/`channels` array; channel
details require a `channel` object. Info responses must be objects. Responses setting cookies,
varying by headers, or declaring private/no-cache are always excluded.
`no-store` is also excluded unless **all three** conditions hold:

1. The resolved private configuration contains the origin token.
2. Worker binding `HYPERSNAP_AGGREGATE_CACHE` is exactly `trusted-origin-v1`.
3. The upstream **response** header `X-Opencaster-Aggregate-Cache` is exactly
   `public-aggregate-v1` (unknown, combined or missing hints do not qualify).

The origin gate must strip any raw-node `X-Opencaster-Aggregate-Cache` header,
and generate that trusted hint itself only for actual HTTP 200 JSON responses
from its explicitly approved public aggregate routes, when the raw node's **original**
Cache-Control contains no private/no-store/no-cache directive, and there is no
Set-Cookie or Vary header. The gate must still send `Cache-Control: no-store`
on **every** origin response, including hinted ones, to prevent an intermediate
shared CDN from serving authenticated node data without gate authentication.
Do not replace that transport protection with `public` or a CDN cache rule.

The current gate only attests to trending feeds and channel lists; newly eligible
info/detail reads with `no-store` stay uncached until their gate explicitly
approves them. No origin-gate change is included in this release.

The hint attests only to the gate's original-response checks; it cannot bypass
the Worker's request allowlist, JSON/size/aggregate checks, error/status checks,
Set-Cookie/Vary/private/no-cache exclusions or private-configuration validation.
The Worker never forwards browser-supplied hints to the node, nor returns or
caches the response hint, origin token or other upstream headers. Only its
separate validated Cache API copy gets the route-specific `public, max-age` TTL; browser and
origin responses remain `no-store`. The opt-in does not authorize public-fallback
responses to override `no-store`.

Requests carrying Cookie or Authorization bypass cache entirely. Signer,
custody/auth, user/profile/user-state, notification, following, search, cast,
channel member/feed, paginated and write routes are never cached.
Neither HTTP errors, malformed/oversized JSON, redirects nor transport errors
are cached. This does not invent empty successful results for unavailable
indexes.

Cloudflare's Cache API is data-center-local and best effort, not an independent
indexer, a global persistent cache, or an independent failover decision. A cold
request still needs primary or eligible backup to finish within the original
deadline. A warm hit is not evidence of cold-node readiness; do not extend
timeouts or deploy on that basis.

## Isolated verification and release handoff

From the repository root, use Node 22 and Yarn, e.g. `yarn test services/gateway`
and `yarn workspace @opencaster/gateway typecheck`. Worker tests use synthetic credentials/identities,
mocked HTTP and a test-only Cache API double; no live account actions, uploads
or node writes are required. The tests cover configuration rejection, private
read/write headers, credential-free redirects, signer authentication, unchanged
deadlines, cold/hit/expiry behavior, cache identity/exclusions and cache errors.
They also cover stalled lookup/body and late-stream cancellation, exact opt-in
and hint matching/spoofing/privacy exclusions, coarse analytics on cache hits
and invalid configuration, and second (post-transfer) private media signer-check
redirect/timeout/error failures with zero quota reservations, quota storage
writes/alarms or image writes.

`services/gateway/src/failover.test.ts` additionally exercises successful-primary preference,
each retry cause, 4xx/redirect/semantic/parse/limit exclusions, exact server opt-in,
credential-free backup, ignored aborts, stalled bodies, late streams/rejections,
one absolute cache/primary/backup deadline, synthetic signed writes never replayed,
and coarse analytics. Cache tests cover origin-isolated backup hits, recovery,
privacy exclusions and untrusted backup hints. Private media tests enable read
failover while requiring both signer checks to remain primary-only.

Before production cutover, separately verify tunnel/gate authentication,
blocked direct access, chain progress and representative **cold** application
reads against the unchanged deadlines. Preserve analytics, R2 and Durable
Object bindings, the deployed source base, and legacy redirects/media reads.
The release owner must follow the README release checklist (new milestone,
full verification and inspected build); the integration code alone is not a
release, and does not change DNS, install secrets or deploy infrastructure.
