/** Isolated browser harness. This file is never a production entry point.
 * Builds the real app with a synthetic EIP-6963 wallet and routes every API
 * write to a loopback Hypersnap node. No real wallet or recovery phrase is used.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { createMediaRuntime, viteTestOriginPlugin, E2E_PNG } from './e2e-media-runtime.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const port = Number(args.get('--port') || 5187);
const nodeUrl = args.get('--node');
const fixtureFile = args.get('--identity-file');
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !nodeUrl || !fixtureFile) throw new Error('Use --node LOOPBACK_URL --identity-file SYNTHETIC_FIXTURE --port NUMBER.');
const node = new URL(nodeUrl);
if (node.protocol !== 'http:' || node.hostname !== '127.0.0.1' || node.pathname !== '/' || node.search || node.hash || node.username || node.password) throw new Error('The browser harness requires an isolated loopback node.');
const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'));
if (fixture.kind !== 'arca.hypersnap.e2e.identity' || fixture.version !== 1 || !Number.isSafeInteger(fixture.fid) || !/^(?:0x)?[a-f0-9]{64}$/.test(fixture.custodyPrivateKeyHex)) throw new Error('Use only the synthetic local-node identity fixture.');
const origin = `http://127.0.0.1:${port}`;
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'arca-browser-e2e-'));
const assetsDir = path.join(temporary, 'assets');
const walletSource = `
import { privateKeyToAccount } from 'viem/accounts';
const account = privateKeyToAccount(${JSON.stringify('0x' + fixture.custodyPrivateKeyHex.replace(/^0x/, ''))});
const provider = { async request({method,params}) {
  if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account.address];
  if (method === 'eth_chainId') return '0x1';
  if (method === 'eth_signTypedData_v4') {
    if (String(params[0]).toLowerCase() !== account.address.toLowerCase()) throw new Error('Wrong synthetic account.');
    const data = JSON.parse(params[1]);
    if (!['KeyAdd','SignedKeyRequest','KeyRemove'].includes(data.primaryType)) throw new Error('Unexpected test signing request.');
    return account.signTypedData(data);
  }
  throw new Error('Unsupported synthetic-wallet method: ' + method);
}};
const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{uuid:'180899aa-2a71-41ae-a931-febf090b2444',name:'Isolated test wallet',rdns:'test.arca.local'},provider}}));
window.addEventListener('eip6963:requestProvider',announce);
announce();
document.title = 'ISOLATED TEST · Opencaster';
const banner = document.createElement('div');
banner.textContent = 'ISOLATED HYPERSNAP TEST · synthetic FID ${fixture.fid} · no production writes';
banner.setAttribute('role','note');
banner.style.cssText = 'background:#124e36;color:white;padding:8px;text-align:center;font:12px sans-serif';
document.body.prepend(banner);
`;
await build({
  root: project, configFile: path.join(project, 'vite.config.ts'),
  plugins: [viteTestOriginPlugin(origin), {
    name: 'arca-isolated-wallet',
    resolveId(id) { if (id === '/e2e-wallet.js') return '\0arca-e2e-wallet'; },
    load(id) { if (id === '\0arca-e2e-wallet') return walletSource; },
    transformIndexHtml: { order: 'pre', handler(html) { return html.replace('<script type="module" src="/src/main.tsx">', '<script type="module" src="/e2e-wallet.js"></script><script type="module" src="/src/main.tsx">'); } },
  }],
  build: { outDir: assetsDir, emptyOutDir: true },
});
const runtime = await createMediaRuntime({ nodeUrl: node.origin, origin, assetsDir });
await fs.writeFile(path.join(temporary, 'test-image.png'), E2E_PNG);
await fs.writeFile(path.join(temporary, 'invalid-image.png'), '<svg><script>not an image</script></svg>');
let delayNextProfileRead = false;
const server = http.createServer(async (incoming, outgoing) => {
  try {
    if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) throw new Error('Invalid path');
    if (incoming.method === 'GET' && incoming.url === '/__e2e/node-errors') {
      outgoing.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      outgoing.end(JSON.stringify(runtime.nodeErrors)); return;
    }
    // Test control for the stale-read race: capture the next real node response
    // before the save, then deliver it after later confirmation reads complete.
    // This adapter and control route never enter the production Worker/build.
    if (incoming.method === 'POST' && incoming.url === '/__e2e/delay-next-profile-read') {
      if (incoming.headers['sec-fetch-site'] === 'cross-site') { outgoing.writeHead(403); outgoing.end(); return; }
      delayNextProfileRead = true;
      outgoing.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      outgoing.end(JSON.stringify({ delayNextProfileReadMs: 15_000 })); return;
    }
    const headers = new Headers();
    for (const [name, values] of Object.entries(incoming.headers)) if (values !== undefined && name !== 'host') headers.set(name, Array.isArray(values) ? values.join(',') : values);
    const chunks = []; let size = 0;
    for await (const chunk of incoming) { size += chunk.length; if (size > 5 * 1024 * 1024) { outgoing.writeHead(413); outgoing.end(); return; } chunks.push(chunk); }
    if (incoming.method === 'POST' && incoming.url === '/api/v1/submitMessage') await fs.writeFile(path.join(temporary, 'last-synthetic-message.bin'), Buffer.concat(chunks));
    const request = new Request(new URL(incoming.url, origin), { method: incoming.method, headers, ...(!['GET','HEAD'].includes(incoming.method) ? { body: Buffer.concat(chunks) } : {}) });
    const url = new URL(request.url);
    const delayed = delayNextProfileRead && incoming.method === 'GET' && url.pathname === '/api/v2/farcaster/user' && url.searchParams.get('fid') === String(fixture.fid);
    if (delayed) delayNextProfileRead = false;
    const response = await runtime.fetch(request);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (delayed) await new Promise(resolve => setTimeout(resolve, 15_000));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(bytes);
  } catch (error) {
    process.stderr.write(`Isolated runtime error: ${String(error?.message || error).slice(0, 600)}\n`);
    outgoing.writeHead(502); outgoing.end('Isolated test request failed.');
  }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(JSON.stringify({ kind: 'browser-e2e-server', url: origin, actualNode: node.origin, fid: fixture.fid, testImage: path.join(temporary, 'test-image.png'), invalidImage: path.join(temporary, 'invalid-image.png'), registryMocked: false }) + '\n'));
let closing = false;
async function close() { if (closing) return; closing = true; server.close(); server.closeAllConnections(); await runtime.dispose(); await fs.rm(temporary, { recursive: true, force: true }); }
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
