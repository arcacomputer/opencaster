# Opencaster

**An open source client for everyone. Powered by Arca Computer. Runs on Hypersnap.**

Opencaster is an independent open-source social client for Hypersnap, developed by Arca Computer. Its monorepo contains the browser application in [`apps/web-client/`](apps/web-client/), the offline signer, supporting services and shared packages.

Website: [opencaster.org](https://opencaster.org) · [Source](https://github.com/arcacomputer/opencaster) · [Dev log](https://opencaster.org/devlog)

## Run locally

Use Node 22 and Yarn Classic 1.22. Run Opencaster commands from the repository root:

```sh
yarn install --frozen-lockfile
yarn dev
# Verify Opencaster, including the Worker and offline signer:
yarn verify
```

## What Opencaster offers

Browse public profiles, casts, conversations, channels and search without connecting a wallet. Create and share custom feed recipes, and save feeds, bookmarks and content preferences in this browser. Connect an existing custody wallet to publish, react, view recent notifications and use other supported account features through the fixed Hypersnap gateway.

Wallet approval uses a compatible browser extension, optional WalletConnect or the offline signing companion to authorize a scoped device key. **The website never asks for recovery phrases.** Optional passkeys or password encryption protect saved device keys in this browser. See the [application guide](apps/web-client/README.md) and [feature support matrix](apps/web-client/FEATURE_SUPPORT.md) for supported behavior, permissions and limits.

Opencaster relies on Hypersnap's available indexes and the configured gateway infrastructure. Browser-local saves do not sync across devices. Account creation, DMs, push notifications, video uploads and mini-app execution are outside the current client. The application remains a beta; see the [verification records](apps/web-client/VERIFICATION.md) for dated checks and coverage limits.

## Project documentation

| Guide | Contents |
| --- | --- |
| [Application README](apps/web-client/README.md) | Setup, architecture, supported behavior, deployment and release checklist. |
| [Contributor and agent guidance](AGENTS.md) | Application boundaries, Yarn commands, verification and attribution rules. |
| [Feature support](apps/web-client/FEATURE_SUPPORT.md) | Implemented behavior and Hypersnap limitations. |
| [Signing](apps/web-client/SIGNER.md) and [offline companion](apps/signer/README.md) | Wallet approval, saved device keys and offline signing. |
| [Media](apps/web-client/MEDIA.md), [private origin](apps/web-client/PRIVATE_ORIGIN.md) and [observability](apps/web-client/OBSERVABILITY.md) | Gateway, storage, availability and operational boundaries. |
| [Verification](apps/web-client/VERIFICATION.md) | Recorded automated, browser and isolated-network checks. |

This repository uses Yarn Classic workspaces with one root lockfile. Install dependencies and run the full verification gate from the repository root. `yarn dev` starts the web client; `yarn build` checks the shared packages and services and builds the web client and signer. `yarn test` runs tests across the monorepo. `yarn verify` runs the tests and full build. Existing `yarn signer:*` and `yarn analytics:report` commands remain available at the root.

| Workspace | Purpose |
| --- | --- |
| [`apps/web-client/`](apps/web-client/) | React browser client, assets and browser test harnesses. |
| [`apps/signer/`](apps/signer/) | Offline Electron signing companion. |
| [`services/gateway/`](services/gateway/) | Cloudflare API gateway, media storage, social previews and request measurements. |
| [`services/analytics/`](services/analytics/) | Private operator dashboard and local report tool. |
| [`packages/protocol/`](packages/protocol/) | Shared wire encoding and signing primitives. |
| [`packages/client-core/`](packages/client-core/) | Shared API, content, routes, pairing and media contracts. |
| [`packages/web-ui/`](packages/web-ui/) | Browser UI primitives shared by the web client and signer. |

For a workspace-only command, use `yarn workspace @opencaster/web-client dev` or the corresponding workspace name. Mobile and desktop social clients can be added under `apps/` when development begins; this migration adds no new platform client. Follow the repository [release rules](AGENTS.md#releases).

The earlier Quorum messenger application and its development records are available in Git history and the [upstream repository](https://github.com/QuilibriumNetwork/quorum-desktop). They are no longer part of the current source tree.

## Existing users of quorum.arca.computer

The move from quorum.arca.computer preserves public profile/cast paths and published media links. Browser-local saved keys, passkeys, drafts, bookmarks and preferences remain tied to their original origin; reconnect your wallet and set up optional device saving on the new website. Existing network authorizations are not silently revoked or transferred.

## Origins and attribution

Opencaster originated as a fork of [Quorum Desktop](https://github.com/QuilibriumNetwork/quorum-desktop) and now develops independently as a social client for Hypersnap. Quorum's original messenger source and development records remain available in Git history and upstream. Its attribution and AGPL license are preserved. Its visual foundations inform Opencaster's local UI primitives and theme tokens; adapted MIT-licensed Quorum Shared protocol modules retain their notices. See the [application's origins and attribution](apps/web-client/README.md#origins-and-attribution) for details and the Farcaster UX reference credit. Opencaster is not an official Quorum or Farcaster release.

## License

Opencaster's application code, including its Quorum-derived code, remains under [AGPL-3.0](LICENSE). Bundled third-party components retain their own licenses. Optional WalletConnect uses its own Community License, which is not an OSI open-source license; see [third-party notices](apps/web-client/THIRD_PARTY_NOTICES.md) and [component licenses](apps/web-client/README.md#component-licenses).
