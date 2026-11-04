# OpenCaster mobile preview

This is a native Expo / React Native public-browsing preview for Android and iOS.
It is a separate workspace from the browser client; it does not embed the web UI
or use a WebView. The package is covered by the repository's AGPL-3.0-only
license and preserves the upstream attribution in the root project.

## Local commands

Use Node 22, Yarn 1.22, and the single root lockfile:

```sh
source ~/.nvm/nvm.sh
nvm use 22
yarn install
yarn workspace @opencaster/mobile start
yarn workspace @opencaster/mobile android
yarn workspace @opencaster/mobile ios
yarn workspace @opencaster/mobile typecheck
yarn workspace @opencaster/mobile test
yarn workspace @opencaster/mobile build
```

`build` typechecks and exports Android and iOS JavaScript bundles to the ignored
`apps/mobile/dist/` directory. The Expo dependency compatibility check is:

```sh
yarn workspace @opencaster/mobile exec expo install --check
```

The focused app and shared API tests can also be run from the root:

```sh
yarn test apps/mobile packages/client-core/src/apiBase.test.ts packages/client-core/src/api.test.ts
yarn verify
```

For a local Android native debug build, install Android Studio, its Android SDK
platform/build tools and platform-tools (`adb`), and Java 17. Generate the
ignored native project and compile it with:

```sh
yarn workspace @opencaster/mobile exec expo prebuild --platform android --no-install
cd apps/mobile/android
./gradlew :app:assembleDebug
```

Local iOS builds require macOS, Xcode and its command-line tools, and the
compatible CocoaPods installation. `yarn workspace @opencaster/mobile ios`
uses the local Xcode toolchain. No iOS toolchain is available on Linux.

## Public API boundary

Screens read public data only through `getFeed`, `getUser`, `getProfileFeed`,
and `getConversation`, with `Cast` and `User` from
`@opencaster/client-core/api`. The native API adapter resolves the shared
client's base URL to `https://opencaster.org/api`; browser clients continue to
use their existing `/api` route. There is no direct Farcaster/Neynar service,
alternative feed, or fallback. Only HTTPS links from public cast text are
opened, and remote profile/media images are restricted to HTTPS URLs.

This preview displays public feed/profile/conversation data where the existing
Hypersnap-backed index makes it available. The index may be incomplete or
unavailable. It also includes a protected device-authorization flow that uses a
separate offline signer and custody-approved public request files. The app never
imports custody wallet keys or recovery phrases, has no in-app wallet transport,
and includes text posts, replies, likes and recasts using the existing device
permissions. Text is limited to 320 UTF-8 bytes; attachments and tagged mentions
are not included in this increment.

The request grants exactly cast/reply creation and reaction add/remove scopes
(`[1, 3, 4]`) with a 15-minute approval deadline and a seven-day **sliding
inactivity** window, not a fixed expiry. Device data uses Expo SecureStore with
device-only keychain accessibility, no biometric prompt, and Android backup
exclusion; this is protected storage, not a claim of hardware-backed Ed25519
keys. Locking drops active access, local forgetting does not revoke a network
key, and network revocation requires its separate custody-approved request and
confirmed key absence.

## Feature and validation matrix

| Area | Foundation | Automated validation |
| --- | --- | --- |
| Trending | 1-hour, default 24-hour, and 7-day public feeds; pull-to-refresh and bounded pagination | Reader tests cover duplicate hashes, repeated cursors, cancellation, pagination retry, and page limits |
| Profile lookup | Search by numeric FID or username and open the public profile | Shared API tests and mobile TypeScript check |
| Public profile | Public identity details and paginated casts | Shared API tests and mobile TypeScript check |
| Conversation | Selected cast and available nested replies, with indentation capped at five levels | Mobile TypeScript check |
| Native external content | HTTPS links and HTTPS profile/media images | URL-safety tests |
| Device authorization | Explicit identity review, protected local device state, separate offline-signer request/approval and custody-approved revocation | Core state-machine, protected-storage and bounded-transfer tests |
| Scoped social actions | Text posts/replies and like/recast add/remove; explicit confirmation, fresh authorization checks and protected pending receipts | Synthetic controller tests cover confirmation, uncertain restart recovery, no duplicate submission, scopes and cancellation |
| Platform bundles | Metro exports for Android and iOS | `yarn workspace @opencaster/mobile build` |

Automated checks do not constitute visual UI, emulator, device, runtime network,
native compilation, or signed-build verification. There are no store assets or
release credentials in this workspace.

## Dependencies and licensing

Direct runtime dependencies and their declared licenses:

| Dependency | License |
| --- | --- |
| `@noble/curves` | MIT |
| `expo` | MIT |
| `expo-crypto` | MIT |
| `expo-dev-client` | MIT |
| `expo-document-picker` | MIT |
| `expo-file-system` | MIT |
| `expo-secure-store` | MIT |
| `expo-sharing` | MIT |
| `react` | MIT |
| `react-native` | MIT |
| `@react-navigation/native` | MIT |
| `@react-navigation/native-stack` | MIT |
| `@react-navigation/elements` | MIT |
| `react-native-keyboard-controller` | MIT |
| `react-native-reanimated` | MIT |
| `react-native-worklets` | MIT |
| `react-native-safe-area-context` | MIT |
| `react-native-screens` | MIT |
| `@opencaster/client-core` | AGPL-3.0-only |
| `@opencaster/protocol` | AGPL-3.0-only |

Direct development tooling uses `@babel/core` (MIT), `@types/react` (MIT),
and TypeScript (Apache-2.0). Transitive packages are resolved in the root
`yarn.lock` and should be reviewed as part of any future redistribution or
licensing review.

The composer uses Expo SDK-compatible Keyboard Controller with Reanimated and
Worklets to follow native keyboard height changes, including switching to a
taller emoji panel. `KeyboardProvider` is mounted without automatic keyboard
preloading. Adding or changing these native dependencies requires rebuilding
both Android and iOS; a Metro reload alone is insufficient. Expo's Babel preset
configures the Worklets plugin automatically.

## Future account and store setup — manual work only

The Android package ID and iOS bundle ID are both the provisional
`org.opencaster.app`. They are not registered, and their availability is not
claimed. Confirm and approve final identifiers before registering either app
or creating signing assets. The `development`, `preview`, and `production`
EAS profiles do not configure an owner, project ID, submission, auto-submit,
update channel, or credentials.

When a maintainer is ready to proceed, they will need to choose and manually
configure their own Expo/EAS account and project, Apple Developer team and
bundle registration, Android signing and Play Console account, app privacy and
store materials, and required platform credentials. Never commit those
credentials. No account or store operation is performed by this workspace.

Expo's EAS Free plan currently lists 15 Android and 15 iOS build jobs per month
at low queue priority; builds stop when the free quota is exhausted, with no
overage charge or automatic paid purchase. Recheck the vendor's current plan
limits before scheduling builds. No EAS build has been started for this
milestone.

## Explicitly not ready

- Signed Android or iOS builds, store registration, and store metadata/assets:
  **NOT READY**.
- Moderation, reporting, blocking, data-management, or reviewer-access
  workflows: **NOT READY**.
- Account-specific Google testing eligibility and test-track requirements:
  **NOT READY**.
- Follow/profile editing, deletion, media uploads and expanded permission flows:
  **NOT INCLUDED** in this increment.
- Changed social-action code still requires its own Android/iOS native fixture
  runtime gate. Prior authorization validation is not proof of changed code.

## Submission recovery

A bounded public receipt (hash, timestamp and target/intent, not draft text) is
saved inside the protected device record before each social submission. A single
unresolved action blocks further social writes, including after process restart.
Use **Check submission status** to read the matching cast/FID or current reaction
state; it never replays the signed message. An HTTP acknowledgement alone is not
success. Status may remain unknown indefinitely after a lost request, delayed
indexing, or a subsequently removed cast/reaction. Local forgetting discards
receipt tracking but cannot retract a potentially submitted message; neither does
key revocation. There is no automatic retry after lock, relaunch or reconnection.
