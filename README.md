# Opencaster

**An open source client for everyone. Powered by Arca Computer. Runs on Hypersnap.**

Opencaster is an independent open-source social client for Hypersnap, developed by Arca Computer. Its browser application has its own product direction, dependencies, build and release process. The active application lives in [`hypersnap/`](hypersnap/).

Website: [opencaster.org](https://opencaster.org) · [Source](https://github.com/arcacomputer/opencaster) · [Dev log](https://opencaster.org/devlog)

## Run locally

Use Node 22 and Yarn Classic 1.22. Run Opencaster commands from `hypersnap/`:

```sh
cd hypersnap
yarn install --frozen-lockfile
yarn dev
# Verify Opencaster, including the Worker and offline signer:
yarn verify
```

## What Opencaster offers

Browse public profiles, casts, conversations, channels and search without connecting a wallet. Create and share custom feed recipes, and save feeds, bookmarks and content preferences in this browser. Connect an existing custody wallet to publish, react, view recent notifications and use other supported account features through the fixed Hypersnap gateway.

Wallet approval uses a compatible browser extension, optional WalletConnect or the offline signing companion to authorize a scoped device key. **The website never asks for recovery phrases.** Optional passkeys or password encryption protect saved device keys in this browser. See the [application guide](hypersnap/README.md) and [feature support matrix](hypersnap/FEATURE_SUPPORT.md) for supported behavior, permissions and limits.

Opencaster relies on Hypersnap's available indexes and the configured gateway infrastructure. Browser-local saves do not sync across devices. Account creation, DMs, push notifications, video uploads and mini-app execution are outside the current client. The application remains a beta; see the [verification records](hypersnap/VERIFICATION.md) for dated checks and coverage limits.

## Project documentation

| Guide | Contents |
| --- | --- |
| [Application README](hypersnap/README.md) | Setup, architecture, supported behavior, deployment and release checklist. |
| [Contributor and agent guidance](AGENTS.md) | Application boundaries, Yarn commands, verification and attribution rules. |
| [Feature support](hypersnap/FEATURE_SUPPORT.md) | Implemented behavior and Hypersnap limitations. |
| [Signing](hypersnap/SIGNER.md) and [offline companion](hypersnap/signer/README.md) | Wallet approval, saved device keys and offline signing. |
| [Media](hypersnap/MEDIA.md), [private origin](hypersnap/PRIVATE_ORIGIN.md) and [observability](hypersnap/OBSERVABILITY.md) | Gateway, storage, availability and operational boundaries. |
| [Verification](hypersnap/VERIFICATION.md) | Recorded automated, browser and isolated-network checks. |

This repository contains Opencaster and the services and tools that support it. The React client, Cloudflare gateway, media service, operator analytics and optional offline signer live in `hypersnap/`. The small root package forwards development and verification commands to that application. Follow the [release rules](hypersnap/AGENTS.md).

The earlier Quorum messenger application and its development records are available in Git history and the [upstream repository](https://github.com/QuilibriumNetwork/quorum-desktop). They are no longer part of the current source tree.

## Existing users of quorum.arca.computer

The move from quorum.arca.computer preserves public profile/cast paths and published media links. Browser-local saved keys, passkeys, drafts, bookmarks and preferences remain tied to their original origin; reconnect your wallet and set up optional device saving on the new website. Existing network authorizations are not silently revoked or transferred.

## Origins and attribution

Opencaster originated as a fork of [Quorum Desktop](https://github.com/QuilibriumNetwork/quorum-desktop) and now develops independently as a social client for Hypersnap. Quorum's original messenger source and development records remain available in Git history and upstream. Its attribution and AGPL license are preserved. Its visual foundations inform Opencaster's local UI primitives and theme tokens; adapted MIT-licensed Quorum Shared protocol modules retain their notices. See the [application's origins and attribution](hypersnap/README.md#origins-and-attribution) for details and the Farcaster UX reference credit. Opencaster is not an official Quorum or Farcaster release.

## License

Opencaster's application code, including its Quorum-derived code, remains under [AGPL-3.0](LICENSE). Bundled third-party components retain their own licenses. Optional WalletConnect uses its own Community License, which is not an OSI open-source license; see [third-party notices](hypersnap/THIRD_PARTY_NOTICES.md) and [component licenses](hypersnap/README.md#component-licenses).
