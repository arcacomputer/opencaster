# Feed-first familiar layout release · 2026-10-22

**The familiar social layout shipped from `main` merge `7ad6e7260ad2851c61247e13001202c8cedd8626`.** [PR #1](https://github.com/arcacomputer/opencaster/pull/1) was merged with a merge commit, not squashed or rebased, so every new dev-log source remains an ancestor of `main`. It moved Opencaster to one navigation column with a Cast dialog, conversation pages opened from the card body, a signed-out landing, one sign-in prompt per layout, cover-style profile and channel headers, a Recast / Quote menu, an Active channels column and persistent node-support links. Implementation commits: `d4431de97fb53a98e97c19546a4793b88b7f995a`, `fe3eaf558eb3c9978f6f7d1dd4bad9f83f6d9f3c`, `4e9c33c67392f69fb68f09002c082d7f6a0f3367`, `5a92bfc2fd9282aa78903ad12463b1121d129fcc`, `1c6b06026e5fb79530c8f9e747e0ad7d779f15ae` and `0aa9b5d2ebe88c366f3b028129b3cb1ce905ee33`. Lint fix `2255db65` removed one unused import, and merge `18d247f4` kept `main`'s node-support banner under the home tabs. Six new milestones bring the public log to 31. Hypersnap endpoints, signed messages, wallet permissions, media storage and Worker bindings are unchanged.

Local checks on `14927eaf975d9bf0c828cc75c5375fe64a555e5f`, whose tree is identical to the merge: the standalone `yarn verify` passed **912 Hypersnap tests**, the typecheck, browser build and offline signer build, and whole-repository `eslint . --max-warnings 0` passed. The root `yarn verify` gate was **not run locally**; this worktree lacks the retained messenger's root dependencies. CI's `retained-verification` job covers that gate. An earlier PR run of that job failed only on one unused-import lint warning, fixed before merge.

[PR CI 39884930385](https://github.com/arcacomputer/opencaster/actions/runs/39884930385) and [branch CI 39884925773](https://github.com/arcacomputer/opencaster/actions/runs/39884925773) passed on **attempt 1** for the final head, including both `retained-verification` runs. [Main CI 39885783954](https://github.com/arcacomputer/opencaster/actions/runs/39885783954) passed `verify` and `retained-verification` on **attempt 1** for the merge.

The release guard, `yarn check:devlog --base ef608f8e803db83985fdd96129da2354cfa34e34 --head 7ad6e7260ad2851c61247e13001202c8cedd8626`, passed against the actual pre-release deployed source (Worker version `bf64e267`): **8 shipped files**, new milestones `persistent-node-support-link`, `recast-menu-and-active-channels`, `familiar-profile-and-channel-headers`, `one-sign-in-prompt`, `cast-pages-and-signed-out-landing` and `feed-first-social-layout`.

The production build used a new directory outside the synced checkout and the existing ignored `.env.production.local`; the copied file was removed immediately afterwards. The built WalletConnect chunk contains the same project ID as the previously live chunk. The 26-file output contained no test fixtures. A dry run showed the expected `MEDIA_QUOTA`, `MEDIA_BUCKET` and `ASSETS` bindings. `wrangler deploy --assets <release directory> --tag 7ad6e7260ad2851c61247e13001202c8cedd8626` created Worker version **`55e5b818-2267-4691-82b0-fa467bed2e0c`** at 2026-10-23T02:13:37Z for `opencaster.org`, `quorum.arca.computer` and the workers.dev route.

Live public checks confirmed opencaster.org served the built entry bundle `index-B5x4-zYP.js`. `/`, `/devlog`, `/dwr`, `/channel/farcards-devs` and `/api/v1/info` returned 200, and `quorum.arca.computer/dwr` returned 308 to `https://opencaster.org/dwr`. The live `/devlog` listed the six new milestones newest first above `optional-hypersnap-node-support`; three spot-checked source links resolved on GitHub. No sign-in, cast, reaction, follow, upload or wallet approval was performed in production.

Before release, a separate browse-only Worker, `opencaster-preview`, served this branch at `claude.opencaster.org` with only an `ASSETS` binding and no media storage. Wallet sign-in is intentionally unavailable there because that origin is not in the signing allowlist.

Version `55e5b818` served 100% of traffic until 2026-10-23T02:40:21Z, when version `86e3aa7b` deployed `14550a1de59ac81c4c3a86ee9005d4e36b57c49f` (PR #2). Later deployments are outside this record.

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
