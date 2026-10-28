# Arca Signer beta

The website never asks for your recovery phrase. Use a compatible wallet app to approve a limited posting key; your custody key stays in that wallet. The optional offline signer can approve the original casting key and device revocation requests. Expanded social and deletion permissions use your wallet. Neither approach makes an unaudited app or compromised computer safe. No independent security audit has been completed.

## Connect with a wallet app

1. Open `https://opencaster.org/connect` in the browser you want to use. Enter a public username, ENS/Base name, FID or exact custody wallet address, then choose **Find my account**. The dedicated page shows the same complete username/FID/custody summary for every input. `name.eth` and `name.base.eth` must already have a name proof linked to an account in Hypersnap; a name's Ethereum wallet record alone is insufficient. Current name labels are limited to 1–16 ASCII letters, digits or hyphens, starting with a letter or digit. A username missing from the node is labeled unavailable; it is not invented from the FID. Choose **Use this account** after reviewing it. Lookup alone requests no wallet permissions and creates no device key.
2. If your Farcaster custody wallet is not already in your chosen wallet, import its 24-word phrase **inside the wallet's own import screen**. Never paste it into this website. Use the wallet's add/import flow rather than resetting an existing wallet. Check the wallet's own backup and cloud-sync settings before importing.
3. Opencaster checks the account again before preparing approval. Changed account details require a fresh review. Select the imported custody address in the wallet; a different verified address cannot approve this account. Under **Browser wallet**, select your extension and choose its connect/approve button. All discovered compatible providers are available, including Coinbase Wallet and Rainbow; several extensions require an explicit choice. If one is missing, unlock/enable it, allow it to access this site and choose **Refresh browser wallets**. The embedded preview browser cannot access extensions installed in Chrome. For a separate mobile wallet, choose **Connect wallet app** for WalletConnect: scan the QR code from another device, or tap your installed wallet on the same phone. Keep the browser tab open. Opening a different browser starts a separate device session.
4. Review the browser's permissions, approval deadline and inactivity lifetime. **Device key and protocol details** exposes the full fingerprint and request checksum. Choose your wallet and approve the two typed signing requests: `KeyAdd`, then `SignedKeyRequest`. On mobile, return to the browser between prompts and use **Open wallet to approve** again if the phone does not switch automatically.
5. The website verifies both signatures against the custody address. Select **Submit approved device key** to register the posting key on Hypersnap. One signature alone does not finish approval, and signing alone does not submit it. This flow creates no Ethereum transaction, NFT, token approval or asset transfer. Future casts and reactions use that limited device key, with optional passkey- or password-encrypted local storage.

Back or leaving the page cancels the local attempt and ignores late approval results. It cannot retract an already submitted network authorization or close a wallet's own popup. Reload starts the page with ordinary casting/reaction permissions; broader permission requests are held only in the initiating tab's memory. After a permission upgrade, the previous account session is replaced only by a confirmed key for that same FID.

If the extension exposes an everyday wallet instead of the imported Farcaster custody account, choose the matching account inside the wallet and review its connected-site controls before retrying. Coinbase documents its imported-wallet selector in its [extension help](https://help.coinbase.com/en/wallet/browser-extension/coinbase-wallet-extension). Reconnecting may reuse already authorized accounts; the site does not depend on an account-picker RPC. If a request is pending, **Cancel wallet approval** stops this site's attempt and ignores late results. Finish or reject the wallet's open prompt before using **Retry**; cancellation here cannot close the extension popup. An expired request must be replaced with a fresh request.

Direct browser connections use standard EIP-1193 requests and EIP-6963 discovery, with bounded legacy discovery for older extensions. Coinbase's public SDK documents the [direct extension namespace](https://github.com/coinbase/coinbase-wallet-sdk/blob/v4.3.4/packages/wallet-sdk/src/util/provider.ts#L30) and [historical WalletLink alias](https://github.com/coinbase/coinbase-wallet-sdk/blob/v3.9.1/packages/wallet-sdk/src/CoinbaseWalletSDK.ts#L213). Providers are deduplicated by object identity; metadata changes cannot replace an already selected provider. Wallet providers and their supplied names are not authenticated by discovery; choose software you trust. A malicious extension can impersonate another wallet. The optional WalletConnect route connects a separate wallet app through Reown's external relay; it needs a configured public project ID. Neither route uses a Farcaster sign-in service.

The mobile app buttons include MetaMask, Trust Wallet, and Rainbow. Rainbow uses its [official universal WalletConnect link](https://github.com/rainbow-me/rainbowkit/blob/main/packages/rainbowkit/src/wallets/walletConnectors/rainbowWallet/rainbowWallet.ts) for pairing and `rainbow://wc` to reopen pending signature requests. On desktop, Rainbow can scan the same WalletConnect QR code; its compatible extension is discovered through the browser wallet option. The project owner reported successful Rainbow browser-extension sign-in. Agent tests have not signed real account actions, and physical mobile wallet/browser combinations still require device testing.

### Optional social permissions

Ordinary sign-in requests only `CAST_ADD`, `REACTION_ADD`, and `REACTION_REMOVE` (`[1, 3, 4]`). These allow casts, replies, explicitly selected account mentions, cast image attachments, cast-ID quote embeds, and channel posts. A channel post sets the protocol's parent URL; a reply uses a parent cast ID instead. These destinations are mutually exclusive. A quote consumes one of the client's two embed slots. Public profiles, cast links, nested conversations, follower/following lists, notifications, search, channels, and sharing do not require expanded signing permissions.

Following/unfollowing and editing your display name, bio, or profile image require `LINK_ADD`, `LINK_REMOVE`, and `USER_DATA_ADD` as well. Choosing these features opens an explicit **Enable social features** flow for a new key with scopes `[1, 3, 4, 5, 6, 11]`; review the expanded permission list in the browser and wallet before approving. The currently connected key remains active until the new key is confirmed. Replacing the active local session does not revoke the previous key on Hypersnap; manage that old authorization separately. The inactivity lifetime remains seven days, renewed by activity.

Deleting your own casts additionally requires `CAST_REMOVE` (`2`). Choosing **Enable deletion** opens a separate **Enable cast deletion** approval for scopes `[1, 2, 3, 4, 5, 6, 11]`, with the irreversible deletion permission displayed in the browser and bound into the wallet signature. Existing casting and social keys retain their original permissions; they cannot acquire deletion permission by unlocking an old vault. Approving a new key does not submit a cast deletion: return to the deletion dialog and explicitly confirm the cast.

Before signing `CAST_REMOVE`, the client checks that the target FID matches the active account, reloads the cast from Hypersnap, verifies its author and exact hash, and rechecks custody and the device's current signer permissions. A successful mempool submission does not complete the UI action. The client waits up to 45 seconds for the cast API's verified `Cast not found` result; network failures, other HTTP 404 responses, and indexing delays leave the result uncertain. **Check deletion status** performs reads using the same session and never replays the uncertain write. A changed account or device invalidates an in-progress dialog. A definite rejection may be retried explicitly. Deletion cannot be undone in the client, other nodes may update later, and previously copied content, quotes, or screenshots can remain. Deleting a cast does not delete its uploaded images from R2.

The profile editor exposes only display name, bio, and profile image. Banner writes are excluded because the node requires Pro status and does not reliably hydrate banner metadata. Each edited field is a separate signed message, so a partial save can succeed for some fields. Confirmed successes are retained. If the node response is uncertain, the client blocks replay of that field until a public-profile check observes its attempted value. **Check public profile** also works after closing and reopening the editor. Follow changes have a similar uncertainty check; no failed write is automatically resubmitted.

Image uploads use the active device key to sign a domain-separated authorization bound to the exact image hash, size, content type, origin, FID, nonce, and short expiry. This grants one upload, not an arbitrary signing request, and requires no new custody-wallet signature. The Worker checks the current Hypersnap signer and enforces image limits, replay protection, and daily quotas using R2 and a SQLite Durable Object. Images are public and persistent; original photo metadata, including EXIF, is retained. Removing an attachment from a draft does not delete the uploaded file. See [MEDIA.md](MEDIA.md) for storage, quotas, and retention.

### WalletConnect privacy and connection lifetime

WalletConnect encrypts messages between the browser and wallet. Recovery phrases and custody private keys stay in the wallet. Encryption does not hide routing metadata: the relay can observe connection IPs, project/client identifiers, random topics, message sizes, timing, and protocol tags. Verify can receive the site's origin and message identifiers for domain attestation. Reown's [privacy policy](https://reown.com/privacy-policy) also describes data collected across its broader services; do not treat encrypted transport as anonymity.

The connection requests Ethereum Mainnet typed-data signing only. It does not request transfers, swaps, social/email authentication, or blockchain balance queries. The site uses the minimal SignClient library, locally generated QR codes, and reviewed wallet-opening links rather than AppKit. The WalletConnect session and pairing are disconnected after the signing attempt finishes or is cancelled; the browser's separate posting key remains subject to the Hypersnap authorization you approved. Reject a prompt left open in the wallet if you cancel here. Closing a website cannot force a wallet app to close its own prompt.

The pairing QR/link includes an ephemeral encryption secret. Share it only with your intended wallet. Never post it to support, chat, issue reports, logs, or public screenshots. Approval signatures are verified locally against the exact custody address and request before any Hypersnap message is submitted.

### WalletConnect deployment and license

Set `VITE_WALLETCONNECT_PROJECT_ID` at build time, using the public ID from your own [Reown Dashboard project](https://dashboard.reown.com). The value is intentionally visible in the built website. Set exact domain allowlists for production and any preview origin you deploy; no Dashboard API secret belongs in frontend configuration. Leave social/email login, Reown-hosted authentication, payments, swaps, and event tracking disabled for this signing-only integration. See [project settings](https://docs.reown.com/cloud/dashboard-configuration-settings).

The pinned `@walletconnect/sign-client` 2.26.0 is distributed under the [WalletConnect Community License](licenses/walletconnect-2.26.0-LICENSE.md). The project owner approved using it and the encrypted external relay. This is a separately licensed bundled component, and Opencaster application code remains AGPL. The license includes redistribution/attribution obligations, required Reown network connectivity, and commercial thresholds of 500 monthly active users or 2,500,000 monthly RPCs, subject to its terms and current service conditions. It must not be described as Apache-licensed or wholly open-source software. Operators of forks should review the included license before distributing or operating their build.

For this pinned SDK, the connection allowlist covers:

| Endpoint | Purpose |
| --- | --- |
| `wss://relay.walletconnect.org` | Default encrypted WalletConnect messaging relay. |
| `https://verify.walletconnect.org` | Verify domain-attestation iframe and attestation/public-key requests. |
| `https://verify.walletconnect.com` | SDK-trusted alternate Verify host. |

SDK telemetry is disabled; `https://pulse.walletconnect.org/batch` is the SDK's telemetry destination and is not needed for this integration. Website scripts, styles, fonts, wallet links and QR generation remain locally bundled. The Verify iframe is external content in its own origin. This list describes the browser-side integration, not every endpoint contacted independently by a user's wallet app.

These endpoints and defaults are documented in the [pinned relay constants](https://github.com/WalletConnect/walletconnect-monorepo/blob/63094dcb6fded05dcbc2b08b8895ada75a31dcb5/packages/core/src/constants/relayer.ts), [Verify implementation](https://github.com/WalletConnect/walletconnect-monorepo/blob/63094dcb6fded05dcbc2b08b8895ada75a31dcb5/packages/core/src/controllers/verify.ts), and [telemetry implementation](https://github.com/WalletConnect/walletconnect-monorepo/blob/63094dcb6fded05dcbc2b08b8895ada75a31dcb5/packages/core/src/controllers/events.ts). Re-test network traffic and CSP after SDK upgrades; the much broader AppKit CSP is not the specification for this integration.

MetaMask is one compatible example, not a requirement. Its [official import guide](https://support.metamask.io/start/use-an-existing-wallet/) supports 12- and 24-word English wallets on extension and mobile; its [mobile browser guide](https://support.metamask.io/configure/wallet/how-to-use-the-metamask-mobile-browser/) explains opening dapps inside the app. Instances linked to Google, Apple, or Telegram may link/sync newly imported wallets, so review those settings if you want local-only custody. MetaMask's current mobile license is source-available, not an open-source license. Our adapter is open-source and allows other compatible wallets.

Brave Wallet offers an open-source alternative: Brave documents [wallet discovery on desktop, iOS and Android](https://brave.com/blog/eip-6963/), [typed-data signing](https://wallet-docs.brave.com/ethereum/use-cases/signing-data/), and [12–24-word wallet import](https://support.brave.com/hc/en-us/articles/12759132380173-Import-an-existing-wallet-into-Brave-Wallet). Its core is [MPL-2.0 licensed](https://github.com/brave/brave-core/blob/master/LICENSE). Check its current import guidance before using an existing populated wallet; use a separate browser profile or fresh wallet instance if necessary. Do not reset another wallet to connect here. Brave's provider is unavailable until its wallet is configured, and is unavailable in private/Tor windows.

These requests authorize a Hypersnap posting key and involve no app-requested transaction or gas payment. The protocol's required domain is `Farcaster KeyAdd`, version `1`, chain ID `1`; the historical name does not route through Farcaster's servers. A wallet must support `eth_signTypedData_v4` for the matching Ethereum account. Smart-contract custody wallets, hardware wallets with incompatible typed-data support, alternate derivation paths, and every wallet/browser combination are not guaranteed to work. Rejected or mismatched signatures fail closed.

Select **Ethereum Mainnet** in the wallet before approving: some wallets require their selected network to match the signed domain. No ETH balance or on-chain transaction is required by this flow. The app does not switch networks automatically.

## Optional offline desktop approval

1. Open [Opencaster](https://opencaster.org). Look up your public username, FID, or custody address.
2. Download the public authorization request. Keep that browser tab open: its random posting key stays there.
3. Download [Arca Signer v0.2.1](https://github.com/arcacomputer/opencaster/releases/tag/arca-signer-v0.2.1). The supplied binary is for Apple Silicon Macs. Other platforms can build the source.
4. Check the release's SHA-256 checksum and Developer ID signature. You may disconnect your computer from the network before opening the signer.
5. Import the request into Arca Signer. Compare the FID, custody address, complete posting key, request checksum, and permissions with the browser. Requests expire after 15 minutes. The displayed website name is self-asserted, not proof of who created the request.
6. Enter the matching 24-word English phrase only in the native app. Export the public approval, clear the app, and quit.
7. Reconnect if needed. Import the approval into the same browser tab and approve registration. No phrase or custody private key is in either transfer file.

The posting key can create casts and add/remove reactions. Its seven-day inactivity window is refreshed when it is used; it does not expire seven days after sign-in. It cannot transfer funds or change custody through these permitted Hypersnap message types. Hypersnap protocol rules and node software enforce those limits.

Arca Signer v0.2.1 adds the Opencaster website to its exact origin display allowlist and retains the original `[1, 3, 4]` permission set. It cannot approve expanded social or deletion keys. Use a compatible browser or mobile wallet for follow/profile/deletion permissions; an expanded request fails closed in the offline signer before phrase derivation. The older v0.2.0 binary does not accept a new-domain pairing request; use v0.2.1 for this website. Apple notarization remains pending.

## Saved devices and revocation

Saving a device is optional and off by default. After wallet authorization, **Save with a passkey** creates a separate site passkey and uses its [WebAuthn PRF extension](https://www.w3.org/TR/webauthn-3/#prf-extension) to protect the app's random posting key. PRF support depends on the browser, provider, and authenticator. Merely offering passkey sign-in does not prove that encrypted vault storage is supported; the app requires an actual PRF output and verified user presence/verification before saving.

A version-2 vault uses a 32-byte PRF result with HKDF-SHA256 and a fresh random salt to derive a non-extractable AES-256-GCM key. Authenticated metadata binds the exact website origin, credential/RP identifiers, account FID, custody address, device public key, approved scopes, encryption parameters and format version. Fresh WebAuthn challenges and exact RP/origin/credential checks prevent mixing up requests. The ciphertext, credential ID, user handle, public salts and public signer metadata stay in IndexedDB. PRF outputs, derived encryption keys, custody keys and recovery phrases are never sent to a backend, logged, or persisted in plaintext by the app. This is local encrypted storage, not a new hosted account service.

**Unlock with a passkey** decrypts the saved signer after the provider's device-verification prompt, then rechecks current custody, expiry and scope authorization with Hypersnap. It cannot register a signer or expand permissions. An already unlocked device can switch an existing password vault to a passkey in Device access without another wallet signature. Before commit, cancellation or failed setup leaves the previous vault intact. Replacement uses an atomic comparison of the whole old record, preserving a newer record saved by another tab. If cancellation wins just after commit, cleanup attempts to restore the previous wrapper only while the saved record still exactly matches this operation; a storage failure during cleanup can require reconnecting the custody wallet. Only one saved signer vault is kept in this browser.

Passkey-provider synchronization does not synchronize this app's encrypted vault. Clearing site data or opening a new browser/device means reconnecting the custody wallet; the wallet remains the recovery path. Losing the credential while keeping its ciphertext likewise requires a new wallet-approved signer. Forgetting a vault does not remove its passkey from the user's password manager; manage that credential there separately. On an unsupported browser/provider, use explicit password storage or keep the key only in this tab.

Existing version-1 password vaults still unlock with their original password. A password of at least 12 characters encrypts only the posting key using PBKDF2-SHA256 (600,000 iterations) and AES-256-GCM. It is not stored or recoverable; use a strong, unique password. A passkey protects the key while locked. An unlocked browser, malicious site code, or a compromised browser can still misuse the active posting key. The website never receives biometric data; the provider decides how to satisfy user verification, which may use a PIN rather than biometrics.

**Lock** clears the active key. **Forget** deletes the encrypted local copy but leaves network authorization intact. **Revoke** removes that specific device key from Hypersnap and waits for the node to report its absence before deleting the saved copy. Approve removal with the matching wallet app, or use the optional offline request/approval flow. If submission times out, use the status check; the app does not automatically resubmit uncertain writes. Keep a copy of the public key if you may need to identify it later.

Keys approved by older beta versions and other devices remain separate. This release does not silently remove them. Losing a browser key or deleting its vault does not itself revoke it; another compatible custody-authorized tool is needed to remove a lost key.

## Verify the macOS beta

This beta is **Developer ID–signed with hardened runtime**, but **Apple notarization is pending**. A valid signature identifies the publisher and detects changes; it is not an audit. macOS may block a downloaded unnotarized app. Follow your organization's policy and wait for a notarized release if required. The project does not ask you to disable Gatekeeper or remove quarantine.

```sh
shasum -a 256 -c SHA256SUMS.txt
ditto -x -k Arca-Signer-mac-arm64.zip ./arca-signer
codesign --verify --deep --strict --verbose=2 './arca-signer/Arca Signer.app'
codesign -dv --verbose=4 './arca-signer/Arca Signer.app'
```

Expected publisher: `Developer ID Application: LUIS FELIPE ABARCA RAMIREZ (48H3WZWYU3)`. Expected TeamIdentifier: `48H3WZWYU3`; bundle identifier: `computer.arca.hypersnap.signer`. Download the checksum, `BUILD-MANIFEST.json`, and `RELEASE-STATUS.json` from the same release. A checksum obtained from the same compromised download source is not independent proof of authenticity.

## Review and build

Check out the release tag, enter the repository root, and use Node 22 with Yarn 1.22:

```sh
yarn install --frozen-lockfile
yarn verify
yarn signer:dev
```

`yarn signer:build` writes readable bundled JavaScript to `apps/signer/dist-signer/` and a manifest recording the source commit, source input hash, runtime version, and payload file hashes. Repeating the build from the same sources and lockfile should reproduce those payloads. The signed ZIP contains timestamps and signatures and is not claimed to be bit-for-bit reproducible. Dependencies and build tooling remain part of the trust boundary.

On a Mac with your own Developer ID certificate:

```sh
yarn signer:package --sign-identity 'Developer ID Application: YOUR NAME (TEAMID)'
```

Release packaging requires a clean, committed tree. An optional `--notary-profile PROFILE_NAME` uses an existing `notarytool` Keychain profile; no Apple credentials belong in source. See [native implementation](../signer/README.md), [verification record](VERIFICATION.md), and [source](https://github.com/arcacomputer/opencaster).

## Boundaries

The companion uses a sandboxed renderer, context isolation, narrow validated IPC, a nonpersistent session, an allowlisted local protocol, and denied network/navigation/permissions. Electron's run-as-Node, inspector, and Node-options fuses are disabled. ASAR integrity validation is enabled. Only explicit user-selected public request/approval files are read or exported; the app has no automatic updates.

The browser and Worker use no Farcaster-operated sign-in service. Public reads and signed messages go through Arca's Cloudflare Worker to the Quilibrium-operated Hypersnap node. That node remains an availability and correctness dependency; confirmations are node observations, not independently verified consensus proofs. The MIT-licensed Farcaster client snapshot informed familiar UX only; the added sharing, profile, and conversation code is independently implemented without importing its hosted API client or dependencies. Public uploads add Cloudflare R2 storage and a SQLite Durable Object quota ledger, as detailed in [MEDIA.md](MEDIA.md). Optional WalletConnect signing adds Reown's relay and Verify services, plus the user's selected wallet software, to the connection's trust and availability boundaries. Cloudflare and GitHub distribute code, and compromised releases can compromise future imports. An infected operating system, clipboard monitor, or malicious signer build can steal a phrase despite this design. Never send a real recovery phrase to support, chat, issue reports, or screenshots.

Agent-run validation uses synthetic identities, mocked services, and public-read browser checks. The owner-reported Rainbow sign-in is separate from those tests. No real follow, profile update, image upload, or image-backed cast was submitted by this development session; see [VERIFICATION.md](VERIFICATION.md) for the current record.
