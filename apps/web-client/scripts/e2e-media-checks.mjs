/** Repeatable API/media checks against an actual isolated Hypersnap node.
 * Uses the canonical production HTTPS origin and unmodified production guards.
 * node scripts/e2e-media-checks.mjs --node http://127.0.0.1:13381 \
 *   --identity-file /tmp/arca-hypersnap-e2e/identity.json
 */
import fs from 'node:fs/promises';
import { createMediaRuntime, runMediaChecks } from './e2e-media-runtime.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!['--node', '--identity-file'].includes(process.argv[i]) || !process.argv[i + 1]) throw new Error('Use --node LOOPBACK_URL --identity-file SYNTHETIC_FIXTURE.');
  args.set(process.argv[i], process.argv[i + 1]);
}
if (!args.get('--node') || !args.get('--identity-file')) throw new Error('Use --node LOOPBACK_URL --identity-file SYNTHETIC_FIXTURE.');
const fixture = JSON.parse(await fs.readFile(args.get('--identity-file'), 'utf8'));
const runtime = await createMediaRuntime({ nodeUrl: args.get('--node') });
try {
  const result = await runMediaChecks(runtime, fixture);
  process.stdout.write(JSON.stringify({ kind: 'actual-local-hypersnap-media-checks', productionOriginUnmodified: true, registryMocked: false, ...result }) + '\n');
} finally { await runtime.dispose(); }
