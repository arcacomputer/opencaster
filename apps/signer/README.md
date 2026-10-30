# Arca Signer

A local Electron companion for authorizing or revoking an Opencaster Hypersnap browser posting key. The website never asks for a recovery phrase. The native app imports a public request JSON, derives the custody wallet from exactly 24 BIP39 English words, checks its address, signs only the requested Hypersnap EIP-712 operation, and exports public approval JSON. It never creates a custody-wallet transaction.

## Use

The current [Arca Signer v0.2.2 download](https://github.com/arcacomputer/opencaster/releases/tag/arca-signer-v0.2.2) is a Developer ID–signed beta for macOS Apple Silicon, built with Electron 44.9.1. Apple notarization remains pending. Verify the attached checksum and code signature before use.

1. In Opencaster, enter your FID and download a browser pairing request.
2. Open Arca Signer and use **Import request JSON**. No recovery phrase is needed for this step.
3. Compare the full posting public key, account, and custody address between the browser and native app. Review the permissions and lifetime.
4. Enter the 24 words in Arca Signer and approve. Save the public approval JSON.
5. Import the approval into the same browser tab. Close Arca Signer afterward.

The native app intentionally does not use a localhost server, a wallet connection relay, clipboard secret transfer, browser extensions, custom URL handlers, or remote code. Both file dialogs are native OS dialogs. A renderer cannot select an arbitrary read or write path through IPC.

## What approval grants

The only accepted scopes are `CAST_ADD`, `REACTION_ADD`, and `REACTION_REMOVE` (`[1, 3, 4]`), for casts, replies, likes, and recasts. The signer inactivity TTL is seven days. **This is a sliding inactivity window, not a fixed seven-day expiration.** Posting activity can keep the key active. Revoke it through the network authorization controls when the browser is no longer trusted; deleting local browser data is not revocation.

The request is valid for 15 minutes. Its nonce, FID, Ed25519 posting key, permission scopes, deadline, and TTL are bound by the custody signature. The second signature authorizes the Hypersnap signed-key-request metadata. All fields are validated again immediately before signing. The derivation path is `m/44'/60'/0'/0/0`; alternate paths and optional BIP39 passphrases are not supported by this release.

## Revoke a browser

Select **Revoke this device** in the browser and download its revocation request. Import that JSON into Arca Signer. Its review displays **REVOKE POSTING KEY**, the target account and full key, and an explicit removal confirmation. It grants no new permissions. Enter the matching 24-word phrase, sign the revocation, save the approval JSON and import it back into the same browser. **Access ends only after the browser submits the signed removal and confirms it on the network.** The offline app cannot submit or confirm revocation.

Revocation uses distinct `arca.hypersnap.signer.revoke.request` and `.revoke.approval` transfer types. Its request has no scopes or TTL. The only signature is a custody `KEY_REMOVE` EIP-712 signature over the FID, key, nonce and deadline; the approval strictly fixes `signatureType: 1`. Grant signatures cannot authorize removal and revocation signatures cannot authorize a grant. Both flows enforce the same request size, clock, origin-display and account matching rules.

## Origin limitation

The claimed website in a request is **self asserted**. Only `https://opencaster.org`, the legacy `https://quorum.arca.computer` and the current Cloudflare preview origin are accepted as display values, but any file author can write either name. The Hypersnap signature schema has no website-origin field. An offline app cannot determine which website actually created a JSON file or confirm the FID's live registry record. Compare the entire posting public key and intended custody address with the browser. The request SHA-256 binds the response to the browser's pending request; it is not a publisher signature or proof of website identity.

## Code and storage boundary

- `main.ts` owns the imported request and any approval. It reads a bounded, user-selected JSON file and returns only a public display object to the renderer. IPC calls accept a fixed schema, check the exact main-frame sender, and do not expose filesystem, shell, or generic signing methods.
- `approve.ts` derives and signs in the main process, importing `@opencaster/protocol` and the pairing contracts in `@opencaster/client-core`. It has no network or storage calls. Mutable seed and HD-key buffers are wiped in `finally` on both success and failure.
- `preload.ts` exposes five explicit methods through `contextBridge` with context isolation, sandboxing, and Node integration disabled in the renderer.
- `renderer.tsx` uses locally bundled React and Opencaster's shared `@opencaster/web-ui` primitives. The recovery phrase stays in an uncontrolled password input until submission; the input is cleared before IPC and after every result. It is never put in React state, storage, logs, approval JSON, or a clipboard API.
- The private, nonpersistent Electron session uses the custom `arca-signer://app` origin, with a protocol handler serving only four exact bundled assets. It grants no `file://` filesystem privileges, blocks other local files and remote requests, and denies popups, navigation, redirects, webviews, permissions, device permissions, and renderer downloads. The CSP additionally denies connections, frames, workers, and form submission. Production builds disable developer tools. There are no analytics, crash reports, telemetry, or automatic updates.

JavaScript strings, IPC copies, crypto-library temporaries, and operating-system memory cannot be reliably erased. Clearing mutable buffers is best effort. Close the app after use. A compromised computer, operating system, release binary, or dependency can still expose the recovery phrase. **An independent security audit has not been completed.** A signed download identifies its publisher and detects modification; it does not prove the code is secure or that the build is reproducible.

## Build and verification

Use Node 22 and Yarn 1.22 from the repository root. Dependencies are pinned through the single root lockfile. This workspace is named `@opencaster/signer`.

```sh
yarn install --frozen-lockfile
yarn test apps/signer/approve.test.ts
yarn signer:build
yarn signer:package
```

The release scripts at [`scripts/`](scripts/) are authoritative for packaging, code signing, checksums, and release output. The build bundles `main.ts` as CommonJS with only `electron` external, `preload.ts` as sandbox-compatible CommonJS, and `renderer.tsx` as a browser IIFE using the automatic JSX runtime and production React. It copies `index.html`, `style.css`, and the local `quorum-symbol.svg`. The payload and its manifest are written to `apps/signer/dist-signer/`; release packaging writes to `apps/signer/release/`. No remote assets or source maps are required at runtime.

Before using a binary, verify its release checksum and OS code signature against the expected publisher. Review the corresponding source release. A first-party release and test results do not replace an independent audit. Tests use synthetic, all-zero BIP39 entropy and do not submit any real-account authorization.
