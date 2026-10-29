import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(root, '../..');
const webRoot = join(repoRoot, 'apps/web-client');
const require = createRequire(import.meta.url);
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--project', 'tsconfig.json'], { cwd: root, stdio: 'inherit' });
const output = join(root, 'dist-signer');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const common = { bundle: true, metafile: true, sourcemap: false, minify: false, legalComments: 'eof', logLevel: 'warning', target: 'es2022', absWorkingDir: root };
const bundles = [];
bundles.push(await build({ ...common, entryPoints: ['main.ts'], outfile: join(output, 'main.cjs'), platform: 'node', format: 'cjs', external: ['electron'] }));
bundles.push(await build({ ...common, entryPoints: ['preload.ts'], outfile: join(output, 'preload.cjs'), platform: 'node', format: 'cjs', external: ['electron'] }));
bundles.push(await build({ ...common, entryPoints: ['renderer.tsx'], outfile: join(output, 'renderer.js'), platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } }));
const packages = new Set();
for (const bundle of bundles) for (const input of Object.keys(bundle.metafile.inputs)) {
  if (!input.includes('node_modules/')) continue;
  let directory = dirname(resolve(root, input));
  while (directory !== dirname(directory)) {
    try {
      const candidate = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (candidate.name && candidate.version) { packages.add(directory); break; }
    } catch { /* Continue past subdirectories with no package metadata. */ }
    directory = dirname(directory);
  }
}
const notices = [];
for (const directory of [...packages].sort()) {
  const dependency = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const names = (await readdir(directory)).filter(name => /^licen[cs]e(?:[.-]|$)/i.test(name)).sort();
  if (names.length === 0) throw new Error(`Missing license notice for bundled dependency ${dependency.name}`);
  for (const name of names) notices.push(`${dependency.name} ${dependency.version}\n${await readFile(join(directory, name), 'utf8')}`);
}
await writeFile(join(output, 'DEPENDENCY-LICENSES.txt'), notices.join('\n\n--------------------\n\n') + '\n');
for (const name of ['index.html', 'style.css']) await cp(join(root, name), join(output, name));
await cp(join(webRoot, 'public/quorum-symbol.svg'), join(output, 'quorum-symbol.svg'));
await cp(join(repoRoot, 'LICENSE'), join(output, 'LICENSE'));
await cp(join(webRoot, 'THIRD_PARTY_NOTICES.md'), join(output, 'THIRD_PARTY_NOTICES.md'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
// Packager removes the workspace-only private flag from runtime metadata. Omit
// it here so the payload manifest also describes the final archived bytes.
await writeFile(join(output, 'package.json'), JSON.stringify({ name: 'arca-signer', productName: 'Arca Signer', version: pkg.version, main: 'main.cjs', license: 'AGPL-3.0-only', author: 'Arca', description: 'Offline Hypersnap custody authorization companion' }, null, 2) + '\n');

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = {};
for (const path of await files(output)) hashes[relative(output, path)] = sha256(await readFile(path));
// Record first-party inputs by repository path. Workspace packages and the root
// lockfile are part of this payload's provenance, regardless of Yarn hoisting.
const signerSources = (await readdir(root)).filter(name => /\.(?:tsx?|html|css|plist)$/.test(name)).map(name => join(root, name));
const sourceInputs = [...signerSources, ...await files(join(repoRoot, 'packages/protocol/src')), ...await files(join(repoRoot, 'packages/web-ui/src')),
  ...['pairing.ts', 'appOrigins.ts'].map(name => join(repoRoot, 'packages/client-core/src', name)),
  ...['protocol', 'client-core', 'web-ui'].flatMap(name => ['package.json', 'tsconfig.json'].map(file => join(repoRoot, 'packages', name, file))),
  join(webRoot, 'public/quorum-symbol.svg'), join(repoRoot, 'LICENSE'), join(webRoot, 'THIRD_PARTY_NOTICES.md'), join(root, 'package.json'), join(root, 'tsconfig.json'), join(repoRoot, 'package.json'), join(repoRoot, 'tsconfig.base.json'), join(repoRoot, 'yarn.lock'), fileURLToPath(import.meta.url), join(root, 'scripts/package-signer.mjs')
].filter(path => !/\.(?:test|spec)\.tsx?$/.test(path) && !path.endsWith('keyadd-golden.json')).sort();
const sourceHasher = createHash('sha256');
for (const path of sourceInputs) { sourceHasher.update(relative(repoRoot, path)); sourceHasher.update('\0'); sourceHasher.update(await readFile(path)); sourceHasher.update('\0'); }
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
const manifest = { schema: 1, product: 'Arca Signer', version: pkg.version, source_commit: commit, source_tree_sha256: sourceHasher.digest('hex'), working_tree_dirty: dirty, electron_version: pkg.devDependencies.electron, files: hashes };
await writeFile(join(output, 'BUILD-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Offline signer payload built: ${Object.keys(hashes).length} files, source ${manifest.source_tree_sha256.slice(0, 16)} (${dirty ? 'uncommitted sources' : commit.slice(0, 12)}).`);
