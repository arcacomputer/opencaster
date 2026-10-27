# Sparse mention/reply index browser validation

Recorded 2026-10-27 for PR #14 (`402d20e7`) and the compatibility fix in
`codex/pr14-browser-validation`.

## Reproduction

Use Node 22, the repository's installed Yarn dependencies, and the pinned shared
source checkout. From the repository root:

```sh
yarn node scripts/validate-mention-indexes-browser.mjs --port=5197
```

Open its loopback URL in a real browser. Wait for **MODULE READY**, click
**Create v16 database**, wait for **V16 SEEDED AND CLOSED**, reload the page,
wait for **MODULE READY**, and click **Upgrade existing v16**. Choose an unused
port for each rerun. The harness refuses to overwrite/delete an existing test
database; synthetic databases remain available for inspection.

The baseline is the actual MessageDB and badge-hook source at
`14550a1de59ac81c4c3a86ee9005d4e36b57c49f`. It creates the complete v16 application
schema, stores 30 synthetic messages, records both old badge hooks, and closes
the connection. After a page reload, the current actual MessageDB upgrades that
persisted database, and the current actual hooks calculate the same badges.
The only provider adapters inject a synthetic viewer and the local DB. Shared
mention/settings functions are reexported from their installed implementation;
no account providers, credentials, or network connections are mounted.

## Observed results

Both runs used the Codex in-app browser's native IndexedDB implementation.
They were not fake-indexeddb runs. The database was version 16 before upgrade,
version 17 afterward, with all 22 object stores retained. The messages store
retained its three previous indexes and gained `by_conversation_mentions` and
`by_conversation_reply_author`.

| Scenario | Old mentions/replies | Original PR #14 | With compatibility fix |
| --- | --- | --- | --- |
| Direct mention | 1 / 0 | 1 / 0 | 1 / 0 |
| Permitted @everyone | 1 / 0 | 1 / 0 | 1 / 0 |
| Viewer role mention | 1 / 0 | 1 / 0 | 1 / 0 |
| Channel/thread read boundaries | 2 / 2 | 2 / 2 | 2 / 2 |
| Fourteen messages tied on timestamp, capped at ten | 10 / 10 | 10 / 10 | 10 / 10 |
| Multiple channels | 2 / 2 | 2 / 2 | 2 / 2 |
| Muted space | 0 / 0 | 0 / 0 | 0 / 0 |
| Disabled notification types | 0 / 0 | 0 / 0 | 0 / 0 |
| Historical @everyone without memberIds | 1 / 0 | **0 / 0** | 1 / 0 |
| Historical role mention without memberIds | 1 / 0 | **0 / 0** | 1 / 0 |

The original real-browser run reported **PARITY FAILED**, with the two
historical-shape cases as its only failures. The corrected fresh-origin run
reported **PARITY PASSED**, with no failures.

The fix fills an omitted/null top-level `mentions.memberIds` with `[]` during
the atomic v17 upgrade and on message writes/imports. Canonical message
fingerprints depend on content, nonce, sender, and scope; this normalization
preserves those fields. Focused regressions cover migration, save, update,
backup import, unchanged caller objects, and identical canonical fingerprints.
The focused suite passed all eight tests; TypeScript and targeted ESLint passed.

## Coverage limits and merge hold

These are persisted **synthetic v16 databases**, created by the old application's
real storage code. No actual existing user's v16 database was opened, and no
signed-in messenger session or production account action was exercised. This
establishes real-browser index/migration semantics and fixture parity; it does
not fulfill the separate requested existing-user-database check. Keep PR #14's
merge hold until that check is completed. The full routed gate and mint-guard
coverage must be reported separately; the initial unbounded run was interrupted
after environment setup and load-related failures, so it has no final verdict.
