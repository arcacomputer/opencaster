# Reply ranking pilot — November 15, 2026

Release source: [`04a7d70d165374039cba891c6ec75ec05ee50be7`](https://github.com/arcacomputer/opencaster/commit/04a7d70d165374039cba891c6ec75ec05ee50be7).
Worker: `a850ff0c-a421-481a-94f9-ddb23d42058e`, deployed to opencaster.org.
[Integration review](https://github.com/arcacomputer/opencaster/pull/74).
Implementation and release notes were committed separately; the live milestone
is `background-reply-spam-ranking`, pointing to the final implementation commit
`8f1624fa81a0a607309140e415a0e5e21b26febf` and its recorded author timestamp.

The actual pre-release Worker was `7798daf4-bb25-4925-9e5d-001e1168146f`, with
source `54d1c655c5542c113a2aea2b876e4e558d4fc80d`. A fresh build of that source
reproduced the live `index-1rXQPIsp.js` byte-for-byte, SHA-256
`bc2cf34c4a652d9e69b395931ec6742d50463819e45feb7f03a40ee3cd700eeb`.
The deployed-base dev-log guard passed. This base was not inferred from main.

## Checks

The final root `yarn verify` passed **2,288 tests across 93 files**, all workspace
typechecks, the production browser build and offline signer build. New coverage
includes stable sibling partitioning, preserved parent/child relationships and
DOM cards, original-order restoration, fail-open/stale results, render-cap
preservation including changes to the final visible reply, bounded polling,
shared cache/work, monthly reservations, and lost-acknowledgement recovery.
The fixture-only Happy DOM iframe-loading notices do not establish external
iframe/network coverage.

Exact-source [push verification](https://github.com/arcacomputer/opencaster/actions/runs/43746375689)
and [pull-request verification](https://github.com/arcacomputer/opencaster/actions/runs/43746479656)
passed. CodeQL and the Cloudflare branch packaging check also passed. The latter
did not publish an alternate site.

A local Miniflare/workerd instance ran the real bundled gateway and SQLite-backed
Durable Object against synthetic node/model responses. One shared background
batch produced a hint for a reply. Browser observation confirmed that it moved
below its normal sibling, its child stayed attached, and all three replies
remained visible. Selecting Node order restored the original sequence. These
fixture identities were never submitted to a production node.

## Assets and live configuration

Production assets were freshly built into
`/tmp/arca-release-reply-ranking-20261115-04a7d70d` and that exact directory was
deployed. All **47** file fingerprints remained unchanged after packaging and
deployment. Inspection found no fixture wrappers, source maps, symlinks or
server-only Overmind material, including an explicit scan for the actual secret.
The public WalletConnect project ID stayed unset, matching the pre-release build.

The live browser entry is `index-D6fHSSWQ.js`, SHA-256
`dba4754c274bf81019387e3d033e5022aeebbec62197084cb134a0f82a93132a`.
The live dev-log bundle is `DevLog-CM7Koxj9.js`, SHA-256
`938709100bf6b5faac16495802ba023ea71ec08287b484283ed39c1540c6d41d`.
Both matched the inspected build. Public `/devlog` and the new milestone/source
link were verified. Existing media, analytics, traffic limits, origin secrets,
observability and disabled public previews were retained.

The live Worker version confirms these overrides:

```text
HYPERSNAP_NATIVE_READS=disabled
SPAM_RANKING=enabled
SPAM_MONTHLY_BUDGET_CENTS=500
```

**Repeat these overrides on subsequent production deployments.** The repository's
fork-safe scoring defaults remain disabled/zero, and the native-read source
opt-in must not silently re-enable the private node. The live `OVERMIND_API_KEY`
is a separate project-scoped Worker secret, expiring November 15, 2027; its value
is absent from source, browser assets and this record. Secret names were verified
through Worker metadata. No global primary-origin settings were introduced.
Public `/api/v1/info` still read Haatz (version 0.17.14).

## Serving evidence and limits

The exact native artifact and probability order were verified before release
with two synthetic inputs. That cold test took about 186 seconds and posted
$0.203849 in inference charges. It is not application traffic or a quality
benchmark.

After release a public conversation was loaded through the production gateway.
Its full reply tree matched the pre-release read. Hints transitioned from
`pending` to `ready`; the checked three replies had no suspected-spam hints, and
a subsequent read reused the completed hints. Movement itself was verified with
the isolated browser fixture, without manufacturing a production spam cast.

At 18:30 UTC, Overmind's deployment resource filtered to **period=1h,
source=application** reported **two successful requests, zero failures, 17,274
input tokens**, and a warm worker with no backlog. Application cost was
**$0.123137**, also present as 12.3137 credits in the account ledger at
18:30:38 UTC. The cold request took about 111 seconds; the warm request took
about 1.26 seconds. These metrics include application traffic from other visits
and are not all attributable to the selected QA conversation. The deployment is
the exact pinned Qwen3.5-0.8B native decision artifact recorded in
[the operating guide](REPLY_RANKING.md); no chat capability alias or dedicated
always-on deployment was activated.

The $5 monthly target uses conservative batch reservations, not a provider hard
invoice cap. AI-assisted research labels have no human reviews, and live history
differs from the archival training context. Human false-positive precision,
multilingual quality, and account bot identity are unmeasured. No automated
score hides, deletes, reports or blocks anything. Existing pagination/render
limits and user-selected mutes/hides remain independent. Production checks were
public reads/navigation only; no real wallet or social account write was used.

## November 15: supported native request sizes

The cost benchmark established that both Overmind native surfaces accept at most
16 decisions per request. Implementation
[`0ce3f6ac120328e7ffdd6cdb03fc6c7f8d12b2f3`](https://github.com/arcacomputer/opencaster/commit/0ce3f6ac120328e7ffdd6cdb03fc6c7f8d12b2f3)
splits a logical 32-cast workload into two persisted native requests with stable
keys. The reservation remains one per logical workload. A completed first part
survives a lost second acknowledgement and a coordinator restart. Unknown
legacy submissions remain quarantined rather than being submitted under new
keys.

The actual pre-release source was
`04a7d70d165374039cba891c6ec75ec05ee50be7`, Worker version
`a850ff0c-a421-481a-94f9-ddb23d42058e`. The release gate passed against that
source. Root `yarn verify` passed **2,290 tests in 93 files**, all typechecks and
production browser/offline signer builds. The full-workload test enforces the
16-decision limit, simulates an uncertain second acknowledgement and restarts
the coordinator before checking all 32 mapped results and a single reservation.
Exact-source [push](https://github.com/arcacomputer/opencaster/actions/runs/43766025028)
and [PR](https://github.com/arcacomputer/opencaster/actions/runs/43766028226)
verification passed.

Release source `1ef48c3736cf5da3ff91d1d71e6b5da47489db3b`, including the separate
user-facing milestone, was built into
`/tmp/arca-release-native16-20261115-1ef48c37`. All 47 asset fingerprints remained
unchanged after deployment. Live Worker version
`03db1572-c98a-4263-b796-cb4d7d4bed2e` retained the production overrides above.
The live main and dev-log assets matched the inspected directory:

```text
index-0C4D6R9I.js
63615154041376aa02a8272f93fa7e916a5fca6c9e27bb618e9b5246dd15b26d
DevLog-DX1kM_9q.js
8cbbacb7ee51c59728eb9106c655911bc3f7a05ab79f8f8c943097e8e590f6c1
```

The live `/devlog` bundle contains `supported-background-reply-batches`. A public
busy-conversation read returned its replies and an empty ready hint response;
this does not establish a newly completed 32-cast application workload. Real
provider validation covered sixteen acknowledged 16-cast benchmark requests;
full-workload durable recovery was verified with the isolated test. The $5
reservation guard was not increased, and no self-hosted model was activated.
