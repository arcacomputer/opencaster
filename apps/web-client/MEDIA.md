# Image uploads

The browser uploads public JPEG, PNG, WebP and GIF images to our Cloudflare
Worker. The original file is retained, including any photo metadata such as EXIF.
Upload controls must disclose this before the user chooses a file. Removing an
attachment from a draft does not remove an already uploaded image. Images have
stable public links and may be cached by recipients. There is no end-user media
deletion flow in this release.

## Authorization and storage

The existing device Ed25519 key signs one constrained upload grant inside the
session closure. It does not expose a generic signing API or the private key.
The grant binds `arca.hypersnap.media.upload.v1`, schema version, exact website
origin, FID, posting public key, random nonce, issue/expiry times, image SHA-256,
byte size and content type. Its lifetime is at most 120 seconds. The proof and
public fields travel in the request header; account recovery phrases and wallet
private keys are never involved.

Before accepting an image, the Worker checks the exact grant schema, canonical
signature, same origin and current Hypersnap offchain signer registration. The
signer must belong to that FID, permit `MESSAGE_TYPE_CAST_ADD` and remain valid
for at least 30 seconds. A failed, unavailable or truncated registry response
denies the upload. The Worker checks the registry again after receiving the
image, so a signer revoked or expired during a slow transfer is denied before
storage reservation. The registry destination stays fixed at
`https://haatz.quilibrium.com`; no Farcaster/Snapchain service is introduced.

Uploads are bounded to 5 MiB. Server checks require the claimed image format's
magic/header, dimensions no greater than 8192 on either side, and no more than
25 million canvas pixels. SVG, HTML, video and other formats are rejected. These
checks establish the allowed image container and dimensions; they are not a
complete image decoder or metadata scrubber.

After validating the complete image and its SHA-256, the Worker atomically
reserves the nonce and quotas in a SQLite-backed Durable Object. A reservation
is never rolled back after an ambiguous storage failure, so the same grant
cannot be replayed. Failed attempts are not automatically retried by the client.
Choosing a file again creates a fresh grant.

The dedicated `hypersnap-quorum-media` R2 bucket has direct `r2.dev` access
disabled. Only the Worker binding can write it. `PUT` is conditional on the
content hash being absent, preserving immutable `/media/<sha256>` links. Reads
serve fixed image MIME types with `nosniff`, a sandboxed restrictive CSP and
immutable caching. There is no arbitrary upstream media-fetch endpoint or
public unsigned upload endpoint.

## Quotas and retained operational state

- Per FID per UTC issue day: 10 uploads and 50 MiB.
- Entire app per UTC issue day: 1000 uploads and 5 GiB.
- The Durable Object stores FID counters and used public nonces. Its alarm
  deletes all operational state five minutes after that issue day ends, after
  every grant from the day has expired. Midnight replays remain in the same
  object's nonce ledger because the object is selected by the signed issue day.
- Image storage persists independently of the daily quota state. There is no
  automatic media expiration policy in this release. Operators should monitor
  total R2 storage as adoption grows.

Quotas bound accepted storage writes; they do not eliminate Worker request,
registry-read or network traffic from abusive clients. The upload route is
designed to reject unauthenticated callers before any registry lookup or
durable-state write. The Worker adds no custom application request logs; platform
invocation logs are described in [OBSERVABILITY.md](OBSERVABILITY.md).

## Cloudflare deployment

`services/gateway/wrangler.jsonc` declares the R2 binding `MEDIA_BUCKET`, the Durable Object binding
`MEDIA_QUOTA`, and migration `media-quota-v1` with `new_sqlite_classes` containing
`MediaUploadQuota`. The class must be re-exported by the Worker entry point. The
R2 bucket was created using the existing account; no subscription was changed.

Cloudflare documents [R2 Worker bindings and conditional writes](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[SQLite-backed Durable Object transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[SQLite Durable Objects on the Free plan](https://developers.cloudflare.com/durable-objects/platform/pricing/),
and [deleting all Durable Object storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/).

## Validation

Source paths in the recorded checks below use the original app layout. The
current media handler and tests are under `services/gateway/src/`, shared media
contracts and tests under `packages/client-core/src/`, and browser harnesses
under `apps/web-client/scripts/`. Run `yarn verify` from the repository root;
use `apps/web-client/` as the working directory for direct browser-harness
commands below.

`worker/media.test.ts` and `src/lib/media.test.ts` contain 16 tests using synthetic,
unregistered Ed25519 identities and mocked
Hypersnap/R2/Durable Object services. It covers valid uploads, immutable reads,
origin/signature tampering, concurrent replay, active signer scope/ownership,
truncated registries, content/type/size mismatch, daily quota and ledger cleanup.
No test signs a real account action or writes a user image to production.

A separate isolated Miniflare smoke test exercised actual local SQLite Durable
Object transactions and R2 conditional writes with the production handler and a
mocked Hypersnap registry: signed upload `200`, replay `409`, exact immutable
image read `200`, duplicate-content upload `200`. The installed local runtime
supports compatibility dates through `2026-10-02`, so that smoke used that date;
the existing deployed Worker configuration remains `2026-10-19`. Wrangler's
deployment dry run also accepted the R2 and Durable Object bindings.

### Repeatable isolated browser/node harness

`scripts/e2e-media-runtime.mjs` now provides a reusable runtime backed by actual
local R2 and SQLite Durable Objects. Its outbound service forwards the unchanged
production gateway's fixed Hypersnap destination to a supplied **loopback**
Hypersnap node. It never synthesizes a registry response. `runMediaChecks` first
requires the synthetic fixture's offchain device key to be present in that
node's registry, then checks accepted upload, replay rejection, byte-exact image
read, invalid image, expired grant and unregistered signer.

`scripts/e2e-media-server.mjs` exposes that runtime on a loopback-only HTTP port
for the browser's Vite proxy. Supply `--node`, `--origin` and `--port`; optional
`--identity-file` runs the authenticated checks before listening. The fixture
file must have kind `arca.hypersnap.e2e.identity`, version `1`, its local FID and
the synthetic `devicePrivateKeyHex`. A real user wallet, recovery phrase, public
node URL or production R2 bucket is never accepted by this harness.

The exported `viteTestOriginPlugin` rewrites the two production website origins
to the configured loopback origin **only in the separate test build**. It also
permits that exact origin's `/media/<sha256>` URLs through the avatar preview,
profile-picture validator, cast embed validator and App image renderer, and
rewrites the hosted-image recognition regex. Other HTTP origins and paths remain
rejected. These test-only URL substitutions do not change EIP-712 domains,
message schemas, registered signer checks, production assets or production
HTTPS-only URL policy. They are necessary because loopback HTTP is a browser
secure context, while those production UI guards intentionally require HTTPS.

The test image uses the repository's real `public/unknown-dark.png`, so image
decoding can be observed as well as byte transport. A runtime bootstrap check
has verified unsigned upload `401`, absent image `404`, frontend assets `200`
with CSP, and no registry call for the unsigned request. Authenticated E2E
coverage requires a running local Hypersnap node and its registered fixture;
bootstrap results alone do not establish that coverage.

The actual-node run subsequently passed against Hypersnap `0.13.5` in Mainnet
mode on `127.0.0.1:13381`, using the synthetic FID `1234` only after its offchain
device key was registered and confirmed across a cold restart. With the
canonical production HTTPS origin and **no origin/URL-guard transformations**,
`scripts/e2e-media-checks.mjs` reported: registry `200`, upload `200`, replay
`409`, image `200` with exact bytes, invalid image `415`, expired grant `401`,
and unregistered key `403`. Registry responses came from that actual Hypersnap
node; R2 and SQLite Durable Objects ran in the local Cloudflare runtime. This
validates the backend flow independently of the separate loopback browser UI
build. No production account or R2 bucket received an upload.
