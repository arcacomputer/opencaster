/** Test-only local runtime. Never imported by the production Worker or browser.
 * It keeps the production gateway source unchanged and routes its fixed node
 * destination to an explicitly supplied local Hypersnap node, not a mock.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = path.resolve(project, '../..');
const sourceDirectories = ['apps', 'services', 'packages'].map(name => path.join(repository, name));
const clientCore = path.join(repository, 'packages/client-core/src');

function isFirstPartySource(id) {
  const filename = path.resolve(id.split('?')[0]);
  return sourceDirectories.some(directory => filename.startsWith(directory + path.sep))
    && !filename.includes(`${path.sep}node_modules${path.sep}`)
    && /\.[cm]?[jt]sx?$/.test(filename);
}
// Read only the public literal constants; never import the production module
// into this Node test runtime or duplicate the currently configured domain.
const appOriginSource = await fs.readFile(path.join(clientCore, 'appOrigins.ts'), 'utf8');
const testOrigins = ['APP_ORIGIN', 'LEGACY_APP_ORIGIN', 'WORKER_ORIGIN'].map(name => {
  const value = appOriginSource.match(new RegExp(`^export const ${name} = '(https://[^']+)';$`, 'm'))?.[1];
  if (!value) throw new Error(`The media harness could not read ${name}.`);
  return value;
});
const PRIMARY_ORIGIN = testOrigins[0];
const localHosts = ['localhost', '127.0.0.1', '[::1]'];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

function localUrl(value, name) {
  const url = new URL(value);
  if (!localHosts.includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(`${name} must be a loopback HTTP(S) origin.`);
  return url;
}

export function replaceTestOrigins(source, origin) {
  if (origin === PRIMARY_ORIGIN) return source;
  localUrl(origin, 'test origin');
  return testOrigins.reduce((changed, productionOrigin) => changed.replaceAll(productionOrigin, origin), source);
}

/** The production UI deliberately accepts HTTPS image URLs only. The isolated
 * HTTP loopback harness needs a narrowly scoped exception for its own hashed
 * media path, never arbitrary HTTP links. These changes exist only in the test
 * transform output and are intentionally absent from checked-in app sources.
 */
export function replaceTestMediaGuards(source, id, origin) {
  if (origin === PRIMARY_ORIGIN) return source;
  localUrl(origin, 'test origin');
  const normalized = id.split('?')[0].replaceAll('\\', '/');
  const media = variable => `(${variable}.origin === ${JSON.stringify(origin)} && /^\\/media\\/[a-f0-9]{64}$/.test(${variable}.pathname))`;
  if (normalized.endsWith('/src/App.tsx')) {
    source = source.replace("url.protocol === 'https:' ? url.href", `(url.protocol === 'https:' || ${media('url')}) ? url.href`);
    source = source.replace("url.protocol === 'https:' && !url.username", `(url.protocol === 'https:' || ${media('url')}) && !url.username`);
  }
  if (normalized.endsWith('/src/components/MediaViewer.tsx')) source = source.replace("url.protocol === 'https:' && !url.username", `(url.protocol === 'https:' || ${media('url')}) && !url.username`);
  if (normalized.endsWith('/packages/client-core/src/appOrigins.ts')) {
    const escapedOrigin = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('/', '\\/');
    // Drafts call this real shared helper. Keep production HTTPS links valid,
    // adding only the exact configured loopback origin and hashed media path.
    source = source.replace(/(export function isUploadedMediaUrl[\s\S]*?return typeof value === 'string' && )([^\n]+);/, (_match, prefix, production) => `${prefix}(${production} || (value.length === ${origin.length + '/media/'.length + 64} && /^${escapedOrigin}\\/media\\/[a-f0-9]{64}$/.test(value)));`);
  }
  if (normalized.endsWith('/src/components/EditProfileDialog.tsx')) source = source.replace("parsed.protocol === 'https:' &&", `(parsed.protocol === 'https:' || ${media('parsed')}) &&`);
  if (normalized.endsWith('/src/lib/social.ts')) source = source.replace("url.protocol !== 'https:' ||", `(url.protocol !== 'https:' && !${media('url')}) ||`);
  if (normalized.endsWith('/src/lib/auth.ts')) source = source.replace(/url\.protocol !== 'https:' \|\| ((?:!!)?url\.username)/, (_match, credentials) => `(url.protocol !== 'https:' && !${media('url')}) || ${credentials}`);
  if (normalized.endsWith('/packages/client-core/src/api.ts')) source = source.replace("url.protocol === 'https:' && (", `(url.protocol === 'https:' || ${media('url')}) && (`);
  return source;
}

export function viteTestOriginPlugin(origin) {
  if (origin !== PRIMARY_ORIGIN) localUrl(origin, 'test origin');
  return {
    name: 'arca-e2e-loopback-origin', enforce: 'pre',
    transform(source, id) {
      if (!isFirstPartySource(id)) return;
      return replaceTestMediaGuards(replaceTestOrigins(source, origin), id, origin);
    },
  };
}

async function miniflareModule() {
  const require = createRequire(import.meta.url);
  if (process.env.ARCA_WRANGLER_PATH) return createRequire(await fs.realpath(process.env.ARCA_WRANGLER_PATH))('miniflare');
  // Prefer the current CLI's runtime, not an unrelated parent-directory copy
  // of Miniflare that Node may discover in the user's home node_modules.
  try {
    const executable = execFileSync('which', ['wrangler'], { encoding: 'utf8' }).trim();
    return createRequire(await fs.realpath(executable))('miniflare');
  } catch { return require('miniflare'); }
}

/** Use this plugin for a separate E2E browser build too. It only rewrites our
 * three public origins in first-party code; it does not change protocol domains,
 * node destinations, SDK code or the checked-in production source.
 */
export function testOriginTransform(origin) {
  if (origin === PRIMARY_ORIGIN) return [];
  localUrl(origin, 'test origin');
  return [{
    name: 'arca-e2e-loopback-origin',
    setup(plugin) {
      plugin.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async args => {
        if (!isFirstPartySource(args.path)) return;
        const source = await fs.readFile(args.path, 'utf8');
        const contents = replaceTestMediaGuards(replaceTestOrigins(source, origin), args.path, origin);
        const extension = path.extname(args.path).slice(1);
        return { contents, loader: ['tsx', 'jsx', 'ts'].includes(extension) ? extension : 'js', resolveDir: path.dirname(args.path) };
      });
    },
  }];
}

/**
 * Contract:
 * createMediaRuntime({nodeUrl:'http://127.0.0.1:PORT', origin?, assetsDir?})
 * returns {fetch(request), origin, nodeUrl, nodeRequests, dispose()}.
 * `fetch` executes the production gateway including its CSP, the real local
 * SQLite Durable Object and local R2, and all node requests reach nodeUrl.
 * No listener, remote bucket or mock registry is created here.
 */
export async function createMediaRuntime({ nodeUrl, origin = PRIMARY_ORIGIN, assetsDir = path.join(project, 'dist') }) {
  const node = localUrl(nodeUrl, 'Hypersnap node');
  if (origin !== PRIMARY_ORIGIN) localUrl(origin, 'test origin');
  const nodeRequests = [];
  const nodeErrors = [];
  const worker = await build({ entryPoints: [path.join(repository, 'services/gateway/src/index.ts')], platform: 'browser', bundle: true, format: 'esm', write: false, plugins: testOriginTransform(origin) });
  const { Miniflare, convertV4MiniflareOptions, Response: RuntimeResponse } = await miniflareModule();
  const options = {
    modules: true, script: worker.outputFiles[0].text,
    // The bundled workerd currently supports through this date. Production's
    // separately deployed compatibility date is intentionally unchanged.
    compatibilityDate: '2026-10-02',
    r2Buckets: ['MEDIA_BUCKET'],
    durableObjects: { MEDIA_QUOTA: { className: 'MediaUploadQuota', useSQLite: true } },
    outboundService: async request => {
      const incoming = new URL(request.url);
      if (incoming.origin !== 'https://haatz.quilibrium.com') throw new Error('External network is unavailable in this E2E runtime.');
      const target = new URL(incoming.pathname + incoming.search, node.origin);
      nodeRequests.push({ method: request.method, path: incoming.pathname });
      let response;
      try {
        // workerd's Headers is not Node's Headers implementation. Normalize
        // entries and let Node calculate framing from the buffered bytes.
        const headers = new Headers(Array.from(request.headers.entries()));
        headers.delete('content-length'); headers.delete('transfer-encoding');
        response = await fetch(target, { method: request.method, headers, redirect: 'manual', ...(request.method !== 'GET' && request.method !== 'HEAD' ? { body: new Uint8Array(await request.arrayBuffer()).slice().buffer } : {}) });
      } catch (error) {
        nodeErrors.push({ method: request.method, path: incoming.pathname, status: 0, detail: error instanceof Error ? `${error.message}: ${error.cause instanceof Error ? error.cause.message : ''}` : 'Local transport failed.' });
        throw error;
      }
      const bytes = await response.arrayBuffer();
      if (!response.ok) nodeErrors.push({ method: request.method, path: incoming.pathname, status: response.status, detail: new TextDecoder().decode(bytes).slice(0, 4096) });
      return new RuntimeResponse(bytes, { status: response.status, headers: response.headers });
    },
    serviceBindings: {
      ASSETS: async request => {
        const url = new URL(request.url);
        let relative;
        try { relative = decodeURIComponent(url.pathname).replace(/^\/+/, ''); } catch { return new RuntimeResponse('Invalid asset path', { status: 400 }); }
        if (relative.split('/').includes('..') || relative.includes('\\')) return new RuntimeResponse('Invalid asset path', { status: 400 });
        let file = path.join(assetsDir, relative || 'index.html');
        let bytes;
        try { bytes = await fs.readFile(file); }
        catch {
          if (path.extname(relative)) return new RuntimeResponse('Asset not found', { status: 404 });
          file = path.join(assetsDir, 'index.html'); bytes = await fs.readFile(file);
        }
        return new RuntimeResponse(bytes, { headers: { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' } });
      },
    },
  };
  const runtime = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
  return {
    origin, nodeUrl: node.origin, nodeRequests, nodeErrors,
    async fetch(request, init) {
      // Miniflare and Node can use different Request implementations. Passing
      // Node's instance directly may stringify it as "[object Request]". The
      // loopback adapter normalizes the public request fields explicitly.
      if (request && typeof request === 'object' && typeof request.url === 'string') {
        const method = request.method || 'GET';
        return runtime.dispatchFetch(request.url, {
          method, headers: Array.from(request.headers.entries()),
          ...(!['GET', 'HEAD'].includes(method) && request.body !== null ? { body: await request.arrayBuffer() } : {}),
          ...init,
        });
      }
      return runtime.dispatchFetch(request, init);
    },
    async dispose() { await runtime.dispose(); },
  };
}

// Use the repository's real PNG, rather than a minimal magic-header fixture,
// so browser decoding and avatar display are covered by the same bytes.
export const E2E_PNG = new Uint8Array(await fs.readFile(path.join(project, 'public/unknown-dark.png')));

/** Validate an identity produced by the local-node fixture. No recovery phrase
 * format is accepted. This routine must never be pointed at the public node.
 */
export async function runMediaChecks(runtime, fixture) {
  localUrl(runtime.nodeUrl, 'Hypersnap node');
  if (fixture.kind !== 'arca.hypersnap.e2e.identity' || fixture.version !== 1 || !Number.isSafeInteger(fixture.fid) || fixture.fid < 1 || !/^[a-f0-9]{64}$/.test(fixture.devicePrivateKeyHex)) throw new Error('Use a synthetic identity created by the local Hypersnap fixture.');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'arca-media-e2e-'));
  let privateKey;
  try {
    const helper = await build({ stdin: { contents: `export {createMediaUploadGrant,sha256Hex,mediaGrantPayload} from '@opencaster/client-core/media'; export {ed25519} from '@noble/curves/ed25519.js'; export {bytesToHex} from '@opencaster/protocol/signedKeyRequest';`, resolveDir: project }, platform: 'node', bundle: true, format: 'esm', write: false, plugins: testOriginTransform(runtime.origin) });
    const helperFile = path.join(temporary, 'helper.mjs'); await fs.writeFile(helperFile, helper.outputFiles[0].text);
    const { createMediaUploadGrant, sha256Hex, mediaGrantPayload, ed25519, bytesToHex } = await import(pathToFileURL(helperFile));
    privateKey = Uint8Array.from(fixture.devicePrivateKeyHex.match(/../g), value => parseInt(value, 16));
    const publicKey = bytesToHex(ed25519.getPublicKey(privateKey));
    const hash = await sha256Hex(E2E_PNG);
    const input = { origin: runtime.origin, sha256: hash, size: E2E_PNG.length, contentType: 'image/png' };
    const grant = () => createMediaUploadGrant(input, { fid: fixture.fid, publicKey }, async payload => ed25519.sign(payload, privateKey));
    const upload = (proof, bytes = E2E_PNG) => runtime.fetch(`${runtime.origin}/media/upload`, { method: 'POST', headers: { Origin: runtime.origin, 'Content-Type': proof.contentType, 'X-Arca-Media-Grant': JSON.stringify(proof) }, body: new Uint8Array(bytes).buffer });
    const registry = await runtime.fetch(`${runtime.origin}/api/v1/signersByFid?fid=${fixture.fid}&pageSize=1000&requesterFids%5B0%5D=${fixture.fid}`);
    if (!registry.ok) throw new Error(`The local node registry returned ${registry.status}.`);
    const registered = await registry.json();
    if (!registered.signers?.some(signer => String(signer.key).replace(/^0x/, '').toLowerCase() === publicKey && signer.source === 'SIGNER_SOURCE_OFFCHAIN')) throw new Error('The fixture device key is not registered on the actual local Hypersnap node.');
    const firstGrant = await grant();
    const accepted = await upload(firstGrant);
    const replay = await upload(firstGrant);
    const image = await runtime.fetch(`${runtime.origin}/media/${hash}`);
    const exactBytes = bytesToHex(new Uint8Array(await image.arrayBuffer())) === bytesToHex(E2E_PNG);
    const invalidBytes = new TextEncoder().encode('<svg><script>invalid</script></svg>');
    const invalidGrant = await createMediaUploadGrant({ ...input, sha256: await sha256Hex(invalidBytes), size: invalidBytes.length }, { fid: fixture.fid, publicKey }, async payload => ed25519.sign(payload, privateKey));
    const invalid = await upload(invalidGrant, invalidBytes);
    const expiredGrant = await grant(); expiredGrant.issuedAt -= 121; expiredGrant.expiresAt -= 121; expiredGrant.signature = bytesToHex(ed25519.sign(mediaGrantPayload(expiredGrant), privateKey));
    const expired = await upload(expiredGrant);
    const unauthorizedKey = new Uint8Array(32).fill(247);
    const unauthorizedGrant = await createMediaUploadGrant(input, { fid: fixture.fid, publicKey: bytesToHex(ed25519.getPublicKey(unauthorizedKey)) }, async payload => ed25519.sign(payload, unauthorizedKey));
    const unauthorized = await upload(unauthorizedGrant);
    unauthorizedKey.fill(0);
    const result = { registry: registry.status, upload: accepted.status, replay: replay.status, image: image.status, exactBytes, invalid: invalid.status, expired: expired.status, unauthorized: unauthorized.status, imageUrl: `${runtime.origin}/media/${hash}`, actualNode: runtime.nodeUrl };
    if (result.upload !== 200 || result.replay !== 409 || result.image !== 200 || !result.exactBytes || result.invalid !== 415 || result.expired !== 401 || result.unauthorized !== 403) throw new Error(`Media E2E failed: ${JSON.stringify(result)}`);
    return result;
  } finally { privateKey?.fill(0); await fs.rm(temporary, { recursive: true, force: true }); }
}
