# AGENTS.md (apps/macos)

Native SwiftUI macOS client for Opencaster. Deltas from the root `AGENTS.md`
only.

## Verification gate

For changes confined to `apps/macos/`, this replaces root `yarn verify`:

1. `cd apps/macos/HypersnapKit && swift test` — hermetic protocol/API tests,
   including the byte-exact `keyadd-golden.json` check.
2. If files were added or removed: `cd apps/macos && xcodegen generate`
   (the `.xcodeproj` is generated from `project.yml` and gitignored).
3. `xcodebuild -project Opencaster.xcodeproj -scheme Opencaster -destination 'platform=macOS,arch=arm64' build`
   must end in `BUILD SUCCEEDED`. The CoreSimulator "out of date" warning is
   harmless for macOS builds.

If the change affects message encoding, also run the opt-in live dry run,
which only hits `/v1/validateMessage` and never publishes:
`HYPERSNAP_LIVE=1 swift test --filter LiveValidation`.

## Writes and test identities

- Do not publish to the network to test UI flows. Use **Settings → Dry run**
  (routes writes to `/v1/validateMessage`) or the DEBUG-only
  `OPENCASTER_DEBUG_TOAST=<hash>` / `OPENCASTER_DEBUG_OPEN=1` launch
  variables.
- Real account writes need explicit user authorization, as in the root rules.

## UI tests

- Run: `xcodegen generate`, then `xcodebuild -project Opencaster.xcodeproj -scheme Opencaster -destination 'platform=macOS' test -resultBundlePath /tmp/ui.xcresult CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM=`;
  summarize with `scripts/ui-test-summary.sh /tmp/ui.xcresult`.
- Tests run in DEBUG `OPENCASTER_UITEST=1` mode: public reads are live
  (Haatz), writes are stubbed (signed locally, never sent — no
  `/v1/submitMessage` or `/v1/validateMessage`) and `signIn` is a no-op.
  Never sign in with a recovery phrase or add network writes to tests.
- Query views by `accessibilityIdentifier`; keep identifiers stable.
- CI uploads the `macos-ui-test-results` artifact (`ui.xcresult` +
  `ui-test-summary.txt`) and appends the summary to the job summary.

## Secrets

- The recovery phrase is never stored or logged. Device and custody keys live
  only in the Keychain (`ThisDeviceOnly`).
- Debug hooks must stay inside `#if DEBUG`.
