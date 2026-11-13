# Opencaster for macOS

A native macOS client for [Opencaster](https://opencaster.org) — the independent
Hypersnap/Farcaster client — built with SwiftUI. It talks directly to a public
Hypersnap node (`https://haatz.quilibrium.com` by default) instead of the web
client's Cloudflare gateway.

## Layout

```
apps/macos/
  project.yml            XcodeGen spec — regenerate the .xcodeproj from this
  Opencaster/            The SwiftUI app (sign-in, feeds, profiles, composer, settings)
  HypersnapKit/          SwiftPM package with two libraries:
    Sources/HypersnapProtocol/   Pure-Swift port of packages/protocol:
                                 protobuf writer, message builders, BLAKE3,
                                 Keccak-256, BIP-39/32 custody derivation,
                                 EIP-712 KeyAdd/KeyRemove/SignedKeyRequest digests,
                                 Ed25519 device keys (libsodium via swift-sodium)
    Sources/HypersnapAPI/        Codable models + async URLSession client for the
                                 /v1/* and /v2/farcaster/* endpoints the web client uses
    Tests/HypersnapKitTests/     Known-answer vectors + byte-exact golden reproduction
```

## Requirements

- macOS 15+, Xcode 16+ (built with Xcode 27 / Swift 6.4)
- [XcodeGen](https://github.com/yonsm/XcodeGen): `brew install xcodegen`
- An Apple ID in the Developer Program for local signing (team ID is set in
  `project.yml`; Debug uses `Apple Development`, Release uses `Developer ID`)

## Build & run

```sh
cd apps/macos
xcodegen                       # writes Opencaster.xcodeproj (gitignored)
open Opencaster.xcodeproj      # build & run in Xcode, or:
xcodebuild -scheme Opencaster -configuration Debug build
```

Package tests (no network needed — all vectors are hermetic):

```sh
cd apps/macos/HypersnapKit && swift test
```

The key test is `keyAddEnvelopeMatchesGolden()`: it rebuilds the KEY_ADD
message against `packages/protocol/src/keyadd-golden.json` and compares every
byte — the same fixture the TypeScript protocol tests pin.

Opt-in live encoding checks (cast, reply, like) sign with a throwaway,
never-registered key and post only to `/v1/validateMessage`, which validates
without merging — nothing is published:

```sh
cd apps/macos/HypersnapKit && HYPERSNAP_LIVE=1 swift test --filter LiveValidation
```

In the app, **Settings → Dry run** routes every write (casts, reactions,
follows, profile edits) through the same validator instead of
`/v1/submitMessage`, so UI flows can be exercised without posting.

DEBUG builds accept `OPENCASTER_DEBUG_TOAST=<cast hash>` (plus
`OPENCASTER_DEBUG_OPEN=1`) to show the post-publish toast and open its cast
on launch.

## Sign-in model

Unlike the browser client — which never asks for a recovery phrase — the macOS
app derives the custody key locally from your 24-word phrase:

1. Phrase is normalized (NFKD, lowercased, collapsed whitespace) and validated
   as English BIP-39. The phrase itself is **never stored or logged**.
2. Custody key is derived at `m/44'/60'/0'/0/0` (same as the Electron signer).
3. The custody address resolves to your FID via
   `/v2/farcaster/user/custody-address`.
4. A fresh Ed25519 device key is generated and authorized with two EIP-712
   custody signatures (`KeyAdd` + `SignedKeyRequest`, domain `Farcaster KeyAdd`
   v1, chain id 1) — then submitted as a KEY_ADD message to
   `/v1/submitMessage`. No on-chain transaction and no ETH are involved.
5. The session record — FID, custody address, custody key, device seed — is
   stored in the login Keychain, marked `ThisDeviceOnly` and non-synchronizable.
   It never enters iCloud Keychain or another Mac.

Requested signer scopes are the full client set `[1,2,3,4,5,6,11]` (casts,
cast removal, reactions, follows, profile updates) with the standard 7-day
sliding TTL — the same `FULL_CLIENT_SCOPES` the web client uses for its own
expanded-approval flow.

On launch the app restores the Keychain record, then **re-verifies the device
signer is still registered** on the node before activating the session.

**Revoke** (Settings) submits a custody-signed KEY_REMOVE for this device's
signer and clears the Keychain. **Sign out** only clears the local record —
the signer stays registered until it expires or is revoked.

## Working today

- Discover feed (all trending windows), Following feed, channel feeds
- Cast rows with images, links, and quote-embed markers; tap for conversations
- Like / recast / reply / quote / delete (own casts), with optimistic updates
- Profiles: casts/replies/media/likes/recasts tabs, follow/unfollow, profile
  editing (display name, bio, avatar, banner)
- Channels directory, notifications, user + cast search
- Composer: ⌘N or the toolbar pencil, ⌘Return submits, 320-byte limit
- Settings: signer status, sign out, custody-signed revoke

## v1 limitations

- **No image uploads.** Uploads go through the web client's R2 gateway
  (`isUploadedMediaLocation` URLs still render, and profile avatar/banner URLs
  can be pasted as links), but there is no picker-to-R2 path yet.
- No custom feed recipes, mini-apps, or DMs.
- Mentions typed in the composer are sent as plain text; @-resolution and
  cast-embed pickers are not wired yet.
- Search is prefix-ranked top-N (node behavior); it has no pagination.
- The notifications feed is the node's bounded recent-activity scan, not a
  complete historical inbox.
- `resolveCastAlias` (short-hash cast links) is not ported; exact-hash links only.

## Security notes

- The custody key is held in Keychain so Settings → Revoke can sign KEY_REMOVE
  without re-prompting the phrase. If you prefer never retaining it, revoke
  from another Opencaster client and simply sign out here.
- Network traffic is HTTPS to the configured Hypersnap node only. The app
  sandbox is enabled with the network-client entitlement.
- The phrase, raw private keys, and EIP-712 payloads are never logged. Mutable
  key buffers are wiped best-effort after use; Swift strings cannot be reliably
  erased from memory, so closing the app after sign-in is reasonable hygiene.
- Debug builds are signed `Apple Development`; Release builds use
  `Developer ID Application` + hardened runtime for local distribution.
