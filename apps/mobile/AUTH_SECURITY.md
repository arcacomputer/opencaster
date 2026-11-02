# Native authorization security design

This is the implementation contract for the mobile authorization follow-up, not
a claim that authentication or store readiness has shipped. The native public-read
foundation passed Android emulator and iOS simulator validation before this work.

## Boundary and identity

- Use only the existing HTTPS Opencaster gateway and Hypersnap protocol. No
  Farcaster-hosted identity API, managed signer, alternate feed or fallback node.
- Public lookup is not authentication. Display the exact FID, username and full
  custody address; require an explicit identity review before creating a key.
- Re-read the exact FID's custody and complete signer registry before submission,
  unlock and authorized actions. Reject changed identity, stale nonce, missing
  metadata, expired/removed keys or unexpected permissions. Node observations are
  not independently verified consensus proofs.

## Approval and key creation

- Generate a random 32-byte Ed25519 seed using Expo Crypto's native secure random
  source. Use the existing Noble and protocol implementations; do not implement
  cryptographic algorithms or use a JavaScript pseudo-random fallback.
- The first increment uses the existing **public request/approval file protocol**
  with the separately installed offline signer. It does not import custody keys
  or recovery phrases, add a hosted wallet service, or claim in-app wallet support.
  Transfer only public requests and public signatures through the system share
  sheet/document picker. Explain the separate signing tool requirement before
  starting. A wallet-app transport can be added as a separately reviewed adapter.
- Request exactly `[1, 3, 4]`: cast/reply creation and reaction addition/removal.
  No custody transfer, financial authority, following, profile editing or deletion
  scope. The protocol's seven-day **sliding inactivity** window is not a fixed
  seven-day expiry. Approval requests expire after 15 minutes.
- Reuse `validatePairingRequest`, `validatePairingApproval` and
  `verifyPairingApproval`: bind the request ID/hash, FID, custody, device public key,
  exact scopes, TTL, nonce and deadline; recover and verify both signatures against
  the current custody wallet. The historical EIP-712 domain is required by
  Hypersnap and does not imply Farcaster service compatibility.
- File contents are untrusted and size-bounded. This increment has no approval
  deep-link callback or callback URL: an arbitrary `opencaster:` link cannot grant
  access. The origin in a transfer file is a display hint, not cryptographic proof
  of the requesting app. Display the complete public key and request checksum for
  comparison in the signing tool.

## Protected persistence and lifecycle

- Use Expo SecureStore: iOS Keychain with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, Android
  Keystore-encrypted app storage. Exclude secure data from Android backup. Never
  fall back to ordinary preferences, files, clipboard, logs or telemetry for seeds.
- The protection is encryption at rest, not a claim of hardware-backed Ed25519
  signing or biometric approval. While unlocked, the controller owns one mutable
  seed byte buffer and zeroes it on lock, replacement or successful deletion.
  Protected-storage serialization and native bridges still create immutable
  strings/runtime copies that JavaScript cannot reliably erase. A compromised
  operating system or running application is outside this boundary.
- Require explicit consent to save this device key before creating the persistent
  request. Keep a single versioned, bounded protected record containing the seed,
  public identity, exact scopes and lifecycle state. No custody secret is stored.
  Do not overwrite an existing saved device silently.
- Start locked, including after process restart. Backgrounding/locking invalidates
  in-flight work, zeroes the owned active seed buffer and drops its reference. An explicit unlock reads protected
  storage and rechecks current custody/signer state before granting write access.
  Do not auto-submit anything on launch, unlock, foreground or network recovery.
- iOS Keychain data may survive uninstall/reinstall with the same identifier;
  uninstall is not a reliable erasure or revocation action. Explain **Forget this
  device** and **Revoke on Hypersnap** separately. Android uninstall normally loses
  the local key; recovery means a new custody-approved device, not seed recovery.
- Cancellation before submission removes the pending local key. A failed protected
  write/deletion is visible and does not claim success. Cancellation after submission
  preserves a protected status-only record because the network may have accepted it.
  An expired unsubmitted approval cannot register; an uncertain submitted request
  may only check status, even after its original approval deadline.

## Submission and revocation

- Persist the submitted/uncertain marker **before** sending any signed request.
  Serialize mutating operations; guard asynchronous completions with a generation
  token so cancellation/locking cannot resurrect a session or send stale approval.
- HTTP acknowledgement alone is not authorization confirmation. Observe the exact
  key in the complete registry with matching source, requesting FID, scopes and
  unexpired inactivity window. Bounded confirmation failure remains **unknown**;
  subsequent actions are read-only status checks, never blind resubmissions.
- Initially use the existing custody-approved `RevocationRequest` / KEY_REMOVE
  protocol, with its distinct transfer kind and signature verifier. Recheck fresh
  custody/nonce before sending. Confirm the key's actual absence (not just expiry)
  before reporting network revocation and deleting the protected local record.
- **Lock** removes active access but retains protected storage. **Forget** deletes
  local credentials only and explicitly leaves network authorization intact.
  **Revoke** requires custody approval and observed network removal. Lost keys and
  other devices remain separate; do not claim to revoke them automatically.
- Posting/replies/reactions follow incrementally after authorization validation.
  Their eventual UI must distinguish submitted, confirmed, failed and unknown;
  retain intent/hash across restart and reconcile via reads without duplicate writes.

## Validation and release limits

- Tests use isolated synthetic custody identities and local/mock services for all
  writes, including KEY_ADD and KEY_REMOVE. Never submit synthetic or real writes
  to production during agent testing. Real-network tests are public reads only.
- Cover wrong/expired approvals, custody/nonce/scope mismatch, cancel/lock races,
  protected-storage failure, restart/uncertain-submission recovery and actual
  revocation versus local removal. Test native secure storage and crypto on both
  platforms; JavaScript exports and unit tests are not native validation.
- Protocol device keys have no relation to Apple certificates, Android keystores,
  Expo tokens or distribution signing. Do not request those for this stage.
- Preserve AGPL-3.0-only and upstream notices. Store-distribution license compatibility
  remains a release-review item; do not relicense code or claim legal clearance.
- No merge, backend deployment, EAS/TestFlight/Play upload, review submission,
  public release, paid service or real account action is authorized by this design.

References: [Expo SecureStore](https://docs.expo.dev/versions/v55.0.0/sdk/securestore/),
[Expo Crypto](https://docs.expo.dev/versions/v55.0.0/sdk/crypto/),
[existing signer contracts](../web-client/SIGNER.md),
[`pairing.ts`](../../../packages/client-core/src/pairing.ts).
