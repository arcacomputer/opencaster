# Opencaster threat model

Scope: `arcacomputer/opencaster` (default branch). Infrastructure is in-repo: `services/gateway/wrangler.jsonc`, `services/analytics/wrangler.jsonc`, `services/gateway/zone-settings.json`, `services/gateway/worker-builds.json`. Builds on `services/gateway/SECURITY.md` (traffic controls, written by the maintainers) and the repo's `AGENTS.md` secrets rules. No separate infrastructure repository.

Facts marked **(user)** come from the maintainer; everything else is inferred from the code. Devin security scans of this repository rerank findings against this document; keep it current when trust boundaries, entry points or assets change. This document describes the system's design and controls; it is not an attack write-up (see `AGENTS.md` for where those belong).

## System overview and trust boundaries

Opencaster is a public browser social client for Hypersnap (a Farcaster-protocol node), served only at `https://opencaster.org`. Users hold their own keys: a custody wallet (browser extension or WalletConnect app) authorizes a scoped ed25519 **device key**, which signs casts/reactions in the browser. The gateway Worker never holds user keys; it forwards public reads and already-signed wire bytes to Hypersnap.

Trust boundaries:
1. Internet → gateway Worker (`opencaster.org`, legacy `quorum.arca.computer` redirect only).
2. Gateway → upstream Hypersnap nodes: public Haatz (`haatz.quilibrium.com`) and the private native read origin `node.opencaster.org` (token header `X-Opencaster-Origin-Token`).
3. Browser page ↔ user-generated content from the network (casts, profiles, embeds, channel metadata).
4. Browser ↔ wallet (EIP-1193/EIP-6963 extensions, WalletConnect relay).
5. Browser ↔ offline Electron signer (file-based request/approval exchange).
6. Operator → analytics dashboard (`analytics.opencaster.org`, Cloudflare Access + in-Worker JWT verification).
7. Build/release: Cloudflare Workers Builds (`scripts/cloudflare-build.mjs`), manual wrangler promotion.

## Components

| Component | Covers |
| --- | --- |
| Web Client | `apps/web-client/src/**` (React UI, rendering of network content, link embeds, composer, wallet connect UI) |
| Session & Keys | `apps/web-client/src/lib/{auth,vault,passkey,wallet,walletConnect,walletConnectSDK,sessionPersistence}.ts`, `packages/client-core/src/{pairing,pairingScopes}.ts`, `packages/protocol/**` |
| Gateway | `services/gateway/src/{index,upstream,analytics}.ts`, `services/gateway/wrangler.jsonc`, `zone-settings.json` |
| Media & Sharing | `services/gateway/src/{media,share*,sharing}.ts`, `packages/client-core/src/media.ts` |
| Signer | `apps/signer/**` |
| Analytics Dashboard | `services/analytics/**` |
| Shared Core | other `packages/client-core/src/**`, `packages/web-ui/**` |
| Build & Release | `scripts/**`, `.github/workflows/**`, root `package.json`/`yarn.lock`, `worker-builds.json` |

## Entry points and who can reach them

- `GET /api/<allowlisted path>` — anyone; strict path/query allowlist (`READ_ENDPOINTS`), rejects `%`/`\` in paths, cross-site Origin/`Sec-Fetch-Site`.
- `POST /api/v1/submitMessage` — anyone with signed bytes (≤64 KiB); signature validity is enforced by Hypersnap, not the gateway.
- `POST/GET /media/*` — upload requires a device-key-signed grant (`MEDIA_UPLOAD_HEADER`) checked against `/v1/signersByFid` (offchain signer, `CAST_ADD` scope, unexpired); quotas via `MediaUploadQuota` Durable Object; reads are public.
- `GET /_share/*` — anyone; server-rendered OG data and PNG share cards from public node data.
- `POST /_analytics/events` — anyone same-origin; coarse allowlisted categories, own rate limit, DNT/GPC respected.
- SPA assets — anyone.
- `analytics.opencaster.org` — operator only (Access application, exact email; Worker re-verifies RS256 JWT, iss, aud, exp/nbf).
- Electron signer — local user only; IPC sender/frame/origin pinned, `connect-src 'none'`, DNS mapped to NOTFOUND.

## Assets and data sensitivity

**(user)** All assets below matter as drafted: the device-key vault, the custody approval flow, the private node token and R2 media integrity. No asset was singled out above the others.

- Device signing keys in the browser vault (IndexedDB `arca-hypersnap`, PBKDF2 600k / passkey HKDF / non-extractable CryptoKey) — **high**: lets an attacker post, react, follow, edit profile, or delete casts as the user within granted scopes, for up to 7 days of inactivity lifetime.
- Custody-wallet approval flow (`KeyAdd` + `SignedKeyRequest` typed data) — **critical**: tricking a user into approving a key with attacker-controlled public key or broader scopes yields account takeover at the protocol level.
- Recovery phrase / custody key in the offline signer — **critical**.
- WalletConnect pairing secret — high while live.
- Private node token `HYPERSNAP_READ_ORIGIN_TOKEN` (and any future `HYPERSNAP_ORIGIN_TOKEN`) — high: grants raw node access.
- R2 media bucket integrity and quotas — medium (public, persistent images; abuse = hosting cost / malicious content).
- Analytics data — low/medium (coarse, no IPs); dashboard access identity must not leak.
- Cloudflare API token / build credentials — high, outside the repo.
- Service availability — medium.

## Attacker profiles

**(user)** All drafted attackers count: anonymous internet attackers, hostile content authors and malicious wallet extensions. No attacker profile is ruled out.

1. Anonymous internet attacker against the gateway (path/query smuggling, SSRF toward upstream, token exfiltration, cache poisoning of the aggregate edge cache, quota abuse, DoS).
2. Hostile content author on Hypersnap: crafted casts, profile fields, embeds, channel data or URLs rendered in other users' browsers (XSS, open redirect, `javascript:` URLs, CSS/clickjacking, phishing in share cards).
3. Malicious or impersonating wallet extension / WalletConnect peer (documented as a trust choice in `SIGNER.md`).
4. Malicious or compromised upstream node (Haatz) returning hostile JSON.
5. Local attacker with access to the user's browser profile (offline vault cracking).
6. Supply-chain attacker via npm dependencies or the build pipeline.

## Existing controls

- Canonical-origin enforcement before any work; `workers_dev`/`preview_urls` off; HSTS, strict CSP (`script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`), COOP/CORP, `no-referrer`.
- Per-IP Worker rate limit (120/10s) on `/api/`, `/_share/`, `/_analytics/`, fail-closed when enabled but missing.
- Exact allowlist of upstream paths and query params; bounded reads (4 MiB response, 64 KiB message) and timeouts; upstream URL built from fixed origin, no credentials/redirects; token never forwarded on redirects; aggregate cache keyed only by upstream origin and public query.
- Media: server-side image signature/dimension validation, no SVG/HTML, sandboxed CSP on media, replay protection, per-account and global daily quotas, fail closed on incomplete signer lists.
- Pairing: typed-data signatures verified locally against custody address and exact request hash before submission; scopes validated; 15-minute pairing window.
- Signer: sandbox, deny-by-default CSP and network, IPC sender pinning.
- Analytics dashboard: Access + JWT verification with config-sourced JWKS location; observability disabled.
- AGENTS.md: no secrets in source or browser env; key material never in logs/telemetry.

## Out of scope / accepted risk

**(user)** Nothing is ruled out or accepted as risk. The analytics dashboard, the offline signer and rate-limit/DoS issues stay in scope at the scanner's severity. The documented limits below describe product behavior; they are not exemptions.

- Documented in `SIGNER.md`: wallet providers discovered via EIP-6963 are not authenticated; a malicious extension can impersonate a wallet (user's trust choice). Uploaded images are public, persistent and keep EXIF metadata. Deleting a cast does not delete R2 media. WalletConnect relay sees routing metadata.
- Documented in gateway `SECURITY.md`: Cloudflare rate limits are approximate, per-location and not a guarantee against invocation costs.
- The Hypersnap node itself, which has its own repository and threat model.

## Open questions

- None outstanding. Findings are tagged by Component (table above), CWE and, for dependencies, CVE **(user)**.
