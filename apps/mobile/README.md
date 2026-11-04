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
yarn install --frozen-lockfile
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

Local content controls hide public FIDs or cast hashes on this device only.
They are saved in a bounded file in ordinary private app data, separate from
the protected device-key store; operating-system backup and restore behavior
can vary. Unreadable or corrupt filters fail closed until retry or explicit
reset, and file writes are not atomic. These filters only change this app's
display; they do not send reports, block network interactions, or delete
content or accounts.

### Reports and support by email

Post cards and profiles offer email reports; Safety and data offers general
support. The recipient is `support@opencaster.org`, with Luis Felipe Abarca as
the responsible operator. The owner confirmed that the inbox receives mail
and will be monitored; this work does not independently establish delivery or
response times.

Users enter a bounded description, review the recipient, subject and public
FID/cast identifiers, and explicitly open their email app. No email is sent
automatically. A successful OS handoff is not a sent/received confirmation.
Selectable review text supports manual copying into webmail when no mail
handler is configured or opening fails. OpenCaster adds no credential, approval
file, account snapshot, log or attachment. The user's description can contain
personal information; the UI warns against secrets and unnecessary private data.
Sending discloses the sender's email address and message to email providers and
the operator. Draft text stays in screen memory, not OpenCaster persistence;
the email client may retain its own draft.

Email contact does not implement network blocking, moderation enforcement,
delivery tracking or an emergency service. Report handling, retention, appeals,
community guidelines and applicable data-request policies still require owner
decisions. Do not call this a completed store-compliant moderation system.

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
| Local content controls | Hide public FIDs or cast hashes on this device; no network block, report or deletion | Bounded storage/controller tests and mobile TypeScript check |
| Native external content | HTTPS links and HTTPS profile/media images | URL-safety tests |
| Device authorization | Explicit identity review, protected local device state, separate offline-signer request/approval and custody-approved revocation | Core state-machine, protected-storage and bounded-transfer tests |
| Scoped social actions | Text posts/replies and like/recast add/remove; explicit confirmation, fresh authorization checks and protected pending receipts | Synthetic controller tests cover confirmation, uncertain restart recovery, no duplicate submission, scopes and cancellation |
| Platform bundles | Metro exports for Android and iOS | `yarn workspace @opencaster/mobile build` |

Automated checks do not constitute visual UI, emulator, device, runtime network,
native compilation, or signed-build verification. This workspace includes native
icon assets, but no approved store listing, distribution credentials or completed
submission configuration.

## Native branding and permissions

App config uses the existing OpenCaster mark for an opaque square iOS/default
icon and separate Android adaptive/monochrome foregrounds. Editable SVG sources
and PNG exports are in `assets/`. Regenerate the ignored native projects with
Expo Prebuild and rebuild both platforms after changing this configuration;
Metro reloads do not update launcher resources or native permissions.

Android explicitly blocks unused legacy external-storage, overlay, vibration and
biometric permissions, including declarations contributed by dependencies.
Approval import uses the system document picker and URI-granted access; transfer
files and local preferences use private app storage. SecureStore remains
encrypted without a biometric prompt. Network permission and AndroidX's
signature-level receiver-protection permission remain necessary. Revisit the
blocked list before intentionally adding a feature that requires one of them.

Check the generated **release** manifest, not only app config or the debug
manifest, before distributing:

```sh
yarn workspace @opencaster/mobile exec expo prebuild --platform android --no-install
cd apps/mobile/android
./gradlew :app:processReleaseMainManifest
```

The merged manifest is under `app/build/intermediates/merged_manifest/release/`.
This task may also bundle release JavaScript, but it does not establish APK
installation, runtime behavior or distribution signing. The generated Gradle
template uses a local debug keystore for its release build type by default;
such an artifact is a **debug-signed release-mode test build**, not a Play-ready
release. Inspect the actual built iOS Release app separately for development-only
metadata, usage descriptions and dependency privacy manifests.

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

The planned distribution uses personal Apple Developer and Google Play accounts,
not Arca Computer organizational accounts. Final identifiers, personal seller
details, signing, privacy disclosures, support/reporting operations and reviewer
access require the responsible owner's decisions. Never commit credentials.
No account or store operation is performed by this workspace.

Local native builds do not require an Expo/EAS account. Hosted EAS builds are
optional and require separately authorized account/project setup. Confirm the
current included/free quota and disable paid overages before any authorized
hosted build; do not infer permission to spend from this configuration. No EAS
build has been started for this milestone.

## Explicitly not ready

- Signed Android or iOS builds, store registration, and store metadata/assets:
  **NOT READY**.
- Store-compliant moderation/report handling, network blocking, data-management
  and reviewer-access workflows: **NOT READY**. Email report/support drafts
  alone do not satisfy these requirements.
- Account-specific Google testing eligibility and test-track requirements:
  **NOT READY**.
- Follow/profile editing, deletion, media uploads and expanded permission flows:
  **NOT INCLUDED** in this increment.
- Changed social-action code still requires its own Android/iOS native fixture
  runtime gate. Prior authorization validation is not proof of changed code.

## Navigation and post controls

The native app opens into **Home**, with **Search** (exact username/FID lookup)
and **You** tabs. You holds account access, local safety/data controls, support
and the detailed preview disclosures. Home keeps a public trending feed rather
than implying a personalized Following feed, notifications or messaging.

Post rows expose reply, recast and like affordances. Reactions load current
state only when their sheet is opened and retain explicit public-write
confirmation. Locked devices are directed to account access. The overflow menu
contains email reporting and device-local hiding; neither is network blocking.
Long text can be expanded. The compose button opens a modal with a discard-draft
confirmation; text limits, review and uncertain-submission recovery are unchanged.

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
