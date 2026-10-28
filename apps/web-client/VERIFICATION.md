# Browser performance release deployed · 2026-10-28

Release source
[`3766845`](https://github.com/arcacomputer/opencaster/commit/3766845dfa8191fd5e63ba514b4b25de3e010a8f)
combines merged PRs [#20](https://github.com/arcacomputer/opencaster/pull/20),
[#21](https://github.com/arcacomputer/opencaster/pull/21),
[#22](https://github.com/arcacomputer/opencaster/pull/22),
[#23](https://github.com/arcacomputer/opencaster/pull/23) and
[#24](https://github.com/arcacomputer/opencaster/pull/24): WOFF2 fonts, signing
code loaded with its features, batched recent reaction checks, shared quoted-cast
reads and lighter feed rendering/pagination. All five final PR heads had green
verification, CodeQL/analysis and Devin Review checks; the exact main merge also
passed [verification CI](https://github.com/arcacomputer/opencaster/actions/runs/40662951312).

Authenticated Wrangler metadata identified the actual pre-release source as
`2bc9cbfc332be103277154f7e863171c77af0891`, Worker
**`99476d5f-8f5a-4f07-9403-4a435fc374dc`**, at 100% traffic. This baseline was
confirmed again immediately before upload. The inspected release was deployed to
`opencaster.org` at **2026-10-28 07:25:58 America/Santiago**
(`2026-10-28T10:25:58Z`) as Worker
**`cf8e30ec-0f26-4c1b-9efb-9f099ff29c2a`**, deployment
`2a4c13d0-882f-456f-b745-3826c069f4e5`, at **100% traffic**. The version message
records the full source commit; its tag is `performance-20261028-3766845d`.
No rollback was needed.

The clean release checkout used Node **22.22.3**, Yarn **1.22.21** and
`yarn install --frozen-lockfile`. The root dev-log guard passed against the actual
pre-release commit, preserving history and recognizing all six new milestones.
Root `yarn verify` passed **1,877 tests across 74 files**, all shared-package,
browser, gateway and analytics typechecks, the production browser build and the
offline signer typecheck/build in **41.93 seconds**. Wrangler **4.141.0** dry-run
passed and bundled the gateway renderer Wasm.

Production browser assets were freshly built in
`/tmp/arca-release-3766845-20261028-Al9pJg`; that exact inspected directory was
the deployment input. Its **47 files** contained no source maps, symlinks or
browser test-fixture markers, and their hashes remained unchanged after
deployment. The public WalletConnect project identifier was explicitly supplied
to the build and matched the previous live WalletConnect chunk without printing
its value. A fresh clone without that build setting would disable wallet-app
connections. No credential was copied into browser assets. The entry is
`assets/index-CX3MvTD_.js`, with exactly one Latin font preload,
`assets/Inter-latin-BTmm5tyf.woff2`; the extended Inter and Sen WOFF2 files also
ship. Gateway runtime settings and all binding metadata match the previous
version, including the origin/fallback configuration, existing secret binding,
media storage/quota, analytics and migration tag. The analytics dashboard and
native signer release were not deployed.

Post-deploy public reads confirmed that all **46 non-HTML asset hashes** match
the inspected build. HTML points to the new entry and Latin font preload; the
font returns HTTP 200 with `font/woff2` and one-year immutable caching. The OFL
license and both original TTF files return HTTP 200, and browser CSS uses WOFF2.
The live `/devlog` renders all six new milestones. The public profile-3 share
image returns HTTP 200, `image/png`, at **1200×630**; its five-minute edge cache
means this read alone does not establish a cache miss or a newly generated PNG.

Live desktop guest browsing loaded Discover through **25, 50 and 75 cards**,
with **17 quoted previews** hydrated across those pages. Cards rendered in Inter
without blank-card failures. The Recast/Quote menu opened, and Like as a guest
opened the account-connection page; that flow was cancelled without connecting.
A cast conversation rendered **101 cards**, direct profile `398800` loaded
**15 cards**, and `/channel/spirituality` loaded **50 cards**, without captured
alerts or console errors. The stale-cursor profile failure noted during the
pre-release review also reproduced on the previous live app; direct profile
loads and the post-deploy direct-profile check passed. This release does not
claim to fix that existing navigation/node issue.

Production checks used public reads/navigation only: no real account connection,
wallet approval, signature, reaction write, post, follow, profile edit or media
upload was performed. Signed-in production flows, production writes and mobile
Safari were not exercised. Automated write checks use isolated synthetic
identities. This is not an independent security audit. This documentation update
records the deployed source above and does not deploy a newer application build.

# Opencaster monorepo migration · 2026-10-27

Implementation [`c9d19456`](https://github.com/arcacomputer/opencaster/commit/c9d19456b0acc6b1c4a4775603bb3d1050edbece)
and workspace-test entry-point correction
[`4b10c6c9`](https://github.com/arcacomputer/opencaster/commit/4b10c6c930257b5484ffa891b8ded04318f6b3ac)
move the existing client, signer and services into seven Yarn Classic workspaces.
The root lockfile is byte-for-byte identical to the former application lockfile;
this migration changes no external dependency versions. No mobile or desktop
social client is added.

The root `yarn verify` gate passed **1,863 tests across 73 files**, all shared
package/browser/gateway/dashboard typechecks, the production browser build and
offline signer typecheck/build. `yarn typecheck` also passed independently for
all seven workspaces. A fresh external shared clone at
`/tmp/opencaster-monorepo-clean-robt5lbs` installed dependencies with
`yarn install --frozen-lockfile` and passed the complete gate at `c9d19456`, with
clean Git status and all workspace links resolving within that clone. The later
workspace-test command correction passed `yarn workspaces run test`; the browser
UI package has no separate unit tests and is exercised by the existing client
and signer checks. Root analytics-report `--help` also passed without querying
an account or creating a report.

Release-guard integration tests cover committed and working-tree comparisons,
old/new dev-log paths, preserved and removed milestone IDs, ambiguous copies,
and changes across apps, services, packages and root dependency/build inputs.
The migration's dev-log check passed against task baseline
`2190e4054e9a5d02f941928129182f50eb598834`, recognizing only the new
`opencaster-client-monorepo` milestone. This task baseline is not a claim about
the currently deployed source; a later deployment still requires its actual
pre-release deployed commit.

The root `yarn dev --port 5193` command served the landing page and dev log in
the browser. The new milestone and relocated feature-guide link rendered, with
no captured console errors. These were local public-read/navigation checks;
no wallet connection, account write or media upload was performed.

Gateway and analytics configuration comparisons preserved deployment names,
routes, storage bindings, origin settings and policies. Gateway Wrangler
**4.141.0** dry-run bundled its renderer Wasm and resolved the relocated web
assets. The older CLI does not recognize the existing analytics SQL binding;
a separate disposable Yarn installation of Wrangler **4.145.0** successfully
bundled analytics and recognized `ANALYTICS_SQL` with no configuration warning.
That analytics dry-run denied networking and real credential-file reads.
Repeated signer builds produced identical manifests and payload hashes from
the same sources. Developer ID packaging and notarization were not exercised.
No deployment was performed.

Existing WalletConnect annotation and browser chunk-size advisories remain.
Yarn also emitted a non-failing private-workspaces warning during installation;
all seven workspace manifests and the root are private. This is not an
independent security audit or production write verification.

Receipts: `/tmp/opencaster-monorepo-final-verify.log`,
`/tmp/opencaster-monorepo-typecheck.log`,
`/tmp/opencaster-monorepo-workspace-tests.log`,
`/tmp/opencaster-monorepo-signer-rebuild.log`,
`/tmp/opencaster-monorepo-clean-robt5lbs-install.log`,
`/tmp/opencaster-monorepo-clean-robt5lbs-verify.log`,
`/tmp/opencaster-monorepo-gateway-dryrun.log` and
`/tmp/opencaster-analytics-wrangler-lrq9z0_m/dryrun.log`.

> **Repository layout:** Opencaster now uses Yarn workspaces under `apps/`,
> `services/` and `packages/`. Run the current `yarn verify` gate from the
> repository root. Historical records below retain their original `hypersnap/`
> paths, commands, counts, names and commit links; they describe those recorded
> runs and do not verify the monorepo migration. See the [current setup and
> release checklist](README.md) for current commands.

# Standalone Opencaster repository · 2026-10-27

[PR #18](https://github.com/arcacomputer/opencaster/pull/18) merged the repository
cleanup as `5921e84402de2f79d2b66569c6131f71d2269fac`, preserving implementation
`9f82e33f98720d07e04da7440087943df76407d8` and the complete prior Git history.
The current tree has 241 tracked files after removing 2,014 inherited Quorum
messenger files. Opencaster's runtime source, assets, dependency manifest and
lockfile, deployment configuration, offline signer source and root license are
unchanged from pre-cleanup `c180f589827c5770b027d61ec3c285730cd79f8b`. Root Yarn
commands now forward to the standalone application; CI and current guidance
cover Opencaster and its supporting services. Earlier names and verification
records remain historical, and upstream attribution and licenses are retained.
Ignored private records and local outputs were preserved.

Root `VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 yarn verify` passed **1,853 tests
across 73 files**, browser/Worker/dashboard typechecks, production build and
offline signer build. The same full gate passed from `hypersnap/` in an isolated
copy with no inherited root source or dependencies; the existing standalone
dependency installation was reused. Push, PR and merged-main application CI
also passed. The dev-log guard passed against the pre-cleanup main commit with
zero shipped application files changed; this source-tree and tooling cleanup
requires no application milestone or website deployment. Existing bundle-size
and WalletConnect annotation advisories remain.

CodeQL Actions and JavaScript/TypeScript analyses passed on the cleanup and its
merge. The initially inherited Python analysis processed zero modules and
failed because this cleanup removes all Python source. The default setup now
selects Actions and JavaScript/TypeScript while retaining its existing default
query suite, remote threat model, standard runner and weekly schedule.

After the separately approved GitHub detachment, the repository API reports
`fork: false`, with no parent or source repository. Repository ID `1425238416`,
existing pull requests and its star were retained. Git history and commit URLs
remain available. No website deployment, real Hypersnap account action or
production write test was performed for this repository cleanup.

Local backups and metadata exports are in `/tmp/opencaster-cleanup-backup`.
Gate logs: `/tmp/opencaster-cleanup-latest-root-verify.log` and
`/tmp/opencaster-cleanup-latest-isolated-verify.log`.

# Performance release with current production features · 2026-10-27

Published release source `b2663de730bbcb58c2afbb6c89df3f2969913642` combines main's eight performance improvements with the actual deployed application and the completed browsing-maintenance work. Implementation merge `0bcfb58e8185cef3a4bbbf803673bce6098408dc` preserves both histories; the separate release-note commit links that implementation and its recorded author date. [PR #15](https://github.com/arcacomputer/opencaster/pull/15) merged as `ee83f994bbed7009c44f93fe354038b57a0c30b1`, preserving the merge commits. Its [standalone and retained verification CI](https://github.com/arcacomputer/opencaster/actions/runs/40478098310) and [additional branch CI](https://github.com/arcacomputer/opencaster/actions/runs/40478106055) passed on the exact published candidate; the retained gate’s own coverage distinctions remain separate from these standalone results. The public history retains all previous milestones and now contains **57** entries.

Authenticated Wrangler metadata identified the pre-release source as `92c05e4f8c55f255886ddd0867c6d1038bd1d346`, Worker **`a7167a33-6098-4e8b-bc8d-167a9a4a30aa`**, serving 100% of traffic. That source was on a different history from the performance main branch. Deploying main directly would have removed current custom/public feeds, reply context, immediate publishing feedback, sharing previews, branding and private-origin/analytics configuration. The actual-base dev-log guard rejected that history loss. The integrated release preserves those features, both milestone histories and the existing production configuration.

On the final committed candidate, `yarn check:devlog --base 92c05e4f8c55f255886ddd0867c6d1038bd1d346` passes with ten new milestones. Full `VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 yarn verify` passes **1,853 tests across 73 files**, browser/Worker/dashboard typechecks, production build and offline signer typecheck/build in **42.85 seconds**. The worker bound retains every test file and assertion while avoiding shared-host contention. Lazy UI integration checks wait for the visible control rather than a fixed import delay; the existing 100-card rendering regression has a local 15-second budget. No global timeout or coverage exclusion was added. Complete standalone source lint passes **zero errors and zero warnings**. Independent review checked feed/bookmark/filter memoization, pending-publication separation, complete bulk reaction-profile hydration, private-origin/failover cache boundaries and original-byte validation. Vite's existing large-chunk advisory remains. The signer payload fingerprint is unchanged at `03380d8490fefe8021d8a86a2a5399b8662f6def2667343abbc66687bf409434`; no native release asset is replaced.

Production assets were freshly built from the published source in `/tmp/arca-release-performance-20261027-mh1zm5r2`. All **33** files were inspected for fixture wrappers, source maps, duplicate synchronized names and symlinks. The existing public WalletConnect project identifier was preserved without copying any secret into browser assets. Wrangler dry run passed with the existing private-origin variables, R2 media bucket, SQLite Durable Object and analytics bindings. The exact inspected directory is the deployment input.

Wrangler rechecked the actual `92c05e4f`/`a7167a33` release immediately before deployment, then deployed that exact inspected directory from clean `b2663de7` at 100% traffic as Worker **`ff27d1a6-3319-4c83-bb77-62d565f12f94`**, deployment `c4ef5a74-d784-4e12-b435-d0f2c564159a`, at **2026-10-27 06:15:06 America/Santiago**. Authenticated post-deploy metadata confirms that all bindings, migration tag, compatibility date and static-assets runtime settings match the pre-release version. All 33 inspected local file hashes remain unchanged.

Post-deploy public reads confirm all **32 non-HTML deployed asset hashes** match the inspected build, live HTML points to its entry script, and the live dev-log bundle contains the new milestone and exact `0bcfb58e` implementation link. Versioned assets receive one-year immutable caching, root fonts one day, and HTML/API responses remain no-store; a missing asset receives no immutable policy. Sixteen repeated info, trending-feed, channel-list/detail, bulk-profile, user and cast-search reads returned HTTP 200 with the expected response policy and locally generated primary/backup attribution. A legacy-domain HEAD returns 308 while preserving the public profile path and query. An unsupported URI-style channel identifier from the raw node list is still rejected by the gateway’s existing query allowlist; a supported channel detail returns 200.

The cache continues to validate selected upstream configuration before access, isolate primary/backup keys, bypass credentialed or continuing-page reads, reject unsuitable responses and keep a bounded optional lookup inside the existing node deadline. Eligible public node info, trending feeds and channel lists/details have 15/30/60-second TTLs. The current private gate only attests trending feeds and channel lists; its no-store info/detail responses remain uncached until that gate approves them. Browser API responses remain no-store. Production headers do not separately expose Cache API hits, so repeated public reads establish response policy and selected-origin attribution; hit/expiry/corruption/failover behavior is established by isolated Worker tests. Reaction status may remain stale for five minutes, reaction-list profiles for one minute, and relative time labels refresh when a card redraws.

Before deployment, a real signed-in account smoke check on the **old `92c05e4f` build** loaded Discover, a conversation, enabled reaction status after its read completed, Likes/Recasts lists with 50 profiles each, cast and people search, 25 notifications and its Mentions filter, and the viewer's public Following feed. It used reads/navigation only. This pre-release check does not establish signed-in behavior of the new performance build.

After a fresh reload and user reauthentication, Chrome completed the signed-in smoke check on the **new deployed build**. The account’s Likes history loaded through the real v1 path. A previously liked/recasted cast showed Unlike and Undo recast on both profile and conversation views, with 26 likes, six recasts and three conversation replies. Its Likes/Recasts sheets loaded all 26/six profiles and included the signed-in viewer; no reaction toggle was clicked. Notifications loaded 25 unread activities and the Reactions filter worked. Cast search for `hypersnap` returned 25 results; a header `@felirami` search routed to people mode and returned two profiles. Following and Discover each rendered 25 cards. No app alert or crash was observed; the only console error was an existing external Phantom extension provider collision. A separate live browser visit confirmed all 57 dev-log updates, the new milestone and its exact implementation link. The signed-in Chrome tab was left on Discover.

Production checks use public reads/navigation; no reaction toggle, mark-read action, cast, follow, profile edit, media upload or wallet approval was performed by the release checker. The user handled reauthentication; these checks do not establish production write behavior. Retained Quorum has its own gate and is not represented as verified by these standalone results. The separate mention/reply work and its complete routed receipt (1,935 messenger tests, four offline harness tests and 1,853 standalone tests) are recorded in [PR #16](https://github.com/arcacomputer/opencaster/pull/16). That receipt preserves the mint-guard and unavailable cross-client coverage gaps; no live-mint opt-in was used.

Receipts: `/tmp/opencaster-performance-final-devlog-check-20261027.log`, `/tmp/opencaster-performance-final-verify-20261027.log`, `/tmp/opencaster-performance-full-lint-final-20261027.log`, `/tmp/opencaster-performance-assets-manifest-20261027.json`, `/tmp/opencaster-performance-wrangler-dryrun-20261027.log`, `/tmp/opencaster-performance-release-receipt-20261027.json`, `/tmp/opencaster-performance-wrangler-deploy-20261027.log`, `/tmp/opencaster-performance-deployed-version-20261027.json` and `/tmp/opencaster-performance-live-verification-20261027.json`.

# Immediate casting feedback merged and deployed · 2026-10-26

Release `92c05e4f8c55f255886ddd0867c6d1038bd1d346` is live at 100% traffic as
Worker **`a7167a33-6098-4e8b-bc8d-167a9a4a30aa`**, deployment
`46437390-2fd8-41d1-bf79-82ef2d581141`. The casting milestone links integrated
implementation `a8bde42399774899be4758f1ec99fbb084e333b4`, authored
`2026-10-26T18:55:29-03:00`; its original isolated implementation was
`ef9ac9334e2c511c7d8b2de03719dab83728b044`. The improvements were merged into
the existing `codex/farcaster-conversation-links` application branch and pushed
before deployment. Newer committed identity, public feeds and channel/feed
sharing changes were retained. Unrelated root guidance edits and output remain
outside the release.

The actual pre-release source was
`3f154f01ca809b0513a0cfd1377019016fcd8959`, Worker
`39a9160c-e691-431f-a380-944845bb096b`, deployment
`4493d665-7f91-4056-b5fb-c44db413bafe`. Authenticated deployment metadata was
recorded and confirmed unchanged immediately before upload. The dev-log guard
passed against that exact deployed source for the casting and newly included
channel/feed-preview milestones.

From the clean external worktree, complete `yarn verify` passed **1,810 tests
across 72 files**, browser/Worker/dashboard typechecks, production build and
offline signer typecheck/build. The merged frozen Yarn dependency installation
matches the committed package manifest and lockfile. An earlier combined run
exposed a test that asserted a lazy-loaded public Following picker after a fixed
delay; it now waits for the actual control. The final gate passed after all
merges and that test correction. Existing WalletConnect annotation and large
bundle advisories remain. Retained Quorum was neither changed nor verified.

Fresh production assets were built at
`/tmp/opencaster-casting-production-20261026-0ZdNmZ`. All 230 release inputs
matched their committed blobs; all 33 asset files were inspected with the
existing public WalletConnect project identifier preserved. There are no
fixture wrappers, source maps, symlinks or browser-bundled Worker renderer in
the production asset directory. Wrangler's dry run confirmed the renderer Wasm
is included in the Worker bundle. That exact inspected directory was deployed,
and its hashes remained unchanged. All 32 non-HTML live asset hashes match.
Deployed runtime and all bindings match the pre-release version, including the
origin settings and secret binding, media bucket/quota and analytics bindings.

Regression checks cover immediate local publishing cards, explicit submitted,
uncertain and rejected outcomes, retained drafts, author/full-hash reconciliation,
receipt/read ordering, closing an in-flight composer, lock/account isolation,
reply and quote destinations, and token/FID changes between custom/public
Following feeds. Same-feed refresh and failed refresh retain existing casts.
Profile Casts/Replies/Photos return one complete filtered underlying page and
preserve continuation for scrolling. No authorization check or permission was
removed, and no write is automatically replayed.

Production public reads passed 42 checks covering the new compiled dev log,
page references, every non-HTML asset, API info, public feed routes, legacy
redirect and actual profile/cast 1200×630 PNGs. Additional channel and shared
feed PNG reads also passed at 1200×630. Live browser navigation shows the casting
milestone first among 47 updates, with its implementation link and current
identity. Screenshot: `/tmp/opencaster-casting-live-devlog.png`. All production
checks were public reads/navigation; no real account action, wallet approval,
upload or cast was performed. Pending/write behavior was tested synthetically.

Receipts: `/tmp/opencaster-casting-release-receipt.json`,
`/tmp/opencaster-casting-release-base.json`,
`/tmp/opencaster-casting-release-assets-manifest.json`,
`/tmp/opencaster-casting-release-verify.log`,
`/tmp/opencaster-casting-release-devlog.log`,
`/tmp/opencaster-casting-live-verification.json` and
`/tmp/opencaster-casting-sharing-live-verification.json`.

# Channel and custom-feed previews deployed · 2026-10-26

Implementation `0c749778f220643a0e2dd3186baee6fd87b895c6`, authored
`2026-10-26T18:57:38-03:00`, and its new milestone are deployed in the combined
release `92c05e4f8c55f255886ddd0867c6d1038bd1d346`. Worker
**`a7167a33-6098-4e8b-bc8d-167a9a4a30aa`**, deployment
`46437390-2fd8-41d1-bf79-82ef2d581141`, serves 100% of traffic. That release
preserves the concurrently completed branding and casting improvements. The
preview implementation files match the separately verified source byte for byte.

The actual preceding production source was
`3f154f01ca809b0513a0cfd1377019016fcd8959`, Worker
`39a9160c-e691-431f-a380-944845bb096b`. The dev-log guard passed against that
source. From the clean external preview checkout, complete `yarn verify` passed
**1,772 tests across 69 files**, browser/Worker/dashboard typechecks, production
build and offline signer typecheck/build. The combined release subsequently
passed **1,810 tests across 72 files** and both builds. Existing WalletConnect
annotation and bundle-size advisories remain.

Inspected all 33 files in the combined release's fresh external asset directory,
`/tmp/opencaster-casting-production-20261026-0ZdNmZ`. All 32 non-HTML live hashes
match its manifest. The existing public WalletConnect configuration, gateway
settings, server-only secret binding, media storage/quota and analytics bindings
are preserved. No preview wrapper, test fixture, source map, symlink or browser
image-renderer bundle was deployed.

Real local Worker and production public reads verified `/channel/art` and two
distinct shared custom-feed recipes, plus existing profile and full-hash cast
links. Initial HTML for Telegram and X user agents contains the channel or feed
identity, description and individual image URL. Generated PNGs are 1200×630;
the live channel and feed samples measured 158,292 and 141,697 bytes. Distinct
recipes produce distinct images. HEAD, invalid image queries, malformed feed
fallback, the homepage and API info read passed. The browser live dev log shows
the channel/feed milestone second among 47 updates, with its implementation link.
Synthetic render inspection covers channel descriptions/images and long feed
rules; a real local 5,612-character recipe with 20 phrases also renders safely.

The live art channel currently supplies a name and participant count but no
description or image, so its card uses the documented fallback. Feed cards
describe the shared public recipe, without reading saved browser state or
claiming current results. Images shorten long lists and phrases; metadata and
the link preserve the validated recipe. Generated cards expire at our edge after
five minutes. Third-party app display/caches were not tested by posting links;
font and remote-image limits remain as documented below. All production actions
were public reads and navigation, with no account mutation or upload. Retained
Quorum was neither changed nor verified; unrelated root guidance was preserved.

Receipts: `/tmp/opencaster-channel-feed-release-receipt.json`,
`/tmp/opencaster-channel-feed-live-verification.json`,
`/tmp/opencaster-channel-feed-local-verification.json`,
`/tmp/opencaster-channel-feed-max-token-verification.json`,
`/tmp/opencaster-channel-feed-verify.log` and the combined asset manifest
`/tmp/opencaster-casting-release-assets-manifest.json`.

# Open Door identity deployed · 2026-10-26

Release `3f154f01ca809b0513a0cfd1377019016fcd8959` is live at 100% traffic as
Worker **`39a9160c-e691-431f-a380-944845bb096b`**, deployment
`4493d665-7f91-4056-b5fb-c44db413bafe`. The new milestone links implementation
`970900707d709cffe6885af4c079b7a21690b587`, authored
`2026-10-26T18:54:53-03:00`.

Authenticated Cloudflare metadata established the actual release base as
`9807b4c7252366d9036ba572aa6a8c3afac90ade`, Worker
`5cc44b68-f7e5-4315-a7bc-2ae11b92497c`, and confirmed that production still used
that base immediately before deployment. The dev-log guard passed against that
exact source. In a clean, pinned external checkout, full `yarn verify` passed
**1,711 tests across 68 files**, browser/Worker/dashboard typechecks, production
build and offline signer typecheck/build. A separate focused branding run passed
137 tests. Existing WalletConnect annotation and bundle-size advisories remain.
The reused dependency installation matches the committed package manifest and
frozen Yarn lockfile. All 223 tracked release inputs match their committed blobs,
and the offline signer build records a clean source tree. Concurrent channel/feed
work, root guidance edits and exploratory image-generation output were excluded
from the release.

The final production build used the fresh external directory
`/tmp/arca-release-opencaster-logo-20261026-3k7adm6l`. Its 33 files include the
new editable social SVG and 1200×630 PNG, retain older published card addresses,
and contain no fixture wrappers, source maps, symlinks or browser-bundled image
renderer. The existing public WalletConnect project identifier was preserved.
Wrangler's dry run passed, the inspected Worker bundle contains the new symbol
and internal preview-cache version, and that exact asset directory was deployed.
All 32 non-HTML live asset hashes match the inspected build. Existing gateway
settings, server-only secret binding, media storage/quota and analytics bindings
match the previous Worker version.

Visual checks covered the flat SVG, a 32px rendering, site introduction artwork,
and live profile/cast PNGs. Public Telegram/X user-agent reads receive individual
profile/cast metadata; both generated PNGs are 1200×630 and show the new mark.
The live favicon URL and generic Open Graph/X image metadata point to the refreshed
artwork. A browser visit to `/devlog` shows the Open Door milestone first among
45 updates, with its exact implementation link and the new sidebar logo. The
existing API info read also passed. Third-party sharing apps retain control over
their own preview caches; no link was posted to those apps. All production checks
were public reads and navigation, with no wallet approval, account mutation,
upload or social post. Retained Quorum was neither changed nor verified.

Receipts: `/tmp/opencaster-logo-release-receipt.json`,
`/tmp/opencaster-logo-assets-manifest.json`,
`/tmp/opencaster-logo-live-verification.json`,
`/tmp/opencaster-logo-verify.log` and `/tmp/opencaster-logo-devlog-check.log`.

# Individual cast and profile previews deployed · 2026-10-26

Release `9807b4c7252366d9036ba572aa6a8c3afac90ade` is live at 100% traffic as
Worker **`5cc44b68-f7e5-4315-a7bc-2ae11b92497c`**, deployment
`6ace4260-5436-4067-93df-c5f23e59e507`. The individual-preview milestone links
implementation `91b374d7edd3b8263226590970ff664edd5242eb`, authored
`2026-10-26T17:40:41-03:00`. This release also includes the previously prepared
custom public timelines implementation and its milestone described below.

The actual release base was `11f8ad59a477bb112f05adb6fabf07b6fbff2c4c`, Worker
`234ac97d-665b-4d00-8669-70614a872788`. The dev-log guard passed against that
base for both milestones. From the clean external release checkout, complete
`yarn verify` passed **1,711 tests across 68 files**, browser/Worker/dashboard
typechecks, production build and offline signer typecheck/build. The dependency
installation matches the committed manifest and frozen Yarn lockfile; all 221
tracked inputs matched committed blobs, and the signer manifest records a clean
source tree. Existing WalletConnect annotation and bundle-size advisories remain.

The fresh external production directory contains 31 files, with no fixture
wrappers, source maps, symlinks or browser-bundled renderer. The public
WalletConnect project ID was preserved in compiled assets and removed from the
deployment environment. That exact directory was deployed; all 30 non-HTML
live asset hashes match. Existing gateway settings, server-only secret binding,
media bucket/quota namespace and analytics bindings match the previous version.

Real local Worker and production public reads verified `/pichi`, the numeric
profile, `/cast/0xbd787413995e9136d8cc636c6f1ee5331b94ec6d` and the existing
`/pichi/0xbd787413` short link. Telegram and X user-agent requests receive public
profile/cast metadata. Generated 1200×630 PNGs show the actual avatar, profile
bio or cast text; supported image-attachment layout also passed synthetic
raster rendering checks. The live profile and cast PNGs measured 228,866 and
164,131 bytes in this run. HEAD, invalid content-bearing image queries, the
existing API info read and image response protections passed. The browser live
dev log shows the individual-preview milestone first among 44 updates.

Lookups have a four-second shared deadline; short aliases inspect at most 500
recent native receipts, check observed collisions and hydrate the exact
FID/hash. Newly copied cast links use the full hash. Public PNGs expire after
five minutes at our edge; third-party display/caches were not tested by posting
links. Only bounded PNG/JPEG images from our content-addressed storage or the
fixed image CDN are embedded; other imagery uses initials/text. Some Unicode
glyphs are unavailable in the bundled image font; metadata retains the text.
All production checks were public reads and navigation. No wallet approval,
account mutation, upload or social post occurred. Retained Quorum was neither
changed nor verified; unrelated root guidance edits were preserved.

Receipts: `/tmp/opencaster-entity-preview-release-receipt.json`,
`/tmp/opencaster-entity-preview-assets-manifest.json`,
`/tmp/opencaster-entity-preview-live-verification.json`,
`/tmp/opencaster-entity-preview-local-verification.json` and
`/tmp/opencaster-entity-preview-verify.log`.

# Custom public timelines prepared · 2026-10-26

Implementation `693433f9c354551cac05dc1917108554f94fa137`, authored
`2026-10-26T17:36:26-03:00`, adds a wallet-free Feeds area, browser-local
creation/customization/pins, shareable public feed rules and public Following
browsing by username/FID. It is prepared locally and **has not been deployed**.
The new dev-log milestone points to that implementation and preserves history.

The final standalone `yarn verify` passed **1,487 tests across 63 files**, browser
and Worker typechecks, the production browser build, and offline signer
typecheck/build. The clean verification snapshot is
`/tmp/opencaster-feeds-isolated-20261026-izacf0u6`, based on `be812e55` plus the
Feeds implementation and its new milestone. Its frozen dependency manifest and
Yarn lockfile match the pre-existing external installation. This feature changes
no dependencies. Existing Rollup annotation and large-chunk advisories remain.
The snapshot has local Git metadata for the signer build manifest; its
`source-manifest.json` records the actual checked source hashes.

The shared checkout also contains unrelated work in progress. An initial mixed
snapshot failed eight tests while that work was incomplete; it is not reported
as a pass. The successful gate excludes those unrelated source/test/dependency
changes and verifies this feature against its committed base. No combined
verification verdict is claimed for the other changes, and retained Quorum was
not changed or verified.

The 65 added tests cover recipe validation and size limits, Unicode share links,
literal phrase filters, local-storage failure, mixed-source pagination and
concurrency, atomic failure/retry, cancellation, browsing limits and cursor
cycles. Component/App checks cover guest public Following lookup and direct
links, shared feed loading, content controls, creation/editing/pinning/deletion,
reload persistence and Back/Forward. Editing a shared or saved literal phrase
containing a comma preserves its exact meaning.

Chrome exercised the built browser UI through a localhost-only server with
synthetic identities and API responses. It created a feed, combined trending and
an account source, changed filters/order, saved and pinned it, and opened it
without a wallet. Reload restored the saved definition and pin. The manager,
pinned timeline, editor and direct public Following route were checked at
390×844 with the mobile navigation visible; no horizontal overflow was visible.
The viewport override was reset afterward. Screenshots:
`/tmp/opencaster-feeds-desktop.png` and `/tmp/opencaster-feeds-mobile.png`.
The fixture has no upstream proxy and rejects write requests; no real account
action, signature, upload, push or deployment was performed.

Feeds and pins stay in this browser and are shared by accounts using it. Shared
URLs include the public feed name, sources and filters. Newest loaded first
sorts returned casts only; no complete global feed or personalized ranking is
claimed. Reads remain bounded to eight sources, four concurrent requests and
64 pages per source. Hypersnap availability and indexed-history limits remain.

Full final gate output: `/tmp/opencaster-feeds-final-verify-20261026.log`.
The committed-range `yarn check:devlog --base be812e55 --head HEAD` passed for
seven shipped files and the new `choose-your-public-timelines` milestone. That
is a local feature comparison; deployment still requires checking the actual
pre-release deployed commit and following the fresh-asset release procedure.

# Infinite timeline browsing deployed · 2026-10-26

Release `11f8ad59a477bb112f05adb6fabf07b6fbff2c4c` is live on
**https://opencaster.org** at 100% traffic as Worker version
`234ac97d-665b-4d00-8669-70614a872788`, deployment
`b3e13d69-ed2c-4746-a27a-d43954f38ea7`. The release includes implementation
`cb71fddd38ba4e4930cd100d5bef362320a5e2bb` and its separate milestone. Both
commits were pushed to the existing `codex/farcaster-conversation-links` branch
before deployment. In-progress workspace changes were excluded from this
pinned release.

Authenticated Cloudflare deployment metadata established the actual pre-release
source as `d231a512076c3c15f3771616a5bdfc0506a92350`, Worker version
`182a2e1e-3e26-4421-94b9-a9623502695e`, deployment
`b9b5d3f1-2f46-4988-9002-16020d981f8d`. It was confirmed unchanged immediately
before upload. The dev-log guard passed against that exact deployed source.
The complete standalone `yarn verify` passed **1,422 tests across 59 files**,
browser/Worker typechecks and production build, and offline signer
typecheck/build. Existing Rollup annotation and large-chunk advisories remain.
Retained Quorum was neither changed nor verified.

Committed sources were archived at
`/tmp/opencaster-infinite-release-20261026-jlnytoib`; all 201 release inputs
matched their recorded hashes. The frozen external dependency installation’s
package manifest and lockfile match this release. The prior public WalletConnect
identifier was preserved and its deployed bundle was verified before rebuilding.
Fresh production assets were built into
`/tmp/opencaster-infinite-production-20261026-6mz5zi41`. Inspection covered all
28 files, resolved local references, all 42 milestones, the implementation link,
and absence of fixture wrappers, source maps and symlinks. Wrangler’s dry run
passed and that exact inspected directory was deployed; its hashes stayed
unchanged after upload.

Post-deployment metadata confirms 100% traffic on the new Worker, unchanged
runtime settings and identical bindings, including the private-primary/read-
backup settings, secret binding, media bucket/quota namespace and analytics
bindings. Gateway code and configuration were unchanged in this release.
Public reads verified all 27 non-HTML asset hashes, sharing metadata and headers,
the social image and robots file. `/api/v1/info` returned 200 and the legacy
`/devlog` address retained its canonical 308 redirect.

Live desktop browsing started with 25 casts and automatically loaded 50 near
the bottom, without a More conversations button. At 390×844, scrolling loaded
75 casts with no alerts or horizontal overflow. The viewport override was
reset. The live dev log displayed the new Keep scrolling through conversations
milestone, its exact implementation link and all 42 source links. These checks
used public reads/navigation only; no production wallet, signing, upload or
social account action was performed. Available history still depends on
Hypersnap.

Receipts: `/tmp/opencaster-infinite-release-receipt.json`,
`/tmp/opencaster-infinite-assets-manifest.json`,
`/tmp/opencaster-infinite-live-verification.json` and
`/tmp/opencaster-infinite-release-verify.log`. Screenshots:
`/tmp/opencaster-infinite-live-desktop.jpg` and
`/tmp/opencaster-infinite-live-mobile.jpg`.

# Infinite timeline browsing prepared · 2026-10-26

Implementation `cb71fddd38ba4e4930cd100d5bef362320a5e2bb`, authored
`2026-10-26T17:15:41-03:00`, replaces timeline pagination buttons with automatic
loading near the bottom of Discover, Following, channel feeds and profile tabs.
Existing casts stay readable during loading; failed pages require an explicit
retry. Sparse and locally filtered pages retain continuation, obsolete requests
are cancelled, and repeated cursors stop safely. The dev-log milestone links
that implementation and preserves the earlier entries. This change is prepared
locally and **has not been deployed**.

The final standalone `yarn verify` passed **1,422 tests across 59 files**, browser
and Worker typechecks, the production browser build, and offline signer
typecheck/build. Verification ran from `hypersnap/` in a fresh external copy at
`/var/folders/dj/z0hgcnzx62504_nbgstgp_yc0000gn/T/opencaster-infinite-20261026-dzmmexu9`.
All 201 source/config/asset inputs, including the parent license, matched the
workspace after the run. Its dependency manifest and frozen Yarn lockfile match
the existing external installation used for dependencies. No dependency or
lockfile changed. Existing Rollup annotation and large-chunk advisories remain.
The final gate also includes the concurrently committed sharing-card changes.

The added component and App integration checks cover observer activation and
cleanup, same-tick duplicate notifications, sparse and filtered pages, explicit
retry, exhaustion, cursor cycles, refresh, background-conversation pause/resume,
and browsers without IntersectionObserver. Existing profile-tab and trending-
window cancellation checks now use observer events; channel ordering and
normalized-hash deduplication remain checked.

An isolated localhost browser preview served only synthetic identities and API
responses, with no upstream proxy. Desktop scrolling loaded casts 1–25 and then
26–50 automatically. A deliberate next-page HTTP 503 left the existing 50 casts
readable with Try again; an explicit retry loaded 51–75 and showed the end of
available casts. At 390×844, scrolling also advanced from 25 to 50 with loading
feedback and no horizontal overflow. The viewport override was reset afterward.
Screenshots: `/tmp/opencaster-infinite-desktop.jpg` and
`/tmp/opencaster-infinite-mobile.jpg`.

`yarn check:devlog --base d231a512` passed for the three shipped runtime/style
files and the new `automatic-timeline-browsing` milestone. That base is the
pre-implementation local commit, not a newly established production release
base. A deployment still needs the actual deployed base and the repository’s
fresh-asset release procedure. No production account action, wallet signature,
upload, push or deployment was performed for this change. Hypersnap availability
and indexed-history limits remain; retained Quorum was not changed or verified.

Full gate output: `/tmp/opencaster-infinite-final-verify-20261026.log`.
The external copy’s `source-manifest.json` records the checked input hashes.

# Private analytics dashboard deployed · 2026-10-24

The private dashboard is live at **https://analytics.opencaster.org**. The
operator completed Zero Trust Free activation and authorized their current
Cloudflare account for access. A self-hosted Access application covers the full
hostname, with exactly one email Allow rule, Cloudflare as the selected identity
provider, a 24-hour session and an HTTP-only authorization cookie. The saved
email rule and cookie setting were read back from the dashboard. No additional
operator account or service credential was created.

Release `3728dfcec8c9d8917b416ded953587c416938db5` is deployed at 100% traffic:

- Private `opencaster-analytics`: Worker version
  `1bdeb3ba-06df-446b-b7c8-d4fc3620d61d`, deployment
  `b8ec138b-198d-4034-b1ff-572d5c519fbb`.
- Public `hypersnap-quorum`: Worker version
  `395cab1b-d6b9-407e-a150-19812a7f2989`, deployment
  `efede34f-fc95-4735-8571-727fbf4c3af3`, serving the accompanying dev-log updates.

The actual public release base remained
`c5d0ba4ccf1cad9d166e39c2d7d11844e869126f`, version
`3066a446-bbff-4ddc-b1e7-d59c40086d41`. Initial private version
`4a72bb04-1402-4f8b-8d5c-bcec518dc642`, source `a4cdcf83`, correctly blocked
signed-out requests, but its extra authentication check rejected the approved
session. Implementation `92bbb8ebd4f5e497c4d870bb5cb9e126b7dfd3b2`, authored
`2026-10-24T07:20:51-03:00`, added Cloudflare's verified runtime application
context, scoped to the configured audience, while retaining signed-assertion
validation when that context is absent. A separate milestone records that
compatibility fix. Authentication tokens and additional identity details were
not needed for the correction.

The complete standalone `yarn verify` passed **1,381 tests across 57 files**,
browser/gateway/dashboard typechecks and production build, and offline signer
typecheck/build. All 193 tracked inputs matched the committed release and frozen
external workspace. The 18 Worker tests include verified runtime contexts,
wrong/malformed application audiences, absent-context JWT validation, strict
input limits, deadlines, generic failures, private headers and disabled alternate
URLs. Five renderer tests and the 14 existing CLI report tests also pass. Both
committed dev-log checks passed: public base `c5d0ba4c` to the release, and initial
private base `a4cdcf83` to the release. No dependency or lockfile changed; only
the existing Rollup annotation and large-chunk advisories remain.

Fresh production inputs were built and inspected in
`/tmp/opencaster-private-dashboard-final-20261024-CaVopwSw`. Wrangler deployed
the exact inspected, prebundled dashboard Worker with `--no-bundle`, and the
exact `public/` directory for the main site. All 25 public files and the Worker
hash remained unchanged after upload. Public reads match all 24 non-HTML asset
hashes and the exact release HTML at `/` and `/devlog`. The direct `/index.html`
URL uses the hosting platform's canonical 307 redirect to `/`; an initial check
that expected a response body there was corrected. API info returned 200 and
the legacy dev-log URL retained its 308 redirect. All 38 prior milestones remain
in order, plus the two new entries; both new titles were confirmed in the live
rendered dev log. Public assets contain no dashboard Worker code or preview
fixture, and no signer binary was published.

Chrome's existing approved Cloudflare session opened the real aggregate report.
The 1-, 7-, 30- and 90-day periods and form refresh all rendered visits,
countries, traffic sources, pages and actions. A rapid sequence of refreshes
briefly returned the generic unavailable response; a direct 90-day query
returned HTTP 200 and the dashboard recovered on reload. Query availability and
Cloudflare operational limits remain dependencies. No new browser tracking was
added. Report counts can include verification traffic and are not unique users
or confirmed social writes.

Signed-out requests, invalid assertion headers and invalid authorization cookies
all returned 302 to the configured Access login with no report content and
private/no-store headers. A second real identity was not used. Dashboard
response-header protections were verified in the tests and inspected deployed
handler; authenticated browser response headers were not separately captured.
Cloudflare deployment metadata confirms that `workers.dev` and preview URLs are
disabled and only the native analytics binding and two public Access identifiers
are configured. Dashboard invocation logs/traces remain disabled. The public
gateway's bindings, private-primary/read-backup settings, server-secret binding
and existing redacted invocation diagnostics match their pre-release metadata;
the gateway source and configuration are unchanged. No Hypersnap signing,
publishing, upload or other social write was performed. Retained Quorum was not
changed or verified.

Receipts include the release directory's `manifest.json` and
`public-verification.json`,
`/tmp/opencaster-private-dashboard-readydeploy-gate-receipt-20261024-3728dfce.json`,
`/tmp/opencaster-private-dashboard-runtime-after-main-release.json` and
`/tmp/opencaster-private-dashboard-denial-verification.json`. Live screenshot:
`/tmp/opencaster-private-analytics-live.png`; saved policy screenshot:
`/tmp/opencaster-private-dashboard-owner-policy.png`.

# Private analytics dashboard prepared, activation pending · 2026-10-24

Implementation `15e4e058f52b1141bdbca7b9ee986666eb1263f9`, authored
`2026-10-24T07:08:01-03:00`, adds the separate operator dashboard and shared
report core. It is **not deployed or available for production sign-in yet**.
The current public deployment remains source
`c5d0ba4ccf1cad9d166e39c2d7d11844e869126f`, Worker
`3066a446-bbff-4ddc-b1e7-d59c40086d41`, established from authenticated deployment
metadata before this work. No production analytics policy, DNS route or Worker
was changed during dashboard preparation.

The full standalone `yarn verify` passed **1,377 tests across 57 files**, browser,
gateway and dashboard typechecks, the production browser build, and offline
signer typecheck/build. Verification reused the frozen external installation at
`/tmp/opencaster-reply-check-b2Hft6ff/hypersnap`; all 193 source/config inputs
matched the checkout before the release-note/verification edits. No dependency
or lockfile changed. Existing Rollup annotation and large-chunk advisories remain.

The 14 dashboard Worker tests use synthetic RSA signatures and mock SQL results.
They cover missing/malformed/invalid assertions, issuer/audience/time/signature
checks, fixed JWKS origin, stalled transport/body deadlines, authentication before
queries, allowed paths/periods, generic failures, private response headers and
disabled alternative URLs/logs. Five shared-renderer tests and the 14 existing
CLI tests cover script-free controls, labels, escaping, sample weighting and the
credential-free Worker adapter. All ten fixed native SQL queries separately
returned HTTP 200 from Cloudflare's read-only API, with the same available
aggregate results as the local report, including 20 visits, 49 page views and
18 clicks in the checked seven-day window. The new API applies sample weights
automatically; the dashboard uses COUNT/AVG rather than double-weighting them.

Wrangler 4.152.0 dry-run bundled the assetless dashboard with the native SQL
binding. The inspected 33 KiB output in
`/tmp/opencaster-private-dashboard-worker-build-20261024` includes no CLI
credential or filesystem code. A localhost-only visual preview used synthetic
data, visibly labelled as a preview; period selection and refresh submitted the
chosen range. No preview fixture is part of deployment inputs.

The new milestone links the implementation's full hash and recorded author
date. `yarn check:devlog --base c5d0ba4ccf1cad9d166e39c2d7d11844e869126f`
passed for eight shipped inputs and the new milestone; the complete standalone
gate passed again with that note included. Fresh production assets were built
at `/tmp/opencaster-private-analytics-production-20261024-8yALFkmx` and inspected:
25 files, all entry-point references resolve, all earlier milestones remain,
and the new source link is present. There are no preview fixtures, source maps,
symlinks or private-dashboard Worker code in the public assets. Their hashes are
recorded in `/tmp/opencaster-private-dashboard-release-manifest.json`; this
directory has not been deployed.

Cloudflare Zero Trust is not configured on the account. Its Free activation
checkout requires agreement to terms and authorization of the saved card for
usage above free limits. Preparation stopped before those checkboxes or Activate.
The operator must approve/complete that step before provisioning exact-email
Access, recording its real team domain/audience, and deploying. Current empty
Access identifiers deliberately deny every request. Real approved-user sign-in,
signed-out redirect, unauthorized-user denial, deployed binding behavior, all
four live periods and live response headers remain unverified. Recheck the live
release base, run the release guard and gate, inspect fresh external assets, and
confirm the live dev log when activation and deployment proceed. Retained
Quorum was neither changed nor verified; all unrelated root edits were preserved.

# Cloudflare invocation logs enabled · 2026-10-24

At the operator’s request, Chrome’s signed-in Cloudflare dashboard enabled
persisted Worker invocation logs at 100% sampling. Invocation logs and dashboard
persistence are on; automatic traces and real-time Issues remain off. No new
pricing terms or external export destinations were accepted or configured.

Source alignment `303a8bfceded1ed50696c30ff7743b7bf09bc760` preserves the setting
in Wrangler and enables URL query-string redaction. The required milestone links
that implementation with its author date `2026-10-24T06:06:32-03:00`. Release
`c5d0ba4ccf1cad9d166e39c2d7d11844e869126f` is deployed as Worker
**`3066a446-bbff-4ddc-b1e7-d59c40086d41`** at 100% traffic, deployment
`1bf35058-a02a-41ac-8d89-0216ecf2e112`. Its release base was source
`8fdceabd9b5dd62dd83837467de325d9d70b3f38`, Worker
`bfbbc4f9-364c-41e5-b627-10d51de7eb56`. Only observability settings changed in
Wrangler; application Worker code, server secret binding, gateway settings,
media/analytics bindings and migration remain unchanged.

The dev-log guard passed against that actual base for one shipped configuration
file and the new milestone. Complete standalone `yarn verify` passed **1,358
tests across 55 files**, browser/Worker typechecks and build, and offline signer
typecheck/build. The existing frozen temporary installation was reused; all 175
source/test/tooling/asset/config input hashes matched. Dependencies and lockfile
were unchanged. Existing Rollup annotation and large-chunk advisories remain.

Fresh assets in `/tmp/opencaster-observability-production-20261024-c5d0ba4c-DYGu5vOg`
were inspected: 25 files, all local references resolved, no fixture wrappers,
source maps or symlinks, and all 38 milestones present in preserved order.
Wrangler 4.152.0 schema and dry-run accept query redaction. That exact directory
was deployed without changing its hashes. Public reads verified all 24 non-HTML
asset hashes, exact release HTML at `/` and `/devlog`, API info 200 and the legacy
308 redirect. An initial Python HTTP client received 403; ordinary curl GETs
completed the checks without any challenge handling.

Chrome confirmed stored request events in the requested Events view. A harmless
public request to `/observability-check-20261024?redaction_probe=public-check`
appeared as `GET https://opencaster.org/observability-check-20261024`, without
its query string. Events include automated traffic and these verification reads;
they are not unique visitors. Existing aggregate visit/click/performance analytics
remain separate. These checks used public reads and the authorized hosting
setting changes; no real wallet, signature, upload or social write occurred.
The retained Quorum application was not changed or verified.

Receipts: `/tmp/opencaster-observability-release-base.json`,
`/tmp/opencaster-observability-release-manifest.json`,
`/tmp/opencaster-observability-deployment-receipt.json`,
`/tmp/opencaster-observability-public-verification.json` and
`/tmp/opencaster-observability-ui-verification.json`. Dashboard screenshot:
`/tmp/opencaster-observability-enabled.png`.

# Reply context deployed · 2026-10-24

Release source `8fdceabd9b5dd62dd83837467de325d9d70b3f38` is deployed at 100%
traffic as Worker **`bfbbc4f9-364c-41e5-b627-10d51de7eb56`**, deployment
`db207a87-51c7-4697-b552-c733acec3dbf`. The new **Replies keep their context**
milestone links implementation `be8b02d66a39c9bfb4698ad0c3efea86293ea947`,
whose recorded author date is `2026-10-24T05:38:53-03:00`. Both commits were
pushed to `codex/farcaster-conversation-links` before deployment.

Authenticated deployment metadata established the actual pre-release source as
`30bebaec47e737f0d21109f73fb55741cdb5aaeb`, Worker
`b6e27913-0e92-4f90-a56a-0d01087989c4`. That newer gateway release was merged
before shipping; its Worker code and Wrangler configuration are unchanged in
this release. Post-deployment metadata confirms the same private-primary/read-
backup settings, server secret binding, media bucket/quota namespace, analytics
bindings and migration tag. No credential was read or copied into browser assets.

`yarn check:devlog --base 30bebaec47e737f0d21109f73fb55741cdb5aaeb` passed for
four shipped runtime files and the new milestone; the exact committed range
passed too. The complete standalone `yarn verify` passed **1,358 tests across
55 files**, browser/Worker typechecks and production build, and offline signer
typecheck/build. Verification used the frozen temporary installation described
below, with 175 source/test/tooling/asset/config input hashes matching this
checkout. The increased test count includes the already deployed gateway tests.
No dependency or lockfile changed; existing Rollup annotation and large-chunk
advisories remain. No signed companion binary was replaced.

Fresh production assets were built in
`/tmp/opencaster-reply-production-20261024-8fdceabd-Rkp7NxMi`. All **25 files**
were inspected: local imports resolve, prior milestones remain, the new source
link is present, and no fixtures, preview wrappers, source maps or symlinks are
included. The public WalletConnect project configuration matches the prior
live bundle. Wrangler 4.152.0 dry-run passed, then that exact inspected directory
was deployed. Its hashes remained unchanged after upload, and all **24 non-HTML
public asset hashes match** the manifest.

Served HTML differs by one Cloudflare Insights script and one following LF.
Removing exactly those edge-injected bytes reproduces the built `index.html`.
Removing only the script leaves that one LF, so neither raw HTML nor the
script-only comparison is reported as byte-identical. The unchanged self-only
script CSP blocks the external beacon. No Cloudflare analytics setting or CSP
was changed by this release.

Live desktop (1440px) and mobile (390px) checks of
`/ahn.eth/0xf9efb558` show two earlier casts, the original image and the immediate
recipient `@cryptonjal`, with no visible alerts or horizontal document overflow.
The public author's Replies feed shows its recipient and linked parent excerpt.
The live dev log shows **37 milestones**, including the new title and exact
implementation link. Public `/api/v1/info` returned 200 via the configured read
backup, and the legacy domain returned 308 preserving the cast path and query.
These checks used public reads/navigation only; no real wallet, signature,
upload or social write was performed. The retained Quorum application was
outside this release and was not verified.

Receipts: `/tmp/opencaster-reply-release-base.json`,
`/tmp/opencaster-reply-release-manifest.json`,
`/tmp/opencaster-reply-deployment-receipt.json`,
`/tmp/opencaster-reply-public-verification.json` and
`/tmp/opencaster-reply-live-ui-verification.json`. Live screenshots:
`/tmp/opencaster-reply-context-live-desktop.png`,
`/tmp/opencaster-reply-context-live-mobile.png`,
`/tmp/opencaster-reply-context-live-timeline.png` and
`/tmp/opencaster-reply-context-live-devlog.png`.

# Reply context in timelines and conversations · 2026-10-24

The standalone `yarn verify` passed **1,096 tests across 52 files**, browser/Worker
typechecks and production build, and offline signer typecheck/build. Checks ran
in `/tmp/opencaster-reply-check-b2Hft6ff/hypersnap` after a frozen Yarn install
because dependency reads in this cloud-synced checkout stalled before test
collection. SHA-256 comparisons confirmed all 170 source, test, tooling, asset,
manifest and lockfile inputs matched this checkout. The temporary workspace also
included the unchanged root license and a read-only reference to the source Git
metadata required by the signer manifest. No dependency or lockfile changed.
Existing Rollup annotation and large-chunk advisories remain.

Timeline replies now identify the parent author and show a two-line parent
excerpt with an ordinary navigable cast link. Conversations show up to eight
verified earlier casts, oldest first, above the selected reply; nested replies
identify their immediate recipient without duplicating the parent text. Parent
reads share four transport slots and a 128-entry in-memory cache, while the
ancestry walk has a 20-second total deadline. Missing parents retain the selected
reply, show an explicit node-availability notice and permit retry/navigation.
Hidden and muted parents remain subject to local content controls.

Synthetic regressions cover exact parent hash/FID checks, cycles, depth/deadline
bounds, partial ancestry, cache limits, independent cancellation, stale reads,
retry after an invalid cached author response, modified clicks, unresolved-FID
profile navigation, channel roots and content filtering. An initial new race
test expected a full URL label despite the existing shortened display; the
assertion now checks the exact link destination and visible leading text. The
first temporary signer build lacked the root license; adding the unchanged
supporting file and Git metadata allowed the complete gate to pass.

Public browser reads through the local preview verified the supplied
`/ahn.eth/0xf9efb558` conversation, including the original image, intermediate
reply and immediate recipient `@cryptonjal`. The author's public Replies feed
shows the corresponding recipient and parent excerpt. Desktop (1440px) and
mobile (390px) checks found no horizontal document overflow. No wallet,
signature, upload or social write was performed. Screenshots:
`/tmp/opencaster-reply-context-desktop.png`,
`/tmp/opencaster-reply-context-mobile.png`,
`/tmp/opencaster-reply-context-timeline.png` and
`/tmp/opencaster-reply-context-timeline-mobile.png`.

These are local, uncommitted changes, **not a deployment**. A release still needs
an implementation commit, its new dev-log milestone, the dev-log check against
the actual deployed base, and the documented production release checks. The
retained Quorum application was outside this change and was not verified.

# Direct short links deployed · 2026-10-23

Follow-up source `9e5d119ba0c37bee9eb9b409885169b1486c897e` is deployed as Worker
**`7841cf8e-0b5f-442b-9435-f914bfba2741`** at 100% traffic, deployment
`3894007c-f652-4ccf-876e-a9c7849ef40a`. Its milestone links implementation
`ae746a653d3cb54a37024652ce1058da2220df50` with the recorded author date.
Authenticated deployment metadata confirmed the actual pre-release base
`d45a12a4952650bc98faf77c6266192e5a676402`, Worker
`0266933d-7e4e-4e49-97d1-0935b5656b03`.

The dev-log guard passed against that base for **three shipped runtime files**
and the new `short-cast-links-open-conversations-directly` milestone. Final
`yarn verify` passed **1,037 tests across 50 files**, browser/Worker checks and
production build, plus offline signer typecheck/build. Frozen dependencies,
lockfile and public wallet configuration were preserved. Existing build
advisories remain; no signed companion binary was replaced.

Fresh production assets were built in
`/private/tmp/opencaster-direct-cast-production-20261023-9e5d119b-ad631B`.
All **25 files** were inspected, including HTML/import references, public assets,
licenses, the milestone/source link and absence of test wrappers, maps and
symlinks. The ordinary success-wall messages are absent from application
bundles. Wrangler 4.152.0 dry-run passed with unchanged bindings, and that exact
inspected directory was deployed. All local hashes remained unchanged, and
all 24 non-HTML public asset hashes match. Served HTML differs only by the same
367-byte Cloudflare beacon injection described below; removing that tag gives
exact equality. The unchanged enforced self-only script CSP blocks the tag.

A fresh live document at `/yes2crypto.eth/0x8d336914` opened the featured cast
and replies automatically, at the unchanged short URL, without a confirmation
click or lookup panel. Desktop (1440px) and mobile (390px) checks showed no
horizontal document overflow or visible alerts. The dev log shows **35 updates**
and the correct implementation link; browser Back restored the cast. API health
returned 200, and the legacy host returned 308 preserving the short path and
query. These checks used public reads/navigation only, with no account, wallet,
signing, upload or social action.

Receipts: `/tmp/opencaster-direct-cast-release-base.json`,
`/tmp/opencaster-direct-cast-release-manifest.json`,
`/tmp/opencaster-direct-cast-deployment-receipt.json` and
`/tmp/opencaster-direct-cast-public-verification.json`. Live screenshots:
`/tmp/opencaster-direct-cast-live-desktop-20261023.jpg` and
`/tmp/opencaster-direct-cast-live-mobile-20261023.jpg`.

# Direct short-link opening · 2026-10-23

The standalone `yarn verify` passed **1,037 tests across 50 files**, browser/Worker
typechecks and production build, and offline signer typecheck/build. Checks used
the same clean, frozen external dependency installation at
`/tmp/opencaster-ui-check-itPz2YeK/hypersnap`, with source checksums matching this
checkout and no dependency or lockfile changes. Existing build advisories remain.

Single verified matches now open their actual conversation immediately from
progress or final results, including incomplete history batches. The lookup
aborts before navigation and ignores late progress, completion and cancellation
errors. It preserves the short URL and browser history. A page with multiple
verified matches still offers exact full-hash choices; no-match continuation,
retries, deadlines and author/hash validation remain. This chooses the first
available match in the returned reverse history, without establishing that the
prefix is unique across unsearched older history.

Regressions exercise abort-before-callback, no subsequent history page, exact
hydration before progress, stale callbacks, partial/final single matches, actual
collisions, no-match retries, replies and Back/Forward restoration. The initial
focused run had three outdated loading-label expectations; those were corrected
before the full gate passed. No validation or dependency rule was relaxed.

A new local browser document at `/yes2crypto.eth/0x8d336914` opened the supplied
cast and its replies automatically at the unchanged short path, with no lookup
panel or Open full cast link. This check used public Hypersnap reads only. These
checks precede the follow-up production release recorded above when deployed.

# Conversation layout and cast links deployed · 2026-10-23

Release source `d45a12a4952650bc98faf77c6266192e5a676402` is deployed as Worker
**`0266933d-7e4e-4e49-97d1-0935b5656b03`**, at 100% traffic (deployment
`620e9c68-d6ad-454a-9a95-76d3d6a1efae`). Implementation
`8f013714fc0aef3471d1e00b3a5eb1baf25ee940` and its recorded Git author date
are linked by the new `farcaster-shaped-conversations-and-cast-links` milestone.
The release branch is `codex/farcaster-conversation-links`.

Authenticated deployment metadata and matching public assets established the
actual pre-release source as `70d3f1b86bfe256ad2d354462100c48795661b99`, Worker
`a779d8f2-05e4-4ab6-b2f8-f90c3601e3b9`. Against that base,
`yarn check:devlog` passed for six shipped files and the new milestone. The full
standalone `yarn verify` passed **1,035 tests across 50 files**, browser/Worker
typechecks and build, and offline signer typecheck/build. The clean temporary
frozen installation described below was reused; checksums confirmed matching
source, assets, manifest and lockfile. No dependency versions were changed.

Fresh production assets were built in
`/private/tmp/opencaster-conversation-production-20261023-d45a12a4-JECziZ`.
All **25 files** were inspected, with no maps, symlinks, duplicate filenames or
test/preview wrappers; imports resolved and the new milestone/source link were
present. The production public WalletConnect ID matches the prior live assets.
Wrangler 4.152.0 dry-run passed with unchanged media, quota, analytics and asset
bindings. That exact inspected directory was deployed, and its local hashes
remained unchanged afterwards. No signed companion binary was replaced.

All 24 directly served non-HTML files match their uploaded hashes. Cloudflare
redirects `/index.html` to `/` and inserts one 367-byte Cloudflare Insights beacon
script into the document. Removing that single tag makes served HTML byte-identical
to uploaded `index.html`; the unchanged enforced CSP retains `script-src 'self'`
and excludes the beacon origin from both script and connection permissions.
The injected external script is therefore blocked. Raw HTML is not reported as
hash-identical; no Cloudflare analytics settings or CSP were changed.

Live browser checks confirmed the updated conversation, quoted image/mention
preview and canonical short share URL for the supplied cast. Desktop (1440px)
and mobile (390px) layouts rendered without document overflow or visible alerts.
The live dev log shows **34 updates**, including the new implementation link.
A direct short-link load found the correct candidate; **Open full cast** opened
its exact author/hash conversation. Incomplete history searches still require
that explicit choice. `/api/v1/info` returned 200, and the legacy host returned
308 while preserving the author/hash path and query. These were public reads
and navigation only: no wallet connection, signing, upload or social write.

Release receipts are in `/tmp/opencaster-conversation-release-base.json`,
`/tmp/opencaster-conversation-release-manifest.json` and
`/tmp/opencaster-conversation-public-verification.json`. Live screenshots:
`/tmp/opencaster-conversation-live-desktop-20261023.jpg` and
`/tmp/opencaster-conversation-live-mobile-20261023.jpg`.

# Conversation layout and author/hash links · 2026-10-23

The final standalone `yarn verify` passed **1,035 tests across 50 files**, browser
and Worker typechecks, production browser build and offline signer typecheck/build.
The checkout's installed `picomatch` source was an unreadable iCloud placeholder,
so verification used a fresh frozen Yarn install in
`/tmp/opencaster-ui-check-itPz2YeK/hypersnap`. Checksums confirmed that the tested
source, public assets, manifest and lockfile matched this checkout. Dependencies
and lockfiles were not changed. Existing Rollup annotation and large-chunk
advisories remain. The retained Quorum application was outside this change.

Synthetic regressions cover generated author/8-hex links, share dialogs, legacy
full-hash navigation, verified alias preservation, Back/Forward caching, prefix
collisions and exact candidate choices, stale conversation reads, featured cast
layout, standalone attachment URLs, UTF-8 mentions and quoted image previews.
Known prefix collisions retain exact author/full-hash links when sharing.

The in-app browser checked the supplied public cast at desktop (1440 pixels)
and mobile (390 pixels) widths through the local preview. The legacy full-hash
path became `/yes2crypto.eth/0x8d336914` after hydration; the share dialog used
that same short path on the canonical origin. Media and quoted thumbnails
rendered, with no horizontal document overflow or visible error alerts. A fresh
short-link load found the cast and required **Open full cast** because the
bounded history search was incomplete; selecting it opened its exact author/hash
conversation. Hypersnap's history/index limits and collision choices remain.

These are local changes, **not a production release**. No account connection,
signature, upload, social write, commit, branch push or deployment was performed.
A release still requires the implementation commit and a new dev-log milestone
linked to it, followed by the documented release checks. Screenshots:
`/tmp/opencaster-conversation-desktop-20261023.jpg` and
`/tmp/opencaster-conversation-mobile-20261023.jpg`.

# Aggregate usage and health statistics · 2026-10-23

Implementation `e0f3d50bd85cd7647a0e2f84ffca6a2ece22851d` adds first-party
Cloudflare Analytics Engine events and a private local HTML report. Release note
`70d3f1b86bfe256ad2d354462100c48795661b99` links that implementation and its
recorded author date. The release guard passed against actual pre-release source
`14550a1de59ac81c4c3a86ee9005d4e36b57c49f`, Worker
`86e3aa7b-2fa5-415a-ad63-0992c9bd529d`.

The final standalone `yarn verify` passed **1,010 tests across 48 files**, browser
and Worker typechecks, production browser build and offline signer build.
Changed source passed ESLint with zero errors or warnings. Existing Rollup
WalletConnect annotation and large-chunk advisories remain. New isolated checks
cover finite telemetry fields, excluded content and credentials, production
gating, StrictMode, queue/batch/document limits, failures, privacy signals and
opt-out, performance samples, origin checks, streamed body limits, request
families, safe storage outages, sampled report queries, escaping and credential
handling. They use synthetic fixtures; no real account write was tested.

Production assets were built freshly from `70d3f1b8` into
`/private/tmp/opencaster-analytics-production-20261023-70d3f1b8`. All **25 files**
were inspected for source maps, test markers, symlinks and duplicate names;
the public WalletConnect configuration, event endpoint and milestone source link
were confirmed. Asset hashes matched after deployment. The exact directory was
deployed as Worker **`a779d8f2-05e4-4ab6-b2f8-f90c3601e3b9`**, with the Analytics
Engine dataset and dedicated rate-limit binding alongside the existing media
bindings. Raw invocation logs, automatic traces and third-party analytics scripts
remain disabled. No signed companion binary was replaced.

A local Worker preview required a temporary Yarn-installed Wrangler 4.152.0:
the globally installed 4.141.0 runtime predates the project's existing
2026-10-19 compatibility date. No dependency or compatibility date was changed.
Chrome's privacy signal correctly disabled browser analytics in the preview.
An isolated in-app browser on the live site showed analytics enabled, the new
milestone among **33 updates**, and working public Settings/Channels navigation.
Authenticated Cloudflare queries confirmed a document visit, page views and the
distinct `nav-settings` and `nav-channels` actions. Data becomes queryable after
an ingestion delay; an immediate snapshot initially contained no browser events.
All ten report queries executed successfully against the live dataset.

Public checks returned 200 for the website and `/api/v1/info`, with node version
**0.13.5**, the restrictive self-only script CSP, and the existing legacy-domain
308 redirect preserving path/query. These checks used public reads/navigation
only: no wallet connection, signature, upload or social write. Browser actions
measure selected UI clicks rather than confirmed protocol operations. Counts
begin with this release, include reloads and can be sampled or affected by bots,
privacy controls, unsupported metrics and delivery loss; they are not unique
people or complete session histories. See [OBSERVABILITY.md](OBSERVABILITY.md).

# Zero-warning source checks · 2026-10-22

**All 262 source lint warnings are resolved; new warnings fail verification.** Implementation `eaebd8c3cabdbbba458f91bdd79d0464c1b5600f` cleans both applications without changing ESLint rules, source exclusions or dependency versions. The full audit covered 1,087 files with **zero errors and zero warnings**; the final gate runs `eslint . --max-warnings 0`. Historical warning counts below describe their recorded runs.

Unused bindings and obsolete suppression comments were removed. Component refresh boundaries now live separately from their single shared context objects, with compatibility exports preserving existing import paths. Hook dependencies follow primitive identities and stable callbacks. Initialization snapshots preserve existing one-time exports and editor drafts; retained-messenger startup timers and queued callbacks are deactivated when their identity scope ends. Already-dispatched service work retains its existing cancellation limits. Sensitive export/file errors keep their prior message-only surface rather than adding transport or SDK objects as causes. Large formatting-only changes were trimmed from three message/channel files before committing.

**24 new isolated regression cases** cover these changes: 19 retained-messenger cases and five Hypersnap cases. They exercise same-identity metadata refreshes, editor hydration, registration/export denial and explicit reauthorization, startup/reconnect timer ownership, stale queued/in-flight reads, invitation errors, reaction quarantine and paginated profile requests. Export fixtures never resolve to real key material; service, wallet and write paths use local mocks/synthetic identities. No production write test or permanent-account minting was performed.

The final complete routed gate, `yarn verify --base=b7e4bda020831496dee403111665a6462816aa3a`, passes **1,915 messenger tests**, **four offline harness tests**, **892 Hypersnap tests**, dependency checks, typechecks, zero-warning lint, both browser builds and the offline signer build. It ran against `bca45a9db7cf0ef46ddcb5572e4c2d84815cd8ba` in **130.81 seconds**, with no failed or retry-only step. Its only dirty files were concurrent root `AGENTS.md`/`CLAUDE.md` edits, preserved separately and excluded from these commits.

An intermediate run on `ac10c34d3bfdde39ec787957cdfe632b7cfc0490` exceeded the default five-second limit in the real-ESLint source-scope test: **6,504 ms**, with no assertion mismatch. The gate's existing retry passed and correctly reported **FLAKY**. Follow-up `bca45a9db7cf0ef46ddcb5572e4c2d84815cd8ba` gives **only that integration case** a documented 15-second budget for real configuration/plugin loading; all ten source/ignore assertions remain unchanged. The 14-case focused tooling suite and subsequent complete gate pass on their first attempts. No global timeout, new retry, rule suppression or baseline exemption was added.

The honest full root verdict remains **PASS (PARTIAL)**. Three retained-messenger production arms lack persisted bot identities and would create permanent state; two cross-client arms need the unavailable optional mobile checkout. The mint guard stayed enabled. These gaps limit live messenger/cross-client claims; they do not represent new Hypersnap protocol coverage. Hypersnap's protocol, API/session implementation, fixed endpoint, wallet scopes, dependencies, gateway and storage configuration are unchanged by this release. Its own auth/protocol, UI and Worker suites run through the standalone child gate. The retained-harness `NOT COVERED` statement in the receipt is scoped to that messenger harness.

[Main CI 39759364530](https://github.com/arcacomputer/opencaster/actions/runs/39759364530) and [feature CI 39759361171](https://github.com/arcacomputer/opencaster/actions/runs/39759361171) both passed on **attempt 1**. Downloaded receipts confirm the complete 1,915/4/892 totals and no failed or retry-only steps. Main compared the complete release with the previous `b7e4bda` source, routed to fast + live and reports **PASS (PARTIAL)** with all five skips visible. The incremental feature push contained only the scoped tooling-test follow-up, so its correct fast-only route reports **PASS**; it is not presented as live coverage. Both workflows also passed the standalone gate and signer payload reproducibility check.

Dev-log note `ac10c34d3bfdde39ec787957cdfe632b7cfc0490` links the actual implementation commit and recorded author date, retaining all earlier milestones. The release guard passed against the actual pre-release deployed source `899af864af8d8f68d0a5b0fcbbc69c347ba64e6e`, Worker `8cc1e700-48ec-4029-b643-1523555acb82`. Production assets were freshly built from `bca45a9db7cf0ef46ddcb5572e4c2d84815cd8ba` into `/tmp/opencaster-lint-production-20261022-bca45a9` and deployed as Worker **`534f865e-09db-40f3-a22c-cddf725c0576`**. All **23** files were inspected for fixture markers, source maps, duplicate names and symlinks; public WalletConnect configuration and the new source link were confirmed. Dry run passed with the existing R2/Durable Object bindings, and every inspected file hash remained unchanged after deployment. The signer renderer export cleanup produces the same production IIFE; no signed companion asset was replaced.

Live browser checks confirmed **24 dev-log milestones**, the new implementation link, 25 discovery casts, hydrated public profile `/profile/912253` and conversation `0xeb7ff856fab32bcde047cf56c8661448bc6700af` with replies. Before/after public `/api/v1/info` reads returned the same peer and version **0.13.5**. Legacy-domain HEAD checks returned **308**, preserving profile path and query. These checks used public reads/navigation only: no wallet connection, signature, passkey/vault action, upload, cast, follow or profile write. The temporary QA tab was closed. Screenshot: `/tmp/opencaster-lint-live-20261022.png`.

Complete final local receipt (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   bca45a9  ⚠ working tree dirty (2 files)
    shared    LINKED → 2.1.0-45 (c00c61e, clean)
    sdk       LINKED → 2.1.1 (882d8e1, clean)

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/signer/renderer.tsx, desktop/hypersnap/src/App.test.tsx, desktop/hypersnap/src/App.tsx)
            (… and 149 more)
            (--base: desktop compared with b7e4bda020831496dee403111665a6462816aa3a)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  dependencies   PASS       1s
  desktop  typecheck      PASS       9s
  desktop  lint           PASS       25s
  desktop  unit           PASS       56s    1915 passed (1915)
  desktop  harness-offline PASS       7s     4 passed (4)
  desktop  build          PASS       9s
  desktop  hypersnap      PASS       23s    892 passed (892)
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  PASS (PARTIAL) — reduced scope, see the warnings below
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

# Repeatable full verification · 2026-10-22

**The missing dependency failures are resolved.** `yarn setup:verify` restores the retained messenger's exact upstream verification sources: shared `2.1.0-45` at `c00c61e099fe9e682c982bc952b4e712c7a4a576` and SDK `2.1.1` at `882d8e1b520fc97c73be964013b06a57ca4f4a63`. Their clean, pinned checkouts live under ignored `.quorum-deps/`; frozen installs and source builds precede the two application installs. Setup refuses unexpected origins, revisions or local changes and records a create-only comparison ref. There are no global links, source resets or new baseline exemptions. Root lock changes contain the two local links and equivalent Yarn alias grouping; Hypersnap's dependency manifest and lockfile are unchanged. Earlier records below describe their historical missing-dependency state.

Implementation `7991946803cba61922afc88edea8a8f27305249d` adds reproducible setup, dependency validation, installed-shared discovery, a separately reported Hypersnap gate and clean-checkout CI. Follow-up `1f53f7e10ec0136df14eacd7802bb4a5469fce9a` makes CI use the actual push/PR comparison SHA instead of an already-advanced `origin/main`, with conservative routing for an unavailable base. Colored test output now yields an actual summary rather than an incidental stack fragment. **29 new isolated tooling tests** cover exact pins, source preservation, immutable comparison refs, child-gate working directory/failure propagation, source-lint boundaries and actual Git/CLI routing. Ten existing path fixtures retain their assertions with native absolute paths; the mention-editor fixture supplies jsdom's missing scroll API and observes its delayed callback without claiming real layout coverage.

The final complete routed run, `yarn verify --base=d2757519462305cd1e25c721b0594ec07e04112d`, checks every change from the pre-task source through `4de0af7c105f125e4c7ca9e0d666a59dc19f5e08`. Dependency validation, TypeScript, source lint, **1,896 messenger tests**, **four offline harness tests**, **887 Hypersnap tests**, both browser builds and the offline signer build pass in **122.72 seconds**, without a retry or unhandled test error. Its three dirty files were this verification draft plus concurrent root `AGENTS.md`/`CLAUDE.md` edits; the guidance edits are preserved separately and excluded from these commits. The 262 existing lint warnings remain visible.

An intermediate final-source rerun passed all messenger tests but failed a real-Git dev-log integration case after **5,324 ms**, beyond its default five-second budget; a second history case took 3,584 ms. Correction `4de0af7c105f125e4c7ca9e0d666a59dc19f5e08` documents a **15-second limit only for the 14 real-Git/Node integration cases**. The five static policy/parser tests retain their default limit. No assertion, guard behavior or runtime validation changed, and no retry was added. The focused 19-case suite and subsequent full gate pass. Intentional Hypersnap control-character validation and sensitive-reference cleanup also retain their original code with line-scoped lint explanations; emitted JavaScript is unchanged for those source files.

The honest root verdict remains **PASS (PARTIAL)**: retained Quorum live arms would create permanent production state without persisted bot identities, and optional mobile cross-client coverage is unavailable. The mint guard remains enabled. This does not establish live messenger or cross-client compatibility. The retained-messenger `NOT COVERED` statement below is scoped to that harness; Hypersnap's own tests and earlier isolated real-node evidence remain recorded separately. There is no Hypersnap protocol, custody authorization, permission, storage or endpoint change in this maintenance release. Automated account writes remain synthetic/isolated; production checks are public reads/navigation only.

The maintenance dev-log release was built from `899af864af8d8f68d0a5b0fcbbc69c347ba64e6e` into `/tmp/opencaster-verification-production-20261022-899af86`, then deployed as Worker **`8cc1e700-48ec-4029-b643-1523555acb82`**. The pre-release source was `c78fc2d898e9972c75fd22af42851d846316fd0f`, Worker `1782c85d-fe54-41a3-9314-e6eefeca5cfa`. All **23** production files were inspected for fixture markers, duplicate filenames, source maps and symlinks; the public WalletConnect configuration and new note's implementation source were confirmed. Worker dry run passed with unchanged R2/Durable Object bindings, and file hashes matched after deployment. The dev-log guard against the actual pre-release source passes; the live page retains all prior milestones and now shows **23** updates. The final verified browser build matches all 23 deployed file hashes byte-for-byte; the later tooling/test follow-ups do not change the browser or Worker source. No signed companion asset was replaced.

Live browser checks confirmed the new note and its implementation link, connected Hypersnap status, discovery casts, `/profile/912253` identity hydration and a local cast conversation with replies. Before/after public `/api/v1/info` reads returned the same node peer and version `0.13.5`. A legacy-domain HEAD returned 308 with path/query preserved. No wallet connection, signature, upload or social write was performed, and the temporary QA tab was closed. Screenshot: `/tmp/opencaster-verification-live-20261022.jpg`.

[Corrected-routing main CI 39754164021](https://github.com/arcacomputer/opencaster/actions/runs/39754164021) and [feature CI 39754162528](https://github.com/arcacomputer/opencaster/actions/runs/39754162528) both passed on their first attempts. Their downloaded receipts confirm **PASS (PARTIAL)**, correct live-tier routing, readable 1,896/4/887 test totals, and all five guarded/unavailable skips. This is distinct from the initial clean-checkout CI's fast-only baseline, whose routing prompted the comparison fix. [Final-source main CI 39754762541](https://github.com/arcacomputer/opencaster/actions/runs/39754762541) and [feature CI 39754762037](https://github.com/arcacomputer/opencaster/actions/runs/39754762037) also passed on their first attempts after the scoped integration timing fix. Both downloaded receipts report **PASS (PARTIAL)** with the same complete 1,896/4/887 totals, zero failed or retry-only steps, and all five visible skips. Their clean Linux installs/builds confirm the bootstrap works independently of this Mac.

The complete final local receipt follows (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   4de0af7  ⚠ working tree dirty (3 files)
    shared    LINKED → 2.1.0-45 (c00c61e, clean)
    sdk       LINKED → 2.1.1 (882d8e1, clean)

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/.github/workflows/hypersnap.yml, desktop/.gitignore, desktop/eslint.config.js)
            (… and 21 more)
            (--base: desktop compared with d2757519462305cd1e25c721b0594ec07e04112d)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  dependencies   PASS       1s
  desktop  typecheck      PASS       8s
  desktop  lint           PASS       22s    0 errors, 262 warnings
  desktop  unit           PASS       48s    1896 passed (1896)
  desktop  harness-offline PASS       10s    4 passed (4)
  desktop  build          PASS       10s
  desktop  hypersnap      PASS       24s    887 passed (887)
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  PASS (PARTIAL) — reduced scope, see the warnings below
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

# Arca Computer organization transfer · 2026-10-22

**Live source: https://github.com/arcacomputer/opencaster.** The user authorized transferring the public repository from `arcabotai` to the `arcacomputer` organization and updating website/documentation source links. Organization membership and administrator access were verified before transfer. The repository retained ID `1425238416`, public visibility, default branch `main`, upstream fork relationship, history and admin access. Local `origin` now points to the organization; `upstream` remains the original Quorum repository. All three prior paths (`arcabotai/opencaster`, `arcabotai/hypersnap-web`, `arcabotai/opencast`) resolve to that same repository. Actions remain enabled and the existing WalletConnect project variable survived.

Implementation `54b2f9fba115ca49fe1c06bbaa97b1c57c5415d4` and release-note source `c78fc2d898e9972c75fd22af42851d846316fd0f` were published to the organization. The pre-release deployment was source `dad011c4668459935d2dc38bf08e563bc388fe76`, Worker version `3e197425-aa59-4a1e-aea5-71d8a4820ce4`. The updated client was deployed as Worker **`1782c85d-fe54-41a3-9314-e6eefeca5cfa`** from `/tmp/opencaster-org-production-20261022`. Its 23 production files were inspected for fixture markers, duplicate filenames and former-owner source URLs; the exact directory's hashes were rechecked unchanged after deployment. Hosting, Hypersnap endpoint, protocol, authentication, wallet permissions, origin bindings, Worker/R2/Durable Object identities and legacy domain redirects remain unchanged.

Both full local standalone gates passed **887 tests in 43 files**, TypeScript, browser production build and signer payload build. The new isolated Git-history regression checks a release against historical owner URLs while preserving milestone history. The dev-log guard accepts only the current organization repository and the exact two historical owner/repo combinations; negative owner/repository/lookalike cases remain rejected. The release guard used the actual pre-release source, retaining all original milestone IDs, dates and implementation SHAs while canonicalizing their source URLs. The new organization-transfer milestone brings the live count to **22**.

[Main CI 39742138130](https://github.com/arcacomputer/opencaster/actions/runs/39742138130) and [feature-branch CI 39742138864](https://github.com/arcacomputer/opencaster/actions/runs/39742138864) both passed on their **first attempts**, including release-note enforcement, full verification and signer payload reproducibility. This release did not need a retry. The retained messenger gate still lacks its original dependencies and sibling repositories; its full failing receipt is retained below and is not represented as a pass.

Current website source/license/privacy links, onboarding documentation, native download URLs, repository docs and all historical dev-log source links now use `arcacomputer/opencaster`. Both existing signer release descriptions were also updated to canonical source URLs. No signed asset was replaced: v0.2.1 retains ZIP digest `e122f121558a6570c3d6e909ee32900ec5e29f1339eaa553ab63fd7174fcf8cc`, manifests, checksums and notarization status. The signer source fingerprint remains `57fc9ce0b9d7fe47014603e410ebc2d3d651c3053eef1888e3b00d4dfed0cbe9`; an owner-only website-link change does not require a new native binary. Public HEAD checks returned 200 after normal redirects for old repository URLs, canonical signing docs, license, a historical implementation commit and the native ZIP.

Chrome verified the new organization repository, live rail/footer source and license hrefs, all **22** dev-log source links pointing at canonical organization commit URLs, the new transfer entry, and the onboarding signing-documentation href. Hypersnap public reads remained connected. The legacy website still returns 308 to `https://opencaster.org/`. All production checks were read-only navigation/HEAD/GET; no wallet, passkey/vault, posting key, upload or social write was attempted. No local preview server was needed or left running. Screenshots retain the organization repository and the live transfer note.

The retained messenger gate's full receipt follows (line-end padding omitted). Its production mint guard stayed enabled:

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   b65f995  ⚠ working tree dirty (10 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/scripts/check-devlog.mjs, desktop/hypersnap/scripts/check-devlog.test.mjs, desktop/hypersnap/src/App.tsx)
            (… and 4 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       0s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

# Opencaster launch and domain migration · 2026-10-22

**Live at https://opencaster.org.** The user confirmed the final Opencaster name and `opencaster.org` spelling. [Public source](https://github.com/arcacomputer/opencaster), repository homepage, local origin remote, current website links and metadata now use that name. The original `arcabotai/hypersnap-web` GitHub URL resolves to the renamed repository. The AGPL license, upstream Quorum attribution and all historical milestones are retained.

Source release `dad011c4668459935d2dc38bf08e563bc388fe76` (implementation `2ca6b5673869c7caab4a25c586a24edc8cdfb2be`) was deployed as Cloudflare Worker version `3e197425-aa59-4a1e-aea5-71d8a4820ce4`. The pre-release source was `b629f7e5c41a36d26976bebaec3c8936205f684c`, Worker `c58ffa28-b404-4f2e-968e-94c87d6e09eb`. The new active zone is `37b169ad321b96250025080e8606ab35` in Arca Computer, Inc. Its DNS inventory was empty before attachment. Domain-only triggers attached the new hostname to the existing Worker, and valid HTTPS returned 200 before the redirect code shipped. No legacy traffic was redirected before that check.

The final standalone `cd hypersnap && yarn verify` gate passed **886 tests across 43 files**, TypeScript, production browser build and offline signer payload build. The release-note guard compared against the actual pre-release source and accepted the new `opencaster-name-and-domain` milestone. Fresh production assets were built at `/tmp/opencaster-production-20261022-dad011c`: **23 production files**, no fixture markers or cloud-sync duplicate filenames. Those exact assets were reviewed through the actual local Worker, deployed, and their hashes rechecked unchanged after deployment.

[Feature-branch CI 39740183135](https://github.com/arcacomputer/opencaster/actions/runs/39740183135) passed on its first attempt. [Default-branch CI 39740183693](https://github.com/arcacomputer/opencaster/actions/runs/39740183693) passed on its single retry: **flaky, not a clean first-attempt pass**. Its first slow runner exceeded 5-second test budgets in a seven-PBKDF2 case, a multi-account App integration and a 1,000-profile DOM case; the App timeout then produced overlapping-act warnings and cascading assertions (11 failures). The same source passed both full local runs and the parallel CI job. No product code or test limits were changed to obtain the retry pass. Both successful CI runs covered release-note enforcement, full verification and signer payload reproducibility.

The migration preserves protocol signing labels, message scopes, storage keys, upstream node, Worker service identity `hypersnap-quorum`, R2 bucket `hypersnap-quorum-media` and Durable Object namespace. Exact legacy GET/HEAD requests return 308 with path/query preserved; other legacy methods return `409 site_moved` before signed data is read or forwarded. No Origin:null or cross-origin submission exception was added. Existing content-addressed media uses the same bucket, with the legacy redirect permitting public cross-origin image embedding. New cast shares and uploads use the canonical domain; own-host cast/profile links recognize both current and historical hosts.

Saved posting keys, passkeys, drafts, bookmarks and preferences remain browser-origin-bound. The dedicated onboarding notice explains reconnecting the existing custody wallet and optional fresh local saving. Password and passkey regressions reject relabeling or unlocking old-origin vaults on the new origin. Existing network authorizations are not silently revoked. Recovery phrases stay in the wallet. The existing WalletConnect project was checked in Reown and the exact `https://opencaster.org` origin added alongside the retained legacy origin; no wildcard was added. Its SDK license and external relay dependency remain disclosed.

[Arca Signer v0.2.1](https://github.com/arcacomputer/opencaster/releases/tag/arca-signer-v0.2.1) was built from clean committed release source, packaged for macOS arm64, Developer ID signed with hardened runtime/Electron integrity fuses, and verified using deep/strict codesign checks. The public ZIP, build manifest, release status and SHA256SUMS were published before the website download link shipped. GitHub's asset digest matches `e122f121558a6570c3d6e909ee32900ec5e29f1339eaa553ab63fd7174fcf8cc`; public download returns 200 after its normal GitHub redirect. Version 0.2.1 accepts the exact new display origin, retains original `[1, 3, 4]` scope limits, and includes the origin source in its source-tree fingerprint. **Apple notarization remains pending**, as the user expressly requested. The older v0.2.0 companion cannot accept new-domain pairing requests.

Live HEAD/GET assertions confirmed nine legacy routes, including root, dev log, profile with `?tab=replies`, author/short-hash, full cast, historical `/?cast=...`, search, API info and a syntactic hash-media path. Every legacy response was 308 to its exact canonical path/query; the media redirect carried cross-origin CORP. Eight canonical page/asset/API checks returned 200, including public node info, FID 410023 and cast `0xcfd6d3c3e990cffcb4af8063426d299cf22fab37`. The synthetic media hash checks redirect semantics only; it does not claim an existing production image was downloaded. Storage bytes and upload origin guards are covered in isolated Worker/R2 tests. Python urllib received an edge 403, while curl and Chrome succeeded; the automated live receipt uses curl.

Chrome confirmed root and dev-log redirects, final branding/source links, connected Hypersnap reads, **21 milestones** with the new launch entry, and a loaded profile with Replies selected after the original URL's query was retained. The redirected full conversation loaded with replies, and Share cast exposed the exact `https://opencaster.org/cast/0xcfd6d3c3e990cffcb4af8063426d299cf22fab37` URL. The loopback preview also found the existing short-link candidate through bounded Hypersnap history. Live onboarding displays the new-origin reconnect notice. Production checks remained public reads and navigation: no wallet permissions/signature, passkey/vault enrollment or unlock, posting-key preparation, image upload, cast, reaction, profile or follow write was attempted. All protocol write coverage remains isolated. Screenshots retain the live brand and exact WalletConnect allowlist.

The retained messenger gate lacks its original dependencies and sibling repositories. It does **not** clear that application or shared/wire changes; its permanent production-account mint guard remained enabled. Full receipt from this migration run follows (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   9337cc1  ⚠ working tree dirty (52 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/index.html, desktop/hypersnap/package.json, desktop/hypersnap/scripts/check-devlog.mjs)
            (… and 47 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       0s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

# Open linked profiles and casts on Quorum · 2026-10-22

> **⚠️ AI-Generated**: May contain errors. Verify before use.

The standalone `cd hypersnap && yarn verify` gate passes **839 tests across 43 files**, browser/Worker/native TypeScript, the production browser build and the offline signer build. New helper regressions cover recognized source hosts/path shapes, optional trailing slash, query/fragment removal, case normalization, reserved routes, malformed authors/hashes, authority lookalikes, credentials/nondefault ports, raw encoded/dot-segment paths and whitespace/control/backslash rejection. App integration tests cover cast text, profile bios and URL embeds, local profile/conversation navigation, Back/Forward/background preservation, full-hash conversation fallback, native modified-click behavior, retained external links, raw-token classification and single-anchor protocol quotes.

A pure shared-package migration candidate recognizes supported HTTPS `farcaster.xyz`, `warpcast.com` and their `www` hosts. It derives a local destination only for root author profiles, author/hash cast links and exact full-hash `/~/conversations/<hash>` links. The last format is confirmed by `apps/farcaster-web/src/components/conversation/Conversation.tsx` in the reviewed client snapshot `0c289ed93c125cc0f752d90ad224a4a41c31c3f5`, which emits that canonical fallback for a cast without a username. Recognition uses the original raw URL token before general URL normalization can erase dot segments or escapes. Unsupported paths/hosts keep existing external-link behavior; this is not a blanket domain redirect.

Cast text and non-image URL attachments now render real local hrefs. Primary clicks navigate within the app; modified clicks or copied destinations also use the local URL. Attachments label their Quorum destination and retain the original URL in a title. Profile bios share the text renderer. Original authored text, protocol URLs, mentions, media and stored bookmarks are not mutated. Protocol quoted-cast previews and notification snippets already sit inside a local outer anchor and remain plain text there, avoiding nested links. Existing Hypersnap author/prefix lookup, archive, cancellation and collision limits remain in force. No dependency, gateway route, signing permission or account/protocol write was added.

Social-link navigation pushes a new conversation history entry even when the source conversation was loaded directly. Automatic alias canonicalization or explicit full-cast selection replaces only the destination entry, preserving its source. Three additional integration cases cover short-alias selection, full-hash URL attachments and profile links from a directly loaded cast; Back/Forward and Close preserve the expected source. Existing reply/parent/quote navigation retains its prior behavior.

Source release `b629f7e5c41a36d26976bebaec3c8936205f684c` was deployed from the inspected fresh external directory (22 production files, no isolated-test fixture markers or cloud-sync duplicate filenames) as Cloudflare Worker version `c58ffa28-b404-4f2e-968e-94c87d6e09eb`. [Main CI run 39736430053](https://github.com/arcacomputer/opencaster/actions/runs/39736430053) passed the release-note guard, full verification and signer payload reproducibility. The final local standalone gate after the history fix and both new milestones passed all 839 tests and both builds. The dev log guard compared against pre-release deployed source `634602bf7cb4f38c7cb2c3dd189153ee067bcaa4`.

Local Wrangler preview used those exact production assets and Worker against public Hypersnap reads. The installed local runtime supports compatibility date 2026-10-02, so that date was overridden only for preview; production remains on 2026-10-19. A real public source cast (`0xffe80d84ab6bc9203c084001647e9520e21ac646`) contains `https://farcaster.xyz/gandhionchain/0xcbbe7828`. Its authored link text remained visible, while its href became `/gandhionchain/0xcbbe7828` with no new-tab target. Clicking displayed the exact author-verified Hypersnap candidate; Open full cast loaded conversation `0xcbbe7828f7d293b38e481bfea45cc93db9184bbc` and its reply editor. Back returned to the source, Forward reopened the destination, and Close returned to the source.

Fresh production Chrome checks repeated that same real-source-cast flow successfully: the link stayed on `quorum.arca.computer`, the full conversation loaded with no alert, and Back/Forward/Close preserved the source. A screenshot records the local destination displayed on production. The live `/devlog` showed all 20 milestones and the exact feature and history-fix implementation commit links. All checks were public reads and navigation only: no wallet prompt, signature, vault unlock/setup, passkey, media upload, cast, reaction, follow or profile write was invoked. QA tabs were closed and both exact owned preview process sets stopped; no viewport override was used. These checks establish current Chrome routing and node availability, not a complete archive or physical mobile-wallet interoperability.

The retained messenger gate still lacks its original dependencies and sibling repositories; its production-account mint guard remained enabled. Its full receipt follows (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   87347e6  ⚠ working tree dirty (4 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/src/App.test.tsx, desktop/hypersnap/src/App.tsx, desktop/hypersnap/src/lib/socialLinks.test.ts)
            (… and 1 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       0s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

# Compatible author and cast URLs · 2026-10-22

> **⚠️ AI-Generated**: May contain errors. Verify before use.

The standalone `cd hypersnap && yarn verify` gate passes **746 tests across 42 files**, browser/Worker/native TypeScript, the production browser build and the offline signer build. New tests cover route/reserved-name compatibility, exact author and cast validation, short-hash ambiguity, cumulative explicit continuation, native pagination shape/order/key binding, caps at EOF, timeout/caller cancellation (including late 404s), retry/cancel preservation, canonical replacement, Back/Forward and sign-in return context. All write tests remain synthetic/isolated; this feature's live probes are public reads only.

Quorum accepts `/<author>/0x<hash>` with byte-aligned 8–40 hexadecimal characters and root `/<author>` profile links, while retaining existing `/profile/...` and full `/cast/...` URLs. Authors can be usernames, supported native ENS/Base names or numeric FIDs. Reserved application/static namespaces remain reserved. Shares use stable full hashes.

The reviewed Hypersnap revision remains `2e8733d044141ad3ba0e0592a4d5873c1dc6ce9c`. Native v2 cast lookup and `find_cast_fid_by_hash` require exact 20-byte hashes; no short-hash index was found. Short links therefore check author-scoped native `/v1/castsByFid` history in explicit batches of at most four 250-message pages. That history includes cast removals. Exact FID/full-hash hydration verifies each current candidate, skipping only a verified `cast_not_found`. A partial result can show candidates immediately but cannot claim uniqueness or absence. Only one candidate after exhausted available history auto-opens; incomplete or ambiguous matches require a choice. Full hashes use exact author-scoped lookup directly.

Each batch shares a 25-second deadline and at most four concurrent hydration reads. Cumulative limits are 100,000 checked messages, 400 cursor pages and 25 candidate hashes. A reached limit remains incomplete, including a final page that exceeds the remaining message budget. Native v1 pagination uses canonical base64 of a 30-byte legacy User/CastMessage key, bound to the exact FID. Receipt keys must descend, page cursors must match the last receipt, and subsequent pages must move below the incoming cursor. Missing/empty terminal tokens are accepted; null, loops, other key namespaces/authors and skipped-key cursors are errors. Cancellation wins over late HTTP results, including a late missing-cast response. Lookup state stays in memory.

Public Hypersnap reads confirmed `gandhionchain` resolves to FID410023 and the supplied prefix matches full hash `0xcfd6d3c3e990cffcb4af8063426d299cf22fab37`, found in the first author-history page and confirmed by exact author/hash lookup. This establishes availability on Hypersnap; it does not verify why another client may omit it. URL compatibility cannot recover deleted, pruned or unsynced data. No Farcaster-operated lookup endpoint, new dependency, authentication permission or protocol write was introduced.

Source release `634602bf7cb4f38c7cb2c3dd189153ee067bcaa4` was deployed from the inspected fresh external directory (22 production files, no test fixture markers or cloud-sync duplicate filenames) as Cloudflare Worker version `65244446-9e41-43f5-8b5a-2e45b18fce17`. [Main CI run 39728135621](https://github.com/arcacomputer/opencaster/actions/runs/39728135621) passed the release-note guard, full verification and signer payload reproducibility. The final local standalone gate after the new milestone again passed all 746 tests and both builds; the dev log guard used pre-release deployed source `0e508ec2608086c3c6f95b8b08bf3edd832511d5`.

A local Wrangler preview exercised those exact production assets and Worker against public Hypersnap reads. The installed local runtime supports compatibility date 2026-10-02, so that date was overridden only for preview; production remains on 2026-10-19. The exact supplied short URL displayed one author-verified candidate after checking 1,000 history messages; explicit continuation checked 2,000 and retained that candidate without assuming uniqueness. Open full cast loaded the stable full-hash conversation and reply editor, which survived reload. The root username URL showed the correct name and FID; opening a cast there and using Back returned to the profile. At a 390-pixel viewport, document and candidate client/scroll widths matched (375/375 and 318/318, respectively, accounting for scrollbars), with no horizontal overflow. The viewport override was reset and the preview tab closed.

Fresh production Chrome checks confirmed `https://quorum.arca.computer/gandhionchain/0xcfd6d3c3` displays that same candidate and stable full-hash link, with an honest incomplete-history notice and no error. Open full cast loaded the conversation/reply editor; direct reload worked with no alert. `/gandhionchain` showed the correct public profile. The live `/devlog` showed all 18 milestones and the exact implementation commit link. A screenshot records the live short-link result. All checks used public reads and navigation only: no wallet control, saved-vault unlock, signature, passkey setup, profile/follow/reaction/cast write or media upload was invoked. The production QA tab was closed, viewport sizing restored and exact owned preview processes stopped. This verifies browser routing/layout and current node availability; it is not a complete archive, independent security audit or physical mobile-wallet test.

The retained messenger gate still lacks its original dependencies and sibling repositories; its production-account mint guard remained enabled. Its full receipt follows (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   b76b720  ⚠ working tree dirty (11 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/src/App.test.tsx, desktop/hypersnap/src/App.tsx, desktop/hypersnap/src/lib/api.ts)
            (… and 7 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       0s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

# Native ENS and Base name lookup · 2026-10-21

> **⚠️ AI-Generated**: May contain errors. Verify before use.

The standalone `cd hypersnap && yarn verify` gate passes **671 tests across 40 files**, browser/Worker/native TypeScript, the production browser build and the offline signer build. New checks cover native name normalization and limits, name/type pairing in the gateway, exact missing-proof classification, proof-to-FID hydration, mismatched/invalid FIDs, one shared 25-second deadline, caller cancellation before and between reads, late results, canonical aliases and unchanged custody authorization. Actual-crypto UI integration tests cover ENS/Base names and refusing a merely linked wallet until the true custody account is selected. No dependency or signing scope was added.

ENS names now use Hypersnap's `/v1/fidByName` with explicit `ens` or `basename` type, followed by a public profile read for that exact positive uint32 FID. Existing `.eth` profile/username lookups take the same route, fixing a live gap in the v2 username endpoint. Onboarding recognizes names before `0x` address classification, shows the historical name used for lookup separately from the canonical username/FID/custody identity, and clears that label before fresh device preparation. Only an exact native missing-proof response maps to `404 ens_name_not_found`; storage, validation and transport failures remain errors. Missing-name guidance offers a username, FID or custody-address lookup without implying a name can authorize access.

The reviewed node revision remains `2e8733d044141ad3ba0e0592a4d5873c1dc6ce9c`. Its `core/validations/message.rs` and `network/http_server.rs` define the current native subset: `name.eth` or `name.base.eth`, one 1–16 character ASCII alphanumeric/hyphen label beginning with an alphanumeric character. Case and an optional leading @ normalize within that subset; Unicode is rejected before case folding. This is an indexed name-proof lookup, not generic ENS normalization, reverse resolution, registration or live Ethereum address ownership verification. No external RPC or Farcaster-operated service is contacted. The name proof's owner or resolved wallet may differ from the current custody wallet, which remains the authorization authority.

Public reads of the live upstream confirmed `dwr.eth`→FID3, `vitalik.eth`→FID5650 and `jesse.base.eth`→FID99 through the native endpoint. The old v2 by-username route returned not found for those examples. An obviously nonexistent supported-format name returned the exact native NotFound wrapper now recognized by the gateway. These were public lookups only; no production key, signature, account, media or cast write was made. Physical wallet interoperability and an independent security audit remain outside these checks.

Source release `0e508ec2608086c3c6f95b8b08bf3edd832511d5` was deployed from the inspected fresh external directory (22 production files, no test fixture markers or cloud-sync duplicates) as Cloudflare Worker version `c6da02cf-b6dd-452c-8b3c-c49e81688a64`. [Main CI run 39583437781](https://github.com/arcacomputer/opencaster/actions/runs/39583437781) passed the release-note guard, full verification and signer payload reproducibility.

A local Wrangler preview exercised the same production browser assets and Worker against public Hypersnap reads. The installed local runtime supports only compatibility date 2026-10-02, so that date was overridden only for preview after the initial local startup refused the configured date. Production remained on 2026-10-19. Preview verified uppercase/@ENS normalization, Base-name resolution, specific missing-proof recovery and a Base-name profile link. No wallet controls or submission actions were invoked.

Fresh production Chrome checks then confirmed `@DWR.ETH`→canonical @dwr, FID 3 and its full custody address and `jesse.base.eth`→FID 99 and its full custody address, with the lookup name labeled separately. An unlinked name produced the specific recovery message, and `/profile/jesse.base.eth` opened the correct public profile. At a 390-pixel viewport the document/card client and scroll widths matched; the ENS note and full address wrapped. The live `/devlog` showed all 17 milestones and the exact new implementation link. A saved passkey vault was detected but never unlocked or changed. Production checks used public reads/navigation only; no device-key preparation, wallet prompt, signature or account write was made. QA tabs were closed, viewport sizing restored and the exact owned Wrangler/workerd preview processes stopped. This remains browser-layout evidence, not physical mobile-wallet interoperability testing.

The retained messenger gate still lacks its original dependencies and sibling repositories; its production-account mint guard remained enabled. Its full receipt follows (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   b05a340  ⚠ working tree dirty (9 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/src/components/ConnectAccount.tsx, desktop/hypersnap/src/lib/accountLookup.ts, desktop/hypersnap/worker/index.test.ts)
            (… and 3 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       0s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

# Dedicated onboarding and complete identity review · 2026-10-21

> **⚠️ AI-Generated**: May contain errors. Verify before use.

The standalone `cd hypersnap && yarn verify` gate passes **588 tests across 39 files**, browser/Worker/native TypeScript, the production browser build and the offline signer build. New checks cover every sign-in entrypoint, direct entry, reload, forged return/scope state, Back/Forward, cancellation and late callbacks, same-account permission upgrades, all three public lookup forms, invalid/mismatched identities, username-unavailable labels and changed-identity re-review. The real-wallet integration tests use actual discovery, EIP-712 signing/recovery and authorization code with only the node/vault boundary replaced. No dependency, signing scope or production gateway route was broadened.

Sign-in now lives on `/connect` with its own main landmark and no feed, sidebar or conversation dialog underneath. Public lookup resolves username, FID or exact custody address into the same full identity summary before key generation. Preparation uses the reviewed FID and compares the fresh canonical username/custody/request identity; changed details require explicit review before wallet controls appear. Name-proof aliases may resolve to a different canonical displayed name, so the returned identity is shown rather than inferred from the input. Missing and synthetic `fid:N` usernames are labeled unavailable. An address that merely verifies an account does not substitute for its custody address.

Requested permissions and initial account context remain in tab memory. Only validated local return/background routes enter history; direct entry or reload cannot restore broader permissions from query parameters/history state. Existing sessions survive cancelled/failed upgrades, and an upgrade may replace them only with a confirmed key for the same FID. Unmount/cancellation invalidates pending lookup, wallet and save callbacks and disposes local key material. Returning vault unlock remains explicit; device settings still uses its existing dialog. Heading focus follows stage changes and reset to the account form.

Chrome QA used a separate loopback origin, the marked synthetic wallet, and the OS-network-sandboxed Hypersnap node. It verified the full FID summary, Back/Forward resetting the form, exact custody-address lookup, no sign-in dialog, stage heading focus, and a 320-pixel layout with equal document/card client and scroll widths. Two actual synthetic signatures left submission separate; explicit submission returned to Discover. A separate node registry read confirmed exactly one new `SIGNER_SOURCE_OFFCHAIN` key for FID1234, nonce5→6, scopes CAST_ADD/REACTION_ADD/REACTION_REMOVE and TTL604800. No real installed wallet was selected, no passkey/password was saved, and no production account write was made. Username variants and custody changes are additionally covered in actual-crypto integration tests; browser viewport evidence does not establish physical mobile wallet interoperability.

Source release `6a5eb858054da6a2f4dd5649dbcbf731e931180b` was deployed from the inspected fresh external directory (22 production files, no test fixture markers or cloud-sync duplicates) as Cloudflare Worker version `e78a294a-0c0c-4f54-b44c-1581428ade13`. [Main CI run 39581996094](https://github.com/arcacomputer/opencaster/actions/runs/39581996094) passed the release-note guard, full verification and signer payload reproducibility. The final local release gate also passed all 588 tests after the note and explanatory copy changes.

A fresh production Chrome tab loaded `/connect` directly, showed returning passkey-vault unlock without invoking it, and permitted public lookup through Connect another account. Public username, FID and custody-address inputs produced exactly equal complete summaries, with no sign-in dialog and no identifier in the URL. No Use this account or wallet approval button was pressed on production. At a 390-pixel viewport, the page/card client and scroll widths matched, the full custody address wrapped, and the three visible buttons were 44 pixels high. Reload discarded the public lookup and retained the encrypted vault's returning-user state; Cancel returned to `/`. The live `/devlog` showed all 16 milestones and the exact new implementation link. Screenshots record the desktop/mobile identity review. All owned preview/node processes were stopped, QA tabs closed and viewport sizing restored. Production checks used public reads/navigation only, leaving real wallet prompts, saved-key unlock/setup and account writes untouched.

The retained messenger gate still lacks its original dependencies and sibling repositories; its production-account mint guard remained enabled. Its full receipt follows (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   be3ffe0  ⚠ working tree dirty (6 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/src/App.tsx, desktop/hypersnap/src/components/ConnectAccount.tsx, desktop/hypersnap/src/lib/navigation.test.ts)
            (… and 3 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       0s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

# One-box cast composer · 2026-10-21

> **⚠️ AI-Generated**: May contain errors. Verify before use.

The standalone `cd hypersnap && yarn verify` gate passes **550 tests across 38 files**, browser/Worker/native TypeScript, the production browser build and the offline signer build. Seven new Composer cases cover one primary editor, disclosed controls, exact-FID lookup, local emoji range insertion, upload cancellation/retry with a late first response, UTF-8 byte-limit blocking, local Escape handling and guest sign-in activation. One new App integration case preserves account/destination-specific draft save/restore through actual home/channel navigation. The isolated media harness now permits only its exact configured loopback hashed media URL in saved drafts, with a regression proving production validation remains HTTPS and first-party only. No dependency, signing scope, protocol attachment limit or production URL guard was broadened.

Local verification exposed two pre-existing timestamp-sensitive wallet test assertions that constructed a second request for verification after asynchronous signing. They now retain and verify the original request, so a second boundary does not change its checksum. A later full run concurrent with the preview build timed out in the existing 1,000-profile rendering test at its five-second deadline; its assertions and timeout were unchanged. The full standalone gate then passed with no concurrent preview build. The final isolated browser build and a fresh external production build also passed.

Separate Chrome tabs inspected empty Farcaster and X compose surfaces as requested. Only presentation and available controls were read; no reference-site text, media, post, cast, wallet prompt or account setting was submitted. [FEATURE_SUPPORT.md](FEATURE_SUPPORT.md#composer-walkthrough-on-farcaster-and-x--2026-10-21) records the observed hierarchy and retained Hypersnap limits without account/feed details. The implementation is independent and imports neither hosted client's services.

Chrome QA used a clearly marked synthetic-wallet harness at a loopback origin and the existing OS-network-sandboxed Hypersnap node. It exercised two signature approval and explicit local-node submission, the editor, emoji insertion, exact FID1235 mention selection, signed image upload, explicit draft save and confirmed replacement restoring exact text and image, and explicit publication. The accepted cast appeared in synthetic FID1234's profile. A separate node read of public hash `0x6b39e6476bed8a756b01a13ddcc854faf80b25db` confirmed the emoji, text URL, one embed and mentioned FID1235. The saved revision was cleared after success. Discover remains a trending view and did not promise chronological inclusion of the new cast.

At 320- and 390-pixel Chrome viewports the composer's client and scroll widths matched, with 44-pixel toolbar targets at the narrow size. A toolbar-focused Escape closed only its tool panel and preserved the draft. These are layout checks, not physical mobile-device interoperability claims. Viewport overrides were restored and temporary reference/test tabs were closed. All writes were isolated; no production cast, upload, wallet request or saved-key operation was performed.

Source release `8ed0ab285afa281c81808d57c3627309188c0e73` was deployed from the inspected fresh external asset directory as Cloudflare Worker version `8e2a3aa5-537f-4f6b-9e6e-7f7a0c80a51c`. [Main CI run 39568842596](https://github.com/arcacomputer/opencaster/actions/runs/39568842596) passed the release-note guard, full verification and signer payload reproducibility. A fresh production Chrome tab confirmed the single primary editor, compact tools, no extra visible text inputs and equal composer client/scroll widths. No production sign-in or upload was initiated. The live `/devlog` showed all fifteen milestones with the new composer entry and implementation link. Production checks used public reads/navigation only. All owned preview/node processes were stopped, temporary tabs closed and Chrome viewport sizing restored.

The retained messenger gate still lacks its original dependencies and sibling repositories; its production-account mint guard remained enabled. Its full receipt follows (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   349e4b8  ⚠ working tree dirty (10 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/scripts/e2e-media-runtime.mjs, desktop/hypersnap/scripts/e2e-media-runtime.test.mjs, desktop/hypersnap/src/App.test.tsx)
            (… and 2 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       1s
  desktop  harness-offline FAIL       1s
  desktop  build          FAIL       1s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

# Injected wallet selection and approval recovery · 2026-10-21

> **⚠️ AI-Generated**: May contain errors. Verify before use.

The standalone `cd hypersnap && yarn verify` gate passes **541 tests across 38 files**, browser/Worker/native TypeScript, the production browser build and the offline signer build. Nineteen additional tests cover competing EIP-6963 and legacy providers, Coinbase namespaces and aliases, bounded discovery, identity-based selection, hostile responses, pending prompts, wrong-account recovery, cancellation, late approval suppression and expiry. A regression also keeps a pending revocation busy across its approval deadline. No signing scope, dependency, transaction RPC or account-picker permission RPC was added.

Two integration tests exercise the real ConnectAccount UI, wallet adapter, EIP-712 recovery and authorization orchestration, replacing only the node boundary and saved-vault lookup. An unrelated Coinbase account is rejected before signing; an explicit retry with the matching synthetic custody account produces exactly KeyAdd and SignedKeyRequest. Neither signature submits a key until the separate button is clicked. Local cancellation ignores the original pending prompt's late result while a new attempt succeeds. Provider calls remain restricted to account requests/reads, chain reads and typed-data signing.

Chrome browser QA used the existing loopback-only Hypersnap test node and a clearly marked synthetic-wallet harness on a separate local origin. The selector displayed multiple real installed provider announcements beside the synthetic wallet; only the synthetic provider was selected. Both signatures and explicit submission completed, the browser entered its connected state, and a separate local-node read confirmed the exact new public key as SIGNER_SOURCE_OFFCHAIN. Production accounts, installed wallet prompts, recovery phrases, passkeys and assets were not used. This verifies the protocol path with a synthetic provider, not physical Coinbase Wallet interoperability on the reporter's Mac.

The report did not include a public FID or exact error, so the reporter's original failure remains unconfirmed. Source inspection established two actionable issues: a named wallet could suppress other legacy providers, and a pending browser approval offered no local cancellation/retry. A login requests no Ethereum transaction, NFT mint, token approval or asset transfer. The exact custody address must still match; unrelated verified wallets and ERC-1271 smart-account signatures cannot replace the recoverable Ethereum signatures required by Hypersnap. Provider labels remain self-asserted and do not authenticate an extension.

Source release `7799cc99ecf767606cf4909709813fd6b80a1dc6` was deployed from the inspected fresh external directory as Cloudflare Worker version `333b3d1d-0aa4-452c-a681-2ab296753c43`. [Main CI run 39564162504](https://github.com/arcacomputer/opencaster/actions/runs/39564162504) passed the release-note guard, full verification and signer payload reproducibility. A fresh production Chrome tab confirmed all fourteen dev log entries and the new milestone's implementation link. Public FID lookup exposed multiple installed providers in the selector, required an explicit choice and displayed the two-signature/submission and wrong-account guidance. No provider connect/approve button was pressed; no wallet request, production submission or passkey prompt was made. The saved encrypted vault was retained. Narrow-screen inspection found equal 320-pixel client and scroll widths for the dialog. Chrome viewport sizing was restored, temporary tabs were closed and both owned loopback test processes were stopped. This is browser layout/navigation evidence, not physical mobile-device testing.

The retained messenger gate still lacks its original dependencies and sibling repositories; the production-account mint guard remained enabled. Its full receipt follows (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   369fd4c  ⚠ working tree dirty (8 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/src/components/ConnectAccount.test.tsx, desktop/hypersnap/src/components/ConnectAccount.tsx, desktop/hypersnap/src/lib/wallet.test.ts)
            (… and 2 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       1s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       2s
  desktop  harness-offline FAIL       1s
  desktop  build          FAIL       1s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

# Live client audit and familiar browsing tools · 2026-10-21

> **⚠️ AI-Generated**: May contain errors. Verify before use.

The standalone `cd hypersnap && yarn verify` gate passes **522 tests across 37 files**, browser/Worker/native TypeScript, production browser build and the offline signer payload build. No dependency or signing permission was added. Ten new App integration tests exercise real component wiring with synthetic account FIDs: local hide/restore, mute isolation across account changes, memory-only preference retention after failed storage, reveal isolation, limit errors, complete storage denial, legacy bookmark validation/search/sort/clear/remount, trending-window cancellation and stale pagination suppression, keyboard focus and reaction-list profile navigation. Additional helper/API/Worker/UI tests validate schema bounds, Unicode matching, whitelisted public bookmark snapshots, target/type-specific actor receipts, multi-shard pagination, deduplication, concurrency/deadline/abort behavior, retry/cancellation and dialog transitions. Literal link tests cover punctuation, balanced brackets, credentials, Unicode and long unmatched closing-bracket suffixes; trimming is linear. Focused link tests and a fresh external TypeScript/production build passed after that final implementation refinement.

A separately authorized Chrome tab inspected the live Farcaster UI without submitting any account action. [FEATURE_SUPPORT.md](FEATURE_SUPPORT.md#live-farcaster-walkthrough--2026-10-21) records the major surfaces and source-backed compatibility decisions without copying private account details. The source repository HEADs were checked and remain the pinned revisions cited there. Existing Farcaster API clients, hosted account services and source dependencies were not imported.

Chrome browser QA used a separate loopback origin, no connected wallet and GET-only Hypersnap API traffic. It exercised actual reaction people reads (50 profiles on the first multi-shard page, 100 deduplicated profiles after pagination), the Recasts tab, local bookmark save/search/confirmed clear, hiding and restoring a cast, literal phrase filtering and focused search with Ctrl+K. Those temporary browser preferences and snapshots were isolated from production account state. Settings and Bookmarks were checked at a 320-pixel viewport. Testing caught and fixed an inherited narrow-screen rule hiding the new Settings button and the missing mobile Bookmarks entry; the loaded settings content's scroll width equaled its available width. Chrome viewport overrides were reset afterward. These are layout/browser checks, not physical iOS/Android or wallet-provider interoperability claims.

Core social reads retain the fixed Hypersnap gateway. The new actor route permits only validated target/type/page parameters; the trending route accepts only the five supported windows. Muting, hiding and saving are explicit local conveniences, not network blocking/subscriptions or device synchronization. Activity filters can use only available actor/text/target metadata; opaque quoted text is not inferred. Reaction lists remain node-reported, may be incomplete and are capped at 1,000 profiles or 40 pages; per-shard continuations do not establish a global chronological order. The native signer beta is unchanged. No production cast, follow, reaction, profile, upload, wallet approval or passkey operation was used.

Source release `9f8054a2b9da97e8d645b51451f0a4380a7cf575` was deployed from a fresh external asset directory as Cloudflare Worker version `4029a9cf-4345-4c07-a04e-1605a77d58b7`. [Main CI run 39548825012](https://github.com/arcacomputer/opencaster/actions/runs/39548825012) passed the release-note guard, full verification and signer payload reproducibility. A fresh production Chrome tab confirmed the loaded Settings route, all thirteen public dev log milestones and 50 actor profiles from the deployed reaction endpoint, without API alerts. This production check used public reads and navigation only; no posting key or wallet was connected and no signed Hypersnap message or local content preference action was submitted. The local seven-day trending check returned 25 casts with no alert. Temporary audit/preview tabs were closed, Chrome viewport sizing was restored and the owned preview server was stopped.

The retained messenger gate still lacks its original dependencies and sibling repositories; its production-account mint guard remained enabled. Full receipt follows (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   9a7e0ad  ⚠ working tree dirty (29 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/src/App.tsx, desktop/hypersnap/src/components/CastOptions.tsx, desktop/hypersnap/src/components/FeaturePanels.tsx)
            (… and 20 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       1s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

# Release log checks · 2026-10-21

> **⚠️ AI-Generated**: May contain errors. Verify before use.

The standalone `cd hypersnap && yarn verify` gate passes **467 tests across 29 files**, browser/Worker/native TypeScript, production browser build and the offline signer payload build. Seventeen new tests use temporary local Git repositories to exercise missing milestones, editing/reordering old entries, valid ancestor source commits, wrong dates, missing/nonancestor source objects, history deletion, development-only exemptions, untracked runtime files, explicit-head isolation, missing bases, feature-branch merge bases and initial pushes. Static validation rejects executable expressions, duplicate IDs, impossible dates and incorrect ordering. No new dependency, network/account write or signing permission is introduced.

The CI guard reads literal milestone data through the existing TypeScript compiler without importing code from either revision. Default-branch pushes compare before/after commits; PRs and feature/tag pushes compare against their merge base. A tag named `main` cannot be mistaken for the default branch. Full Git history is fetched, and absent history fails with an actionable message. CI always reports its check, including docs-only changes. The release checklist and scoped agent instructions require the same guard before every deployment and require user-facing prose to cover each shipped feature or fix. The check proves that a new valid entry exists; it cannot judge prose accuracy or intercept a direct manual Wrangler command.

The public log now also records its own launch and these release checks. Source release `9010a0ddce02dc9a6c93e9f254a0d34f4d89cea7` was deployed as Cloudflare Worker version `73f3c404-1e84-40b9-8eca-206e7128dfb5` from a fresh external asset directory. [Main CI run 39546661188](https://github.com/arcacomputer/opencaster/actions/runs/39546661188) passed the new release-note guard, all verification and signer payload reproducibility. A fresh signed-out browser tab confirmed all twelve milestones on the live `/devlog`, with the release-check entry first and its implementation source link intact. Production checks used public reads only. The retained messenger's root gate still lacks its original dependencies and sibling repositories; its production-account mint guard remained enabled. Full receipt follows (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   4a70b32  ⚠ working tree dirty (7 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/.github/workflows/hypersnap.yml, desktop/hypersnap/package.json, desktop/hypersnap/src/lib/devLog.ts)
            (… and 2 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       1s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

# Public dev log · 2026-10-21

> **⚠️ AI-Generated**: May contain errors. Verify before use.

The standalone `cd hypersnap && yarn verify` gate passes **450 tests across 28 files**, browser/Worker/native TypeScript, production browser build and the offline signer payload build. This release adds a static, lazily loaded `/devlog` route, ten source-linked historical milestones, topic filters and chronological ordering. Dates were checked against commit author/committer timestamps; date rendering uses an explicit UTC calendar format to avoid moving October 19 milestones to October 18 for visitors west of UTC. Existing route tests cover the public path and canonical URL. No social API, signing, wallet permission or storage contract changed, and no account mutations were needed for these checks.

Browser QA checked direct loading of `/devlog`, all ten milestones, oldest-first ordering, topic filtering, desktop navigation and a separate 320-pixel iframe preview. The mobile header link opened the log from Discover without sign-in. The iframe check establishes layout behavior rather than physical-device or wallet interoperability. Preview-only wrapper files were created outside the deployable assets. No wallet connection, signed message, upload or production account mutation was used.

The inherited messenger gate still lacks its original dependencies and sibling repositories; its production-account mint guard remained enabled. Full receipt follows (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   d1e1502  ⚠ working tree dirty (8 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/src/App.tsx, desktop/hypersnap/src/lib/navigation.test.ts, desktop/hypersnap/src/lib/navigation.ts)
            (… and 2 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       1s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

# Verification record · 2026-10-21

> **⚠️ AI-Generated**: May contain errors. Verify before use.

## Familiar client feature release

The standalone `cd hypersnap && yarn verify` gate passes **450 tests across 28 files**, browser/Worker/native TypeScript, production browser build and the offline signer payload build. No runtime dependency was added. The existing published native beta is unchanged. [FEATURE_SUPPORT.md](FEATURE_SUPPORT.md) maps familiar Farcaster behavior to source-backed Hypersnap support and records unsupported/stubbed APIs.

New coverage includes reverse chronological Likes/Recasts profile history with authoritative cast hydration, exact reaction absence classification, account-scoped reaction reads, four-read concurrency bounds, cancellation and a 25-second aggregate history deadline. Active-session reaction uncertainty survives card remounts and blocks repeat writes while the node still shows the earlier state. Account changes and stale read versions cannot clear that quarantine. Explicit draft recovery, account/destination isolation across signer rotation, size/age/storage failures, inline mention selection and stale search cancellation, clipboard image uploads, IME/repeated-key guards, keyboard publishing, image navigation, profile sharing, local channel shortcuts, activity filters and bounded community panels have regression coverage.

A new OS-sandboxed fixture at `/tmp/arca-hypersnap-e2e-familiar` uses the pinned actual Hypersnap binary, consensus, RocksDB, protocol signature/registry validation and real indexes. The actual app auth/vault/API and Worker/SQLite Durable Object/R2 runtime completed **14 signed submissions and 131 node requests**, all synthetic/loopback-only. Its `feature-checks-proof.json` confirms profile edits/search, quotes, channels, media bytes, all five profile tabs, real like/recast receipts, account isolation, add/remove inclusion and history disappearance, recent activity, deletion and stale search-index filtering. A subsequent GET-only run completed **9 reads, zero signed submissions**, confirming the reverse quote index, channel participants, suggestions endpoint and removed reaction states. That fixture returned no friend-of-friend suggestions; the UI does not fabricate recommendations.

Browser QA used an injected synthetic wallet on the same isolated node. Explicit draft save → navigate away → restore worked; inline mention search resolved an actual indexed FID and Enter selected it without posting. Saved-channel directory and sidebar shortcuts, notification filters, clipboard PNG upload, Command+Enter cast submission, the Photos route and image viewer were checked. The uploaded image decoded at 512×512 from local R2. A signed Like remained `Unlike` after an explicit fresh feed read. No production wallet, account, passkey or media mutation was performed. These checks do not establish real Chrome/Safari/Android/iOS provider interoperability or an independent security audit.

Quote results are a bounded node-index sample and may be incomplete or unavailable; channel participants are authors, not subscribers; notification filters operate over loaded recent activity; saved channels, read state, bookmarks and drafts are local. Drafts are explicitly saved in tab-scoped storage for up to 24 hours and are never automatically submitted. All social API routes retain the fixed Hypersnap upstream and query/response limits. Existing optional WalletConnect relay/license conditions remain disclosed separately.

The retained messenger's root gate still lacks its original dependencies and sibling repositories. Its production-account mint guard remained enabled. Full current receipt follows (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   911bbc4  ⚠ working tree dirty (34 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/scripts/e2e-feature-checks.ts, desktop/hypersnap/scripts/e2e-media-runtime.mjs, desktop/hypersnap/scripts/e2e-media-runtime.test.mjs)
            (… and 26 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       0s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

## Earlier verification records

# Verification record · 2026-10-20

## Passkey-protected local device vaults

The standalone `cd hypersnap && yarn verify` gate passes **363 tests across 22 files**, browser/Worker/native TypeScript, production browser build, and the offline signer payload build. The optional published native beta is unchanged. No new runtime dependency or authentication service is introduced.

New passkey checks cover exact origins/RP IDs, fresh challenges, native response shape and credential identity, user presence and verification, PRF availability, bounded cancellation/timeouts even for late native promises, and clearing both raw and copied PRF outputs. Local vault tests use real HKDF/AES-GCM, authenticated metadata, malformed/tampered records and an independent legacy password-vault fixture. Auth regressions verify current custody/scopes/expiry after unlock, no signer submission, preservation on failed/cancelled setup, whole-record atomic replacement, same-key cross-tab races, late-commit rollback, and erasing PRF material before network reads. UI regressions cover explicit fresh-click enrollment, opt-in storage, legacy passwords, unsupported providers, closing during saves/unlock, corrupt-vault recovery, stale storage reads, and account changes during pending operations.

The repeatable [passkey check runner](scripts/e2e-passkey-checks.ts) uses the actual app WebAuthn adapter, real vault cryptography, in-memory IndexedDB, the real Worker, and the existing OS-isolated Hypersnap node's actual synthetic signer registry. Only the authenticator is a synthetic WebAuthn/PRF provider. It completed password unlock, failed/cancelled setup preserving the old vault, v2 migration, lock/passkey unlock, wrong-origin rejection before a prompt, wrong-PRF rejection and unchanged permissions. Its proof records **9 public reads, zero network writes and zero production writes** at `/tmp/arca-hypersnap-e2e-features/passkey-checks-proof.json`. No real user passkey, wallet approval or production vault was created or changed. A static browser preview of the actual device-settings component was checked with all actions disabled; physical OS/browser/passkey-provider interoperability remains untested by agents.

Passkeys are recommended only when the selected browser/provider returns a valid PRF output. API availability alone does not establish PRF support. Existing password vaults remain readable, and users can choose password encryption or memory-only access explicitly. Credential synchronization by a passkey provider does not synchronize this browser's local ciphertext; a new browser/device or cleared site storage needs custody-wallet reconnection. An unlocked signer and the delivered website code remain trust boundaries. See [SIGNER.md](SIGNER.md) for recovery, storage, provider synchronization and threat-model details.

The Worker explicitly permits WebAuthn create/get only for its own origin, while retaining its existing CSP/frame/credential-forwarding restrictions. No new third-party network destination is required for passkey vault encryption; the selected passkey provider may operate its own credential synchronization independently.

The retained messenger's separate root gate still lacks its original dependencies and sibling repositories. Its permanent-production-account mint guard remained enabled. Current full receipt follows (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   0e1f14b  ⚠ working tree dirty (15 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/src/components/ConnectAccount.tsx, desktop/hypersnap/src/lib/auth.test.ts, desktop/hypersnap/src/lib/auth.ts)
            (… and 8 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       0s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

## Earlier feature release verification

## Expanded client feature release

The standalone client passes its complete `yarn verify` gate: automated unit, component and integration tests; browser/Worker/native TypeScript; production browser build; and offline companion payload build. **298 tests across 20 files pass.** These checks are separate from the retained messenger gate.

A fresh OS-sandboxed local Hypersnap node at the pinned source revision below ran real signatures, registry/state validation, consensus, RocksDB, social/channel/Tantivy indexes, and the production Worker with actual local SQLite Durable Objects/R2. Two synthetic accounts completed **11 signed submissions and 99 actual node requests** in the final repeatable backend feature run. Its proof reports `productionWrites: 0`, `apiMocked: false`, `registryMocked: false`, and genuine cryptographic signatures. No production wallet approval, account mutation, or upload occurred.

Verified flows: encrypted-vault unlock; display-name editing and prefix user search; cast search with authoritative hydration; cast-ID quotes; channel parent URLs, discovery, search, detail and feed; signed upload grants and byte-exact PNG reads; image casts; Casts/Replies/Photos filtering; follows/reactions/replies/mentions in recent activity; own-cast deletion confirmed absent; foreign deletion rejected before submission; and unfollow cleanup. The node's raw Tantivy index retained a deleted cast; the client now checks bounded search hits against authoritative cast reads and filters only exact confirmed absence. Other read failures remain errors. Search uses up to 25 hits, four concurrent hydration reads, and one 25-second overall deadline.

Browser QA on the actual isolated node confirmed default and expanded synthetic wallet connections; quote submission and deleted-quote placeholders; separate deletion approval/confirmation; actual channel posting and cast search; recent activity and local read state; and a fresh uploaded image appearing on the shareable Photos tab. The image decoded to 512×512 from our local R2 route. The key-upgrade preflight blocked a too-early approval with the actual registry cooldown, then allowed a fresh lookup and confirmed the new key. Browser file-picker automation was slow; this is not a measurement of the website’s upload latency.

React integration regressions additionally cover query history and conversation backgrounds, profile-tab cancellation and late results, pagination cancellation/late errors, quote attachment limits, explicit deletion-key approval followed by independent confirmation, cancelled approvals preserving the old session, late quote receipts preserving a replacement draft, chronological channel-page merging, and exact refresh retries. Existing scopes remain unchanged; deletion requires a new explicitly reviewed `[1,2,3,4,5,6,11]` key. Native offline beta approval remains limited to its original scopes.

Notifications are bounded recent activity rather than a complete archive; read state is per FID on this browser. The upstream adapter omits reaction subtype, so the UI says “reacted” instead of guessing like versus recast. Search indexes and channel directories remain Hypersnap node capabilities. Photos currently covers supported image embeds. No Farcaster-operated API/authentication dependency was introduced; the previously approved optional WalletConnect relay remains an external wallet-transport dependency.


The retained messenger gate was rerun for this release and still cannot invoke its original absent tools/sibling projects. Its mint guard was respected. Full receipt (line-end padding omitted):

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   3be63ba  ⚠ working tree dirty (34 files)
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/package.json, desktop/hypersnap/scripts/e2e-bootstrap-node.ts, desktop/hypersnap/scripts/e2e-media-runtime.mjs)
            (… and 25 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       0s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

## Previous social and wallet verification

The standalone Hypersnap entry passes `cd hypersnap && yarn verify`: **211 tests** across 17 files (31 gateway, 10 media Worker, 13 API, 10 pairing boundary, 8 native signer, 39 auth, 8 vault, 24 wallet provider, 13 WalletConnect adapter, 7 SDK lifecycle, 1 independent Rust protocol golden vector, 8 navigation, 3 profile validation, 7 profile draft validation, 20 UTF-8 mention, 6 media helper, and 3 isolated-harness boundary tests), TypeScript for browser/Worker/native code, and browser plus native payload builds.

The end-to-end run booted actual Hypersnap `0.13.5` from pinned source with a startup-only RocksDB correction, local consensus and persistent stores. An OS network sandbox denied non-loopback traffic. Synthetic registrations were seeded through Devnet admin events, then the same database was restarted in isolated Mainnet mode for the app's unchanged network-1 messages. See [E2E-node.md](E2E-node.md) for source pins, the exact patch, configuration and bootstrap commands.

The browser exercised ordinary wallet-style EIP-6963 approval, default-key registration, explicit six-scope registration, name/bio edits while preserving an unchanged legacy IPFS avatar, an uploaded avatar, normal follow/unfollow, follower-list hydration, compact-state-only follow detection and subsequent removal, a delayed profile response, image casting, and copy-link feedback. Fresh API reads and cold node restarts confirmed persisted profile values, expanded authorization, compact-follow removal and cast data. The browser harness alone substitutes exact loopback media URLs and a synthetic wallet; the independent backend media run retains the canonical production origin. The production build contains no harness or synthetic-wallet code.

This run found and fixed unchanged-avatar validation blocking other edits, premature profile-save success, late profile-read rollback, and compact-only follow detection. It also reproduced Hypersnap's always-on one-KEY_ADD-per-minute/FID limiter: the node returned HTTP 400 with `bad_request.rate_limited`, even though the six-scope format is valid. The client now checks recent offchain `addedAt` timestamps before requesting wallet approval, and the Worker narrowly maps that verified error to `429`. Only a definite `429/rate_limited` permits an explicit retry of the retained approved key, with fresh custody/nonce checks. Unknown outcomes remain status-only and never resubmit automatically.

The real Worker also returned `429` for the captured node rate-limit condition. The pre-approval cooldown and retained-approval retry are covered by auth regressions. A later optional browser cooldown probe could not obtain a newly committed signer after the single-validator fixture entered an upstream consensus/WAL replay failure; this does not count as a GUI cooldown pass. Earlier profile, follow and cast persistence checks had already completed. The failure and cleanup are recorded in [E2E-node.md](E2E-node.md).

The social client update uses Hypersnap commit `2e8733d044141ad3ba0e0592a4d5873c1dc6ce9c` as its wire/API reference. No Farcaster-hosted HTTP, websocket, authentication or Snapchain integration was imported from the MIT client snapshot. Default keys retain `[1,3,4]`; an explicit wallet review can authorize a new key for `[1,3,4,5,6,11]`. Synthetic tests cover exact expanded KEY_ADD signatures, link/user-data wire fields, current custody/scope checks, vault compatibility, partial profile saves and unknown-write quarantine. Profile banner writes remain excluded because of Hypersnap's Pro restriction and hydration limitations.

Anonymous browser smoke verified `/profile/<fid>` resolution, follower-list loading, profile navigation/Back, canonical cast sharing with clipboard feedback, `/cast/<hash>` conversation navigation and hard reload, nested reply rendering, share dialog above a conversation, and the explicit social-permission review without any wallet approval or submission. The owner previously reported a successful Rainbow account connection. Those anonymous checks performed no account writes; the separate synthetic-account end-to-end run below covers signed mutations.

Media unit checks use synthetic identities and mocked services. The new end-to-end backend run uses the actual local Hypersnap registry plus actual local Cloudflare SQLite Durable Objects and R2. With unchanged canonical HTTPS origins, it confirmed upload `200`, replay `409`, exact image read `200`, invalid image `415`, expired grant `401`, and unregistered key `403`. Browser checks additionally decoded a 512×512 uploaded image, saved it as the avatar, rejected a disguised SVG, and published an image cast. See [MEDIA.md](MEDIA.md) for the isolated runtime and production storage boundaries. No production account or bucket received a test upload.


Wallet tests use independent viem EIP-712 hashing and synthetic keys to verify exact KeyAdd, SignedKeyRequest, and KeyRemove compatibility. They cover custody mismatch, account/network changes, rejected or malformed signatures, bounded timeouts, cancellation between prompts, provider discovery and untrusted metadata. Vault tests include actual IndexedDB transactions across two connections, preventing another tab’s replacement vault from being erased. Unknown network writes are never automatically resubmitted.


WalletConnect uses the current pinned 2.26.0 SignClient/Core with the project owner’s explicit approval of its Community License and external relay. The project ID is configured in ignored local build environment files and a GitHub Actions public repository variable; no Dashboard API secret is used. Runtime dependency audit reported zero advisories. The SDK is lazy-loaded, uses fresh memory storage and a unique prefix, disables telemetry and global Core caching, permits only the exact displayed typed-data operation, and clears local session/pairing keys during bounded cleanup. The temporary nonsecret SDK environment flag is restored after initialization.

A live browser pairing with the supplied project ID produced a real local QR and canonical wallet-app links. A separate synthetic SignClient peer settled the restricted Mainnet namespace, received and checked the exact FID 1234 KeyAdd scopes `[1,3,4]` and TTL `604800`, then returned user rejection code 5000. The browser showed the controlled rejection, cleared pairing UI, and kept network submission disabled. The synthetic test produced no signature or Hypersnap write; its private temporary pairing file was deleted and relay keys cleared. Rainbow mobile pairing and pending-signature reopening routes were added from its official RainbowKit connector and app handler. The same 110-test gate and production browser/native builds passed after this change. Physical mobile-wallet approval remains untested by agents; the owner later reported successful Rainbow extension connection.

Rainbow browser extension support uses EIP-6963 `me.rainbow` plus its official direct `window.rainbow`, `isRainbow`, and bounded legacy provider-list shapes. Nine additional discovery regressions cover competing extensions, copied announcements, late identification, retained provider references, wallet caps, and untrusted getters/metadata. The 119-test gate and production browser/native builds passed. The browser-wallet UI comes first, prioritizes detected Rainbow, and offers official extension setup guidance when absent. No real extension approval or Hypersnap mutation was performed by agents.

Native UI smoke verified importing a public synthetic request, reviewing public account/key/permissions, signing with a public test-only 24-word phrase, clearing its input, and exporting an approval whose signatures then verified cryptographically. Browser smoke covered public account lookup, phrase-free sign-in, mobile wallet guidance, and rejecting an approval for another request. Native payload builds were repeated and their manifests matched.

Production checks perform public reads only. All new signed mutations used public synthetic keys on the isolated local node; no real wallet approval or production signer, cast, follow, profile, or media write was submitted. Physical iOS/Android wallet approval remains untested. Cross-platform support uses documented EIP-1193/EIP-6963 and typed-data-v4 interfaces; it is not a claim that every wallet/browser combination works. No independent security audit is claimed. The optional macOS beta is Developer ID signed; notarization is deferred.

The live node’s HTTP `requesterFids` sequence query fails to decode; bracket queries are ignored. The UI therefore supports custody-approved removal through wallet or offline signatures using the current user nonce, rather than guessing an app nonce. No upstream node mutation was performed.

The Worker uses manual redirects and rejects all upstream redirects, with regression coverage for Cloudflare runtime compatibility.

The retained Quorum messenger is separate. Its root verification was attempted but cannot run its tools without the original dependencies and sibling shared/SDK repositories. Its permanent-account mint guard was respected. This is the complete recorded verdict from this end-to-end test update (line-end padding omitted), not a passing messenger regression run:

```text
── VERIFY ──────────────────────────────────────────────
  ENVIRONMENT
    desktop   3b68055  clean
    shared    NOT INSTALLED
    sdk       NOT INSTALLED

  ROUTED    desktop
  TIER      fast + live
            (not on the safe list: desktop/hypersnap/scripts/e2e-bootstrap-node.ts, desktop/hypersnap/scripts/e2e-browser-server.mjs, desktop/hypersnap/scripts/e2e-media-checks.mjs)
            (… and 16 more)
            (held back: space-basic — it creates a permanent, undeletable Space every run; `yarn verify --all` runs it)

  desktop  typecheck      FAIL       0s
  desktop  lint           FAIL       0s
  desktop  unit           FAIL       0s
  desktop  harness-offline FAIL       0s
  desktop  build          FAIL       0s
  desktop  dm-basic       SKIP       0s     would register PERMANENT production state (missing .state/alice-bot.json, .state/bob-bot.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  dm-delivery    SKIP       0s     would register PERMANENT production state (missing .state/dm-delivery-receiver.json, .state/dm-delivery-sender.json) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  space-delivery SKIP       0s     would register PERMANENT production state (missing .state/space-delivery-victim.json, .state/space-delivery-sender.json, .state/space-delivery-victim-space.json (missing or unrestorable), .state/space-delivery-sender-space.json (missing or unrestorable)) — relay accounts and Spaces cannot be deleted. Opt in with `yarn verify --live-allow-minting`
  desktop  cross-dm       SKIP       0s     quorum-mobile not found — cross-client arm skipped
  desktop  config-cross   SKIP       0s     quorum-mobile not found — cross-client arm skipped

  NOT COVERED  role/permission gating — untested; the harness cannot even build one yet · authorization — 10 forgery/scope scenarios exist, none of them runs here · pin, an honoured mute & DM profile updates — sent, never confirmed to land · calling — zero coverage of all 9 WebRTC message types · no end-to-end or integration test exists

  VERDICT  FAIL — see the failing step above
           ⚠ live arms were skipped because this machine has no persisted bot identities — running them would register permanent, undeletable accounts and Spaces on the PRODUCTION relay. The fast tier ran in full. `yarn verify --live-allow-minting` accepts that cost deliberately.
           ⚠ This does NOT clear a change that touches shared or the wire.
─────────────────────────────────────────────────────────
```

# Earlier short-link cast display · 2026-10-22

The standalone `yarn verify` gate passes **928 tests across 45 files**, browser/Worker typechecks, the production browser build and offline signer typecheck/build. The new API and component regressions cover a verified match arriving while the next history page is pending, exact-read reuse within a batch, malformed page cursors, prefix collisions, cancellation/deadlines, stale and post-settlement progress, retained matches after later errors, and cancelling background reads before explicit full-cast navigation. Existing navigation integration checks use the simpler match-status copy.

The short-link resolver now hydrates and publishes matches after each fully validated history page instead of waiting for all four pages. The UI places matching casts first, allows immediate explicit opening, and checks the remainder of the same bounded batch in the background. Progress never claims uniqueness: automatic selection still requires exhausted available history and exactly one candidate. All prior author/hash, pagination, timeout and cumulative limits remain. No persistent cast cache, new API host, protocol permission or dependency was added.

Headless installed Chrome checked the local preview at 1360- and 390-pixel viewport widths using synthetic public responses. A matching cast rendered while page two was deliberately held pending; selecting it cancelled that request, opened the canonical conversation, and never requested pages three or four. Both viewports had no horizontal document overflow or browser errors. A separate public-read-only check of `/pichi/0xbd787413` through the local preview displayed the verified cast before the batch completed (2.822 seconds from the first API request in this one sample) and opened `/cast/0xbd787413995e9136d8cc636c6f1ee5331b94ec6d`. That timing includes current public-node/network conditions and is not a latency guarantee.

These are local preview checks, not a production release. The node still lacks a native author/hash-prefix index, so a match in older history can require further bounded searches. No wallet, account write, media upload, branch push, Cloudflare action or production deployment was performed.
