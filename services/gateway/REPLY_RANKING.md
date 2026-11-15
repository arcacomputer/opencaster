# Background reply ranking

Replies render immediately. Background hints from `GET /api/reply-ranking?identifier=<root hash>`
move suspected spam below other replies **within each sibling group**. Descendants
stay with their parents. Ranking runs after the existing depth/150-cast render
limits, so it cannot displace a visible card beyond those limits. **Node order**
restores the original order. No score hides, collapses, deletes, reports, blocks
or changes a cast/account on Hypersnap. Existing user-selected mutes/hides and
node pagination remain independent. No account is labeled a bot.

## Background work

Only a successful, validated fixed-origin conversation response can enqueue
work. No public endpoint accepts text, FIDs, labels, prompts or inference jobs.
Origin, rate, method and query controls also apply to the ranking read.

The SQLite `ReplyRanking` Durable Object shares work and reservations across
visitors/locations. A 30-second collection window batches at most 32 replies.
Limits: 64 queued candidates, 1,024 cached records and 256 thread snapshots of
up to 150 hashes each. Snapshots expire after a day, scores after seven days.
Unavailable context is tried again only after an hour and a fresh conversation
read. Expiry is checked on reads; expired scores are pruned during work and old
snapshots are evicted. Idle queues leave no recurring alarm. Pending/unknown
operations retain their recovery state. Browsers poll at most 60 times every ten
seconds, cancelling on navigation, unmount or a switch to node order. Work can
finish after the tab closes and benefit later visitors.

The provider accepts at most **16 decisions per native request**. A 32-cast
workload is therefore split into two requests, with distinct stable keys under
one reservation. Completed parts are saved before starting the next part and
are never replayed after a restart or a lost later acknowledgement. The hints
become ready after every part is resolved. Already attempted legacy submissions
keep their original key/input; an unknown legacy request is never re-keyed or
silently split to bypass its quarantine.

The target must be in the author's latest 250 public native v1 messages. Context
contains at most four earlier casts/parents with strictly earlier publication
times, and counts observations within seven days. Missing target/history means
no score; missing parent text is explicit. Media is never downloaded. Overmind
receives public text, URLs and bounded counts, without FIDs, cast hashes, client
brands, follower counts, teacher labels or wallet secrets. Prepared request text
is retained only while its batch is in flight. Only score hints remain cached.

Live context differs from archival training: v1 exposes publication time rather
than block observation time, removes may be pruned, and older history can be
absent. Counts describe that bounded window, not complete account activity.
JavaScript lowercase can differ from Python case folding for some Unicode text.
The research benchmark does not measure these serving distribution differences.

## Model and decisions

- Project: `ce6051ef-cef8-4dba-87c9-5b12ddcebee2` (`opencaster-spam`).
- Deployment: `0f3274f7-a246-48a8-ac3d-00fcba95c6c7`.
- Model: `ft-97cea71b-qwen-3-5-0-8b-decision` (Qwen3.5-0.8B).
- Artifact: `93238185313b1927be8c457ea3437db75bfa325675dcca2899c37597bda94680`.

`spamContext.ts` preserves the training question, input fields, ordered options
(`normal`, `spam`, `insufficient`) and earlier-text truncation bounds. Typed
inference returns probabilities. Demotion requires raw spam >= 0.80,
spam-minus-normal >= 0.65 and insufficient <= 0.10. Option order, row indices,
vector sizes/sums and model/artifact identities are checked for the whole batch.
Invalid results fail open. This provisional cutoff is **not measured human spam
precision**: the research labels have zero human reviews. False positives remain
possible. The policy expressly excludes opinions, language, short replies,
useful bots and ordinary reward/game updates alone as evidence of spam.

A saved stable request key, exact inputs and reservation precede asynchronous
submission. Lost acknowledgements recover with the same key/input at most three
times. Receipt polling never creates another inference job. Unresolved submission
or work still unresolved after 55 minutes halts new paid work for operator review.
Do not clear the coordinator/counters or re-key unknown work: inspect its saved
receipt/key and resolve it with Overmind first. Durable alarm handlers must stay
idempotent; see [Cloudflare's alarm contract](https://developers.cloudflare.com/durable-objects/api/alarms/).

## Budget and operation

The operator approved a **$5/month target** on November 15, 2026. Enable with
`SPAM_RANKING=enabled`, `SPAM_MONTHLY_BUDGET_CENTS=500` and a project-scoped
`OVERMIND_API_KEY` **Worker secret**. Checked-in defaults are disabled/zero so a
fork cannot incur inference spending merely by deploying. Use a separate
production key for revocation; never put it in source, Vite, assets or logs.
The initial production key expires November 15, 2027; rotate it before that date.

Each batch atomically reserves **50 cents** from a shared UTC calendar-month
allowance before submission. Failures/unknown requests retain reservations;
same-key recovery never reserves again. Five dollars permits at most ten batches
and 320 newly scored replies per month, often fewer with partially full batches.
Excess/unavailable replies retain node order, and cached hints require no new
model calls. This starter limit trades coverage for a small budget.

The November 15 two-input cold smoke test took about 186 seconds and posted
**$0.203849** in inference charges. Fifty cents per batch is a planning reserve,
not a proven maximum. The provider ledger can lag and does not enforce this
application budget. Cloudflare requests/storage, node reads, idle/shared serving
overhead, other activity and unposted charges are not a hard-capped all-in
invoice. Review actual usage before raising throughput. No dedicated always-on
deployment is requested.

To stop new work, deploy `SPAM_RANKING=disabled`; reads then use node order.
Already accepted provider work must be stopped separately if necessary. Preserve
the Durable Object/counters. Rotate/revoke the production key separately. Node
routing is independent: production's Haatz configuration must be preserved until
a separately approved native-node cutback.
