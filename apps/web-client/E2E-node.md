# Actual isolated Hypersnap node

The browser and media E2E harnesses use the actual Hypersnap HTTP server, signature validation, consensus, RocksDB stores, and social indexes. They do not replace the signer registry with a mock. Every account and key is a public synthetic fixture. Never fund these keys or reuse this database for a public node.

## Pinned source and startup correction

The tested source is [farcasterorg/hypersnap at `2e8733d044141ad3ba0e0592a4d5873c1dc6ce9c`](https://github.com/farcasterorg/hypersnap/tree/2e8733d044141ad3ba0e0592a4d5873c1dc6ce9c). Both this source and the official stable ARM64 image (`sha256:6b5e3a233e9ecd3197528502a4c5a2b7bb81a671b6936d048910b5a526c401e1`) attempt to open the same shard-0 RocksDB twice in `SnapchainNode::create`, failing before the HTTP server starts. The small [startup patch](scripts/e2e-node-startup.patch) reuses the first block engine. It changes no validation, signature, scope, store, or API implementation.

Use sibling clones, matching the upstream workspace layout:

```sh
git clone https://github.com/farcasterorg/hypersnap.git /tmp/arca-hypersnap-social-source
git -C /tmp/arca-hypersnap-social-source checkout 2e8733d044141ad3ba0e0592a4d5873c1dc6ce9c
git clone https://github.com/informalsystems/malachite.git /tmp/malachite
git -C /tmp/malachite checkout 13bca14cd209d985c3adf101a02924acde8723a5
git clone https://github.com/CassOnMars/eth-signature-verifier.git /tmp/eth-signature-verifier
git -C /tmp/eth-signature-verifier checkout 8deb4a091982c345949dc66bf8684489d9f11889
git -C /tmp/arca-hypersnap-social-source apply /ABSOLUTE/REPO/PATH/apps/web-client/scripts/e2e-node-startup.patch
cd /tmp/arca-hypersnap-social-source
LIBCLANG_PATH=/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/lib \
  CARGO_PROFILE_DEV_DEBUG=0 CXXFLAGS='-g0' cargo +1.96.1 build --locked --bin hypersnap -j 6
```

The completed local build used Rust 1.96.1, installed `protoc`, Xcode Clang, and the exact pinned RocksDB 10.7.5 source. Upstream pins Rust 1.95.0; either compiler is above its declared minimum. Do not substitute Homebrew RocksDB 11.1: its ABI/header changes are incompatible with this Rust wrapper. Cold compilation can take several minutes.

## Isolation and actual fixture bootstrap

From `apps/web-client/` after installing dependencies at the repository root:

```sh
node scripts/e2e-node-config.mjs /tmp/arca-hypersnap-e2e
RUST_LOG=error sandbox-exec -f /tmp/arca-hypersnap-e2e/network.sb \
  /tmp/arca-hypersnap-social-source/target/debug/hypersnap \
  --config-path /tmp/arca-hypersnap-e2e/nodes/1/hypersnap.toml
```

This macOS sandbox denies all non-loopback networking. The node binds HTTP `127.0.0.1:13381`, gRPC `127.0.0.1:13383`, and local gossip only. Peer discovery, production peers, chain RPCs, fname fetching, snapshot downloads, and replication are disabled. Shards 0 and 1 use the same single synthetic validator. The actual social graph, metrics, feed, channel, and Tantivy cast-search indexers are enabled; trending feeds require the metrics indexer even when the feed is empty. On other operating systems, supply equivalent network namespace/firewall isolation before running the fixture.

In a second terminal:

```sh
yarn esbuild scripts/e2e-bootstrap-node.ts --bundle --platform=node --format=esm --outfile=/tmp/arca-e2e-bootstrap.mjs
node /tmp/arca-e2e-bootstrap.mjs
```

The bootstrap talks only to the two hardcoded loopback addresses. It submits synthetic ID-registration, storage, and legacy signer events through the actual **Devnet-only** admin RPC. It then submits genuine EIP-712 custody-authorized KEY_ADD messages with Ed25519 outer signatures, waits for the actual scoped registry entries, and writes the initial profile through USER_DATA_ADD. FIDs 1234 and 1235 have the reviewed `[1,2,3,4,5,6,11]` client device scopes. A separate synthetic on-chain fixture signer can generate compact-state test data. The initial FID-1234 picture is deliberately `ipfs://legacy-avatar`, to exercise editing other fields when an unchanged legacy picture does not match the upload URL policy.

Only after actual confirmation, it creates `/tmp/arca-hypersnap-e2e/identity.json`, with the marker `arca.hypersnap.e2e.identity`. This is the input for `e2e-browser-server.mjs` and `e2e-media-server.mjs`.

Stop the devnet process, change `fc_network="Devnet"` to `fc_network="Mainnet"` in its **local synthetic configuration**, and restart it with the same sandbox and database. This is a cold persistence check and allows the unmodified application's normal network-1 messages to be tested. It does not connect the database to the public Mainnet: the network sandbox and disabled connectors remain in force. Read `/v2/farcaster/user?fid=1234` and `/v1/signersByFid?fid=1234` to confirm persisted profile and scoped device authorization before the app tests begin.

## Compact-only follow regression

After ordinary browser follow/unfollow tests finish, run:

```sh
node /tmp/arca-e2e-bootstrap.mjs --compact
```

This submits an actual signed LINK_COMPACT_STATE for FID 1234 following FID 1235. It requires the effective v2 following list to contain 1235 while the individual v1 LINK_ADD lookup returns NotFound. The app must still display Following and allow Unfollow. The explicit follow-removal fixture is available with `--compact-remove`; it requires the effective relationship to become absent. Coordinate these commands with the browser test because they intentionally change the same synthetic relationship.

Stop the local node and browser/media harnesses after testing. No production account registrations, casts, follows, profile writes, wallet signatures, or uploads are needed.

## Actual-node rate-limit regression

`node /tmp/arca-e2e-bootstrap.mjs --rate-limit-probe` performs two explicit fresh-key attempts with the public synthetic keys `06` and `07`. Run it once on an already bootstrapped isolated database after the previous registration window has passed; it intentionally consumes one local custody nonce and creates one additional local fixture key. It never retries a submission.

The observed first registration returned 200 and committed nonce 4. The immediate second registration returned HTTP 400 with:

```json
{
  "error": "Failed to submit message",
  "error_detail": "status: InvalidArgument, message: \"bad_request.rate_limited/rate limit exceeded for FID 1234\", details: [], metadata: MetadataMap { headers: {\"x-err-code\": \"bad_request.rate_limited\"} }"
}
```

The registry remained at nonce 4. This is the actual node's one-KEY_ADD-per-minute/FID protection, not a failure of the six-scope authorization format. The fixture records `/tmp/arca-hypersnap-e2e/rate-limit-proof.json` for inspection. The read-only `--validate-social` diagnostic uses the node's static validation endpoint; a positive result there alone does **not** prove custody ownership, nonce acceptance, or state inclusion.

With the local browser gateway running at `127.0.0.1:5188`, the explicit `--rate-limit-probe --next-window --admission-only` command uses synthetic keys `07` and `08`. The actual node admitted the first request with 200; the immediate second request through the actual gateway returned 429 with `code: "rate_limited"`. Its receipt is `/tmp/arca-hypersnap-e2e/rate-limit-worker-proof.json`. The test gateway had the earlier message mentioning a fresh device-key approval; the final source's shorter generic retry wording is covered by unit tests. This proves the real node-error classification and HTTP status, without claiming the later wording was exercised in that running gateway.

The `--admission-only` mode deliberately does not wait for inclusion and records `firstCommittedNonce: null`. In this run the registry remained at nonce 4 because of the restart limitation below. It must not be presented as successful key registration or as a GUI cooldown check. The earlier direct-node probe did confirm nonce-4 inclusion before testing its rejected second request.

## Observed persistence checks

On 2026-10-19, the actual local node retained the browser's signed display name `Arca confirmed ✓`, bio `Signed on local Hypersnap 🌱`, uploaded avatar URL, and expanded browser device key across a process stop and cold restart. Ordinary follow/unfollow and compact-only following followed by browser Unfollow were checked against fresh effective social-graph reads. After the latter, `/v2/farcaster/user/following?fid=1234&cursor=1234&limit=1` returned `{"users":[],"next":{}}` both before and after the cold restart.

The browser also submitted the image cast `26f47dedb0ea3c2029a516a22b93e93234aede62`, with text `Isolated image upload E2E 🌱` and its actual local media URL. After another cold process restart, `/v2/farcaster/cast?identifier=26f47dedb0ea3c2029a516a22b93e93234aede62&type=hash` returned the same cast, embed, and edited author profile. The browser opened its public cast route anonymously and hard-reloaded it; the image decoded at 512×512. Independent assertions of the persisted profile, cast, and empty effective following list are saved in `/tmp/arca-hypersnap-e2e/cold-persistence-proof.json`.

## Upstream restart limitation

The final cold restart retained all committed data but the single-validator consensus runtime stalled at height 3053. Its actual log repeatedly reports `Could not find proposed value for decided value` and `Error when checking and replaying WAL: Messaging failed because channel is closed`. Thus successful reads after restart establish persistence, not renewed consensus availability.

Two fixture-only attempts stopped the owned process and archived the shard-0/shard-1 Malachite `wal/wal/consensus.wal` journals while preserving every RocksDB record. They did not recover consensus. Both archived journals and the logs remain under `/tmp/arca-hypersnap-e2e/`; no upstream consensus, validation, or storage code was changed. The optional live GUI cooldown check was consequently not completed. The native process was stopped after collecting the real gateway 429 and cold-read receipts. A new E2E run should create a fresh isolated fixture directory rather than treating this stalled test validator as a healthy service.

## Expanded client feature checks

Use a fresh generated directory such as `/tmp/arca-hypersnap-e2e-features`, retaining the network sandbox and bootstrap/restart sequence above. The generator now uses a one-second block interval to avoid unnecessary consensus churn and creates the search index inside that disposable directory. Pass `--fixture-dir /tmp/arca-hypersnap-e2e-features` to the bundled bootstrap to keep its identity/proofs separate from earlier fixtures.

From `apps/web-client/`, with the isolated Mainnet-mode node already running:

```sh
yarn esbuild scripts/e2e-feature-checks.ts --bundle --platform=node --format=esm \
  --define:import.meta.env.DEV=false --outfile=/tmp/arca-e2e-feature-checks.mjs
ARCA_WRANGLER_PATH=/Users/felirami/.local/bin/wrangler \
  node /tmp/arca-e2e-feature-checks.mjs \
  --identity-file /tmp/arca-hypersnap-e2e-features/identity.json
```

Set `ARCA_WRANGLER_PATH` to your actual Wrangler installation; it selects that installation's compatible local Miniflare runtime. The runner permits only the published synthetic device keys and loopback node. It unlocks genuinely encrypted vaults in in-memory IndexedDB, uses actual app signing and API code, the actual Worker/SQLite Durable Object/R2 implementation, and real Hypersnap storage/indexers/consensus. All canonical production origins remain unchanged in this backend test; its outbound adapter rewrites the fixed Hypersnap destination to loopback. It never connects to the public network.

The checks cover profile indexing, user/cast search, quote embeds, channel roots/directory/detail/feed, uploaded-image byte integrity and photo casts, all profile tabs, four activity categories, foreign-cast deletion rejection before submission, confirmed own-cast deletion, stale search-index filtering, and unfollow cleanup. Each run creates unique disposable test casts and emits `feature-checks-proof.json` next to the identity. It does not silently resubmit uncertain writes.

A fresh October 19 feature fixture completed these checks without the earlier fixture's consensus/WAL stall. Browser testing on that fixture also confirmed a default-key sign-in, protocol quote, explicit deletion-permission approval followed by a separate deletion confirmation, channel posting, and the pre-approval cooldown using actual registry timestamps. This does not establish that arbitrary repeated cold restarts of the upstream node are reliable.
