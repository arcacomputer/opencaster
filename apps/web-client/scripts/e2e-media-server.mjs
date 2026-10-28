/** Starts a loopback-only adapter for the actual local Worker runtime.
 * Example:
 * node scripts/e2e-media-server.mjs --node http://127.0.0.1:3381 \
 *   --origin http://127.0.0.1:5173 --port 8788
 * Proxy /media (and optionally /api) from the browser's Vite server to :8788.
 * The signed browser origin remains :5173, not this internal proxy port.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import { createMediaRuntime, runMediaChecks } from './e2e-media-runtime.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i].startsWith('--') || !process.argv[i + 1]) throw new Error('Use --node URL --origin URL --port NUMBER [--identity-file PATH].');
  args.set(process.argv[i], process.argv[i + 1]);
}
const port = Number(args.get('--port') || '8788');
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !args.get('--node') || !args.get('--origin')) throw new Error('Use --node URL --origin URL --port NUMBER.');
const runtime = await createMediaRuntime({ nodeUrl: args.get('--node'), origin: args.get('--origin') });
if (args.has('--identity-file')) {
  const fixture = JSON.parse(await fs.readFile(args.get('--identity-file'), 'utf8'));
  process.stdout.write(JSON.stringify({ kind: 'media-e2e-checks', ...await runMediaChecks(runtime, fixture) }) + '\n');
}
const server = http.createServer(async (incoming, outgoing) => {
  try {
    if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) throw new Error('Invalid request path');
    const headers = new Headers();
    for (const [name, values] of Object.entries(incoming.headers)) {
      if (values !== undefined) headers.set(name, Array.isArray(values) ? values.join(',') : values);
    }
    // A proxy host header is not an application origin and never enters the
    // grant verifier. Build the Request with the configured browser origin.
    headers.delete('host');
    const body = [];
    let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) { outgoing.writeHead(413); outgoing.end(); incoming.destroy(); return; }
      body.push(chunk);
    }
    const request = new Request(new URL(incoming.url, runtime.origin), { method: incoming.method, headers, ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Buffer.concat(body) } : {}) });
    const response = await runtime.fetch(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    outgoing.end('The isolated media runtime could not complete this request.');
  }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(JSON.stringify({ kind: 'media-e2e-server', url: `http://127.0.0.1:${port}`, browserOrigin: runtime.origin, actualNode: runtime.nodeUrl, registryMocked: false }) + '\n'));
let closing = false;
async function close() {
  if (closing) return;
  closing = true; server.close(); server.closeAllConnections(); await runtime.dispose();
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
