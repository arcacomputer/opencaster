# Third-party code

## resvg WebAssembly 2.6.2

The server-side cast and profile preview renderer uses the unmodified
`@resvg/resvg-wasm` 2.6.2 package under MPL-2.0. Its complete license is retained
in [licenses/resvg-2.6.2-MPL-2.0.txt](licenses/resvg-2.6.2-MPL-2.0.txt).
The corresponding source is the
[resvg-js v2.6.2 release](https://github.com/thx/resvg-js/tree/v2.6.2), including
the `wasm/` JavaScript bindings and the Rust renderer. The dependency is bundled
only in the gateway; it adds no browser SDK or external rendering service.

## WalletConnect SignClient 2.26.0

Portions © 2025 Reown, Inc. All Rights Reserved.

The optional wallet-app transport bundles `@walletconnect/sign-client` 2.26.0
and its WalletConnect dependencies, distributed under the **WalletConnect
Community License Agreement**, released 20 August 2025. The complete package
license is included verbatim in
[licenses/walletconnect-2.26.0-LICENSE.md](licenses/walletconnect-2.26.0-LICENSE.md).
The source release corresponds to commit
`63094dcb6fded05dcbc2b08b8895ada75a31dcb5` in the
[official WalletConnect monorepo](https://github.com/WalletConnect/walletconnect-monorepo).

This license is distinct from the repository's AGPL license and is not the
Apache license used by older WalletConnect releases. The project owner approved
this dependency and its encrypted external relay. Its redistribution,
attribution/branding, network-connectivity and commercial-use conditions remain
applicable. The included license states commercial thresholds of 500 monthly
active users or 2,500,000 monthly RPCs; operators should review its full terms and
current service conditions when distributing or scaling a deployment. WalletConnect
is a product/protocol name; this notice does not imply endorsement by Reown.

No WalletConnect SDK code is modified. The integration uses a local adapter,
requests typed-data signatures only, and disables optional SDK telemetry.

## Quorum Shared protocol adaptations

`src/lib/protocol/{protoWire,messageBuilder,signedKeyRequest}.ts` is adapted from
[Quorum Shared](https://github.com/QuilibriumNetwork/quorum-shared), commit
`c00c61e099fe9e682c982bc952b4e712c7a4a576`, package version `2.1.0-45`.
The upstream package declares the MIT license. Adaptations remove signing
diagnostics and keep this web client's protocol dependency separate from the
upstream messenger runtime.

MIT License

Copyright (c) Quorum Shared contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
