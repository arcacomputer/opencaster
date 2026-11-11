# Gateway content visibility

The gateway supports an optional, operator-managed `OPENCASTER_MODERATION`
environment binding. It is server-only and is not part of the browser client,
an account setting, a report endpoint, or a network ban. No policy is enabled
by default, and the production Worker configuration in this repository does
not set the binding.

An operator may configure a JSON string with exactly this schema:

```json
{"version":1,"blockedFids":[],"blockedCasts":[],"blockedMedia":[]}
```

`blockedFids` contains positive safe-integer FIDs; `blockedCasts` contains
40-hex-character cast hashes, optionally prefixed with `0x`; `blockedMedia`
contains 64-hex-character content-addressed media hashes. Hash matching is
case-insensitive. Each list accepts at most 500 entries and the complete
configuration is limited to 64 KiB. The binding must be valid JSON and include
all four fields with no unknown fields. An absent binding preserves existing
behavior; a present empty policy enables filtering with no blocked targets.
Malformed, empty, oversized, or invalid configuration fails content reads
closed. Keep targets private to the operator and out of source, logs, reports,
and public documentation.

## Private operator procedure

Review any report privately. Identify only the minimum target needed: a FID,
the full cast hash (not a display prefix), or the exact hosted-media hash.
Prepare the policy through operator-owned Worker deployment/settings, using
`OPENCASTER_MODERATION` as a server-only secret/binding. Never put it in a
browser `VITE_*` variable, public JSON, this repository, or a committed
deployment config. This repository does not provide an API or admin screen for
changing the policy.

Stage and check both allowed and denied reads before any separately approved
production change, including intentionally short pages and preserved
identity/custody lookups. To restore an individual item, remove that entry and
verify again. Removing the binding entirely intentionally disables moderation
globally; a malformed binding is not a rollback and continues to fail content
reads closed. Do not use production targets or credentials in local fixtures.

The gateway filters returned content locally; it does not delete upstream
content, suspend accounts, or prevent content from being read elsewhere.
Identity and custody lookups, signer metadata, and registry/name reads remain
available. A blocked profile lookup returns a minimal neutral profile stub
with its FID and validated custody address so device authorization and
revocation checks can continue; no profile media, username, or biography is
included. If that custody address is unavailable, the lookup is denied.

Blocked items are removed from returned collections while upstream cursors,
counts, and page sizes remain unchanged. Pages may therefore be short or
empty; the gateway does not refill them or invent totals. Signed native
messages are never rewritten. If a message contains a blocked reference, the
whole message is omitted; for strict cast-history pages, any such omission
denies the page rather than changing receipt/cursor semantics. This
conservative matching cannot identify every alias or historical reference.

Uploaded media has no automatic FID-to-image ownership mapping. Operators
must separately identify and list an exact media hash. A configured policy
causes allowed first-party media and newly rendered custom previews to use
`no-store`, and the current policy is checked against warm gateway caches.
Previously downloaded copies, off-origin caches/CDNs, and third-party embedded
URLs cannot be recalled by this filter. It does not delete R2 objects or
purge external caches; those require separate operator actions.

Reports, email review, and operator responses are not automated by this
feature. This visibility control is not an account enforcement system or a
compliance certification.
